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
      className="grid h-[18px] min-w-[18px] place-items-center rounded-md px-1 text-[9.5px] font-bold"
      style={{
        background: on ? 'color-mix(in srgb, var(--good) 18%, transparent)' : 'var(--surface-2)',
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
        className={`flex h-9 min-w-0 items-center gap-2 rounded-full border px-3 text-[12px] font-semibold ${phase === 'lost' ? 'pulse-bad' : ''}`}
        style={{ borderColor: `color-mix(in srgb, ${tone} 40%, transparent)`, color: tone, background: 'var(--surface)' }}
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

      <div className="num text-[15px] font-semibold tracking-tight">{clock}</div>

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
      <span className="num text-[13px] font-semibold" style={{ color }}>
        {pct === null ? '—' : `${Math.round(p)}%`}
      </span>
      <span className="relative h-[13px] w-[25px] rounded-[4px] border-[1.5px]" style={{ borderColor: color }}>
        <span className="absolute inset-[1.5px] origin-left rounded-[2px] bar-anim" style={{ background: color, transform: `scaleX(${p / 100})` }} />
        <span className="absolute -right-[4px] top-1/2 h-[5px] w-[2px] -translate-y-1/2 rounded-r" style={{ background: color }} />
      </span>
    </span>
  );
}
