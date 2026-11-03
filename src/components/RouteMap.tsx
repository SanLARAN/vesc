import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Navigation, X } from 'lucide-react';
import { YANDEX_MAPS_API_KEY } from '../config';
import type { GeoFix } from '../hooks/useGeolocation';
import type { RoutePoint, SpeedColorSet, SpeedThresholdSet } from '../hooks/useRouteRecorder';

interface YGeoObject {
  geometry: { setCoordinates(c: unknown): void; getCoordinates(): number[][] };
}
interface YMap {
  geoObjects: { add(o: unknown): void; remove(o: unknown): void };
  events: { add(type: string, cb: (e: { get(name: string): unknown }) => void): void };
  setCenter(c: number[], zoom?: number, opts?: object): void;
  setBounds(b: number[][], opts?: object): void;
  getZoom(): number;
  destroy(): void;
}
interface YandexMapApi {
  ready(cb: () => void): void;
  route?: (points: number[][], options?: object) => Promise<{ getHumanLength?: () => string; getHumanTime?: () => string }>;
  Map: new (el: HTMLElement, state: object, options?: object) => YMap;
  Polyline: new (coords: number[][], props?: object, options?: object) => YGeoObject;
  Placemark: new (coords: number[], props?: object, options?: object) => YGeoObject;
}

declare global {
  interface Window {
    ymaps?: YandexMapApi;
  }
}

const SCRIPT_ID = 'yandex-maps-api-v21';
const MOSCOW = [55.751, 37.618];
let loader: Promise<YandexMapApi> | null = null;

function loadYmaps(): Promise<YandexMapApi> {
  if (window.ymaps) return new Promise((res) => window.ymaps!.ready(() => res(window.ymaps!)));
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (!YANDEX_MAPS_API_KEY) {
      reject(new Error('Не задан ключ Яндекс Карт (VITE_YANDEX_MAPS_API_KEY)'));
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(YANDEX_MAPS_API_KEY)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => (window.ymaps ? window.ymaps.ready(() => resolve(window.ymaps!)) : reject(new Error('API карт не загрузилось')));
    script.onerror = () => {
      loader = null;
      script.remove();
      reject(new Error('Не удалось загрузить Яндекс Карты — проверьте интернет'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export function speedColor(speed: number, colors: SpeedColorSet, t: SpeedThresholdSet): string {
  if (speed < t[0]) return colors[0];
  if (speed < t[1]) return colors[1];
  if (speed < t[2]) return colors[2];
  return colors[3];
}

interface Props {
  points: RoutePoint[];
  fix: GeoFix | null;
  colors: SpeedColorSet;
  thresholds: SpeedThresholdSet;
  follow?: boolean;
  navigation?: boolean;
  fitKey?: string | null;
  className?: string;
}

export function RouteMap({ points, fix, colors, thresholds, follow = true, navigation = true, fitKey, className = '' }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<YMap | null>(null);
  const apiRef = useRef<YandexMapApi | null>(null);
  const linesRef = useRef<{ obj: YGeoObject; color: string; coords: number[][] }[]>([]);
  const drawnRef = useRef<{ count: number; firstAt: number; colorsKey: string }>({ count: 0, firstAt: 0, colorsKey: '' });
  const markerRef = useRef<YGeoObject | null>(null);
  const routeRef = useRef<unknown>(null);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const [ready, setReady] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<string | null>(null);
  const [following, setFollowing] = useState(follow);
  const followRef = useRef(following);
  followRef.current = following;
  const navRef = useRef(navigation);
  navRef.current = navigation;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    loadYmaps()
      .then((ymaps) => {
        if (cancelled || !elRef.current) return;
        apiRef.current = ymaps;
        const last = fixRef.current;
        const map = new ymaps.Map(
          elRef.current,
          { center: last ? [last.lat, last.lon] : MOSCOW, zoom: last ? 16 : 11, controls: ['zoomControl'] },
          { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true }
        );
        // User gestures only (programmatic setCenter also fires 'actionbegin').
        for (const ev of ['mousedown', 'multitouchstart', 'wheel']) map.events.add(ev, () => setFollowing(false));
        map.events.add('click', (e) => {
          if (!navRef.current) return;
          const coords = e.get('coords');
          const from = fixRef.current;
          if (!Array.isArray(coords) || !from || !ymaps.route) {
            setRouteInfo(from ? 'Маршруты недоступны' : 'Нужна геопозиция, чтобы построить маршрут');
            return;
          }
          setRouteInfo('Строю маршрут…');
          ymaps
            .route([[from.lat, from.lon], coords as number[]], { mapStateAutoApply: true, routingMode: 'auto' })
            .then((route) => {
              if (routeRef.current) map.geoObjects.remove(routeRef.current);
              routeRef.current = route;
              map.geoObjects.add(route);
              const len = route.getHumanLength?.();
              const time = route.getHumanTime?.();
              setRouteInfo([len, time].filter(Boolean).join(' · ') || 'Маршрут построен');
            })
            .catch(() => setRouteInfo('Не удалось построить маршрут'));
        });
        mapRef.current = map;
        setReady(true);
      })
      .catch((e: Error) => !cancelled && setIssue(e.message));
    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      linesRef.current = [];
      markerRef.current = null;
      routeRef.current = null;
      drawnRef.current = { count: 0, firstAt: 0, colorsKey: '' };
    };
  }, []);

  // Incremental track drawing: only new points are added, polylines are extended in place.
  useEffect(() => {
    const map = mapRef.current;
    const ymaps = apiRef.current;
    if (!ready || !map || !ymaps) return;
    const colorsKey = colors.join() + thresholds.join();
    const d = drawnRef.current;
    const reset = points.length < d.count || (points[0]?.at ?? 0) !== d.firstAt || colorsKey !== d.colorsKey;
    if (reset) {
      linesRef.current.forEach((l) => map.geoObjects.remove(l.obj));
      linesRef.current = [];
      d.count = 0;
      d.firstAt = points[0]?.at ?? 0;
      d.colorsKey = colorsKey;
    }
    for (let i = Math.max(1, d.count); i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const color = speedColor(((a.speedKmh ?? 0) + (b.speedKmh ?? 0)) / 2, colors, thresholds);
      const last = linesRef.current[linesRef.current.length - 1];
      if (last && last.color === color) {
        last.coords.push([b.lat, b.lon]);
        last.obj.geometry.setCoordinates(last.coords);
      } else {
        const coords = [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ];
        const obj = new ymaps.Polyline(coords, {}, { strokeColor: color, strokeWidth: 6, strokeOpacity: 0.95 });
        map.geoObjects.add(obj);
        linesRef.current.push({ obj, color, coords });
      }
    }
    d.count = points.length;
  }, [points, colors, thresholds, ready]);

  // Fit a viewed trip.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !fitKey || points.length < 2) return;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    setFollowing(false);
    map.setBounds(
      [
        [minLat, minLon],
        [maxLat, maxLon],
      ],
      { checkZoomRange: true, zoomMargin: 30 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  // Current position marker + follow.
  useEffect(() => {
    const map = mapRef.current;
    const ymaps = apiRef.current;
    if (!ready || !map || !ymaps || !fix) return;
    const c = [fix.lat, fix.lon];
    if (!markerRef.current) {
      markerRef.current = new ymaps.Placemark(c, { hintContent: 'Вы здесь' }, { preset: 'islands#blueCircleDotIcon' });
      map.geoObjects.add(markerRef.current);
    } else markerRef.current.geometry.setCoordinates(c);
    if (followRef.current) map.setCenter(c, Math.max(map.getZoom(), 15), { duration: 300 });
  }, [fix, ready]);

  const clearRoute = () => {
    if (routeRef.current && mapRef.current) mapRef.current.geoObjects.remove(routeRef.current);
    routeRef.current = null;
    setRouteInfo(null);
  };

  return (
    <div className={`yandex-route-map relative overflow-hidden border border-[var(--line)] bg-[var(--surface-2)] ${className}`}>
      <div ref={elRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-[var(--fg-muted)]">
          {issue ?? 'Загрузка карты…'}
        </div>
      )}
      {ready && (
        <div className="absolute right-2 top-2 flex flex-col gap-2">
          <button
            type="button"
            className="icon-btn !bg-[var(--bg-elev)]"
            aria-label="Следовать за мной"
            aria-pressed={following}
            style={following ? { color: 'rgb(var(--accent-rgb))' } : undefined}
            onClick={() => {
              setFollowing(true);
              const f = fixRef.current;
              if (f) mapRef.current?.setCenter([f.lat, f.lon], 16, { duration: 300 });
            }}
          >
            <LocateFixed size={18} />
          </button>
        </div>
      )}
      {routeInfo && (
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-[12.5px] font-medium">
          <span className="flex min-w-0 items-center gap-2">
            <Navigation size={14} className="shrink-0 text-[rgb(var(--accent-rgb))]" />
            <span className="truncate">{routeInfo}</span>
          </span>
          <button type="button" className="icon-btn h-8 w-8" aria-label="Убрать маршрут" onClick={clearRoute}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
