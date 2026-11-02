import React, { useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  PrimaryHeroMetric,
  RideProfile,
  TractionDriveMode,
} from '../state/dashboardConfig';
import type { SpeedMilestone } from './WidgetGrid';

type IndicatorLevel = 'ok' | 'warning' | 'error';

const ControllerIndicator: React.FC<{ side: 'ПЕРЕД' | 'ЗАД'; level: IndicatorLevel; detail: string }> = ({ side, level, detail }) => (
  <div className="flex w-12 shrink-0 flex-col items-center gap-1 sm:w-16" aria-label={`${side}: ${detail}`} title={`${side}: ${detail}`}>
    <AlertTriangle
      aria-hidden="true"
      className={`h-6 w-6 sm:h-8 sm:w-8 ${
        level === 'error'
          ? 'text-red-600 animate-pulse'
          : level === 'warning'
          ? 'text-orange-500'
          : 'text-[var(--fg-faint)]'
      }`}
      strokeWidth={2.5}
    />
    <span className={`text-[8px] sm:text-[9px] font-extrabold tracking-[0.12em] ${level === 'error' ? 'text-red-600' : level === 'warning' ? 'text-orange-500' : 'text-[var(--fg-faint)]'}`}>
      {side}
    </span>
  </div>
);

interface HeroClusterProps {
  metric: PrimaryHeroMetric;
  speedKmh: number;
  powerWatts: number;
  motorRpm: number;
  dutyPct: number;
  fwCurrentAmps: number; // |avgId| max between Master & Slave
  perEscBattAmps: number;
  maxSpeedTripKmh: number;
  tripDistanceKm: number;
  rideDurationText: string;
  isRegen: boolean;
  isReverse: boolean;
  anyFault: boolean;
  faultSummary: string;
  accelerationTimes: Record<SpeedMilestone, number | null>;
  frontIndicatorLevel: IndicatorLevel;
  rearIndicatorLevel: IndicatorLevel;
  frontIndicatorDetail: string;
  rearIndicatorDetail: string;
  fontLarge: boolean;
  showSubStats: boolean;
  showProfiles: boolean;
  tractionMode: TractionDriveMode;
  onCycleTraction: () => void;
  limit25Active: boolean;
  onToggleLimit25: () => void;
  parked: boolean;
  onTogglePark: () => void;
  profiles: RideProfile[];
  activeProfileId: string;
  onSelectProfile: (id: string) => void;
}

export const HeroCluster: React.FC<HeroClusterProps> = ({
  metric,
  speedKmh,
  powerWatts,
  motorRpm,
  dutyPct,
  fwCurrentAmps,
  perEscBattAmps,
  maxSpeedTripKmh,
  tripDistanceKm,
  rideDurationText,
  isRegen,
  isReverse,
  anyFault,
  faultSummary,
  accelerationTimes,
  frontIndicatorLevel,
  rearIndicatorLevel,
  frontIndicatorDetail,
  rearIndicatorDetail,
  fontLarge,
  showSubStats,
  showProfiles,
  tractionMode,
  onCycleTraction,
  limit25Active,
  onToggleLimit25,
  parked,
  onTogglePark,
  profiles,
  activeProfileId,
  onSelectProfile,
}) => {
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const maxRefWatts = Math.max(600, limit25Active ? 900 : activeProfile?.maxWatts ?? 5800);
  const powerRatio = Math.max(-1, Math.min(1, powerWatts / maxRefWatts));
  const fwActive = fwCurrentAmps >= 0.8;

  let mainNumber = parked
    ? 'P'
    : Math.abs(speedKmh).toFixed(Math.abs(speedKmh) < 10 ? 1 : 0);
  let mainUnit = parked ? 'ПАРКИНГ' : 'КМ/Ч';
  let mainLabel = parked ? 'УДЕРЖАНИЕ МОТОР-КОЛЁС' : 'ACHILLEUS • СКОРОСТЬ';

  if (!parked) {
    if (metric === 'power') {
      mainNumber =
        Math.abs(powerWatts) >= 1000
          ? (powerWatts / 1000).toFixed(2)
          : `${Math.round(powerWatts)}`;
      mainUnit = Math.abs(powerWatts) >= 1000 ? 'КВТ' : 'ВТ';
      mainLabel = 'МОЩНОСТЬ 16S';
    } else if (metric === 'rpm') {
      mainNumber = `${Math.abs(Math.round(motorRpm))}`;
      mainUnit = 'ОБ/МИН';
      mainLabel = 'ОБОРОТЫ КОЛЕСА';
    } else if (metric === 'duty') {
      mainNumber = `${Math.round(dutyPct)}`;
      mainUnit = '%';
      mainLabel = 'СКВАЖНОСТЬ FOC';
    }
  }

  const tractionTitle =
    tractionMode === '2wd'
      ? '2WD DUAL'
      : tractionMode === '1wd_front_hall'
      ? '1WD ПЕРЕД (HALL)'
      : '1WD ЗАД (SL)';

  const tractionSub =
    tractionMode === '2wd'
      ? 'ID0 Hall + ID1 SL'
      : tractionMode === '1wd_front_hall'
      ? 'Только Master ID0'
      : 'Только Slave ID1';

  const [milestonesExpanded, setMilestonesExpanded] = useState(false);
  const lastPointerUpRef = useRef(0);
  const toggleMilestones = () => setMilestonesExpanded((value) => !value);
  const handleSpeedPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const now = performance.now();
    if (now - lastPointerUpRef.current < 360) {
      toggleMilestones();
      lastPointerUpRef.current = 0;
    } else {
      lastPointerUpRef.current = now;
    }
  };
  const milestoneTargets: SpeedMilestone[] = [30, 60, 75, 90, 100];

  return (
    <section className="border border-[var(--line)] bg-[var(--bg-surface)]">
      {anyFault && (
        <div className="flex items-center justify-between bg-[var(--inv-bg)] px-4 py-2 text-xs font-bold tracking-wider uppercase text-[var(--inv-fg)]">
          <span>ЗАЩИТА VESC</span>
          <span>{faultSummary}</span>
        </div>
      )}

      {/* Power / Regen Scale Bar */}
      <div className="border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex items-center justify-between text-[10px] font-semibold tracking-widest uppercase text-[var(--fg-muted)]">
          <span>{isRegen ? '◀ РЕКУПЕРАЦИЯ -60А' : '◀ РЕКУП'}</span>
          <span className="tabular-nums text-[var(--fg)]">
            {powerWatts >= 0
              ? `${(powerWatts / 1000).toFixed(2)} КВТ (${Math.round(powerWatts)} ВТ)`
              : `ЗАРЯД ${Math.round(powerWatts)} ВТ`}
          </span>
          <span>BMS {perEscBattAmps * 2}А MAX ▶</span>
        </div>

        <div className="relative mt-2 h-2.5 w-full bg-[var(--bg-subtle)]">
          <div className="absolute left-[26%] top-0 z-10 h-full w-0.5 bg-[var(--fg)]" />
          <div className="pointer-events-none absolute inset-0 flex justify-between px-1">
            {Array.from({ length: 19 }).map((_, i) => (
              <span key={i} className="h-full w-px bg-[var(--line)]" />
            ))}
          </div>
          {powerRatio >= 0 ? (
            <div
              className="absolute top-0 h-full bg-[var(--fg)] transition-all duration-75"
              style={{
                left: '26%',
                width: `${Math.min(74, powerRatio * 74)}%`,
              }}
            />
          ) : (
            <div
              className="absolute top-0 h-full bg-[var(--fg)] opacity-80 transition-all duration-75"
              style={{
                left: `${26 - Math.min(26, Math.abs(powerRatio) * 65)}%`,
                width: `${Math.min(26, Math.abs(powerRatio) * 65)}%`,
              }}
            />
          )}
        </div>
      </div>

      {/* Main Handlebar Digital Speedometer + twin controller warning lamps */}
      <div className="flex items-center justify-center gap-1 border-b border-[var(--line)] px-1 py-4 sm:gap-3 sm:py-6">
        <ControllerIndicator side="ПЕРЕД" level={frontIndicatorLevel} detail={frontIndicatorDetail} />
        <div
          className="min-w-0 flex-1 text-center select-none"
          role="button"
          tabIndex={0}
          aria-expanded={milestonesExpanded}
          aria-controls="acceleration-milestones"
          aria-label="Спидометр. Дважды коснитесь для замеров разгона"
          title="Двойное касание — показать или скрыть замеры разгона"
          onPointerUp={handleSpeedPointerUp}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleMilestones();
            }
          }}
        >
        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--fg-muted)]">
          <span>{mainLabel}</span>
          {fwActive && (
            <span className="bg-[var(--inv-bg)] px-1.5 py-0.5 text-[9px] font-extrabold tracking-widest text-[var(--inv-fg)]">
              FW -{fwCurrentAmps.toFixed(1)}А
            </span>
          )}
          {limit25Active && (
            <span className="bg-[var(--inv-bg)] px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--inv-fg)]">
              ЛИМИТ 25
            </span>
          )}
          {isReverse && (
            <span className="bg-[var(--inv-bg)] px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--inv-fg)]">
              РЕВЕРС
            </span>
          )}
          {isRegen && (
            <span className="border border-[var(--fg)] px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--fg)]">
              РЕКУП
            </span>
          )}
        </div>

        <div className="mt-1 flex items-baseline justify-center gap-2.5">
          <span
            className={`tabular-nums leading-none font-semibold tracking-tighter text-[var(--fg)] transition-[font-size] duration-300 ease-out ${
              milestonesExpanded
                ? 'text-[52px] sm:text-[68px]'
                : fontLarge
                ? 'text-[84px] sm:text-[116px]'
                : 'text-[64px] sm:text-[84px]'
            }`}
          >
            {mainNumber}
          </span>
          <span className="text-sm sm:text-base font-medium tracking-widest uppercase text-[var(--fg-muted)]">
            {mainUnit}
          </span>
        </div>

        <span className="mt-1 block text-[9px] tracking-widest uppercase text-[var(--fg-faint)]">
          ACHILLEUS 16S • ЭТАП {perEscBattAmps}А×2 ({perEscBattAmps * 2}А) • {tractionTitle}
        </span>
        <div
          id="acceleration-milestones"
          aria-hidden={!milestonesExpanded}
          className={`grid transition-[grid-template-rows,opacity,margin] duration-500 ease-out ${milestonesExpanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-5 border-y border-[var(--line)] bg-[var(--bg)]">
              {milestoneTargets.map((target) => {
                const best = accelerationTimes[target];
                return (
                  <div key={target} className="flex min-w-0 flex-col items-center justify-center border-r border-[var(--line)] px-0.5 py-2 last:border-r-0">
                    <span className="text-[8px] sm:text-[10px] font-bold tracking-tight text-[var(--fg-muted)]">0–{target}</span>
                    <span className={`mt-1 tabular-nums text-[10px] sm:text-sm font-extrabold ${best === null ? 'text-[var(--fg-faint)]' : 'text-[var(--fg)]'}`}>
                      {best === null ? '—' : `${best.toFixed(2)}с`}
                    </span>
                    <span className="text-[7px] sm:text-[8px] uppercase text-[var(--fg-faint)]">км/ч</span>
                  </div>
                );
              })}
            </div>
            <div className="pt-1 text-[8px] tracking-widest uppercase text-[var(--fg-faint)]">Лучший замер • двойное касание — скрыть</div>
          </div>
        </div>
        {!milestonesExpanded && (
          <span className="mt-1 block text-[8px] tracking-wider uppercase text-[var(--fg-faint)]">Двойное касание • замеры разгона</span>
        )}
        </div>
        <ControllerIndicator side="ЗАД" level={rearIndicatorLevel} detail={rearIndicatorDetail} />
      </div>

      {/* Handlebar Tactical Controls */}
      <div className="grid grid-cols-3 gap-px border-t border-[var(--line)] bg-[var(--line)]">
        <button
          type="button"
          onClick={onCycleTraction}
          className={`flex flex-col items-center justify-center py-2.5 px-2 transition-colors cursor-pointer ${
            tractionMode === '2wd'
              ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
              : 'bg-[var(--bg)] text-[var(--fg)]'
          }`}
        >
          <span className="text-[11px] font-extrabold tracking-wider uppercase">
            {tractionTitle}
          </span>
          <span className="text-[9px] opacity-75">{tractionSub}</span>
        </button>

        <button
          type="button"
          onClick={onToggleLimit25}
          className={`flex flex-col items-center justify-center py-2.5 px-2 transition-colors cursor-pointer ${
            limit25Active
              ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
              : 'bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
          }`}
        >
          <span className="text-[11px] font-extrabold tracking-wider uppercase">
            {limit25Active ? 'ЛИМИТ 25 ВКЛ' : 'ДУШИЛКА 25 КМ/Ч'}
          </span>
          <span className="text-[9px] opacity-75">Тротуар / СИМ</span>
        </button>

        <button
          type="button"
          onClick={onTogglePark}
          className={`flex flex-col items-center justify-center py-2.5 px-2 transition-colors cursor-pointer ${
            parked
              ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
              : 'bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
          }`}
        >
          <span className="text-[11px] font-extrabold tracking-wider uppercase">
            {parked ? 'ПАРКИНГ [P] ВКЛ' : 'ПАРКИНГ [P]'}
          </span>
          <span className="text-[9px] opacity-75">Удержание + Блок</span>
        </button>
      </div>

      {/* Trip Bar */}
      {showSubStats && (
        <div className="grid grid-cols-4 gap-px border-t border-[var(--line)] bg-[var(--line)]">
          {[
            { label: 'ПРОБЕГ', val: `${tripDistanceKm.toFixed(2)}`, unit: 'км' },
            { label: 'МАКС СКОР', val: `${maxSpeedTripKmh.toFixed(1)}`, unit: 'км/ч' },
            { label: 'В ПУТИ', val: rideDurationText, unit: '' },
            {
              label: 'ПОТОЛОК',
              val: `${limit25Active ? 25 : activeProfile?.maxSpeedKmh ?? 95}`,
              unit: 'км/ч',
            },
          ].map((item, idx) => (
            <div key={idx} className="bg-[var(--bg-surface)] px-2.5 py-2 text-center">
              <div className="text-[9px] font-medium tracking-widest uppercase text-[var(--fg-muted)]">
                {item.label}
              </div>
              <div className="tabular-nums mt-0.5 text-sm sm:text-base font-semibold text-[var(--fg)]">
                {item.val}
                {item.unit && (
                  <span className="ml-1 text-[10px] font-normal text-[var(--fg-muted)]">
                    {item.unit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4 Editable Achilleus Ride Profiles */}
      {showProfiles && (
        <div className="grid grid-cols-4 gap-px border-t border-[var(--line)] bg-[var(--line)]">
          {profiles.map((p) => {
            const active = !limit25Active && p.id === activeProfileId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProfile(p.id)}
                className={`flex flex-col items-center justify-center px-2 py-3 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                    : 'bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                }`}
              >
                <span className="text-[11px] sm:text-xs font-bold tracking-wider uppercase">
                  {p.name}
                </span>
                <span
                  className={`tabular-nums mt-0.5 text-[10px] ${
                    active ? 'opacity-80' : 'text-[var(--fg-faint)]'
                  }`}
                >
                  {(p.maxWatts / 1000).toFixed(1)} кВт • {p.maxBattAmps}А
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
