// Keeps the screen on while a hand is being played, so phones lying on the
// table do not dim between turns. The browser drops the lock whenever the
// page is hidden, so it is taken again on return.

let wanted = false;
let lock: WakeLockSentinel | null = null;

async function sync() {
  if (wanted && !lock && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } catch {
      // Refused (battery saver, no user gesture yet): the screen just dims as usual.
    }
  } else if (!wanted && lock) {
    await lock.release().catch(() => {});
    lock = null;
  }
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => void sync());

export function keepAwake(on: boolean) {
  wanted = on;
  void sync();
}
