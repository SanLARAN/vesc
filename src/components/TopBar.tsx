import { memo, useEffect, useState } from 'react';
import { Bluetooth, BluetoothOff, LoaderCircle, Satellite, Sparkles, Usb } from 'lucide-react';
import type { LinkPhase } from '../hooks/useVescSession';
import type { ConnectionTopology } from '../state/dashboardConfig';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  phase: LinkPhase;
  topology: ConnectionTopology | null;
  frontOnline: boolean;
  rearOnline: boolean;
  frontPresent: boolean;
  rearPresent: boolean;
  socPct: number | null;
  gpsAccuracy: number | null;
  gpsActive: boolean;
  onConnectClick: () => void;
}

export const TopBar = memo(function TopBar({
  phase,
  topology,
  frontOnline,
  rearOnline,
  frontPresent,
  rearPresent,
  socPct,
  gpsAccuracy,
  gpsActive,
  onConnectClick,
}: Props) {
  const clock = useClock();
  const busy = phase === 'connecting' || phase === 'syncing';
  const online = phase === 'online';
  const Icon = busy ? LoaderCircle : topology === 'sim' ? Sparkles : topology === 'usb' ? Usb : online ? Bluetooth : BluetoothOff;
  const label = busy
    ? phase === 'connecting'
      ? 'Подключение…'
      : 'Чтение VESC…'
    : online
      ? topology === 'sim'
        ? 'Демо'
        : 'На связи'
      : phase === 'lost'
        ? 'Связь потеряна'
        : 'Подключить';
  const tone = online ? 'var(--good)' : phase === 'lost' ? 'var(--bad)' : busy ? 'var(--warn)' : 'var(--fg-muted)';
  const dot = (present: boolean, on: boolean, name: string) => (
    <span
      title={name}
      className="grid h-[18px] min-w-[18px] place-items-center border px-1 text-[9.5px] font-bold"
      style={{
        borderColor: on ? 'color-mix(in srgb, var(--good) 60%, transparent)' : 'var(--line-strong)',
        color: on ? 'var(--good)' : present ? 'var(--warn)' : 'var(--fg-faint)',
      }}
    >
      {name}
    </span>
  );

  return (
    <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-[max(0.6rem,env(safe-area-inset-top))]">
      <button
        type="button"
        onClick={onConnectClick}
        className={`flex h-9 min-w-0 items-center gap-2 border px-3 text-[11px] font-semibold uppercase tracking-[0.12em] ${phase === 'lost' ? 'pulse-bad' : ''}`}
        style={{ borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`, color: tone }}
      >
        <Icon size={15} className={busy ? 'animate-spin' : ''} />
        <span className="truncate">{label}</span>
        {(online || phase === 'lost') && (
          <span className="ml-0.5 flex gap-1">
            {dot(frontPresent, frontOnline, 'П')}
            {dot(rearPresent, rearOnline, 'З')}
          </span>
        )}
      </button>

      <div className="num text-[15px] font-medium tracking-[0.04em]">{clock}</div>

      <div className="flex items-center gap-2.5">
        <span
          className="flex items-center gap-1 text-[11px] font-semibold"
          title={gpsAccuracy !== null ? `GPS ±${Math.round(gpsAccuracy)} м` : 'GPS'}
          style={{
            color: !gpsActive
              ? 'var(--fg-faint)'
              : gpsAccuracy === null
                ? 'var(--warn)'
                : gpsAccuracy <= 15
                  ? 'var(--good)'
                  : 'var(--warn)',
          }}
        >
          <Satellite size={14} />
          {gpsActive && gpsAccuracy !== null && <span className="num">±{Math.round(gpsAccuracy)}</span>}
        </span>
        <BatteryGlyph pct={socPct} />
      </div>
    </header>
  );
});

function BatteryGlyph({ pct }: { pct: number | null }) {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const color = pct === null ? 'var(--fg-faint)' : p < 15 ? 'var(--bad)' : p < 30 ? 'var(--warn)' : 'var(--fg)';
  return (
    <span className="flex items-center gap-1.5" title="Заряд батареи">
      <span className="num text-[13px] font-medium" style={{ color }}>
        {pct === null ? '—' : `${Math.round(p)}%`}
      </span>
      <span className="relative h-[12px] w-[24px] border" style={{ borderColor: color }}>
        <span className="bar-anim absolute inset-[2px] origin-left" style={{ background: color, transform: `scaleX(${p / 100})` }} />
        <span className="absolute -right-[3px] top-1/2 h-[4px] w-[2px] -translate-y-1/2" style={{ background: color }} />
      </span>
    </span>
  );
}
