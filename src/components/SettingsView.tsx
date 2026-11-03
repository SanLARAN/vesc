import { ReactElement, ReactNode, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bluetooth,
  BookOpen,
  Cable,
  ChevronDown,
  Download,
  Link2,
  MonitorSmartphone,
  RotateCcw,
  Satellite,
  Sparkles,
  Unplug,
  Wrench,
} from 'lucide-react';
import type { VescSession } from '../hooks/useVescSession';
import { detectBrowserSupport } from '../protocol/vescTransport';
import type { RideSnapshot } from '../state/rideEngine';
import {
  ConnectionTopology,
  OnboardComputerConfig,
  SCOOTER_WHEEL_PRESETS,
  WIDGET_TITLES,
} from '../state/dashboardConfig';
import { ChecklistView } from './ChecklistView';
import { fmt, NumberField, Notice, Row, Segmented, Sheet, Toggle } from './ui';

interface Props {
  session: VescSession;
  snap: RideSnapshot;
  cfg: OnboardComputerConfig;
  updateConfig: (patch: Partial<OnboardComputerConfig>) => void;
  resetConfig: () => void;
  onResetTrip: () => void;
  onResetDrag: () => void;
  onSetOdometer: (km: number) => void;
  onResetCalibration: () => void;
}

const TOPOLOGIES: { id: ConnectionTopology; title: string; text: string; icon: ReactElement }[] = [
  { id: 'can-single-ble', title: '1 BLE + CAN', text: 'Модуль на master-VESC, второй опрашивается по CAN. Рекомендуется.', icon: <Bluetooth size={18} /> },
  { id: 'dual-ble', title: '2 × BLE', text: 'Свой модуль на каждом VESC, подключаются по очереди.', icon: <Link2 size={18} /> },
  { id: 'usb', title: 'USB (OTG)', text: 'Кабель к master-VESC. Chrome на Android или ПК.', icon: <Cable size={18} /> },
  { id: 'sim', title: 'Демо', text: 'Два виртуальных 75100 на FW 6.05 — можно проверить всё, включая FW.', icon: <Sparkles size={18} /> },
];

function Section({ title, icon, children, defaultOpen = true }: { title: string; icon: ReactElement; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card overflow-hidden">
      <button type="button" className="flex w-full items-center justify-between gap-2 p-4" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="card-title flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        <ChevronDown size={16} className={`text-[var(--fg-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function ConnectionSection({ session, cfg, updateConfig }: Props) {
  const support = useMemo(() => detectBrowserSupport(), []);
  const [topo, setTopo] = useState<ConnectionTopology>(cfg.lastTopology);
  const [showLogs, setShowLogs] = useState(false);
  const active = session.phase !== 'idle';
  const needsBle = topo === 'can-single-ble' || topo === 'dual-ble';
  const unsupported =
    (needsBle && !support.hasWebBluetooth) || (topo === 'usb' && !support.hasWebSerial)
      ? topo === 'usb'
        ? 'Web Serial недоступен: нужен Chrome/Edge на Android или ПК.'
        : support.isIOS
          ? 'Safari на iPhone не умеет Bluetooth для сайтов. Откройте приборку в браузере Bluefy.'
          : 'Web Bluetooth недоступен: откройте страницу в Chrome на Android.'
      : !support.isSecureContext && topo !== 'sim'
        ? 'Bluetooth и USB работают только по HTTPS.'
        : null;

  return (
    <Section title="Подключение" icon={<Bluetooth size={13} />}>
      <div className="grid grid-cols-2 gap-2">
        {TOPOLOGIES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={topo === t.id}
            onClick={() => setTopo(t.id)}
            className="flex flex-col items-start gap-1.5 border p-3 text-left transition-colors"
            style={{
              borderColor: topo === t.id ? 'var(--fg)' : 'var(--line-strong)',
              background: topo === t.id ? 'var(--surface-2)' : 'transparent',
            }}
          >
            <span style={{ color: topo === t.id ? 'rgb(var(--accent-rgb))' : 'var(--fg-muted)' }}>{t.icon}</span>
            <span className="text-[13.5px] font-semibold">{t.title}</span>
            <span className="text-[11.5px] leading-snug text-[var(--fg-muted)]">{t.text}</span>
          </button>
        ))}
      </div>

      {(topo === 'can-single-ble' || topo === 'usb') && (
        <div className="mt-3 divide-y divide-[var(--line)]">
          <Row label="Модуль/кабель на переднем VESC" hint="Выключите, если master — задний контроллер.">
            <Toggle label="Master спереди" checked={cfg.masterIsFrontHall} onChange={(v) => updateConfig({ masterIsFrontHall: v })} />
          </Row>
          <Row label="CAN ID второго VESC" hint={session.canIds ? `На шине найдено: ${session.canIds.join(', ') || 'никого'}` : 'Обычно 1. Если не ответит — приборка сама поищет.'}>
            <NumberField label="CAN ID" value={cfg.canSlaveId} min={0} max={253} onCommit={(v) => updateConfig({ canSlaveId: v })} className="w-24" />
          </Row>
        </div>
      )}

      {unsupported && (
        <div className="mt-3">
          <Notice tone="warn">{unsupported}</Notice>
        </div>
      )}
      {session.error && (
        <div className="mt-3">
          <Notice tone="bad">{session.error}</Notice>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {active && session.needsSecond && (
          <button type="button" className="btn btn-primary" onClick={() => void session.connectSecond()}>
            <Bluetooth size={16} /> Подключить задний VESC
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={session.phase === 'connecting' || session.phase === 'syncing' || unsupported !== null}
            onClick={() => {
              updateConfig({ lastTopology: topo });
              void session.connect(topo);
            }}
          >
            {active ? 'Переподключить' : 'Подключить'}
          </button>
          {active && (
            <button type="button" className="btn" onClick={() => void session.disconnect()}>
              <Unplug size={16} /> Отключить
            </button>
          )}
        </div>
        {session.devices.length > 0 && (
          <div className="text-center text-[11.5px] text-[var(--fg-muted)]">Устройства: {session.devices.join(', ')}</div>
        )}
      </div>

      <button type="button" className="mt-3 text-[12px] font-semibold text-[var(--fg-muted)] underline-offset-2 hover:underline" onClick={() => setShowLogs(!showLogs)}>
        {showLogs ? 'Скрыть журнал' : `Журнал связи (${session.logs.length})`}
      </button>
      {showLogs && (
        <div className="mt-2 max-h-64 overflow-y-auto border border-[var(--line)] bg-[var(--surface)] p-2 font-mono text-[11px] leading-relaxed">
          {session.logs.length === 0 && <div className="p-2 text-[var(--fg-faint)]">Пусто</div>}
          {[...session.logs].reverse().map((l) => (
            <div key={l.id} className="flex gap-2 px-1">
              <span className="shrink-0 text-[var(--fg-faint)]">{new Date(l.at).toLocaleTimeString('ru-RU')}</span>
              <span style={{ color: l.level === 'error' ? 'var(--bad)' : l.level === 'warn' ? 'var(--warn)' : 'var(--fg)' }}>{l.text}</span>
            </div>
          ))}
          {session.logs.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm mt-2 w-full" onClick={session.clearLogs}>
              Очистить журнал
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

interface Proposal {
  key: keyof OnboardComputerConfig;
  label: string;
  value: number | string;
  shown: string;
  ok: boolean;
  note?: string;
}

function VehicleSection({ session, snap, cfg, updateConfig, onResetCalibration }: Props) {
  const [fromVesc, setFromVesc] = useState<Proposal[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const src = session.controllers.front.values ?? session.controllers.rear.values;
  const num = (label: string, key: keyof OnboardComputerConfig, min: number, max: number, unit: string, step = 1, hint?: string) => (
    <Row label={label} hint={hint}>
      <NumberField label={label} value={cfg[key] as number} min={min} max={max} step={step} unit={unit} onCommit={(v) => updateConfig({ [key]: v })} className="w-32" />
    </Row>
  );

  const openFromVesc = () => {
    if (!src) return;
    const list: Proposal[] = [
      { key: 'polePairs', label: 'Пар полюсов', value: src.si_motor_poles / 2, shown: `${src.si_motor_poles / 2}`, ok: src.si_motor_poles >= 2 && src.si_motor_poles % 2 === 0 },
      {
        key: 'wheelDiameterMm',
        label: 'Диаметр колеса',
        value: Math.round(src.si_wheel_diameter * 1000),
        shown: `${Math.round(src.si_wheel_diameter * 1000)} мм`,
        ok: src.si_wheel_diameter >= 0.15 && src.si_wheel_diameter <= 0.8,
        note: src.si_wheel_diameter < 0.15 ? 'похоже, не настроено в VESC Tool' : undefined,
      },
      { key: 'gearRatio', label: 'Передаточное число', value: src.si_gear_ratio, shown: `${src.si_gear_ratio}`, ok: src.si_gear_ratio > 0 },
      { key: 'batteryCells', label: 'Ячеек последовательно', value: src.si_battery_cells, shown: `${src.si_battery_cells}S`, ok: src.si_battery_cells >= 3 && src.si_battery_cells <= 32 },
      { key: 'batteryCapacityAh', label: 'Ёмкость', value: src.si_battery_ah, shown: `${src.si_battery_ah.toFixed(1)} Ач`, ok: src.si_battery_ah >= 1 && src.si_battery_ah <= 200 },
      { key: 'batteryChemistry', label: 'Химия', value: src.si_battery_type === 1 ? 'lifepo4' : 'liion', shown: src.si_battery_type === 1 ? 'LiFePO4' : 'Li-ion', ok: src.si_battery_type <= 1 },
      { key: 'cutoffStartV', label: 'Срез тока с', value: src.l_battery_cut_start, shown: `${src.l_battery_cut_start.toFixed(1)} В`, ok: src.l_battery_cut_start > 5 },
      { key: 'cutoffEndV', label: 'Полный срез', value: src.l_battery_cut_end, shown: `${src.l_battery_cut_end.toFixed(1)} В`, ok: src.l_battery_cut_end > 5 },
      { key: 'fetWarnTempC', label: 'Предупр. темп. VESC', value: Math.round(src.l_temp_fet_start - 10), shown: `${Math.round(src.l_temp_fet_start - 10)}° (старт −10°)`, ok: src.l_temp_fet_start > 50 },
      { key: 'motorWarnTempC', label: 'Предупр. темп. мотора', value: Math.round(src.l_temp_motor_start - 10), shown: `${Math.round(src.l_temp_motor_start - 10)}° (старт −10°)`, ok: src.l_temp_motor_start > 50 },
      { key: 'perEscBatteryAmps', label: 'Ток АКБ на VESC', value: Math.round(src.l_in_current_max), shown: `${Math.round(src.l_in_current_max)} А`, ok: src.l_in_current_max > 1 },
    ];
    setFromVesc(list);
    setPicked(new Set(list.filter((p) => p.ok).map((p) => p.key)));
  };

  const cal = snap.calibration;

  return (
    <Section title="Самокат" icon={<Wrench size={13} />}>
      <button type="button" className="btn mb-2 w-full" disabled={!src} onClick={openFromVesc}>
        <Download size={15} /> {src ? 'Взять параметры из VESC' : 'Параметры из VESC — после подключения'}
      </button>
      <div className="divide-y divide-[var(--line)]">
        {num('Пар полюсов мотора', 'polePairs', 1, 100, 'пар', 1, 'Achilleus / 11″ хабы — обычно 15 (30 магнитов).')}
        <Row label="Диаметр колеса" hint="Скорость, пробег и лимиты скорости считаются от него.">
          <NumberField label="Диаметр колеса" value={cfg.wheelDiameterMm} min={80} max={800} unit="мм" onCommit={(v) => updateConfig({ wheelDiameterMm: v })} className="w-32" />
        </Row>
        <div className="flex flex-wrap gap-1.5 pb-3">
          {SCOOTER_WHEEL_PRESETS.map((w) => (
            <button key={w.mm} type="button" className={`chip ${cfg.wheelDiameterMm === w.mm ? 'chip-accent' : ''}`} onClick={() => updateConfig({ wheelDiameterMm: w.mm })}>
              {w.label}
            </button>
          ))}
        </div>
        <Row
          label="Калибровка по GPS"
          hint={
            cal.suggestedMm
              ? `GPS/колесо = ${cal.ratio.toFixed(3)} → ${cal.suggestedMm} мм (${cal.samples} замеров)`
              : `Проедьте ровно 15+ км/ч с хорошим GPS (${cal.samples}/60 замеров).`
          }
        >
          <div className="flex gap-1.5">
            <button type="button" className="icon-btn h-9 w-9" aria-label="Сбросить калибровку" onClick={onResetCalibration}>
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!cal.suggestedMm || Math.abs((cal.suggestedMm ?? 0) - cfg.wheelDiameterMm) < 2}
              onClick={() => {
                if (cal.suggestedMm) {
                  updateConfig({ wheelDiameterMm: cal.suggestedMm });
                  onResetCalibration();
                }
              }}
            >
              <Satellite size={14} /> Применить
            </button>
          </div>
        </Row>
        {num('Передаточное число', 'gearRatio', 0.1, 50, ':1', 0.01, 'Мотор-колесо = 1.')}
        <Row label="Химия АКБ">
          <Segmented
            value={cfg.batteryChemistry}
            onChange={(v) => updateConfig({ batteryChemistry: v })}
            options={[
              { value: 'liion', label: 'Li-ion' },
              { value: 'lifepo4', label: 'LiFePO4' },
            ]}
            className="w-44"
          />
        </Row>
        {num('Ячеек последовательно', 'batteryCells', 3, 32, 'S')}
        {num('Ёмкость АКБ', 'batteryCapacityAh', 1, 200, 'Ач', 0.5)}
        {num('Срез тока с', 'cutoffStartV', 5, 150, 'В', 0.1, 'Как battery cutoff start в VESC.')}
        {num('Полный срез', 'cutoffEndV', 5, 150, 'В', 0.1)}
        {num('Предупреждение: VESC', 'fetWarnTempC', 40, 130, '°C')}
        {num('Предупреждение: мотор', 'motorWarnTempC', 40, 180, '°C')}
        {num('Норма расхода', 'typicalWhPerKm', 5, 150, 'Вт·ч/км', 1, 'Для запаса хода, пока нет статистики поездки.')}
        {num('Этап BMS: ток на VESC', 'perEscBatteryAmps', 5, 300, 'А', 1, 'Приборка предупредит, если ток АКБ выше.')}
      </div>

      <Sheet
        open={fromVesc !== null}
        onClose={() => setFromVesc(null)}
        title="Параметры из VESC"
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={picked.size === 0}
              onClick={() => {
                const patch: Record<string, unknown> = {};
                for (const p of fromVesc ?? []) if (picked.has(p.key)) patch[p.key] = p.value;
                updateConfig(patch as Partial<OnboardComputerConfig>);
                setFromVesc(null);
              }}
            >
              Применить ({picked.size})
            </button>
            <button type="button" className="btn flex-1" onClick={() => setFromVesc(null)}>
              Отмена
            </button>
          </>
        }
      >
        <div className="divide-y divide-[var(--line)]">
          {(fromVesc ?? []).map((p) => (
            <label key={p.key} className="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[rgb(var(--accent-rgb))]"
                checked={picked.has(p.key)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(p.key);
                  else next.delete(p.key);
                  setPicked(next);
                }}
              />
              <span className="flex-1 text-[13.5px]">
                {p.label}
                {p.note && <span className="block text-[11.5px] text-[var(--warn)]">{p.note}</span>}
              </span>
              <span className="num text-[13.5px] font-semibold">{p.shown}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-[var(--fg-muted)]">Берётся из настроек (App/Motor → Setup) переднего контроллера.</p>
      </Sheet>
    </Section>
  );
}

function DisplaySection({ cfg, updateConfig }: Props) {
  const move = (i: number, d: -1 | 1) => {
    const list = [...cfg.widgets];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    updateConfig({ widgets: list });
  };
  return (
    <Section title="Экран" icon={<MonitorSmartphone size={13} />}>
      <div className="divide-y divide-[var(--line)]">
        <Row label="Тема">
          <Segmented
            value={cfg.theme}
            onChange={(v) => updateConfig({ theme: v })}
            options={[
              { value: 'dark', label: 'Тёмная' },
              { value: 'light', label: 'Светлая' },
            ]}
            className="w-48"
          />
        </Row>
        <Row label="Источник скорости" hint="GPS полезен при пробуксовке и для проверки колеса.">
          <Segmented
            value={cfg.speedSource}
            onChange={(v) => updateConfig({ speedSource: v })}
            options={[
              { value: 'vesc', label: 'VESC' },
              { value: 'gps', label: 'GPS' },
            ]}
            className="w-40"
          />
        </Row>
        <Row label="Не гасить экран" hint="Wake Lock, пока открыта приборка.">
          <Toggle label="Не гасить экран" checked={cfg.keepScreenAwake} onChange={(v) => updateConfig({ keepScreenAwake: v })} />
        </Row>
        <Row label="Заставка при запуске">
          <Toggle label="Заставка" checked={cfg.showSplash} onChange={(v) => updateConfig({ showSplash: v })} />
        </Row>
      </div>
      <div className="label mb-1 mt-4">Виджеты приборки</div>
      <div className="divide-y divide-[var(--line)]">
        {cfg.widgets.map((w, i) => (
          <div key={w.id} className="flex items-center gap-2 py-2">
            <span className="flex-1 text-[14px]">{WIDGET_TITLES[w.id]}</span>
            <button type="button" className="icon-btn h-8 w-8" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={14} />
            </button>
            <button type="button" className="icon-btn h-8 w-8" aria-label="Ниже" disabled={i === cfg.widgets.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={14} />
            </button>
            <Toggle
              label={WIDGET_TITLES[w.id]}
              checked={w.enabled}
              onChange={(v) => updateConfig({ widgets: cfg.widgets.map((x) => (x.id === w.id ? { ...x, enabled: v } : x)) })}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function DataSection({ snap, resetConfig, onResetTrip, onResetDrag, onSetOdometer }: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <Section title="Данные" icon={<RotateCcw size={13} />} defaultOpen={false}>
      <div className="divide-y divide-[var(--line)]">
        <Row label="Одометр" hint="Можно выставить по родному одометру самоката.">
          <NumberField label="Одометр" value={Number(snap.odometerKm.toFixed(1))} min={0} max={1000000} step={0.1} unit="км" onCommit={onSetOdometer} className="w-36" />
        </Row>
        <Row label="Текущая поездка" hint={`${fmt(snap.trip.distanceKm, 2)} км`}>
          <button type="button" className="btn btn-sm" onClick={onResetTrip}>
            Сбросить
          </button>
        </Row>
        <Row label="Рекорды разгона">
          <button type="button" className="btn btn-sm" onClick={onResetDrag}>
            Сбросить
          </button>
        </Row>
        <Row label="Все настройки приборки" hint="Режимы, параметры самоката, виджеты.">
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmReset(true)}>
            По умолчанию
          </button>
        </Row>
      </div>
      <Sheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Сбросить настройки приборки?"
        footer={
          <>
            <button
              type="button"
              className="btn btn-danger flex-1"
              onClick={() => {
                resetConfig();
                setConfirmReset(false);
              }}
            >
              Сбросить
            </button>
            <button type="button" className="btn flex-1" onClick={() => setConfirmReset(false)}>
              Отмена
            </button>
          </>
        }
      >
        <p className="text-[13.5px] text-[var(--fg-muted)]">Конфигурация самих VESC не меняется. Поездки, треки и одометр сохранятся.</p>
      </Sheet>
    </Section>
  );
}

export function SettingsView(props: Props) {
  return (
    <div className="flex flex-col gap-3">
      <ConnectionSection {...props} />
      <VehicleSection {...props} />
      <DisplaySection {...props} />
      <Section title="Сборка и BMS (Achilleus)" icon={<BookOpen size={13} />} defaultOpen={false}>
        <ChecklistView currentPerEscAmps={props.cfg.perEscBatteryAmps} />
      </Section>
      <DataSection {...props} />
      <div className="pb-2 text-center text-[11px] text-[var(--fg-faint)]">VESC Dash · {__APP_BUILD__}</div>
    </div>
  );
}
