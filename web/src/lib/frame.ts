// Indicators that carry state (the turn ring, the first-bid hold bar) are
// drawn from the clock on every frame, never by a CSS animation: reduced
// motion cuts animations to 1 ms and 끄기 turns them off, and either would
// show a full timer or an empty one instead of the time left.

/** Calls `tick` with performance.now() on every animation frame (every
 * 100 ms where there are none) until it returns false or the returned
 * stop is called. The first call is immediate. */
export function eachFrame(tick: (now: number) => boolean | void): () => void {
  let stopped = false;
  let handle: number | ReturnType<typeof setTimeout> | undefined;
  const frames = typeof requestAnimationFrame === 'function';
  const step = () => {
    if (stopped) return;
    if (tick(performance.now()) === false) return;
    handle = frames ? requestAnimationFrame(step) : setTimeout(step, 100);
  };
  step();
  return () => {
    stopped = true;
    if (handle === undefined) return;
    if (frames) cancelAnimationFrame(handle as number);
    else clearTimeout(handle);
  };
}

/** How much of `total` ms is left at `now`, from 1 (all of it) to 0. */
export function share(deadline: number, total: number, now: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (deadline - now) / total));
}
