/**
 * Virtual Dualtron Achilleus: two Flipsky 75100 (FW 6.05) on a virtual CAN bus.
 * Speaks the real binary VESC protocol (framed, CRC, 20-byte BLE chunks), so the
 * whole app — polling, MCCONF read/patch/write, ride modes, FW — is exercised in demo mode.
 */
import {
  CommPacketId,
  encodeVescFrame,
  readFloat32Auto,
  VescPacketAssembler,
  cellVoltageToSoc,
} from '../protocol/vescProtocol';
import { MCCONF_LAYOUTS } from '../protocol/mcconfLayouts';
import { decodeMcconf, McconfSnapshot, McconfValues, patchMcconf } from '../protocol/mcconf';
import type { VescTransport, VescTransportCallbacks } from '../protocol/vescTransport';

const LAYOUT = MCCONF_LAYOUTS.find((l) => l.fw === '6.05')!;
const POLE_PAIRS = 15;
const WHEEL_M = 0.28;
const MASS_KG = 128;
const KV_ERPM_PER_V = 400; // ≈ 80 km/h at full duty under load, no FW
const R_PACK = 0.085;
const R_PHASE = 0.055;
// Consistent with Kv: F/I = 60·pp / (Kv·π·D).
const FORCE_PER_AMP = (60 * POLE_PAIRS) / (KV_ERPM_PER_V * Math.PI * WHEEL_M);

interface Ctrl {
  id: number;
  name: string;
  uuid: Uint8Array;
  snapshot: McconfSnapshot;
  conf: McconfValues; // effective RAM config (incl. temporary limits)
  erpm: number;
  iq: number;
  idFw: number;
  iIn: number;
  duty: number;
  tempFet: number;
  tempMotor: number;
  tach: number;
  tachAbs: number;
  ah: number;
  ahCh: number;
  wh: number;
  whCh: number;
  fault: number;
  busyUntil: number;
}

function defaultMcconf(sensorMode: number): McconfSnapshot {
  const bytes = new Uint8Array(LAYOUT.length);
  new DataView(bytes.buffer).setUint32(0, LAYOUT.signature, false);
  const base: McconfSnapshot = { layout: LAYOUT, bytes, readAt: 0 };
  const patched = patchMcconf(base, {
    motor_type: 2,
    foc_sensor_mode: sensorMode,
    l_current_max: 90,
    l_current_min: -60,
    l_in_current_max: 47,
    l_in_current_min: -15,
    l_abs_current_max: 150,
    l_min_erpm: -100000,
    l_max_erpm: 100000,
    l_min_duty: 0.005,
    l_max_duty: 0.95,
    l_watt_max: 1500000,
    l_watt_min: -1500000,
    l_current_max_scale: 1,
    l_current_min_scale: 1,
    l_battery_cut_start: 46,
    l_battery_cut_end: 43,
    l_temp_fet_start: 80,
    l_temp_fet_end: 100,
    l_temp_motor_start: 80,
    l_temp_motor_end: 110,
    foc_fw_current_max: 0,
    foc_fw_duty_start: 0.9,
    foc_fw_ramp_time: 0.2,
    foc_fw_q_current_factor: 0.02,
    cc_min_current: 0.05,
    si_motor_poles: POLE_PAIRS * 2,
    si_gear_ratio: 1,
    si_wheel_diameter: WHEEL_M,
    si_battery_type: 0,
    si_battery_cells: 16,
    si_battery_ah: 35,
  });
  return { layout: LAYOUT, bytes: patched, readAt: 0 };
}

function makeCtrl(id: number, name: string, sensorMode: number): Ctrl {
  const snapshot = defaultMcconf(sensorMode);
  const uuid = new Uint8Array(12);
  for (let i = 0; i < 12; i++) uuid[i] = (0x30 + id * 17 + i * 13) & 0xff;
  return {
    id,
    name,
    uuid,
    snapshot,
    conf: decodeMcconf(snapshot),
    erpm: 0,
    iq: 0,
    idFw: 0,
    iIn: 0,
    duty: 0,
    tempFet: 31 + id * 1.5,
    tempMotor: 33 + id * 2,
    tach: 0,
    tachAbs: 0,
    ah: 0.8,
    ahCh: 0.1,
    wh: 50,
    whCh: 6,
    fault: 0,
    busyUntil: 0,
  };
}

function u8(...values: number[]) {
  return new Uint8Array(values);
}

export interface SimTransport extends VescTransport {
  setDemoRunning(running: boolean): void;
  isDemoRunning(): boolean;
}

export function createSimTransport(callbacks: VescTransportCallbacks): SimTransport {
  const master = makeCtrl(0, 'Перед', 2);
  const slave = makeCtrl(1, 'Зад', 0);
  const ctrls = [master, slave];
  const assembler = new VescPacketAssembler();
  let connected = true;
  let demoRunning = true;
  let demoT = 0;
  let speedMs = 0;
  let socAh = 35 * 0.86; // remaining Ah
  let lastStep = performance.now();

  const deliver = (payload: Uint8Array, delayMs: number) => {
    window.setTimeout(() => {
      if (!connected) return;
      const frame = encodeVescFrame(payload);
      for (let i = 0; i < frame.length; i += 20) {
        for (const p of assembler.push(frame.slice(i, i + 20))) callbacks.onPayload(p);
      }
    }, delayMs);
  };

  const restVoltage = () => {
    const soc = Math.max(0, Math.min(100, (socAh / 35) * 100));
    // Invert the OCV table numerically (good enough for a simulator).
    let lo = 3.0;
    let hi = 4.2;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (cellVoltageToSoc(mid, 'liion') < soc) lo = mid;
      else hi = mid;
    }
    return ((lo + hi) / 2) * 16;
  };

  let packV = restVoltage();

  const throttleProfile = (t: number): { throttle: number; brake: number } => {
    const cycle = t % 46;
    if (cycle < 3) return { throttle: 0, brake: 0.2 };
    if (cycle < 15) return { throttle: 1, brake: 0 };
    if (cycle < 24) return { throttle: 0.62 + Math.sin(cycle * 0.9) * 0.08, brake: 0 };
    if (cycle < 29) return { throttle: 0, brake: 0.85 };
    if (cycle < 31) return { throttle: 0, brake: 0.3 };
    if (cycle < 38) return { throttle: 0.45 + Math.sin(cycle * 1.7) * 0.25, brake: 0 };
    if (cycle < 42) return { throttle: 0, brake: 0.6 };
    return { throttle: 0, brake: 0.2 };
  };

  const step = () => {
    const now = performance.now();
    const dt = Math.min(0.06, (now - lastStep) / 1000);
    lastStep = now;
    if (demoRunning) demoT += dt;
    const { throttle, brake } = demoRunning ? throttleProfile(demoT) : { throttle: 0, brake: speedMs > 0.2 ? 0.5 : 0 };
    const erpmNow = (speedMs / (Math.PI * WHEEL_M)) * 60 * POLE_PAIRS;
    let force = 0;
    let battTotal = 0;

    for (const c of ctrls) {
      const k = c.conf;
      const maxDuty = k.l_max_duty;
      const erpmBase = KV_ERPM_PER_V * packV * maxDuty;
      const duty = Math.min(maxDuty, erpmNow / Math.max(1, KV_ERPM_PER_V * packV));
      // Field weakening per firmware foc_run_fw().
      let fwTarget = 0;
      if (k.foc_fw_current_max >= Math.max(k.cc_min_current, 0.001) && k.foc_fw_duty_start < 0.99 && throttle > 0.05) {
        const startDuty = k.foc_fw_duty_start * maxDuty;
        if (duty > startDuty) {
          fwTarget = Math.min(1, (duty - startDuty) / Math.max(0.001, maxDuty - startDuty)) * k.foc_fw_current_max;
        }
      }
      const rampStep = k.foc_fw_ramp_time > dt ? (dt / k.foc_fw_ramp_time) * k.foc_fw_current_max : Infinity;
      c.idFw += Math.max(-rampStep, Math.min(rampStep, fwTarget - c.idFw));
      const erpmCeil = erpmBase * (1 + 0.0062 * c.idFw);

      const loMax = k.l_current_max * k.l_current_max_scale;
      const loMin = Math.abs(k.l_current_min) * k.l_current_min_scale;
      let iq = 0;
      if (c.fault === 0 && throttle > 0.01) {
        const headroom = Math.max(0, Math.min(1, (erpmCeil - erpmNow) / (0.1 * erpmBase)));
        const erpmLimit = Math.max(0, Math.min(1, (k.l_max_erpm - erpmNow) / Math.max(200, 0.04 * k.l_max_erpm)));
        iq = throttle * loMax * Math.min(headroom, erpmLimit);
      } else if (c.fault === 0 && brake > 0.01 && erpmNow > 60) {
        iq = -brake * loMin * Math.min(1, erpmNow / 2500);
      }
      // Battery current and power limits act on the real input current (incl. copper losses).
      const inputFor = (q: number) =>
        (q * FORCE_PER_AMP * speedMs + 1.5 * R_PHASE * (q * q + c.idFw * c.idFw)) / Math.max(30, packV);
      const iInEst = inputFor(iq);
      const inMax = Math.min(k.l_in_current_max, k.l_watt_max / Math.max(30, packV));
      const inMin = Math.max(k.l_in_current_min, k.l_watt_min / Math.max(30, packV));
      if (iq > 0 && iInEst > inMax) iq *= Math.max(0, inMax / iInEst);
      if (iq < 0 && iInEst < inMin) iq *= Math.max(0, inMin / iInEst);
      c.iq += (iq - c.iq) * Math.min(1, dt * 14);
      c.iIn = Math.abs(c.iq) > 0.3 || c.idFw > 0.3 ? inputFor(c.iq) + 0.08 : 0.05;
      c.duty = duty;
      force += c.iq * FORCE_PER_AMP;
      battTotal += c.iIn;
      const iSq = (c.iq * c.iq + c.idFw * c.idFw) / (90 * 90);
      c.tempFet += (iSq * 2.6 - (c.tempFet - 30) * 0.03) * dt;
      c.tempMotor += (iSq * 2.0 - (c.tempMotor - 31) * 0.012) * dt;
      const dAh = (c.iIn * dt) / 3600;
      if (dAh >= 0) {
        c.ah += dAh;
        c.wh += dAh * packV;
      } else {
        c.ahCh -= dAh;
        c.whCh -= dAh * packV;
      }
    }

    const roll = speedMs > 0.05 ? 0.016 * MASS_KG * 9.81 : 0;
    const aero = 0.5 * 1.2 * 0.62 * speedMs * speedMs;
    speedMs = Math.max(0, speedMs + ((force - roll - aero) / MASS_KG) * dt);
    if (throttle < 0.01 && speedMs < 0.15) speedMs = 0;
    const erpm = (speedMs / (Math.PI * WHEEL_M)) * 60 * POLE_PAIRS;
    for (const c of ctrls) {
      // Rear sensorless controller reads slightly noisier speed.
      c.erpm = erpm * (c.id === 1 ? 1 + Math.sin(now / 370) * 0.004 : 1);
      const steps = (c.erpm / 60) * 6 * dt;
      c.tach += steps;
      c.tachAbs += Math.abs(steps);
    }
    socAh = Math.max(0, socAh - (battTotal * dt) / 3600);
    packV = restVoltage() - battTotal * R_PACK;
  };

  const timer = window.setInterval(step, 20);

  const valuesPayload = (c: Ctrl): Uint8Array => {
    const out = new Uint8Array(79);
    const v = new DataView(out.buffer);
    out[0] = CommPacketId.COMM_GET_VALUES;
    v.setInt16(1, Math.round(c.tempFet * 10), false);
    v.setInt16(3, Math.round(c.tempMotor * 10), false);
    const phase = Math.sign(c.iq) * Math.hypot(c.iq, c.idFw);
    v.setInt32(5, Math.round(phase * 100), false);
    v.setInt32(9, Math.round(c.iIn * 100), false);
    v.setInt32(13, Math.round(-c.idFw * 100), false);
    v.setInt32(17, Math.round(c.iq * 100), false);
    v.setInt16(21, Math.round(c.duty * 1000), false);
    v.setInt32(23, Math.round(c.erpm), false);
    v.setInt16(27, Math.round(packV * 10), false);
    v.setInt32(29, Math.round(c.ah * 10000), false);
    v.setInt32(33, Math.round(c.ahCh * 10000), false);
    v.setInt32(37, Math.round(c.wh * 10000), false);
    v.setInt32(41, Math.round(c.whCh * 10000), false);
    v.setInt32(45, Math.round(c.tach), false);
    v.setInt32(49, Math.round(c.tachAbs), false);
    out[53] = c.fault;
    out[58] = c.id;
    return out;
  };

  const fwPayload = (c: Ctrl): Uint8Array => {
    const name = new TextEncoder().encode('75_100_V2');
    const out = new Uint8Array(3 + name.length + 1 + 12 + 8);
    out[0] = CommPacketId.COMM_FW_VERSION;
    out[1] = 6;
    out[2] = 5;
    out.set(name, 3);
    out.set(c.uuid, 3 + name.length + 1);
    return out;
  };

  const process = (c: Ctrl, payload: Uint8Array, latency: number) => {
    if (performance.now() < c.busyUntil) return; // writing flash: deaf
    const id = payload[0];
    switch (id) {
      case CommPacketId.COMM_FW_VERSION:
        deliver(fwPayload(c), latency);
        break;
      case CommPacketId.COMM_GET_VALUES:
        deliver(valuesPayload(c), latency);
        break;
      case CommPacketId.COMM_PING_CAN:
        if (c === master) deliver(u8(CommPacketId.COMM_PING_CAN, slave.id), latency + 60);
        break;
      case CommPacketId.COMM_FORWARD_CAN: {
        const target = ctrls.find((x) => x.id === payload[1] && x !== c);
        if (target) process(target, payload.slice(2), latency + 8);
        break;
      }
      case CommPacketId.COMM_GET_MCCONF: {
        const out = new Uint8Array(c.snapshot.bytes.length + 1);
        out[0] = CommPacketId.COMM_GET_MCCONF;
        // RAM config = stored bytes with live limits applied.
        out.set(
          patchMcconf(c.snapshot, {
            l_current_max_scale: c.conf.l_current_max_scale,
            l_current_min_scale: c.conf.l_current_min_scale,
            l_min_erpm: c.conf.l_min_erpm,
            l_max_erpm: c.conf.l_max_erpm,
            l_min_duty: c.conf.l_min_duty,
            l_max_duty: c.conf.l_max_duty,
            l_watt_min: c.conf.l_watt_min,
            l_watt_max: c.conf.l_watt_max,
            l_in_current_min: c.conf.l_in_current_min,
            l_in_current_max: c.conf.l_in_current_max,
          }),
          1
        );
        deliver(out, latency + 30);
        break;
      }
      case CommPacketId.COMM_SET_MCCONF: {
        const bytes = payload.slice(1);
        const sig = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, false) : 0;
        if (sig !== LAYOUT.signature || bytes.length !== LAYOUT.length) return;
        c.snapshot = { layout: LAYOUT, bytes, readAt: Date.now() };
        c.conf = decodeMcconf(c.snapshot);
        c.busyUntil = performance.now() + 250;
        deliver(u8(CommPacketId.COMM_SET_MCCONF), latency + 320);
        break;
      }
      case CommPacketId.COMM_SET_MCCONF_TEMP: {
        const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const f = (i: number) => readFloat32Auto(v, 5 + i * 4);
        c.conf = {
          ...c.conf,
          l_current_min_scale: Math.max(0, Math.min(1, f(0))),
          l_current_max_scale: Math.max(0, Math.min(1, f(1))),
          l_min_erpm: f(2),
          l_max_erpm: f(3),
          l_min_duty: f(4),
          l_max_duty: f(5),
          l_watt_min: f(6),
          l_watt_max: f(7),
          ...(payload.length >= 45 ? { l_in_current_min: f(8), l_in_current_max: f(9) } : {}),
        };
        if (payload[3]) deliver(u8(CommPacketId.COMM_SET_MCCONF_TEMP), latency + 10);
        break;
      }
      default:
        break;
    }
  };

  callbacks.onLog?.('Демо: виртуальный Achilleus (2× 75100, FW 6.05) запущен.');

  return {
    deviceName: 'Демо Achilleus',
    kind: 'sim',
    isConnected: () => connected,
    async sendPayload(payload) {
      if (!connected) throw new Error('Демо остановлено');
      process(master, payload, 18 + Math.random() * 14);
    },
    async disconnect() {
      connected = false;
      window.clearInterval(timer);
    },
    setDemoRunning(running) {
      demoRunning = running;
    },
    isDemoRunning: () => demoRunning,
  };
}
