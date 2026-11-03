import { useEffect, useState } from 'react';
import { ArrowLeft, Map as MapIcon, TriangleAlert } from 'lucide-react';
import type { GeoFix } from '../hooks/useGeolocation';
import type { RouteRecorderApi } from '../hooks/useRouteRecorder';
import type { RideSnapshot } from '../state/rideEngine';
import type { OnboardComputerConfig } from '../state/dashboardConfig';
import { RouteMap } from './RouteMap';
import { Speedometer } from './Speedometer';
import { fmt, Tone, toneColor } from './ui';

export interface DashAlert {
  id: string;
  level: 'warn' | 'bad';
  text: string;
}

interface Props {
  snap: RideSnapshot;
  cfg: OnboardComputerConfig;
  capKmh: number | null;
  modeLabel: string;
  powerScaleW: number;
  alerts: DashAlert[];
  recorder: RouteRecorderApi;
  fix: GeoFix | null;
  onExit: () => void;
}

function Tile({ label, value, unit, tone = 'default' }: { label: string; value: string; unit?: string; tone?: Tone }) {
  return (
    <div className="card flex flex-col justify-center rounded-[20px] px-4 py-3">
      <div className="label">{label}</div>
      <div className="num mt-1 text-[clamp(22px,4.6vh,36px)] font-semibold leading-none tracking-tight" style={{ color: toneColor(tone) }}>
        {value}
        {unit && <span className="ml-1 text-[12px] font-semibold text-[var(--fg-faint)]">{unit}</span>}
      </div>
    </div>
  );
}

const NO_POINTS: never[] = [];

export function HudView({ snap, cfg, capKmh, modeLabel, powerScaleW, alerts, recorder, fix, onExit }: Props) {
  const [showMap, setShowMap] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);

  // Fullscreen + landscape while the HUD is open (best effort; needs a user gesture on most browsers).
  useEffect(() => {
    const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
    el.requestFullscreen?.().catch(() => undefined);
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    orientation?.lock?.('landscape').catch(() => undefined);
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      screen.orientation?.unlock?.();
    };
  }, []);

  const soc = snap.battery.socPct;
  const socTone: Tone = soc === null ? 'muted' : soc < 15 ? 'bad' : soc < 30 ? 'warn' : 'default';
  const temp = Math.max(snap.tempFetMax, snap.tempMotorMax);
  const tempTone: Tone = snap.tempMotorMax >= cfg.motorWarnTempC || snap.tempFetMax >= cfg.fetWarnTempC ? 'warn' : 'default';
  const top = alerts[0];

  return (
    <div className="app-bg fixed inset-0 z-40 flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <button type="button" className="icon-btn" aria-label="Выйти из HUD" onClick={onExit}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="chip chip-accent">{modeLabel}</span>
          {cfg.limiterOn && <span className="chip chip-bad num">LIM {cfg.limiterKmh}</span>}
          {snap.fwActive && <span className="chip chip-warn num">FW {Math.round(snap.fwA)} А</span>}
          {recorder.recording && <span className="chip chip-bad">REC</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-[15px] font-semibold">{clock.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
          <button type="button" className="icon-btn" aria-label="Карта" aria-pressed={showMap} onClick={() => setShowMap(!showMap)} style={showMap ? { color: 'rgb(var(--accent-rgb))' } : undefined}>
            <MapIcon size={18} />
          </button>
        </div>
      </div>

      {top && (
        <div
          className={`mx-4 mb-1 flex items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-semibold ${top.level === 'bad' ? 'pulse-bad' : ''}`}
          style={{ background: `color-mix(in srgb, ${top.level === 'bad' ? 'var(--bad)' : 'var(--warn)'} 18%, transparent)`, color: top.level === 'bad' ? 'var(--bad)' : 'var(--warn)' }}
        >
          <TriangleAlert size={16} /> {top.text}
          {alerts.length > 1 && <span className="ml-auto text-[11px] opacity-70">+{alerts.length - 1}</span>}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-3 landscape:flex-row landscape:items-stretch">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="w-full" style={{ maxWidth: 'min(100%, 82vh)' }}>
            <Speedometer
              speedKmh={snap.speedKmh}
              capKmh={capKmh}
              peakKmh={snap.trip.maxSpeedKmh}
              powerW={snap.powerW}
              powerScaleW={powerScaleW}
              dutyPct={snap.dutyPct}
              battA={snap.battA}
              fwActive={snap.fwActive}
              fwA={snap.fwA}
              slip={snap.slip}
              connected={snap.connected}
              modeLabel={modeLabel}
            />
          </div>
        </div>
        {showMap ? (
          <RouteMap
            points={recorder.viewingTripId ? NO_POINTS : recorder.points}
            fix={fix}
            colors={recorder.colors}
            thresholds={recorder.thresholds}
            navigation={false}
            className="min-h-[220px] flex-1"
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 landscape:w-[40%] landscape:grid-rows-3">
            <Tile label="Батарея" value={soc === null ? '—' : `${Math.round(soc)}`} unit="%" tone={socTone} />
            <Tile label="Запас" value={fmt(snap.rangeKm)} unit="км" />
            <Tile label="Мощность" value={fmt(snap.powerW / 1000, 1)} unit="кВт" tone={snap.powerW < -100 ? 'regen' : 'default'} />
            <Tile label="Поездка" value={fmt(snap.trip.distanceKm, 1)} unit="км" />
            <Tile label="Напряжение" value={fmt(snap.vIn, 1)} unit="В" />
            <Tile label="Темп. макс" value={snap.connected ? `${Math.round(temp)}°` : '—'} tone={tempTone} />
          </div>
        )}
      </div>
    </div>
  );
}
