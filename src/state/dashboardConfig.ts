export type ThemePolarity = 'dark' | 'light';
export type PrimaryHeroMetric = 'speed' | 'power' | 'rpm' | 'duty';
export type FontDensity = 'normal' | 'large';
export type SpeedometerStyle = 'classic' | 'cyberpunk';
export type SpeedSource = 'vesc' | 'gps';
export type DashboardPresetId = 'scooter_pro' | 'minimal' | 'dual_esc';
export type TractionDriveMode = '2wd' | '1wd_front_hall' | '1wd_rear_sl';

export type WidgetId =
  | 'battery'
  | 'sag_health'
  | 'power_graph'
  | 'dual_balance'
  | 'field_weakening'
  | 'drag_timer'
  | 'range_efficiency'
  | 'temps_fet'
  | 'temps_motor'
  | 'trip'
  | 'currents'
  | 'peaks'
  | 'speed_graph';

export interface WidgetItemConfig {
  id: WidgetId;
  title: string;
  enabled: boolean;
  span: 1 | 2;
}

export interface RideProfile {
  id: string;
  code: string;
  name: string;
  maxSpeedKmh: number;
  maxReverseKmh: number;
  currentScalePct: number; // % of Motor Current Max (80-100A)
  brakeScalePct: number;   // % of Motor Brake Max (-60A)
  maxWatts: number;        // System battery power cap
  maxBattAmps: number;     // Total battery current cap across both VESCs (up to 94A)
}

export interface BmsStageSpec {
  id: string;
  stageLabel: string;
  perVescAmps: number;
  totalAmps: number;
  powerKw: string;
  whenNote: string;
}

/**
 * Exact Section 20.3 Achilleus 100A BMS Ramp-Up Plan (30A -> 47A x 2 = 94A)!
 */
export const ACHILLEUS_BMS_STAGES: BmsStageSpec[] = [
  {
    id: 'stage1',
    stageLabel: 'СТАРТ 30А×2',
    perVescAmps: 30,
    totalAmps: 60,
    powerKw: '~3.6 кВт',
    whenNote: 'Первая неделя обкатки',
  },
  {
    id: 'stage2',
    stageLabel: 'ЭТАП 2 • 35А×2',
    perVescAmps: 35,
    totalAmps: 70,
    powerKw: '~4.2 кВт',
    whenNote: 'Через 1 неделю',
  },
  {
    id: 'stage3',
    stageLabel: 'ЭТАП 3 • 40А×2',
    perVescAmps: 40,
    totalAmps: 80,
    powerKw: '~4.8 кВт',
    whenNote: 'Через 2 недели',
  },
  {
    id: 'stage4',
    stageLabel: 'ОПТИМУМ 45А×2',
    perVescAmps: 45,
    totalAmps: 90,
    powerKw: '~5.4 кВт',
    whenNote: 'Уровень стока Achilleus',
  },
  {
    id: 'stage5',
    stageLabel: 'МАКС 47А×2',
    perVescAmps: 47,
    totalAmps: 94,
    powerKw: '~5.6–6.0 кВт',
    whenNote: 'Потолок под BMS 100A',
  },
];

export interface OnboardComputerConfig {
  theme: ThemePolarity;
  speedometerStyle: SpeedometerStyle;
  speedSource: SpeedSource;
  heroMetric: PrimaryHeroMetric;
  fontDensity: FontDensity;
  showProfileBarOnDash: boolean;
  showSubStatsBar: boolean;
  keepScreenAwake: boolean;
  tractionMode: TractionDriveMode;
  frontTorqueRatioPct: number;
  fieldWeakeningSim: boolean; // Mirrors Section 21 FW 10A @ 0.90 duty (90-95 km/h)
  activeProfileId: string;
  profiles: RideProfile[];
  widgets: WidgetItemConfig[];

  // Exact Dualtron Achilleus + 2x Flipsky 75100 Pro V2 architecture (Sections 16-23)
  masterIsFrontHall: boolean;   // TRUE = ID 0 is Front (Halls + ADC), ID 1 is Rear (Sensorless)
  driveType: 'current' | 'duty' | 'rpm';
  maxCurrentAmps: number;       // 90A Phase Motor Current Max (Section 16.4: 80-100A)
  perEscBatteryAmps: number;    // 30A start -> 47A max (= 94A total for 100A Achilleus BMS!)
  maxBrakeAmps: number;         // 60A Motor Current Brake Max (Section 16.4: -60A)
  handbrakeAmps: number;
  pinCode: string;
  rampRatePerSec: number;
  invertFront: boolean;
  invertRear: boolean;
  canSlaveId: number;           // ID 1 = Slave Rear Sensorless (Section 18.7)
  polePairs: number;            // 15 pole pairs (30 magnets Achilleus 11")
  gearRatio: number;            // 1.0
  wheelDiameterMm: number;      // 280 mm (11" Achilleus tire)
  batteryChemistry: 'liion' | 'lifepo4';
  batteryCells: number;         // 16S Li-Ion
  batteryCapacityAh: number;    // 35 Ah LG 21700 Achilleus pack!
  cutoffStartV: number;         // 46.0V (Section 23.3)
  cutoffEndV: number;           // 43.0V (Section 23.3)
  fetWarnTempC: number;         // 80°C Cutoff Start (Section 23.2)
  motorWarnTempC: number;       // 80°C Cutoff Start (Section 23.2)
}

export const SCOOTER_WHEEL_PRESETS = [
  { label: '10" (254 мм)', mm: 254 },
  { label: '10.5" (267 мм)', mm: 267 },
  { label: '11" Achilleus', mm: 280 },
  { label: '12" (305 мм)', mm: 305 },
];

export const DEFAULT_PROFILES: RideProfile[] = [
  {
    id: 'eco',
    code: '01',
    name: 'ECO 0–30%',
    maxSpeedKmh: 25,
    maxReverseKmh: 10,
    currentScalePct: 35,
    brakeScalePct: 65,
    maxWatts: 1500,
    maxBattAmps: 30,
  },
  {
    id: 'normal',
    code: '02',
    name: 'NORMAL 55',
    maxSpeedKmh: 55,
    maxReverseKmh: 14,
    currentScalePct: 70,
    brakeScalePct: 85,
    maxWatts: 3600,
    maxBattAmps: 60,
  },
  {
    id: 'sport',
    code: '03',
    name: 'БЕЗ FW • 80',
    maxSpeedKmh: 80,
    maxReverseKmh: 18,
    currentScalePct: 95,
    brakeScalePct: 100,
    maxWatts: 5400,
    maxBattAmps: 90,
  },
  {
    id: 'turbo_fw',
    code: '04',
    name: 'TURBO 95 FW',
    maxSpeedKmh: 95,
    maxReverseKmh: 20,
    currentScalePct: 100,
    brakeScalePct: 100,
    maxWatts: 5800,
    maxBattAmps: 94,
  },
];

export const DEFAULT_WIDGETS: WidgetItemConfig[] = [
  { id: 'battery', title: 'АКБ Achilleus 16S (43–67.2В)', enabled: true, span: 1 },
  { id: 'sag_health', title: 'BMS 100A • Ток и просадка', enabled: true, span: 1 },
  { id: 'dual_balance', title: 'ID0 Перед (Hall) • ID1 Зад (SL)', enabled: true, span: 2 },
  { id: 'power_graph', title: 'Мощность (до 5.8 кВт) + график', enabled: true, span: 2 },
  { id: 'field_weakening', title: 'Field Weakening (10A @ 90%)', enabled: true, span: 1 },
  { id: 'drag_timer', title: 'Разгон 0–30 / 0–50 км/ч', enabled: true, span: 1 },
  { id: 'temps_fet', title: 'MOSFET Перед / Зад (80°C)', enabled: true, span: 1 },
  { id: 'temps_motor', title: 'Моторы Перед / Зад (80°C)', enabled: true, span: 1 },
  { id: 'range_efficiency', title: 'Запас хода (35 А·ч) и Вт·ч/км', enabled: true, span: 1 },
  { id: 'trip', title: 'Пробег TRIP и ODO (км)', enabled: true, span: 1 },
  { id: 'currents', title: 'Детализация токов фаз и АКБ', enabled: false, span: 2 },
  { id: 'peaks', title: 'Рекорды заезда (MAX)', enabled: false, span: 2 },
  { id: 'speed_graph', title: 'График скорости (0–95 км/ч)', enabled: false, span: 2 },
];

export const DEFAULT_CONFIG: OnboardComputerConfig = {
  theme: 'dark',
  speedometerStyle: 'classic',
  speedSource: 'vesc',
  heroMetric: 'speed',
  fontDensity: 'large',
  showProfileBarOnDash: true,
  showSubStatsBar: true,
  keepScreenAwake: true,
  tractionMode: '2wd',
  frontTorqueRatioPct: 90,
  fieldWeakeningSim: true,
  activeProfileId: 'turbo_fw',
  profiles: DEFAULT_PROFILES,
  widgets: DEFAULT_WIDGETS,

  masterIsFrontHall: true,
  driveType: 'current',
  maxCurrentAmps: 90,        // Section 16.4: 80-100A phase
  perEscBatteryAmps: 47,     // Section 20.1 / 20.3: 47A x 2 = 94A (under 100A Achilleus BMS)
  maxBrakeAmps: 60,          // Section 16.4: -60A regen
  handbrakeAmps: 18,
  pinCode: '',
  rampRatePerSec: 5.5,
  invertFront: false,
  invertRear: false,
  canSlaveId: 1,
  polePairs: 15,
  gearRatio: 1,
  wheelDiameterMm: 280,      // 11" Dualtron Achilleus tire
  batteryChemistry: 'liion',
  batteryCells: 16,          // 16S Li-Ion 60V
  batteryCapacityAh: 35,     // Dualtron Achilleus 60V 35Ah LG 21700 battery!
  cutoffStartV: 46,          // Section 23.3: 46V
  cutoffEndV: 43,            // Section 23.3: 43V
  fetWarnTempC: 80,          // Section 23.2: 80°C Cutoff Start
  motorWarnTempC: 80,        // Section 23.2: 80°C Cutoff Start
};

const STORAGE_KEY = 'vesc_achilleus_60v_v4';
const ODO_STORAGE_KEY = 'vesc_75100_odometer_km';

export function loadSavedConfig(): OnboardComputerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<OnboardComputerConfig>;
    const savedMap = new Map((parsed.widgets ?? []).map((w) => [w.id, w]));
    const mergedWidgets: WidgetItemConfig[] = [];
    for (const w of parsed.widgets ?? []) {
      const def = DEFAULT_WIDGETS.find((d) => d.id === w.id);
      if (def) mergedWidgets.push({ ...def, ...w });
    }
    for (const def of DEFAULT_WIDGETS) {
      if (!savedMap.has(def.id)) mergedWidgets.push(def);
    }
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      widgets: mergedWidgets.length > 0 ? mergedWidgets : DEFAULT_WIDGETS,
      profiles:
        Array.isArray(parsed.profiles) && parsed.profiles.length > 0
          ? parsed.profiles
          : DEFAULT_PROFILES,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: OnboardComputerConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage errors
  }
}

export function loadTotalOdometerKm(): number {
  try {
    const val = Number(localStorage.getItem(ODO_STORAGE_KEY) || '0');
    return Number.isFinite(val) && val >= 0 ? val : 0;
  } catch {
    return 0;
  }
}

export function saveTotalOdometerKm(km: number): void {
  try {
    localStorage.setItem(ODO_STORAGE_KEY, km.toFixed(3));
  } catch {
    // Ignore
  }
}

export function applyPresetWidgets(
  preset: DashboardPresetId,
  current: WidgetItemConfig[]
): WidgetItemConfig[] {
  const orderByPreset: Record<DashboardPresetId, Array<{ id: WidgetId; span: 1 | 2 }>> = {
    minimal: [
      { id: 'battery', span: 1 },
      { id: 'sag_health', span: 1 },
      { id: 'trip', span: 2 },
    ],
    scooter_pro: [
      { id: 'battery', span: 1 },
      { id: 'sag_health', span: 1 },
      { id: 'dual_balance', span: 2 },
      { id: 'power_graph', span: 2 },
      { id: 'field_weakening', span: 1 },
      { id: 'drag_timer', span: 1 },
      { id: 'temps_fet', span: 1 },
      { id: 'temps_motor', span: 1 },
      { id: 'range_efficiency', span: 1 },
      { id: 'trip', span: 1 },
    ],
    dual_esc: [
      { id: 'dual_balance', span: 2 },
      { id: 'field_weakening', span: 2 },
      { id: 'currents', span: 2 },
      { id: 'temps_fet', span: 1 },
      { id: 'temps_motor', span: 1 },
      { id: 'peaks', span: 2 },
    ],
  };

  const activeSpec = orderByPreset[preset];
  const activeIds = new Set(activeSpec.map((x) => x.id));
  const result: WidgetItemConfig[] = [];

  for (const item of activeSpec) {
    const base = current.find((c) => c.id === item.id);
    if (base) result.push({ ...base, enabled: true, span: item.span });
  }
  for (const rest of current) {
    if (!activeIds.has(rest.id)) {
      result.push({ ...rest, enabled: false });
    }
  }
  return result;
}
