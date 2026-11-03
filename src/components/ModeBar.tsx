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
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const active = it.id === activeProfileId;
          const rgb = accentForProfile(it.id === BASE_PROFILE_ID ? null : it.id);
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={active}
              onClick={() => onProfile(it.id)}
              className="relative flex h-[58px] flex-col items-center justify-center rounded-[16px] border transition-all duration-200 active:scale-[0.97]"
              style={{
                borderColor: active ? `rgb(${rgb} / 0.7)` : 'var(--line)',
                background: active ? `linear-gradient(180deg, rgb(${rgb} / 0.28), rgb(${rgb} / 0.1))` : 'var(--surface)',
                boxShadow: active ? `0 10px 28px -14px rgb(${rgb} / 0.9), inset 0 1px 0 rgb(255 255 255 / 0.08)` : undefined,
              }}
            >
              <span
                className="text-[13px] font-bold tracking-[0.06em]"
                style={{ color: active ? `rgb(${rgb})` : 'var(--fg)' }}
              >
                {it.code}
              </span>
              <span className="num mt-0.5 text-[10px] font-semibold text-[var(--fg-faint)]">
                {it.id === BASE_PROFILE_ID ? it.sub : `≤${it.sub}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <div className="seg flex-1 p-[3px]" role="group" aria-label="Привод">
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
              className="!min-h-[34px] !text-[12px]"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={limiterOn}
          onClick={() => onLimiter(!limiterOn)}
          className="num flex h-[42px] items-center gap-1.5 rounded-[14px] border px-3 text-[12px] font-bold"
          style={{
            borderColor: limiterOn ? 'color-mix(in srgb, var(--bad) 60%, transparent)' : 'var(--line)',
            background: limiterOn ? 'color-mix(in srgb, var(--bad) 16%, transparent)' : 'var(--surface)',
            color: limiterOn ? 'var(--bad)' : 'var(--fg-muted)',
          }}
          title="Ограничитель скорости"
        >
          <span className="grid h-[20px] w-[20px] place-items-center rounded-full border-2 text-[8.5px]" style={{ borderColor: 'currentColor' }}>
            {limiterKmh}
          </span>
          LIM
        </button>
      </div>
      <div className="mt-2 px-1">
        <StatusLine status={status} />
      </div>
    </section>
  );
});
