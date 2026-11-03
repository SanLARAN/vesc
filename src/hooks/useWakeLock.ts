import { useEffect, useState } from 'react';

export type WakeLockState = 'off' | 'active' | 'suspended' | 'unsupported' | 'blocked';

interface Sentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export function useWakeLock(enabled: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>('off');

  useEffect(() => {
    if (!enabled) {
      setState('off');
      return;
    }
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
    if (!nav.wakeLock) {
      setState('unsupported');
      return;
    }
    let disposed = false;
    let sentinel: Sentinel | null = null;
    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') {
        setState('suspended');
        return;
      }
      if (sentinel && !sentinel.released) return;
      try {
        const s = await nav.wakeLock!.request('screen');
        if (disposed) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel = s;
        setState('active');
        s.addEventListener('release', () => {
          if (!disposed) setState(document.visibilityState === 'visible' ? 'blocked' : 'suspended');
        });
      } catch {
        if (!disposed) setState('blocked');
      }
    };
    const onVis = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('pointerdown', onVis, { passive: true });
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('pointerdown', onVis);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);

  return state;
}
