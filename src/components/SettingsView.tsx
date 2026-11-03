import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Radar,
} from 'lucide-react';
import {
  applyPresetWidgets,
  DashboardPresetId,
  OnboardComputerConfig,
  RideProfile,
  WidgetId,
} from '../state/dashboardConfig';

export type ConnectionTopology = 'sim' | 'can-single-ble' | 'dual-ble' | 'usb';
type SettingsSection = 'profiles' | 'screen' | 'link';

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
  logs: string[];
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
  logs,
}) => {
  const [section, setSection] = useState<SettingsSection>('screen');
  const [editingProfileIdx, setEditingProfileIdx] = useState<number>(3);

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


  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-px border border-[var(--line)] bg-[var(--line)]">
        {[
          { id: 'profiles' as const, label: 'ПРОФИЛИ 1–4' },
          { id: 'screen' as const, label: 'ЭКРАН / ПЛИТКИ' },
          { id: 'link' as const, label: 'СВЯЗЬ' },
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

      <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--fg-muted)]">
        Аппаратные лимиты VESC здесь отключены, чтобы исключить случайную запись конфигурации. Оформление и источник скорости меняются во вкладке «ЭКРАН / ПЛИТКИ».
      </div>

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

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
            <button
              type="button"
              onClick={() => onChangeConfig({ activeProfileId: selectedProfile.id })}
              className="bg-[var(--inv-bg)] px-4 py-2.5 text-xs font-bold tracking-wider uppercase text-[var(--inv-fg)] cursor-pointer"
            >
              СОХРАНИТЬ ПРОФИЛЬ В ПРИЛОЖЕНИИ
            </button>
            <span className="text-[10px] text-[var(--fg-faint)]">Профиль задаёт пределы команд приложения; записи конфигурации VESC отключены.</span>
          </div>
        </div>
      )}

      {/* SECTION 3: SCREEN & WIDGET TILES */}
      {section === 'screen' && (
        <div className="space-y-4">
          <div className="border border-[var(--line)] bg-[var(--bg-surface)] p-4 space-y-4">
            <div>
              <div className="mb-1.5 text-xs text-[var(--fg-muted)]">Интерфейс спидометра</div>
              <div className="mb-2 text-[10px] text-[var(--fg-faint)]">Только оформление экрана — ничего не отправляет в контроллеры.</div>
              <div className="grid grid-cols-2 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]">
                {[
                  { id: 'classic' as const, label: 'КЛАССИЧЕСКИЙ', hint: 'Чистый монохромный' },
                  { id: 'cyberpunk' as const, label: 'КИБЕРПАНК', hint: 'Красный неон · широкая панель' },
                ].map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    aria-pressed={config.speedometerStyle === style.id}
                    onClick={() => onChangeConfig({ speedometerStyle: style.id })}
                    className={`flex flex-col gap-1 px-3 py-3 text-left cursor-pointer ${
                      config.speedometerStyle === style.id
                        ? style.id === 'cyberpunk'
                          ? 'bg-[#18070b] text-[#ff5265]'
                          : 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                        : 'bg-[var(--bg)] text-[var(--fg-muted)]'
                    }`}
                  >
                    <span className="text-[11px] font-bold tracking-wider">{style.label}</span>
                    <span className="text-[9px] opacity-70">{style.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs text-[var(--fg-muted)]">Источник скорости спидометра</div>
              <div className="mb-2 text-[10px] text-[var(--fg-faint)]">GPS может показывать «—» до появления точного сигнала; скорость VESC доступна при подключённом контроллере.</div>
              <div className="grid grid-cols-2 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)]">
                {[
                  { id: 'vesc' as const, label: 'VESC', hint: 'Скорость по оборотам колеса' },
                  { id: 'gps' as const, label: 'GPS', hint: 'Скорость приёмника геолокации' },
                ].map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    aria-pressed={config.speedSource === source.id}
                    onClick={() => onChangeConfig({ speedSource: source.id })}
                    className={`flex flex-col gap-1 px-3 py-3 text-left cursor-pointer ${config.speedSource === source.id ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]' : 'bg-[var(--bg)] text-[var(--fg-muted)]'}`}
                  >
                    <span className="text-[11px] font-bold tracking-wider">{source.label}</span>
                    <span className="text-[9px] opacity-70">{source.hint}</span>
                  </button>
                ))}
              </div>
            </div>

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

      {/* SECTION 4: BLE / CAN LINK */}
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
              ЖУРНАЛ ТЕЛЕМЕТРИИ
            </div>
            <div className="text-[10px] text-[var(--fg-faint)]">Свободная отправка команд VESC CLI отключена.</div>
            <div className="h-44 overflow-y-auto border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--fg-muted)]">
              {logs.map((line, i) => (
                <div key={i} className="py-0.5">{line}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
