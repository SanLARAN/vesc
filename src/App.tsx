import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bluetooth, Gauge, Lock, LockOpen, Maximize2, Route, Settings, Sparkles, TriangleAlert, Zap } from 'lucide-react';
import { useVescSession } from './hooks/useVescSession';
import { CONTROLLER_NAMES } from './hooks/useVescSession';
import { useGeolocation } from './hooks/useGeolocation';
import { useRouteRecorder } from './hooks/useRouteRecorder';
import { useWakeLock } from './hooks/useWakeLock';
import type { ControllerKey } from './protocol/vescLink';
import { fwDiffers, readFw } from './protocol/mcconf';
import { RideEngine, RideSnapshot } from './state/rideEngine';
import {
  accentForProfile,
  BASE_PROFILE_ID,
  ConnectionTopology,
  DEFAULT_CONFIG,
  loadSavedConfig,
  OnboardComputerConfig,
  sanitizeConfig,
  saveConfig,
  TractionDriveMode,
} from './state/dashboardConfig';
import { effectiveSpeedCap, selectionFromConfig } from './state/rideModes';
import { Speedometer } from './components/Speedometer';
import { TopBar } from './components/TopBar';
import { ModeBar } from './components/ModeBar';
import { WidgetStack } from './components/Widgets';
import { TripsView } from './components/TripsView';
import { TuneView } from './components/TuneView';
import { SettingsView } from './components/SettingsView';
import { DashAlert, HudView } from './components/HudView';
import { fmt, Sheet, Stat } from './components/ui';

type Tab = 'dash' | 'trips' | 'tune' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof Gauge }[] = [
  { id: 'dash', label: 'Приборка', icon: Gauge },
  { id: 'trips', label: 'Поездки', icon: Route },
  { id: 'tune', label: 'Тюнинг', icon: Zap },
  { id: 'settings', label: 'Настройки', icon: Settings },
];

const TRACTION_LABEL: Record<TractionDriveMode, string> = { '2wd': '2WD', '1wd_front_hall': 'ПЕРЕД', '1wd_rear_sl': 'ЗАД' };

function Splash({ onDone }: { onDone: () => void }) {
  // The app re-renders every 100 ms, so the timer must not depend on the (new) callback identity.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const id = window.setTimeout(() => doneRef.current(), 1200);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <button
      type="button"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black text-white"
      onClick={onDone}
      aria-label="Пропустить заставку"
    >
      <img src={`${import.meta.env.BASE_URL}startup-easter-egg.webp`} alt="" className="splash-img pointer-events-none max-h-[68svh] max-w-[86vw] object-contain" />
      <div className="mt-4 text-[11px] font-semibold tracking-[0.32em] text-white/70">ACHILLEUS · READY</div>
    </button>
  );
}

function HoldToUnlock({ onUnlock }: { onUnlock: () => void }) {
  const timer = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  const start = () => {
    setHolding(true);
    timer.current = window.setTimeout(onUnlock, 900);
  };
  const cancel = () => {
    setHolding(false);
    if (timer.current) window.clearTimeout(timer.current);
  };
  return (
    <div className="fixed inset-0 z-30" onContextMenu={(e) => e.preventDefault()}>
      <div className="absolute inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] flex justify-center">
        <button
          type="button"
          className="btn btn-primary select-none px-6 shadow-2xl"
          onPointerDown={start}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          style={{ transform: holding ? 'scale(0.96)' : undefined }}
        >
          <LockOpen size={16} /> {holding ? 'Держите…' : 'Удерживайте, чтобы разблокировать'}
        </button>
      </div>
    </div>
  );
}

function useAlerts(snap: RideSnapshot, cfg: OnboardComputerConfig, session: ReturnType<typeof useVescSession>): DashAlert[] {
  return useMemo(() => {
    const out: DashAlert[] = [];
    for (const f of snap.faults) out.push({ id: `fault-${f.key}-${f.code}`, level: 'bad', text: `${CONTROLLER_NAMES[f.key]}: ${f.text}` });
    if (session.phase === 'online') {
      for (const key of ['front', 'rear'] as ControllerKey[]) {
        const c = session.controllers[key];
        const m = snap[key];
        if (c.present && !m.online) out.push({ id: `stale-${key}`, level: 'warn', text: `${CONTROLLER_NAMES[key]}: нет телеметрии` });
        if (!m.online || !m.t) continue;
        const v = c.values;
        if (v && m.t.tempFet >= v.l_temp_fet_start) out.push({ id: `fet-hot-${key}`, level: 'bad', text: `${CONTROLLER_NAMES[key]} VESC ${m.t.tempFet.toFixed(0)}° — ток урезается` });
        else if (m.t.tempFet >= cfg.fetWarnTempC) out.push({ id: `fet-${key}`, level: 'warn', text: `${CONTROLLER_NAMES[key]} VESC ${m.t.tempFet.toFixed(0)}°` });
        if (v && m.t.tempMotor >= v.l_temp_motor_start && v.l_temp_motor_start > 0)
          out.push({ id: `mot-hot-${key}`, level: 'bad', text: `${CONTROLLER_NAMES[key]} мотор ${m.t.tempMotor.toFixed(0)}° — ток урезается` });
        else if (m.t.tempMotor >= cfg.motorWarnTempC) out.push({ id: `mot-${key}`, level: 'warn', text: `${CONTROLLER_NAMES[key]} мотор ${m.t.tempMotor.toFixed(0)}°` });
        if (m.battA > cfg.perEscBatteryAmps * 1.05) out.push({ id: `bms-${key}`, level: 'warn', text: `${CONTROLLER_NAMES[key]}: ток АКБ ${m.battA.toFixed(0)} А выше этапа BMS ${cfg.perEscBatteryAmps} А` });
      }
      if (snap.vIn > 5) {
        if (snap.vIn <= cfg.cutoffStartV) out.push({ id: 'cutoff', level: 'bad', text: `АКБ ${snap.vIn.toFixed(1)} В — отсечка, мощность урезана` });
        else if (snap.vIn <= cfg.cutoffStartV + 2) out.push({ id: 'low', level: 'warn', text: `АКБ почти разряжена: ${snap.vIn.toFixed(1)} В` });
      }
      if (session.modeStatus.state === 'error') out.push({ id: 'mode', level: 'warn', text: `Режим: ${session.modeStatus.message ?? 'ошибка'}` });
      // FW safety: a released motor (1WD) or one with less FW brakes through its diodes above base speed.
      const fv = (['front', 'rear'] as ControllerKey[]).map((k) => {
        const v = session.controllers[k].present ? session.controllers[k].values : null;
        return v ? readFw(v) : null;
      });
      if (fv[0] && fv[1] && (fv[0].enabled || fv[1].enabled)) {
        if (fwDiffers(fv[0], fv[1])) out.push({ id: 'fw-asym', level: 'warn', text: 'FW на моторах разный — выше родной максималки один мотор будет тормозить' });
        if (cfg.tractionMode !== '2wd') out.push({ id: 'fw-1wd', level: 'warn', text: '1WD + FW: свободное колесо тормозит выше родной максималки' });
      }
    }
    return out;
  }, [snap, cfg, session.phase, session.controllers, session.modeStatus]);
}

export function App() {
  const [cfg, setCfg] = useState<OnboardComputerConfig>(loadSavedConfig);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const [tab, setTab] = useState<Tab>('dash');
  const [hud, setHud] = useState(false);
  const [locked, setLocked] = useState(false);
  const [splash, setSplash] = useState(() => cfg.showSplash);
  const [connectSheet, setConnectSheet] = useState(false);

  const updateConfig = useCallback((patch: Partial<OnboardComputerConfig>) => {
    setCfg((prev) => sanitizeConfig({ ...prev, ...patch } as OnboardComputerConfig & Record<string, unknown>));
  }, []);
  const resetConfig = useCallback(() => setCfg({ ...DEFAULT_CONFIG }), []);
  useEffect(() => saveConfig(cfg), [cfg]);

  /* ───────── Telemetry pipeline ───────── */
  const engineRef = useRef<RideEngine | null>(null);
  if (!engineRef.current) engineRef.current = new RideEngine();
  const engine = engineRef.current;

  const session = useVescSession(
    cfgRef,
    useCallback((key, t) => engine.ingest(key, t, cfgRef.current), [engine]),
    useCallback(() => engine.resetLink(), [engine])
  );

  const [recordingFlag, setRecordingFlag] = useState(false);
  const geo = useGeolocation(cfg.speedSource === 'gps' || recordingFlag || tab === 'trips' || hud);
  const gpsRef = useRef(geo.fix);
  gpsRef.current = geo.fix;

  const [snap, setSnap] = useState<RideSnapshot>(() => engine.snapshot(Date.now(), cfg, null));
  useEffect(() => {
    const id = window.setInterval(() => {
      const f = gpsRef.current;
      setSnap(engine.snapshot(Date.now(), cfgRef.current, f ? { speedKmh: f.speedKmh, accuracy: f.accuracy, at: f.at } : null));
    }, 100);
    const persist = () => engine.trip.persist();
    const onVis = () => document.visibilityState === 'hidden' && persist();
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [engine]);

  const recorder = useRouteRecorder(geo.fix, { speedKmh: snap.speedKmh, powerKw: snap.powerW / 1000 });
  useEffect(() => setRecordingFlag(recorder.recording), [recorder.recording]);

  useWakeLock(cfg.keepScreenAwake && (session.phase === 'online' || recorder.recording || hud));

  /* ───────── Theme & accent ───────── */
  const profile = cfg.activeProfileId === BASE_PROFILE_ID ? null : (cfg.profiles.find((p) => p.id === cfg.activeProfileId) ?? null);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = cfg.theme;
    root.style.setProperty('--accent-rgb', accentForProfile(profile?.id ?? null));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cfg.theme === 'dark' ? '#040506' : '#eef0f3');
  }, [cfg.theme, profile?.id]);

  /* ───────── Ride mode → VESC (debounced, RAM only) ───────── */
  const modeKey = JSON.stringify([
    cfg.activeProfileId,
    cfg.tractionMode,
    cfg.limiterOn,
    cfg.limiterKmh,
    cfg.frontTorqueRatioPct,
    profile,
    cfg.polePairs,
    cfg.gearRatio,
    cfg.wheelDiameterMm,
  ]);
  const { applyRideMode } = session;
  useEffect(() => {
    const id = window.setTimeout(() => void applyRideMode(selectionFromConfig(cfgRef.current)), 250);
    return () => window.clearTimeout(id);
  }, [modeKey, applyRideMode]);

  /* ───────── Alerts (+ vibration on new critical ones) ───────── */
  const alerts = useAlerts(snap, cfg, session);
  const seenBad = useRef(new Set<string>());
  useEffect(() => {
    const bad = alerts.filter((a) => a.level === 'bad').map((a) => a.id);
    if (bad.some((id) => !seenBad.current.has(id))) navigator.vibrate?.([180, 90, 180]);
    seenBad.current = new Set(bad);
  }, [alerts]);

  const capKmh = effectiveSpeedCap(profile, cfg.limiterOn, cfg);
  const modeLabel = `${profile?.code ?? 'BASE'} · ${TRACTION_LABEL[cfg.tractionMode]}`;
  const powerScaleW = profile?.maxWatts ?? Math.max(2000, cfg.perEscBatteryAmps * 2 * (snap.vIn > 5 ? snap.vIn : 60));
  const idle = session.phase === 'idle' || session.phase === 'lost';

  const connectNow = (topo: ConnectionTopology) => {
    setConnectSheet(false);
    updateConfig({ lastTopology: topo });
    void session.connect(topo);
  };

  const resetTrip = useCallback(() => engine.trip.resetTrip(), [engine]);
  const resetDrag = useCallback(() => engine.trip.resetDrag(), [engine]);

  if (hud) {
    return (
      <HudView
        snap={snap}
        cfg={cfg}
        capKmh={capKmh}
        modeLabel={modeLabel}
        powerScaleW={powerScaleW}
        alerts={alerts}
        recorder={recorder}
        fix={geo.fix}
        onExit={() => setHud(false)}
      />
    );
  }

  return (
    <div className="app-bg min-h-[100svh] text-[var(--fg)]">
      {splash && <Splash onDone={() => setSplash(false)} />}

      <div className="mx-auto max-w-[1100px] pb-[calc(84px+env(safe-area-inset-bottom))]">
        <TopBar
          phase={session.phase}
          topology={session.topology}
          frontOnline={snap.front.online}
          rearOnline={snap.rear.online}
          frontPresent={session.controllers.front.present}
          rearPresent={session.controllers.rear.present}
          socPct={snap.battery.socPct}
          gpsAccuracy={geo.fix ? geo.fix.accuracy : null}
          gpsActive={cfg.speedSource === 'gps' || recorder.recording || tab === 'trips'}
          onConnectClick={() => (idle ? setConnectSheet(true) : setTab('settings'))}
        />

        <main className="px-3">
          {tab === 'dash' && (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
              <div className="flex flex-col gap-3 md:[@media(min-height:720px)]:sticky md:[@media(min-height:720px)]:top-3">
                <section className="card relative overflow-hidden px-3 pb-3 pt-2">
                  <div className="absolute right-3 top-3 z-10 flex gap-1.5">
                    <button type="button" className="icon-btn h-9 w-9" aria-label="Заблокировать экран" onClick={() => setLocked(true)}>
                      <Lock size={16} />
                    </button>
                    <button type="button" className="icon-btn h-9 w-9" aria-label="HUD на весь экран" onClick={() => setHud(true)}>
                      <Maximize2 size={16} />
                    </button>
                  </div>
                  <Speedometer
                    speedKmh={snap.speedKmh}
                    capKmh={capKmh}
                    peakKmh={snap.trip.maxSpeedKmh}
                    powerW={snap.powerW}
                    powerScaleW={powerScaleW}
                    dutyPct={snap.dutyPct}
                    battA={snap.battA}
                    fwActive={snap.fwActive}
                    fwA={snap.fwA}
                    slip={snap.slip}
                    connected={snap.connected}
                    modeLabel={modeLabel}
                    sourceLabel={cfg.speedSource === 'gps' ? 'км/ч · GPS' : 'км/ч'}
                  />
                  <div className="mt-1 grid grid-cols-4 gap-2 border-t border-[var(--line)] px-1 pt-3">
                    <Stat label="Заряд" value={snap.battery.socPct === null ? '—' : Math.round(snap.battery.socPct)} unit="%" size="sm" tone={snap.battery.socPct !== null && snap.battery.socPct < 20 ? 'bad' : 'default'} />
                    <Stat label="Запас" value={fmt(snap.rangeKm)} unit="км" size="sm" />
                    <Stat label="Поездка" value={fmt(snap.trip.distanceKm, 1)} unit="км" size="sm" />
                    <Stat label="Темп." value={snap.connected ? `${Math.round(Math.max(snap.tempFetMax, snap.tempMotorMax))}°` : '—'} size="sm" tone={snap.tempMotorMax >= cfg.motorWarnTempC || snap.tempFetMax >= cfg.fetWarnTempC ? 'warn' : 'default'} />
                  </div>
                </section>

                {alerts.length > 0 && (
                  <section className="flex flex-col gap-1.5">
                    {alerts.slice(0, 3).map((a) => (
                      <div
                        key={a.id}
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-[13px] font-semibold ${a.level === 'bad' ? 'pulse-bad' : ''}`}
                        style={{
                          color: a.level === 'bad' ? 'var(--bad)' : 'var(--warn)',
                          borderColor: `color-mix(in srgb, ${a.level === 'bad' ? 'var(--bad)' : 'var(--warn)'} 40%, transparent)`,
                          background: `color-mix(in srgb, ${a.level === 'bad' ? 'var(--bad)' : 'var(--warn)'} 10%, transparent)`,
                        }}
                      >
                        <TriangleAlert size={15} className="shrink-0" /> {a.text}
                      </div>
                    ))}
                  </section>
                )}

                {idle && (
                  <section className="card flex flex-col gap-3 p-4">
                    <div>
                      <div className="text-[16px] font-semibold">{session.phase === 'lost' ? 'Связь потеряна' : 'Самокат не подключён'}</div>
                      <div className="mt-1 text-[12.5px] text-[var(--fg-muted)]">
                        {session.error ?? 'Подключитесь к VESC по Bluetooth или запустите демо, чтобы посмотреть приборку в деле.'}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="btn btn-primary" onClick={() => connectNow(cfg.lastTopology === 'sim' ? 'can-single-ble' : cfg.lastTopology)}>
                        <Bluetooth size={16} /> Подключить
                      </button>
                      <button type="button" className="btn" onClick={() => connectNow('sim')}>
                        <Sparkles size={16} /> Демо
                      </button>
                    </div>
                  </section>
                )}

                <ModeBar
                  profiles={cfg.profiles}
                  activeProfileId={cfg.activeProfileId}
                  traction={cfg.tractionMode}
                  limiterOn={cfg.limiterOn}
                  limiterKmh={cfg.limiterKmh}
                  status={session.modeStatus}
                  rearAvailable={session.phase !== 'online' || session.controllers.rear.present}
                  onProfile={(id) => updateConfig({ activeProfileId: id })}
                  onTraction={(t) => updateConfig({ tractionMode: t })}
                  onLimiter={(on) => updateConfig({ limiterOn: on })}
                />
              </div>

              <WidgetStack snap={snap} cfg={cfg} controllers={session.controllers} onResetTrip={resetTrip} onResetDrag={resetDrag} />
            </div>
          )}

          {tab === 'trips' && <TripsView recorder={recorder} fix={geo.fix} gpsIssue={geo.issue} />}
          {tab === 'tune' && <TuneView session={session} snap={snap} cfg={cfg} updateConfig={updateConfig} />}
          {tab === 'settings' && (
            <SettingsView
              session={session}
              snap={snap}
              cfg={cfg}
              updateConfig={updateConfig}
              resetConfig={resetConfig}
              onResetTrip={resetTrip}
              onResetDrag={resetDrag}
              onSetOdometer={(km) => engine.trip.setOdometer(km)}
              onResetCalibration={() => engine.resetCalibration()}
            />
          )}
        </main>
      </div>

      <nav className="tabbar fixed inset-x-0 bottom-0 z-20 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-[560px] grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => {
                setTab(id);
                window.scrollTo({ top: 0 });
              }}
              className="relative flex h-[64px] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-[var(--fg-faint)] transition-colors"
            >
              <span className="tab-dot absolute top-0 h-[3px] w-8 rounded-b-full" />
              <Icon size={21} strokeWidth={tab === id ? 2.2 : 1.8} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {locked && <HoldToUnlock onUnlock={() => setLocked(false)} />}

      <Sheet open={connectSheet} onClose={() => setConnectSheet(false)} title="Подключение">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['can-single-ble', '1 BLE + CAN', 'рекомендуется'],
              ['dual-ble', '2 × BLE', 'по очереди'],
              ['usb', 'USB (OTG)', 'Web Serial'],
              ['sim', 'Демо', 'виртуальный самокат'],
            ] as [ConnectionTopology, string, string][]
          ).map(([id, title, sub]) => (
            <button
              key={id}
              type="button"
              className="flex flex-col items-start rounded-[18px] border p-3 text-left"
              style={{
                borderColor: cfg.lastTopology === id ? 'rgb(var(--accent-rgb) / 0.6)' : 'var(--line)',
                background: cfg.lastTopology === id ? 'rgb(var(--accent-rgb) / 0.1)' : 'var(--surface)',
              }}
              onClick={() => connectNow(id)}
            >
              <span className="text-[14px] font-semibold">{title}</span>
              <span className="text-[11.5px] text-[var(--fg-muted)]">{sub}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost mt-3 w-full"
          onClick={() => {
            setConnectSheet(false);
            setTab('settings');
          }}
        >
          Настройки подключения
        </button>
      </Sheet>
    </div>
  );
}
