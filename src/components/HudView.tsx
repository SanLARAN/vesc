import React from 'react';
import { AlertTriangle, ArrowLeft, BatteryCharging, Zap } from 'lucide-react';
import type { SpeedMilestone } from './WidgetGrid';

type LampLevel = 'ok' | 'warning' | 'error';

interface HudViewProps {
  speedKmh: number;
  accelerationTimes: Record<SpeedMilestone, number | null>;
  frontLevel: LampLevel;
  rearLevel: LampLevel;
  frontDetail: string;
  rearDetail: string;
  brakeActive: boolean;
  regenAmps: number;
  powerKw: number;
  batteryPct: number;
  packVoltage: number;
  estimatedRangeKm: number;
  connectionLabel: string;
  alerts: { level: 'warning' | 'error'; text: string }[];
  onExit: () => void;
}

const Lamp: React.FC<{ side: 'ПЕРЕД' | 'ЗАД'; level: LampLevel; detail: string }> = ({ side, level, detail }) => (
  <div className="flex w-16 shrink-0 flex-col items-center gap-2 sm:w-24" title={`${side}: ${detail}`} aria-label={`${side}: ${detail}`}>
    <AlertTriangle className={`h-8 w-8 sm:h-11 sm:w-11 ${level === 'error' ? 'animate-pulse text-white' : level === 'warning' ? 'text-white/70' : 'text-white/20'}`} strokeWidth={2.5} />
    <span className={`text-[9px] sm:text-[11px] font-black tracking-[0.18em] ${level === 'error' ? 'text-white' : level === 'warning' ? 'text-white/70' : 'text-white/25'}`}>{side}</span>
  </div>
);

const HudView: React.FC<HudViewProps> = ({
  speedKmh,
  accelerationTimes,
  frontLevel,
  rearLevel,
  frontDetail,
  rearDetail,
  brakeActive,
  regenAmps,
  powerKw,
  batteryPct,
  packVoltage,
  estimatedRangeKm,
  connectionLabel,
  alerts,
  onExit,
}) => {
  const milestones: SpeedMilestone[] = [30, 60, 75, 90, 100];
  const percent = Math.max(0, Math.min(100, batteryPct));
  const errorList = [...alerts].sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error')).slice(0, 2);

  return (
    <div className="hud-screen min-h-[100svh] w-full bg-black px-3 pb-5 pt-[max(0.75rem,env(safe-area-inset-top))] text-white sm:px-8 sm:pb-8 sm:pt-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:gap-5">
        <header className="flex items-center justify-between border-b border-white/15 pb-2 sm:pb-3">
          <div>
            <div className="text-[10px] font-black tracking-[0.24em] text-white/80 sm:text-xs">ACHILLEUS <span className="text-white/35">/ HUD</span></div>
            <div className="mt-1 text-[8px] font-semibold tracking-[0.18em] text-white/40 sm:text-[10px]">{connectionLabel}</div>
          </div>
          <button type="button" className="hud-control flex items-center gap-1.5 border border-white/40 px-2.5 py-1.5 text-[9px] font-bold tracking-wider text-white/80 sm:px-3 sm:py-2 sm:text-[10px]" onClick={onExit}>
            <ArrowLeft className="h-3 w-3" /> ПРИБОРКА
          </button>
        </header>

        <section className="flex min-h-[34vh] items-center justify-center gap-1 sm:min-h-[42vh] sm:gap-4" aria-label="Скорость и ошибки">
          <Lamp side="ПЕРЕД" level={frontLevel} detail={frontDetail} />
          <div className="min-w-0 flex-1 text-center">
            <div className="mb-1 text-[9px] font-semibold tracking-[0.28em] text-white/45 sm:text-xs">СКОРОСТЬ</div>
            <div className="flex items-baseline justify-center gap-2 sm:gap-4">
              <span className="tabular-nums text-[clamp(5.5rem,26vw,14rem)] font-light leading-[0.82] tracking-[-0.09em]">
                {Math.abs(speedKmh).toFixed(Math.abs(speedKmh) < 10 ? 1 : 0)}
              </span>
              <span className="text-xs font-bold tracking-[0.18em] text-white/50 sm:text-xl">КМ/Ч</span>
            </div>
            <div className="mt-3 text-[8px] font-bold tracking-[0.2em] text-white/30 sm:text-[10px]">2× VESC • 60V 16S</div>
          </div>
          <Lamp side="ЗАД" level={rearLevel} detail={rearDetail} />
        </section>

        <section aria-label="Динамика разгона" className="grid grid-cols-5 border-y border-white/15 bg-white/[0.025]">
          {milestones.map((target) => {
            const value = accelerationTimes[target];
            return (
              <div key={target} className="flex flex-col items-center justify-center border-r border-white/10 py-2 last:border-0 sm:py-3">
                <span className="text-[8px] font-bold tracking-tight text-white/45 sm:text-xs">0–{target}</span>
                <span className={`mt-1 tabular-nums text-[11px] font-extrabold sm:text-lg ${value === null ? 'text-white/25' : 'text-white'}`}>
                  {value === null ? '—' : `${value.toFixed(2)}с`}
                </span>
              </div>
            );
          })}
        </section>

        {errorList.length > 0 && (
          <section aria-live="assertive" className="space-y-1.5">
            {errorList.map((alert, index) => (
              <div key={`${alert.level}-${index}`} role={alert.level === 'error' ? 'alert' : 'status'} className={`border-l-2 px-3 py-2 text-[10px] font-bold sm:text-xs ${alert.level === 'error' ? 'border-white bg-white/10 text-white' : 'border-white/50 bg-white/[0.03] text-white/70'}`}>
                {alert.level === 'error' ? 'ОШИБКА' : 'ВНИМАНИЕ'} • {alert.text}
              </div>
            ))}
          </section>
        )}

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" aria-label="Тормоз, мощность, заряд и запас хода">
          <div className={`border p-3 sm:p-4 ${brakeActive ? 'border-white bg-white/10' : 'border-white/15 bg-white/[0.025]'}`}>
            <div className={`flex items-center gap-2 text-[9px] font-bold tracking-[0.16em] sm:text-[10px] ${brakeActive ? 'text-white' : 'text-white/45'}`}>
              <BatteryCharging className="h-3.5 w-3.5" /> ТОРМОЗ / РЕКУП
            </div>
            <div className={`mt-2 tabular-nums text-base font-black sm:text-xl ${brakeActive ? 'text-white' : 'text-white/35'}`}>
              {brakeActive ? `АКТИВЕН • ${Math.abs(regenAmps).toFixed(1)}А` : 'НЕ АКТИВЕН'}
            </div>
            <div className="mt-1 text-[8px] text-white/30 sm:text-[9px]">По рекуперативному току VESC</div>
          </div>

          <div className="border border-white/15 bg-white/[0.025] p-3 sm:p-4">
            <div className="flex items-center gap-2 text-[9px] font-bold tracking-[0.16em] text-white/45 sm:text-[10px]">
              <Zap className="h-3.5 w-3.5" /> МОЩНОСТЬ
            </div>
            <div className="mt-2 tabular-nums text-2xl font-light sm:text-3xl">{powerKw.toFixed(1)} <span className="text-xs font-bold text-white/50">кВт</span></div>
          </div>

          <div className="border border-white/15 bg-white/[0.025] p-3 sm:p-4">
            <div className="flex items-center justify-between text-[9px] font-bold tracking-[0.16em] text-white/45 sm:text-[10px]">
              <span>ЗАРЯД</span><span className="tabular-nums">{packVoltage > 0 ? `${packVoltage.toFixed(1)}В` : '—'}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="tabular-nums text-2xl font-light sm:text-3xl">{Math.round(percent)}</span>
              <span className="text-xs font-bold text-white/50">%</span>
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/10"><div className="h-full bg-white transition-[width] duration-500" style={{ width: `${percent}%` }} /></div>
          </div>

          <div className="border border-white/15 bg-white/[0.025] p-3 sm:p-4">
            <div className="text-[9px] font-bold tracking-[0.16em] text-white/45 sm:text-[10px]">ОСТАЛОСЬ</div>
            <div className="mt-2 tabular-nums text-2xl font-light sm:text-3xl">~{Math.max(0, Math.round(estimatedRangeKm))} <span className="text-xs font-bold text-white/50">км</span></div>
            <div className="mt-1 text-[8px] text-white/30 sm:text-[9px]">Оценка по текущему расходу</div>
          </div>
        </section>

        <div className="pb-1 text-center text-[8px] text-white/25 sm:text-[9px]">
          HUD не управляет приводом. Тормозной индикатор отражает рекуперацию VESC; механический тормоз без датчика не определяется.
        </div>
      </div>
    </div>
  );
};

export default HudView;
