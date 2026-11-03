import { cellVoltageToSoc, nominalCellVoltage, tachoToKm, VescTelemetry } from '../protocol/vescProtocol';
import type { ControllerKey } from '../protocol/vescLink';
import type { OnboardComputerConfig } from './dashboardConfig';

/* ───────── Battery: sag-compensated state of charge ───────── */

export interface BatteryState {
  socPct: number | null;
  restVoltage: number;
  sagV: number;
  cellV: number;
  resistanceMohm: number;
}

export class BatteryEstimator {
  private rPack = 0.08;
  private soc: number | null = null;
  private lastAt = 0;
  private samples: { v: number; i: number; at: number }[] = [];

  reset() {
    this.soc = null;
    this.samples = [];
  }

  update(vIn: number, iBatt: number, cfg: OnboardComputerConfig, now = Date.now()): BatteryState {
    if (vIn < 5) {
      return { socPct: null, restVoltage: 0, sagV: 0, cellV: 0, resistanceMohm: this.rPack * 1000 };
    }
    // Online pack resistance estimate from fast current steps (ΔV/ΔI).
    this.samples.push({ v: vIn, i: iBatt, at: now });
    this.samples = this.samples.filter((s) => now - s.at < 1200);
    const first = this.samples[0];
    if (first && Math.abs(iBatt - first.i) > 18) {
      const r = -(vIn - first.v) / (iBatt - first.i);
      if (r > 0.01 && r < 0.4) this.rPack = this.rPack * 0.92 + r * 0.08;
      this.samples = [{ v: vIn, i: iBatt, at: now }];
    }
    const restVoltage = vIn + iBatt * this.rPack;
    const cellV = restVoltage / Math.max(1, cfg.batteryCells);
    const raw = cellVoltageToSoc(cellV, cfg.batteryChemistry);
    const dt = this.lastAt ? Math.min(2, (now - this.lastAt) / 1000) : 0;
    this.lastAt = now;
    if (this.soc === null) this.soc = raw;
    else {
      const tau = Math.abs(iBatt) < 4 ? 6 : 25;
      this.soc += (raw - this.soc) * Math.min(1, dt / tau);
    }
    return {
      socPct: Math.max(0, Math.min(100, this.soc)),
      restVoltage,
      sagV: Math.max(0, restVoltage - vIn),
      cellV,
      resistanceMohm: this.rPack * 1000,
    };
  }
}

/* ───────── Trip computer ───────── */

export interface TripData {
  startedAt: number;
  distanceKm: number;
  rideSeconds: number;
  energyWh: number; // consumed (gross)
  regenWh: number;
  maxSpeedKmh: number;
  maxPowerW: number;
  maxPhaseA: number;
  maxBattA: number;
  minRegenA: number;
}

export interface DragRun {
  startedAt: number;
  times: Record<number, number | null>;
  peakKmh: number;
}

export const DRAG_TARGETS = [30, 50, 60, 80, 100] as const;

const TRIP_KEY = 'vesc_trip_v2';
const ODO_KEY = 'vesc_75100_odometer_km';
const DRAG_KEY = 'vesc_drag_best_v2';

const emptyTrip = (): TripData => ({
  startedAt: Date.now(),
  distanceKm: 0,
  rideSeconds: 0,
  energyWh: 0,
  regenWh: 0,
  maxSpeedKmh: 0,
  maxPowerW: 0,
  maxPhaseA: 0,
  maxBattA: 0,
  minRegenA: 0,
});

const emptyTimes = (): Record<number, number | null> => Object.fromEntries(DRAG_TARGETS.map((t) => [t, null]));

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

interface CounterState {
  tachAbs: number | null;
  wh: number | null;
  whCh: number | null;
}

export class TripComputer {
  trip: TripData = loadJson(TRIP_KEY, emptyTrip());
  odometerKm: number;
  bestTimes: Record<number, number | null> = loadJson(DRAG_KEY, emptyTimes());
  currentRun: DragRun | null = null;
  lastRun: DragRun | null = null;
  readonly speedHistory: number[] = Array(120).fill(0);
  readonly powerHistory: number[] = Array(120).fill(0);
  private counters: Record<ControllerKey, CounterState> = {
    front: { tachAbs: null, wh: null, whCh: null },
    rear: { tachAbs: null, wh: null, whCh: null },
  };
  private armed = true;
  private lastSpeed = 0;
  private lastSampleAt = 0;
  private lastPersist = 0;
  private historyAt = 0;
  private distanceFromTachoAt = 0;

  constructor() {
    const odo = Number(localStorage.getItem(ODO_KEY) ?? '0');
    this.odometerKm = Number.isFinite(odo) && odo >= 0 ? odo : 0;
  }

  /** Feed a fresh GET_VALUES sample. Distance comes from the tachometer, energy from VESC counters. */
  ingest(key: ControllerKey, t: VescTelemetry, cfg: OnboardComputerConfig, distanceKey: ControllerKey) {
    const c = this.counters[key];
    if (key === distanceKey && c.tachAbs !== null) {
      const d = t.tachometerAbs - c.tachAbs;
      const km = tachoToKm(d, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm);
      // Ignore controller reboots (counter reset) and impossible jumps.
      if (d > 0 && km < 0.2) {
        this.trip.distanceKm += km;
        this.odometerKm += km;
        this.distanceFromTachoAt = Date.now();
      }
    }
    if (c.wh !== null && c.whCh !== null) {
      const dWh = t.wattHours - c.wh;
      const dCh = t.wattHoursCharged - c.whCh;
      if (dWh >= 0 && dWh < 50) this.trip.energyWh += dWh;
      if (dCh >= 0 && dCh < 50) this.trip.regenWh += dCh;
    }
    c.tachAbs = t.tachometerAbs;
    c.wh = t.wattHours;
    c.whCh = t.wattHoursCharged;
  }

  forgetCounters() {
    for (const k of ['front', 'rear'] as ControllerKey[]) this.counters[k] = { tachAbs: null, wh: null, whCh: null };
  }

  /** Called every ~100 ms with fused values. */
  tick(now: number, speedKmh: number, powerW: number, phaseA: number, battA: number) {
    const prevAt = this.lastSampleAt || now;
    const dt = Math.min(1, (now - prevAt) / 1000);
    this.lastSampleAt = now;
    if (speedKmh > 1) this.trip.rideSeconds += dt;
    // GPS-only / no tachometer: integrate speed.
    if (now - this.distanceFromTachoAt > 2000 && speedKmh > 1) {
      const km = (speedKmh * dt) / 3600;
      this.trip.distanceKm += km;
      this.odometerKm += km;
    }
    const t = this.trip;
    t.maxSpeedKmh = Math.max(t.maxSpeedKmh, speedKmh);
    t.maxPowerW = Math.max(t.maxPowerW, powerW);
    t.maxPhaseA = Math.max(t.maxPhaseA, phaseA);
    t.maxBattA = Math.max(t.maxBattA, battA);
    t.minRegenA = Math.min(t.minRegenA, battA);

    this.updateDrag(now, prevAt, speedKmh);

    if (now - this.historyAt >= 500) {
      this.historyAt = now;
      this.speedHistory.push(speedKmh);
      this.speedHistory.shift();
      this.powerHistory.push(powerW);
      this.powerHistory.shift();
    }
    if (now - this.lastPersist > 5000) this.persist();
  }

  private updateDrag(now: number, prevAt: number, speed: number) {
    const prev = this.lastSpeed;
    const crossing = (target: number) => {
      const frac = speed > prev ? Math.min(1, Math.max(0, (target - prev) / (speed - prev))) : 1;
      return prevAt + frac * (now - prevAt);
    };
    if (speed < 1) {
      if (this.currentRun) this.finishRun();
      this.armed = true;
    } else if (this.armed && prev < 1) {
      this.currentRun = { startedAt: crossing(1), times: emptyTimes(), peakKmh: speed };
      this.armed = false;
    }
    const run = this.currentRun;
    if (run) {
      for (const target of DRAG_TARGETS) {
        if (run.times[target] === null && speed >= target && prev < target) {
          run.times[target] = Math.max(0.1, (crossing(target) - run.startedAt) / 1000);
        }
      }
      run.peakKmh = Math.max(run.peakKmh, speed);
      // A run ends when the rider lifts off (speed drops) or after 40 s.
      if (speed < run.peakKmh - 4 || now - run.startedAt > 40000) this.finishRun();
    }
    this.lastSpeed = speed;
  }

  private finishRun() {
    const run = this.currentRun;
    this.currentRun = null;
    if (!run) return;
    if (Object.values(run.times).some((v) => v !== null)) {
      this.lastRun = run;
      for (const target of DRAG_TARGETS) {
        const v = run.times[target];
        if (v !== null && (this.bestTimes[target] === null || v < (this.bestTimes[target] as number))) {
          this.bestTimes[target] = v;
        }
      }
      try {
        localStorage.setItem(DRAG_KEY, JSON.stringify(this.bestTimes));
      } catch {
        /* ignore */
      }
    }
  }

  resetTrip() {
    this.trip = emptyTrip();
    this.persist();
  }

  resetDrag() {
    this.bestTimes = emptyTimes();
    this.lastRun = null;
    try {
      localStorage.removeItem(DRAG_KEY);
    } catch {
      /* ignore */
    }
  }

  setOdometer(km: number) {
    this.odometerKm = Math.max(0, km);
    this.persist();
  }

  persist() {
    this.lastPersist = Date.now();
    try {
      localStorage.setItem(TRIP_KEY, JSON.stringify(this.trip));
      localStorage.setItem(ODO_KEY, this.odometerKm.toFixed(3));
    } catch {
      /* ignore */
    }
  }
}

export function remainingEnergyWh(socPct: number | null, cfg: OnboardComputerConfig): number | null {
  if (socPct === null) return null;
  return (socPct / 100) * cfg.batteryCapacityAh * cfg.batteryCells * nominalCellVoltage(cfg.batteryChemistry);
}
