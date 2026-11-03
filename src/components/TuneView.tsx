import { useEffect, useMemo, useState } from 'react';
import { Cpu, Flame, Lock, Pause, Pencil, Play, RefreshCw, SlidersHorizontal, TriangleAlert, Zap } from 'lucide-react';
import type { ControllerKey } from '../protocol/vescLink';
import { erpmToKmh } from '../protocol/vescProtocol';
import { fwDiffers, readFw } from '../protocol/mcconf';
import { CONTROLLER_NAMES, ControllerState, formatFw, VescSession } from '../hooks/useVescSession';
import type { RideSnapshot } from '../state/rideEngine';
import { accentForProfile, OnboardComputerConfig, RideProfile } from '../state/dashboardConfig';
import { computeLimits, selectionFromConfig } from '../state/rideModes';
import { Card, NumberField, Notice, Row, Segmented, Sheet, Slider, Toggle } from './ui';

interface Props {
  session: VescSession;
  snap: RideSnapshot;
  cfg: OnboardComputerConfig;
  updateConfig: (patch: Partial<OnboardComputerConfig>) => void;
}

type Target = 'both' | 'front' | 'rear';

const SENSOR = ['Sensorless', 'Энкодер', 'Hall', 'HFI', 'HFI start', 'HFI v2', 'HFI v3', 'HFI v4', 'HFI v5'];
const MOTOR = ['BLDC', 'DC', 'FOC', 'GPDrive'];
const PRESETS = [10, 15, 20, 30, 40];

function fwMaxFor(c: ControllerState): number {
  if (!c.values) return 60;
  return Math.max(5, Math.min(80, Math.floor(c.values.l_current_max * 0.6)));
}

function FwStatusLine({ name, c }: { name: string; c: ControllerState }) {
  if (!c.present) return <span className="text-[var(--fg-faint)]">{name}: нет связи</span>;
  if (!c.values) return <span className="text-[var(--warn)]">{name}: конфигурация не прочитана</span>;
  if (c.values.motor_type !== 2) return <span className="text-[var(--warn)]">{name}: не FOC ({MOTOR[c.values.motor_type] ?? '?'})</span>;
  const fw = readFw(c.values);
  return fw.enabled ? (
    <span>
      {name}: <b className="text-[var(--warn)]">ВКЛ {fw.currentA.toFixed(1)} А</b> с {(fw.dutyStart * 100).toFixed(0)}% duty
    </span>
  ) : (
    <span>
      {name}: <b className="text-[var(--fg-muted)]">ВЫКЛ</b>
    </span>
  );
}

function FieldWeakeningCard({ session, snap, cfg, updateConfig }: Props) {
  const { controllers } = session;
  const online = session.phase === 'online';
  const available = (['front', 'rear'] as ControllerKey[]).filter((k) => controllers[k].present && controllers[k].values);
  const [target, setTarget] = useState<Target>('both');
  const keys: ControllerKey[] = target === 'both' ? available : available.filter((k) => k === target);
  const ref = controllers[keys[0] ?? 'front'];
  const maxA = keys.length ? Math.min(...keys.map((k) => fwMaxFor(controllers[k]))) : 60;

  const [enabled, setEnabled] = useState(false);
  const [currentA, setCurrentA] = useState(cfg.fwLastOnAmps);
  const [dutyStart, setDutyStart] = useState(cfg.fwDutyStart);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Load the controller's current FW settings until the user starts editing.
  useEffect(() => {
    if (dirty || !ref.values) return;
    const fw = readFw(ref.values);
    setEnabled(fw.enabled);
    setCurrentA(fw.enabled ? Math.round(fw.currentA) : cfg.fwLastOnAmps);
    setDutyStart(fw.dutyStart < 0.99 ? Math.min(0.95, Math.max(0.6, fw.dutyStart)) : cfg.fwDutyStart);
  }, [ref.values, dirty, cfg.fwLastOnAmps, cfg.fwDutyStart]);

  const asymmetric =
    !!controllers.front.values && !!controllers.rear.values && fwDiffers(readFw(controllers.front.values), readFw(controllers.rear.values));
  const nonFoc = keys.filter((k) => controllers[k].values?.motor_type !== 2);
  const amps = Math.min(maxA, Math.max(1, currentA));
  const standstill = snap.speedKmh < 1 && session.isStandstill();
  const unchanged = keys.every((k) => {
    const v = controllers[k].values;
    if (!v) return false;
    const fw = readFw(v);
    return enabled ? fw.enabled && Math.abs(fw.currentA - amps) < 0.05 && Math.abs(fw.dutyStart - dutyStart) < 0.002 : !fw.enabled;
  });
  const busy = progress !== null;
  const lock = !online
    ? 'Нет связи с VESC'
    : keys.length === 0
      ? 'Конфигурация контроллеров не прочитана'
      : nonFoc.length
        ? `${nonFoc.map((k) => CONTROLLER_NAMES[k]).join(', ')}: мотор не в FOC`
        : !standstill
          ? 'Остановитесь: запись во flash только на месте'
          : null;

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setDirty(true);
    setResult(null);
    setter(v);
  };

  const run = async () => {
    setConfirm(false);
    setResult(null);
    setProgress('Подготовка…');
    const res = await session.writeFw({ targets: keys, enabled, currentA: amps, dutyStart }, setProgress);
    setProgress(null);
    setResult(res);
    if (res.ok) {
      setDirty(false);
      if (enabled) updateConfig({ fwLastOnAmps: amps, fwDutyStart: dutyStart });
      else updateConfig({ fwDutyStart: dutyStart });
    }
  };

  return (
    <Card
      title="Ослабление поля · FW"
      icon={<Zap size={13} />}
      right={snap.fwActive ? <span className="chip chip-warn num">работает {Math.round(snap.fwA)} А</span> : undefined}
    >
      <div className="flex flex-col gap-1 text-[12.5px] leading-snug">
        <FwStatusLine name="Перед" c={controllers.front} />
        <FwStatusLine name="Зад" c={controllers.rear} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <div>
          <div className="text-[15px] font-semibold">Field Weakening</div>
          <div className="text-[12px] text-[var(--fg-muted)]">Больше скорости сверху за счёт тока −Id</div>
        </div>
        <Toggle
          label="Ослабление поля"
          checked={enabled}
          disabled={busy}
          onChange={edit((v: boolean) => {
            setEnabled(v);
            if (v && currentA < 1) setCurrentA(cfg.fwLastOnAmps);
          })}
        />
      </div>

      <div className={`mt-4 transition-opacity ${enabled ? '' : 'pointer-events-none opacity-40'}`}>
        <div className="flex items-end justify-between">
          <div>
            <div className="label">Ток FW</div>
            <div className="num mt-1 text-[40px] font-semibold leading-none tracking-tight">
              {amps}
              <span className="ml-1 text-[14px] text-[var(--fg-faint)]">А</span>
            </div>
          </div>
          <NumberField
            label="Ток FW, А"
            value={amps}
            min={1}
            max={maxA}
            step={1}
            unit="А"
            disabled={!enabled || busy}
            onCommit={edit((v: number) => setCurrentA(v))}
            className="w-28"
          />
        </div>
        <div className="mt-2">
          <Slider label="Ток FW" value={amps} min={1} max={maxA} step={1} disabled={!enabled || busy} onChange={edit((v: number) => setCurrentA(v))} />
        </div>
        <div className="mt-1 flex gap-1.5">
          {PRESETS.filter((p) => p <= maxA).map((p) => (
            <button
              key={p}
              type="button"
              className={`chip num flex-1 justify-center ${amps === p ? 'chip-accent' : ''}`}
              disabled={!enabled || busy}
              onClick={() => edit((v: number) => setCurrentA(v))(p)}
            >
              {p} А
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[11px] text-[var(--fg-faint)]">
          Максимум {maxA} А (≈60% тока мотора{ref.values ? ` ${ref.values.l_current_max.toFixed(0)} А` : ''}). Начинайте с 10–20 А.
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="label">Старт FW по duty</div>
          <div className="num text-[15px] font-semibold">{Math.round(dutyStart * 100)}%</div>
        </div>
        <Slider
          label="Старт FW по duty"
          value={Math.round(dutyStart * 100)}
          min={60}
          max={95}
          step={1}
          disabled={!enabled || busy}
          onChange={edit((v: number) => setDutyStart(v / 100))}
        />
        <div className="text-[11px] text-[var(--fg-faint)]">
          FW включается, когда duty превысит {Math.round(dutyStart * 100)}% от max duty
          {ref.values ? ` (${(ref.values.l_max_duty * 100).toFixed(0)}%)` : ''}. Плавность — foc_fw_ramp_time из VESC
          {ref.values ? ` (${ref.values.foc_fw_ramp_time.toFixed(2)} с)` : ''}.
        </div>
      </div>

      <div className="mt-4">
        <div className="label mb-1.5">Куда записать</div>
        <Segmented<Target>
          value={target}
          onChange={(v) => {
            setTarget(v);
            setResult(null);
          }}
          disabled={busy}
          options={[
            { value: 'both', label: 'Оба' },
            { value: 'front', label: 'Перед' },
            { value: 'rear', label: 'Зад' },
          ]}
        />
      </div>

      {target !== 'both' && available.length === 2 && (
        <div className="mt-3">
          <Notice tone="warn" icon={<TriangleAlert size={15} />}>
            FW только на одном моторе — для проверки колеса на весу. В езде мотор без FW выше родной максималки начнёт тормозить: для 2WD
            записывайте одинаковый FW на оба.
          </Notice>
        </div>
      )}

      {target === 'both' && asymmetric && (
        <div className="mt-3">
          <Notice tone="warn" icon={<TriangleAlert size={15} />}>
            Сейчас FW на переднем и заднем разный. Запишите одинаковые настройки на оба мотора.
          </Notice>
        </div>
      )}

      {session.topology === 'sim' && session.demoRunning && (
        <div className="mt-3">
          <Notice tone="accent" icon={<Pause size={15} />}>
            Демо-самокат едет. Чтобы проверить запись FW, остановите его:{' '}
            <button type="button" className="font-semibold underline" onClick={() => session.setDemoRunning(false)}>
              остановить демо
            </button>
          </Notice>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <Notice tone={result.ok ? 'good' : 'bad'}>{result.message}</Notice>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary mt-4 w-full"
        disabled={busy || lock !== null || unchanged}
        onClick={() => {
          setAck(false);
          setConfirm(true);
        }}
      >
        {busy ? (
          <>
            <RefreshCw size={15} className="animate-spin" /> {progress}
          </>
        ) : lock ? (
          <>
            <Lock size={15} /> {lock}
          </>
        ) : unchanged ? (
          'Уже записано в VESC'
        ) : (
          <>
            <Zap size={15} /> {enabled ? `Записать FW ${amps} А` : 'Выключить FW'}
          </>
        )}
      </button>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={enabled ? `Включить FW ${amps} А?` : 'Выключить FW?'}
        footer={
          <>
            <button type="button" className="btn btn-primary flex-1" disabled={enabled && !ack} onClick={run}>
              Записать во flash
            </button>
            <button type="button" className="btn flex-1" onClick={() => setConfirm(false)}>
              Отмена
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
          <div className="border border-[var(--line)] bg-[var(--surface)] p-3">
            <div className="num">
              {keys.map((k) => CONTROLLER_NAMES[k]).join(' + ')} · {enabled ? `${amps} А, старт ${Math.round(dutyStart * 100)}% duty` : 'ток FW = 0 А'}
            </div>
            <div className="mt-1 text-[12px] text-[var(--fg-muted)]">
              Меняются только поля FW. Временные лимиты режима не попадут во flash — после записи режим применится заново.
            </div>
          </div>
          {enabled && (
            <>
              <Notice tone="warn" icon={<Flame size={15} />}>
                FW сильнее греет мотор и контроллер и увеличивает расход на высокой скорости. Следите за температурами на приборке. Не
                ездите с FW в 1WD: свободное колесо выше родной максималки тормозит.
              </Notice>
              <Notice tone="bad" icon={<TriangleAlert size={15} />}>
                Выше «родной» максималки мотор крутится быстрее, чем позволяет напряжение АКБ. Если VESC уйдёт в ошибку (перегрев, перенапряжение, отсечка BMS) — колесо может резко затормозить с броском напряжения. Не используйте FW на почти пустой АКБ и с BMS без запаса по зарядному току.
              </Notice>
              <label className="flex items-start gap-3 border border-[var(--line)] p-3">
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--accent-rgb))]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>Понимаю риски. Проверю FW сначала на поднятом колесе, затем на небольшой скорости.</span>
              </label>
            </>
          )}
          <div className="text-[12px] text-[var(--fg-muted)]">Самокат должен стоять: при записи во flash VESC на мгновение отпускает мотор.</div>
        </div>
      </Sheet>
    </Card>
  );
}

/* ───────── Ride profiles ───────── */

function ProfileEditor({
  profile,
  cfg,
  session,
  onSave,
  onClose,
}: {
  profile: RideProfile;
  cfg: OnboardComputerConfig;
  session: VescSession;
  onSave: (p: RideProfile) => void;
  onClose: () => void;
}) {
  const [p, setP] = useState(profile);
  const set = (patch: Partial<RideProfile>) => setP((prev) => ({ ...prev, ...patch }));
  const preview = useMemo(() => {
    const sel = { ...selectionFromConfig(cfg), profileId: p.id };
    return (['front', 'rear'] as ControllerKey[])
      .filter((k) => session.controllers[k].baseline)
      .map((k) => {
        const b = session.controllers[k].baseline!;
        const l = computeLimits(k, b, p, sel, cfg);
        return {
          key: k,
          phase: b.motorCurrentMax * l.currentMaxScale,
          brake: b.brakeCurrentMax * l.currentMinScale,
          batt: l.inCurrentMax,
          kmh: erpmToKmh(l.maxErpm, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm),
        };
      });
  }, [p, cfg, session.controllers]);
  const num = (label: string, key: keyof RideProfile, min: number, max: number, unit: string, step = 1) => (
    <div>
      <div className="label mb-1">{label}</div>
      <NumberField label={label} value={p[key] as number} min={min} max={max} step={step} unit={unit} onCommit={(v) => set({ [key]: v })} />
    </div>
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Режим ${profile.code}`}
      footer={
        <>
          <button type="button" className="btn btn-primary flex-1" onClick={() => onSave(p)}>
            Сохранить
          </button>
          <button type="button" className="btn flex-1" onClick={onClose}>
            Отмена
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label mb-1">Код (кнопка)</div>
          <input className="field" maxLength={8} value={p.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
        </div>
        <div>
          <div className="label mb-1">Название</div>
          <input className="field" maxLength={24} value={p.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        {num('Макс. скорость', 'maxSpeedKmh', 5, 150, 'км/ч')}
        {num('Тяга (ток мотора)', 'currentScalePct', 0, 100, '%')}
        {num('Тормоз (рекуперация)', 'brakeScalePct', 0, 100, '%')}
        {num('Мощность всего', 'maxWatts', 100, 50000, 'Вт', 50)}
        {num('Ток АКБ всего', 'maxBattAmps', 2, 600, 'А')}
      </div>
      {preview.length > 0 && (
        <div className="mt-4 border border-[var(--line)] bg-[var(--surface)] p-3 text-[12.5px]">
          <div className="label mb-2">Что получит VESC (2WD, без ограничителя)</div>
          {preview.map((r) => (
            <div key={r.key} className="num flex justify-between py-0.5">
              <span className="text-[var(--fg-muted)]">{CONTROLLER_NAMES[r.key]}</span>
              <span>
                {r.phase.toFixed(0)} А фаза · −{r.brake.toFixed(0)} А · АКБ {r.batt.toFixed(0)} А · ≤{r.kmh.toFixed(0)} км/ч
              </span>
            </div>
          ))}
          <div className="mt-2 text-[11px] text-[var(--fg-faint)]">Никогда не превышает лимиты, записанные в самом VESC.</div>
        </div>
      )}
    </Sheet>
  );
}

function ProfilesCard({ session, cfg, updateConfig }: Props) {
  const [editing, setEditing] = useState<RideProfile | null>(null);
  return (
    <Card title="Режимы езды" icon={<SlidersHorizontal size={13} />}>
      <div className="flex flex-col gap-2">
        {cfg.profiles.map((p) => {
          const rgb = accentForProfile(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditing(p)}
              className="flex items-center gap-3 border border-[var(--line)] bg-[var(--surface)] p-3 text-left active:scale-[0.99]"
            >
              <span className="grid h-10 w-14 shrink-0 place-items-center text-[12px] font-bold" style={{ background: `rgb(${rgb} / 0.16)`, color: `rgb(${rgb})` }}>
                {p.code}
              </span>
              <span className="num min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--fg-muted)]">
                <span className="text-[var(--fg)]">≤{p.maxSpeedKmh} км/ч</span> · {(p.maxWatts / 1000).toFixed(1)} кВт · АКБ {p.maxBattAmps} А
                <br />
                тяга {p.currentScalePct}% · тормоз {p.brakeScalePct}%
              </span>
              <Pencil size={15} className="text-[var(--fg-faint)]" />
            </button>
          );
        })}
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="label">Доля переднего мотора в 2WD</span>
          <span className="num text-[13px] font-semibold">{cfg.frontTorqueRatioPct}%</span>
        </div>
        <Slider label="Доля переднего мотора" value={cfg.frontTorqueRatioPct} min={30} max={100} step={5} onChange={(v) => updateConfig({ frontTorqueRatioPct: v })} />
        <div className="text-[11px] text-[var(--fg-faint)]">Меньше 100% — перед мягче тянет, меньше пробуксовки на старте.</div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="label">Ограничитель LIM</span>
          <span className="num text-[13px] font-semibold">{cfg.limiterKmh} км/ч</span>
        </div>
        <Slider label="Ограничитель" value={cfg.limiterKmh} min={5} max={60} step={1} onChange={(v) => updateConfig({ limiterKmh: v })} />
      </div>
      <div className="mt-2 text-[11px] leading-snug text-[var(--fg-faint)]">
        Режимы отправляются в VESC командой SET_MCCONF_TEMP: только RAM, без записи во flash, можно переключать на ходу. После выключения
        контроллера действуют его собственные лимиты — приборка применит режим снова при подключении.
      </div>
      {editing && (
        <ProfileEditor
          profile={editing}
          cfg={cfg}
          session={session}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            updateConfig({ profiles: cfg.profiles.map((x) => (x.id === p.id ? p : x)) });
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

/* ───────── Controllers ───────── */

function ControllerCard({ k, c, cfg }: { k: ControllerKey; c: ControllerState; cfg: OnboardComputerConfig }) {
  const v = c.values;
  const kmh = (erpm: number) => erpmToKmh(erpm, cfg.polePairs, cfg.gearRatio, cfg.wheelDiameterMm);
  return (
    <div className="border border-[var(--line)] bg-[var(--surface)] p-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">{CONTROLLER_NAMES[k]}</div>
        <span className={`chip ${c.present ? 'chip-good' : ''}`}>{c.present ? (c.canId !== null ? `CAN ${c.canId}` : 'прямое') : 'нет связи'}</span>
      </div>
      {c.fw && (
        <div className="num mt-1 text-[12px] text-[var(--fg-muted)]">
          {c.fw.hwName || 'VESC'} · FW {formatFw(c.fw)} · {c.fw.uuid.slice(0, 8)}…
        </div>
      )}
      {c.issue && <div className="mt-2 text-[12px] text-[var(--warn)]">{c.issue}</div>}
      {v && (
        <div className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          {[
            ['Мотор', `${MOTOR[v.motor_type] ?? v.motor_type} · ${SENSOR[v.foc_sensor_mode] ?? v.foc_sensor_mode}`],
            ['Ток мотора', `${v.l_current_max.toFixed(0)} / ${v.l_current_min.toFixed(0)} А`],
            ['Ток АКБ', `${v.l_in_current_max.toFixed(0)} / ${v.l_in_current_min.toFixed(0)} А`],
            ['Abs max', `${v.l_abs_current_max.toFixed(0)} А`],
            ['Max ERPM', `${(v.l_max_erpm / 1000).toFixed(0)}k ≈ ${kmh(v.l_max_erpm).toFixed(0)} км/ч`],
            ['Max duty', `${(v.l_max_duty * 100).toFixed(0)}%`],
            ['Отсечка АКБ', `${v.l_battery_cut_start.toFixed(1)} → ${v.l_battery_cut_end.toFixed(1)} В`],
            ['Темп. VESC', `${v.l_temp_fet_start.toFixed(0)} → ${v.l_temp_fet_end.toFixed(0)}°`],
            ['Темп. мотора', `${v.l_temp_motor_start.toFixed(0)} → ${v.l_temp_motor_end.toFixed(0)}°`],
            ['FW', readFw(v).enabled ? `${v.foc_fw_current_max.toFixed(1)} А · ${(v.foc_fw_duty_start * 100).toFixed(0)}%` : 'выкл'],
            ['Полюса / колесо', `${v.si_motor_poles} · ${(v.si_wheel_diameter * 1000).toFixed(0)} мм`],
            ['АКБ в VESC', `${v.si_battery_cells}S · ${v.si_battery_ah.toFixed(1)} Ач`],
          ].map(([a, b]) => (
            <div key={a} className="flex min-w-0 flex-col">
              <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-faint)]">{a}</span>
              <span className="truncate">{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ControllersCard({ session, cfg }: Props) {
  const online = session.phase === 'online';
  return (
    <Card
      title="Контроллеры"
      icon={<Cpu size={13} />}
      right={
        <button type="button" className="btn btn-ghost btn-sm" disabled={!online || session.busy !== null} onClick={() => void session.refreshConfig()}>
          <RefreshCw size={13} className={session.busy ? 'animate-spin' : ''} /> Перечитать
        </button>
      }
    >
      {!online ? (
        <div className="py-3 text-center text-[13px] text-[var(--fg-muted)]">Подключитесь, чтобы увидеть конфигурацию VESC.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <ControllerCard k="front" c={session.controllers.front} cfg={cfg} />
          <ControllerCard k="rear" c={session.controllers.rear} cfg={cfg} />
        </div>
      )}
      {session.topology === 'sim' && (
        <Row label="Демо-поездка" hint="Виртуальный самокат ездит по кругу: разгон, круиз, торможение.">
          <button type="button" className="btn btn-sm" onClick={() => session.setDemoRunning(!session.demoRunning)}>
            {session.demoRunning ? <Pause size={14} /> : <Play size={14} />}
            {session.demoRunning ? 'Пауза' : 'Ехать'}
          </button>
        </Row>
      )}
    </Card>
  );
}

export function TuneView(props: Props) {
  return (
    <div className="flex flex-col gap-3">
      <FieldWeakeningCard {...props} />
      <ProfilesCard {...props} />
      <ControllersCard {...props} />
    </div>
  );
}
