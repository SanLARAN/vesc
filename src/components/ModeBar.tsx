import { memo } from 'react';
import { Check, CircleAlert, LoaderCircle, ShieldCheck, WifiOff } from 'lucide-react';
import type { ModeStatus } from '../hooks/useVescSession';
import { accentForProfile, BASE_PROFILE_ID, RideProfile, TractionDriveMode } from '../state/dashboardConfig';

interface Props {
  profiles: RideProfile[];
  activeProfileId: string;
  traction: TractionDriveMode;
  limiterOn: boolean;
  limiterKmh: number;
  status: ModeStatus;
  rearAvailable: boolean;
  onProfile: (id: string) => void;
  onTraction: (t: TractionDriveMode) => void;
  onLimiter: (on: boolean) => void;
}

function StatusLine({ status }: { status: ModeStatus }) {
  const map = {
    idle: { icon: <ShieldCheck size={13} />, text: 'Режим применится при подключении', color: 'var(--fg-faint)' },
    applying: { icon: <LoaderCircle size={13} className="animate-spin" />, text: 'Отправка в VESC…', color: 'var(--warn)' },
    applied: { icon: <Check size={13} />, text: 'Применено в VESC', color: 'var(--good)' },
    partial: { icon: <CircleAlert size={13} />, text: status.message ?? 'Применено частично', color: 'var(--warn)' },
    error: { icon: <CircleAlert size={13} />, text: status.message ?? 'Ошибка применения', color: 'var(--bad)' },
    offline: { icon: <WifiOff size={13} />, text: status.message ?? 'Нет связи', color: 'var(--fg-faint)' },
    readonly: { icon: <CircleAlert size={13} />, text: status.message ?? 'Только телеметрия', color: 'var(--warn)' },
  }[status.state];
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium" style={{ color: map.color }}>
      {map.icon}
      <span className="truncate">{map.text}</span>
    </div>
  );
}

export const ModeBar = memo(function ModeBar({
  profiles,
  activeProfileId,
  traction,
  limiterOn,
  limiterKmh,
  status,
  rearAvailable,
  onProfile,
  onTraction,
  onLimiter,
}: Props) {
  const items = [
    { id: BASE_PROFILE_ID, code: 'BASE', sub: 'VESC' },
    ...profiles.map((p) => ({ id: p.id, code: p.code, sub: `${p.maxSpeedKmh}` })),
  ];
  return (
    <section className="card p-3">
      <div
        className="grid gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        role="group"
        aria-label="Режим езды"
      >
        {items.map((it) => {
          const active = it.id === activeProfileId;
          const rgb = accentForProfile(it.id === BASE_PROFILE_ID ? null : it.id);
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={active}
              onClick={() => onProfile(it.id)}
              className="relative flex h-[56px] min-w-0 flex-col items-center justify-center transition-colors duration-150"
              style={{ background: active ? 'var(--fg)' : 'var(--surface)', color: active ? 'var(--bg)' : 'var(--fg)' }}
            >
              <span className="max-w-full truncate px-1 text-[12px] font-bold tracking-[0.12em]">{it.code}</span>
              <span className="num mt-1 text-[10px] font-semibold" style={{ color: active ? 'var(--bg)' : 'var(--fg-faint)', opacity: active ? 0.55 : 1 }}>
                {it.id === BASE_PROFILE_ID ? it.sub : `≤${it.sub}`}
              </span>
              <span
                className="absolute inset-x-0 bottom-0 h-[3px] transition-opacity duration-150"
                style={{ background: `rgb(${rgb})`, opacity: active ? 1 : 0 }}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-stretch gap-2">
        <div className="seg flex-1" role="group" aria-label="Привод">
          {(
            [
              ['2wd', '2WD'],
              ['1wd_front_hall', 'Перед'],
              ['1wd_rear_sl', 'Зад'],
            ] as [TractionDriveMode, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={traction === v}
              disabled={v !== '1wd_front_hall' && !rearAvailable && v !== '2wd'}
              onClick={() => onTraction(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={limiterOn}
          onClick={() => onLimiter(!limiterOn)}
          className="num flex items-center gap-2 border px-3 text-[11px] font-bold tracking-[0.12em] transition-colors"
          style={{
            borderColor: limiterOn ? 'var(--bad)' : 'var(--line-strong)',
            background: limiterOn ? 'var(--bad)' : 'transparent',
            color: limiterOn ? '#fff' : 'var(--fg-muted)',
          }}
          title="Ограничитель скорости"
        >
          <span className="grid h-[22px] min-w-[22px] place-items-center border px-0.5 text-[10px]" style={{ borderColor: 'currentColor' }}>
            {limiterKmh}
          </span>
          LIM
        </button>
      </div>
      <div className="mt-2.5 px-0.5">
        <StatusLine status={status} />
      </div>
    </section>
  );
});
