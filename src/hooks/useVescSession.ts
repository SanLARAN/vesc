import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { CommPacketId, erpmToKmh, VescFirmwareInfo, VescTelemetry } from '../protocol/vescProtocol';
import { ControllerKey, VescBus, VescPort } from '../protocol/vescLink';
import { connectBleVesc, connectUsbSerialVesc, VescTransport, VescTransportCallbacks } from '../protocol/vescTransport';
import { createSimTransport, SimTransport } from '../sim/virtualVesc';
import {
  baselineFromValues,
  baselinePatch,
  changedOutside,
  decodeMcconf,
  fwPatch,
  isMotorFoc,
  LimitBaseline,
  McconfSnapshot,
  McconfValues,
  nearlyEqual,
  patchMcconf,
} from '../protocol/mcconf';
import type { McField } from '../protocol/mcconfLayouts';
import {
  computeLimits,
  driveShare,
  limitsFromBaseline,
  limitsMatch,
  loadModeState,
  RideSelection,
  saveModeState,
} from '../state/rideModes';
import type { ConnectionTopology, OnboardComputerConfig } from '../state/dashboardConfig';

export type LinkPhase = 'idle' | 'connecting' | 'syncing' | 'online' | 'lost';

export interface ControllerState {
  present: boolean;
  canId: number | null;
  fw: VescFirmwareInfo | null;
  snapshot: McconfSnapshot | null;
  values: McconfValues | null;
  baseline: LimitBaseline | null;
  issue: string | null;
}

export type ModeState = 'idle' | 'applying' | 'applied' | 'partial' | 'error' | 'offline' | 'readonly';

export interface ModeStatus {
  state: ModeState;
  message: string | null;
  selection: RideSelection | null;
  at: number;
}

export interface LogEntry {
  id: number;
  at: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface FwWriteRequest {
  targets: ControllerKey[];
  enabled: boolean;
  currentA: number;
  dutyStart: number;
}

export interface FwWriteResult {
  ok: boolean;
  message: string;
}

export const CONTROLLER_NAMES: Record<ControllerKey, string> = { front: 'Передний', rear: 'Задний' };
const KEYS: ControllerKey[] = ['front', 'rear'];

const emptyController = (): ControllerState => ({
  present: false,
  canId: null,
  fw: null,
  snapshot: null,
  values: null,
  baseline: null,
  issue: null,
});

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export const formatFw = (fw: VescFirmwareInfo | null) =>
  fw ? `${fw.fwMajor}.${String(fw.fwMinor).padStart(2, '0')}${fw.testVersion ? ` beta ${fw.testVersion}` : ''}` : '—';

/**
 * GET_MCCONF returns the RAM config, which includes our temporary ride-mode limits.
 * If RAM matches what we applied last time, the real base config is the stored one.
 */
function resolveBaseline(uuid: string | undefined, values: McconfValues): LimitBaseline {
  const ram = baselineFromValues(values);
  if (!uuid) return ram;
  const stored = loadModeState(uuid);
  if (stored?.applied && limitsMatch(limitsFromBaseline(ram), stored.applied)) {
    return { ...stored.baseline, motorCurrentMax: ram.motorCurrentMax, brakeCurrentMax: ram.brakeCurrentMax };
  }
  saveModeState(uuid, { baseline: ram, applied: null, selection: null });
  return ram;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isUserCancel(e: unknown): boolean {
  const name = e instanceof Error ? e.name : '';
  return name === 'NotFoundError' || name === 'AbortError' || /cancel/i.test(errorText(e));
}

export function useVescSession(
  cfgRef: MutableRefObject<OnboardComputerConfig>,
  onTelemetry: (key: ControllerKey, t: VescTelemetry) => void,
  onLinkReset: () => void
) {
  const [phase, setPhaseState] = useState<LinkPhase>('idle');
  const [topology, setTopology] = useState<ConnectionTopology | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [controllers, setControllersState] = useState<Record<ControllerKey, ControllerState>>({
    front: emptyController(),
    rear: emptyController(),
  });
  const [canIds, setCanIds] = useState<number[] | null>(null);
  const [modeStatus, setModeStatus] = useState<ModeStatus>({ state: 'idle', message: null, selection: null, at: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [demoRunning, setDemoRunningState] = useState(true);
  const [needsSecond, setNeedsSecond] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const busRef = useRef<VescBus | null>(null);
  const portsRef = useRef<VescPort[]>([]);
  const simRef = useRef<SimTransport | null>(null);
  const genRef = useRef(0);
  const phaseRef = useRef<LinkPhase>('idle');
  const ctrlRef = useRef(controllers);
  const selectionRef = useRef<RideSelection | null>(null);
  const modeSeqRef = useRef(0);
  const demoRef = useRef(true);
  const lastTRef = useRef<Record<ControllerKey, { t: VescTelemetry; at: number } | null>>({ front: null, rear: null });
  const onTelemetryRef = useRef(onTelemetry);
  onTelemetryRef.current = onTelemetry;
  const onLinkResetRef = useRef(onLinkReset);
  onLinkResetRef.current = onLinkReset;
  const logSeq = useRef(0);

  const setPhase = (p: LinkPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const setControllers = (next: Record<ControllerKey, ControllerState>) => {
    ctrlRef.current = next;
    setControllersState(next);
  };
  const patchController = (key: ControllerKey, patch: Partial<ControllerState>) =>
    setControllers({ ...ctrlRef.current, [key]: { ...ctrlRef.current[key], ...patch } });

  const log = useCallback((level: LogEntry['level'], text: string) => {
    setLogs((prev) => [...prev.slice(-149), { id: ++logSeq.current, at: Date.now(), level, text }]);
  }, []);

  const teardown = useCallback(async () => {
    genRef.current++;
    busRef.current?.stopPolling();
    busRef.current = null;
    const ports = portsRef.current;
    portsRef.current = [];
    simRef.current = null;
    lastTRef.current = { front: null, rear: null };
    for (const p of ports) {
      p.close();
      await p.transport.disconnect().catch(() => undefined);
    }
    onLinkResetRef.current();
  }, []);

  useEffect(
    () => () => {
      void teardown();
    },
    [teardown]
  );

  /* ───────── Ride modes (SET_MCCONF_TEMP, RAM only, safe while riding) ───────── */

  const applyRideMode = useCallback(
    async (sel: RideSelection): Promise<boolean> => {
      selectionRef.current = sel;
      const seq = ++modeSeqRef.current;
      const bus = busRef.current;
      const now = Date.now();
      if (!bus || phaseRef.current !== 'online') {
        setModeStatus({ state: 'offline', message: 'Применится автоматически при подключении', selection: sel, at: now });
        return false;
      }
      const cfg = cfgRef.current;
      const profile = sel.profileId ? (cfg.profiles.find((p) => p.id === sel.profileId) ?? null) : null;
      const ready = KEYS.filter((k) => bus.has(k) && ctrlRef.current[k].baseline);
      if (ready.length === 0) {
        setModeStatus({ state: 'readonly', message: 'Конфигурация не прочитана — режимы недоступны', selection: sel, at: now });
        return false;
      }
      // Never leave the scooter without a driven wheel.
      if (!ready.some((k) => driveShare(sel.traction, k, cfg.frontTorqueRatioPct) > 0)) {
        setModeStatus({
          state: 'error',
          message: 'Ведущий контроллер для этого режима не на связи — режим не применён',
          selection: sel,
          at: now,
        });
        return false;
      }
      setModeStatus({ state: 'applying', message: null, selection: sel, at: now });
      const failed: ControllerKey[] = [];
      for (const key of ready) {
        const c = ctrlRef.current[key];
        if (!c.baseline) continue;
        const limits = computeLimits(key, c.baseline, profile, sel, cfg);
        const ok = await bus.setTempLimits(key, limits);
        if (ok && c.fw?.uuid) saveModeState(c.fw.uuid, { baseline: c.baseline, applied: limits, selection: sel });
        if (!ok) failed.push(key);
      }
      if (seq !== modeSeqRef.current) return failed.length === 0;
      if (failed.length) {
        const msg = `Не подтвердил: ${failed.map((k) => CONTROLLER_NAMES[k]).join(', ')}`;
        setModeStatus({ state: 'error', message: msg, selection: sel, at: Date.now() });
        log('error', `Режим: ${msg}`);
        return false;
      }
      const missing = KEYS.filter((k) => !ready.includes(k) && ctrlRef.current[k].issue);
      if (missing.length) {
        setModeStatus({
          state: 'partial',
          message: `${missing.map((k) => CONTROLLER_NAMES[k]).join(', ')}: нет связи, лимиты не изменены`,
          selection: sel,
          at: Date.now(),
        });
      } else {
        setModeStatus({ state: 'applied', message: null, selection: sel, at: Date.now() });
      }
      return true;
    },
    [cfgRef, log]
  );

  /* ───────── Connection ───────── */

  const dropPort = useCallback(
    (port: VescPort, label: string) => {
      const bus = busRef.current;
      if (!bus) return;
      for (const key of KEYS) {
        if (bus.route(key)?.port === port) {
          bus.setRoute(key, null);
          patchController(key, { present: false, issue: 'Связь потеряна' });
        }
      }
      portsRef.current = portsRef.current.filter((p) => p !== port);
      port.close();
      log('error', `Связь потеряна: ${label}`);
      if (!bus.has('front') && !bus.has('rear')) {
        bus.stopPolling();
        setPhase('lost');
        setError(`Связь потеряна: ${label}`);
        setModeStatus((s) => ({ ...s, state: 'offline', message: 'Лимиты режима действуют в контроллере до его выключения' }));
      }
    },
    [log]
  );

  const openPort = async (
    gen: number,
    label: string,
    factory: (cb: VescTransportCallbacks) => Promise<VescTransport> | VescTransport
  ): Promise<VescPort> => {
    let port: VescPort | null = null;
    const transport = await factory({
      onPayload: (p) => port?.handlePayload(p),
      onDisconnect: () => {
        if (genRef.current === gen && port) dropPort(port, label);
      },
    });
    if (genRef.current !== gen) {
      await transport.disconnect().catch(() => undefined);
      throw new Error('cancelled');
    }
    const decoder = new TextDecoder();
    port = new VescPort(transport, (p) => {
      if (p[0] === CommPacketId.COMM_PRINT) log('info', `${label}: ${decoder.decode(p.slice(1)).trim()}`);
    });
    portsRef.current.push(port);
    setDevices(portsRef.current.map((x) => x.transport.deviceName));
    return port;
  };

  const readConfig = async (key: ControllerKey, gen: number) => {
    const bus = busRef.current;
    if (!bus) return;
    const res = await bus.getMcconf(key);
    if (genRef.current !== gen) return;
    if (!res.ok) {
      patchController(key, { snapshot: null, values: null, baseline: null, issue: res.reason });
      log('warn', `${CONTROLLER_NAMES[key]}: ${res.reason}`);
      return;
    }
    const values = decodeMcconf(res.snapshot);
    const baseline = resolveBaseline(ctrlRef.current[key].fw?.uuid, values);
    patchController(key, { snapshot: res.snapshot, values, baseline, issue: null });
  };

  const syncKey = async (key: ControllerKey, gen: number) => {
    const bus = busRef.current;
    if (!bus) return;
    const route = bus.route(key);
    if (!route) {
      patchController(key, emptyController());
      return;
    }
    let fw = await bus.getFw(key);
    if (!fw && route.canId !== null && genRef.current === gen) {
      // Wrong CAN id? Ask the master who is on the bus.
      const ids = await bus.pingCan(route.port);
      if (genRef.current !== gen) return;
      setCanIds(ids);
      const others = (ids ?? []).filter((id) => id !== route.canId);
      if (ids && !ids.includes(route.canId) && others.length === 1) {
        bus.setRoute(key, { port: route.port, canId: others[0] });
        log('warn', `${CONTROLLER_NAMES[key]}: на CAN найден ID ${others[0]} вместо ${route.canId} — использую его`);
        fw = await bus.getFw(key);
      }
    }
    if (genRef.current !== gen) return;
    if (!fw) {
      bus.setRoute(key, null);
      const issue = route.canId !== null ? `Не отвечает по CAN (ID ${route.canId})` : 'Не отвечает';
      patchController(key, { ...emptyController(), issue });
      log('warn', `${CONTROLLER_NAMES[key]}: ${issue}`);
      return;
    }
    patchController(key, { present: true, canId: bus.route(key)?.canId ?? null, fw, issue: null });
    log('info', `${CONTROLLER_NAMES[key]}: ${fw.hwName || 'VESC'} · FW ${formatFw(fw)}`);
    await readConfig(key, gen);
  };

  const connect = useCallback(
    async (topo: ConnectionTopology) => {
      await teardown();
      const gen = genRef.current;
      const cfg = cfgRef.current;
      setTopology(topo);
      setError(null);
      setCanIds(null);
      setNeedsSecond(false);
      setDevices([]);
      setControllers({ front: emptyController(), rear: emptyController() });
      setPhase('connecting');
      const bus = new VescBus((key, t) => {
        if (genRef.current !== gen) return;
        lastTRef.current[key] = { t, at: Date.now() };
        onTelemetryRef.current(key, t);
      });
      busRef.current = bus;
      try {
        if (topo === 'sim') {
          const port = await openPort(gen, 'Демо', (cb) => {
            const sim = createSimTransport(cb);
            sim.setDemoRunning(demoRef.current);
            simRef.current = sim;
            return sim;
          });
          bus.setRoute('front', { port, canId: null });
          bus.setRoute('rear', { port, canId: 1 });
        } else if (topo === 'dual-ble') {
          const port = await openPort(gen, 'BLE перед', (cb) => connectBleVesc(cb));
          bus.setRoute('front', { port, canId: null });
        } else {
          const label = topo === 'usb' ? 'USB' : 'BLE';
          const port = await openPort(gen, label, (cb) => (topo === 'usb' ? connectUsbSerialVesc(cb) : connectBleVesc(cb)));
          const masterKey: ControllerKey = cfg.masterIsFrontHall ? 'front' : 'rear';
          const slaveKey: ControllerKey = masterKey === 'front' ? 'rear' : 'front';
          bus.setRoute(masterKey, { port, canId: null });
          bus.setRoute(slaveKey, { port, canId: cfg.canSlaveId });
        }
        log('info', `Подключено: ${portsRef.current.map((p) => p.transport.deviceName).join(', ')}`);
        setPhase('syncing');
        await bus.exclusive(async () => {
          for (const key of KEYS) await syncKey(key, gen);
        });
        if (genRef.current !== gen) return;
        if (!bus.has('front') && !bus.has('rear')) {
          throw new Error('Контроллеры не отвечают. Проверьте питание VESC и выбранный тип связи.');
        }
        bus.startPolling();
        setPhase('online');
        if (topo === 'dual-ble') setNeedsSecond(true);
        if (selectionRef.current) void applyRideMode(selectionRef.current);
      } catch (e) {
        if (genRef.current !== gen) return;
        await teardown();
        setPhase('idle');
        setTopology(null);
        if (!isUserCancel(e)) {
          setError(errorText(e));
          log('error', errorText(e));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teardown, applyRideMode, log]
  );

  /** Dual-BLE: pair the second (rear) controller — needs its own tap for the browser chooser. */
  const connectSecond = useCallback(async () => {
    const bus = busRef.current;
    const gen = genRef.current;
    if (!bus) return;
    try {
      const port = await openPort(gen, 'BLE зад', (cb) => connectBleVesc(cb));
      bus.setRoute('rear', { port, canId: null });
      setNeedsSecond(false);
      await bus.exclusive(() => syncKey('rear', gen));
      if (phaseRef.current === 'lost') {
        bus.startPolling();
        setPhase('online');
      }
      if (selectionRef.current) void applyRideMode(selectionRef.current);
    } catch (e) {
      if (!isUserCancel(e)) {
        setError(errorText(e));
        log('error', errorText(e));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRideMode, log]);

  const disconnect = useCallback(async () => {
    await teardown();
    setPhase('idle');
    setTopology(null);
    setDevices([]);
    setNeedsSecond(false);
    setControllers({ front: emptyController(), rear: emptyController() });
    setModeStatus((s) => ({ ...s, state: 'offline', message: null }));
    log('info', 'Отключено');
  }, [teardown, log]);

  const refreshConfig = useCallback(async () => {
    const bus = busRef.current;
    const gen = genRef.current;
    if (!bus) return;
    setBusy('Чтение конфигурации…');
    try {
      await bus.exclusive(async () => {
        for (const key of KEYS) if (bus.has(key)) await readConfig(key, gen);
      });
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── Standstill guard ───────── */

  const isStandstill = useCallback((): boolean => {
    const bus = busRef.current;
    if (!bus) return false;
    const cfg = cfgRef.current;
    const now = Date.now();
    for (const key of KEYS) {
      if (!bus.has(key)) continue;
      const l = lastTRef.current[key];
      if (!l || now - l.at > 2500) return false;
      const kmh = Math.abs(erpmToKmh(l.t.erpm, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm));
      if (kmh > 1 || Math.abs(l.t.avgMotorCurrent) > 3) return false;
    }
    return true;
  }, [cfgRef]);

  /* ───────── Field weakening (flash write, standstill only) ───────── */

  const writeFw = useCallback(
    async (req: FwWriteRequest, onProgress: (text: string) => void): Promise<FwWriteResult> => {
      const bus = busRef.current;
      const gen = genRef.current;
      if (!bus || phaseRef.current !== 'online') return { ok: false, message: 'Нет связи с контроллером' };
      if (!isStandstill()) return { ok: false, message: 'Остановитесь: запись во flash возможна только на месте' };
      const cfg = cfgRef.current;
      setBusy('Запись FW…');
      try {
        return await bus.exclusive(async (): Promise<FwWriteResult> => {
          const done: string[] = [];
          const fail = (text: string): FwWriteResult => {
            log('error', `FW: ${text}`);
            return { ok: false, message: done.length ? `${done.join(' · ')}. Ошибка: ${text}` : text };
          };
          for (const key of req.targets) {
            const name = CONTROLLER_NAMES[key];
            if (genRef.current !== gen) return fail('связь была переподключена');
            if (!bus.has(key)) return fail(`${name}: нет связи`);

            // Re-check that NO wheel is turning right before touching flash.
            onProgress(`${name}: проверка, что самокат стоит…`);
            for (const k of KEYS) {
              if (!bus.has(k)) continue;
              const t = await bus.getValues(k);
              if (!t) return fail(`${CONTROLLER_NAMES[k]}: не отвечает`);
              const kmh = Math.abs(erpmToKmh(t.erpm, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm));
              if (kmh > 1 || Math.abs(t.avgMotorCurrent) > 3) return fail('колесо вращается — остановитесь и повторите');
            }

            onProgress(`${name}: чтение конфигурации…`);
            const res = await bus.getMcconf(key);
            if (!res.ok) return fail(`${name}: ${res.reason}`);
            const values = decodeMcconf(res.snapshot);
            if (!isMotorFoc(values)) return fail(`${name}: мотор не в режиме FOC — ослабление поля работает только в FOC`);

            const baseline = ctrlRef.current[key].baseline ?? resolveBaseline(ctrlRef.current[key].fw?.uuid, values);
            const patch = { ...baselinePatch(baseline), ...fwPatch(req.enabled, req.currentA, req.dutyStart) };
            const bytes = patchMcconf(res.snapshot, patch);
            const outside = changedOutside(res.snapshot.layout, res.snapshot.bytes, bytes, Object.keys(patch) as McField[]);
            if (outside.length) return fail('внутренняя проверка не пройдена (изменились лишние байты) — запись отменена');

            onProgress(`${name}: запись во flash…`);
            const acked = await bus.setMcconf(key, bytes);
            if (!acked) return fail(`${name}: контроллер не подтвердил запись`);
            await sleep(400);

            onProgress(`${name}: проверка записи…`);
            const back = await bus.getMcconf(key);
            if (!back.ok) return fail(`${name}: не удалось перечитать конфигурацию`);
            const v2 = decodeMcconf(back.snapshot);
            const wantA = patch.foc_fw_current_max ?? 0;
            const wantDuty = patch.foc_fw_duty_start ?? v2.foc_fw_duty_start;
            if (!nearlyEqual(v2.foc_fw_current_max, wantA, 0.01) || Math.abs(v2.foc_fw_duty_start - wantDuty) > 0.002) {
              patchController(key, { snapshot: back.snapshot, values: v2 });
              return fail(
                `${name}: контроллер сохранил ${v2.foc_fw_current_max.toFixed(1)} А / ${(v2.foc_fw_duty_start * 100).toFixed(0)}% — проверьте ограничения прошивки`
              );
            }
            patchController(key, { snapshot: back.snapshot, values: v2, baseline });
            done.push(`${name}: ${wantA > 0 ? `FW ${wantA.toFixed(1)} А с ${(wantDuty * 100).toFixed(0)}% duty` : 'FW выкл'}`);
            log('info', `FW записано — ${done[done.length - 1]}`);
          }
          return { ok: true, message: `Записано и проверено — ${done.join(' · ')}` };
        });
      } finally {
        setBusy(null);
        // SET_MCCONF restored the base limits in RAM — put the active ride mode back.
        if (selectionRef.current && genRef.current === gen) void applyRideMode(selectionRef.current);
      }
    },
    [cfgRef, isStandstill, applyRideMode, log]
  );

  /* ───────── Misc ───────── */

  const setDemoRunning = useCallback((running: boolean) => {
    demoRef.current = running;
    simRef.current?.setDemoRunning(running);
    setDemoRunningState(running);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return {
    phase,
    topology,
    devices,
    error,
    controllers,
    canIds,
    modeStatus,
    logs,
    demoRunning,
    needsSecond,
    busy,
    connect,
    connectSecond,
    disconnect,
    refreshConfig,
    applyRideMode,
    writeFw,
    isStandstill,
    setDemoRunning,
    clearLogs,
    log,
  };
}

export type VescSession = ReturnType<typeof useVescSession>;
