/**
 * VESC 5.x–7.x binary protocol (UART / BLE NUS / USB CDC).
 * Verified against vedderb/bldc commands.c / datatypes.h (release_6_05).
 */

export const CommPacketId = {
  COMM_FW_VERSION: 0,
  COMM_GET_VALUES: 4,
  COMM_SET_MCCONF: 13,
  COMM_GET_MCCONF: 14,
  COMM_PRINT: 21,
  COMM_ALIVE: 30,
  COMM_FORWARD_CAN: 34,
  COMM_SET_MCCONF_TEMP: 48,
  COMM_SET_MCCONF_TEMP_SETUP: 49,
  COMM_PING_CAN: 62,
} as const;

export type CommPacketId = (typeof CommPacketId)[keyof typeof CommPacketId];

export interface VescTelemetry {
  tempFet: number; // °C
  tempMotor: number; // °C
  avgMotorCurrent: number; // A (phase current)
  avgInputCurrent: number; // A (battery current)
  avgId: number; // A (negative = field weakening)
  avgIq: number; // A
  dutyNow: number; // -1.0 .. +1.0
  erpm: number; // electrical RPM
  vIn: number; // battery voltage (V)
  ampHours: number; // consumed Ah since boot
  ampHoursCharged: number; // regen Ah since boot
  wattHours: number; // consumed Wh since boot
  wattHoursCharged: number; // regen Wh since boot
  tachometer: number;
  tachometerAbs: number;
  faultCode: number;
  faultText: string;
  controllerId: number | null;
  updatedAt: number;
}

export interface VescFirmwareInfo {
  fwMajor: number;
  fwMinor: number;
  hwName: string;
  uuid: string;
  testVersion: number;
}

/** Full fault list from datatypes.h (mc_fault_code). */
const VESC_FAULT_CODES_RU: readonly string[] = [
  'НОРМА',
  'ПЕРЕНАПРЯЖЕНИЕ',
  'НИЗКОЕ НАПРЯЖЕНИЕ АКБ',
  'ОШИБКА DRV',
  'ПРЕВЫШЕН ABS ТОК',
  'ПЕРЕГРЕВ MOSFET',
  'ПЕРЕГРЕВ МОТОРА',
  'ПЕРЕНАПРЯЖЕНИЕ ДРАЙВЕРА',
  'НИЗКОЕ НАПРЯЖЕНИЕ ДРАЙВЕРА',
  'НИЗКОЕ НАПРЯЖЕНИЕ MCU',
  'СБРОС ПО WATCHDOG',
  'ЭНКОДЕР SPI',
  'ЭНКОДЕР SIN/COS: МАЛО',
  'ЭНКОДЕР SIN/COS: МНОГО',
  'ПОВРЕЖДЕНИЕ FLASH',
  'СМЕЩЕНИЕ ДАТЧИКА ТОКА 1',
  'СМЕЩЕНИЕ ДАТЧИКА ТОКА 2',
  'СМЕЩЕНИЕ ДАТЧИКА ТОКА 3',
  'ДИСБАЛАНС ТОКОВ ФАЗ',
  'BRK: АППАРАТНАЯ ЗАЩИТА',
  'РЕЗОЛЬВЕР LOT',
  'РЕЗОЛЬВЕР DOS',
  'РЕЗОЛЬВЕР LOS',
  'FLASH: КОНФИГ ПРИЛОЖЕНИЯ',
  'FLASH: КОНФИГ МОТОРА',
  'ЭНКОДЕР: НЕТ МАГНИТА',
  'ЭНКОДЕР: СИЛЬНЫЙ МАГНИТ',
  'ФАЗНЫЙ ФИЛЬТР',
  'ОШИБКА ЭНКОДЕРА',
  'ОШИБКА ВЫХОДА LV',
];

export function faultCodeToRu(code: number): string {
  return VESC_FAULT_CODES_RU[code] ?? `ОШИБКА #${code}`;
}

export function crc16(buf: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function encodeVescFrame(payload: Uint8Array): Uint8Array {
  const crc = crc16(payload);
  const long = payload.length > 255;
  const header = long ? 3 : 2;
  const frame = new Uint8Array(payload.length + header + 3);
  if (long) {
    frame[0] = 0x03;
    frame[1] = (payload.length >> 8) & 0xff;
    frame[2] = payload.length & 0xff;
  } else {
    frame[0] = 0x02;
    frame[1] = payload.length;
  }
  frame.set(payload, header);
  frame[header + payload.length] = (crc >> 8) & 0xff;
  frame[header + payload.length + 1] = crc & 0xff;
  frame[header + payload.length + 2] = 0x03;
  return frame;
}

export function wrapForwardCan(canId: number, innerPayload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + innerPayload.length);
  out[0] = CommPacketId.COMM_FORWARD_CAN;
  out[1] = canId & 0xff;
  out.set(innerPayload, 2);
  return out;
}

/* ---------- VESC buffer helpers ---------- */

/** buffer_get_float32_auto — IEEE-754 big endian, subnormals treated as zero. */
export function readFloat32Auto(view: DataView, offset: number): number {
  const raw = view.getUint32(offset, false);
  const e = (raw >>> 23) & 0xff;
  const sigI = raw & 0x7fffff;
  const neg = (raw & 0x80000000) !== 0;
  let sig = 0;
  let exp = 0;
  if (e !== 0 || sigI !== 0) {
    sig = sigI / (8388608 * 2) + 0.5;
    exp = e - 126;
  }
  const value = sig * 2 ** exp;
  return neg ? -value : value;
}

/** buffer_append_float32_auto (exact port of the firmware encoder). */
export function writeFloat32Auto(view: DataView, offset: number, value: number): void {
  let number = Number.isFinite(value) ? value : 0;
  if (Math.abs(number) < 1.5e-38) number = 0;
  let e = 0;
  let sig = 0;
  if (number !== 0) {
    e = Math.floor(Math.log2(Math.abs(number))) + 1;
    sig = number / 2 ** e;
    // Guard against floating point edge cases of log2.
    if (Math.abs(sig) >= 1) {
      sig /= 2;
      e += 1;
    } else if (Math.abs(sig) < 0.5) {
      sig *= 2;
      e -= 1;
    }
  }
  const sigAbs = Math.abs(sig);
  let sigI = 0;
  if (sigAbs >= 0.5) {
    sigI = Math.floor((sigAbs - 0.5) * 2 * 8388608);
    e += 126;
  }
  let res = ((e & 0xff) << 23) | (sigI & 0x7fffff);
  if (sig < 0) res |= 0x80000000;
  view.setUint32(offset, res >>> 0, false);
}

/* ---------- Payload builders ---------- */

export const payloadGetFwVersion = (): Uint8Array => new Uint8Array([CommPacketId.COMM_FW_VERSION]);
export const payloadGetValues = (): Uint8Array => new Uint8Array([CommPacketId.COMM_GET_VALUES]);
export const payloadPingCan = (): Uint8Array => new Uint8Array([CommPacketId.COMM_PING_CAN]);
export const payloadAlive = (): Uint8Array => new Uint8Array([CommPacketId.COMM_ALIVE]);
export const payloadGetMcconf = (): Uint8Array => new Uint8Array([CommPacketId.COMM_GET_MCCONF]);

export function payloadSetMcconf(serialized: Uint8Array): Uint8Array {
  const out = new Uint8Array(serialized.length + 1);
  out[0] = CommPacketId.COMM_SET_MCCONF;
  out.set(serialized, 1);
  return out;
}

/** Live (RAM-only when store=false) limits — COMM_SET_MCCONF_TEMP. */
export interface McconfTempLimits {
  currentMinScale: number; // 0..1 (braking)
  currentMaxScale: number; // 0..1 (drive)
  minErpm: number;
  maxErpm: number;
  minDuty: number;
  maxDuty: number;
  wattMin: number;
  wattMax: number;
  inCurrentMin: number;
  inCurrentMax: number;
}

export function payloadSetMcconfTemp(limits: McconfTempLimits, store = false): Uint8Array {
  const values = [
    limits.currentMinScale,
    limits.currentMaxScale,
    limits.minErpm,
    limits.maxErpm,
    limits.minDuty,
    limits.maxDuty,
    limits.wattMin,
    limits.wattMax,
    limits.inCurrentMin,
    limits.inCurrentMax,
  ];
  const out = new Uint8Array(5 + values.length * 4);
  const view = new DataView(out.buffer);
  out[0] = CommPacketId.COMM_SET_MCCONF_TEMP;
  out[1] = store ? 1 : 0; // store to flash
  out[2] = 0; // forward to CAN (we address every controller explicitly)
  out[3] = 1; // ack
  out[4] = 0; // divide by controllers
  values.forEach((v, i) => writeFloat32Auto(view, 5 + i * 4, v));
  return out;
}

/* ---------- Parsers ---------- */

export function parseGetValues(payload: Uint8Array): VescTelemetry | null {
  if (payload.length < 54 || payload[0] !== CommPacketId.COMM_GET_VALUES) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const tempMotorRaw = dv.getInt16(3, false) / 10;
  const faultCode = dv.getUint8(53);
  return {
    tempFet: dv.getInt16(1, false) / 10,
    // Unconnected NTC reads absurd values: show 0 instead of −200 °C.
    tempMotor: tempMotorRaw < -40 || tempMotorRaw > 220 ? 0 : tempMotorRaw,
    avgMotorCurrent: dv.getInt32(5, false) / 100,
    avgInputCurrent: dv.getInt32(9, false) / 100,
    avgId: dv.getInt32(13, false) / 100,
    avgIq: dv.getInt32(17, false) / 100,
    dutyNow: dv.getInt16(21, false) / 1000,
    erpm: dv.getInt32(23, false),
    vIn: dv.getInt16(27, false) / 10,
    ampHours: dv.getInt32(29, false) / 10000,
    ampHoursCharged: dv.getInt32(33, false) / 10000,
    wattHours: dv.getInt32(37, false) / 10000,
    wattHoursCharged: dv.getInt32(41, false) / 10000,
    tachometer: dv.getInt32(45, false),
    tachometerAbs: dv.getInt32(49, false),
    faultCode,
    faultText: faultCodeToRu(faultCode),
    controllerId: payload.length >= 59 ? dv.getUint8(58) : null,
    updatedAt: Date.now(),
  };
}

export function parseFwVersion(payload: Uint8Array): VescFirmwareInfo | null {
  if (payload.length < 3 || payload[0] !== CommPacketId.COMM_FW_VERSION) return null;
  let end = 3;
  while (end < payload.length && payload[end] !== 0) end++;
  const hwName = new TextDecoder().decode(payload.slice(3, end)) || 'VESC';
  const uuidBytes = payload.slice(end + 1, end + 13);
  const uuid = Array.from(uuidBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const testVersion = payload.length > end + 14 ? payload[end + 14] : 0;
  return { fwMajor: payload[1], fwMinor: payload[2], hwName, uuid, testVersion };
}

/* ---------- Stream re-assembly ---------- */

export class VescPacketAssembler {
  private buffer = new Uint8Array(0);
  private lastChunkAt = 0;
  private readonly maxBuffer = 4096;
  private readonly rxTimeoutMs = 400;

  private tryReadFrameAt(
    buf: Uint8Array,
    offset: number
  ): { status: 'invalid' | 'incomplete' | 'valid'; payload?: Uint8Array; totalFrameLen?: number } {
    const startByte = buf[offset];
    if (startByte !== 0x02 && startByte !== 0x03) return { status: 'invalid' };
    const headerLen = startByte === 0x02 ? 2 : 3;
    if (buf.length - offset < headerLen) return { status: 'incomplete' };
    const payloadLen = startByte === 0x02 ? buf[offset + 1] : (buf[offset + 1] << 8) | buf[offset + 2];
    if (payloadLen <= 0 || payloadLen > 1024 || (startByte === 0x03 && payloadLen <= 255)) {
      return { status: 'invalid' };
    }
    const totalFrameLen = headerLen + payloadLen + 3;
    if (buf.length - offset < totalFrameLen) return { status: 'incomplete', totalFrameLen };
    if (buf[offset + totalFrameLen - 1] !== 0x03) return { status: 'invalid' };
    const payloadStart = offset + headerLen;
    const payload = buf.slice(payloadStart, payloadStart + payloadLen);
    const expectedCrc = (buf[payloadStart + payloadLen] << 8) | buf[payloadStart + payloadLen + 1];
    if (crc16(payload) !== expectedCrc) return { status: 'invalid' };
    return { status: 'valid', payload, totalFrameLen };
  }

  push(chunk: Uint8Array, now = Date.now()): Uint8Array[] {
    if (chunk.length === 0) return [];
    if (this.buffer.length > 0 && this.lastChunkAt > 0 && now - this.lastChunkAt > this.rxTimeoutMs) {
      this.buffer = new Uint8Array(0);
    }
    this.lastChunkAt = now;

    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged.length > this.maxBuffer ? merged.slice(merged.length - this.maxBuffer) : merged;

    const frames: Uint8Array[] = [];
    let offset = 0;
    while (offset < this.buffer.length) {
      const attempt = this.tryReadFrameAt(this.buffer, offset);
      if (attempt.status === 'invalid') {
        offset++;
        continue;
      }
      if (attempt.status === 'valid' && attempt.payload && attempt.totalFrameLen) {
        frames.push(attempt.payload);
        offset += attempt.totalFrameLen;
        continue;
      }
      // Incomplete: maybe it is a false start byte and a valid frame follows.
      let foundInnerValid = false;
      for (let scan = offset + 1; scan < this.buffer.length; scan++) {
        if (this.buffer[scan] === 0x02 || this.buffer[scan] === 0x03) {
          if (this.tryReadFrameAt(this.buffer, scan).status === 'valid') {
            offset = scan;
            foundInnerValid = true;
            break;
          }
        }
      }
      if (!foundInnerValid) break;
    }
    if (offset > 0) this.buffer = this.buffer.slice(offset);
    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.lastChunkAt = 0;
  }
}

/* ---------- Battery model ---------- */

// Resting open-circuit voltage → state of charge for 21700 NMC cells (LG M50 class).
const LIION_OCV: ReadonlyArray<readonly [number, number]> = [
  [3.0, 0],
  [3.3, 2],
  [3.45, 5],
  [3.55, 9],
  [3.62, 14],
  [3.68, 20],
  [3.73, 28],
  [3.78, 36],
  [3.83, 45],
  [3.88, 54],
  [3.93, 62],
  [3.98, 70],
  [4.03, 78],
  [4.08, 86],
  [4.13, 93],
  [4.18, 100],
];

const LIFEPO4_OCV: ReadonlyArray<readonly [number, number]> = [
  [2.8, 0],
  [3.0, 5],
  [3.15, 10],
  [3.22, 20],
  [3.26, 35],
  [3.29, 55],
  [3.31, 70],
  [3.33, 85],
  [3.36, 95],
  [3.45, 100],
];

export function cellVoltageToSoc(cellV: number, chemistry: 'liion' | 'lifepo4'): number {
  const table = chemistry === 'lifepo4' ? LIFEPO4_OCV : LIION_OCV;
  if (!Number.isFinite(cellV) || cellV <= table[0][0]) return 0;
  if (cellV >= table[table.length - 1][0]) return 100;
  for (let i = 1; i < table.length; i++) {
    const [v1, s1] = table[i];
    if (cellV <= v1) {
      const [v0, s0] = table[i - 1];
      return s0 + ((cellV - v0) / (v1 - v0)) * (s1 - s0);
    }
  }
  return 100;
}

export function fullCellVoltage(chemistry: 'liion' | 'lifepo4'): number {
  return chemistry === 'lifepo4' ? 3.65 : 4.2;
}

export function nominalCellVoltage(chemistry: 'liion' | 'lifepo4'): number {
  return chemistry === 'lifepo4' ? 3.2 : 3.63;
}

/* ---------- Kinematics ---------- */

export function erpmToKmh(erpm: number, polePairs: number, gearRatio: number, wheelDiameterMm: number): number {
  if (polePairs <= 0 || gearRatio <= 0 || wheelDiameterMm <= 0) return 0;
  const wheelRpm = erpm / polePairs / gearRatio;
  return (wheelRpm * Math.PI * (wheelDiameterMm / 1000) * 60) / 1000;
}

export function kmhToErpm(kmh: number, polePairs: number, gearRatio: number, wheelDiameterMm: number): number {
  const circumferenceM = Math.PI * (wheelDiameterMm / 1000);
  if (circumferenceM <= 0) return 100000;
  const wheelRpm = (kmh * 1000) / (60 * circumferenceM);
  return Math.round(wheelRpm * gearRatio * polePairs);
}

/** Tachometer counts 6 steps per electrical revolution. */
export function tachoToKm(steps: number, polePairs: number, gearRatio: number, wheelDiameterMm: number): number {
  if (polePairs <= 0 || gearRatio <= 0) return 0;
  const wheelRevs = steps / (6 * polePairs * gearRatio);
  return (wheelRevs * Math.PI * wheelDiameterMm) / 1e6;
}

export function emptyTelemetry(): VescTelemetry {
  return {
    tempFet: 0,
    tempMotor: 0,
    avgMotorCurrent: 0,
    avgInputCurrent: 0,
    avgId: 0,
    avgIq: 0,
    dutyNow: 0,
    erpm: 0,
    vIn: 0,
    ampHours: 0,
    ampHoursCharged: 0,
    wattHours: 0,
    wattHoursCharged: 0,
    tachometer: 0,
    tachometerAbs: 0,
    faultCode: 0,
    faultText: 'НОРМА',
    controllerId: null,
    updatedAt: 0,
  };
}
