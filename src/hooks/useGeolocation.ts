import { useEffect, useRef, useState } from 'react';

export interface GeoFix {
  lat: number;
  lon: number;
  accuracy: number;
  speedKmh: number | null;
  altitude: number | null;
  heading: number | null;
  at: number;
}

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export { haversineM };

/** One shared GPS watcher for speed, route recording and wheel calibration. */
export function useGeolocation(enabled: boolean) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const prevRef = useRef<GeoFix | null>(null);

  useEffect(() => {
    if (!enabled) {
      setFix(null);
      setIssue(null);
      prevRef.current = null;
      return;
    }
    if (!('geolocation' in navigator)) {
      setIssue('GPS недоступен в этом браузере.');
      return;
    }
    if (!window.isSecureContext) {
      setIssue('GPS работает только на HTTPS-странице.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy, speed, altitude, heading } = pos.coords;
        const at = pos.timestamp || Date.now();
        let speedKmh: number | null = speed !== null && Number.isFinite(speed) ? Math.max(0, speed * 3.6) : null;
        const prev = prevRef.current;
        if (speedKmh === null && prev) {
          const dtS = (at - prev.at) / 1000;
          if (dtS > 0.4) speedKmh = (haversineM(prev, { lat, lon }) / dtS) * 3.6;
        }
        if (speedKmh !== null && prev?.speedKmh != null && Math.abs(speedKmh - prev.speedKmh) < 25) {
          speedKmh = prev.speedKmh * 0.35 + speedKmh * 0.65;
        }
        const next: GeoFix = {
          lat,
          lon,
          accuracy,
          speedKmh,
          altitude: altitude ?? null,
          heading: heading !== null && Number.isFinite(heading) ? heading : null,
          at,
        };
        prevRef.current = next;
        setFix(next);
        setIssue(accuracy > 60 ? `Слабый GPS: точность ±${Math.round(accuracy)} м.` : null);
      },
      (error) => {
        setIssue(
          error.code === error.PERMISSION_DENIED
            ? 'Доступ к геопозиции запрещён — разрешите его для сайта.'
            : error.code === error.TIMEOUT
              ? 'GPS не отвечает. Проверьте сигнал.'
              : 'Не удалось получить GPS-позицию.'
        );
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { fix, issue };
}
