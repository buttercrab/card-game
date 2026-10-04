// Small motion helpers on the Web Animations API. Every animation is
// transform and opacity only, and every helper resolves even if the
// element is gone or the browser lacks the API, so motion can never block
// the game.

export const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';
export const EASE_SETTLE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function finished(animation: Animation | undefined): Promise<void> {
  return animation ? animation.finished.then(() => undefined, () => undefined) : Promise.resolve();
}

function run(el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (!el || typeof el.animate !== 'function' || !options.duration) return Promise.resolve();
  return finished(el.animate(keyframes, options));
}

/** Plays `el` in from where `from` was, so it looks like it travelled. */
export function flyFrom(el: Element | null, from: DOMRect, duration: number, delay = 0): Promise<void> {
  if (!el) return Promise.resolve();
  const to = el.getBoundingClientRect();
  const a = centre(from);
  const b = centre(to);
  const scale = to.width > 0 ? Math.min(1.6, Math.max(0.4, from.width / to.width)) : 1;
  return run(
    el,
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${scale})`, opacity: 0.6 },
      { opacity: 1, offset: 0.4 },
      { transform: 'none', opacity: 1 },
    ],
    { duration, delay, easing: EASE_SETTLE, fill: 'backwards' },
  );
}

/** Sends `el` to `to`, shrinking and fading on the way, and leaves it there. */
export function flyTo(el: Element | null, to: DOMRect, duration: number, delay = 0): Promise<void> {
  if (!el) return Promise.resolve();
  const a = centre(el.getBoundingClientRect());
  const b = centre(to);
  return run(
    el,
    [{ transform: 'none', opacity: 1 }, { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(0.4)`, opacity: 0 }],
    { duration, delay, easing: EASE_STANDARD, fill: 'forwards' },
  );
}

/** A short squash-and-settle that marks a card as the important one. */
export function pop(el: Element | null, duration: number): Promise<void> {
  return run(
    el,
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.9)', offset: 0.2 },
      { transform: 'scale(1.14)', offset: 0.55 },
      { transform: 'scale(1)' },
    ],
    { duration, easing: EASE_STANDARD },
  );
}

export function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Whether motion is wanted at all: off in settings or by the system. */
function still(): boolean {
  if (typeof document === 'undefined') return true;
  return (
    document.documentElement.dataset.motion === 'off' ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

/**
 * Balatro's "juice": a squash to `1 - 0.1 * amount`, then a spring back
 * through a fading wobble with a little tilt, over 0.4 s. `amount` runs from
 * about 0.2 for a nudge to 1 for the hand's big moment.
 */
export function juice(el: Element | null, amount = 0.6, duration = 400): Promise<void> {
  if (still()) return Promise.resolve();
  const frames: Keyframe[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const decay = (1 - t) ** 3;
    const s = i === 0 ? 1 - 0.1 * amount : 1 + 0.08 * amount * Math.sin(t * Math.PI * 6.5) * decay;
    const r = 4 * amount * Math.sin(t * Math.PI * 5) * (1 - t) ** 2;
    frames.push({ transform: `scale(${s.toFixed(4)}) rotate(${r.toFixed(2)}deg)`, offset: t });
  }
  return run(el, frames, { duration, easing: 'linear' });
}

/** A flat outline that grows from `el` and fades: a heavy card's ghost. */
export function ring(el: Element | null, color = 'currentColor', duration = 420): Promise<void> {
  if (still()) return Promise.resolve();
  return run(
    el,
    [
      { boxShadow: `0 0 0 0 color-mix(in srgb, ${color} 55%, transparent)` },
      { boxShadow: `0 0 0 14px color-mix(in srgb, ${color} 0%, transparent)` },
    ],
    { duration, easing: EASE_STANDARD },
  );
}

/** A heavy landing: one overshoot past full size, then settle. */
export function settle(el: Element | null, duration = 320): Promise<void> {
  if (still()) return Promise.resolve();
  return run(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: 0.45 }, { transform: 'scale(1)' }], {
    duration,
    easing: EASE_SETTLE,
  });
}
