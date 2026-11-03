/**
 * Genuine VESC Firmware 6.x Binary UART / BLE Protocol Implementation
 * Tuned for 60V / 100A / 6kW Dual Flipsky 75100 Pro V2 Electric Scooter.
 */

export const CommPacketId = {
  COMM_FW_VERSION: 0,
  COMM_GET_VALUES: 4,
  COMM_SET_DUTY: 5,
  COMM_SET_CURRENT: 6,
  COMM_SET_CURRENT_BRAKE: 7,
  COMM_SET_RPM: 8,
  COMM_SET_POS: 9,
  COMM_SET_HANDBRAKE: 10,
  COMM_PRINT: 21,
  COMM_REBOOT: 29,
  COMM_ALIVE: 30,
  COMM_FORWARD_CAN: 34,
  COMM_SET_MCCONF_TEMP: 48,
  COMM_PING_CAN: 62,
} as const;

export type CommPacketId = (typeof CommPacketId)[keyof typeof CommPacketId];

export interface VescTelemetry {
  tempFet: number;          // °C
  tempMotor: number;        // °C
  avgMotorCurrent: number;  // A (phase current)
  avgInputCurrent: number;  // A (battery current)
  avgId: number;            // A
  avgIq: number;            // A
  dutyNow: number;          // -1.0 .. +1.0
  erpm: number;             // Electrical RPM
  vIn: number;              // Battery Voltage (V)
  ampHours: number;         // Consumed Ah
  ampHoursCharged: number;  // Regen Ah
  wattHours: number;        // Consumed Wh
  wattHoursCharged: number; // Regen Wh
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
}

export const VESC_FAULT_CODES_RU: Record<number, string> = {
  0: 'НОРМА',
  1: 'ПЕРЕНАПРЯЖЕНИЕ АКБ',
  2: 'ОТСЕЧКА 60V АКБ',
  3: 'ОШИБКА DRV',
  4: 'ПРЕВЫШЕН ABS ТОК',
  5: 'ПЕРЕГРЕВ MOSFET',
  6: 'ПЕРЕГРЕВ МК',
  7: 'ЗАТВОР DRV HIGH',
  8: 'ЗАТВОР DRV LOW',
  9: 'СБОЙ MCU',
  10: 'СБОЙ ЗАГРУЗКИ',
  11: 'ЭНКОДЕР SPI',
  12: 'ХОЛЛЫ / SIN MIN',
  13: 'ХОЛЛЫ / COS MAX',
  14: 'СБОЙ FLASH',
  15: 'ДИСБАЛАНС ФАЗ',
};

export function faultCodeToRu(code: number): string {
  return VESC_FAULT_CODES_RU[code] ?? `ОШИБКА #${code}`;
}

export function crc16(buf: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

export function encodeVescFrame(payload: Uint8Array): Uint8Array {
  const crc = crc16(payload);
  if (payload.length <= 255) {
    const frame = new Uint8Array(payload.length + 5);
    frame[0] = 0x02;
    frame[1] = payload.length & 0xff;
    frame.set(payload, 2);
    frame[2 + payload.length] = (crc >> 8) & 0xff;
    frame[3 + payload.length] = crc & 0xff;
    frame[4 + payload.length] = 0x03;
    return frame;
  } else {
    const frame = new Uint8Array(payload.length + 6);
    frame[0] = 0x03;
    frame[1] = (payload.length >> 8) & 0xff;
    frame[2] = payload.length & 0xff;
    frame.set(payload, 3);
    frame[3 + payload.length] = (crc >> 8) & 0xff;
    frame[4 + payload.length] = crc & 0xff;
    frame[5 + payload.length] = 0x03;
    return frame;
  }
}

export function wrapForwardCan(canId: number, innerPayload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + innerPayload.length);
  out[0] = CommPacketId.COMM_FORWARD_CAN;
  out[1] = canId & 0xff;
  out.set(innerPayload, 2);
  return out;
}

function writeInt32Cmd(cmd: CommPacketId, scaledValue: number): Uint8Array {
  const buf = new Uint8Array(5);
  const view = new DataView(buf.buffer);
  view.setUint8(0, cmd);
  view.setInt32(1, Math.round(scaledValue), false);
  return buf;
}

export function payloadGetFwVersion(): Uint8Array {
  return new Uint8Array([CommPacketId.COMM_FW_VERSION]);
}

export function payloadGetValues(): Uint8Array {
  return new Uint8Array([CommPacketId.COMM_GET_VALUES]);
}

export function payloadPingCan(): Uint8Array {
  return new Uint8Array([CommPacketId.COMM_PING_CAN]);
}

export function payloadAlive(): Uint8Array {
  return new Uint8Array([CommPacketId.COMM_ALIVE]);
}

export function payloadSetDuty(duty: number): Uint8Array {
  const clamped = Math.max(-0.95, Math.min(0.95, duty));
  return writeInt32Cmd(CommPacketId.COMM_SET_DUTY, clamped * 100000);
}

export function payloadSetCurrent(amps: number): Uint8Array {
  return writeInt32Cmd(CommPacketId.COMM_SET_CURRENT, amps * 1000);
}

export function payloadSetCurrentBrake(amps: number): Uint8Array {
  return writeInt32Cmd(CommPacketId.COMM_SET_CURRENT_BRAKE, Math.abs(amps) * 1000);
}

export function payloadSetRpm(erpm: number): Uint8Array {
  return writeInt32Cmd(CommPacketId.COMM_SET_RPM, erpm);
}

export function payloadSetHandbrake(amps: number): Uint8Array {
  return writeInt32Cmd(CommPacketId.COMM_SET_HANDBRAKE, Math.abs(amps) * 1000);
}


export function parseGetValues(payload: Uint8Array): VescTelemetry | null {
  if (payload.length < 54 || payload[0] !== CommPacketId.COMM_GET_VALUES) {
    return null;
  }
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const tempFet = dv.getInt16(1, false) / 10;
  const tempMotorRaw = dv.getInt16(3, false) / 10;
  const tempMotor = tempMotorRaw < -40 || tempMotorRaw > 220 ? 0 : tempMotorRaw;
  const avgMotorCurrent = dv.getInt32(5, false) / 100;
  const avgInputCurrent = dv.getInt32(9, false) / 100;
  const avgId = dv.getInt32(13, false) / 100;
  const avgIq = dv.getInt32(17, false) / 100;
  const dutyNow = dv.getInt16(21, false) / 1000;
  const erpm = dv.getInt32(23, false);
  const vIn = dv.getInt16(27, false) / 10;
  const ampHours = dv.getInt32(29, false) / 10000;
  const ampHoursCharged = dv.getInt32(33, false) / 10000;
  const wattHours = dv.getInt32(37, false) / 10000;
  const wattHoursCharged = dv.getInt32(41, false) / 10000;
  const tachometer = dv.getInt32(45, false);
  const tachometerAbs = dv.getInt32(49, false);
  const faultCode = dv.getUint8(53);
  const controllerId = payload.length >= 59 ? dv.getUint8(58) : null;

  return {
    tempFet,
    tempMotor,
    avgMotorCurrent,
    avgInputCurrent,
    avgId,
    avgIq,
    dutyNow,
    erpm,
    vIn,
    ampHours,
    ampHoursCharged,
    wattHours,
    wattHoursCharged,
    tachometer,
    tachometerAbs,
    faultCode,
    faultText: faultCodeToRu(faultCode),
    controllerId,
    updatedAt: Date.now(),
  };
}

export function parseFwVersion(payload: Uint8Array): VescFirmwareInfo | null {
  if (payload.length < 4 || payload[0] !== CommPacketId.COMM_FW_VERSION) {
    return null;
  }
  const fwMajor = payload[1];
  const fwMinor = payload[2];
  let end = 3;
  while (end < payload.length && payload[end] !== 0) {
    end++;
  }
  const hwName = new TextDecoder().decode(payload.slice(3, end)) || 'VESC';
  return { fwMajor, fwMinor, hwName };
}

export class VescPacketAssembler {
  private buffer = new Uint8Array(0);
  private lastChunkAt = 0;
  private readonly maxBuffer = 4096;
  private readonly rxTimeoutMs = 150;

  private tryReadFrameAt(buf: Uint8Array, offset: number): {
    status: 'invalid' | 'incomplete' | 'valid';
    payload?: Uint8Array;
    totalFrameLen?: number;
  } {
    const startByte = buf[offset];
    if (startByte !== 0x02 && startByte !== 0x03) {
      return { status: 'invalid' };
    }

    const headerLen = startByte === 0x02 ? 2 : 3;
    if (buf.length - offset < headerLen) {
      return { status: 'incomplete' };
    }

    const payloadLen =
      startByte === 0x02
        ? buf[offset + 1]
        : (buf[offset + 1] << 8) | buf[offset + 2];

    if (payloadLen <= 0 || payloadLen > 515) {
      return { status: 'invalid' };
    }

    const totalFrameLen = headerLen + payloadLen + 3;
    if (buf.length - offset < totalFrameLen) {
      return { status: 'incomplete', totalFrameLen };
    }

    if (buf[offset + totalFrameLen - 1] !== 0x03) {
      return { status: 'invalid' };
    }

    const payloadStart = offset + headerLen;
    const payload = buf.slice(payloadStart, payloadStart + payloadLen);
    const expectedCrc =
      (buf[payloadStart + payloadLen] << 8) |
      buf[payloadStart + payloadLen + 1];

    if (crc16(payload) !== expectedCrc) {
      return { status: 'invalid' };
    }

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
    this.buffer =
      merged.length > this.maxBuffer
        ? merged.slice(merged.length - this.maxBuffer)
        : merged;

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

      let foundInnerValid = false;
      for (let scan = offset + 1; scan < this.buffer.length; scan++) {
        if (this.buffer[scan] === 0x02 || this.buffer[scan] === 0x03) {
          const inner = this.tryReadFrameAt(this.buffer, scan);
          if (inner.status === 'valid') {
            offset = scan;
            foundInnerValid = true;
            break;
          }
        }
      }
      if (!foundInnerValid) {
        break;
      }
    }

    if (offset > 0) {
      this.buffer = this.buffer.slice(offset);
    }

    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.lastChunkAt = 0;
  }
}

export function estimateBatteryState(
  voltage: number,
  fixedCells: number,
  chemistry: 'liion' | 'lifepo4'
): { cells: number; percent: number; cellVoltage: number; fullVoltage: number; cutoffVoltage: number } {
  const minCell = chemistry === 'lifepo4' ? 2.85 : 3.05;
  const maxCell = chemistry === 'lifepo4' ? 3.65 : 4.2;
  const nomCell = chemistry === 'lifepo4' ? 3.25 : 3.75;

  let cells = fixedCells;
  if (cells <= 0 && voltage >= 9) {
    const commonSeries = [10, 12, 13, 14, 16, 18, 20];
    cells = Math.max(4, Math.min(20, Math.round(voltage / nomCell)));
    let bestDiff = Infinity;
    for (const s of commonSeries) {
      if (voltage >= s * (minCell - 0.1) && voltage <= s * (maxCell + 0.05)) {
        const diff = Math.abs(voltage - s * nomCell);
        if (diff < bestDiff) {
          bestDiff = diff;
          cells = s;
        }
      }
    }
  } else if (cells <= 0) {
    cells = 16; // 60V scooter nominal = 16S Li-Ion
  }

  const fullVoltage = Number((cells * maxCell).toFixed(1));
  const cutoffVoltage = Number((cells * minCell).toFixed(1));

  if (voltage < 9) {
    return { cells, percent: 0, cellVoltage: 0, fullVoltage, cutoffVoltage };
  }

  const cellVoltage = voltage / cells;
  const pct = Math.max(
    0,
    Math.min(100, Math.round(((cellVoltage - minCell) / (maxCell - minCell)) * 100))
  );
  return { cells, percent: pct, cellVoltage, fullVoltage, cutoffVoltage };
}

export function erpmToKmh(
  erpm: number,
  polePairs: number,
  gearRatio: number,
  wheelDiameterMm: number
): number {
  if (polePairs <= 0 || gearRatio <= 0 || wheelDiameterMm <= 0) return 0;
  const motorRpm = erpm / polePairs;
  const wheelRpm = motorRpm / gearRatio;
  const circumferenceM = Math.PI * (wheelDiameterMm / 1000);
  return (wheelRpm * circumferenceM * 60) / 1000;
}

export function kmhToErpm(
  kmh: number,
  polePairs: number,
  gearRatio: number,
  wheelDiameterMm: number
): number {
  const circumferenceM = Math.PI * (wheelDiameterMm / 1000);
  if (circumferenceM <= 0) return 100000;
  const wheelRpm = (kmh * 1000) / (60 * circumferenceM);
  return Math.round(wheelRpm * gearRatio * polePairs);
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
