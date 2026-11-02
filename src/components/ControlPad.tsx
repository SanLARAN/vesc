import React, { useRef, useState } from 'react';
import { Lock, OctagonX, RotateCcw, Unlock } from 'lucide-react';

export type PadLayoutMode = 'trigger' | 'joystick' | 'tank';

export interface ControlCommandInput {
  left: number;
  right: number;
  brakingLeft: boolean;
  brakingRight: boolean;
}

interface ControlPadProps {
  layout: PadLayoutMode;
  onChangeLayout: (mode: PadLayoutMode) => void;
  armed: boolean;
  onToggleArm: () => void;
  onEmergencyStop: () => void;
  onInputChange: (cmd: ControlCommandInput) => void;
  effectiveLeftPct: number;
  effectiveRightPct: number;
}

export const ControlPad: React.FC<ControlPadProps> = ({
  layout,
  onChangeLayout,
  armed,
  onToggleArm,
  onEmergencyStop,
  onInputChange,
  effectiveLeftPct,
  effectiveRightPct,
}) => {
  const [reverseGear, setReverseGear] = useState(false);
  const [triggerVal, setTriggerVal] = useState(0);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const [holdCruise, setHoldCruise] = useState(false);
  const joyRef = useRef<HTMLDivElement | null>(null);

  const [tankLeft, setTankLeft] = useState(0);
  const [tankRight, setTankRight] = useState(0);
  const tankLeftRef = useRef<HTMLDivElement | null>(null);
  const tankRightRef = useRef<HTMLDivElement | null>(null);
  const tankLatest = useRef({ left: 0, right: 0 });

  const resetAllInputs = () => {
    setTriggerVal(0);
    setJoyPos({ x: 0, y: 0 });
    setTankLeft(0);
    setTankRight(0);
    tankLatest.current = { left: 0, right: 0 };
    onInputChange({ left: 0, right: 0, brakingLeft: false, brakingRight: false });
  };

  const updateTriggerFromPointer = (clientY: number) => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rel = 1 - ((clientY - rect.top) / rect.height) * 2;
    const clamped = Math.max(-1, Math.min(1, rel));
    const deadzoned = Math.abs(clamped) < 0.06 ? 0 : clamped;
    setTriggerVal(deadzoned);

    if (deadzoned < 0) {
      const brakeMag = Math.abs(deadzoned);
      onInputChange({
        left: brakeMag,
        right: brakeMag,
        brakingLeft: true,
        brakingRight: true,
      });
    } else {
      const signed = reverseGear ? -deadzoned : deadzoned;
      onInputChange({
        left: signed,
        right: signed,
        brakingLeft: false,
        brakingRight: false,
      });
    }
  };

  const updateJoystickFromPointer = (clientX: number, clientY: number) => {
    const el = joyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = Math.min(rect.width, rect.height) * 0.42;

    let dx = (clientX - cx) / maxR;
    let dy = -(clientY - cy) / maxR;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }

    const dead = 0.08;
    const cleanX = Math.abs(dx) < dead ? 0 : dx;
    const cleanY = Math.abs(dy) < dead ? 0 : dy;
    setJoyPos({ x: cleanX, y: cleanY });

    let leftMix = cleanY + cleanX * 0.85;
    let rightMix = cleanY - cleanX * 0.85;
    const peak = Math.max(1, Math.abs(leftMix), Math.abs(rightMix));
    leftMix /= peak;
    rightMix /= peak;

    onInputChange({
      left: leftMix,
      right: rightMix,
      brakingLeft: false,
      brakingRight: false,
    });
  };

  const updateTankChannel = (side: 'left' | 'right', clientY: number) => {
    const el = side === 'left' ? tankLeftRef.current : tankRightRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rel = 1 - ((clientY - rect.top) / rect.height) * 2;
    const clamped = Math.max(-1, Math.min(1, rel));
    const deadzoned = Math.abs(clamped) < 0.07 ? 0 : clamped;

    if (side === 'left') {
      tankLatest.current.left = deadzoned;
      setTankLeft(deadzoned);
    } else {
      tankLatest.current.right = deadzoned;
      setTankRight(deadzoned);
    }
    onInputChange({
      left: tankLatest.current.left,
      right: tankLatest.current.right,
      brakingLeft: false,
      brakingRight: false,
    });
  };

  return (
    <div className="border border-[var(--line)] bg-[var(--bg-surface)]">
      {/* Safety Top Strip */}
      <div className="grid grid-cols-2 gap-px border-b border-[var(--line)] bg-[var(--line)]">
        <button
          type="button"
          onClick={() => {
            navigator.vibrate?.(30);
            resetAllInputs();
            onToggleArm();
          }}
          className={`flex items-center justify-center gap-2 py-3 text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer ${
            armed
              ? 'bg-[var(--bg-surface)] text-[var(--fg)]'
              : 'bg-[var(--bg)] text-[var(--fg-muted)]'
          }`}
        >
          {armed ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {armed ? 'ПУЛЬТ АКТИВЕН' : 'СНЯТЬ БЛОК'}
        </button>

        <button
          type="button"
          onClick={() => {
            navigator.vibrate?.([60, 40, 60]);
            resetAllInputs();
            onEmergencyStop();
          }}
          className="flex items-center justify-center gap-2 bg-[var(--inv-bg)] py-3 text-xs font-extrabold tracking-widest uppercase text-[var(--inv-fg)] active:opacity-80 cursor-pointer"
        >
          <OctagonX className="h-4 w-4" />
          СТОП • 0 А
        </button>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-3 gap-px border-b border-[var(--line)] bg-[var(--line)]">
        {[
          { id: 'trigger' as const, label: 'КУРОК 2WD' },
          { id: 'joystick' as const, label: 'ДЖОЙСТИК 2D' },
          { id: 'tank' as const, label: 'ТАНК L / R' },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              resetAllInputs();
              onChangeLayout(m.id);
            }}
            className={`py-2.5 text-[11px] font-bold tracking-wider uppercase transition-colors cursor-pointer ${
              layout === m.id
                ? 'bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                : 'bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Live Output Vector Bar */}
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2 text-[11px] tabular-nums">
        <span className="text-[var(--fg-muted)]">
          L: <strong className="text-[var(--fg)]">{effectiveLeftPct}%</strong>
        </span>
        <span className="text-[10px] tracking-widest uppercase text-[var(--fg-faint)]">
          {armed ? 'ПЕРЕДАЧА 20 ГЦ' : 'ЗАБЛОКИРОВАНО'}
        </span>
        <span className="text-[var(--fg-muted)]">
          R: <strong className="text-[var(--fg)]">{effectiveRightPct}%</strong>
        </span>
      </div>

      <div className="p-4">
        {layout === 'trigger' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] text-[var(--fg-muted)]">
                Вверх — тяга, вниз — рекуперативный тормоз
              </span>
              <button
                type="button"
                onClick={() => {
                  resetAllInputs();
                  setReverseGear((v) => !v);
                }}
                className={`border px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase cursor-pointer ${
                  reverseGear
                    ? 'border-[var(--fg)] bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                    : 'border-[var(--line-strong)] bg-[var(--bg)] text-[var(--fg)]'
                }`}
              >
                {reverseGear ? 'ХОД: НАЗАД (R)' : 'ХОД: ВПЕРЁД (D)'}
              </button>
            </div>

            <div
              ref={triggerRef}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                updateTriggerFromPointer(e.clientY);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 0 && e.pointerType === 'mouse') return;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  updateTriggerFromPointer(e.clientY);
                }
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                resetAllInputs();
              }}
              onPointerCancel={() => resetAllInputs()}
              className="touch-control relative flex h-60 w-full items-center justify-center border border-[var(--line-strong)] bg-[var(--bg)] select-none cursor-ns-resize"
            >
              <div className="pointer-events-none absolute inset-x-4 top-1/2 h-px bg-[var(--fg-muted)]" />
              <span className="pointer-events-none absolute top-3 text-[10px] font-semibold tracking-widest text-[var(--fg-muted)]">
                ▲ ГАЗ ({reverseGear ? 'РЕВЕРС' : 'ВПЕРЁД'})
              </span>
              <span className="pointer-events-none absolute bottom-3 text-[10px] font-semibold tracking-widest text-[var(--fg-muted)]">
                ▼ ТОРМОЗ / РЕКУПЕРАЦИЯ
              </span>

              <div
                className="pointer-events-none absolute inset-x-8 bg-[var(--fg)] opacity-15"
                style={{
                  top: triggerVal >= 0 ? `${50 - triggerVal * 50}%` : '50%',
                  height: `${Math.abs(triggerVal) * 50}%`,
                }}
              />

              <div
                className="pointer-events-none absolute inset-x-6 flex h-11 -translate-y-1/2 items-center justify-between bg-[var(--inv-bg)] px-4 text-[var(--inv-fg)]"
                style={{ top: `${50 - triggerVal * 42}%` }}
              >
                <span className="text-[11px] font-bold tracking-wider uppercase">
                  {triggerVal > 0.02 ? 'ТЯГА' : triggerVal < -0.02 ? 'ТОРМОЗ' : 'НЕЙТРАЛЬ'}
                </span>
                <span className="tabular-nums text-sm font-bold">
                  {Math.round(triggerVal * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {layout === 'joystick' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] text-[var(--fg-muted)]">
                Дифференциальное микширование 2× VESC
              </span>
              <button
                type="button"
                onClick={() => {
                  if (holdCruise) resetAllInputs();
                  setHoldCruise((v) => !v);
                }}
                className={`flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                  holdCruise
                    ? 'border-[var(--fg)] bg-[var(--inv-bg)] text-[var(--inv-fg)]'
                    : 'border-[var(--line-strong)] bg-[var(--bg)] text-[var(--fg)]'
                }`}
              >
                <RotateCcw className="h-3 w-3" />
                {holdCruise ? 'КРУИЗ ВКЛ' : 'АВТО-НУЛЬ'}
              </button>
            </div>

            <div className="flex items-center justify-center py-1">
              <div
                ref={joyRef}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  updateJoystickFromPointer(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 0 && e.pointerType === 'mouse') return;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    updateJoystickFromPointer(e.clientX, e.clientY);
                  }
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  if (!holdCruise) resetAllInputs();
                }}
                onPointerCancel={() => {
                  if (!holdCruise) resetAllInputs();
                }}
                className="touch-control relative flex h-60 w-60 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--bg)] select-none cursor-grab active:cursor-grabbing"
              >
                <div className="pointer-events-none h-36 w-36 rounded-full border border-[var(--line)]" />
                <div className="pointer-events-none absolute inset-x-4 top-1/2 h-px bg-[var(--line)]" />
                <div className="pointer-events-none absolute inset-y-4 left-1/2 w-px bg-[var(--line)]" />

                <div
                  className="pointer-events-none absolute flex h-14 w-14 items-center justify-center rounded-full bg-[var(--inv-bg)] text-[var(--inv-fg)]"
                  style={{
                    transform: `translate(${joyPos.x * 84}px, ${-joyPos.y * 84}px)`,
                  }}
                >
                  <span className="tabular-nums text-[11px] font-bold">
                    {Math.round(Math.hypot(joyPos.x, joyPos.y) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {layout === 'tank' && (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { side: 'left', title: 'ЛЕВЫЙ #1', val: tankLeft, ref: tankLeftRef },
                { side: 'right', title: 'ПРАВЫЙ #2', val: tankRight, ref: tankRightRef },
              ] as const
            ).map((ch) => (
              <div key={ch.side} className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span className="text-[var(--fg-muted)]">{ch.title}</span>
                  <span className="tabular-nums">{Math.round(ch.val * 100)}%</span>
                </div>
                <div
                  ref={ch.ref}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updateTankChannel(ch.side, e.clientY);
                  }}
                  onPointerMove={(e) => {
                    if (e.buttons === 0 && e.pointerType === 'mouse') return;
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                      updateTankChannel(ch.side, e.clientY);
                    }
                  }}
                  onPointerUp={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    }
                    if (ch.side === 'left') {
                      tankLatest.current.left = 0;
                      setTankLeft(0);
                    } else {
                      tankLatest.current.right = 0;
                      setTankRight(0);
                    }
                    onInputChange({
                      left: tankLatest.current.left,
                      right: tankLatest.current.right,
                      brakingLeft: false,
                      brakingRight: false,
                    });
                  }}
                  onPointerCancel={() => resetAllInputs()}
                  className="touch-control relative flex h-56 w-full items-center justify-center border border-[var(--line-strong)] bg-[var(--bg)] select-none cursor-ns-resize"
                >
                  <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-[var(--line-strong)]" />
                  <div
                    className="pointer-events-none absolute inset-x-4 flex h-10 -translate-y-1/2 items-center justify-center bg-[var(--inv-bg)] text-xs font-bold text-[var(--inv-fg)]"
                    style={{ top: `${50 - ch.val * 40}%` }}
                  >
                    {Math.round(ch.val * 100)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
