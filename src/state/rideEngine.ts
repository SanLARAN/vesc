import { erpmToKmh, VescTelemetry } from '../protocol/vescProtocol';
import type { ControllerKey } from '../protocol/vescLink';
import type { OnboardComputerConfig } from './dashboardConfig';
import { BatteryEstimator, BatteryState, DragRun, remainingEnergyWh, TripComputer, TripData } from './tripComputer';

/** Telemetry older than this is treated as "controller offline". */
export const STALE_MS = 1500;

export interface MotorLive {
  key: ControllerKey;
  online: boolean;
  t: VescTelemetry | null;
  speedKmh: number;
  phaseA: number;
  battA: number;
  powerW: number;
  fwA: number; // field-weakening current actually flowing (−Id)
  duty: number; // |duty| 0..1
}

export interface WheelCalibration {
  ratio: number; // GPS speed / VESC speed
  samples: number;
  suggestedMm: number | null;
}

export interface GpsSpeed {
  speedKmh: number | null;
  accuracy: number;
  at: number;
}

export interface RideSnapshot {
  at: number;
  connected: boolean;
  speedKmh: number;
  vescSpeedKmh: number | null;
  gpsSpeedKmh: number | null;
  powerW: number; // + drive, − regen
  battA: number;
  phaseMaxA: number;
  vIn: number;
  dutyPct: number;
  battery: BatteryState;
  front: MotorLive;
  rear: MotorLive;
  fwActive: boolean;
  fwA: number;
  slip: boolean;
  tempFetMax: number;
  tempMotorMax: number;
  trip: TripData;
  odometerKm: number;
  netWhPerKm: number | null;
  instWhPerKm: number | null;
  remainingWh: number | null;
  rangeKm: number | null;
  speedHistory: number[];
  powerHistory: number[];
  dragCurrent: DragRun | null;
  dragLast: DragRun | null;
  dragBest: Record<number, number | null>;
  faults: { key: ControllerKey; code: number; text: string }[];
  calibration: WheelCalibration;
}

const offlineMotor = (key: ControllerKey, t: VescTelemetry | null): MotorLive => ({
  key,
  online: false,
  t,
  speedKmh: 0,
  phaseA: 0,
  battA: 0,
  powerW: 0,
  fwA: 0,
  duty: 0,
});

/**
 * Fuses the telemetry of both controllers (+ GPS) into one snapshot for the UI.
 * Stateful parts (trip computer, battery model, wheel calibration) live here so they
 * advance exactly once per UI frame, not once per React render.
 */
export class RideEngine {
  readonly trip = new TripComputer();
  private readonly battery = new BatteryEstimator();
  private latest: Record<ControllerKey, { t: VescTelemetry; at: number } | null> = { front: null, rear: null };
  private calib = { ratio: 1, samples: 0 };
  private lastSpeed = 0;

  ingest(key: ControllerKey, t: VescTelemetry, cfg: OnboardComputerConfig) {
    const now = Date.now();
    this.latest[key] = { t, at: now };
    const front = this.latest.front;
    const distanceKey: ControllerKey = front && now - front.at < STALE_MS ? 'front' : 'rear';
    this.trip.ingest(key, t, cfg, distanceKey);
  }

  /** Call when the link is (re)established: counters of a rebooted VESC must not be diffed. */
  resetLink() {
    this.latest = { front: null, rear: null };
    this.trip.forgetCounters();
    this.battery.reset();
  }

  resetCalibration() {
    this.calib = { ratio: 1, samples: 0 };
  }

  private motor(key: ControllerKey, now: number, cfg: OnboardComputerConfig): MotorLive {
    const l = this.latest[key];
    if (!l || now - l.at > STALE_MS) return offlineMotor(key, l?.t ?? null);
    const t = l.t;
    return {
      key,
      online: true,
      t,
      speedKmh: Math.abs(erpmToKmh(t.erpm, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm)),
      phaseA: t.avgMotorCurrent,
      battA: t.avgInputCurrent,
      powerW: t.vIn * t.avgInputCurrent,
      fwA: Math.max(0, -t.avgId),
      duty: Math.abs(t.dutyNow),
    };
  }

  snapshot(now: number, cfg: OnboardComputerConfig, gps: GpsSpeed | null): RideSnapshot {
    const front = this.motor('front', now, cfg);
    const rear = this.motor('rear', now, cfg);
    const online = [front, rear].filter((m) => m.online);
    const powerW = online.reduce((s, m) => s + m.powerW, 0);
    const battA = online.reduce((s, m) => s + m.battA, 0);

    let vescSpeed: number | null = null;
    let slip = false;
    if (online.length === 2) {
      const hi = Math.max(front.speedKmh, rear.speedKmh);
      const lo = Math.min(front.speedKmh, rear.speedKmh);
      slip = hi > 8 && (hi - lo) / hi > 0.15;
      // While slipping trust the slower wheel under drive and the faster one under braking.
      vescSpeed = slip ? (powerW >= 0 ? lo : hi) : (hi + lo) / 2;
    } else if (online.length === 1) {
      vescSpeed = online[0].speedKmh;
    }

    const gpsSpeed = gps && gps.speedKmh !== null && now - gps.at < 4000 ? gps.speedKmh : null;
    const speedKmh = Math.max(0, cfg.speedSource === 'gps' ? (gpsSpeed ?? vescSpeed ?? 0) : (vescSpeed ?? gpsSpeed ?? 0));

    const vIn = front.online ? front.t!.vIn : rear.online ? rear.t!.vIn : 0;
    const battery = this.battery.update(vIn, battA, cfg, now);
    const phaseMaxA = online.reduce((s, m) => Math.max(s, Math.abs(m.phaseA)), 0);

    this.trip.tick(now, speedKmh, powerW, phaseMaxA, battA);

    // Wheel calibration: steady cruising with a good GPS fix.
    if (
      gpsSpeed !== null &&
      gps!.accuracy <= 12 &&
      vescSpeed !== null &&
      vescSpeed > 15 &&
      gpsSpeed > 15 &&
      !slip &&
      Math.abs(vescSpeed - this.lastSpeed) < 0.8
    ) {
      const r = gpsSpeed / vescSpeed;
      if (r > 0.6 && r < 1.6) {
        this.calib.ratio = this.calib.samples === 0 ? r : this.calib.ratio * 0.98 + r * 0.02;
        this.calib.samples++;
      }
    }
    this.lastSpeed = vescSpeed ?? 0;

    const trip = this.trip.trip;
    const netWh = trip.energyWh - trip.regenWh;
    const netWhPerKm = trip.distanceKm > 0.5 ? Math.max(3, netWh / trip.distanceKm) : null;
    const remainingWh = online.length ? remainingEnergyWh(battery.socPct, cfg) : null;
    const rangeKm = remainingWh !== null ? remainingWh / (netWhPerKm ?? cfg.typicalWhPerKm) : null;
    const faults = online
      .filter((m) => m.t && m.t.faultCode !== 0)
      .map((m) => ({ key: m.key, code: m.t!.faultCode, text: m.t!.faultText }));
    const fwA = Math.max(front.fwA, rear.fwA);

    return {
      at: now,
      connected: online.length > 0,
      speedKmh,
      vescSpeedKmh: vescSpeed,
      gpsSpeedKmh: gpsSpeed,
      powerW,
      battA,
      phaseMaxA,
      vIn,
      dutyPct: Math.max(front.duty, rear.duty) * 100,
      battery,
      front,
      rear,
      fwActive: fwA > 1,
      fwA,
      slip,
      tempFetMax: online.reduce((s, m) => Math.max(s, m.t!.tempFet), 0),
      tempMotorMax: online.reduce((s, m) => Math.max(s, m.t!.tempMotor), 0),
      trip: { ...trip },
      odometerKm: this.trip.odometerKm,
      netWhPerKm,
      instWhPerKm: speedKmh > 3 ? powerW / speedKmh : null,
      remainingWh,
      rangeKm,
      speedHistory: this.trip.speedHistory.slice(),
      powerHistory: this.trip.powerHistory.slice(),
      dragCurrent: this.trip.currentRun ? { ...this.trip.currentRun, times: { ...this.trip.currentRun.times } } : null,
      dragLast: this.trip.lastRun,
      dragBest: { ...this.trip.bestTimes },
      faults,
      calibration: {
        ratio: this.calib.ratio,
        samples: this.calib.samples,
        suggestedMm: this.calib.samples >= 60 ? Math.round(cfg.wheelDiameterMm * this.calib.ratio) : null,
      },
    };
  }
}
