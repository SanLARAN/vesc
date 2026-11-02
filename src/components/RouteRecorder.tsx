import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface RoutePoint {
  lat: number;
  lon: number;
  at: number;
  accuracy: number;
  speedKmh?: number;
}

interface RecordedTrip {
  id: string;
  points: RoutePoint[];
  distanceMeters: number;
  maxSpeedKmh: number;
  startedAt: number;
  endedAt: number;
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
const TRIPS_STORAGE_KEY = 'achilleus-trip-history-v1';
const SPEED_COLORS_STORAGE_KEY = 'achilleus-route-speed-colors-v1';
const DEFAULT_SPEED_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444'] as const;
type SpeedColorSet = [string, string, string, string];
const MAX_SAVED_TRIPS = 6;
const SCRIPT_ID = 'yandex-maps-api-v2';

function loadSavedSpeedColors(): SpeedColorSet {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPEED_COLORS_STORAGE_KEY) ?? 'null') as unknown;
    if (Array.isArray(parsed) && parsed.length === 4 && parsed.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
      return parsed as SpeedColorSet;
    }
  } catch {
    // Use the default speed palette when local storage is unavailable or invalid.
  }
  return [...DEFAULT_SPEED_COLORS];
}

function loadSavedTrips(): RecordedTrip[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRIPS_STORAGE_KEY) ?? '[]') as RecordedTrip[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((trip) => trip && typeof trip.id === 'string' && Array.isArray(trip.points))
      .slice(0, MAX_SAVED_TRIPS);
  } catch {
    return [];
  }
}

function tripIdFor(points: RoutePoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  return `${first?.at ?? 0}-${last?.at ?? 0}-${points.length}`;
}

function createRecordedTrip(routePoints: RoutePoint[]): RecordedTrip | null {
  if (routePoints.length < 2) return null;
  const savedPoints = routePoints.slice(-5000);
  return {
    id: tripIdFor(savedPoints),
    points: savedPoints,
    distanceMeters: savedPoints.slice(1).reduce((sum, point, index) => sum + distanceMeters(savedPoints[index], point), 0),
    maxSpeedKmh: savedPoints.reduce((max, point) => Math.max(max, point.speedKmh ?? 0), 0),
    startedAt: savedPoints[0].at,
    endedAt: savedPoints[savedPoints.length - 1].at,
  };
}

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

function formatDuration(startedAt: number, endedAt: number): string {
  const minutes = Math.max(0, Math.round((endedAt - startedAt) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`;
}

function speedColor(speedKmh: number, colors: SpeedColorSet): string {
  if (speedKmh >= 30) return colors[3];
  if (speedKmh >= 20) return colors[2];
  if (speedKmh >= 10) return colors[1];
  return colors[0];
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
  const [trips, setTrips] = useState<RecordedTrip[]>(loadSavedTrips);
  const [speedColors, setSpeedColors] = useState<SpeedColorSet>(loadSavedSpeedColors);
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

  const archiveTrip = (routePoints: RoutePoint[]) => {
    const trip = createRecordedTrip(routePoints);
    if (!trip) return;
    setTrips((previous) => previous.some((saved) => saved.id === trip.id)
      ? previous
      : [trip, ...previous].slice(0, MAX_SAVED_TRIPS));
  };

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
      const color = speedColor(segmentSpeed, speedColors);
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
  }, [points, mapStatus, speedColors]);

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

  useEffect(() => {
    try {
      localStorage.setItem(TRIPS_STORAGE_KEY, JSON.stringify(trips));
    } catch {
      setGpsIssue('Не удалось сохранить историю поездок: память браузера заполнена.');
    }
  }, [trips]);

  useEffect(() => {
    try { localStorage.setItem(SPEED_COLORS_STORAGE_KEY, JSON.stringify(speedColors)); } catch { /* keep current colors in this session */ }
  }, [speedColors]);

  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
    const unfinishedTrip = createRecordedTrip(pointsRef.current);
    if (!unfinishedTrip) return;
    try {
      const savedTrips = loadSavedTrips();
      if (!savedTrips.some((trip) => trip.id === unfinishedTrip.id)) {
        localStorage.setItem(TRIPS_STORAGE_KEY, JSON.stringify([unfinishedTrip, ...savedTrips].slice(0, MAX_SAVED_TRIPS)));
      }
    } catch {
      // Keep the in-progress route in ROUTE_STORAGE_KEY if history cannot be saved.
    }
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
    archiveTrip(pointsRef.current);
    try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
    pointsRef.current = [];
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
        archiveTrip(pointsRef.current);
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
    archiveTrip(pointsRef.current);
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setRecording(false);
    ignoreNextFixRef.current = false;
  };

  const exportPointsGpx = (routePoints: RoutePoint[], date = Date.now()) => {
    if (routePoints.length === 0) return;
    const track = routePoints.map((point) =>
      `<trkpt lat="${point.lat}" lon="${point.lon}"><time>${new Date(point.at).toISOString()}</time><extensions><speed>${(point.speedKmh ?? 0) / 3.6}</speed></extensions></trkpt>`
    ).join('');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Achilleus Onboard Computer" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Dualtron Achilleus</name><trkseg>${track}</trkseg></trk></gpx>`;
    const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `achilleus-route-${new Date(date).toISOString().slice(0, 10)}.gpx`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportGpx = () => exportPointsGpx(points);

  const clearCurrentRoute = () => {
    if (!window.confirm('Удалить текущую запись маршрута? Сохранённые поездки в истории останутся.')) return;
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    ignoreNextFixRef.current = false;
    setRecording(false);
    pointsRef.current = [];
    setPoints([]);
    setGpsAccuracy(null);
    if (navigationRouteRef.current) mapRef.current?.geoObjects.remove(navigationRouteRef.current);
    navigationRouteRef.current = null;
    try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
  };

  const showTrip = (trip: RecordedTrip) => {
    if (recording) stopRecording();
    pointsRef.current = trip.points;
    setPoints(trip.points);
    try { localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(trip.points)); } catch { /* ignore unavailable storage */ }
    if (trip.points.length < 2) {
      const point = trip.points[0];
      if (point) mapRef.current?.setCenter([point.lat, point.lon], 16, { duration: 250 });
      return;
    }
    const latitudes = trip.points.map((point) => point.lat);
    const longitudes = trip.points.map((point) => point.lon);
    mapRef.current?.setBounds([
      [Math.min(...latitudes), Math.min(...longitudes)],
      [Math.max(...latitudes), Math.max(...longitudes)],
    ], { checkZoomRange: true, zoomMargin: 24 });
  };

  const deleteTrip = (tripId: string) => {
    setTrips((previous) => previous.filter((trip) => trip.id !== tripId));
    if (pointsRef.current.length > 0 && tripIdFor(pointsRef.current) === tripId) {
      pointsRef.current = [];
      setPoints([]);
      try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
    }
  };

  const clearTripHistory = () => {
    if (!window.confirm('Удалить всю историю поездок? Текущая запись маршрута останется.')) return;
    setTrips([]);
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
          <button type="button" onClick={clearCurrentRoute} disabled={points.length === 0 && !recording} aria-label="Очистить текущую запись маршрута" title="Очистить текущую запись маршрута" className={`route-control border border-[var(--line-strong)] ${hudCompact ? 'px-1.5 py-1 text-[7px]' : 'px-3 py-2 text-[10px]'} font-bold uppercase disabled:opacity-40`}>
            {hudCompact ? '×' : 'ОЧИСТИТЬ'}
          </button>
        </div>
      </div>
      <div className={`flex items-center justify-between gap-1 border-b border-[var(--line)] ${hudCompact ? 'px-1 py-1 text-[6px]' : 'px-3 py-1.5 text-[9px]'}`} aria-label="Настройка цветов скорости на маршруте">
        <span className="shrink-0 font-bold text-[var(--fg-muted)]">КМ/Ч</span>
        <div className="flex min-w-0 items-center gap-1">
          {(['0–10', '10–20', '20–30', '30+'] as const).map((range, index) => (
            <label key={range} title={`Изменить цвет ${range} км/ч`} className="relative inline-flex min-w-0 cursor-pointer items-center gap-0.5">
              <span className="block h-1.5 w-2.5 shrink-0 rounded-[1px]" style={{ backgroundColor: speedColors[index] }} />
              <span>{range}</span>
              <input
                type="color"
                value={speedColors[index]}
                aria-label={`Цвет маршрута при скорости ${range} км/ч`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(event) => setSpeedColors((current) => current.map((color, colorIndex) => colorIndex === index ? event.target.value : color) as SpeedColorSet)}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSpeedColors([...DEFAULT_SPEED_COLORS])}
          aria-label="Сбросить цвета карты"
          title="Сбросить цвета карты"
          className="route-control shrink-0 border border-[var(--line-strong)] px-1 py-0.5 text-[8px] font-bold"
        >↺</button>
      </div>
      {!apiKey ? (
        <div className={`flex items-center justify-center px-2 text-center text-[8px] text-[var(--fg-muted)] ${hudCompact ? 'min-h-0 flex-1' : 'h-32 px-4 text-xs'}`}>
          Карта недоступна без ключа API; GPS-запись доступна, но точки не будут показаны на карте.
        </div>
      ) : (
        <div ref={mapElementRef} className={`yandex-route-map w-full ${hudCompact ? 'min-h-0 flex-1' : 'h-64 sm:h-80'}`} aria-label="Карта и GPS-маршрут" />
      )}
      <div className={`border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--fg-muted)] ${hudCompact ? 'hidden' : ''}`}>
        Текущая запись и история хранятся в этом браузере. При очистке маршрута сохранённые поездки остаются в истории.
      </div>
      <details className={`border-t border-[var(--line)] ${hudCompact ? 'shrink-0' : ''}`}>
        <summary className={`cursor-pointer select-none font-bold tracking-wider ${hudCompact ? 'px-2 py-1.5 text-[8px]' : 'px-3 py-2 text-[10px]'}`}>
          ИСТОРИЯ ПОЕЗДОК • {trips.length}
        </summary>
        <div className={`space-y-1 overflow-y-auto px-2 pb-2 ${hudCompact ? 'max-h-28' : 'max-h-72'}`}>
          {trips.length === 0 ? (
            <div className="py-2 text-[9px] text-[var(--fg-muted)]">Остановите запись, чтобы сохранить поездку в истории.</div>
          ) : trips.map((trip) => (
            <article key={trip.id} className="flex flex-wrap items-center justify-between gap-1 border border-[var(--line)] px-2 py-1.5">
              <div className="min-w-0 text-[8px] leading-relaxed sm:text-[10px]">
                <div className="font-bold">{new Date(trip.startedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                <div className="text-[var(--fg-muted)]">
                  {formatDistance(trip.distanceMeters)} • {formatDuration(trip.startedAt, trip.endedAt)} • макс. {Math.round(trip.maxSpeedKmh)} км/ч
                </div>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => showTrip(trip)} className="route-control border border-[var(--line-strong)] px-1.5 py-1 text-[7px] font-bold uppercase">ПОКАЗАТЬ</button>
                <button type="button" onClick={() => exportPointsGpx(trip.points, trip.startedAt)} className="route-control border border-[var(--line-strong)] px-1.5 py-1 text-[7px] font-bold uppercase">GPX</button>
                <button type="button" onClick={() => deleteTrip(trip.id)} aria-label="Удалить поездку" className="route-control border border-[var(--line-strong)] px-1.5 py-1 text-[7px] font-bold uppercase">УДАЛИТЬ</button>
              </div>
            </article>
          ))}
          {trips.length > 0 && (
            <button type="button" onClick={clearTripHistory} className="route-control border border-[var(--line-strong)] px-2 py-1 text-[8px] font-bold uppercase">
              ОЧИСТИТЬ ИСТОРИЮ
            </button>
          )}
        </div>
      </details>
    </section>
  );
};
