import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Battery, BatteryCharging, ChevronLeft, ChevronRight, Thermometer, Zap } from 'lucide-react';
import type { SpeedMilestone } from './WidgetGrid';
import { RouteRecorder } from './RouteRecorder';

type LampLevel = 'ok' | 'warning' | 'error';

interface HudViewProps {
  speedKmh: number;
  recordedSpeedKmh?: number;
  recordedPowerKw?: number;
  accelerationTimes: Record<SpeedMilestone, number | null>;
  frontLevel: LampLevel;
  rearLevel: LampLevel;
  frontDetail: string;
  rearDetail: string;
  frontFetTemp: number;
  rearFetTemp: number;
  frontMotorTemp: number;
  rearMotorTemp: number;
  fetWarnTemp: number;
  motorWarnTemp: number;
  brakeActive: boolean;
  regenAmps: number;
  powerKw: number;
  batteryPct: number;
  packVoltage: number;
  estimatedRangeKm: number;
  connectionLabel: string;
  alerts: { level: 'warning' | 'error'; text: string }[];
  mapsApiKey: string;
  onRouteIssue: (message: string | null) => void;
  onExit: () => void;
}

const Lamp: React.FC<{ side: 'ПЕРЕД' | 'ЗАД'; level: LampLevel; detail: string }> = ({ side, level, detail }) => (
  <div className="flex w-14 shrink-0 flex-col items-center gap-2 sm:w-24" title={`${side}: ${detail}`} aria-label={`${side}: ${detail}`}>
    <AlertTriangle className={`h-7 w-7 sm:h-11 sm:w-11 ${level === 'error' ? 'animate-pulse text-red-500' : level === 'warning' ? 'text-amber-400' : 'text-white/25'}`} strokeWidth={2.5} />
    <span className={`text-[9px] sm:text-[11px] font-black tracking-[0.18em] ${level === 'error' ? 'text-red-500' : level === 'warning' ? 'text-amber-400' : 'text-white/30'}`}>{side}</span>
  </div>
);

const SideStatus: React.FC<{ side: 'ПЕРЕД' | 'ЗАД'; level: LampLevel; detail: string }> = ({ side, level, detail }) => (
  <span title={`${side}: ${detail}`} className={`flex items-center gap-1 text-[8px] font-black tracking-wider sm:text-[9px] ${level === 'error' ? 'text-red-500' : level === 'warning' ? 'text-amber-400' : 'text-white/30'}`}>
    <AlertTriangle className="h-3 w-3" />{side}
  </span>
);

const TempLight: React.FC<{ label: string; temp: number; warningAt: number; criticalAt: number }> = ({ label, temp, warningAt, criticalAt }) => {
  const level = temp >= criticalAt ? 'error' : temp >= warningAt ? 'warning' : 'ok';
  return (
    <span title={`${label}: ${temp.toFixed(0)}°C`} className={`flex items-center gap-1 text-[8px] font-bold sm:text-[9px] ${level === 'error' ? 'text-red-500' : level === 'warning' ? 'text-amber-400' : 'text-white/30'}`}>
      <Thermometer className="h-3 w-3" />{label} {temp.toFixed(0)}°
    </span>
  );
};

const HudView: React.FC<HudViewProps> = ({
  speedKmh,
  recordedSpeedKmh,
  recordedPowerKw,
  accelerationTimes,
  frontLevel,
  rearLevel,
  frontDetail,
  rearDetail,
  frontFetTemp,
  rearFetTemp,
  frontMotorTemp,
  rearMotorTemp,
  fetWarnTemp,
  motorWarnTemp,
  brakeActive,
  regenAmps,
  powerKw,
  batteryPct,
  packVoltage,
  estimatedRangeKm,
  connectionLabel,
  alerts,
  mapsApiKey,
  onRouteIssue,
  onExit,
}) => {
  const milestones: SpeedMilestone[] = [30, 60, 75, 90, 100];
  const percent = Math.max(0, Math.min(100, batteryPct));
  const errorList = [...alerts].sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error')).slice(0, 2);
  const batteryColor = percent <= 15 ? 'text-red-500' : percent <= 30 ? 'text-amber-400' : 'text-emerald-400';
  const batteryBarColor = percent <= 15 ? 'bg-red-500' : percent <= 30 ? 'bg-amber-400' : 'bg-emerald-400';
  const [mapOpen, setMapOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.hud-map-panel')) return;
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
    touchStartY.current = event.changedTouches[0]?.clientY ?? null;
  };
  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    const end = event.changedTouches[0];
    if (startX === null || startY === null || !end) return;
    const dx = end.clientX - startX;
    const dy = end.clientY - startY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.25) setMapOpen(dx < 0);
    touchStartX.current = null;
    touchStartY.current = null;
  };

  return (
    <div className="hud-screen min-h-[100svh] w-full overflow-x-hidden bg-black px-3 pb-5 pt-[max(0.75rem,env(safe-area-inset-top))] text-white sm:px-8 sm:pb-8 sm:pt-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:gap-5">
        <header className="flex items-center justify-between border-b border-white/15 pb-2 sm:pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex shrink-0 items-center gap-1.5 ${batteryColor}`} title={`Заряд батареи ${Math.round(percent)}%`}>
              <Battery className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.2} />
              <span className="tabular-nums text-xs font-black sm:text-sm">{Math.round(percent)}%</span>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black tracking-[0.24em] text-white/80 sm:text-xs">ACHILLEUS <span className="text-white/35">/ HUD</span></div>
              <div className="mt-1 truncate text-[8px] font-semibold tracking-[0.12em] text-white/40 sm:text-[10px]">{connectionLabel}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                <SideStatus side="ПЕРЕД" level={frontLevel} detail={frontDetail} />
                <SideStatus side="ЗАД" level={rearLevel} detail={rearDetail} />
                <TempLight label="F ПЕРЕД" temp={frontFetTemp} warningAt={fetWarnTemp} criticalAt={fetWarnTemp + 20} />
                <TempLight label="F ЗАД" temp={rearFetTemp} warningAt={fetWarnTemp} criticalAt={fetWarnTemp + 20} />
                <TempLight label="M ПЕРЕД" temp={frontMotorTemp} warningAt={motorWarnTemp} criticalAt={motorWarnTemp + 15} />
                <TempLight label="M ЗАД" temp={rearMotorTemp} warningAt={motorWarnTemp} criticalAt={motorWarnTemp + 15} />
              </div>
            </div>
          </div>
          <button type="button" className="hud-control ml-2 flex shrink-0 items-center gap-1.5 border border-white/40 px-2.5 py-1.5 text-[9px] font-bold tracking-wider text-white/80 sm:px-3 sm:py-2 sm:text-[10px]" onClick={onExit}>
            <ArrowLeft className="h-3 w-3" /> ПРИБОРКА
          </button>
        </header>

        <section
          className="relative h-[39vh] min-h-[235px] overflow-hidden sm:h-[44vh] sm:min-h-[310px]"
          aria-label="Скорость и карта, проведите влево для карты"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className={`absolute inset-y-0 left-0 z-10 flex items-center justify-center gap-1 transition-[width] duration-700 ease-in-out ${mapOpen ? 'w-[48%]' : 'w-full'}`}>
            <Lamp side="ПЕРЕД" level={frontLevel} detail={frontDetail} />
            <div className="min-w-0 flex-1 text-center">
              <div className="mb-1 text-[9px] font-semibold tracking-[0.28em] text-white/45 sm:text-xs">СКОРОСТЬ</div>
              <div className="flex items-baseline justify-center gap-1 sm:gap-4">
                <span className={`tabular-nums font-light leading-[0.82] tracking-[-0.09em] transition-[font-size] duration-700 ${mapOpen ? 'text-[clamp(4rem,17vw,8.5rem)]' : 'text-[clamp(5.5rem,26vw,14rem)]'}`}>
                  {Math.abs(speedKmh).toFixed(Math.abs(speedKmh) < 10 ? 1 : 0)}
                </span>
                <span className="text-[9px] font-bold tracking-[0.12em] text-white/50 sm:text-xl">КМ/Ч</span>
              </div>
              <div className="mt-3 text-[8px] font-bold tracking-[0.2em] text-white/30 sm:text-[10px]">2× VESC • 60V 16S</div>
            </div>
            {!mapOpen && <Lamp side="ЗАД" level={rearLevel} detail={rearDetail} />}
          </div>

          <div className={`hud-map-panel absolute inset-y-0 right-0 z-20 w-[58%] transition-transform duration-700 ease-in-out ${mapOpen ? 'translate-x-0' : 'translate-x-[105%]'}`}>
            <div className="pointer-events-none absolute inset-y-0 left-0 z-30 w-10 bg-gradient-to-r from-black via-black/75 to-transparent sm:w-16" />
            <div className="h-full overflow-hidden border-y border-l border-white/20 bg-black/90 shadow-[-24px_0_55px_rgba(0,0,0,0.65)]">
              <RouteRecorder apiKey={mapsApiKey} onIssue={onRouteIssue} hudCompact speedKmh={recordedSpeedKmh} powerKw={recordedPowerKw} />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMapOpen((open) => !open)}
            className={`absolute bottom-2 z-40 flex items-center gap-1 border border-white/25 bg-black/85 px-2 py-1.5 text-[8px] font-bold tracking-widest text-white/75 transition-all duration-700 ${mapOpen ? 'right-[59%]' : 'right-2'}`}
            aria-label={mapOpen ? 'Скрыть карту' : 'Открыть карту'}
          >
            {mapOpen ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
            {mapOpen ? 'СКОРОСТЬ' : 'КАРТА'}
          </button>
          {!mapOpen && <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[7px] font-bold tracking-[0.16em] text-white/20 sm:text-[9px]">СВАЙП ВЛЕВО • КАРТА</div>}
        </section>

        <section aria-label="Динамика разгона" className={`grid grid-cols-5 border-y border-white/15 bg-white/[0.025] transition-opacity duration-500 ${mapOpen ? 'opacity-70' : 'opacity-100'}`}>
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
              <div key={`${alert.level}-${index}`} role={alert.level === 'error' ? 'alert' : 'status'} className={`border-l-2 px-3 py-2 text-[10px] font-bold sm:text-xs ${alert.level === 'error' ? 'border-red-500 bg-red-950/30 text-red-300' : 'border-amber-400/70 bg-amber-950/20 text-amber-200'}`}>
                {alert.level === 'error' ? 'ОШИБКА' : 'ВНИМАНИЕ'} • {alert.text}
              </div>
            ))}
          </section>
        )}

        <section className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" aria-label="Тормоз, мощность, заряд и запас хода">
          <div className={`flex min-h-[88px] flex-col justify-between border p-2.5 sm:min-h-[104px] sm:p-4 ${brakeActive ? 'border-amber-400 bg-amber-950/20' : 'border-white/15 bg-white/[0.025]'}`}>
            <div className={`flex items-center gap-2 text-[9px] font-bold tracking-[0.16em] sm:text-[10px] ${brakeActive ? 'text-amber-300' : 'text-white/45'}`}>
              <BatteryCharging className="h-3.5 w-3.5" /> ТОРМОЗ / РЕКУП
            </div>
            <div className={`mt-2 tabular-nums text-base font-black sm:text-xl ${brakeActive ? 'text-amber-300' : 'text-white/35'}`}>
              {brakeActive ? `АКТИВЕН • ${Math.abs(regenAmps).toFixed(1)}А` : 'НЕ АКТИВЕН'}
            </div>
            <div className="mt-1 text-[8px] text-white/30 sm:text-[9px]">По рекуперативному току VESC</div>
          </div>
          <div className="flex min-h-[88px] flex-col justify-between border border-white/15 bg-white/[0.025] p-2.5 sm:min-h-[104px] sm:p-4">
            <div className="flex items-center gap-2 text-[9px] font-bold tracking-[0.16em] text-white/45 sm:text-[10px]"><Zap className="h-3.5 w-3.5" /> МОЩНОСТЬ</div>
            <div className="mt-2 tabular-nums text-2xl font-light sm:text-3xl">{powerKw.toFixed(1)} <span className="text-xs font-bold text-white/50">кВт</span></div>
          </div>
          <div className="flex min-h-[88px] flex-col justify-between border border-white/15 bg-white/[0.025] p-2.5 sm:min-h-[104px] sm:p-4">
            <div className="flex items-center justify-between text-[9px] font-bold tracking-[0.16em] text-white/45 sm:text-[10px]"><span>ЗАРЯД</span><span className="tabular-nums">{packVoltage > 0 ? `${packVoltage.toFixed(1)}В` : '—'}</span></div>
            <div className="mt-2 flex items-baseline gap-1"><span className="tabular-nums text-2xl font-light sm:text-3xl">{Math.round(percent)}</span><span className="text-xs font-bold text-white/50">%</span></div>
            <div className="mt-2 h-1.5 w-full bg-white/10"><div className={`h-full transition-[width,background-color] duration-500 ${batteryBarColor}`} style={{ width: `${percent}%` }} /></div>
          </div>
          <div className="flex min-h-[88px] flex-col justify-between border border-white/15 bg-white/[0.025] p-2.5 sm:min-h-[104px] sm:p-4">
            <div className="text-[9px] font-bold tracking-[0.16em] text-white/45 sm:text-[10px]">ОСТАЛОСЬ</div>
            <div className="mt-2 tabular-nums text-2xl font-light sm:text-3xl">~{Math.max(0, Math.round(estimatedRangeKm))} <span className="text-xs font-bold text-white/50">км</span></div>
            <div className="mt-1 text-[8px] text-white/30 sm:text-[9px]">Оценка по текущему расходу</div>
          </div>
        </section>
        <div className="pb-1 text-center text-[8px] text-white/25 sm:text-[9px]">HUD не управляет приводом. Индикатор тормоза отражает рекуперацию VESC, механический тормоз без датчика не определяется.</div>
      </div>
    </div>
  );
};

export default HudView;
