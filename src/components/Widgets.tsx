import { memo, ReactElement, useMemo } from 'react';
import { Activity, BatteryCharging, Cpu, Gauge, RotateCcw, Thermometer, Timer, TrendingUp } from 'lucide-react';
import type { ControllerKey } from '../protocol/vescLink';
import type { ControllerState } from '../hooks/useVescSession';
import { CONTROLLER_NAMES } from '../hooks/useVescSession';
import type { MotorLive, RideSnapshot } from '../state/rideEngine';
import { DRAG_TARGETS } from '../state/tripComputer';
import type { OnboardComputerConfig, WidgetId } from '../state/dashboardConfig';
import { Card, fmt, fmtTime, Meter, Stat, Tone, toneColor } from './ui';

interface WidgetProps {
  snap: RideSnapshot;
  cfg: OnboardComputerConfig;
  controllers: Record<ControllerKey, ControllerState>;
  onResetTrip: () => void;
  onResetDrag: () => void;
}

const tempTone = (t: number, warn: number, hard: number | undefined): Tone =>
  hard !== undefined && t >= hard ? 'bad' : t >= warn ? 'warn' : 'default';

/* ───────── Motors ───────── */

function MotorColumn({ m, ctrl, cfg }: { m: MotorLive; ctrl: ControllerState; cfg: OnboardComputerConfig }) {
  const v = ctrl.values;
  const maxPhase = v ? v.l_current_max : 100;
  const maxBatt = v ? v.l_in_current_max : cfg.perEscBatteryAmps;
  const fault = m.t && m.t.faultCode !== 0 ? m.t.faultText : null;
  const state = !ctrl.present ? 'нет' : m.online ? (fault ? 'ошибка' : 'норма') : 'нет данных';
  const stateTone: Tone = !ctrl.present ? 'muted' : m.online ? (fault ? 'bad' : 'good') : 'warn';
  const regen = m.phaseA < -0.5;
  return (
    <div className="min-w-0 border border-[var(--line)] p-3">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-bold uppercase tracking-[0.12em]">{CONTROLLER_NAMES[m.key]}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em]" style={{ color: toneColor(stateTone) }}>
          <span className="h-1.5 w-1.5 shrink-0" style={{ background: 'currentColor' }} aria-hidden="true" />
          <span className="truncate">{state}</span>
        </div>
      </div>
      <div className="mt-2.5">
        <Stat label="Фаза" value={fmt(Math.abs(m.phaseA))} unit="А" tone={regen ? 'regen' : 'default'} size="lg" />
        <div className="mt-2">
          <Meter value={Math.abs(m.phaseA) / Math.max(1, maxPhase)} tone={regen ? 'regen' : 'accent'} height={5} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="АКБ" value={fmt(m.battA)} unit="А" size="sm" tone={Math.abs(m.battA) > maxBatt * 0.98 ? 'warn' : 'default'} />
        <Stat label="FW" value={fmt(m.fwA)} unit="А" size="sm" tone={m.fwA > 1 ? 'warn' : 'muted'} />
        <Stat label="Duty" value={fmt(m.duty * 100)} unit="%" size="sm" tone={m.duty > 0.9 ? 'warn' : 'default'} />
        <Stat label="Колесо" value={fmt(m.speedKmh)} unit="км/ч" size="sm" />
      </div>
      {fault && <div className="mt-2 text-[11px] font-semibold text-[var(--bad)]">{fault}</div>}
    </div>
  );
}

function MotorsWidget({ snap, cfg, controllers }: WidgetProps) {
  return (
    <Card title="Моторы" icon={<Cpu size={13} />} right={snap.slip ? <span className="chip chip-bad pulse-bad">пробуксовка</span> : undefined}>
      <div className="grid grid-cols-2 gap-2.5">
        <MotorColumn m={snap.front} ctrl={controllers.front} cfg={cfg} />
        <MotorColumn m={snap.rear} ctrl={controllers.rear} cfg={cfg} />
      </div>
    </Card>
  );
}

/* ───────── Battery ───────── */

function BatteryWidget({ snap, cfg }: WidgetProps) {
  const b = snap.battery;
  const soc = b.socPct;
  const tone: Tone = soc === null ? 'muted' : soc < 15 ? 'bad' : soc < 30 ? 'warn' : 'good';
  const nearCut = snap.vIn > 0 && snap.vIn < cfg.cutoffStartV + 1;
  return (
    <Card title="Батарея" icon={<BatteryCharging size={13} />} right={<span className="num text-[12px] font-semibold text-[var(--fg-muted)]">{cfg.batteryCells}S · {cfg.batteryCapacityAh} Ач</span>}>
      <div className="flex items-end justify-between gap-3">
        <Stat label="Заряд" value={soc === null ? '—' : Math.round(soc)} unit="%" tone={tone} size="lg" />
        <div className="text-right">
          <div className="label">Напряжение</div>
          <div className="num text-[22px] font-semibold leading-none" style={{ color: nearCut ? 'var(--bad)' : undefined }}>
            {fmt(snap.vIn, 1)}
            <span className="ml-1 text-[11px] text-[var(--fg-faint)]">В</span>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Meter value={(soc ?? 0) / 100} tone={tone === 'muted' ? 'accent' : tone} height={8} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Stat label="Покой" value={fmt(b.restVoltage, 1)} unit="В" size="sm" />
        <Stat label="Просадка" value={fmt(b.sagV, 1)} unit="В" size="sm" tone={b.sagV > 6 ? 'warn' : 'default'} />
        <Stat label="Ячейка" value={fmt(b.cellV, 2)} unit="В" size="sm" />
        <Stat label="R пакета" value={fmt(b.resistanceMohm)} unit="мОм" size="sm" />
      </div>
      <div className="mt-2 text-[11px] text-[var(--fg-faint)]">
        Заряд — по напряжению покоя (просадка I·R компенсируется). Срез тока с {cfg.cutoffStartV} В, полный — {cfg.cutoffEndV} В.
      </div>
    </Card>
  );
}

/* ───────── Efficiency ───────── */

function EfficiencyWidget({ snap, cfg }: WidgetProps) {
  const t = snap.trip;
  const regenShare = t.energyWh > 1 ? (t.regenWh / t.energyWh) * 100 : null;
  return (
    <Card title="Расход и запас хода" icon={<TrendingUp size={13} />}>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Запас хода" value={fmt(snap.rangeKm)} unit="км" size="lg" tone="accent" sub={snap.netWhPerKm ? 'по расходу поездки' : `по норме ${cfg.typicalWhPerKm} Вт·ч/км`} />
        <Stat label="Осталось" value={fmt(snap.remainingWh)} unit="Вт·ч" size="lg" />
        <Stat label="Сейчас" value={snap.instWhPerKm === null ? '—' : fmt(snap.instWhPerKm)} unit="Вт·ч/км" tone={snap.instWhPerKm !== null && snap.instWhPerKm < 0 ? 'regen' : 'default'} />
        <Stat label="Средний" value={fmt(snap.netWhPerKm)} unit="Вт·ч/км" />
        <Stat label="Потрачено" value={fmt(t.energyWh)} unit="Вт·ч" size="sm" />
        <Stat label="Рекуперация" value={fmt(t.regenWh)} unit="Вт·ч" size="sm" tone="regen" sub={regenShare !== null ? `${regenShare.toFixed(0)}% возвращено` : undefined} />
      </div>
    </Card>
  );
}

/* ───────── Performance ───────── */

function PerformanceWidget({ snap, onResetDrag }: WidgetProps) {
  const cell = (v: number | null | undefined, best?: boolean) => (
    <span className={`num text-[13px] font-semibold ${best ? 'text-[rgb(var(--accent-rgb))]' : ''}`}>{v ? `${v.toFixed(2)}с` : '—'}</span>
  );
  return (
    <Card
      title="Разгон"
      icon={<Timer size={13} />}
      right={
        <button type="button" className="btn btn-ghost btn-sm" onClick={onResetDrag}>
          <RotateCcw size={13} /> Сброс
        </button>
      }
    >
      <div className="grid grid-cols-[1fr_repeat(3,auto)] items-center gap-x-4 gap-y-2">
        <span className="label">Цель</span>
        <span className="label text-right">Сейчас</span>
        <span className="label text-right">Прошлый</span>
        <span className="label text-right">Лучший</span>
        {DRAG_TARGETS.map((target) => (
          <div key={target} className="contents">
            <span className="num text-[13px] font-semibold text-[var(--fg-muted)]">0–{target}</span>
            <span className="text-right">{cell(snap.dragCurrent?.times[target])}</span>
            <span className="text-right">{cell(snap.dragLast?.times[target])}</span>
            <span className="text-right">{cell(snap.dragBest[target], true)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[11px] text-[var(--fg-faint)]">Замер стартует сам с места (&lt;1 км/ч) и заканчивается при сбросе газа.</div>
    </Card>
  );
}

/* ───────── Graph ───────── */

function Spark({ data, color, min, max, fill }: { data: number[]; color: string; min: number; max: number; fill?: boolean }) {
  const w = 300;
  const h = 70;
  const span = Math.max(1e-6, max - min);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((Math.max(min, Math.min(max, v)) - min) / span) * h]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <>
      {fill && <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill={color} fillOpacity="0.12" />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </>
  );
}

function GraphWidget({ snap }: WidgetProps) {
  const { speedHistory, powerHistory } = snap;
  const vmax = useMemo(() => Math.max(20, ...speedHistory) * 1.1, [speedHistory]);
  const pmax = useMemo(() => Math.max(1000, ...powerHistory.map((p) => Math.abs(p))) * 1.1, [powerHistory]);
  return (
    <Card
      title="Последние 60 с"
      icon={<Activity size={13} />}
      right={
        <div className="flex gap-3 text-[11px] font-semibold">
          <span style={{ color: 'rgb(var(--accent-rgb))' }}>■ скорость</span>
          <span style={{ color: 'var(--fg-muted)' }}>■ мощность</span>
        </div>
      }
    >
      <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="h-[110px] w-full">
        <line x1="0" x2="300" y1="35" y2="35" stroke="var(--line)" strokeDasharray="3 4" />
        <Spark data={powerHistory} color="var(--fg-muted)" min={-pmax} max={pmax} />
        <Spark data={speedHistory} color="rgb(var(--accent-rgb))" min={0} max={vmax} fill />
      </svg>
      <div className="num mt-1 flex justify-between text-[11px] text-[var(--fg-faint)]">
        <span>макс {Math.round(Math.max(...speedHistory))} км/ч</span>
        <span>пик {(Math.max(...powerHistory) / 1000).toFixed(1)} кВт</span>
      </div>
    </Card>
  );
}

/* ───────── Thermal ───────── */

function ThermalWidget({ snap, cfg, controllers }: WidgetProps) {
  const rows: { name: string; t: number | null; warn: number; start?: number; end: number }[] = [];
  for (const key of ['front', 'rear'] as ControllerKey[]) {
    const m = snap[key];
    const v = controllers[key].values;
    rows.push({
      name: `${CONTROLLER_NAMES[key]} · VESC`,
      t: m.online && m.t ? m.t.tempFet : null,
      warn: cfg.fetWarnTempC,
      start: v?.l_temp_fet_start,
      end: v?.l_temp_fet_end ?? 100,
    });
    rows.push({
      name: `${CONTROLLER_NAMES[key]} · мотор`,
      t: m.online && m.t ? m.t.tempMotor : null,
      warn: cfg.motorWarnTempC,
      start: v?.l_temp_motor_start,
      end: v?.l_temp_motor_end ?? 120,
    });
  }
  return (
    <Card title="Температуры" icon={<Thermometer size={13} />}>
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const tone = r.t === null ? 'muted' : tempTone(r.t, r.warn, r.start);
          return (
            <div key={r.name}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-[var(--fg-muted)]">{r.name}</span>
                <span className="num text-[15px] font-semibold" style={{ color: tone === 'default' ? 'var(--fg)' : `var(--${tone === 'muted' ? 'fg-faint' : tone})` }}>
                  {r.t === null ? '—' : `${r.t.toFixed(0)}°`}
                </span>
              </div>
              <div className="relative mt-1.5">
                <Meter value={(r.t ?? 0) / r.end} tone={tone === 'muted' || tone === 'default' ? 'good' : tone} height={5} />
                {r.start !== undefined && (
                  <span className="absolute -top-[3px] h-[11px] w-[2px] bg-[var(--bad)]" style={{ left: `${Math.min(100, (r.start / r.end) * 100)}%` }} title="Начало ограничения тока" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[11px] text-[var(--fg-faint)]">Красная метка — порог, с которого VESC начинает урезать ток.</div>
    </Card>
  );
}

/* ───────── Trip ───────── */

function TripWidget({ snap, onResetTrip }: WidgetProps) {
  const t = snap.trip;
  const avg = t.rideSeconds > 10 ? t.distanceKm / (t.rideSeconds / 3600) : null;
  return (
    <Card
      title="Поездка"
      icon={<Gauge size={13} />}
      right={
        <button type="button" className="btn btn-ghost btn-sm" onClick={onResetTrip}>
          <RotateCcw size={13} /> Новая
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Путь" value={fmt(t.distanceKm, 2)} unit="км" tone="accent" />
        <Stat label="В движении" value={fmtTime(t.rideSeconds)} />
        <Stat label="Средняя" value={fmt(avg, 1)} unit="км/ч" />
        <Stat label="Макс." value={fmt(t.maxSpeedKmh, 1)} unit="км/ч" size="sm" />
        <Stat label="Пик мощн." value={fmt(t.maxPowerW / 1000, 1)} unit="кВт" size="sm" />
        <Stat label="Пик фазы" value={fmt(t.maxPhaseA)} unit="А" size="sm" />
        <Stat label="Пик АКБ" value={fmt(t.maxBattA)} unit="А" size="sm" />
        <Stat label="Рекуп. мин" value={fmt(t.minRegenA)} unit="А" size="sm" tone="regen" />
        <Stat label="Одометр" value={fmt(snap.odometerKm, 1)} unit="км" size="sm" />
      </div>
    </Card>
  );
}

const WIDGETS: Record<WidgetId, (p: WidgetProps) => ReactElement> = {
  motors: MotorsWidget,
  battery: BatteryWidget,
  efficiency: EfficiencyWidget,
  performance: PerformanceWidget,
  graph: GraphWidget,
  thermal: ThermalWidget,
  trip: TripWidget,
};

export const WidgetStack = memo(function WidgetStack(props: WidgetProps) {
  return (
    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
      {props.cfg.widgets
        .filter((w) => w.enabled)
        .map((w) => {
          const Comp = WIDGETS[w.id];
          return <Comp key={w.id} {...props} />;
        })}
    </div>
  );
});
