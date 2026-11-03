export type ThemePolarity = 'dark' | 'light';
export type SpeedSource = 'vesc' | 'gps';
export type TractionDriveMode = '2wd' | '1wd_front_hall' | '1wd_rear_sl';
export type ConnectionTopology = 'sim' | 'can-single-ble' | 'dual-ble' | 'usb';

export type WidgetId = 'motors' | 'battery' | 'efficiency' | 'performance' | 'graph' | 'thermal' | 'trip';

export interface WidgetItemConfig {
  id: WidgetId;
  enabled: boolean;
}

export const WIDGET_TITLES: Record<WidgetId, string> = {
  motors: 'Моторы перед / зад',
  battery: 'Батарея и просадка',
  efficiency: 'Расход и запас хода',
  performance: 'Разгон 0–100',
  graph: 'График мощности и скорости',
  thermal: 'Температуры',
  trip: 'Бортовой компьютер поездки',
};

export interface RideProfile {
  id: string;
  code: string;
  name: string;
  maxSpeedKmh: number;
  currentScalePct: number; // % of motor current max (drive)
  brakeScalePct: number; // % of motor brake current
  maxWatts: number; // whole scooter
  maxBattAmps: number; // whole scooter (split between controllers)
}

export interface BmsStageSpec {
  id: string;
  stageLabel: string;
  perVescAmps: number;
  totalAmps: number;
  powerKw: string;
  whenNote: string;
}

/** Achilleus 100 A BMS ramp-up plan (30 A → 47 A × 2 = 94 A). */
export const ACHILLEUS_BMS_STAGES: BmsStageSpec[] = [
  { id: 'stage1', stageLabel: 'СТАРТ 30А×2', perVescAmps: 30, totalAmps: 60, powerKw: '~3.6 кВт', whenNote: 'Первая неделя обкатки' },
  { id: 'stage2', stageLabel: 'ЭТАП 2 • 35А×2', perVescAmps: 35, totalAmps: 70, powerKw: '~4.2 кВт', whenNote: 'Через 1 неделю' },
  { id: 'stage3', stageLabel: 'ЭТАП 3 • 40А×2', perVescAmps: 40, totalAmps: 80, powerKw: '~4.8 кВт', whenNote: 'Через 2 недели' },
  { id: 'stage4', stageLabel: 'ОПТИМУМ 45А×2', perVescAmps: 45, totalAmps: 90, powerKw: '~5.4 кВт', whenNote: 'Уровень стока Achilleus' },
  { id: 'stage5', stageLabel: 'МАКС 47А×2', perVescAmps: 47, totalAmps: 94, powerKw: '~5.6–6.0 кВт', whenNote: 'Потолок под BMS 100A' },
];

export interface OnboardComputerConfig {
  theme: ThemePolarity;
  speedSource: SpeedSource;
  showSplash: boolean;
  keepScreenAwake: boolean;
  widgets: WidgetItemConfig[];

  profiles: RideProfile[];
  activeProfileId: string;
  tractionMode: TractionDriveMode;
  frontTorqueRatioPct: number;
  limiterKmh: number;
  limiterOn: boolean;

  lastTopology: ConnectionTopology;
  masterIsFrontHall: boolean;
  canSlaveId: number;
  polePairs: number;
  gearRatio: number;
  wheelDiameterMm: number;
  batteryChemistry: 'liion' | 'lifepo4';
  batteryCells: number;
  batteryCapacityAh: number;
  cutoffStartV: number;
  cutoffEndV: number;
  fetWarnTempC: number;
  motorWarnTempC: number;
  typicalWhPerKm: number;
  perEscBatteryAmps: number;

  fwLastOnAmps: number;
  fwDutyStart: number;
}

export const SCOOTER_WHEEL_PRESETS = [
  { label: '10″', mm: 254 },
  { label: '10.5″', mm: 267 },
  { label: '11″ Achilleus', mm: 280 },
  { label: '12″', mm: 305 },
  { label: '13″', mm: 330 },
];

export const PROFILE_ACCENTS: Record<string, string> = {
  eco: '52 211 153',
  normal: '56 189 248',
  sport: '251 146 60',
  turbo_fw: '244 63 94',
};

export function accentForProfile(id: string | null): string {
  if (!id) return '148 163 184';
  return PROFILE_ACCENTS[id] ?? '167 139 250';
}

export const BASE_PROFILE_ID = 'base';

export const DEFAULT_PROFILES: RideProfile[] = [
  { id: 'eco', code: 'ECO', name: 'ECO', maxSpeedKmh: 25, currentScalePct: 35, brakeScalePct: 65, maxWatts: 1500, maxBattAmps: 30 },
  { id: 'normal', code: 'CITY', name: 'CITY', maxSpeedKmh: 55, currentScalePct: 70, brakeScalePct: 85, maxWatts: 3600, maxBattAmps: 60 },
  { id: 'sport', code: 'SPORT', name: 'SPORT', maxSpeedKmh: 80, currentScalePct: 95, brakeScalePct: 100, maxWatts: 5400, maxBattAmps: 90 },
  { id: 'turbo_fw', code: 'TURBO', name: 'TURBO', maxSpeedKmh: 100, currentScalePct: 100, brakeScalePct: 100, maxWatts: 6000, maxBattAmps: 94 },
];

export const DEFAULT_WIDGETS: WidgetItemConfig[] = [
  { id: 'motors', enabled: true },
  { id: 'battery', enabled: true },
  { id: 'efficiency', enabled: true },
  { id: 'performance', enabled: true },
  { id: 'graph', enabled: true },
  { id: 'thermal', enabled: true },
  { id: 'trip', enabled: true },
];

export const DEFAULT_CONFIG: OnboardComputerConfig = {
  theme: 'dark',
  speedSource: 'vesc',
  showSplash: true,
  keepScreenAwake: true,
  widgets: DEFAULT_WIDGETS,

  profiles: DEFAULT_PROFILES,
  // Until the rider picks a mode, the controllers keep their own limits.
  activeProfileId: BASE_PROFILE_ID,
  tractionMode: '2wd',
  frontTorqueRatioPct: 100,
  limiterKmh: 25,
  limiterOn: false,

  lastTopology: 'can-single-ble',
  masterIsFrontHall: true,
  canSlaveId: 1,
  polePairs: 15,
  gearRatio: 1,
  wheelDiameterMm: 280,
  batteryChemistry: 'liion',
  batteryCells: 16,
  batteryCapacityAh: 35,
  cutoffStartV: 46,
  cutoffEndV: 43,
  fetWarnTempC: 80,
  motorWarnTempC: 80,
  typicalWhPerKm: 30,
  perEscBatteryAmps: 47,

  fwLastOnAmps: 20,
  fwDutyStart: 0.85,
};

const STORAGE_KEY = 'vesc_achilleus_v5';
const LEGACY_STORAGE_KEY = 'vesc_achilleus_60v_v4';

const NUMERIC_LIMITS: Partial<Record<keyof OnboardComputerConfig, [number, number]>> = {
  frontTorqueRatioPct: [0, 100],
  limiterKmh: [5, 60],
  canSlaveId: [0, 253],
  polePairs: [1, 100],
  gearRatio: [0.1, 50],
  wheelDiameterMm: [80, 800],
  batteryCells: [3, 32],
  batteryCapacityAh: [1, 200],
  cutoffStartV: [5, 150],
  cutoffEndV: [5, 150],
  fetWarnTempC: [40, 130],
  motorWarnTempC: [40, 180],
  typicalWhPerKm: [5, 150],
  perEscBatteryAmps: [5, 300],
  fwLastOnAmps: [1, 150],
  fwDutyStart: [0.3, 0.98],
};

function sanitizeProfile(p: Partial<RideProfile>, fallback: RideProfile): RideProfile {
  const num = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  return {
    id: typeof p.id === 'string' ? p.id : fallback.id,
    code: typeof p.code === 'string' && p.code.trim() ? p.code.slice(0, 8) : fallback.code,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 24) : fallback.name,
    maxSpeedKmh: num(p.maxSpeedKmh, 5, 150, fallback.maxSpeedKmh),
    currentScalePct: num(p.currentScalePct, 0, 100, fallback.currentScalePct),
    brakeScalePct: num(p.brakeScalePct, 0, 100, fallback.brakeScalePct),
    maxWatts: num(p.maxWatts, 100, 50000, fallback.maxWatts),
    maxBattAmps: num(p.maxBattAmps, 2, 600, fallback.maxBattAmps),
  };
}

export function sanitizeConfig(raw: Partial<OnboardComputerConfig> & Record<string, unknown>): OnboardComputerConfig {
  const cfg: OnboardComputerConfig = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof OnboardComputerConfig)[]) {
    const value = raw[key];
    const def = DEFAULT_CONFIG[key];
    if (value === undefined || typeof value !== typeof def) continue;
    if (typeof def === 'number') {
      const [lo, hi] = NUMERIC_LIMITS[key] ?? [-Infinity, Infinity];
      if (Number.isFinite(value as number)) (cfg as unknown as Record<string, unknown>)[key] = Math.min(hi, Math.max(lo, value as number));
    } else if (typeof def !== 'object') {
      (cfg as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (!['dark', 'light'].includes(cfg.theme)) cfg.theme = 'dark';
  if (!['vesc', 'gps'].includes(cfg.speedSource)) cfg.speedSource = 'vesc';
  if (!['2wd', '1wd_front_hall', '1wd_rear_sl'].includes(cfg.tractionMode)) cfg.tractionMode = '2wd';
  if (!['sim', 'can-single-ble', 'dual-ble', 'usb'].includes(cfg.lastTopology)) cfg.lastTopology = 'can-single-ble';
  if (!['liion', 'lifepo4'].includes(cfg.batteryChemistry)) cfg.batteryChemistry = 'liion';

  if (Array.isArray(raw.profiles) && raw.profiles.length > 0) {
    cfg.profiles = (raw.profiles as Partial<RideProfile>[])
      .slice(0, 6)
      .map((p, i) => sanitizeProfile(p, DEFAULT_PROFILES[i] ?? DEFAULT_PROFILES[DEFAULT_PROFILES.length - 1]));
  }
  // 'base' = the controller's own limits, no ride profile on top.
  if (cfg.activeProfileId !== BASE_PROFILE_ID && !cfg.profiles.some((p) => p.id === cfg.activeProfileId)) {
    cfg.activeProfileId = BASE_PROFILE_ID;
  }

  if (Array.isArray(raw.widgets)) {
    const known = new Set(DEFAULT_WIDGETS.map((w) => w.id));
    const saved = (raw.widgets as Partial<WidgetItemConfig>[]).filter(
      (w): w is WidgetItemConfig => typeof w?.id === 'string' && known.has(w.id as WidgetId)
    );
    const ids = new Set(saved.map((w) => w.id));
    cfg.widgets = [
      ...saved.map((w) => ({ id: w.id, enabled: w.enabled !== false })),
      ...DEFAULT_WIDGETS.filter((w) => !ids.has(w.id)),
    ];
  }
  return cfg;
}

export function loadSavedConfig(): OnboardComputerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeConfig(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      // v4 → v5: keep vehicle parameters and ride profiles, drop old widget layout.
      const parsed = JSON.parse(legacy) as Record<string, unknown>;
      delete parsed.widgets;
      const legacyNames = ['ECO 0–30%', 'NORMAL 55', 'БЕЗ FW • 80', 'TURBO 95 FW'];
      if (Array.isArray(parsed.profiles)) {
        parsed.profiles = (parsed.profiles as Partial<RideProfile>[]).map((p) => {
          const def = DEFAULT_PROFILES.find((d) => d.id === p.id);
          return def && typeof p.name === 'string' && legacyNames.includes(p.name)
            ? { ...p, name: def.name, code: def.code }
            : p;
        });
      }
      // v4 modes never reached the VESC; now they do. Start from the controllers' own limits.
      parsed.activeProfileId = BASE_PROFILE_ID;
      parsed.tractionMode = '2wd';
      return sanitizeConfig(parsed as Partial<OnboardComputerConfig> & Record<string, unknown>);
    }
  } catch {
    // corrupted storage → defaults
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(cfg: OnboardComputerConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // storage full / private mode
  }
}
