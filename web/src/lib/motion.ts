// Small motion helpers on the Web Animations API. Every animation is
// transform and opacity only, and every helper resolves even if the
// element is gone or the browser lacks the API, so motion can never block
// the game.

import { after } from './clock';
import { motion } from './settings.svelte';

export const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';
export const EASE_SETTLE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Resolves when the animation ends, or once its time is up: a hidden tab
 * draws no frames, so its animations never finish on their own, and the
 * table must not wait on them. Past its time it is finished by hand.
 */
function finished(animation: Animation | undefined, ms: number): Promise<void> {
  if (!animation) return Promise.resolve();
  const done = animation.finished.then(
    () => undefined,
    () => undefined,
  );
  const due = after(ms + 50).then(() => {
    if (animation.playState === 'running') animation.finish();
  });
  return Promise.race([done, due]);
}

function run(el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (!el || typeof el.animate !== 'function' || !options.duration) return Promise.resolve();
  return finished(el.animate(keyframes, options), Number(options.duration) + (options.delay ?? 0));
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
      { transform: 'scale(1.08)', offset: 0.55 },
      { transform: 'scale(1)' },
    ],
    { duration, easing: EASE_STANDARD },
  );
}

export function wait(ms: number): Promise<void> {
  return after(ms);
}

// What the table is still showing: a deal, or the moves it is playing out.
// The previews (and so the e2e tests) wait for it to end before they say
// they are drawn, rather than for a fixed time.
let busy = 0;
const idle: (() => void)[] = [];

/** Marks motion under way until the returned function is called (once is
 * enough; more calls do nothing). */
export function hold(): () => void {
  busy++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--busy === 0) for (const done of idle.splice(0)) done();
  };
}

/** Resolves once nothing holds the motion. */
export function settled(): Promise<void> {
  return busy === 0 ? Promise.resolve() : new Promise((done) => idle.push(done));
}

/** Whether movement is unwanted: off in settings or by the system. */
function still(): boolean {
  return motion.level !== 'full';
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
