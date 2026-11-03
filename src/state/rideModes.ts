import { kmhToErpm, McconfTempLimits } from '../protocol/vescProtocol';
import type { LimitBaseline } from '../protocol/mcconf';
import { nearlyEqual } from '../protocol/mcconf';
import type { ControllerKey } from '../protocol/vescLink';
import { BASE_PROFILE_ID } from './dashboardConfig';
import type { OnboardComputerConfig, RideProfile, TractionDriveMode } from './dashboardConfig';

export interface RideSelection {
  profileId: string | null; // null = controller's own (base) limits
  traction: TractionDriveMode;
  limiter: boolean;
}

export function selectionFromConfig(cfg: OnboardComputerConfig): RideSelection {
  return {
    profileId: cfg.activeProfileId === BASE_PROFILE_ID ? null : cfg.activeProfileId,
    traction: cfg.tractionMode,
    limiter: cfg.limiterOn,
  };
}

export function sameSelection(a: RideSelection | null, b: RideSelection | null): boolean {
  return !!a && !!b && a.profileId === b.profileId && a.traction === b.traction && a.limiter === b.limiter;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function driveShare(traction: TractionDriveMode, key: ControllerKey, frontRatioPct: number): number {
  if (traction === '1wd_front_hall') return key === 'front' ? 1 : 0;
  if (traction === '1wd_rear_sl') return key === 'rear' ? 1 : 0;
  return key === 'front' ? clamp(frontRatioPct / 100, 0, 1) : 1;
}

export function effectiveSpeedCap(profile: RideProfile | null, limiter: boolean, cfg: OnboardComputerConfig): number | null {
  const caps: number[] = [];
  if (profile) caps.push(profile.maxSpeedKmh);
  if (limiter) caps.push(cfg.limiterKmh);
  return caps.length ? Math.min(...caps) : null;
}

/** Limits for one controller. Never exceeds what is configured in the VESC itself. */
export function computeLimits(
  key: ControllerKey,
  baseline: LimitBaseline,
  profile: RideProfile | null,
  sel: RideSelection,
  cfg: OnboardComputerConfig
): McconfTempLimits {
  const share = driveShare(sel.traction, key, cfg.frontTorqueRatioPct);
  const activeCount = sel.traction === '2wd' ? 2 : 1;
  const cap = effectiveSpeedCap(profile, sel.limiter, cfg);
  const capErpm = cap === null ? Infinity : kmhToErpm(cap, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm);
  const drivePct = profile ? profile.currentScalePct / 100 : 1;
  const brakePct = profile ? profile.brakeScalePct / 100 : 1;
  const wattMax = profile ? Math.min(baseline.wattMax, profile.maxWatts / activeCount) : baseline.wattMax;
  const inMax = profile ? Math.min(baseline.inCurrentMax, profile.maxBattAmps / activeCount) : baseline.inCurrentMax;
  return {
    currentMaxScale: clamp(baseline.currentMaxScale * drivePct * share, 0, 1),
    currentMinScale: clamp(baseline.currentMinScale * brakePct, 0, 1),
    maxErpm: Math.min(baseline.maxErpm, capErpm),
    minErpm: Math.max(baseline.minErpm, -capErpm),
    minDuty: baseline.minDuty,
    maxDuty: baseline.maxDuty,
    wattMin: baseline.wattMin,
    wattMax: share > 0 ? wattMax : baseline.wattMax,
    inCurrentMin: baseline.inCurrentMin,
    inCurrentMax: share > 0 ? inMax : baseline.inCurrentMax,
  };
}

export function limitsMatch(a: McconfTempLimits, b: McconfTempLimits): boolean {
  return (
    nearlyEqual(a.currentMaxScale, b.currentMaxScale) &&
    nearlyEqual(a.currentMinScale, b.currentMinScale) &&
    nearlyEqual(a.maxErpm, b.maxErpm) &&
    nearlyEqual(a.minErpm, b.minErpm) &&
    nearlyEqual(a.wattMax, b.wattMax) &&
    nearlyEqual(a.inCurrentMax, b.inCurrentMax)
  );
}

export function limitsFromBaseline(b: LimitBaseline): McconfTempLimits {
  return {
    currentMaxScale: b.currentMaxScale,
    currentMinScale: b.currentMinScale,
    maxErpm: b.maxErpm,
    minErpm: b.minErpm,
    minDuty: b.minDuty,
    maxDuty: b.maxDuty,
    wattMin: b.wattMin,
    wattMax: b.wattMax,
    inCurrentMin: b.inCurrentMin,
    inCurrentMax: b.inCurrentMax,
  };
}

/* Persisted per controller UUID so that a page reload does not mistake temporary limits for the base config. */
const STORE_KEY = 'vesc_ride_mode_state_v1';

export interface StoredModeState {
  baseline: LimitBaseline;
  applied: McconfTempLimits | null;
  selection: RideSelection | null;
}

export function loadModeState(uuid: string): StoredModeState | null {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, StoredModeState>;
    return all[uuid] ?? null;
  } catch {
    return null;
  }
}

export function saveModeState(uuid: string, state: StoredModeState): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, StoredModeState>;
    all[uuid] = state;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}
