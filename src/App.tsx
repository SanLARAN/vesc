import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  CommPacketId,
  emptyTelemetry,
  erpmToKmh,
  kmhToErpm,
  parseFwVersion,
  parseGetValues,
  payloadGetFwVersion,
  payloadGetValues,
  payloadPingCan,
  payloadSetCurrent,
  payloadSetCurrentBrake,
  payloadSetDuty,
  payloadSetHandbrake,
  payloadSetMcConfTemp,
  payloadSetRpm,
  payloadTerminalCmd,
  VescFirmwareInfo,
  VescTelemetry,
  wrapForwardCan,
} from './protocol/vescProtocol';
import {
  connectBleVesc,
  connectUsbSerialVesc,
  detectBrowserSupport,
  VescTransport,
} from './protocol/vescTransport';
import { DualFlipskySimulator } from './protocol/simulator';
import {
  BmsStageSpec,
  loadSavedConfig,
  loadTotalOdometerKm,
  OnboardComputerConfig,
  RideProfile,
  saveConfig,
  saveTotalOdometerKm,
  TractionDriveMode,
  WidgetId,
} from './state/dashboardConfig';
import { HeroCluster } from './components/HeroCluster';
import { ComputedComputerMetrics, DragRunStats, SpeedMilestone, WidgetGrid } from './components/WidgetGrid';
import { ControlCommandInput, ControlPad, PadLayoutMode } from './components/ControlPad';
import { ConnectionTopology, SettingsView } from './components/SettingsView';
import { ChecklistView } from './components/ChecklistView';
import { RouteRecorder } from './components/RouteRecorder';
import { YANDEX_MAPS_API_KEY } from './config';
import HudView from './components/HudView';

type MainScreenTab = 'dash' | 'bms_guide' | 'remote' | 'settings';

const TRACTION_CYCLE: TractionDriveMode[] = ['2wd', '1wd_front_hall', '1wd_rear_sl'];

function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const DRAG_THRESHOLDS = [30, 50, 60, 75, 90, 100] as const;

function recordDragThresholds(
  speedKmh: number,
  elapsedSec: number,
  hitThresholds: Set<number>,
  setStats: React.Dispatch<React.SetStateAction<DragRunStats>>
): boolean {
  const hits = DRAG_THRESHOLDS.filter((target) => speedKmh >= target && !hitThresholds.has(target));
  if (hits.length === 0) return false;
  hits.forEach((target) => hitThresholds.add(target));
  setStats((previous) => {
    const bestTimes = { ...previous.bestTimes };
    let best0to30Sec = previous.best0to30Sec;
    let best0to50Sec = previous.best0to50Sec;
    for (const target of hits) {
      if (target === 30) {
        best0to30Sec = best0to30Sec === null ? elapsedSec : Math.min(best0to30Sec, elapsedSec);
        bestTimes[30] = bestTimes[30] === null ? elapsedSec : Math.min(bestTimes[30]!, elapsedSec);
      } else if (target === 50) {
        best0to50Sec = best0to50Sec === null ? elapsedSec : Math.min(best0to50Sec, elapsedSec);
      } else {
        const milestone = target as SpeedMilestone;
        bestTimes[milestone] = bestTimes[milestone] === null
          ? elapsedSec
          : Math.min(bestTimes[milestone]!, elapsedSec);
      }
    }
    return { ...previous, best0to30Sec, best0to50Sec, bestTimes };
  });
  return hits.includes(100);
}

const emptyBestTimes = (): DragRunStats['bestTimes'] => ({
  30: null,
  60: null,
  75: null,
  90: null,
  100: null,
});

function estimateSocFromRestVoltage(
  packVoltage: number,
  cells: number,
  chemistry: 'liion' | 'lifepo4',
  cutoffEndV: number
): number {
  if (packVoltage <= 0 || cells <= 0) return 0;
  const cellVoltage = packVoltage / cells;
  const curve: [number, number][] = chemistry === 'liion'
    ? [[2.9, 3], [3.0, 5], [3.2, 10], [3.3, 17], [3.4, 27], [3.5, 40], [3.6, 55], [3.7, 68], [3.8, 80], [3.9, 90], [4.0, 95], [4.1, 98], [4.2, 100]]
    : [[2.9, 2], [3.0, 5], [3.1, 15], [3.2, 45], [3.25, 65], [3.3, 80], [3.35, 90], [3.4, 95], [3.5, 98], [3.65, 100]];
  const points = ([[cutoffEndV / cells, 0], ...curve] as [number, number][]).sort((a, b) => a[0] - b[0]);
  if (cellVoltage <= points[0][0]) return 0;
  for (let i = 1; i < points.length; i++) {
    const [upperV, upperPct] = points[i];
    const [lowerV, lowerPct] = points[i - 1];
    if (cellVoltage <= upperV) {
      const ratio = (cellVoltage - lowerV) / Math.max(0.001, upperV - lowerV);
      return Math.max(0, Math.min(100, Math.round(lowerPct + ratio * (upperPct - lowerPct))));
    }
  }
  return 100;
}

type ControllerIndicatorLevel = 'ok' | 'warning' | 'error';

function controllerIndicator(
  telemetry: VescTelemetry,
  online: boolean,
  stale: boolean
): { level: ControllerIndicatorLevel; detail: string } {
  if (telemetry.faultCode !== 0) {
    return { level: 'error', detail: `${telemetry.faultText} (#${telemetry.faultCode})` };
  }
  if (telemetry.tempFet >= 100 || telemetry.tempMotor >= 95) {
    return { level: 'error', detail: `Перегрев • FET ${telemetry.tempFet.toFixed(0)}°C / мотор ${telemetry.tempMotor.toFixed(0)}°C` };
  }
  if (!online) return { level: 'warning', detail: 'Нет связи с контроллером' };
  if (stale) return { level: 'warning', detail: 'Телеметрия не обновляется' };
  if (telemetry.tempFet >= 80 || telemetry.tempMotor >= 80) {
    return { level: 'warning', detail: `Высокая температура • FET ${telemetry.tempFet.toFixed(0)}°C / мотор ${telemetry.tempMotor.toFixed(0)}°C` };
  }
  return { level: 'ok', detail: 'Норма' };
}

export const App: React.FC = () => {
  const browser = useMemo(() => detectBrowserSupport(), []);

  const [config, setConfig] = useState<OnboardComputerConfig>(loadSavedConfig);
  const [screenTab, setScreenTab] = useState<MainScreenTab>('dash');
  const [hudMode, setHudMode] = useState(false);
  const [touchLocked, setTouchLocked] = useState<boolean>(false);
  const [parked, setParked] = useState<boolean>(false);
  const [limit25Override, setLimit25Override] = useState<boolean>(false);

  const [topology, setTopology] = useState<ConnectionTopology>('sim');
  const [autoDemoRide, setAutoDemoRide] = useState<boolean>(true);
  const [padLayout, setPadLayout] = useState<PadLayoutMode>('trigger');
  const [armed, setArmed] = useState<boolean>(true);
  const [filterBleOnly, setFilterBleOnly] = useState<boolean>(false);

  // Exact Achilleus wiring: ID 0 Master = Front Hall, ID 1 Slave = Rear Sensorless
  const [frontMasterTelemetry, setFrontMasterTelemetry] =
    useState<VescTelemetry>(emptyTelemetry);
  const [rearSlaveTelemetry, setRearSlaveTelemetry] =
    useState<VescTelemetry>(emptyTelemetry);
  const [frontFw, setFrontFw] = useState<VescFirmwareInfo | null>(null);
  const [rearFw, setRearFw] = useState<VescFirmwareInfo | null>(null);
  const [discoveredCanIds, setDiscoveredCanIds] = useState<number[]>([]);

  const [link1Name, setLink1Name] = useState<string | null>(null);
  const [link2Name, setLink2Name] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [routeIssue, setRouteIssue] = useState<string | null>(null);
  const [gpsSpeedIssue, setGpsSpeedIssue] = useState<string | null>(null);
  const [showGpsSpeed, setShowGpsSpeed] = useState(false);
  const [gpsSpeedKmh, setGpsSpeedKmh] = useState<number | null>(null);
  const [gpsSpeedAccuracy, setGpsSpeedAccuracy] = useState<number | null>(null);
  const [gpsFixAt, setGpsFixAt] = useState(0);
  const [wheelDiameterCandidate, setWheelDiameterCandidate] = useState<number | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const lastGpsFixRef = useRef<{ lat: number; lon: number; at: number } | null>(null);
  const wheelCalibrationSamplesRef = useRef<number[]>([]);
  const lastCalibrationFixRef = useRef(0);
  const [wakeLockState, setWakeLockState] = useState<'checking' | 'active' | 'suspended' | 'unsupported' | 'blocked'>('checking');
  const wakeLockRef = useRef<{ released: boolean; release(): Promise<void>; addEventListener(type: 'release', listener: () => void): void } | null>(null);
  const [logs, setLogs] = useState<string[]>([
    'Конфигурация Dualtron Achilleus (Части 16–23) загружена.',
    'Master ID 0 = Передний МК (Hall + ADC + BLE) • Slave ID 1 = Задний МК (Sensorless CAN 500K).',
    'Во вкладке «ЭТАПЫ / Ч.16–23» доступно переключение ступеней BMS 30А→47А и интерактивный чек-лист.',
  ]);

  const [tripDistanceKm, setTripDistanceKm] = useState<number>(0);
  const [odometerKm, setOdometerKm] = useState<number>(loadTotalOdometerKm);
  const [rideSeconds, setRideSeconds] = useState<number>(0);
  const [tripStartWh, setTripStartWh] = useState<number>(0);
  const [highestIdleVoltage, setHighestIdleVoltage] = useState<number>(0);
  const socAnchorRef = useRef<{ netAh: number; percent: number } | null>(null);
  const [dragStats, setDragStats] = useState<DragRunStats>({
    state: 'ready',
    currentSec: 0,
    best0to30Sec: null,
    best0to50Sec: null,
    bestTimes: emptyBestTimes(),
  });
  const [peaks, setPeaks] = useState({
    maxSpeedKmh: 0,
    maxPowerWatts: 0,
    maxPhaseAmps: 0,
    maxBattAmps: 0,
  });
  const [powerHistory, setPowerHistory] = useState<number[]>(() => Array(48).fill(0));
  const [speedHistory, setSpeedHistory] = useState<number[]>(() => Array(48).fill(0));

  const link1Ref = useRef<VescTransport | null>(null);
  const link2Ref = useRef<VescTransport | null>(null);
  const simRef = useRef<DualFlipskySimulator>(new DualFlipskySimulator());

  const targetInputRef = useRef<ControlCommandInput>({
    left: 0,
    right: 0,
    brakingLeft: false,
    brakingRight: false,
  });
  const smoothedRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });
  const [displayCmdPct, setDisplayCmdPct] = useState<{ left: number; right: number }>({
    left: 0,
    right: 0,
  });

  const configRef = useRef(config);
  configRef.current = config;
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const parkedRef = useRef(parked);
  parkedRef.current = parked;
  const limit25Ref = useRef(limit25Override);
  limit25Ref.current = limit25Override;
  const topologyRef = useRef(topology);
  topologyRef.current = topology;
  const autoDemoRef = useRef(autoDemoRide);
  autoDemoRef.current = autoDemoRide;
  const awaitingCanReplyRef = useRef(false);
  const odoAccumRef = useRef(odometerKm);
  const dragInternalRef = useRef<{
    armedFromStop: boolean;
    startTimeMs: number | null;
    hitThresholds: Set<number>;
  }>({
    armedFromStop: false,
    startTimeMs: null,
    hitThresholds: new Set<number>(),
  });

  const updateConfig = useCallback((patch: Partial<OnboardComputerConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', config.theme);
  }, [config.theme]);

  useEffect(() => {
    let disposed = false;
    const nav = navigator as Navigator & {
      wakeLock?: {
        request(type: 'screen'): Promise<{
          released: boolean;
          release(): Promise<void>;
          addEventListener(type: 'release', listener: () => void): void;
        }>;
      };
    };

    const acquire = async () => {
      if (disposed) return;
      if (!nav.wakeLock) {
        setWakeLockState('unsupported');
        return;
      }
      if (document.visibilityState !== 'visible') {
        setWakeLockState('suspended');
        return;
      }
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        setWakeLockState('active');
        return;
      }
      try {
        const sentinel = await nav.wakeLock.request('screen');
        if (disposed) {
          await sentinel.release().catch(() => {});
          return;
        }
        wakeLockRef.current = sentinel;
        setWakeLockState('active');
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
          if (!disposed) setWakeLockState(document.visibilityState === 'visible' ? 'blocked' : 'suspended');
        });
      } catch {
        if (!disposed) setWakeLockState('blocked');
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
      else setWakeLockState('suspended');
    };
    const onUserInteraction = () => void acquire();

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('pointerdown', onUserInteraction, { passive: true });
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('pointerdown', onUserInteraction);
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      void sentinel?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!showGpsSpeed) {
      if (gpsWatchIdRef.current !== null) navigator.geolocation?.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
      lastGpsFixRef.current = null;
      setGpsSpeedKmh(null);
      setGpsSpeedAccuracy(null);
      setGpsSpeedIssue(null);
      setWheelDiameterCandidate(null);
      wheelCalibrationSamplesRef.current = [];
      return;
    }

    if (!navigator.geolocation) {
      setGpsSpeedIssue('GPS недоступен в этом браузере.');
      return;
    }
    if (!window.isSecureContext) {
      setGpsSpeedIssue('Для GPS нужна защищённая HTTPS-страница.');
      return;
    }

    setGpsSpeedIssue(null);
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude: lat, longitude: lon, accuracy, speed } = position.coords;
        const at = position.timestamp || Date.now();
        setGpsSpeedAccuracy(accuracy);
        setGpsFixAt(at);
        if (accuracy > 60) {
          setGpsSpeedKmh(null);
          setGpsSpeedIssue(`Слабый GPS-сигнал: точность около ±${Math.round(accuracy)} м.`);
          return;
        }
        setGpsSpeedIssue(null);

        let speedMps = speed;
        const previous = lastGpsFixRef.current;
        if ((speedMps === null || !Number.isFinite(speedMps)) && previous) {
          const rad = (value: number) => value * Math.PI / 180;
          const dLat = rad(lat - previous.lat);
          const dLon = rad(lon - previous.lon);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(previous.lat)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
          const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const elapsed = (at - previous.at) / 1000;
          speedMps = elapsed > 0.4 ? distance / elapsed : null;
        }
        lastGpsFixRef.current = { lat, lon, at };
        if (speedMps !== null && Number.isFinite(speedMps)) {
          const nextKmh = Math.max(0, speedMps * 3.6);
          setGpsSpeedKmh((previousSpeed) => {
            if (previousSpeed === null || Math.abs(previousSpeed - nextKmh) > 20) return nextKmh;
            return previousSpeed * 0.65 + nextKmh * 0.35;
          });
        }
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'GPS-доступ запрещён. Разрешите геопозицию для сайта в браузере.'
          : error.code === error.TIMEOUT
          ? 'GPS не ответил вовремя; проверьте сигнал и разрешение геолокации.'
          : 'Не удалось получить скорость GPS.';
        setGpsSpeedIssue(message);
        setGpsSpeedKmh(null);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
    gpsWatchIdRef.current = watchId;

    return () => {
      navigator.geolocation?.clearWatch(watchId);
      if (gpsWatchIdRef.current === watchId) gpsWatchIdRef.current = null;
    };
  }, [showGpsSpeed]);

  const appendLog = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    setLogs((prev) => [`[${stamp}] ${line}`, ...prev.slice(0, 79)]);
  }, []);

  const reportRouteIssue = useCallback((message: string | null) => {
    setRouteIssue(message);
  }, []);

  const activeProfile: RideProfile = useMemo(
    () =>
      config.profiles.find((p) => p.id === config.activeProfileId) ??
      config.profiles[0],
    [config.profiles, config.activeProfileId]
  );

  /**
   * Sends exact 45-byte COMM_SET_MCCONF_TEMP packets separately to:
   * - Master (ID 0: Front Hall Sensors + ADC)
   * - Slave  (ID 1: Rear Sensorless over CAN 500K)
   */
  const pushDrivetrainConfig = useCallback(
    async (
      profile: RideProfile,
      mode: TractionDriveMode,
      isLimit25: boolean,
      perEscAmpsOverride?: number,
      persistFlash = false
    ) => {
      const cfg = configRef.current;
      const stagePerEsc = perEscAmpsOverride ?? cfg.perEscBatteryAmps;
      const capSpeedKmh = isLimit25 ? Math.min(25, profile.maxSpeedKmh) : profile.maxSpeedKmh;
      const capWatts = isLimit25 ? Math.min(900, profile.maxWatts) : profile.maxWatts;
      const totalBattBudget = isLimit25
        ? Math.min(18, profile.maxBattAmps)
        : Math.min(stagePerEsc * 2, profile.maxBattAmps);

      const maxErpm = kmhToErpm(
        capSpeedKmh,
        cfg.polePairs,
        cfg.gearRatio,
        cfg.wheelDiameterMm
      );
      const minErpm = -kmhToErpm(
        profile.maxReverseKmh,
        cfg.polePairs,
        cfg.gearRatio,
        cfg.wheelDiameterMm
      );

      const frontScale =
        mode === '1wd_rear_sl'
          ? 0.01
          : (profile.currentScalePct / 100) * (cfg.frontTorqueRatioPct / 100);
      const rearScale =
        mode === '1wd_front_hall' ? 0.01 : profile.currentScalePct / 100;

      const frontBattMax =
        mode === '1wd_rear_sl'
          ? 2
          : mode === '1wd_front_hall'
          ? Math.min(stagePerEsc, totalBattBudget)
          : totalBattBudget / 2;
      const rearBattMax =
        mode === '1wd_front_hall'
          ? 2
          : mode === '1wd_rear_sl'
          ? Math.min(stagePerEsc, totalBattBudget)
          : totalBattBudget / 2;

      const frontMasterPacket = payloadSetMcConfTemp({
        store: persistFlash,
        forwardCan: false,
        divideByControllers: false,
        currentMinScale: profile.brakeScalePct / 100,
        currentMaxScale: frontScale,
        minErpm,
        maxErpm,
        wattMin: -10000,
        wattMax: mode === '1wd_rear_sl' ? 50 : capWatts * 0.48,
        inCurrentMin: -15,
        inCurrentMax: frontBattMax,
      });

      const rearSlavePacket = payloadSetMcConfTemp({
        store: persistFlash,
        forwardCan: false,
        divideByControllers: false,
        currentMinScale: profile.brakeScalePct / 100,
        currentMaxScale: rearScale,
        minErpm,
        maxErpm,
        wattMin: -10000,
        wattMax: mode === '1wd_front_hall' ? 50 : capWatts * 0.52,
        inCurrentMin: -15,
        inCurrentMax: rearBattMax,
      });

      if (topologyRef.current === 'sim') {
        appendLog(
          `Achilleus: ${isLimit25 ? 'ДУШИЛКА 25' : profile.name} • Перед ${frontBattMax.toFixed(
            0
          )}А / Зад ${rearBattMax.toFixed(0)}А (${persistFlash ? 'EEPROM' : 'RAM'}).`
        );
        return;
      }

      if (link1Ref.current?.isConnected()) {
        await link1Ref.current.sendPayload(frontMasterPacket);
        if (topologyRef.current === 'can-single-ble' || topologyRef.current === 'usb') {
          await link1Ref.current.sendPayload(
            wrapForwardCan(cfg.canSlaveId, rearSlavePacket)
          );
        }
      }
      if (topologyRef.current === 'dual-ble' && link2Ref.current?.isConnected()) {
        await link2Ref.current.sendPayload(rearSlavePacket);
      }
      appendLog(
        `Записано в Master ID0 и Slave ID${cfg.canSlaveId}: Перед ${frontBattMax.toFixed(
          0
        )}А / Зад ${rearBattMax.toFixed(0)}А (${persistFlash ? 'EEPROM' : 'RAM'}).`
      );
    },
    [appendLog]
  );

  const handleSelectProfile = useCallback(
    (profileId: string) => {
      navigator.vibrate?.(25);
      setLimit25Override(false);
      updateConfig({ activeProfileId: profileId });
      const found = configRef.current.profiles.find((p) => p.id === profileId);
      if (found) {
        void pushDrivetrainConfig(found, configRef.current.tractionMode, false);
      }
    },
    [pushDrivetrainConfig, updateConfig]
  );

  const handleApplyBmsStage = useCallback(
    (stage: BmsStageSpec, saveEeprom: boolean) => {
      navigator.vibrate?.(35);
      const updatedProfiles = configRef.current.profiles.map((p) =>
        p.id === 'turbo_fw'
          ? {
              ...p,
              maxBattAmps: stage.totalAmps,
              maxWatts: Math.round(stage.totalAmps * 60),
            }
          : p
      );
      updateConfig({
        perEscBatteryAmps: stage.perVescAmps,
        profiles: updatedProfiles,
      });
      const prof =
        updatedProfiles.find((p) => p.id === configRef.current.activeProfileId) ??
        updatedProfiles[updatedProfiles.length - 1];
      if (prof) {
        void pushDrivetrainConfig(
          prof,
          configRef.current.tractionMode,
          limit25Ref.current,
          stage.perVescAmps,
          saveEeprom
        );
      }
    },
    [pushDrivetrainConfig, updateConfig]
  );

  const handleCycleTraction = useCallback(() => {
    navigator.vibrate?.(30);
    const idx = TRACTION_CYCLE.indexOf(configRef.current.tractionMode);
    const nextMode = TRACTION_CYCLE[(idx + 1) % TRACTION_CYCLE.length];
    updateConfig({ tractionMode: nextMode });
    const prof =
      configRef.current.profiles.find(
        (p) => p.id === configRef.current.activeProfileId
      ) ?? configRef.current.profiles[0];
    if (prof) {
      void pushDrivetrainConfig(prof, nextMode, limit25Ref.current);
    }
  }, [pushDrivetrainConfig, updateConfig]);

  const handleToggleLimit25 = useCallback(() => {
    navigator.vibrate?.([25, 30, 25]);
    const nextLim = !limit25Ref.current;
    setLimit25Override(nextLim);
    const prof =
      configRef.current.profiles.find(
        (p) => p.id === configRef.current.activeProfileId
      ) ?? configRef.current.profiles[0];
    if (prof) {
      void pushDrivetrainConfig(prof, configRef.current.tractionMode, nextLim);
    }
  }, [pushDrivetrainConfig]);

  const handleTogglePark = useCallback(() => {
    navigator.vibrate?.(40);
    if (parked) {
      if (config.pinCode.length > 0) {
        const entered = window.prompt('Введите PIN-код разблокировки Achilleus:');
        if (entered !== config.pinCode) {
          window.alert('Неверный PIN-код.');
          return;
        }
      }
      setParked(false);
      appendLog('Паркинг [P] снят.');
    } else {
      setParked(true);
      targetInputRef.current = {
        left: 0,
        right: 0,
        brakingLeft: false,
        brakingRight: false,
      };
      appendLog('Паркинг [P] включён — моторы удерживаются.');
    }
  }, [appendLog, config.pinCode, parked]);

  const zeroMotorsImmediately = useCallback((applyGentleBrake = false) => {
    targetInputRef.current = {
      left: 0,
      right: 0,
      brakingLeft: false,
      brakingRight: false,
    };
    smoothedRef.current = { left: 0, right: 0 };
    setDisplayCmdPct({ left: 0, right: 0 });
    setAutoDemoRide(false);

    const stopPayload = applyGentleBrake
      ? payloadSetCurrentBrake(Math.min(20, configRef.current.maxBrakeAmps))
      : payloadSetCurrent(0);

    if (link1Ref.current?.isConnected()) {
      void link1Ref.current.sendPayload(stopPayload);
      if (topologyRef.current === 'can-single-ble' || topologyRef.current === 'usb') {
        void link1Ref.current.sendPayload(
          wrapForwardCan(configRef.current.canSlaveId, stopPayload)
        );
      }
    }
    if (link2Ref.current?.isConnected()) {
      void link2Ref.current.sendPayload(stopPayload);
    }
  }, []);

  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden && topologyRef.current !== 'sim') {
        zeroMotorsImmediately(false);
        setArmed(false);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [zeroMotorsImmediately]);

  const handleIncomingPacket = useCallback(
    (source: 'link1' | 'link2', payload: Uint8Array) => {
      const id = payload[0];
      if (id === CommPacketId.COMM_GET_VALUES) {
        const parsed = parseGetValues(payload);
        if (!parsed) return;
        if (Math.abs(parsed.avgInputCurrent) < 1.5 && parsed.vIn > 30) {
          setHighestIdleVoltage(parsed.vIn);
        }
        if (source === 'link2') {
          setRearSlaveTelemetry(parsed);
        } else if (
          topologyRef.current === 'can-single-ble' ||
          topologyRef.current === 'usb'
        ) {
          if (
            parsed.controllerId === configRef.current.canSlaveId ||
            awaitingCanReplyRef.current
          ) {
            awaitingCanReplyRef.current = false;
            setRearSlaveTelemetry(parsed);
          } else {
            setFrontMasterTelemetry(parsed);
          }
        } else {
          setFrontMasterTelemetry(parsed);
        }
      } else if (id === CommPacketId.COMM_FW_VERSION) {
        const fw = parseFwVersion(payload);
        if (!fw) return;
        appendLog(`Подключён VESC FW ${fw.fwMajor}.${fw.fwMinor} (${fw.hwName})`);
        if (source === 'link2') setRearFw(fw);
        else setFrontFw(fw);
      } else if (id === CommPacketId.COMM_PING_CAN) {
        const ids = Array.from(payload.slice(1));
        setDiscoveredCanIds(ids);
        if (ids.length > 0) {
          updateConfig({ canSlaveId: ids[0] });
          appendLog(`CAN-шина ОК: найден Slave Задний МК ID ${ids.join(', ')}`);
        } else {
          appendLog(
            'CAN Slave не найден — проверьте часть 19 (500K, ID0/ID1, обрезан ли +5V).'
          );
        }
      } else if (id === CommPacketId.COMM_SET_MCCONF_TEMP) {
        appendLog('VESC подтвердил приём конфигурации токов и скорости (ACK 48).');
      } else if (id === CommPacketId.COMM_PRINT) {
        const text = new TextDecoder().decode(payload.slice(1)).trim();
        if (text) appendLog(`VESC > ${text}`);
      }
    },
    [appendLog, updateConfig]
  );

  const disconnectAllLinks = useCallback(async () => {
    zeroMotorsImmediately(false);
    await link1Ref.current?.disconnect().catch(() => {});
    await link2Ref.current?.disconnect().catch(() => {});
    link1Ref.current = null;
    link2Ref.current = null;
    setLink1Name(null);
    setLink2Name(null);
  }, [zeroMotorsImmediately]);

  const switchTopology = useCallback(
    async (next: ConnectionTopology) => {
      setErrorBanner(null);
      if (next !== topology) {
        await disconnectAllLinks();
        setTopology(next);
        if (next === 'sim') {
          setArmed(true);
          setAutoDemoRide(true);
          appendLog('Симулятор Dualtron Achilleus активирован.');
        } else {
          setArmed(false);
          setAutoDemoRide(false);
          setFrontMasterTelemetry(emptyTelemetry());
          setRearSlaveTelemetry(emptyTelemetry());
        }
      }
    },
    [appendLog, disconnectAllLinks, topology]
  );

  const handleConnectBleSlot = useCallback(
    async (slot: 1 | 2) => {
      setErrorBanner(null);
      try {
        const link = await connectBleVesc(
          {
            onPayload: (p) => handleIncomingPacket(slot === 1 ? 'link1' : 'link2', p),
            onDisconnect: () => {
              if (slot === 1) {
                link1Ref.current = null;
                setLink1Name(null);
              } else {
                link2Ref.current = null;
                setLink2Name(null);
              }
              setArmed(false);
              zeroMotorsImmediately(false);
            },
            onLog: appendLog,
          },
          filterBleOnly
        );

        if (slot === 1) {
          link1Ref.current = link;
          setLink1Name(link.deviceName);
          if (topologyRef.current === 'sim') {
            setTopology('can-single-ble');
            setArmed(false);
            setAutoDemoRide(false);
          }
          await link.sendPayload(payloadGetFwVersion());
          if (topologyRef.current !== 'dual-ble') {
            await link.sendPayload(payloadPingCan());
          }
        } else {
          link2Ref.current = link;
          setLink2Name(link.deviceName);
          await link.sendPayload(payloadGetFwVersion());
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('cancel')) {
          setErrorBanner(msg);
          appendLog(`Bluetooth: ${msg}`);
        }
      }
    },
    [appendLog, filterBleOnly, handleIncomingPacket, zeroMotorsImmediately]
  );

  const handleConnectUsb = useCallback(async () => {
    setErrorBanner(null);
    try {
      await disconnectAllLinks();
      const link = await connectUsbSerialVesc({
        onPayload: (p) => handleIncomingPacket('link1', p),
        onDisconnect: () => {
          link1Ref.current = null;
          setLink1Name(null);
          setArmed(false);
        },
        onLog: appendLog,
      });
      setTopology('usb');
      setArmed(false);
      setAutoDemoRide(false);
      link1Ref.current = link;
      setLink1Name(link.deviceName);
      await link.sendPayload(payloadGetFwVersion());
      await link.sendPayload(payloadPingCan());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('no port selected')) {
        setErrorBanner(msg);
        appendLog(`USB: ${msg}`);
      }
    }
  }, [appendLog, disconnectAllLinks, handleIncomingPacket]);

  const handleScanCan = useCallback(async () => {
    if (topologyRef.current === 'sim') {
      setDiscoveredCanIds([1]);
      updateConfig({ canSlaveId: 1 });
      appendLog('Часть 19 CAN Scan (Сим): ID 0 Master + ID 1 Slave (Sensorless) онлайн.');
      return;
    }
    if (!link1Ref.current?.isConnected()) {
      setErrorBanner('Сначала подключите Master (ID 0) по Bluetooth или USB.');
      return;
    }
    await link1Ref.current.sendPayload(payloadPingCan());
  }, [appendLog, updateConfig]);

  // 20 Hz Real-Time Loop
  useEffect(() => {
    let tickCount = 0;
    const dt = 0.05;

    const interval = window.setInterval(() => {
      const cfg = configRef.current;
      const prof =
        cfg.profiles.find((p) => p.id === cfg.activeProfileId) ?? cfg.profiles[0];
      const isLim25 = limit25Ref.current;
      const isParked = parkedRef.current;

      const effectiveSpeedCap = isLim25
        ? Math.min(25, prof?.maxSpeedKmh ?? 25)
        : prof?.maxSpeedKmh ?? 95;
      const effectiveWattsCap = isLim25
        ? Math.min(900, prof?.maxWatts ?? 900)
        : prof?.maxWatts ?? 5800;
      const effectivePerEscBattCap = isLim25
        ? 9
        : Math.min(cfg.perEscBatteryAmps, (prof?.maxBattAmps ?? 94) / 2);

      const currentScale = (prof?.currentScalePct ?? 100) / 100;
      const brakeScale = (prof?.brakeScalePct ?? 100) / 100;
      const frontRatio =
        cfg.tractionMode === '1wd_rear_sl' ? 0 : cfg.frontTorqueRatioPct / 100;
      const rearRatio = cfg.tractionMode === '1wd_front_hall' ? 0 : 1;

      const maxProfileErpm = kmhToErpm(
        effectiveSpeedCap,
        cfg.polePairs,
        cfg.gearRatio,
        cfg.wheelDiameterMm
      );

      const raw =
        armedRef.current && !isParked
          ? targetInputRef.current
          : { left: 0, right: 0, brakingLeft: false, brakingRight: false };

      const desiredFront = raw.left * (cfg.invertFront && !raw.brakingLeft ? -1 : 1);
      const desiredRear = raw.right * (cfg.invertRear && !raw.brakingRight ? -1 : 1);

      const maxDelta = cfg.rampRatePerSec * dt;
      const rampStep = (curr: number, goal: number) => {
        const limit =
          Math.abs(goal) < Math.abs(curr) ? Math.max(maxDelta * 2.5, 0.2) : maxDelta;
        return Math.abs(goal - curr) <= limit
          ? goal
          : curr + Math.sign(goal - curr) * limit;
      };

      const nextFront = rampStep(smoothedRef.current.left, desiredFront);
      const nextRear = rampStep(smoothedRef.current.right, desiredRear);
      smoothedRef.current = { left: nextFront, right: nextRear };

      setDisplayCmdPct((prev) => {
        const l = Math.round(nextFront * currentScale * frontRatio * 100);
        const r = Math.round(nextRear * currentScale * rearRatio * 100);
        return prev.left === l && prev.right === r ? prev : { left: l, right: r };
      });

      if (topologyRef.current === 'sim') {
        const sim = simRef.current.step(
          dt,
          nextFront * currentScale * frontRatio,
          nextRear * currentScale * rearRatio,
          raw.brakingLeft,
          raw.brakingRight,
          autoDemoRef.current,
          isParked,
          cfg.fieldWeakeningSim,
          cfg.maxCurrentAmps * currentScale * frontRatio,
          cfg.maxCurrentAmps * currentScale * rearRatio,
          cfg.maxBrakeAmps * brakeScale,
          maxProfileErpm,
          effectiveWattsCap,
          effectivePerEscBattCap
        );
        setFrontMasterTelemetry(sim.frontMaster);
        setRearSlaveTelemetry(sim.rearSlave);
        setHighestIdleVoltage(simRef.current.getRestVoltage());

        const instSpeed = Math.abs(
          erpmToKmh(
            sim.frontMaster.erpm,
            cfg.polePairs,
            cfg.gearRatio,
            cfg.wheelDiameterMm
          )
        );
        const dRef = dragInternalRef.current;
        if (instSpeed < 0.8) {
          dRef.armedFromStop = true;
          dRef.startTimeMs = null;
          dRef.hitThresholds.clear();
          setDragStats((prev) =>
            prev.state === 'ready' ? prev : { ...prev, state: 'ready', currentSec: 0 }
          );
        } else if (dRef.armedFromStop) {
          const nowMs = performance.now();
          if (dRef.startTimeMs === null) dRef.startTimeMs = nowMs;
          const elapsed = (nowMs - dRef.startTimeMs) / 1000;
          const reached100 = recordDragThresholds(instSpeed, elapsed, dRef.hitThresholds, setDragStats);
          if (reached100) dRef.armedFromStop = false;
          setDragStats((prev) => ({
            ...prev,
            state: reached100 ? 'done' : 'running',
            currentSec: elapsed,
          }));
        }
      } else {
        if (isParked) {
          const hb = payloadSetHandbrake(cfg.handbrakeAmps);
          if (link1Ref.current?.isConnected()) {
            void link1Ref.current.sendPayload(hb);
            if (topologyRef.current === 'can-single-ble' || topologyRef.current === 'usb') {
              void link1Ref.current.sendPayload(wrapForwardCan(cfg.canSlaveId, hb));
            }
          }
          if (topologyRef.current === 'dual-ble' && link2Ref.current?.isConnected()) {
            void link2Ref.current.sendPayload(hb);
          }
        } else {
          const buildCmd = (val: number, scale: number, braking: boolean): Uint8Array => {
            if (braking) {
              return payloadSetCurrentBrake(
                Math.abs(val) * cfg.maxBrakeAmps * brakeScale
              );
            }
            if (Math.abs(val) < 0.004 || scale <= 0.001) return payloadSetCurrent(0);
            if (cfg.driveType === 'duty') {
              return payloadSetDuty(val * scale * 0.95);
            }
            if (cfg.driveType === 'rpm') {
              return payloadSetRpm(val * maxProfileErpm);
            }
            return payloadSetCurrent(val * cfg.maxCurrentAmps * scale);
          };

          const active =
            armedRef.current &&
            (Math.abs(nextFront) > 0.004 ||
              Math.abs(nextRear) > 0.004 ||
              raw.brakingLeft ||
              raw.brakingRight);

          if (active) {
            const pFront = buildCmd(
              nextFront,
              currentScale * frontRatio,
              raw.brakingLeft
            );
            const pRear = buildCmd(nextRear, currentScale * rearRatio, raw.brakingRight);
            if (link1Ref.current?.isConnected()) {
              void link1Ref.current.sendPayload(pFront);
              if (
                topologyRef.current === 'can-single-ble' ||
                topologyRef.current === 'usb'
              ) {
                void link1Ref.current.sendPayload(
                  wrapForwardCan(cfg.canSlaveId, pRear)
                );
              }
            }
            if (topologyRef.current === 'dual-ble' && link2Ref.current?.isConnected()) {
              void link2Ref.current.sendPayload(pRear);
            }
          }
        }

        if (tickCount % 8 === 0) {
          if (link1Ref.current?.isConnected()) {
            awaitingCanReplyRef.current = false;
            void link1Ref.current.sendPayload(payloadGetValues());
          }
          if (topologyRef.current === 'dual-ble' && link2Ref.current?.isConnected()) {
            void link2Ref.current.sendPayload(payloadGetValues());
          }
        } else if (
          tickCount % 8 === 4 &&
          (topologyRef.current === 'can-single-ble' || topologyRef.current === 'usb') &&
          link1Ref.current?.isConnected()
        ) {
          awaitingCanReplyRef.current = true;
          void link1Ref.current.sendPayload(
            wrapForwardCan(cfg.canSlaveId, payloadGetValues())
          );
        }
      }

      tickCount++;
    }, 50);

    return () => window.clearInterval(interval);
  }, []);

  const frontOnline = topology === 'sim' || Boolean(link1Name);
  const rearOnline =
    topology === 'sim' ||
    (topology === 'dual-ble'
      ? Boolean(link2Name)
      : Boolean(link1Name) && rearSlaveTelemetry.updatedAt > 0);
  const frontIndicator = controllerIndicator(
    frontMasterTelemetry,
    frontOnline,
    topology !== 'sim' && frontMasterTelemetry.updatedAt > 0 && Date.now() - frontMasterTelemetry.updatedAt > 3000
  );
  const rearIndicator = controllerIndicator(
    rearSlaveTelemetry,
    rearOnline,
    topology !== 'sim' && rearSlaveTelemetry.updatedAt > 0 && Date.now() - rearSlaveTelemetry.updatedAt > 3000
  );

  const speedFront = erpmToKmh(
    frontMasterTelemetry.erpm,
    config.polePairs,
    config.gearRatio,
    config.wheelDiameterMm
  );
  const speedRear = erpmToKmh(
    rearSlaveTelemetry.erpm,
    config.polePairs,
    config.gearRatio,
    config.wheelDiameterMm
  );
  const speedSigned =
    frontOnline && rearOnline
      ? (speedFront + speedRear) / 2
      : frontOnline
      ? speedFront
      : rearOnline
      ? speedRear
      : 0;
  const speedAbs = Math.abs(speedSigned);

  useEffect(() => {
    if (topology === 'sim') return;
    const dRef = dragInternalRef.current;
    if (speedAbs < 0.8) {
      dRef.armedFromStop = true;
      dRef.startTimeMs = null;
      dRef.hitThresholds.clear();
      setDragStats((prev) => ({ ...prev, state: 'ready', currentSec: 0 }));
    } else if (dRef.armedFromStop) {
      const nowMs = performance.now();
      if (dRef.startTimeMs === null) dRef.startTimeMs = nowMs;
      const elapsed = (nowMs - dRef.startTimeMs) / 1000;
      const reached100 = recordDragThresholds(speedAbs, elapsed, dRef.hitThresholds, setDragStats);
      if (reached100) dRef.armedFromStop = false;
      setDragStats((prev) => ({
        ...prev,
        state: reached100 ? 'done' : 'running',
        currentSec: elapsed,
      }));
    }
  }, [speedAbs, topology]);

  useEffect(() => {
    if (!showGpsSpeed || topology === 'sim' || gpsFixAt === 0 || gpsFixAt === lastCalibrationFixRef.current) return;
    lastCalibrationFixRef.current = gpsFixAt;
    if (gpsSpeedAccuracy === null || gpsSpeedAccuracy > 15 || gpsSpeedKmh === null || gpsSpeedKmh < 15 || speedAbs < 15) {
      return;
    }
    const ratio = gpsSpeedKmh / speedAbs;
    if (ratio < 0.8 || ratio > 1.2) {
      wheelCalibrationSamplesRef.current = [];
      setWheelDiameterCandidate(null);
      return;
    }
    const candidate = config.wheelDiameterMm * ratio;
    wheelCalibrationSamplesRef.current = [...wheelCalibrationSamplesRef.current.slice(-7), candidate];
    const samples = wheelCalibrationSamplesRef.current;
    if (samples.length >= 5) {
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const spread = (sorted[sorted.length - 1] - sorted[0]) / median;
      setWheelDiameterCandidate(spread <= 0.04 ? Math.round(median) : null);
    }
  }, [showGpsSpeed, topology, gpsFixAt, gpsSpeedAccuracy, gpsSpeedKmh, speedAbs, config.wheelDiameterMm]);

  const applyGpsWheelCalibration = useCallback(() => {
    if (wheelDiameterCandidate === null) return;
    updateConfig({ wheelDiameterMm: wheelDiameterCandidate });
    appendLog(`Калибровка спидометра по GPS: диаметр колеса ${wheelDiameterCandidate} мм. Настроено только в приборке; VESC не менялся.`);
    setWheelDiameterCandidate(null);
    wheelCalibrationSamplesRef.current = [];
  }, [appendLog, updateConfig, wheelDiameterCandidate]);

  const packVoltage =
    frontMasterTelemetry.vIn > 0 ? frontMasterTelemetry.vIn : rearSlaveTelemetry.vIn;
  const totalBattCurrent =
    frontMasterTelemetry.avgInputCurrent + rearSlaveTelemetry.avgInputCurrent;
  const totalPowerWatts = packVoltage * totalBattCurrent;
  const wheelRpm =
    frontMasterTelemetry.erpm / Math.max(1, config.polePairs * config.gearRatio);
  const avgDutyPct =
    ((frontMasterTelemetry.dutyNow + rearSlaveTelemetry.dutyNow) / (rearOnline ? 2 : 1)) *
    100;
  const fwCurrentAmps = Math.max(
    Math.abs(frontMasterTelemetry.avgId),
    Math.abs(rearSlaveTelemetry.avgId)
  );

  const latestRealtimeRef = useRef({
    speedAbs: 0,
    totalPowerWatts: 0,
    totalBattCurrent: 0,
    phasePeak: 0,
  });
  latestRealtimeRef.current = {
    speedAbs,
    totalPowerWatts,
    totalBattCurrent,
    phasePeak: Math.max(
      Math.abs(frontMasterTelemetry.avgMotorCurrent),
      Math.abs(rearSlaveTelemetry.avgMotorCurrent)
    ),
  };

  useEffect(() => {
    const statsTimer = window.setInterval(() => {
      const cur = latestRealtimeRef.current;
      const dKm = cur.speedAbs * (0.25 / 3600);

      if (cur.speedAbs > 0.4) {
        setTripDistanceKm((prev) => prev + dKm);
        setRideSeconds((prev) => prev + 0.25);
        odoAccumRef.current += dKm;
        setOdometerKm(odoAccumRef.current);
      }

      setPeaks((prev) => ({
        maxSpeedKmh: Math.max(prev.maxSpeedKmh, cur.speedAbs),
        maxPowerWatts: Math.max(prev.maxPowerWatts, cur.totalPowerWatts),
        maxPhaseAmps: Math.max(prev.maxPhaseAmps, cur.phasePeak),
        maxBattAmps: Math.max(prev.maxBattAmps, cur.totalBattCurrent),
      }));

      setPowerHistory((prev) => [...prev.slice(1), Math.round(cur.totalPowerWatts)]);
      setSpeedHistory((prev) => [...prev.slice(1), Number(cur.speedAbs.toFixed(1))]);
    }, 250);

    const persistOdo = window.setInterval(() => {
      saveTotalOdometerKm(odoAccumRef.current);
    }, 4000);

    return () => {
      window.clearInterval(statsTimer);
      window.clearInterval(persistOdo);
    };
  }, []);

  // Hybrid SOC: nonlinear resting-voltage curve, corrected by the two VESC Ah counters during a ride.
  const restV = highestIdleVoltage > 0 ? Math.max(packVoltage, highestIdleVoltage) : packVoltage;
  const cellVoltage = config.batteryCells > 0 ? packVoltage / config.batteryCells : 0;
  const rawWhTotal = frontMasterTelemetry.wattHours + rearSlaveTelemetry.wattHours;
  const regenWhTotal =
    frontMasterTelemetry.wattHoursCharged + rearSlaveTelemetry.wattHoursCharged;
  const netAhCounter =
    frontMasterTelemetry.ampHours + rearSlaveTelemetry.ampHours -
    frontMasterTelemetry.ampHoursCharged - rearSlaveTelemetry.ampHoursCharged;
  const voltageSocPct = estimateSocFromRestVoltage(
    restV,
    config.batteryCells,
    config.batteryChemistry,
    config.cutoffEndV
  );

  useEffect(() => {
    if (packVoltage < 20) return;
    const capacity = Math.max(1, config.batteryCapacityAh);
    const anchor = socAnchorRef.current;
    if (!anchor || Math.abs(netAhCounter - anchor.netAh) > capacity * 1.5) {
      socAnchorRef.current = { netAh: netAhCounter, percent: voltageSocPct };
    }
  }, [packVoltage, netAhCounter, voltageSocPct, config.batteryCapacityAh]);

  const socAnchor = socAnchorRef.current;
  const coulombSocPct = socAnchor
    ? socAnchor.percent - ((netAhCounter - socAnchor.netAh) / Math.max(1, config.batteryCapacityAh)) * 100
    : voltageSocPct;
  const batteryPct = packVoltage < 10
    ? 0
    : Math.round(Math.max(0, Math.min(100, coulombSocPct * 0.8 + voltageSocPct * 0.2)));
  const sagDelta = Math.max(0, restV - packVoltage);

  const netWhTrip = Math.max(0, rawWhTotal - regenWhTotal - tripStartWh);
  const dynamicWhPerKm =
    tripDistanceKm > 0.15
      ? Math.max(14, Math.min(120, netWhTrip / tripDistanceKm))
      : 30.0;
  const usablePackWh = config.batteryCells * 3.7 * config.batteryCapacityAh * (batteryPct / 100);
  const estimatedRangeKm = usablePackWh / dynamicWhPerKm;
  const rideDurationText = formatDuration(rideSeconds);

  const computerMetrics: ComputedComputerMetrics = {
    packVoltage,
    restVoltageEstimate: restV,
    voltageSag: sagDelta,
    cutoffStartV: config.cutoffStartV,
    cutoffEndV: config.cutoffEndV,
    cellCount: config.batteryCells,
    cellVoltage,
    batteryPct,
    maxBatteryAmpsCap: limit25Override
      ? 18
      : Math.min(config.perEscBatteryAmps * 2, activeProfile?.maxBattAmps ?? 94),
    estimatedRangeKm,
    whPerKm: dynamicWhPerKm,
    tripDistanceKm,
    odometerKm,
    rideDurationText,
    totalPowerWatts,
    totalBattCurrent,
    netWhUsed: netWhTrip,
    regenWh: regenWhTotal,
    maxSpeedKmh: peaks.maxSpeedKmh,
    maxPowerWatts: peaks.maxPowerWatts,
    maxPhaseAmps: peaks.maxPhaseAmps,
    maxBattAmps: peaks.maxBattAmps,
    fetWarnTempC: config.fetWarnTempC,
    motorWarnTempC: config.motorWarnTempC,
    powerHistory,
    speedHistory,
    drag: dragStats,
  };

  const resetTripComputer = () => {
    setTripDistanceKm(0);
    setRideSeconds(0);
    setTripStartWh(rawWhTotal - regenWhTotal);
    setPeaks({
      maxSpeedKmh: 0,
      maxPowerWatts: 0,
      maxPhaseAmps: 0,
      maxBattAmps: 0,
    });
  };

  const anyFault =
    frontMasterTelemetry.faultCode !== 0 || rearSlaveTelemetry.faultCode !== 0;
  const faultSummary = [
    frontMasterTelemetry.faultCode !== 0
      ? `ID0 ПЕРЕД: ${frontMasterTelemetry.faultText}`
      : '',
    rearSlaveTelemetry.faultCode !== 0
      ? `ID1 ЗАД: ${rearSlaveTelemetry.faultText}`
      : '',
  ]
    .filter(Boolean)
    .join(' • ');

  const systemAlerts: { level: 'warning' | 'error'; text: string }[] = [];
  if (errorBanner) systemAlerts.push({ level: 'error', text: errorBanner });
  if (routeIssue) systemAlerts.push({ level: 'warning', text: routeIssue });
  if (showGpsSpeed && gpsSpeedIssue) systemAlerts.push({ level: 'warning', text: gpsSpeedIssue });
  if (wakeLockState === 'unsupported') {
    systemAlerts.push({ level: 'warning', text: 'Браузер не поддерживает блокировку сна экрана.' });
  } else if (wakeLockState === 'blocked') {
    systemAlerts.push({ level: 'warning', text: 'Не удалось удержать экран включённым. Оставьте страницу открытой и коснитесь экрана.' });
  }
  if (anyFault) systemAlerts.push({ level: 'error', text: faultSummary });
  if (packVoltage > 0 && packVoltage <= config.cutoffEndV) {
    systemAlerts.push({ level: 'error', text: `Критически низкое напряжение АКБ: ${packVoltage.toFixed(1)} В.` });
  } else if (packVoltage > 0 && packVoltage <= config.cutoffStartV) {
    systemAlerts.push({ level: 'warning', text: `Низкое напряжение АКБ: ${packVoltage.toFixed(1)} В (порог ${config.cutoffStartV} В).` });
  }
  const maxFetTemp = Math.max(frontMasterTelemetry.tempFet, rearSlaveTelemetry.tempFet);
  const maxMotorTemp = Math.max(frontMasterTelemetry.tempMotor, rearSlaveTelemetry.tempMotor);
  if (maxFetTemp >= config.fetWarnTempC + 20) {
    systemAlerts.push({ level: 'error', text: `Перегрев MOSFET: ${maxFetTemp.toFixed(0)}°C.` });
  } else if (maxFetTemp >= config.fetWarnTempC) {
    systemAlerts.push({ level: 'warning', text: `Высокая температура MOSFET: ${maxFetTemp.toFixed(0)}°C.` });
  }
  if (maxMotorTemp >= config.motorWarnTempC) {
    systemAlerts.push({ level: maxMotorTemp >= config.motorWarnTempC + 15 ? 'error' : 'warning', text: `Высокая температура мотора: ${maxMotorTemp.toFixed(0)}°C.` });
  }
  if (topology !== 'sim' && link1Name && !rearOnline) {
    systemAlerts.push({ level: 'warning', text: `Нет телеметрии заднего VESC (CAN ID ${config.canSlaveId}).` });
  }
  if (topology !== 'sim' && link1Name && frontMasterTelemetry.updatedAt > 0 && Date.now() - frontMasterTelemetry.updatedAt > 3000) {
    systemAlerts.push({ level: 'warning', text: 'Телеметрия переднего VESC не обновлялась более 3 секунд.' });
  }
  if (totalBattCurrent >= 100) {
    systemAlerts.push({ level: 'error', text: `Ток батареи превысил 100 А: ${totalBattCurrent.toFixed(1)} А.` });
  } else if (totalBattCurrent > 94) {
    systemAlerts.push({ level: 'warning', text: `Ток батареи выше рабочего пика 94 А: ${totalBattCurrent.toFixed(1)} А.` });
  }
  if (totalBattCurrent < -15) {
    systemAlerts.push({ level: 'error', text: `Рекуперация выше заданного предела −15 А: ${totalBattCurrent.toFixed(1)} А.` });
  }
  if (fwCurrentAmps > 10.5) {
    systemAlerts.push({ level: 'warning', text: `Field Weakening выше лимита 10 А: ${fwCurrentAmps.toFixed(1)} А.` });
  }
  if (packVoltage > 67.2) {
    systemAlerts.push({ level: 'warning', text: `Напряжение выше полного заряда 16S (67.2 В): ${packVoltage.toFixed(1)} В.` });
  }

  const handleSendCli = async (cmd: string) => {
    appendLog(`> ${cmd}`);
    if (topology === 'sim') {
      if (cmd === 'fault_test') {
        simRef.current.setSimulatedFault(5);
        appendLog('Сим: сработала защита OVER_TEMP_FET (#5). Введите clear для сброса.');
      } else if (cmd === 'clear') {
        simRef.current.setSimulatedFault(0);
        appendLog('Сим: ошибки сброшены.');
      } else {
        appendLog(
          'VESC 6.02 (75_100_V2) OK • ID0 Front Hall + ID1 Rear Sensorless • FW 10A @ 0.90'
        );
      }
      return;
    }
    if (link1Ref.current?.isConnected()) {
      await link1Ref.current.sendPayload(payloadTerminalCmd(cmd));
    }
  };

  if (hudMode) {
    return (
      <HudView
        speedKmh={speedSigned}
        recordedSpeedKmh={topology === 'sim' || link1Name ? Math.abs(speedSigned) : undefined}
        accelerationTimes={dragStats.bestTimes}
        frontLevel={frontIndicator.level}
        rearLevel={rearIndicator.level}
        frontDetail={frontIndicator.detail}
        rearDetail={rearIndicator.detail}
        frontFetTemp={frontMasterTelemetry.tempFet}
        rearFetTemp={rearSlaveTelemetry.tempFet}
        frontMotorTemp={frontMasterTelemetry.tempMotor}
        rearMotorTemp={rearSlaveTelemetry.tempMotor}
        fetWarnTemp={config.fetWarnTempC}
        motorWarnTemp={config.motorWarnTempC}
        brakeActive={totalBattCurrent < -0.6}
        regenAmps={totalBattCurrent}
        powerKw={totalPowerWatts / 1000}
        batteryPct={computerMetrics.batteryPct}
        packVoltage={packVoltage}
        estimatedRangeKm={computerMetrics.estimatedRangeKm}
        connectionLabel={topology === 'sim' ? 'ДЕМО • НЕ ДАННЫЕ С САМОКАТА' : link1Name ? `LIVE • ${link1Name}` : 'НЕТ СВЯЗИ'}
        alerts={systemAlerts}
        mapsApiKey={YANDEX_MAPS_API_KEY}
        onRouteIssue={reportRouteIssue}
        onExit={() => {
          setHudMode(false);
          if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
        }}
      />
    );
  }

  return (
    <div className="dashboard-only min-h-screen bg-[var(--bg)] pb-4 text-[var(--fg)] selection:bg-[var(--inv-bg)] selection:text-[var(--inv-fg)]">
      {touchLocked && (
        <div className="fixed inset-x-0 bottom-14 z-40 flex items-center justify-center pointer-events-none px-4">
          <button
            type="button"
            onClick={() => setTouchLocked(false)}
            className="pointer-events-auto flex items-center gap-2 border border-[var(--fg)] bg-[var(--inv-bg)] px-5 py-2.5 text-xs font-extrabold tracking-widest uppercase text-[var(--inv-fg)] shadow-2xl cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5" />
            ЭКРАН НА РУЛЕ ЗАБЛОКИРОВАН — НАЖМИТЕ, ЧТОБЫ СНЯТЬ
          </button>
        </div>
      )}

      {/* Minimal header: the only control is the BLE connection button. */}
      <header className="border-b border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-3.5 py-3">
          <div>
            <div className="text-xs font-bold tracking-[0.16em] uppercase">ACHILLEUS • БОРТОВОЙ КОМПЬЮТЕР</div>
            <div className="mt-1 text-[10px] text-[var(--fg-muted)]">
              {topology === 'sim' ? 'ДЕМО-РЕЖИМ' : link1Name ? `СВЯЗЬ: ${link1Name}` : 'НЕТ СВЯЗИ'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="hud-control border border-[var(--fg)] bg-[var(--bg)] px-3 py-2 text-[11px] font-bold tracking-wider uppercase"
              onClick={() => {
                setHudMode(true);
                void document.documentElement.requestFullscreen?.().catch(() => {});
              }}
            >
              HUD
            </button>
            <button
              type="button"
              className="connect-control border border-[var(--fg)] bg-[var(--inv-bg)] px-3 py-2 text-[11px] font-bold tracking-wider uppercase text-[var(--inv-fg)]"
              onClick={() => {
                if (link1Name || link2Name) void disconnectAllLinks();
                else void handleConnectBleSlot(1);
              }}
            >
              {link1Name || link2Name ? 'ОТКЛЮЧИТЬ' : 'ПОДКЛЮЧИТЬ BLE'}
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-3.5 pb-2 text-[10px] leading-relaxed text-[var(--fg-muted)]">
          {browser.isIOS
            ? 'iPhone: откройте HTTPS-страницу в Bluefy. Safari и Chrome на iOS не поддерживают Web Bluetooth.'
            : 'Bluetooth LE: включите контроллер и выберите VESC BLE в системном окне браузера.'}
        </div>
      </header>

      <main
        className={`mx-auto max-w-4xl px-3.5 pt-3.5 space-y-3.5 ${
          touchLocked ? 'pointer-events-none select-none opacity-95' : ''
        }`}
      >
        <div className="flex items-center justify-between border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[10px] font-bold tracking-[0.16em] uppercase">
          <span>DUALTRON ACHILLEUS • ПРИБОРНАЯ ПАНЕЛЬ</span>
          <span className="border border-[var(--line-strong)] px-2 py-1">
            {topology === 'sim' ? 'СИМУЛЯЦИЯ' : link1Name ? 'LIVE • VESC' : 'НЕТ СВЯЗИ'}
          </span>
        </div>

        <div className="flex items-center justify-between border-x border-b border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
          <span>ЭКРАН: {wakeLockState === 'active' ? 'НЕ ГАСНЕТ' : wakeLockState === 'suspended' ? 'ОЖИДАНИЕ' : wakeLockState === 'checking' ? 'ПОДКЛЮЧЕНИЕ…' : 'ВОЗМОЖНО ВЫКЛЮЧЕНИЕ'}</span>
          <span>VESC {anyFault ? 'ОШИБКА' : (link1Name || topology === 'sim') ? 'МОНИТОРИНГ' : 'НЕ ПОДКЛЮЧЁН'}</span>
        </div>

        {systemAlerts.length > 0 && (
          <section aria-live="assertive" aria-label="Предупреждения и ошибки" className="space-y-1.5">
            {systemAlerts.map((alert, index) => (
              <div key={`${alert.level}-${index}`} role={alert.level === 'error' ? 'alert' : 'status'} className={`border px-3 py-2 text-xs font-semibold ${alert.level === 'error' ? 'border-[var(--fg)] bg-[var(--inv-bg)] text-[var(--inv-fg)]' : 'border-[var(--line-strong)] bg-[var(--bg-surface)] text-[var(--fg)]'}`}>
                {alert.level === 'error' ? 'ОШИБКА • ' : 'ВНИМАНИЕ • '}{alert.text}
              </div>
            ))}
          </section>
        )}

        {screenTab === 'dash' && (
          <>
            <HeroCluster
              metric="speed"
              speedKmh={speedSigned}
              powerWatts={totalPowerWatts}
              motorRpm={wheelRpm}
              dutyPct={avgDutyPct}
              fwCurrentAmps={fwCurrentAmps}
              perEscBattAmps={config.perEscBatteryAmps}
              maxSpeedTripKmh={peaks.maxSpeedKmh}
              tripDistanceKm={tripDistanceKm}
              rideDurationText={rideDurationText}
              isRegen={totalBattCurrent < -0.6}
              isReverse={speedSigned < -0.4}
              anyFault={anyFault}
              faultSummary={faultSummary}
              accelerationTimes={dragStats.bestTimes}
              gpsSpeedKmh={gpsSpeedKmh}
              gpsSpeedAccuracy={gpsSpeedAccuracy}
              gpsCompareSpeedKmh={topology === 'sim' ? null : speedAbs}
              gpsWheelDiameterCandidate={wheelDiameterCandidate}
              onGpsSpeedModeChange={setShowGpsSpeed}
              onApplyGpsWheelCalibration={applyGpsWheelCalibration}
              frontIndicatorLevel={frontIndicator.level}
              rearIndicatorLevel={rearIndicator.level}
              frontIndicatorDetail={frontIndicator.detail}
              rearIndicatorDetail={rearIndicator.detail}
              fontLarge={config.fontDensity === 'large'}
              showSubStats={true}
              showProfiles={false}
              tractionMode={config.tractionMode}
              onCycleTraction={handleCycleTraction}
              limit25Active={limit25Override}
              onToggleLimit25={handleToggleLimit25}
              parked={parked}
              onTogglePark={handleTogglePark}
              profiles={config.profiles}
              activeProfileId={config.activeProfileId}
              onSelectProfile={handleSelectProfile}
            />

            <WidgetGrid
              widgets={config.widgets}
              frontMaster={frontMasterTelemetry}
              rearSlave={rearSlaveTelemetry}
              frontFw={frontFw}
              rearFw={rearFw}
              frontOnline={frontOnline}
              rearOnline={rearOnline}
              masterIsFrontHall={config.masterIsFrontHall}
              tractionMode={config.tractionMode}
              canSlaveId={config.canSlaveId}
              metrics={computerMetrics}
              fontLarge={config.fontDensity === 'large'}
              editMode={false}
              onMoveWidget={(id: WidgetId, dir: -1 | 1) => {
                const enabledList = config.widgets.filter((w) => w.enabled);
                const curPos = enabledList.findIndex((w) => w.id === id);
                const targetItem = enabledList[curPos + dir];
                if (!targetItem) return;
                const full = [...config.widgets];
                const a = full.findIndex((w) => w.id === id);
                const b = full.findIndex((w) => w.id === targetItem.id);
                [full[a], full[b]] = [full[b], full[a]];
                updateConfig({ widgets: full });
              }}
              onToggleSpan={(id: WidgetId) => {
                updateConfig({
                  widgets: config.widgets.map((w) =>
                    w.id === id ? { ...w, span: w.span === 2 ? 1 : 2 } : w
                  ),
                });
              }}
              onToggleVisible={(id: WidgetId) => {
                updateConfig({
                  widgets: config.widgets.map((w) =>
                    w.id === id ? { ...w, enabled: !w.enabled } : w
                  ),
                });
              }}
              onResetTrip={resetTripComputer}
              onResetDrag={() =>
                setDragStats({
                  state: 'ready',
                  currentSec: 0,
                  best0to30Sec: null,
                  best0to50Sec: null,
                  bestTimes: emptyBestTimes(),
                })
              }
            />

            <RouteRecorder
              apiKey={YANDEX_MAPS_API_KEY}
              onIssue={reportRouteIssue}
              speedKmh={topology === 'sim' || link1Name ? Math.abs(speedSigned) : undefined}
            />
          </>
        )}

        {screenTab === 'bms_guide' && (
          <ChecklistView
            currentPerEscAmps={config.perEscBatteryAmps}
            fieldWeakeningSim={config.fieldWeakeningSim}
            onToggleFieldWeakeningSim={() =>
              updateConfig({ fieldWeakeningSim: !config.fieldWeakeningSim })
            }
            onApplyBmsStage={handleApplyBmsStage}
          />
        )}

        {screenTab === 'remote' && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-3 gap-px border border-[var(--line)] bg-[var(--line)] text-center">
              <div className="bg-[var(--bg-surface)] p-3">
                <div className="text-[10px] tracking-widest uppercase text-[var(--fg-muted)]">
                  СКОРОСТЬ
                </div>
                <div className="tabular-nums mt-0.5 text-2xl font-semibold">
                  {speedAbs.toFixed(1)}{' '}
                  <span className="text-xs font-normal text-[var(--fg-muted)]">км/ч</span>
                </div>
              </div>
              <div className="bg-[var(--bg-surface)] p-3">
                <div className="text-[10px] tracking-widest uppercase text-[var(--fg-muted)]">
                  МОЩНОСТЬ
                </div>
                <div className="tabular-nums mt-0.5 text-2xl font-semibold">
                  {(totalPowerWatts / 1000).toFixed(2)}{' '}
                  <span className="text-xs font-normal text-[var(--fg-muted)]">кВт</span>
                </div>
              </div>
              <div className="bg-[var(--bg-surface)] p-3">
                <div className="text-[10px] tracking-widest uppercase text-[var(--fg-muted)]">
                  АКБ 16S
                </div>
                <div className="tabular-nums mt-0.5 text-2xl font-semibold">
                  {packVoltage.toFixed(1)}{' '}
                  <span className="text-xs font-normal text-[var(--fg-muted)]">В</span>
                </div>
              </div>
            </div>

            <ControlPad
              layout={padLayout}
              onChangeLayout={setPadLayout}
              armed={armed && !parked}
              onToggleArm={() => {
                if (parked) setParked(false);
                setArmed((v) => !v);
              }}
              onEmergencyStop={() => {
                setArmed(false);
                zeroMotorsImmediately(true);
                appendLog('СТОП: подача снята.');
              }}
              onInputChange={(cmd) => {
                if (autoDemoRide && (Math.abs(cmd.left) > 0.02 || Math.abs(cmd.right) > 0.02)) {
                  setAutoDemoRide(false);
                }
                targetInputRef.current = cmd;
              }}
              effectiveLeftPct={displayCmdPct.left}
              effectiveRightPct={displayCmdPct.right}
            />
          </div>
        )}

        {screenTab === 'settings' && (
          <SettingsView
            config={config}
            onChangeConfig={updateConfig}
            topology={topology}
            onSwitchTopology={(t) => void switchTopology(t)}
            link1Name={link1Name}
            link2Name={link2Name}
            hasWebSerial={browser.hasWebSerial}
            filterBleOnly={filterBleOnly}
            onChangeFilterBle={setFilterBleOnly}
            discoveredCanIds={discoveredCanIds}
            onConnectBle={(slot) => void handleConnectBleSlot(slot)}
            onConnectUsb={() => void handleConnectUsb()}
            onDisconnectAll={() => void disconnectAllLinks()}
            onScanCan={() => void handleScanCan()}
            onPushProfileToHardware={(prof, persist) =>
              void pushDrivetrainConfig(
                prof,
                config.tractionMode,
                limit25Override,
                undefined,
                persist
              )
            }
            odometerKm={odometerKm}
            onResetOdometer={() => {
              odoAccumRef.current = 0;
              setOdometerKm(0);
              saveTotalOdometerKm(0);
            }}
            logs={logs}
            onSendTerminal={(cmd) => void handleSendCli(cmd)}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto grid max-w-4xl grid-cols-4 gap-px bg-[var(--line)]">
          {[
            { id: 'dash' as const, label: 'ПРИБОРКА' },
            { id: 'bms_guide' as const, label: 'ЭТАПЫ / Ч.16–23' },
            { id: 'remote' as const, label: 'ПУЛЬТ BLE' },
            { id: 'settings' as const, label: 'НАСТРОЙКИ' },
          ].map((tab) => {
            const active = screenTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={touchLocked}
                onClick={() => setScreenTab(tab.id)}
                className={`py-3.5 text-[10px] sm:text-[11px] font-bold tracking-wider uppercase transition-colors cursor-pointer disabled:opacity-40 ${
                  active
                    ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                    : 'bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
