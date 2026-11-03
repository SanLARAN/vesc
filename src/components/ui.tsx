import { ReactNode, useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';

export type Tone = 'default' | 'good' | 'warn' | 'bad' | 'accent' | 'regen' | 'muted';

export const toneColor = (tone: Tone = 'default'): string =>
  ({
    default: 'var(--fg)',
    good: 'var(--good)',
    warn: 'var(--warn)',
    bad: 'var(--bad)',
    accent: 'rgb(var(--accent-rgb))',
    regen: 'var(--regen)',
    muted: 'var(--fg-muted)',
  })[tone];

export function Card({
  title,
  icon,
  right,
  children,
  className = '',
  onClick,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <section className={`card p-4 ${className}`} onClick={onClick}>
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <div className="card-title flex items-center gap-1.5">
            {icon}
            {title}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="toggle"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className = '',
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const fill = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={{ ['--fill' as string]: `${fill}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Numeric field that only commits valid values (on blur / Enter). */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  unit,
  label,
  disabled,
  className = '',
}: {
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const parsed = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const commit = () => {
    setFocused(false);
    if (valid) {
      const rounded = Math.round(parsed / step) * step;
      onCommit(Number(rounded.toFixed(4)));
    } else setText(String(value));
  };
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <input
        className="field num pr-12"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-invalid={!valid}
        style={!valid ? { borderColor: 'var(--bad)' } : undefined}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {unit && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-[var(--fg-faint)]">
          {unit}
        </span>
      )}
    </label>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  sub,
  size = 'md',
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  tone?: Tone;
  sub?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const fs = size === 'lg' ? 'text-[30px]' : size === 'sm' ? 'text-[17px]' : 'text-[22px]';
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className={`num mt-1.5 flex items-baseline gap-1 font-medium leading-none tracking-tight ${fs}`} style={{ color: toneColor(tone) }}>
        <span className="truncate">{value}</span>
        {unit && <span className="text-[11px] font-semibold tracking-normal text-[var(--fg-faint)]">{unit}</span>}
      </div>
      {sub && <div className="mt-1 truncate text-[11px] text-[var(--fg-muted)]">{sub}</div>}
    </div>
  );
}

export function Meter({ value, tone = 'accent', height = 6 }: { value: number; tone?: Tone; height?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="w-full overflow-hidden bg-[var(--surface-3)]" style={{ height }}>
      <div className="bar-anim h-full" style={{ width: `${pct}%`, background: toneColor(tone) }} />
    </div>
  );
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-[var(--fg-muted)]">{hint}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="sheet-backdrop absolute inset-0" onClick={onClose} />
      <div className="sheet relative max-h-[88vh] w-full max-w-lg overflow-y-auto border-t border-[var(--line-strong)] bg-[var(--bg-elev)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:border">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={id} className="text-[17px] font-semibold leading-snug tracking-[-0.01em]">
            {title}
          </h2>
          <button type="button" className="icon-btn -mr-1 -mt-1 h-9 w-9" aria-label="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">{footer}</div>}
      </div>
    </div>
  );
}

export function Notice({ tone = 'warn', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  const c = toneColor(tone);
  return (
    <div
      className="flex gap-2.5 border border-l-[3px] px-3.5 py-3 text-[12.5px] leading-snug"
      style={{ borderColor: `color-mix(in srgb, ${c} 32%, transparent)`, borderLeftColor: c, background: `color-mix(in srgb, ${c} 6%, transparent)` }}
    >
      {icon && <span className="mt-0.5 shrink-0" style={{ color: c }}>{icon}</span>}
      <div className="min-w-0 text-[var(--fg)]">{children}</div>
    </div>
  );
}

export const fmt = (v: number | null | undefined, digits = 0, fallback = '—') =>
  v === null || v === undefined || !Number.isFinite(v) ? fallback : v.toFixed(digits);

export const fmtTime = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};
