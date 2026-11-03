import { memo } from 'react';

const CX = 160;
const CY = 160;
const START = 135; // degrees, SVG coordinates (0° = +x, clockwise)
const SWEEP = 270;

const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (r: number, deg: number) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))] as const;

function arcPath(r: number, fromDeg: number, toDeg: number) {
  const [x0, y0] = pt(r, fromDeg);
  const [x1, y1] = pt(r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function gaugeScaleMax(capKmh: number | null, speedKmh: number): number {
  const ref = Math.max(capKmh ?? 100, speedKmh);
  return Math.max(60, Math.ceil((ref * 1.1) / 20) * 20);
}

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
  compact?: boolean;
}

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
  compact,
}: Props) {
  const max = gaugeScaleMax(capKmh, speedKmh);
  const frac = Math.max(0, Math.min(1, speedKmh / max));
  const nearCap = capKmh !== null && speedKmh >= capKmh * 0.96;
  const arcColor = nearCap ? 'var(--warn)' : 'rgb(var(--accent-rgb))';
  const ticks: { deg: number; major: boolean; label?: number }[] = [];
  for (let v = 0; v <= max; v += 10) {
    const major = v % 20 === 0;
    ticks.push({ deg: START + (v / max) * SWEEP, major, label: major ? v : undefined });
  }
  const capDeg = capKmh !== null && capKmh < max ? START + (capKmh / max) * SWEEP : null;
  const peakDeg = peakKmh > 1 ? START + (Math.min(peakKmh, max) / max) * SWEEP : null;
  const kw = powerW / 1000;
  const drive = Math.max(0, Math.min(1, powerW / Math.max(500, powerScaleW)));
  const regen = Math.max(0, Math.min(1, -powerW / Math.max(500, powerScaleW * 0.5)));
  const live = connected || speedKmh > 0;

  return (
    <div className={`@container relative mx-auto -mb-[5%] aspect-square w-full ${compact ? 'max-w-[300px]' : 'max-w-[380px]'}`}>
      <svg viewBox="0 0 320 320" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="spd-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={arcColor} stopOpacity="0.55" />
            <stop offset="1" stopColor={arcColor} stopOpacity="1" />
          </linearGradient>
          <filter id="spd-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* track */}
        <path d={arcPath(146, START, START + SWEEP)} fill="none" stroke="var(--surface-3)" strokeWidth="9" strokeLinecap="round" />
        {/* glow + value */}
        <path
          d={arcPath(146, START, START + SWEEP)}
          pathLength={100}
          fill="none"
          stroke={arcColor}
          strokeOpacity="0.45"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${frac * 100} 100`}
          filter="url(#spd-glow)"
          className="arc-anim"
        />
        <path
          d={arcPath(146, START, START + SWEEP)}
          pathLength={100}
          fill="none"
          stroke="url(#spd-grad)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${frac * 100} 100`}
          className="arc-anim"
        />

        {/* ticks */}
        {ticks.map((t) => {
          const [x0, y0] = pt(t.major ? 124 : 128, t.deg);
          const [x1, y1] = pt(134, t.deg);
          const lit = (t.deg - START) / SWEEP <= frac + 1e-6 && frac > 0;
          return (
            <g key={t.deg}>
              <line
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={lit ? arcColor : 'var(--fg-faint)'}
                strokeOpacity={lit ? 0.95 : t.major ? 0.7 : 0.4}
                strokeWidth={t.major ? 2.2 : 1.4}
                strokeLinecap="round"
              />
              {t.label !== undefined && (
                <text
                  x={pt(110, t.deg)[0]}
                  y={pt(110, t.deg)[1]}
                  fill="var(--fg-faint)"
                  fontSize="10.5"
                  fontWeight="600"
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="num"
                >
                  {t.label}
                </text>
              )}
            </g>
          );
        })}

        {/* trip peak marker */}
        {peakDeg !== null && (
          <circle cx={pt(146, peakDeg)[0]} cy={pt(146, peakDeg)[1]} r="2.6" fill="var(--fg)" fillOpacity="0.55" />
        )}

        {/* speed cap marker */}
        {capDeg !== null && (
          <g>
            <line
              x1={pt(138, capDeg)[0]}
              y1={pt(138, capDeg)[1]}
              x2={pt(156, capDeg)[0]}
              y2={pt(156, capDeg)[1]}
              stroke="var(--bad)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>

      {/* centre — absolutely placed so nothing collides with the scale labels */}
      <div className="absolute inset-x-0 top-[21%] flex justify-center gap-1.5">
        {fwActive && <span className="chip chip-warn h-[22px] px-2 text-[10px]">FW {Math.round(fwA)} А</span>}
        {slip && <span className="chip chip-bad pulse-bad h-[22px] px-2 text-[10px]">SLIP</span>}
        {!fwActive && !slip && <span className="label leading-[22px]">{sourceLabel ?? 'км/ч'}</span>}
      </div>
      <div
        className="speed-digits num glow-accent absolute inset-x-0 top-[46%] -translate-y-1/2 text-center text-[34cqw]"
        style={{ color: live ? 'var(--fg)' : 'var(--fg-faint)' }}
      >
        {Math.round(speedKmh)}
      </div>
      <div className="absolute inset-x-0 top-[61.5%] flex items-center justify-center gap-2 text-[3.3cqw] font-semibold tracking-[0.18em] text-[var(--fg-muted)]">
        <span style={{ color: 'rgb(var(--accent-rgb))' }}>{modeLabel}</span>
        {capKmh !== null && (
          <>
            <span className="text-[var(--fg-faint)]">•</span>
            <span className="num">≤ {Math.round(capKmh)}</span>
          </>
        )}
      </div>
      {/* power bar: regen ← | → drive */}
      <div className="absolute left-1/2 top-[70%] w-[36%] -translate-x-1/2">
        <div className="relative h-[5px] w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--line-strong)]" />
          <div className="bar-anim absolute inset-y-0 right-1/2 rounded-l-full" style={{ width: `${regen * 50}%`, background: 'var(--regen)' }} />
          <div className="bar-anim absolute inset-y-0 left-1/2 rounded-r-full" style={{ width: `${drive * 50}%`, background: 'rgb(var(--accent-rgb))' }} />
        </div>
        <div
          className="num mt-[1.6cqw] text-center text-[4.4cqw] font-semibold leading-none"
          style={{ color: kw < -0.05 ? 'var(--regen)' : 'var(--fg)' }}
        >
          {kw > 0.05 ? '+' : ''}
          {kw.toFixed(1)}
          <span className="ml-1 text-[3cqw] text-[var(--fg-faint)]">кВт</span>
        </div>
      </div>
      <div className="num absolute inset-x-0 top-[84%] flex justify-center gap-3 text-[3.1cqw] font-medium text-[var(--fg-faint)]">
        <span>{Math.round(battA)} А</span>
        <span>duty {Math.round(dutyPct)}%</span>
      </div>
    </div>
  );
});
