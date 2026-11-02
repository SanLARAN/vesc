import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Maximize2,
  Minimize2,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { VescFirmwareInfo, VescTelemetry } from '../protocol/vescProtocol';
import { TractionDriveMode, WidgetId, WidgetItemConfig } from '../state/dashboardConfig';

export interface DragRunStats {
  state: 'ready' | 'running' | 'done';
  currentSec: number;
  best0to30Sec: number | null;
  best0to50Sec: number | null;
}

export interface ComputedComputerMetrics {
  packVoltage: number;
  restVoltageEstimate: number;
  voltageSag: number;
  cutoffStartV: number;
  cutoffEndV: number;
  cellCount: number;
  cellVoltage: number;
  batteryPct: number;
  maxBatteryAmpsCap: number;
  estimatedRangeKm: number;
  whPerKm: number;
  tripDistanceKm: number;
  odometerKm: number;
  rideDurationText: string;
  totalPowerWatts: number;
  totalBattCurrent: number;
  netWhUsed: number;
  regenWh: number;
  maxSpeedKmh: number;
  maxPowerWatts: number;
  maxPhaseAmps: number;
  maxBattAmps: number;
  fetWarnTempC: number;
  motorWarnTempC: number;
  powerHistory: number[];
  speedHistory: number[];
  drag: DragRunStats;
}

interface WidgetGridProps {
  widgets: WidgetItemConfig[];
  frontMaster: VescTelemetry; // ID 0: Front Hall Sensors (Master)
  rearSlave: VescTelemetry;   // ID 1: Rear Sensorless (CAN Slave)
  frontFw: VescFirmwareInfo | null;
  rearFw: VescFirmwareInfo | null;
  frontOnline: boolean;
  rearOnline: boolean;
  masterIsFrontHall: boolean;
  tractionMode: TractionDriveMode;
  canSlaveId: number;
  metrics: ComputedComputerMetrics;
  fontLarge: boolean;
  editMode: boolean;
  onMoveWidget: (id: WidgetId, dir: -1 | 1) => void;
  onToggleSpan: (id: WidgetId) => void;
  onToggleVisible: (id: WidgetId) => void;
  onResetTrip: () => void;
  onResetDrag: () => void;
}

const MonoSparkline: React.FC<{ values: number[]; minZero?: boolean }> = ({
  values,
  minZero = false,
}) => {
  if (values.length < 2) return null;
  const minVal = minZero ? Math.min(0, ...values) : Math.min(...values);
  const maxVal = Math.max(minVal + 1, ...values);
  const range = maxVal - minVal || 1;
  const w = 240;
  const h = 44;

  const points = values
    .map((v, idx) => {
      const x = (idx / (values.length - 1)) * w;
      const y = h - ((v - minVal) / range) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const zeroY = h - ((0 - minVal) / range) * (h - 6) - 3;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full overflow-visible">
      {minVal < 0 && (
        <line
          x1={0}
          y1={zeroY}
          x2={w}
          y2={zeroY}
          stroke="var(--line-strong)"
          strokeDasharray="2 2"
          strokeWidth="1"
        />
      )}
      <polyline
        fill="none"
        stroke="var(--fg)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
};

export const WidgetGrid: React.FC<WidgetGridProps> = ({
  widgets,
  frontMaster,
  rearSlave,
  frontFw,
  rearFw,
  frontOnline,
  rearOnline,
  masterIsFrontHall,
  tractionMode,
  canSlaveId,
  metrics,
  fontLarge,
  editMode,
  onMoveWidget,
  onToggleSpan,
  onToggleVisible,
  onResetTrip,
  onResetDrag,
}) => {
  const visibleWidgets = widgets.filter((w) => w.enabled);
  const hiddenWidgets = widgets.filter((w) => !w.enabled);
  const valClass = fontLarge ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl';

  const renderTileBody = (id: WidgetId) => {
    switch (id) {
      case 'battery':
        return (
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className={`tabular-nums font-semibold tracking-tight text-[var(--fg)] ${valClass}`}>
                {metrics.batteryPct}%
              </div>
              <div className="tabular-nums text-sm font-semibold text-[var(--fg)]">
                {metrics.packVoltage.toFixed(1)} В
              </div>
            </div>
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: 10 }).map((_, idx) => {
                const filled = metrics.batteryPct >= (idx + 1) * 10 - 4;
                return (
                  <span
                    key={idx}
                    className={`h-2 ${
                      filled
                        ? 'bg-[var(--fg)]'
                        : 'bg-[var(--bg-subtle)] border border-[var(--line)]'
                    }`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[11px] text-[var(--fg-muted)] tabular-nums">
              <span>
                Отсечка {metrics.cutoffStartV}/{metrics.cutoffEndV}В
              </span>
              <span>{metrics.cellVoltage.toFixed(2)} В/яч</span>
            </div>
          </div>
        );

      case 'sag_health': {
        const ampRatio = Math.min(
          100,
          (Math.max(0, metrics.totalBattCurrent) / Math.max(10, metrics.maxBatteryAmpsCap)) * 100
        );
        const nearBmsLimit = metrics.totalBattCurrent >= 92;
        return (
          <div className="space-y-2 tabular-nums">
            <div className="flex items-baseline justify-between gap-2">
              <div className={`font-semibold tracking-tight text-[var(--fg)] ${valClass}`}>
                {metrics.totalBattCurrent >= 0 ? '+' : ''}
                {metrics.totalBattCurrent.toFixed(1)}
                <span className="ml-1 text-xs font-normal text-[var(--fg-muted)]">А</span>
              </div>
              {nearBmsLimit ? (
                <span className="bg-[var(--inv-bg)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--inv-fg)]">
                  ПИК 94А
                </span>
              ) : (
                <span className="text-xs text-[var(--fg-muted)]">
                  Просадка <strong className="text-[var(--fg)]">-{metrics.voltageSag.toFixed(1)}В</strong>
                </span>
              )}
            </div>

            <div className="h-2 w-full bg-[var(--bg-subtle)]">
              <div
                className="h-full bg-[var(--fg)] transition-all duration-75"
                style={{ width: `${ampRatio}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-[var(--fg-muted)]">
              <span>Покой {metrics.restVoltageEstimate.toFixed(1)}В</span>
              <span>Этап {metrics.maxBatteryAmpsCap}А / BMS 100А</span>
            </div>
          </div>
        );
      }

      case 'field_weakening': {
        const idFront = Math.abs(frontMaster.avgId);
        const idRear = Math.abs(rearSlave.avgId);
        const maxId = Math.max(idFront, idRear);
        const maxDutyPct = Math.round(
          Math.max(Math.abs(frontMaster.dutyNow), Math.abs(rearSlave.dutyNow)) * 100
        );
        const active = maxId >= 0.8;
        return (
          <div className="space-y-2 tabular-nums">
            <div className="flex items-baseline justify-between gap-2">
              <div className={`font-semibold tracking-tight text-[var(--fg)] ${valClass}`}>
                {maxId.toFixed(1)}
                <span className="ml-1 text-xs font-normal text-[var(--fg-muted)]">/ 10.0 А</span>
              </div>
              <span
                className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  active
                    ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                    : 'border border-[var(--line-strong)] text-[var(--fg-muted)]'
                }`}
              >
                {active ? 'БУСТ 90+ КМ/Ч' : `DUTY ${maxDutyPct}%`}
              </span>
            </div>

            <div className="h-2 w-full bg-[var(--bg-subtle)]">
              <div
                className="h-full bg-[var(--fg)] transition-all duration-75"
                style={{ width: `${Math.min(100, (maxId / 10) * 100)}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-[var(--fg-muted)]">
              <span>Старт FW при 90% PWM</span>
              <span>
                Id: -{idFront.toFixed(1)} / -{idRear.toFixed(1)}А
              </span>
            </div>
          </div>
        );
      }

      case 'range_efficiency':
        return (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className={`tabular-nums font-semibold tracking-tight text-[var(--fg)] ${valClass}`}>
                ~{metrics.estimatedRangeKm.toFixed(0)}
                <span className="ml-1 text-xs font-normal text-[var(--fg-muted)]">км</span>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
                ЗАПАС ХОДА
              </span>
            </div>
            <div className="border-t border-[var(--line)] pt-2 flex items-center justify-between text-xs tabular-nums">
              <span className="text-[var(--fg-muted)]">Средний расход</span>
              <span className="font-semibold text-[var(--fg)]">
                {metrics.whPerKm.toFixed(1)} Вт·ч/км
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[var(--fg-muted)] tabular-nums">
              <span>Потрачено / Рекуп</span>
              <span>
                {metrics.netWhUsed.toFixed(0)} / -{metrics.regenWh.toFixed(1)} Вт·ч
              </span>
            </div>
          </div>
        );

      case 'drag_timer':
        return (
          <div className="space-y-2 tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--fg-muted)]">
                {metrics.drag.state === 'running'
                  ? `ЗАЕЗД: ${metrics.drag.currentSec.toFixed(2)} С`
                  : metrics.drag.state === 'ready'
                  ? 'СТАРТ С 0 КМ/Ч ГОТОВ'
                  : 'РЕКОРД РАЗГОНА'}
              </span>
              <button
                type="button"
                onClick={onResetDrag}
                className="border border-[var(--line-strong)] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[var(--fg-muted)] hover:text-[var(--fg)] cursor-pointer"
              >
                СБРОС
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <div className="border border-[var(--line)] bg-[var(--bg)] p-2">
                <div className="text-[9px] text-[var(--fg-muted)]">0–30 КМ/Ч</div>
                <div className="mt-0.5 text-lg font-semibold">
                  {metrics.drag.best0to30Sec !== null
                    ? `${metrics.drag.best0to30Sec.toFixed(2)} с`
                    : '—.— с'}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-2">
                <div className="text-[9px] text-[var(--fg-muted)]">0–50 КМ/Ч</div>
                <div className="mt-0.5 text-lg font-semibold">
                  {metrics.drag.best0to50Sec !== null
                    ? `${metrics.drag.best0to50Sec.toFixed(2)} с`
                    : '—.— с'}
                </div>
              </div>
            </div>
          </div>
        );

      case 'trip':
        return (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span className={`tabular-nums font-semibold tracking-tight text-[var(--fg)] ${valClass}`}>
                  {metrics.tripDistanceKm.toFixed(2)}
                </span>
                <span className="ml-1 text-xs text-[var(--fg-muted)]">км</span>
              </div>
              <button
                type="button"
                onClick={onResetTrip}
                className="flex items-center gap-1 border border-[var(--line-strong)] px-2 py-1 text-[10px] font-semibold tracking-wider uppercase text-[var(--fg-muted)] hover:bg-[var(--inv-bg)] hover:text-[var(--inv-fg)] transition-colors cursor-pointer"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                Сброс
              </button>
            </div>
            <div className="border-t border-[var(--line)] pt-2 flex justify-between text-xs tabular-nums">
              <span className="text-[var(--fg-muted)]">Одометр ODO</span>
              <span className="font-semibold text-[var(--fg)]">
                {metrics.odometerKm.toFixed(1)} км • {metrics.rideDurationText}
              </span>
            </div>
          </div>
        );

      case 'power_graph':
        return (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div>
                <span className={`tabular-nums font-semibold tracking-tight text-[var(--fg)] ${valClass}`}>
                  {(metrics.totalPowerWatts / 1000).toFixed(2)}
                </span>
                <span className="ml-1.5 text-xs text-[var(--fg-muted)]">
                  КВТ ({Math.round(metrics.totalPowerWatts)} Вт)
                </span>
              </div>
              <div className="tabular-nums text-xs text-[var(--fg-muted)]">
                ПИК:{' '}
                <strong className="text-[var(--fg)]">
                  {(metrics.maxPowerWatts / 1000).toFixed(2)} кВт
                </strong>
              </div>
            </div>
            <MonoSparkline values={metrics.powerHistory} minZero />
          </div>
        );

      case 'speed_graph':
        return (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-[var(--fg-muted)]">Кривая скорости Achilleus</span>
              <span className="tabular-nums text-xs font-semibold text-[var(--fg)]">
                МАКС {metrics.maxSpeedKmh.toFixed(1)} км/ч
              </span>
            </div>
            <MonoSparkline values={metrics.speedHistory} minZero />
          </div>
        );

      case 'dual_balance': {
        const frontWatts = Math.round(frontMaster.vIn * frontMaster.avgInputCurrent);
        const rearWatts = Math.round(rearSlave.vIn * rearSlave.avgInputCurrent);
        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                name: masterIsFrontHall
                  ? 'ПЕРЕДНЕЕ МК • MASTER ID 0'
                  : 'ЗАДНЕЕ МК • MASTER ID 0',
                online: frontOnline,
                meta:
                  tractionMode === '1wd_rear_sl'
                    ? 'НАКАТ (ОТКЛ)'
                    : frontFw
                    ? `HALL • FW ${frontFw.fwMajor}.${frontFw.fwMinor}`
                    : 'HALL SENSORS • ADC',
                esc: frontMaster,
                watts: frontWatts,
                muted: tractionMode === '1wd_rear_sl',
              },
              {
                name: masterIsFrontHall
                  ? `ЗАДНЕЕ МК • SLAVE ID ${canSlaveId}`
                  : `ПЕРЕДНЕЕ МК • SLAVE ID ${canSlaveId}`,
                online: rearOnline,
                meta:
                  tractionMode === '1wd_front_hall'
                    ? 'НАКАТ (ОТКЛ)'
                    : rearFw
                    ? `SENSORLESS • FW ${rearFw.fwMajor}.${rearFw.fwMinor}`
                    : 'SENSORLESS • CAN 500K',
                esc: rearSlave,
                watts: rearWatts,
                muted: tractionMode === '1wd_front_hall',
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className={`border border-[var(--line)] bg-[var(--bg)] p-2.5 space-y-2 ${
                  item.muted ? 'opacity-55' : ''
                }`}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 font-semibold tracking-wider text-[var(--fg)]">
                    <span
                      className={`inline-block h-2 w-2 ${
                        item.online ? 'bg-[var(--fg)]' : 'border border-[var(--fg-faint)]'
                      }`}
                    />
                    {item.name}
                  </span>
                  <span className="tabular-nums text-[9px] text-[var(--fg-muted)]">
                    {item.meta}
                  </span>
                </div>

                <div className="h-1.5 w-full bg-[var(--bg-subtle)]">
                  <div
                    className="h-full bg-[var(--fg)] transition-all duration-75"
                    style={{
                      width: `${Math.min(100, Math.abs(item.esc.avgMotorCurrent))}%`,
                    }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-1 pt-0.5 text-[11px] tabular-nums">
                  <div>
                    <div className="text-[9px] text-[var(--fg-muted)]">ФАЗА / АКБ</div>
                    <div className="font-semibold">
                      {item.esc.avgMotorCurrent.toFixed(0)} / {item.esc.avgInputCurrent.toFixed(0)}А
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[var(--fg-muted)]">МОЩНОСТЬ</div>
                    <div className="font-semibold">{item.watts} Вт</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[var(--fg-muted)]">ERPM</div>
                    <div className="font-semibold">{item.esc.erpm}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      }

      case 'currents':
        return (
          <div className="space-y-2 tabular-nums">
            <div className="flex items-baseline justify-between">
              <div className={`font-semibold tracking-tight text-[var(--fg)] ${valClass}`}>
                {metrics.totalBattCurrent >= 0 ? '+' : ''}
                {metrics.totalBattCurrent.toFixed(1)}
                <span className="ml-1 text-xs font-normal text-[var(--fg-muted)]">А АКБ</span>
              </div>
              <span className="text-xs text-[var(--fg-muted)]">
                Пик АКБ: <strong className="text-[var(--fg)]">{metrics.maxBattAmps.toFixed(0)}А</strong>
              </span>
            </div>
            <div className="border-t border-[var(--line)] pt-2 flex justify-between text-xs">
              <span className="text-[var(--fg-muted)]">Фаза ID0 (Перед) / ID1 (Зад)</span>
              <span className="font-semibold">
                {frontMaster.avgMotorCurrent.toFixed(1)} / {rearSlave.avgMotorCurrent.toFixed(1)} А
              </span>
            </div>
          </div>
        );

      case 'temps_fet': {
        const hot =
          frontMaster.tempFet >= metrics.fetWarnTempC ||
          rearSlave.tempFet >= metrics.fetWarnTempC;
        return (
          <div className="space-y-2 tabular-nums">
            <div className="flex items-baseline justify-between">
              <div className={`font-semibold tracking-tight ${valClass}`}>
                {frontMaster.tempFet.toFixed(0)}° <span className="text-[var(--fg-faint)]">/</span>{' '}
                {rearSlave.tempFet.toFixed(0)}°
              </div>
              {hot && (
                <span className="bg-[var(--inv-bg)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--inv-fg)]">
                  ОТСЕЧКА 80°
                </span>
              )}
            </div>
            <div className="space-y-1">
              <div className="h-1.5 w-full bg-[var(--bg-subtle)]">
                <div
                  className="h-full bg-[var(--fg)]"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(frontMaster.tempFet, rearSlave.tempFet)
                    )}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-[var(--fg-muted)]">
                <span>ID0 Перед / ID1 Зад</span>
                <span>Лимит 80–100°C</span>
              </div>
            </div>
          </div>
        );
      }

      case 'temps_motor': {
        const hot =
          frontMaster.tempMotor >= metrics.motorWarnTempC ||
          rearSlave.tempMotor >= metrics.motorWarnTempC;
        return (
          <div className="space-y-2 tabular-nums">
            <div className="flex items-baseline justify-between">
              <div className={`font-semibold tracking-tight ${valClass}`}>
                {frontMaster.tempMotor > 0 ? `${frontMaster.tempMotor.toFixed(0)}°` : '—'}{' '}
                <span className="text-[var(--fg-faint)]">/</span>{' '}
                {rearSlave.tempMotor > 0 ? `${rearSlave.tempMotor.toFixed(0)}°` : 'Н/Д'}
              </div>
              {hot && (
                <span className="bg-[var(--inv-bg)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--inv-fg)]">
                  ОТСЕЧКА 80°
                </span>
              )}
            </div>
            <div className="space-y-1">
              <div className="h-1.5 w-full bg-[var(--bg-subtle)]">
                <div
                  className="h-full bg-[var(--fg)]"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(frontMaster.tempMotor, rearSlave.tempMotor)
                    )}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-[var(--fg-muted)]">
                <span>Датчик МК Перед / Зад</span>
                <span>Лимит 80–100°C</span>
              </div>
            </div>
          </div>
        );
      }

      case 'peaks':
        return (
          <div className="grid grid-cols-3 gap-2 tabular-nums">
            <div>
              <div className="text-[10px] text-[var(--fg-muted)]">МАКС СКОР</div>
              <div className="mt-0.5 text-lg font-semibold">
                {metrics.maxSpeedKmh.toFixed(1)} <span className="text-xs font-normal">км/ч</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--fg-muted)]">ПИК КВТ</div>
              <div className="mt-0.5 text-lg font-semibold">
                {(metrics.maxPowerWatts / 1000).toFixed(2)}{' '}
                <span className="text-xs font-normal">кВт</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--fg-muted)]">ПИК BMS</div>
              <div className="mt-0.5 text-lg font-semibold">
                {metrics.maxBattAmps.toFixed(0)} <span className="text-xs font-normal">А</span>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)]">
        {visibleWidgets.map((w, idx) => (
          <div
            key={w.id}
            className={`bg-[var(--bg-surface)] p-3.5 sm:p-4 flex flex-col justify-between ${
              w.span === 2 ? 'col-span-2' : 'col-span-1'
            }`}
          >
            <div className="mb-2.5 flex items-center justify-between gap-1">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--fg-muted)]">
                {w.title}
              </span>

              {editMode && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => onMoveWidget(w.id, -1)}
                    className="border border-[var(--line-strong)] p-1 text-[var(--fg)] disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === visibleWidgets.length - 1}
                    onClick={() => onMoveWidget(w.id, 1)}
                    className="border border-[var(--line-strong)] p-1 text-[var(--fg)] disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleSpan(w.id)}
                    className="border border-[var(--line-strong)] p-1 text-[var(--fg)] cursor-pointer"
                  >
                    {w.span === 2 ? (
                      <Minimize2 className="h-3 w-3" />
                    ) : (
                      <Maximize2 className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleVisible(w.id)}
                    className="border border-[var(--line-strong)] p-1 text-[var(--fg)] hover:bg-[var(--inv-bg)] hover:text-[var(--inv-fg)] cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {renderTileBody(w.id)}
          </div>
        ))}
      </div>

      {editMode && hiddenWidgets.length > 0 && (
        <div className="border border-dashed border-[var(--line-strong)] bg-[var(--bg-surface)] p-3">
          <div className="mb-2 text-[10px] font-bold tracking-widest uppercase text-[var(--fg-muted)]">
            ДОБАВИТЬ ПЛИТКУ НА ЭКРАН ACHILLEUS:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hiddenWidgets.map((hw) => (
              <button
                key={hw.id}
                type="button"
                onClick={() => onToggleVisible(hw.id)}
                className="flex items-center gap-1.5 border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--inv-bg)] hover:text-[var(--inv-fg)] transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                {hw.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
