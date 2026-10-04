// A timer that keeps time while the tab is in the background. Browsers
// throttle a hidden page's own timers (to a second, then to a minute), but
// not a worker's, so the table's pauses run from a small worker and the
// hand plays on at the same pace whether or not anyone is looking.

let worker: Worker | null | undefined;
const waiting = new Map<number, () => void>();
let next = 1;

function start(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const src = 'onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms);';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = (e: MessageEvent<number>) => {
      waiting.get(e.data)?.();
      waiting.delete(e.data);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Calls `fn` after `ms`, on time even in a hidden tab. Returns a cancel. */
export function later(fn: () => void, ms: number): () => void {
  const w = start();
  if (!w) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  }
  const id = next++;
  waiting.set(id, fn);
  w.postMessage({ id, ms });
  return () => waiting.delete(id);
}

/** Resolves after `ms`, on time even in a hidden tab. */
export function after(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => later(resolve, ms)) : Promise.resolve();
}
