import React, { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { ACHILLEUS_BMS_STAGES, BmsStageSpec } from '../state/dashboardConfig';

interface ChecklistStep {
  id: string;
  part: string;
  title: string;
  summary: string;
  criticalNote?: string;
}

const ACHILLEUS_STEPS: ChecklistStep[] = [
  {
    id: '16_2',
    part: '16.1–16.2',
    title: 'Подключение Master (Передний МК) и проверка прошивки 75_100_V2',
    summary:
      'AutoConnect по USB. На свежих 75100 Pro V2 с завода уже стоит FW 6.02 (75_100_V2). Если обновляешь вручную: Firmware → Bootloader → Upload, затем строго 75_100_V2 → Upload.',
  },
  {
    id: '16_4',
    part: '16.3–16.5',
    title: 'Master (ID 0, Переднее колесо в воздухе): FOC Detection + Hall Sensors',
    summary:
      'Setup Motors FOC → 16S Li-Ion → Motor Max 80–100A, Brake -60A, Battery Max 30A (старт!), Regen -15A, Abs Max 150A → Run Detection → Sensor Mode = Hall Sensors.',
    criticalNote:
      'ВАЖНО ПО ПОРЯДКУ: запуск мастера FOC сбрасывает конфиг мотора к дефолту! Обязательно проверь Motor Settings → FOC → Advanced → Phase Filter = FALSE и нажми Write Motor Configuration ПОСЛЕ завершения визарда 16.4!',
  },
  {
    id: '16_6',
    part: '16.6–16.7',
    title: 'Калибровка курка газа ADC + Кривая Throttle Expo',
    summary:
      'Control Type = Current No Reverse. ADC Mapping: отпущен ~0.5–0.7V (Set Min), выжат ~2.7–2.9V (Set Max). Positive Ramping 0.1–0.15, Negative 0.1, Expo 0.3–0.5 → Write App Configuration.',
    criticalNote:
      'КРИТИЧНАЯ ПОПРАВКА ДЛЯ BLUETOOTH: в пункте 16.6 выставь App to Use = «ADC and UART» (а НЕ просто «ADC»)! Встроенный Bluetooth-модуль 75100 Pro V2 сидит на внутреннем UART — с режимом «ADC and UART» одновременно работают и курок газа, и этот бортовой компьютер на телефоне!',
  },
  {
    id: '17_1',
    part: 'ЧАСТЬ 17',
    title: 'Настройка CAN-Bus на Master (Передний МК = ID 0)',
    summary:
      'App Settings → General: VESC ID = 0, CAN Status = CAN_STATUS_1_2_3_4_5, Send CAN Status = True, CAN Baud = 500K. В App Settings → ADC: Multiple VESCs over CAN = True → Write App.',
    criticalNote:
      'В CAN-шлейфе между двумя контроллерами должен быть перерезан и заизолирован красный провод +5V (оставляем только CANH и CANL).',
  },
  {
    id: '18_4',
    part: '18.1–18.4',
    title: 'Slave (ID 1, Заднее колесо в воздухе, БЕЗ Холлов): FOC Detection + Sensorless',
    summary:
      'Переткни USB во второй VESC. Setup Motors FOC → 16S Li-Ion → те же токи (30A старт) → Run Detection → Sensor Mode = Sensorless → проверь Phase Filter = FALSE → Write Motor Configuration.',
  },
  {
    id: '18_6',
    part: '18.5–18.7',
    title: 'Плавный Sensorless-старт Заднего МК + VESC ID = 1',
    summary:
      'FOC → Sensorless: Openloop ERPM = 500–700, Hysteresis = 100, Sensorless ERPM = 3000–4000, Openloop Current = 15–20A, Ramp = 0.01 (либо HFI Start: Samples 65, Override 3000). В App Settings: VESC ID = 1, App to Use = No App.',
  },
  {
    id: '19_1',
    part: 'ЧАСТЬ 19',
    title: 'Проверка связи Master (ID 0) ↔ Slave (ID 1) по CAN 500K',
    summary:
      'В VESC Tool (или прямо здесь в Настройках → кнопка «НАЙТИ CAN ID») должны определиться оба контроллера: ID 0 (Перед Hall) и ID 1 (Зад Sensorless).',
  },
  {
    id: '21_1',
    part: 'ЧАСТЬ 21',
    title: 'Field Weakening (ослабление поля для 90–95 км/ч на Achilleus)',
    summary:
      'На обоих VESC: Motor Settings → FOC → Advanced → Field Weakening → FW Current Max = 10A, FW Duty Start = 0.90, FW Ramp Time = 0.2 → Write Motor Configuration.',
  },
  {
    id: '23_1',
    part: 'ЧАСТЬ 23',
    title: 'Лимиты ERPM (±40000), Температур (80–100°C) и Батареи (46V / 43V)',
    summary:
      'На обоих VESC (ID 0 и через CAN Fwd на ID 1): Max/Min ERPM = ±40000, Motor & MOSFET Temp Cutoff = 80°C / 100°C, Battery Cutoff Start = 46V, End = 43V → Write Motor Configuration.',
  },
];

const CHECKLIST_STORAGE_KEY = 'vesc_achilleus_checklist_v1';

interface ChecklistViewProps {
  currentPerEscAmps: number;
  fieldWeakeningSim: boolean;
  onToggleFieldWeakeningSim: () => void;
  onApplyBmsStage: (stage: BmsStageSpec, saveEeprom: boolean) => void;
}

export const ChecklistView: React.FC<ChecklistViewProps> = ({
  currentPerEscAmps,
  fieldWeakeningSim,
  onToggleFieldWeakeningSim,
  onApplyBmsStage,
}) => {
  const [doneIds, setDoneIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const toggleStep = (id: string) => {
    setDoneIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* SECTION 20 INTERACTIVE BMS ACHILLEUS STAGE STEPPER */}
      <div className="border border-[var(--fg)] bg-[var(--bg-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-extrabold tracking-wider uppercase text-[var(--fg)]">
              ЧАСТЬ 20 • ПЛАН РАСКАЧКИ ТОКА ПОД BMS ACHILLEUS 100A
            </div>
            <div className="text-[11px] text-[var(--fg-muted)]">
              Переключай этапы 30А → 47А прямо с телефона без разборки деки и USB-провода!
            </div>
          </div>
          <span className="border border-[var(--fg)] bg-[var(--inv-bg)] px-2.5 py-1 text-xs font-bold tabular-nums text-[var(--inv-fg)]">
            СЕЙЧАС: {currentPerEscAmps}А × 2 = {currentPerEscAmps * 2}А
          </span>
        </div>

        <div className="grid grid-cols-1 gap-px border border-[var(--line-strong)] bg-[var(--line-strong)] sm:grid-cols-5">
          {ACHILLEUS_BMS_STAGES.map((st) => {
            const active = currentPerEscAmps === st.perVescAmps;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => onApplyBmsStage(st, false)}
                className={`flex flex-col items-start justify-between p-3 text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                    : 'bg-[var(--bg)] text-[var(--fg)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                <div className="text-[11px] font-extrabold tracking-wide uppercase">
                  {st.stageLabel}
                </div>
                <div className="mt-1 tabular-nums text-xs font-semibold">
                  {st.totalAmps}А • {st.powerKw}
                </div>
                <div className="mt-0.5 text-[10px] opacity-75">{st.whenNote}</div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
          <span className="text-[11px] text-[var(--fg-muted)]">
            Если на старте или в горку BMS отрубает питание — вернись на 1 ступень ниже и нажми «Сохранить в EEPROM».
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onToggleFieldWeakeningSim}
              className={`border px-3 py-1.5 text-[11px] font-bold uppercase cursor-pointer ${
                fieldWeakeningSim
                  ? 'border-[var(--fg)] bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                  : 'border-[var(--line-strong)] bg-[var(--bg)] text-[var(--fg-muted)]'
              }`}
            >
              Field Weakening 10A: {fieldWeakeningSim ? 'ВКЛ (~93 км/ч)' : 'ВЫКЛ (~80 км/ч)'}
            </button>
            <button
              type="button"
              onClick={() => {
                const match =
                  ACHILLEUS_BMS_STAGES.find((s) => s.perVescAmps === currentPerEscAmps) ??
                  ACHILLEUS_BMS_STAGES[ACHILLEUS_BMS_STAGES.length - 1];
                onApplyBmsStage(match, true);
              }}
              className="border border-[var(--fg)] bg-[var(--bg)] px-3 py-1.5 text-[11px] font-bold uppercase hover:bg-[var(--inv-bg)] hover:text-[var(--inv-fg)] cursor-pointer"
            >
              СОХРАНИТЬ {currentPerEscAmps}А×2 В EEPROM
            </button>
          </div>
        </div>
      </div>

      {/* PROGRESS HEADER */}
      <div className="flex items-center justify-between border border-[var(--line)] bg-[var(--bg-surface)] px-4 py-3">
        <div>
          <span className="text-xs font-bold tracking-wider uppercase">
            ИНТЕРАКТИВНЫЙ ЧЕК-ЛИСТ СБОРКИ (ЧАСТИ 16–23)
          </span>
          <span className="ml-3 tabular-nums text-xs text-[var(--fg-muted)]">
            Выполнено {doneIds.length} из {ACHILLEUS_STEPS.length}
          </span>
        </div>
        {doneIds.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDoneIds([]);
              localStorage.removeItem(CHECKLIST_STORAGE_KEY);
            }}
            className="flex items-center gap-1 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)] cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" /> Сбросить отметки
          </button>
        )}
      </div>

      {/* INTERACTIVE STEPS WITH CRITICAL NOTES */}
      <div className="divide-y divide-[var(--line)] border border-[var(--line)] bg-[var(--bg-surface)]">
        {ACHILLEUS_STEPS.map((step) => {
          const checked = doneIds.includes(step.id);
          return (
            <div key={step.id} className="p-4 space-y-2">
              <button
                type="button"
                onClick={() => toggleStep(step.id)}
                className="flex w-full items-start gap-3 text-left cursor-pointer"
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border ${
                    checked
                      ? 'border-[var(--fg)] bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                      : 'border-[var(--line-strong)] bg-[var(--bg)]'
                  }`}
                >
                  {checked && <Check className="h-3.5 w-3.5" />}
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-[var(--line-strong)] px-1.5 py-0.5 font-mono text-[10px] font-bold">
                      {step.part}
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        checked ? 'line-through text-[var(--fg-muted)]' : 'text-[var(--fg)]'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-muted)]">
                    {step.summary}
                  </p>
                </div>
              </button>

              {step.criticalNote && (
                <div className="ml-8 border-l-2 border-[var(--fg)] bg-[var(--bg)] px-3 py-2 text-xs leading-relaxed text-[var(--fg)]">
                  {step.criticalNote}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
