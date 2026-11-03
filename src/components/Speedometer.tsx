import { memo, ReactNode } from 'react';

interface Props {
  speedKmh: number;
  capKmh: number | null;
  peakKmh: number;
  powerW: number;
  powerScaleW: number;
  dutyPct: number;
  battA: number;
  fwActive: boolean;
  fwA: number;
  slip: boolean;
  connected: boolean;
  modeLabel: string;
  sourceLabel?: string;
  /** Buttons rendered at the right end of the header row. */
  actions?: ReactNode;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Minimal instrument: huge speed digits, trip peak on the left, a square speed-limit sign on the
 * right and a centre-zero power bar (regen ← | → drive) underneath. Sizes scale with the
 * container width (cqw), capped so the block stays sane on tablets.
 */
export const Speedometer = memo(function Speedometer({
  speedKmh,
  capKmh,
  peakKmh,
  powerW,
  powerScaleW,
  dutyPct,
  battA,
  fwActive,
  fwA,
  slip,
  connected,
  modeLabel,
  sourceLabel,
  actions,
}: Props) {
  const nearCap = capKmh !== null && speedKmh >= capKmh * 0.96;
  const kw = powerW / 1000;
  const drive = clamp01(powerW / Math.max(500, powerScaleW));
  const regen = clamp01(-powerW / Math.max(500, powerScaleW * 0.5));
  const live = connected || speedKmh > 0;

  return (
    <div className="@container w-full">
      {/* header: mode · live states · actions */}
      <div className="flex min-h-[36px] items-center gap-2">
        <span className="h-2 w-2 shrink-0" style={{ background: 'rgb(var(--mode-rgb))' }} aria-hidden="true" />
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.22em]">{modeLabel}</span>
        {fwActive && <span className="chip chip-warn num shrink-0">FW {Math.round(fwA)} А</span>}
        {slip && <span className="chip chip-bad pulse-bad shrink-0">Slip</span>}
        {actions && <div className="ml-auto flex shrink-0 gap-1.5">{actions}</div>}
      </div>

      {/* peak | speed | limit */}
      <div className="mt-[min(5cqw,28px)] grid grid-cols-[1fr_auto_1fr] items-end">
        <div className="pb-[min(1.5cqw,8px)]">
          <div className="label">Макс</div>
          <div className="num mt-1.5 text-[min(6cqw,30px)] font-light leading-none">{peakKmh >= 1 ? Math.round(peakKmh) : '—'}</div>
        </div>
        <div
          className="speed-digits num px-[2cqw] text-center text-[min(36cqw,190px)]"
          style={{ color: live ? 'var(--fg)' : 'var(--fg-faint)' }}
        >
          {Math.round(speedKmh)}
        </div>
        <div className="flex justify-end pb-[min(1.5cqw,8px)]">
          {capKmh !== null ? (
            <div className="flex flex-col items-center gap-1.5" title="Ограничение скорости">
              <div
                className="num grid h-[min(12cqw,60px)] min-w-[min(12cqw,60px)] place-items-center border-2 px-[min(1.4cqw,7px)] text-[min(5.6cqw,28px)] font-semibold leading-none transition-colors"
                style={{
                  borderColor: nearCap ? 'var(--bad)' : 'var(--fg)',
                  background: nearCap ? 'var(--bad)' : 'transparent',
                  color: nearCap ? '#fff' : 'var(--fg)',
                }}
              >
                {Math.round(capKmh)}
              </div>
              <div className="label">Лимит</div>
            </div>
          ) : (
            <div className="label text-right leading-relaxed">
              Без
              <br />
              лимита
            </div>
          )}
        </div>
      </div>
      <div className="mt-[min(3cqw,16px)] text-center text-[min(3cqw,14px)] font-semibold uppercase tracking-[0.34em] text-[var(--fg-muted)]">
        {sourceLabel ?? 'км/ч'}
      </div>

      {/* power: regen ← | → drive */}
      <div className="relative mt-[min(6cqw,30px)] h-[3px] bg-[var(--surface-3)]" aria-hidden="true">
        <div className="bar-anim absolute inset-y-0 right-1/2" style={{ width: `${regen * 50}%`, background: 'var(--regen)' }} />
        <div className="bar-anim absolute inset-y-0 left-1/2" style={{ width: `${drive * 50}%`, background: 'var(--fg)' }} />
        <div className="absolute -top-[4px] left-1/2 h-[11px] w-px bg-[var(--fg-faint)]" />
      </div>
      <div className="num mt-[min(2.6cqw,14px)] grid grid-cols-[1fr_auto_1fr] items-baseline text-[min(2.9cqw,13px)] font-semibold uppercase tracking-[0.1em] text-[var(--fg-faint)]">
        <span>АКБ {Math.round(battA)} А</span>
        <span
          className="text-[min(5cqw,24px)] font-medium normal-case tracking-normal"
          style={{ color: kw < -0.05 ? 'var(--regen)' : 'var(--fg)' }}
        >
          {kw > 0.05 ? '+' : ''}
          {kw.toFixed(1)}
          <span className="ml-1 text-[min(2.9cqw,13px)] font-semibold text-[var(--fg-faint)]">кВт</span>
        </span>
        <span className="text-right">Duty {Math.round(dutyPct)}%</span>
      </div>
    </div>
  );
});
