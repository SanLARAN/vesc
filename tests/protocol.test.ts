/**
 * Protocol + ride-mode checks against the virtual VESC pair (src/sim).
 *   npm test
 */
import { readFloat32Auto, writeFloat32Auto, encodeVescFrame, VescPacketAssembler, kmhToErpm, erpmToKmh } from '../src/protocol/vescProtocol';
import { VescBus, VescPort } from '../src/protocol/vescLink';
import { createSimTransport } from '../src/sim/virtualVesc';
import { decodeMcconf, patchMcconf, changedOutside, fwPatch, baselineFromValues, baselinePatch, readFw, fwDiffers } from '../src/protocol/mcconf';
import { MCCONF_LAYOUTS } from '../src/protocol/mcconfLayouts';
import type { McField } from '../src/protocol/mcconfLayouts';
import { DEFAULT_CONFIG } from '../src/state/dashboardConfig';
import { computeLimits } from '../src/state/rideModes';

declare const process: { exit(code: number): never };

Object.assign(globalThis, { window: globalThis });

let fails = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fails++;
  console.log(cond ? 'ok  ' : 'FAIL', msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// float32_auto round trip
const buf = new DataView(new ArrayBuffer(4));
for (const v of [0, 1, -1, 0.5, 123.456, 1500000, -100000, 0.0001, 3.0e38, -2.5e-5, 85.5]) {
  writeFloat32Auto(buf, 0, v);
  const r = readFloat32Auto(buf, 0);
  check(Math.abs(r - v) <= Math.abs(v) * 1e-6 + 1e-12, `float32_auto ${v} -> ${r}`);
}

// A long frame split into 20-byte BLE chunks
const big = new Uint8Array(600).map((_, i) => (i * 7) & 0xff);
const frame = encodeVescFrame(big);
const asm = new VescPacketAssembler();
const got: Uint8Array[] = [];
for (let i = 0; i < frame.length; i += 20) got.push(...asm.push(frame.slice(i, i + 20)));
check(got.length === 1 && got[0].length === 600 && got[0].every((b, i) => b === big[i]), 'assembler: 600-byte frame from 20-byte chunks');
check(Math.abs(erpmToKmh(kmhToErpm(55, 15, 1, 280), 15, 1, 280) - 55) < 0.05, 'km/h <-> ERPM');

// MCCONF layouts: fields must not overlap and must stay inside the struct
const SIZES: Record<string, number> = { f32a: 4, f16: 2, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4 };
for (const l of MCCONF_LAYOUTS) {
  const used = new Map<number, string>();
  let ok = true;
  for (const [name, [off, type]] of Object.entries(l.fields)) {
    for (let i = 0; i < SIZES[type]; i++) {
      if (used.has(off + i) || off + i >= l.length || off + i < 4) ok = false;
      used.set(off + i, name);
    }
  }
  check(ok, `layout FW ${l.fw}: fields disjoint and in range`);
}

// FW symmetry rule
const fwA = { enabled: true, currentA: 20, dutyStart: 0.9, rampTimeS: 0.2 };
check(!fwDiffers(fwA, { ...fwA, currentA: 21 }), 'fwDiffers: 20 A vs 21 A is fine');
check(fwDiffers(fwA, { ...fwA, enabled: false, currentA: 0 }), 'fwDiffers: on vs off');
check(fwDiffers(fwA, { ...fwA, currentA: 30 }), 'fwDiffers: 20 A vs 30 A');

async function main() {
  let port: VescPort | null = null;
  const sim = createSimTransport({ onPayload: (p) => port?.handlePayload(p), onDisconnect: () => {} });
  sim.setDemoRunning(false);
  port = new VescPort(sim, () => {});
  const tele: Record<string, number> = { front: 0, rear: 0 };
  const bus = new VescBus((k) => {
    tele[k]++;
  });
  bus.setRoute('front', { port, canId: null });
  bus.setRoute('rear', { port, canId: 1 });

  const f1 = await bus.getFw('front');
  const f2 = await bus.getFw('rear');
  check(!!f1 && !!f2 && f1.uuid !== f2.uuid, `FW_VERSION from both controllers (${f1?.fwMajor}.${f1?.fwMinor} ${f1?.hwName})`);
  const pings = await bus.pingCan(port);
  check(JSON.stringify(pings) === '[1]', `PING_CAN finds the slave -> ${JSON.stringify(pings)}`);
  const v1 = await bus.getValues('front');
  const v2 = await bus.getValues('rear');
  check(v1?.controllerId === 0 && v2?.controllerId === 1, `GET_VALUES controller ids ${v1?.controllerId}/${v2?.controllerId}`);

  const m = await bus.getMcconf('rear');
  check(m.ok, 'GET_MCCONF rear');
  if (!m.ok) return finish(sim);
  const vals = decodeMcconf(m.snapshot);
  const base = baselineFromValues(vals);

  // Ride modes: never above the VESC's own limits; 1WD releases the idle motor's drive only
  const cfg = { ...DEFAULT_CONFIG, frontTorqueRatioPct: 70 };
  const turbo = cfg.profiles.find((p) => p.id === 'turbo') ?? cfg.profiles[cfg.profiles.length - 1];
  const front2wd = computeLimits('front', base, turbo, { profileId: turbo.id, traction: '2wd', limiter: false }, cfg);
  check(Math.abs(front2wd.currentMaxScale - base.currentMaxScale * (turbo.currentScalePct / 100) * 0.7) < 1e-6, '2WD: front torque share 70%');
  check(front2wd.inCurrentMax <= base.inCurrentMax && front2wd.wattMax <= base.wattMax && front2wd.maxErpm <= base.maxErpm, 'mode never exceeds VESC limits');
  const rear1wd = computeLimits('rear', base, turbo, { profileId: turbo.id, traction: '1wd_front_hall', limiter: false }, cfg);
  check(rear1wd.currentMaxScale === 0 && rear1wd.currentMinScale > 0, '1WD front: rear gives no drive but still brakes');
  const lim = computeLimits('front', base, turbo, { profileId: turbo.id, traction: '2wd', limiter: true }, cfg);
  check(Math.abs(erpmToKmh(lim.maxErpm, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm) - cfg.limiterKmh) < 0.1, `LIM caps ERPM at ${cfg.limiterKmh} km/h`);

  // SET_MCCONF_TEMP is RAM-only and shows up in GET_MCCONF
  const okTemp = await bus.setTempLimits('rear', { ...front2wd, currentMaxScale: 0.35, maxErpm: 20000, minErpm: -20000 });
  check(okTemp, 'SET_MCCONF_TEMP ack');
  const m2 = await bus.getMcconf('rear');
  const vals2 = m2.ok ? decodeMcconf(m2.snapshot) : null;
  check(!!vals2 && Math.abs(vals2.l_current_max_scale - 0.35) < 1e-4 && vals2.l_max_erpm === 20000, 'temporary limits are live in RAM');
  if (!m2.ok || !vals2) return finish(sim);

  // FW write: only FW fields + restored base limits may change
  const patch = { ...baselinePatch(base), ...fwPatch(true, 22.4, 0.83) };
  const bytes = patchMcconf(m2.snapshot, patch);
  check(changedOutside(m2.snapshot.layout, m2.snapshot.bytes, bytes, Object.keys(patch) as McField[]).length === 0, 'FW patch touches only FW + base-limit fields');
  const acked = await bus.setMcconf('rear', bytes);
  check(acked, 'SET_MCCONF ack');
  await sleep(400);
  const m3 = await bus.getMcconf('rear');
  const vals3 = m3.ok ? decodeMcconf(m3.snapshot) : null;
  const fw = vals3 ? readFw(vals3) : null;
  check(!!fw && fw.enabled && Math.abs(fw.currentA - 22.4) < 1e-3 && Math.abs(fw.dutyStart - 0.83) < 1e-4, `FW read back ${fw?.currentA.toFixed(2)} A @ ${fw?.dutyStart.toFixed(2)}`);
  check(!!vals3 && vals3.l_current_max_scale === base.currentMaxScale && vals3.l_max_erpm === base.maxErpm, 'temporary mode limits did not leak into flash');
  const mf = await bus.getMcconf('front');
  check(mf.ok && !readFw(decodeMcconf(mf.snapshot)).enabled, 'front controller untouched');
  if (!m3.ok) return finish(sim);
  await bus.setMcconf('rear', patchMcconf(m3.snapshot, fwPatch(false, 22.4, 0.83)));
  const m4 = await bus.getMcconf('rear');
  check(m4.ok && !readFw(decodeMcconf(m4.snapshot)).enabled && decodeMcconf(m4.snapshot).foc_fw_current_max === 0, 'FW off writes 0 A');

  // Telemetry: both controllers polled, one request in flight
  bus.startPolling();
  await sleep(1000);
  bus.stopPolling();
  check(tele.front > 5 && tele.rear > 5, `polling ${tele.front}/s front, ${tele.rear}/s rear, stats ${JSON.stringify(bus.stats)}`);
  return finish(sim);
}

async function finish(sim: { disconnect: () => Promise<void> }) {
  await sim.disconnect();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
