import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Battery, ChevronLeft, ChevronRight, Thermometer } from 'lucide-react';
import type { SpeedMilestone } from './WidgetGrid';
import { RouteRecorder } from './RouteRecorder';

type LampLevel = 'ok' | 'warning' | 'error';

interface HudViewProps {
  speedometerStyle: 'classic' | 'cyberpunk';
  speedSource: 'vesc' | 'gps';
  speedAvailable: boolean;
  speedKmh: number;
  frontErpm: number;
  rearErpm: number;
  frontDataAvailable: boolean;
  rearDataAvailable: boolean;
  fwFrontAmps: number;
  fwRearAmps: number;
  ampHoursConsumed: number;
  ampHoursRegen: number;
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

const SideStatus: React.FC<{ side: 'ПЕРЕД' | 'ЗАД'; level: LampLevel; detail: string }> = ({ side, level, detail }) => (
  <span title={`${side}: ${detail}`} className={`flex items-center gap-1 text-[8px] font-black tracking-wider sm:text-[9px] ${level === 'error' ? 'text-red-500' : level === 'warning' ? 'text-amber-400' : 'text-white/30'}`}>
    <AlertTriangle className="h-3 w-3" />{side === 'ПЕРЕД' ? 'П' : 'З'}
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
  speedometerStyle,
  speedSource,
  speedAvailable,
  speedKmh,
  frontErpm,
  rearErpm,
  frontDataAvailable,
  rearDataAvailable,
  fwFrontAmps,
  fwRearAmps,
  ampHoursConsumed,
  ampHoursRegen,
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
  const isCyberpunk = speedometerStyle === 'cyberpunk';
  const errorList = [...alerts].sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error')).slice(0, 2);
  const batteryColor = percent < 20 ? 'text-red-500' : percent <= 50 ? 'text-amber-400' : 'text-emerald-500';
  const batteryBarColor = brakeActive
    ? 'animate-pulse bg-emerald-400'
    : percent < 20 ? 'bg-red-500' : percent <= 50 ? 'bg-amber-400' : 'bg-emerald-500';
  const erpmDifference = frontDataAvailable && rearDataAvailable
    ? Math.abs(Math.abs(frontErpm) - Math.abs(rearErpm))
    : null;
  const possibleWheelSlip = erpmDifference !== null && erpmDifference > 3000;
  const [mapOpen, setMapOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      if (dx < 0) {
        setAdvancedOpen(false);
        setMapOpen(true);
      } else if (mapOpen) {
        setMapOpen(false);
      } else if (advancedOpen) {
        setAdvancedOpen(false);
      } else {
        setAdvancedOpen(true);
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  return (
    <div className={`hud-screen h-[100svh] w-full overflow-hidden bg-black px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] text-white sm:px-6 sm:pb-3 sm:pt-3 ${isCyberpunk ? 'cyberpunk-hud' : ''}`}>
      <div className="mx-auto grid h-full w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] gap-2 sm:gap-3">
        <header className="border-b border-white/15 pb-1.5 sm:pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className={`flex shrink-0 items-center gap-1 ${batteryColor}`} title={`Заряд батареи ${Math.round(percent)}%`}>
                <Battery className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.2} />
                <span className="tabular-nums text-sm font-bold">{Math.round(percent)}%</span>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black tracking-[0.18em] text-white/85 sm:text-xs">ACHILLEUS</div>
                <div className="truncate text-[8px] text-white/35 sm:text-[9px]">{connectionLabel}</div>
              </div>
            </div>
            <button type="button" className="hud-control flex shrink-0 items-center gap-1 border border-white/30 px-2.5 py-1.5 text-[9px] font-bold tracking-wider text-white/75 sm:px-3 sm:text-[10px]" onClick={onExit}>
              <ArrowLeft className="h-3 w-3" /> ВЫХОД
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5" aria-label="Состояние контроллеров и температур">
            <SideStatus side="ПЕРЕД" level={frontLevel} detail={frontDetail} />
            <SideStatus side="ЗАД" level={rearLevel} detail={rearDetail} />
            <TempLight label="FП" temp={frontFetTemp} warningAt={fetWarnTemp} criticalAt={fetWarnTemp + 20} />
            <TempLight label="FЗ" temp={rearFetTemp} warningAt={fetWarnTemp} criticalAt={fetWarnTemp + 20} />
            <TempLight label="MП" temp={frontMotorTemp} warningAt={motorWarnTemp} criticalAt={motorWarnTemp + 15} />
            <TempLight label="MЗ" temp={rearMotorTemp} warningAt={motorWarnTemp} criticalAt={motorWarnTemp + 15} />
          </div>
        </header>

        <section
          className={`hud-cyber-viewport relative min-h-0 overflow-hidden ${isCyberpunk ? 'is-cyber' : ''}`}
          aria-label="Скорость и карта. Свайп влево — карта, вправо — детали"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className={`absolute inset-y-0 left-0 z-10 flex items-center justify-center transition-[width,transform,opacity] duration-500 ease-in-out ${mapOpen ? 'w-[42%]' : advancedOpen ? 'w-full -translate-x-full opacity-0' : 'w-full'}`}>
            <div className="min-w-0 text-center">
              <div className={`mb-1 text-[9px] font-semibold tracking-[0.22em] text-white/40 sm:text-xs ${isCyberpunk ? 'hud-cyber-caption' : ''}`}>{!speedAvailable ? `ОЖИДАНИЕ ${speedSource.toUpperCase()}` : speedSource === 'gps' ? 'СКОРОСТЬ GPS' : 'СКОРОСТЬ VESC'}</div>
              <div className="flex items-baseline justify-center gap-1.5 sm:gap-3">
                <span className={`tabular-nums font-light leading-[0.82] tracking-[-0.09em] transition-[font-size] duration-500 ${mapOpen ? 'text-[clamp(3.25rem,13vh,7rem)]' : 'text-[clamp(5rem,26vh,14rem)]'} ${isCyberpunk ? 'hud-cyber-number' : ''}`}>
                  {speedAvailable ? Math.abs(speedKmh).toFixed(Math.abs(speedKmh) < 10 ? 1 : 0) : '—'}
                </span>
                <span className="text-[9px] font-bold tracking-wider text-white/45 sm:text-base">КМ/Ч</span>
              </div>
              <div className="mt-3 flex items-center justify-center gap-3 text-[8px] font-bold tracking-wider text-white/35 sm:text-[10px]">
                <span className={frontLevel === 'error' ? 'text-red-500' : frontLevel === 'warning' ? 'text-amber-400' : ''} title={`Передний контроллер: ${frontDetail}`}>ПЕРЕД ●</span>
                <span className={rearLevel === 'error' ? 'text-red-500' : rearLevel === 'warning' ? 'text-amber-400' : ''} title={`Задний контроллер: ${rearDetail}`}>ЗАД ●</span>
              </div>
            </div>
          </div>

          {errorList.length > 0 && !advancedOpen && (
            <div className="absolute left-1/2 top-2 z-20 w-[min(92%,34rem)] -translate-x-1/2 space-y-1" aria-live="assertive">
              {errorList.map((alert, index) => (
                <div key={`${alert.level}-${index}`} role={alert.level === 'error' ? 'alert' : 'status'} className={`truncate border-l-2 px-2 py-1.5 text-[9px] font-bold sm:text-xs ${alert.level === 'error' ? 'border-red-500 bg-red-950/75 text-red-200' : 'border-amber-400 bg-amber-950/75 text-amber-100'}`}>
                  {alert.level === 'error' ? 'ОШИБКА' : 'ВНИМАНИЕ'} · {alert.text}
                </div>
              ))}
            </div>
          )}

          <div className={`hud-map-panel absolute inset-y-0 right-0 z-20 w-[58%] transition-transform duration-500 ease-in-out ${mapOpen && !advancedOpen ? 'translate-x-0' : 'translate-x-[105%]'}`}>
            <div className="pointer-events-none absolute inset-y-0 left-0 z-30 w-8 bg-gradient-to-r from-black via-black/75 to-transparent sm:w-14" />
            <div className="h-full overflow-hidden border-y border-l border-white/20 bg-black/95 shadow-[-20px_0_45px_rgba(0,0,0,0.6)]">
              <RouteRecorder apiKey={mapsApiKey} onIssue={onRouteIssue} hudCompact speedKmh={recordedSpeedKmh} powerKw={recordedPowerKw} />
            </div>
          </div>

          <div className={`absolute inset-0 z-30 transition-[transform,opacity] duration-400 ease-out ${advancedOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'}`} aria-hidden={!advancedOpen}>
            <div className={`hud-details-panel flex h-full flex-col border border-white/15 bg-black/95 p-2 sm:p-4 ${isCyberpunk ? 'hud-cyber-details' : ''}`}>
              <div className="mb-1.5 flex items-center justify-between border-b border-white/15 pb-1.5">
                <div className="text-[9px] font-black tracking-[0.15em] text-white/75 sm:text-xs">ДЕТАЛИ ПОЕЗДКИ</div>
                <span className="text-[7px] font-bold tracking-wider text-white/30 sm:text-[9px]">VESC · 0 / 1</span>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5 sm:gap-2">
                <div className={`hud-detail-tile flex flex-col justify-between border border-white/15 bg-white/[0.025] p-1.5 sm:p-2.5 ${isCyberpunk ? 'hud-cyber-tile' : ''}`}>
                  <span className="text-[7px] font-bold tracking-wider text-white/45 sm:text-[9px]">ERPM · ПЕРЕД</span>
                  <span className="tabular-nums text-sm font-semibold sm:text-xl">{frontDataAvailable ? Math.round(frontErpm).toLocaleString('ru-RU') : '—'}</span>
                </div>
                <div className={`hud-detail-tile flex flex-col justify-between border border-white/15 bg-white/[0.025] p-1.5 sm:p-2.5 ${isCyberpunk ? 'hud-cyber-tile' : ''}`}>
                  <span className="text-[7px] font-bold tracking-wider text-white/45 sm:text-[9px]">ERPM · ЗАД</span>
                  <span className="tabular-nums text-sm font-semibold sm:text-xl">{rearDataAvailable ? Math.round(rearErpm).toLocaleString('ru-RU') : '—'}</span>
                </div>
                <div className={`hud-detail-tile flex flex-col justify-between border p-1.5 sm:p-2.5 ${possibleWheelSlip ? 'hud-slip-warning border-amber-400/70 bg-amber-950/20' : 'border-white/15 bg-white/[0.025]'} ${isCyberpunk && !possibleWheelSlip ? 'hud-cyber-tile' : ''}`}>
                  <span className="text-[7px] font-bold tracking-wider text-white/45 sm:text-[9px]">РАЗНИЦА ERPM</span>
                  <span className={`tabular-nums text-sm font-semibold sm:text-xl ${possibleWheelSlip ? 'text-amber-300' : 'text-white/60'}`}>
                    {erpmDifference === null ? '—' : Math.round(erpmDifference).toLocaleString('ru-RU')}
                  </span>
                  <span className={`text-[6px] font-bold sm:text-[8px] ${possibleWheelSlip ? 'text-amber-300' : 'text-white/25'}`}>
                    {possibleWheelSlip ? 'ВОЗМОЖНА ПРОБУКСОВКА' : 'ПОРОГ 3 000'}
                  </span>
                </div>
                <div className={`hud-detail-tile flex flex-col justify-between border border-white/15 bg-white/[0.025] p-1.5 sm:p-2.5 ${isCyberpunk ? 'hud-cyber-tile' : ''}`}>
                  <span className="text-[7px] font-bold tracking-wider text-white/45 sm:text-[9px]">FW ТОК · ПЕРЕД / ЗАД</span>
                  <span className="tabular-nums text-xs font-semibold sm:text-lg">
                    {frontDataAvailable ? fwFrontAmps.toFixed(1) : '—'} / {rearDataAvailable ? fwRearAmps.toFixed(1) : '—'} <span className="text-[8px] text-white/45">А</span>
                  </span>
                </div>
                <div className={`hud-detail-tile flex flex-col justify-between border border-white/15 bg-white/[0.025] p-1.5 sm:p-2.5 ${isCyberpunk ? 'hud-cyber-tile' : ''}`}>
                  <span className="text-[7px] font-bold tracking-wider text-white/45 sm:text-[9px]">РАСХОД</span>
                  <span className="tabular-nums text-sm font-semibold sm:text-xl">{ampHoursConsumed.toFixed(2)} <span className="text-[8px] text-white/45">А·ч</span></span>
                </div>
                <div className={`hud-detail-tile flex flex-col justify-between border p-1.5 sm:p-2.5 ${brakeActive ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-white/15 bg-white/[0.025]'} ${isCyberpunk && !brakeActive ? 'hud-cyber-tile' : ''}`}>
                  <span className={`text-[7px] font-bold tracking-wider sm:text-[9px] ${brakeActive ? 'text-emerald-400' : 'text-white/45'}`}>РЕКУПЕРАЦИЯ</span>
                  <span className={`tabular-nums text-sm font-semibold sm:text-xl ${brakeActive ? 'animate-pulse text-emerald-400' : 'text-white/70'}`}>{ampHoursRegen.toFixed(2)} <span className="text-[8px] text-white/45">А·ч</span></span>
                </div>
              </div>
              <div className="mt-1.5 grid grid-cols-5 border-t border-white/10 pt-1 text-center">
                {milestones.map((target) => (
                  <div key={target} className="flex flex-col">
                    <span className="text-[6px] font-bold text-white/30 sm:text-[8px]">0–{target}</span>
                    <span className="tabular-nums text-[8px] text-white/65 sm:text-[10px]">{accelerationTimes[target] === null ? '—' : `${accelerationTimes[target]?.toFixed(2)}с`}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-center text-[6px] text-white/25 sm:text-[8px]">Δ ERPM выше 3 000 — признак возможной пробуксовки; приводом HUD не управляет.</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setMapOpen(!mapOpen || advancedOpen); setAdvancedOpen(false); }}
            className={`hud-overlay-control absolute bottom-1.5 right-1.5 z-40 flex items-center gap-1 border border-white/25 bg-black/85 px-2.5 py-1.5 text-[8px] font-bold tracking-wider text-white/70 ${isCyberpunk ? 'hud-cyber-control' : ''}`}
            aria-label={mapOpen && !advancedOpen ? 'Скрыть карту' : 'Открыть карту'}
          >
            {mapOpen && !advancedOpen ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
            {mapOpen && !advancedOpen ? 'СКОРОСТЬ' : 'КАРТА'}
          </button>
          <button
            type="button"
            onClick={() => { const opening = !advancedOpen; setAdvancedOpen(opening); if (opening) setMapOpen(false); }}
            className={`hud-overlay-control absolute bottom-1.5 left-1.5 z-40 flex items-center gap-1 border border-white/25 bg-black/85 px-2.5 py-1.5 text-[8px] font-bold tracking-wider text-white/70 ${isCyberpunk ? 'hud-cyber-control' : ''}`}
            aria-label={advancedOpen ? 'Вернуться к спидометру' : 'Открыть детали поездки'}
          >
            {advancedOpen ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
            {advancedOpen ? 'СКОРОСТЬ' : 'ДЕТАЛИ'}
          </button>
        </section>

        <section className="grid grid-cols-3 gap-1.5 sm:gap-2.5" aria-label="Основные показатели поездки">
          <div className={`hud-metric-card flex min-h-[66px] flex-col justify-between border border-white/15 bg-white/[0.025] p-2 sm:min-h-[82px] sm:p-3 ${isCyberpunk ? 'hud-cyber-card' : ''}`}>
            <div className="flex items-center justify-between gap-1 text-[8px] font-bold tracking-wider text-white/45 sm:text-[10px]"><span>БАТАРЕЯ</span><span className="tabular-nums">{packVoltage > 0 ? `${packVoltage.toFixed(1)} В` : '—'}</span></div>
            <div className="flex items-baseline gap-0.5"><span className={`tabular-nums text-xl font-light sm:text-3xl ${batteryColor}`}>{Math.round(percent)}</span><span className="text-[9px] text-white/45">%</span></div>
            <div className="h-1 w-full bg-white/10"><div className={`h-full transition-[width,background-color] duration-500 ${batteryBarColor}`} style={{ width: `${percent}%` }} /></div>
          </div>
          <div className={`hud-metric-card flex min-h-[66px] flex-col justify-between border border-white/15 bg-white/[0.025] p-2 sm:min-h-[82px] sm:p-3 ${isCyberpunk ? 'hud-cyber-card' : ''}`}>
            <div className="text-[8px] font-bold tracking-wider text-white/45 sm:text-[10px]">МОЩНОСТЬ</div>
            <div className="tabular-nums text-xl font-light sm:text-3xl">{powerKw.toFixed(1)} <span className="text-[9px] font-bold text-white/45">кВт</span></div>
            <div className={`text-[7px] font-bold sm:text-[9px] ${brakeActive ? 'animate-pulse text-emerald-400' : 'text-white/25'}`}>{brakeActive ? `РЕКУП · ${Math.abs(regenAmps).toFixed(1)} А` : 'МОЩНОСТЬ VESC'}</div>
          </div>
          <div className={`hud-metric-card flex min-h-[66px] flex-col justify-between border border-white/15 bg-white/[0.025] p-2 sm:min-h-[82px] sm:p-3 ${isCyberpunk ? 'hud-cyber-card' : ''}`}>
            <div className="text-[8px] font-bold tracking-wider text-white/45 sm:text-[10px]">ЗАПАС ХОДА</div>
            <div className="tabular-nums text-xl font-light sm:text-3xl">~{Math.max(0, Math.round(estimatedRangeKm))} <span className="text-[9px] font-bold text-white/45">км</span></div>
            <div className="text-[7px] text-white/25 sm:text-[9px]">Оценка по расходу</div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default HudView;
