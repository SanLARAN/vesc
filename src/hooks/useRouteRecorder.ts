import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GeoFix, haversineM } from './useGeolocation';

export interface RoutePoint {
  lat: number;
  lon: number;
  at: number;
  accuracy: number;
  speedKmh?: number;
  powerKw?: number;
  ele?: number;
}

export interface RecordedTrip {
  id: string;
  points: RoutePoint[];
  distanceMeters: number;
  maxSpeedKmh: number;
  startedAt: number;
  endedAt: number;
  averageSpeedKmh: number;
  energyWh: number | null;
  consumptionWhPerKm: number | null;
}

export type SpeedColorSet = [string, string, string, string];
export type SpeedThresholdSet = [number, number, number];

const ROUTE_KEY = 'achilleus-yandex-route-v1';
const ROUTE_REC_KEY = 'achilleus-route-recording-v1';
const TRIPS_KEY = 'achilleus-trip-history-v1';
const COLORS_KEY = 'achilleus-route-speed-colors-v1';
const THRESHOLDS_KEY = 'achilleus-route-speed-thresholds-v1';
export const DEFAULT_SPEED_COLORS: SpeedColorSet = ['#22c55e', '#eab308', '#f97316', '#ef4444'];
export const DEFAULT_SPEED_THRESHOLDS: SpeedThresholdSet = [15, 30, 50];
const MAX_TRIPS = 12;
const MAX_POINTS = 6000;

function load<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
    return valid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function tripAnalytics(points: RoutePoint[]) {
  let distance = 0;
  let energyWh = 0;
  let hasPower = false;
  let maxSpeed = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    distance += haversineM(a, b);
    const dt = (b.at - a.at) / 1000;
    if (dt > 0 && dt < 60 && a.powerKw !== undefined && b.powerKw !== undefined) {
      energyWh += (((a.powerKw + b.powerKw) / 2) * 1000 * dt) / 3600;
      hasPower = true;
    }
  }
  for (const p of points) maxSpeed = Math.max(maxSpeed, p.speedKmh ?? 0);
  const elapsedMs = points.length > 1 ? points[points.length - 1].at - points[0].at : 0;
  const km = distance / 1000;
  const net = hasPower ? Math.max(0, energyWh) : null;
  return {
    distanceMeters: distance,
    maxSpeedKmh: maxSpeed,
    averageSpeedKmh: elapsedMs > 0 ? km / (elapsedMs / 3600000) : 0,
    energyWh: net,
    consumptionWhPerKm: net !== null && km > 0.1 ? net / km : null,
  };
}

function makeTrip(points: RoutePoint[]): RecordedTrip | null {
  if (points.length < 2) return null;
  const pts = points.slice(-MAX_POINTS);
  return {
    id: `${pts[0].at}-${pts[pts.length - 1].at}-${pts.length}`,
    points: pts,
    ...tripAnalytics(pts),
    startedAt: pts[0].at,
    endedAt: pts[pts.length - 1].at,
  };
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function exportGpx(points: RoutePoint[], date = Date.now()) {
  if (points.length === 0) return;
  const pts = points
    .map(
      (p) =>
        `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.ele !== undefined ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}` +
        `<time>${new Date(p.at).toISOString()}</time>` +
        `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${((p.speedKmh ?? 0) / 3.6).toFixed(2)}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions></trkpt>`
    )
    .join('\n');
  const name = escapeXml(`Dualtron Achilleus ${new Date(date).toLocaleString('ru-RU')}`);
  const gpx =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="VESC Achilleus Dash" xmlns="http://www.topografix.com/GPX/1/1" ` +
    `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">\n` +
    `<metadata><name>${name}</name><time>${new Date(date).toISOString()}</time></metadata>\n` +
    `<trk><name>${name}</name><type>e-scooter</type><trkseg>\n${pts}\n</trkseg></trk></gpx>\n`;
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `achilleus-${new Date(date).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately breaks downloads on iOS / some Android browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const isPoints = (v: unknown) => Array.isArray(v);

export function useRouteRecorder(fix: GeoFix | null, live: { speedKmh?: number; powerKw?: number }) {
  const [points, setPoints] = useState<RoutePoint[]>(() => load<RoutePoint[]>(ROUTE_KEY, [], isPoints).slice(-MAX_POINTS));
  const [trips, setTrips] = useState<RecordedTrip[]>(() =>
    load<RecordedTrip[]>(TRIPS_KEY, [], isPoints)
      .filter((t) => t && typeof t.id === 'string' && Array.isArray(t.points))
      .slice(0, MAX_TRIPS)
  );
  const [recording, setRecording] = useState<boolean>(() => load<boolean>(ROUTE_REC_KEY, false, (v) => typeof v === 'boolean'));
  const [viewingTripId, setViewingTripId] = useState<string | null>(null);
  const [colors, setColors] = useState<SpeedColorSet>(() =>
    load<SpeedColorSet>(COLORS_KEY, [...DEFAULT_SPEED_COLORS] as SpeedColorSet, (v) => Array.isArray(v) && v.length === 4)
  );
  const [thresholds, setThresholds] = useState<SpeedThresholdSet>(() =>
    load<SpeedThresholdSet>(
      THRESHOLDS_KEY,
      [...DEFAULT_SPEED_THRESHOLDS] as SpeedThresholdSet,
      (v) => Array.isArray(v) && v.length === 3 && v[0] < v[1] && v[1] < v[2]
    )
  );
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const liveRef = useRef(live);
  liveRef.current = live;
  const lastFixAt = useRef(0);

  // Append GPS fixes while recording.
  useEffect(() => {
    if (!recording || !fix || fix.at === lastFixAt.current) return;
    lastFixAt.current = fix.at;
    if (fix.accuracy > 60) return;
    const last = pointsRef.current[pointsRef.current.length - 1];
    if (last && haversineM(last, fix) < 4) return;
    const l = liveRef.current;
    const point: RoutePoint = {
      lat: fix.lat,
      lon: fix.lon,
      at: fix.at,
      accuracy: fix.accuracy,
      speedKmh: l.speedKmh !== undefined && Number.isFinite(l.speedKmh) ? Math.abs(l.speedKmh) : (fix.speedKmh ?? 0),
      powerKw: l.powerKw !== undefined && Number.isFinite(l.powerKw) ? l.powerKw : undefined,
      ele: fix.altitude ?? undefined,
    };
    setPoints((prev) => [...prev, point].slice(-MAX_POINTS));
  }, [fix, recording]);

  // Throttled persistence of the live route.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!save(ROUTE_KEY, points)) setStorageIssue('Память браузера заполнена — маршрут не сохраняется.');
    }, 1500);
    return () => window.clearTimeout(id);
  }, [points]);

  useEffect(() => {
    if (!save(TRIPS_KEY, trips)) setStorageIssue('Не удалось сохранить историю поездок: память заполнена.');
  }, [trips]);
  useEffect(() => void save(ROUTE_REC_KEY, recording), [recording]);
  useEffect(() => void save(COLORS_KEY, colors), [colors]);
  useEffect(() => void save(THRESHOLDS_KEY, thresholds), [thresholds]);

  useEffect(() => {
    const flush = () => save(ROUTE_KEY, pointsRef.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const archive = useCallback((pts: RoutePoint[]) => {
    const trip = makeTrip(pts);
    if (!trip) return;
    setTrips((prev) => (prev.some((t) => t.id === trip.id) ? prev : [trip, ...prev].slice(0, MAX_TRIPS)));
  }, []);

  const start = useCallback(() => {
    if (viewingTripId === null) archive(pointsRef.current);
    setViewingTripId(null);
    setPoints([]);
    setRecording(true);
  }, [archive, viewingTripId]);

  const stop = useCallback(() => {
    archive(pointsRef.current);
    setRecording(false);
  }, [archive]);

  const clear = useCallback(() => {
    setRecording(false);
    setViewingTripId(null);
    setPoints([]);
  }, []);

  const showTrip = useCallback(
    (trip: RecordedTrip) => {
      if (recording) archive(pointsRef.current);
      setRecording(false);
      setViewingTripId(trip.id);
      setPoints(trip.points);
    },
    [archive, recording]
  );

  const deleteTrip = useCallback((id: string) => {
    setTrips((prev) => prev.filter((t) => t.id !== id));
    setViewingTripId((v) => {
      if (v === id) setPoints([]);
      return v === id ? null : v;
    });
  }, []);

  const clearHistory = useCallback(() => setTrips([]), []);

  const analytics = useMemo(() => tripAnalytics(points), [points]);

  return {
    points,
    trips,
    recording,
    viewingTripId,
    analytics,
    colors,
    thresholds,
    storageIssue,
    setColors,
    setThresholds,
    start,
    stop,
    clear,
    showTrip,
    deleteTrip,
    clearHistory,
  };
}

export type RouteRecorderApi = ReturnType<typeof useRouteRecorder>;
