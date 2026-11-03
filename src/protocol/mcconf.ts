import { CommPacketId, readFloat32Auto, writeFloat32Auto } from './vescProtocol';
import { MCCONF_LAYOUTS, McconfLayout, McField, McFieldSpec, McFieldType } from './mcconfLayouts';

/**
 * A raw motor configuration exactly as the controller serialized it (without the packet id).
 * We never rebuild the config from scratch: only the bytes of known fields are patched,
 * everything else is echoed back byte-for-byte.
 */
export interface McconfSnapshot {
  layout: McconfLayout;
  bytes: Uint8Array;
  readAt: number;
}

export type McconfValues = Record<McField, number>;

export type McconfParseResult =
  | { ok: true; snapshot: McconfSnapshot }
  | { ok: false; reason: string; signature?: number };

function readField(view: DataView, [offset, type, scale = 1]: McFieldSpec): number {
  switch (type) {
    case 'f32a':
      return readFloat32Auto(view, offset);
    case 'f16':
      return view.getInt16(offset, false) / scale;
    case 'u8':
      return view.getUint8(offset);
    case 'i16':
      return view.getInt16(offset, false);
    case 'u16':
      return view.getUint16(offset, false);
    case 'i32':
      return view.getInt32(offset, false);
    case 'u32':
      return view.getUint32(offset, false);
  }
}

function writeField(view: DataView, [offset, type, scale = 1]: McFieldSpec, value: number): void {
  switch (type) {
    case 'f32a':
      writeFloat32Auto(view, offset, value);
      return;
    case 'f16': {
      // Firmware stores (int16_t)(number * scale); round here to avoid 0.57 * 100 = 56.99… artefacts.
      const scaled = Math.round(value * scale);
      view.setInt16(offset, Math.max(-32768, Math.min(32767, scaled)), false);
      return;
    }
    case 'u8':
      view.setUint8(offset, Math.max(0, Math.min(255, Math.round(value))));
      return;
    case 'i16':
      view.setInt16(offset, Math.round(value), false);
      return;
    case 'u16':
      view.setUint16(offset, Math.round(value), false);
      return;
    case 'i32':
      view.setInt32(offset, Math.round(value), false);
      return;
    case 'u32':
      view.setUint32(offset, Math.round(value) >>> 0, false);
      return;
  }
}

export function findLayout(signature: number): McconfLayout | undefined {
  return MCCONF_LAYOUTS.find((l) => l.signature === signature);
}

export function supportedFirmwareList(): string {
  return MCCONF_LAYOUTS.map((l) => l.fw).join(', ');
}

/** Parse a COMM_GET_MCCONF reply payload (first byte = packet id). */
export function parseMcconfReply(payload: Uint8Array): McconfParseResult {
  if (payload.length < 5 || payload[0] !== CommPacketId.COMM_GET_MCCONF) {
    return { ok: false, reason: 'Ответ не является конфигурацией мотора.' };
  }
  const bytes = payload.slice(1);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0, false);
  const layout = findLayout(signature);
  if (!layout) {
    return {
      ok: false,
      signature,
      reason: `Неизвестная версия конфигурации (сигнатура ${signature}). Поддерживаются прошивки ${supportedFirmwareList()}.`,
    };
  }
  if (bytes.length !== layout.length) {
    return {
      ok: false,
      signature,
      reason: `Размер конфигурации ${bytes.length} байт не совпадает с FW ${layout.fw} (${layout.length}). Запись заблокирована.`,
    };
  }
  const snapshot: McconfSnapshot = { layout, bytes, readAt: Date.now() };
  const problem = plausibilityProblem(decodeMcconf(snapshot));
  if (problem) return { ok: false, signature, reason: `Конфигурация выглядит повреждённой: ${problem}` };
  return { ok: true, snapshot };
}

export function decodeMcconf(snapshot: McconfSnapshot): McconfValues {
  const view = new DataView(snapshot.bytes.buffer, snapshot.bytes.byteOffset, snapshot.bytes.byteLength);
  const out = {} as McconfValues;
  for (const [name, spec] of Object.entries(snapshot.layout.fields) as [McField, McFieldSpec][]) {
    out[name] = readField(view, spec);
  }
  return out;
}

/** Returns a new byte array with only the given fields patched. */
export function patchMcconf(snapshot: McconfSnapshot, patch: Partial<McconfValues>): Uint8Array {
  const bytes = snapshot.bytes.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const [name, value] of Object.entries(patch) as [McField, number][]) {
    if (value === undefined || !Number.isFinite(value)) continue;
    writeField(view, snapshot.layout.fields[name], value);
  }
  return bytes;
}

const FIELD_SIZE: Record<McFieldType, number> = { f32a: 4, f16: 2, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4 };

/**
 * Safety net before a flash write: returns byte offsets that differ between the original and the
 * patched config OUTSIDE the given fields. Anything non-empty means the patch is wrong → abort.
 */
export function changedOutside(layout: McconfLayout, before: Uint8Array, after: Uint8Array, fields: McField[]): number[] {
  if (before.length !== after.length) return [-1];
  const allowed = new Set<number>();
  for (const f of fields) {
    const [offset, type] = layout.fields[f];
    for (let i = 0; i < FIELD_SIZE[type]; i++) allowed.add(offset + i);
  }
  const out: number[] = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i] && !allowed.has(i)) out.push(i);
  return out;
}

function plausibilityProblem(v: McconfValues): string | null {
  if (!(v.l_current_max > 0 && v.l_current_max <= 1000)) return `ток мотора ${v.l_current_max} А`;
  if (!(v.l_in_current_max > 0 && v.l_in_current_max <= 1000)) return `ток АКБ ${v.l_in_current_max} А`;
  if (!(v.foc_fw_current_max >= 0 && v.foc_fw_current_max <= 1000)) return `ток FW ${v.foc_fw_current_max} А`;
  if (!(v.foc_fw_duty_start >= 0 && v.foc_fw_duty_start <= 1.01)) return `FW duty ${v.foc_fw_duty_start}`;
  if (!(v.l_max_duty > 0.1 && v.l_max_duty <= 1)) return `max duty ${v.l_max_duty}`;
  if (!(v.si_motor_poles >= 2 && v.si_motor_poles <= 200)) return `полюса ${v.si_motor_poles}`;
  if (!(v.l_current_max_scale >= 0 && v.l_current_max_scale <= 1.01)) return `scale ${v.l_current_max_scale}`;
  return null;
}

/* ---------- Field weakening ---------- */

export interface FwSettings {
  enabled: boolean;
  currentA: number;
  dutyStart: number; // 0..1 fraction of max duty
  rampTimeS: number;
}

export function readFw(values: McconfValues): FwSettings {
  const minCurrent = Math.max(values.cc_min_current, 0.001);
  return {
    enabled: values.foc_fw_current_max >= minCurrent && values.foc_fw_duty_start < 0.99,
    currentA: values.foc_fw_current_max,
    dutyStart: values.foc_fw_duty_start,
    rampTimeS: values.foc_fw_ramp_time,
  };
}

/**
 * Two motors on one scooter must weaken the field alike: above its own base speed a
 * motor without (or with less) FW back-feeds through the MOSFET body diodes and brakes.
 */
export function fwDiffers(a: FwSettings, b: FwSettings): boolean {
  if (a.enabled !== b.enabled) return true;
  if (!a.enabled) return false;
  return Math.abs(a.currentA - b.currentA) > 2 || Math.abs(a.dutyStart - b.dutyStart) > 0.03;
}

/** Firmware disables FW when foc_fw_current_max < cc_min_current, so OFF = 0 A. */
export function fwPatch(enabled: boolean, currentA: number, dutyStart: number): Partial<McconfValues> {
  return {
    foc_fw_current_max: enabled ? Math.round(currentA * 10) / 10 : 0,
    foc_fw_duty_start: Math.min(0.98, Math.max(0.3, dutyStart)),
  };
}

export function isMotorFoc(values: McconfValues): boolean {
  return values.motor_type === 2; // MOTOR_TYPE_FOC
}

/* ---------- Live limit baseline (for ride modes) ---------- */

export interface LimitBaseline {
  currentMaxScale: number;
  currentMinScale: number;
  minErpm: number;
  maxErpm: number;
  minDuty: number;
  maxDuty: number;
  wattMin: number;
  wattMax: number;
  inCurrentMin: number;
  inCurrentMax: number;
  motorCurrentMax: number;
  brakeCurrentMax: number;
}

export function baselineFromValues(v: McconfValues): LimitBaseline {
  return {
    currentMaxScale: v.l_current_max_scale,
    currentMinScale: v.l_current_min_scale,
    minErpm: v.l_min_erpm,
    maxErpm: v.l_max_erpm,
    minDuty: v.l_min_duty,
    maxDuty: v.l_max_duty,
    wattMin: v.l_watt_min,
    wattMax: v.l_watt_max,
    inCurrentMin: v.l_in_current_min,
    inCurrentMax: v.l_in_current_max,
    motorCurrentMax: v.l_current_max,
    brakeCurrentMax: Math.abs(v.l_current_min),
  };
}

/** Patch that restores the baseline limits, so temporary ride-mode limits never end up in flash. */
export function baselinePatch(b: LimitBaseline): Partial<McconfValues> {
  return {
    l_current_max_scale: b.currentMaxScale,
    l_current_min_scale: b.currentMinScale,
    l_min_erpm: b.minErpm,
    l_max_erpm: b.maxErpm,
    l_min_duty: b.minDuty,
    l_max_duty: b.maxDuty,
    l_watt_min: b.wattMin,
    l_watt_max: b.wattMax,
    l_in_current_min: b.inCurrentMin,
    l_in_current_max: b.inCurrentMax,
  };
}

export function nearlyEqual(a: number, b: number, rel = 2e-3): boolean {
  return Math.abs(a - b) <= Math.max(1e-3, Math.abs(b) * rel);
}
