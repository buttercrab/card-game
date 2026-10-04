// One timer blinks every figure at the table. Each figure registers a
// callback; the timer sleeps until the soonest figure is due, closes its
// eyes for a moment (now and then twice), and picks its next blink 3 to 7 s
// out. With no figures registered the timer stops.

type Blinker = { next: number; set: (closed: boolean) => void };

const blinkers = new Set<Blinker>();
let timer: ReturnType<typeof setTimeout> | null = null;

const CLOSED_MS = 80;
const GAP_MS = 140;

function later(now: number): number {
  return now + 3000 + Math.random() * 4000;
}

// Reopening is skipped for a figure that has left the table meanwhile.
function shut(b: Blinker) {
  b.set(true);
  setTimeout(() => blinkers.has(b) && b.set(false), CLOSED_MS);
}

function blink(b: Blinker) {
  shut(b);
  if (Math.random() < 0.15) setTimeout(() => blinkers.has(b) && shut(b), CLOSED_MS + GAP_MS);
}

function tick() {
  timer = null;
  const now = Date.now();
  for (const b of blinkers) {
    if (b.next <= now) {
      blink(b);
      b.next = later(now);
    }
  }
  schedule();
}

function schedule() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (blinkers.size === 0) return;
  let soonest = Infinity;
  for (const b of blinkers) soonest = Math.min(soonest, b.next);
  timer = setTimeout(tick, Math.max(0, soonest - Date.now()));
}

/** Blinks `set` from now on; call the returned function to stop. */
export function blinker(set: (closed: boolean) => void): () => void {
  const b: Blinker = { next: later(Date.now()), set };
  blinkers.add(b);
  schedule();
  return () => {
    blinkers.delete(b);
    set(false);
    schedule();
  };
}
