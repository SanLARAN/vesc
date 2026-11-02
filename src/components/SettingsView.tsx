import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Radar,
  RotateCcw,
  Send,
  Upload,
} from 'lucide-react';
import {
  applyPresetWidgets,
  DashboardPresetId,
  DEFAULT_CONFIG,
  OnboardComputerConfig,
  RideProfile,
  SCOOTER_WHEEL_PRESETS,
  WidgetId,
} from '../state/dashboardConfig';

export type ConnectionTopology = 'sim' | 'can-single-ble' | 'dual-ble' | 'usb';
type SettingsSection = 'scooter' | 'profiles' | 'screen' | 'link';

interface SettingsViewProps {
  config: OnboardComputerConfig;
  onChangeConfig: (patch: Partial<OnboardComputerConfig>) => void;
  topology: ConnectionTopology;
  onSwitchTopology: (t: ConnectionTopology) => void;
  link1Name: string | null;
  link2Name: string | null;
  hasWebSerial: boolean;
  filterBleOnly: boolean;
  onChangeFilterBle: (v: boolean) => void;
  discoveredCanIds: number[];
  onConnectBle: (slot: 1 | 2) => void;
  onConnectUsb: () => void;
  onDisconnectAll: () => void;
  onScanCan: () => void;
  onPushProfileToHardware: (profile: RideProfile, persistFlash: boolean) => void;
  odometerKm: number;
  onResetOdometer: () => void;
  logs: string[];
  onSendTerminal: (cmd: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  config,
  onChangeConfig,
  topology,
  onSwitchTopology,
  link1Name,
  link2Name,
  hasWebSerial,
  filterBleOnly,
  onChangeFilterBle,
  discoveredCanIds,
  onConnectBle,
  onConnectUsb,
  onDisconnectAll,
  onScanCan,
  onPushProfileToHardware,
  odometerKm,
  onResetOdometer,
  logs,
  onSendTerminal,
}) => {
  const [section, setSection] = useState<SettingsSection>('scooter');
  const [editingProfileIdx, setEditingProfileIdx] = useState<number>(3);
  const [cliText, setCliText] = useState('');
  const [copiedJson, setCopiedJson] = useState(false);

  const selectedProfile = config.profiles[editingProfileIdx] ?? config.profiles[0];

  const updateSelectedProfile = (patch: Partial<RideProfile>) => {
    const next = config.profiles.map((p, i) =>
      i === editingProfileIdx ? { ...p, ...patch } : p
    );
    onChangeConfig({ profiles: next });
  };

  const moveWidget = (id: WidgetId, dir: -1 | 1) => {
    const idx = config.widgets.findIndex((w) => w.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= config.widgets.length) return;
    const copy = [...config.widgets];
    const [removed] = copy.splice(idx, 1);
    copy.splice(target, 0, removed);
    onChangeConfig({ widgets: copy });
  };

  const toggleWidgetProp = (id: WidgetId, prop: 'enabled' | 'span') => {
    const next = config.widgets.map((w) => {
      if (w.id !== id) return w;
      if (prop === 'enabled') return { ...w, enabled: !w.enabled };
      return { ...w, span: (w.span === 2 ? 1 : 2) as 1 | 2 };
    });
    onChangeConfig({ widgets: next });
  };

  const handleExportJson = () => {
    navigator.clipboard?.writeText(JSON.stringify(config, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleImportJson = () => {
    const raw = window.prompt('Вставьте JSON конфигурацию самоката:');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<OnboardComputerConfig>;
      onChangeConfig(parsed);
    } catch {
      window.alert('Некорректный формат JSON.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-px border border-[var(--line)] bg-[var(--line)]">
        {[
          { id: 'scooter' as const, label: 'ACHILLEUS 16S' },
          { id: 'profiles' as const, label: 'ПРОФИЛИ 1–4' },
          { id: 'screen' as const, label: 'ЭКРАН / ПЛИТКИ' },
          { id: 'link' as const, label: 'СВЯЗЬ / CLI' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`py-3 text-[10px] sm:text-[11px] font-bold tracking-wider uppercase transition-colors cursor-pointer ${
              section === tab.id
                ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                : 'bg-[var(--bg-surface)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* SECTION 1: ACHILLEUS 60V / 94A (47A x 2) HARDWARE CONFIG */}
      {section === 'scooter' && (
        <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-4 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
            <div>
              <div className="text-[11px] font-bold tracking-widest uppercase text-[var(--fg)]">
                DUALTRON ACHILLEUS • 16S 60V • BMS 100A ({config.perEscBatteryAmps}А × 2 ={' '}
                {config.perEscBatteryAmps * 2}А)
              </div>
              <div className="text-[11px] text-[var(--fg-muted)]">
                Master ID 0 = Передний МК (Hall + ADC) • Slave ID 1 = Задний МК (Sensorless CAN 500K)
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs text-[var(--fg-muted)]">Размер колеса</div>
            <div className="grid grid-cols-4 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]">
              {SCOOTER_WHEEL_PRESETS.map((tire) => (
                <button
                  key={tire.mm}
                  type="button"
                  onClick={() => onChangeConfig({ wheelDiameterMm: tire.mm })}
                  className={`py-2.5 text-[11px] font-bold cursor-pointer ${
                    config.wheelDiameterMm === tire.mm
                      ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                      : 'bg-[var(--bg)] text-[var(--fg-muted)]'
                  }`}
                >
                  {tire.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">
                  Battery Current Max на КАЖДЫЙ VESC (Ч.20.3)
                </span>
                <span className="tabular-nums font-bold">
                  {config.perEscBatteryAmps} А (суммарно {config.perEscBatteryAmps * 2} А)
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={50}
                step={1}
                value={config.perEscBatteryAmps}
                onChange={(e) =>
                  onChangeConfig({ perEscBatteryAmps: Number(e.target.value) })
                }
                className="mono-range mt-2.5 w-full"
              />
              <div className="mt-1 text-[10px] text-[var(--fg-faint)]">
                Старт 30А → 35А → 40А → Оптимум 45А → Максимум 47А (94А под BMS Achilleus 100A)
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">
                  Баланс тяги Переднего МК (ID 0 Hall)
                </span>
                <span className="tabular-nums font-bold">
                  Перед {config.frontTorqueRatioPct}% / Зад 100%
                </span>
              </div>
              <input
                type="range"
                min={40}
                max={100}
                step={5}
                value={config.frontTorqueRatioPct}
                onChange={(e) =>
                  onChangeConfig({ frontTorqueRatioPct: Number(e.target.value) })
                }
                className="mono-range mt-2.5 w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">
                  Motor Current Max (фазный ток МК, Ч.16.4)
                </span>
                <span className="tabular-nums font-bold">{config.maxCurrentAmps} А</span>
              </div>
              <input
                type="range"
                min={40}
                max={100}
                step={5}
                value={config.maxCurrentAmps}
                onChange={(e) =>
                  onChangeConfig({ maxCurrentAmps: Number(e.target.value) })
                }
                className="mono-range mt-2.5 w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">
                  Motor Current Brake Max (рекуперация, Ч.16.4)
                </span>
                <span className="tabular-nums font-bold">-{config.maxBrakeAmps} А</span>
              </div>
              <input
                type="range"
                min={10}
                max={65}
                step={5}
                value={config.maxBrakeAmps}
                onChange={(e) =>
                  onChangeConfig({ maxBrakeAmps: Number(e.target.value) })
                }
                className="mono-range mt-2.5 w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-[var(--line)] pt-4">
            <div>
              <label className="block text-[11px] text-[var(--fg-muted)]">
                Cutoff Start / End (В)
              </label>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <input
                  type="number"
                  value={config.cutoffStartV}
                  onChange={(e) =>
                    onChangeConfig({ cutoffStartV: Number(e.target.value) || 46 })
                  }
                  className="w-full border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-2 text-xs font-semibold tabular-nums"
                />
                <input
                  type="number"
                  value={config.cutoffEndV}
                  onChange={(e) =>
                    onChangeConfig({ cutoffEndV: Number(e.target.value) || 43 })
                  }
                  className="w-full border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-2 text-xs font-semibold tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[var(--fg-muted)]">Ёмкость АКБ (А·ч)</label>
              <input
                type="number"
                min={10}
                max={120}
                value={config.batteryCapacityAh}
                onChange={(e) =>
                  onChangeConfig({ batteryCapacityAh: Number(e.target.value) || 35 })
                }
                className="mt-1 w-full border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 text-xs font-semibold tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[var(--fg-muted)]">CAN ID Slave (Ч.18.7)</label>
              <input
                type="number"
                min={0}
                max={253}
                value={config.canSlaveId}
                onChange={(e) =>
                  onChangeConfig({ canSlaveId: Number(e.target.value) || 1 })
                }
                className="mt-1 w-full border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 text-xs font-semibold tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[var(--fg-muted)]">PIN-код Паркинга</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="Без PIN"
                value={config.pinCode}
                onChange={(e) =>
                  onChangeConfig({ pinCode: e.target.value.replace(/\D/g, '') })
                }
                className="mt-1 w-full border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 text-xs font-semibold tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 pt-1">
            <button
              type="button"
              onClick={() =>
                onChangeConfig({ masterIsFrontHall: !config.masterIsFrontHall })
              }
              className="border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2.5 text-xs font-semibold cursor-pointer"
            >
              {config.masterIsFrontHall
                ? 'ID0 = Перед (Hall) / ID1 = Зад'
                : 'ID0 = Зад / ID1 = Перед'}
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeConfig({ fieldWeakeningSim: !config.fieldWeakeningSim })
              }
              className={`border px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                config.fieldWeakeningSim
                  ? 'border-[var(--fg)] bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                  : 'border-[var(--line-strong)] bg-[var(--bg)]'
              }`}
            >
              FW 10A (Ч.21): {config.fieldWeakeningSim ? 'ВКЛ (93 км/ч)' : 'ВЫКЛ (80 км/ч)'}
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="flex items-center justify-center gap-1.5 border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2.5 text-xs font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              {copiedJson ? 'СКОПИРОВАНО' : 'ЭКСПОРТ JSON'}
            </button>

            <button
              type="button"
              onClick={handleImportJson}
              className="flex items-center justify-center gap-1.5 border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2.5 text-xs font-semibold cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              ИМПОРТ JSON
            </button>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--line)] pt-3 text-xs">
            <button
              type="button"
              onClick={() => onChangeConfig(DEFAULT_CONFIG)}
              className="flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-[var(--fg)] cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Сбросить к заводскому пресету Achilleus
            </button>
            <button
              type="button"
              onClick={onResetOdometer}
              className="text-[11px] text-[var(--fg-muted)] underline cursor-pointer"
            >
              Обнулить ODO ({odometerKm.toFixed(1)} км)
            </button>
          </div>
        </div>
      )}

      {/* SECTION 2: 4 CUSTOMIZABLE RIDE PROFILES */}
      {section === 'profiles' && selectedProfile && (
        <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-4 space-y-4">
          <div className="grid grid-cols-4 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]">
            {config.profiles.map((p, idx) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setEditingProfileIdx(idx)}
                className={`py-2.5 text-xs font-bold cursor-pointer ${
                  editingProfileIdx === idx
                    ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                    : 'bg-[var(--bg)] text-[var(--fg-muted)]'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-[var(--fg-muted)]">Название профиля</label>
              <input
                type="text"
                maxLength={14}
                value={selectedProfile.name}
                onChange={(e) => updateSelectedProfile({ name: e.target.value })}
                className="mt-1 w-full border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 text-xs font-semibold outline-none focus:border-[var(--fg)]"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Потолок скорости</span>
                <span className="tabular-nums font-bold">{selectedProfile.maxSpeedKmh} км/ч</span>
              </div>
              <input
                type="range"
                min={10}
                max={105}
                step={1}
                value={selectedProfile.maxSpeedKmh}
                onChange={(e) =>
                  updateSelectedProfile({ maxSpeedKmh: Number(e.target.value) })
                }
                className="mono-range mt-3 w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Лимит мощности 2WD</span>
                <span className="tabular-nums font-bold">
                  {(selectedProfile.maxWatts / 1000).toFixed(2)} кВт
                </span>
              </div>
              <input
                type="range"
                min={400}
                max={7000}
                step={200}
                value={selectedProfile.maxWatts}
                onChange={(e) => updateSelectedProfile({ maxWatts: Number(e.target.value) })}
                className="mono-range mt-3 w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Лимит тока BMS в профиле</span>
                <span className="tabular-nums font-bold">
                  {selectedProfile.maxBattAmps} А ({(selectedProfile.maxBattAmps / 2).toFixed(0)}А × 2)
                </span>
              </div>
              <input
                type="range"
                min={12}
                max={100}
                step={2}
                value={selectedProfile.maxBattAmps}
                onChange={(e) =>
                  updateSelectedProfile({ maxBattAmps: Number(e.target.value) })
                }
                className="mono-range mt-3 w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Масштаб фазного момента</span>
                <span className="tabular-nums font-bold">{selectedProfile.currentScalePct}%</span>
              </div>
              <input
                type="range"
                min={15}
                max={100}
                step={5}
                value={selectedProfile.currentScalePct}
                onChange={(e) =>
                  updateSelectedProfile({ currentScalePct: Number(e.target.value) })
                }
                className="mono-range mt-3 w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Масштаб рекуперации (-60А)</span>
                <span className="tabular-nums font-bold">{selectedProfile.brakeScalePct}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={selectedProfile.brakeScalePct}
                onChange={(e) =>
                  updateSelectedProfile({ brakeScalePct: Number(e.target.value) })
                }
                className="mono-range mt-3 w-full"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
            <button
              type="button"
              onClick={() => {
                onChangeConfig({ activeProfileId: selectedProfile.id });
                onPushProfileToHardware(selectedProfile, false);
              }}
              className="bg-[var(--inv-bg)] px-4 py-2.5 text-xs font-bold tracking-wider uppercase text-[var(--inv-fg)] cursor-pointer"
            >
              ПРИМЕНИТЬ В RAM (ID0 + ID1)
            </button>
            <button
              type="button"
              onClick={() => onPushProfileToHardware(selectedProfile, true)}
              className="border border-[var(--line-strong)] bg-[var(--bg)] px-4 py-2.5 text-xs font-semibold tracking-wider uppercase hover:border-[var(--fg)] cursor-pointer"
            >
              ЗАПИСАТЬ В ПАМЯТЬ VESC
            </button>
          </div>
        </div>
      )}

      {/* SECTION 3: SCREEN & WIDGET TILES */}
      {section === 'screen' && (
        <div className="space-y-4">
          <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs text-[var(--fg-muted)]">Палитра</div>
                <div className="grid grid-cols-2 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]">
                  {[
                    { id: 'dark' as const, label: 'НОЧЬ • OLED ЧЁРНЫЙ' },
                    { id: 'light' as const, label: 'ДЕНЬ • БЕЛЫЙ КОНТРАСТ' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onChangeConfig({ theme: t.id })}
                      className={`py-2.5 text-[11px] font-bold cursor-pointer ${
                        config.theme === t.id
                          ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                          : 'bg-[var(--bg)] text-[var(--fg-muted)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs text-[var(--fg-muted)]">Размер цифр</div>
                <div className="grid grid-cols-2 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]">
                  {[
                    { id: 'large' as const, label: 'КРУПНЫЙ (ДЛЯ РУЛЯ)' },
                    { id: 'normal' as const, label: 'КОМПАКТНЫЙ' },
                  ].map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onChangeConfig({ fontDensity: d.id })}
                      className={`py-2.5 text-[11px] font-bold cursor-pointer ${
                        config.fontDensity === d.id
                          ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                          : 'bg-[var(--bg)] text-[var(--fg-muted)]'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                {
                  key: 'showProfileBarOnDash' as const,
                  label: 'Кнопки режимов 1–4 на главном',
                  val: config.showProfileBarOnDash,
                },
                {
                  key: 'showSubStatsBar' as const,
                  label: 'Строка ПРОБЕГ / МАКС / В ПУТИ',
                  val: config.showSubStatsBar,
                },
                {
                  key: 'keepScreenAwake' as const,
                  label: 'Не гасить экран в поездке',
                  val: config.keepScreenAwake,
                },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onChangeConfig({ [t.key]: !t.val })}
                  className={`flex items-center justify-between border px-3 py-2.5 text-left text-xs cursor-pointer ${
                    t.val
                      ? 'border-[var(--fg)] bg-[var(--bg)] font-semibold'
                      : 'border-[var(--line)] bg-[var(--bg)] text-[var(--fg-muted)]'
                  }`}
                >
                  <span>{t.label}</span>
                  <span className="font-mono text-[10px]">{t.val ? 'ВКЛ' : 'ВЫКЛ'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold tracking-widest uppercase text-[var(--fg-muted)]">
                КОНСТРУКТОР ПЛИТОК ЭКРАНА
              </span>
              <div className="flex gap-1">
                {(
                  [
                    { id: 'minimal', label: 'Минимал' },
                    { id: 'scooter_pro', label: 'Achilleus ПРО' },
                    { id: 'dual_esc', label: 'Токи + FW' },
                  ] as Array<{ id: DashboardPresetId; label: string }>
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      onChangeConfig({
                        widgets: applyPresetWidgets(preset.id, config.widgets),
                      })
                    }
                    className="border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--inv-bg)] hover:text-[var(--inv-fg)] transition-colors cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-[var(--line)] border border-[var(--line)] bg-[var(--bg)]">
              {config.widgets.map((w, idx) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => toggleWidgetProp(w.id, 'enabled')}
                    className="flex flex-1 items-center gap-2.5 text-left cursor-pointer"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                        w.enabled
                          ? 'border-[var(--fg)] bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                          : 'border-[var(--line-strong)]'
                      }`}
                    >
                      {w.enabled && <Check className="h-3 w-3" />}
                    </span>
                    <span
                      className={w.enabled ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg-muted)]'}
                    >
                      {w.title}
                    </span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleWidgetProp(w.id, 'span')}
                      className="border border-[var(--line-strong)] px-2 py-1 font-mono text-[10px] text-[var(--fg-muted)] cursor-pointer"
                    >
                      {w.span === 2 ? '2× ШИР' : '1× ПОЛ'}
                    </button>
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveWidget(w.id, -1)}
                      className="border border-[var(--line-strong)] p-1 disabled:opacity-25 cursor-pointer"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === config.widgets.length - 1}
                      onClick={() => moveWidget(w.id, 1)}
                      className="border border-[var(--line-strong)] p-1 disabled:opacity-25 cursor-pointer"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: BLE / CAN LINK + VESC CLI */}
      {section === 'link' && (
        <div className="space-y-4">
          <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-4 space-y-4">
            <div className="text-[11px] font-bold tracking-widest uppercase text-[var(--fg)]">
              КАНАЛ СВЯЗИ С MASTER (ID 0 ПЕРЕД HALL) И SLAVE (ID 1 ЗАД CAN)
            </div>

            <div className="grid grid-cols-2 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)] sm:grid-cols-4">
              {[
                { id: 'sim' as const, label: 'СИМУЛЯТОР ACHILLEUS' },
                { id: 'can-single-ble' as const, label: 'MASTER BLE + CAN 500K' },
                { id: 'dual-ble' as const, label: '2× ПРЯМОЙ BLE' },
                ...(hasWebSerial ? [{ id: 'usb' as const, label: 'USB-C SERIAL' }] : []),
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSwitchTopology(item.id)}
                  className={`py-2.5 text-[11px] font-bold cursor-pointer ${
                    topology === item.id
                      ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                      : 'bg-[var(--bg)] text-[var(--fg-muted)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {topology !== 'dual-ble' && topology !== 'usb' && (
                <button
                  type="button"
                  onClick={() => onConnectBle(1)}
                  className="bg-[var(--inv-bg)] px-4 py-2.5 text-xs font-bold uppercase text-[var(--inv-fg)] cursor-pointer"
                >
                  {link1Name ? `MASTER: ${link1Name}` : 'ПОДКЛЮЧИТЬ MASTER ID 0 (BLE)'}
                </button>
              )}

              {topology === 'dual-ble' && (
                <>
                  <button
                    type="button"
                    onClick={() => onConnectBle(1)}
                    className="bg-[var(--inv-bg)] px-4 py-2.5 text-xs font-bold uppercase text-[var(--inv-fg)] cursor-pointer"
                  >
                    {link1Name ? `ID0: ${link1Name}` : '1. MASTER ID 0 (ПЕРЕД)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onConnectBle(2)}
                    className="border border-[var(--fg)] bg-[var(--bg)] px-4 py-2.5 text-xs font-bold uppercase cursor-pointer"
                  >
                    {link2Name ? `ID1: ${link2Name}` : '2. SLAVE ID 1 (ЗАД)'}
                  </button>
                </>
              )}

              {topology === 'usb' && (
                <button
                  type="button"
                  onClick={onConnectUsb}
                  className="bg-[var(--inv-bg)] px-4 py-2.5 text-xs font-bold uppercase text-[var(--inv-fg)] cursor-pointer"
                >
                  {link1Name ? link1Name : 'ОТКРЫТЬ USB-C (115200)'}
                </button>
              )}

              <button
                type="button"
                onClick={onScanCan}
                className="flex items-center gap-1.5 border border-[var(--line-strong)] bg-[var(--bg)] px-3.5 py-2.5 text-xs font-semibold uppercase cursor-pointer"
              >
                <Radar className="h-3.5 w-3.5" />
                ПРОВЕРИТЬ CAN (Ч.19){' '}
                {discoveredCanIds.length > 0 ? `[ID: ${discoveredCanIds.join(',')}]` : ''}
              </button>

              {(link1Name || link2Name) && (
                <button
                  type="button"
                  onClick={onDisconnectAll}
                  className="border border-[var(--line-strong)] px-3 py-2.5 text-xs text-[var(--fg-muted)] cursor-pointer"
                >
                  ОТКЛЮЧИТЬ
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <input
                type="checkbox"
                checked={filterBleOnly}
                onChange={(e) => onChangeFilterBle(e.target.checked)}
              />
              Показывать только VESC / Flipsky / NUS устройства
            </label>
          </div>

          <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-4 space-y-3">
            <div className="text-[11px] font-bold tracking-widest uppercase text-[var(--fg-muted)]">
              ТЕРМИНАЛ VESC CLI (ПРОВЕРКА FAULTS / HW_STATUS)
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!cliText.trim()) return;
                onSendTerminal(cliText.trim());
                setCliText('');
              }}
              className="flex gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]"
            >
              <input
                type="text"
                value={cliText}
                onChange={(e) => setCliText(e.target.value)}
                placeholder="Команда VESC (faults, ping, hw_status | в демо: fault_test / clear)"
                className="flex-1 bg-[var(--bg)] px-3 py-2 text-xs text-[var(--fg)] placeholder:text-[var(--fg-faint)] outline-none"
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 bg-[var(--inv-bg)] px-4 py-2 text-xs font-bold uppercase text-[var(--inv-fg)] cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" /> ВВОД
              </button>
            </form>

            <div className="h-44 overflow-y-auto border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--fg-muted)]">
              {logs.map((line, i) => (
                <div key={i} className="py-0.5">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
