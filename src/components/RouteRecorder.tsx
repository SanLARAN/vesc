import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface RoutePoint {
  lat: number;
  lon: number;
  at: number;
  accuracy: number;
  speedKmh?: number;
}

interface YandexMapApi {
  ready(callback: () => void): void;
  route?: (points: number[][], options?: object) => Promise<unknown>;
  Map: new (element: HTMLElement, state: { center: number[]; zoom: number }, options?: object) => {
    geoObjects: { add(object: unknown): void; remove(object: unknown): void };
    events: { add(type: string, listener: (event: { get(name: string): unknown }) => void): void };
    setCenter(center: number[], zoom?: number, options?: object): void;
    setBounds(bounds: number[][], options?: object): void;
    destroy(): void;
  };
  Polyline: new (coords: number[][], properties?: object, options?: object) => {
    geometry: { setCoordinates(coords: number[][]): void; getBounds(): number[][] };
  };
  Placemark: new (coords: number[], properties?: object, options?: object) => {
    geometry: { setCoordinates(coords: number[]): void };
  };
}

declare global {
  interface Window {
    ymaps?: YandexMapApi;
  }
}

const ROUTE_STORAGE_KEY = 'achilleus-yandex-route-v1';
const SCRIPT_ID = 'yandex-maps-api-v2';

function loadSavedRoute(): RoutePoint[] {
  try {
    const data = localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data) as RoutePoint[];
    return Array.isArray(parsed) ? parsed.slice(-5000) : [];
  } catch {
    return [];
  }
}

function distanceMeters(a: RoutePoint, b: RoutePoint): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} км` : `${Math.round(meters)} м`;
}

function speedColor(speedKmh: number): string {
  if (speedKmh >= 30) return '#ef4444';
  if (speedKmh >= 20) return '#f97316';
  if (speedKmh >= 10) return '#eab308';
  return '#22c55e';
}

export const RouteRecorder: React.FC<{
  apiKey: string;
  onIssue: (message: string | null) => void;
  hudCompact?: boolean;
  speedKmh?: number;
}> = ({ apiKey, onIssue, hudCompact = false, speedKmh }) => {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<InstanceType<YandexMapApi['Map']> | null>(null);
  const lineRefs = useRef<InstanceType<YandexMapApi['Polyline']>[]>([]);
  const markerRef = useRef<InstanceType<YandexMapApi['Placemark']> | null>(null);
  const navigationRouteRef = useRef<unknown>(null);
  const currentPositionRef = useRef<{ lat: number; lon: number } | null>(null);
  const currentSpeedRef = useRef(speedKmh);
  currentSpeedRef.current = speedKmh;
  const watchIdRef = useRef<number | null>(null);
  const ignoreNextFixRef = useRef(false);
  const pointsRef = useRef<RoutePoint[]>([]);
  const [points, setPoints] = useState<RoutePoint[]>(loadSavedRoute);
  pointsRef.current = points;
  const [recording, setRecording] = useState(false);
  const [mapStatus, setMapStatus] = useState('Загрузка карты…');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [mapIssue, setMapIssue] = useState<string | null>(null);
  const [gpsIssue, setGpsIssue] = useState<string | null>(null);

  useEffect(() => { onIssue(gpsIssue ?? mapIssue); }, [gpsIssue, mapIssue, onIssue]);

  const distance = useMemo(
    () => points.slice(1).reduce((sum, point, index) => sum + distanceMeters(points[index], point), 0),
    [points]
  );
  const maxRecordedSpeed = useMemo(
    () => points.reduce((max, point) => Math.max(max, point.speedKmh ?? 0), 0),
    [points]
  );

  const buildNavigationRoute = (destination: number[]) => {
    const current = currentPositionRef.current;
    const map = mapRef.current;
    const ymaps = window.ymaps;
    if (!current) {
      setGpsIssue('Для построения маршрута сначала нажмите «Начать запись» и разрешите геолокацию.');
      return;
    }
    if (!map || !ymaps?.route) {
      setGpsIssue('Построение маршрута сейчас недоступно.');
      return;
    }
    setGpsIssue(null);
    setMapStatus('Строю маршрут…');
    void ymaps.route([[current.lat, current.lon], destination], { mapStateAutoApply: false })
      .then((route) => {
        if (navigationRouteRef.current) map.geoObjects.remove(navigationRouteRef.current);
        navigationRouteRef.current = route;
        map.geoObjects.add(route);
        setMapStatus('Маршрут построен • выберите другую точку касанием');
      })
      .catch(() => {
        setMapStatus('Не удалось построить маршрут');
        setGpsIssue('Яндекс Карты не смогли построить маршрут до выбранной точки. Попробуйте другую точку.');
      });
  };

  useEffect(() => {
    if (!apiKey) {
      setMapStatus('Не настроен ключ Яндекс Карт');
      setMapIssue('Маршрут: ключ Яндекс Карт не настроен.');
      return;
    }

    let cancelled = false;
    const initializeMap = () => {
      if (cancelled || !mapElementRef.current || !window.ymaps || mapRef.current) return;
      window.ymaps.ready(() => {
        if (cancelled || !mapElementRef.current || !window.ymaps) return;
        const initial = pointsRef.current.at(-1);
        try {
          mapRef.current = new window.ymaps.Map(
            mapElementRef.current,
            { center: initial ? [initial.lat, initial.lon] : [52.37, 4.90], zoom: initial ? 15 : 11 },
            { controls: ['zoomControl', 'typeSelector'], suppressMapOpenBlock: true }
          );
          mapRef.current.events.add('click', (event) => {
            const coords = event.get('coords');
            if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
              buildNavigationRoute([coords[0], coords[1]]);
            }
          });
          setMapStatus('Карта готова • нажмите на место назначения');
          setMapIssue(null);
        } catch (error) {
          setMapStatus('Не удалось создать карту');
          setMapIssue(`Маршрут: ${error instanceof Error ? error.message : 'ошибка Яндекс Карт'}`);
        }
      });
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (window.ymaps) {
      initializeMap();
    } else if (existing) {
      existing.addEventListener('load', initializeMap, { once: true });
      existing.addEventListener('error', () => {
        if (!cancelled) {
          setMapStatus('Ошибка загрузки Яндекс Карт');
          setMapIssue('Маршрут: не удалось загрузить Яндекс Карты. Проверьте интернет и API-ключ.');
        }
      }, { once: true });
    } else {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
      script.async = true;
      script.onload = initializeMap;
      script.onerror = () => {
        if (!cancelled) {
          setMapStatus('Ошибка загрузки Яндекс Карт');
          setMapIssue('Маршрут: не удалось загрузить Яндекс Карты. Проверьте интернет и API-ключ.');
        }
      };
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      lineRefs.current = [];
      markerRef.current = null;
      navigationRouteRef.current = null;
    };
  }, [apiKey]);

  // Draw saved/new GPS positions on the Yandex map.
  useEffect(() => {
    const map = mapRef.current;
    const ymaps = window.ymaps;
    if (!map || !ymaps) return;
    lineRefs.current.forEach((line) => map.geoObjects.remove(line));
    lineRefs.current = [];
    if (points.length === 0) {
      if (markerRef.current) map.geoObjects.remove(markerRef.current);
      markerRef.current = null;
      return;
    }
    const coords = points.map((point) => [point.lat, point.lon]);
    const runs: { coords: number[][]; color: string; speed: number }[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const segmentSpeed = ((previous.speedKmh ?? 0) + (current.speedKmh ?? 0)) / 2;
      const color = speedColor(segmentSpeed);
      const activeRun = runs[runs.length - 1];
      if (activeRun?.color === color) {
        activeRun.coords.push([current.lat, current.lon]);
        activeRun.speed = segmentSpeed;
      } else {
        runs.push({ coords: [[previous.lat, previous.lon], [current.lat, current.lon]], color, speed: segmentSpeed });
      }
    }
    runs.forEach((run) => {
      const line = new ymaps.Polyline(
        run.coords,
        { hintContent: `Скорость около ${Math.round(run.speed)} км/ч` },
        { strokeColor: run.color, strokeWidth: 6, opacity: 0.95 }
      );
      lineRefs.current.push(line);
      map.geoObjects.add(line);
    });
    const latest = coords[coords.length - 1];
    if (!markerRef.current) {
      markerRef.current = new ymaps.Placemark(latest, { hintContent: 'Последняя точка' }, {
        preset: 'islands#blackCircleDotIcon',
      });
      map.geoObjects.add(markerRef.current);
    } else {
      markerRef.current.geometry.setCoordinates(latest);
    }
  }, [points, mapStatus]);

  useEffect(() => {
    const persist = () => {
      try {
        localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(points.slice(-5000)));
      } catch {
        setGpsIssue('Маршрут: не удалось сохранить точки в памяти телефона.');
      }
    };
    if (points.length > 0) persist();
  }, [points]);

  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
  }, []);

  const startRecording = () => {
    if (!('geolocation' in navigator)) {
      setGpsIssue('GPS недоступен в этом браузере. Разрешите геолокацию или используйте другой браузер.');
      return;
    }
    if (!window.isSecureContext) {
      setGpsIssue('GPS доступен только на защищённой HTTPS-странице.');
      return;
    }
    setGpsIssue(null);
    ignoreNextFixRef.current = true;
    try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
    setPoints([]);
    setGpsAccuracy(null);
    setRecording(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const at = position.timestamp || Date.now();
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const previousPoint = pointsRef.current.at(-1);
        const elapsedSeconds = previousPoint ? (at - previousPoint.at) / 1000 : 0;
        const derivedSpeed = previousPoint && elapsedSeconds > 0
          ? distanceMeters(previousPoint, { lat, lon, at, accuracy: position.coords.accuracy }) / elapsedSeconds * 3.6
          : null;
        const gpsSpeed = position.coords.speed !== null && Number.isFinite(position.coords.speed)
          ? Math.max(0, position.coords.speed * 3.6)
          : derivedSpeed;
        const vescSpeed = currentSpeedRef.current;
        const point: RoutePoint = {
          lat,
          lon,
          at,
          accuracy: position.coords.accuracy,
          speedKmh: Number.isFinite(vescSpeed) ? Math.abs(vescSpeed ?? 0) : Math.max(0, gpsSpeed ?? 0),
        };
        setGpsAccuracy(point.accuracy);
        if (point.accuracy > 60) {
          setGpsIssue(`GPS неточный: погрешность около ${Math.round(point.accuracy)} м. Ожидаю лучший сигнал.`);
          return;
        }
        currentPositionRef.current = { lat: point.lat, lon: point.lon };
        setGpsIssue(null);
        if (ignoreNextFixRef.current) {
          ignoreNextFixRef.current = false;
          setPoints([point]);
          mapRef.current?.setCenter([point.lat, point.lon], 16, { duration: 250 });
          return;
        }
        const last = pointsRef.current.at(-1);
        if (last && distanceMeters(last, point) < 4) return;
        mapRef.current?.setCenter([point.lat, point.lon], 16, { duration: 250 });
        setPoints((previous) => [...previous, point].slice(-5000));
      },
      (error) => {
        setRecording(false);
        if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
        const message = error.code === error.PERMISSION_DENIED
          ? 'GPS запрещён. Разрешите сайту доступ к геопозиции в настройках браузера.'
          : error.code === error.TIMEOUT
          ? 'GPS не ответил вовремя. Проверьте сигнал и повторите запись.'
          : 'Не удалось получить GPS-позицию телефона.';
        setGpsIssue(message);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  };

  const stopRecording = () => {
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setRecording(false);
    ignoreNextFixRef.current = false;
  };

  const exportGpx = () => {
    if (points.length === 0) return;
    const track = points.map((point) =>
      `<trkpt lat="${point.lat}" lon="${point.lon}"><time>${new Date(point.at).toISOString()}</time><extensions><speed>${(point.speedKmh ?? 0) / 3.6}</speed></extensions></trkpt>`
    ).join('');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Achilleus Onboard Computer" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Dualtron Achilleus</name><trkseg>${track}</trkseg></trk></gpx>`;
    const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `achilleus-route-${new Date().toISOString().slice(0, 10)}.gpx`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={`overflow-hidden border border-[var(--line)] bg-[var(--bg-surface)] ${hudCompact ? 'flex h-full min-h-0 flex-col' : ''}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] ${hudCompact ? 'px-2 py-1.5' : 'px-3 py-2.5'}`}>
        <div className="min-w-0">
          <h2 className={`${hudCompact ? 'text-[8px]' : 'text-xs'} font-bold tracking-[0.14em] uppercase`}>МАРШРУТ • ЯНДЕКС</h2>
          <p className={`mt-0.5 truncate ${hudCompact ? 'text-[7px]' : 'mt-1 text-[10px]'} text-[var(--fg-muted)]`}>
            {mapStatus} • {points.length} точек • {formatDistance(distance)} • макс. {Math.round(maxRecordedSpeed)} км/ч
            {gpsAccuracy !== null ? ` • GPS ±${Math.round(gpsAccuracy)}м` : ''}
          </p>
        </div>
        <div className="flex gap-1">
          {!recording ? (
            <button type="button" onClick={startRecording} className={`route-control border border-[var(--fg)] bg-[var(--inv-bg)] ${hudCompact ? 'px-1.5 py-1 text-[7px]' : 'px-3 py-2 text-[10px]'} font-bold uppercase text-[var(--inv-fg)]`}>
              НАЧАТЬ ЗАПИСЬ
            </button>
          ) : (
            <button type="button" onClick={stopRecording} className={`route-control border border-[var(--fg)] bg-[var(--inv-bg)] ${hudCompact ? 'px-1.5 py-1 text-[7px]' : 'px-3 py-2 text-[10px]'} font-bold uppercase text-[var(--inv-fg)]`}>
              ОСТАНОВИТЬ
            </button>
          )}
          <button type="button" onClick={exportGpx} disabled={points.length === 0} className={`route-control border border-[var(--line-strong)] ${hudCompact ? 'px-1.5 py-1 text-[7px]' : 'px-3 py-2 text-[10px]'} font-bold uppercase disabled:opacity-40`}>
            GPX
          </button>
        </div>
      </div>
      <div className={`flex items-center justify-between gap-1 border-b border-[var(--line)] ${hudCompact ? 'px-1 py-1 text-[6px]' : 'px-3 py-1.5 text-[9px]'}`} aria-label="Цвет маршрута по скорости">
        <span className="shrink-0 font-bold text-[var(--fg-muted)]">КМ/Ч</span>
        <span className="flex items-center gap-0.5 text-green-500"><i className="block h-1.5 w-2 bg-green-500" />0–10</span>
        <span className="flex items-center gap-0.5 text-yellow-500"><i className="block h-1.5 w-2 bg-yellow-500" />10–20</span>
        <span className="flex items-center gap-0.5 text-orange-500"><i className="block h-1.5 w-2 bg-orange-500" />20–30</span>
        <span className="flex items-center gap-0.5 text-red-500"><i className="block h-1.5 w-2 bg-red-500" />30+</span>
      </div>
      {!apiKey ? (
        <div className={`flex items-center justify-center px-2 text-center text-[8px] text-[var(--fg-muted)] ${hudCompact ? 'min-h-0 flex-1' : 'h-32 px-4 text-xs'}`}>
          Карта недоступна без ключа API; GPS-запись доступна, но точки не будут показаны на карте.
        </div>
      ) : (
        <div ref={mapElementRef} className={`yandex-route-map w-full ${hudCompact ? 'min-h-0 flex-1' : 'h-64 sm:h-80'}`} aria-label="Карта и GPS-маршрут" />
      )}
      <div className={`border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--fg-muted)] ${hudCompact ? 'hidden' : ''}`}>
        Точки маршрута сохраняются только в памяти этого браузера; для отображения карта запрашивает тайлы у Яндекса. Экспорт GPX сохраняет копию на телефон.
      </div>
    </section>
  );
};
