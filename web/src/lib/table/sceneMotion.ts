import { later } from '../clock';
import { flightOffset, type Bounds } from './movement';

export interface MotionPose { id: string; bounds: Bounds; transform: string; opacity: number }
export interface SceneMotionOptions {
  duration: number; delay?: number; easing?: string; enabled?: boolean;
  revision?: number; composite?: 'replace' | 'add'; animationId?: string;
}
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';
const SETTLE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const copy = (bounds: Bounds): Bounds => ({ ...bounds });
const valid = (bounds: Bounds) => Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;

/** Rebase a sampled center-origin pose into a new authoritative layout box. */
export function rebasePose(pose: MotionPose, after: Bounds): string {
  if (!valid(pose.bounds) || !valid(after)) return 'none';
  const match = pose.transform.match(/^matrix(3d)?\(([^)]+)\)$/);
  const values = match?.[2].split(',').map(Number);
  let m: number[];
  if (!values || values.some(value => !Number.isFinite(value))) m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  else if (values.length === 6) m = [values[0], values[1], 0, 0, values[2], values[3], 0, 0, 0, 0, 1, 0, values[4], values[5], 0, 1];
  else if (values.length === 16) m = values.slice();
  else return 'none';
  const dx = pose.bounds.x + pose.bounds.width / 2 - after.x - after.width / 2;
  const dy = pose.bounds.y + pose.bounds.height / 2 - after.y - after.height / 2;
  // T(centerDelta) * sampledMatrix * S(oldSize/newSize), including perspective.
  for (let column = 0; column < 4; column++) { const i = column * 4; m[i] += dx * m[i + 3]; m[i + 1] += dy * m[i + 3]; }
  for (let row = 0; row < 4; row++) { m[row] *= pose.bounds.width / after.width; m[4 + row] *= pose.bounds.height / after.height; }
  return `matrix3d(${m.join(',')})`;
}

/**
 * Resolve the current native pose in the same coordinate plane as `base`.
 * Layout remains authoritative; computed CSS supplies only animated decoration.
 * Same-size scene wrappers share the primitive's resting box. Containers with
 * an unknown origin may contribute translations, but never guessed rotations.
 */
export function sampleVisualBounds(element: Element | null | undefined, base: Bounds, frameRoot: Element | null | undefined): Bounds {
  const fallback = () => copy(base);
  if (!element || !frameRoot || !frameRoot.contains(element) || !valid(base) || typeof DOMMatrix === 'undefined') return fallback();
  try {
    let total = new DOMMatrix();
    const length = (value: string | undefined, size: number) => value?.endsWith('%') ? parseFloat(value) * size / 100 : parseFloat(value ?? '0') || 0;
    for (let node: Element | null = element; node && node !== frameRoot; node = node.parentElement) {
      const css = getComputedStyle(node);
      // A containing perspective needs its own numeric origin; self-contained
      // perspective(...) matrices on cards are supported below.
      if (css.perspective !== 'none' && css.perspective !== undefined) return fallback();
      if (css.transform === 'none' && css.translate === 'none' && css.rotate === 'none' && css.scale === 'none') continue;
      const width = parseFloat(css.width), height = parseFloat(css.height);
      const translate = css.translate === 'none' ? [] : css.translate.split(' ');
      const move = new DOMMatrix().translate(length(translate[0], width || base.width), length(translate[1], height || base.height), length(translate[2], 1));
      const rotation = new DOMMatrix();
      if (css.rotate !== 'none') {
        const parts = css.rotate.split(' '), angle = parseFloat(parts.at(-1) ?? '0');
        if (parts.length === 1) rotation.rotateSelf(angle);
        else if (parts.length === 2) rotation.rotateAxisAngleSelf(parts[0] === 'x' ? 1 : 0, parts[0] === 'y' ? 1 : 0, parts[0] === 'z' ? 1 : 0, angle);
        else if (parts.length === 4) rotation.rotateAxisAngleSelf(Number(parts[0]), Number(parts[1]), Number(parts[2]), angle);
        else return fallback();
      }
      const scale = css.scale === 'none' ? [] : css.scale.split(' ').map(Number);
      if (scale.some(value => !Number.isFinite(value))) return fallback();
      const linear = rotation.scale(scale[0] ?? 1, scale[1] ?? scale[0] ?? 1, scale[2] ?? 1).multiply(css.transform === 'none' ? new DOMMatrix() : new DOMMatrix(css.transform));
      const translationOnly = linear.is2D && Math.abs(linear.a - 1) < 1e-9 && Math.abs(linear.d - 1) < 1e-9 && Math.abs(linear.b) < 1e-9 && Math.abs(linear.c) < 1e-9;
      if (translationOnly) { total = move.multiply(linear).multiply(total); continue; }
      if (node !== element && (Math.abs(width - base.width) > 0.1 || Math.abs(height - base.height) > 0.1)) return fallback();
      const origin = css.transformOrigin.split(' '), ox = length(origin[0], width || base.width), oy = length(origin[1], height || base.height), oz = length(origin[2], 1);
      const local = move.translate(ox, oy, oz).multiply(linear).translate(-ox, -oy, -oz);
      total = new DOMMatrix().translate(base.x, base.y).multiply(local).translate(-base.x, -base.y).multiply(total);
    }
    const points = [[base.x, base.y], [base.x + base.width, base.y], [base.x + base.width, base.y + base.height], [base.x, base.y + base.height]].map(([x, y]) => {
      const point = new DOMPoint(x, y).matrixTransform(total);
      if (!Number.isFinite(point.w) || Math.abs(point.w) < 1e-9) throw new Error('Unsupported projection');
      return { x: point.x / point.w, y: point.y / point.w };
    });
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return fallback();
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
    return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
  } catch { return fallback(); }
}

/** Native WAAPI playback; callers own coordinates, phase sequencing and timing. */
export class SceneMotion {
  #revision = 0;
  #disposed = false;
  #tracks = new Map<string, { element: Element; bounds: Bounds; animations: Animation[]; done: () => void }>();
  get revision() { return this.#revision; }

  capture(id: string, element: Element | null, bounds: Bounds): MotionPose | null {
    if (!element || !valid(bounds)) return null;
    const css = getComputedStyle(element);
    return { id, bounds: copy(bounds), transform: css.transform, opacity: Number(css.opacity) };
  }
  cancel(id: string): void {
    const track = this.#tracks.get(id); if (!track) return;
    this.#tracks.delete(id); for (const animation of track.animations) animation.cancel(); track.done();
  }
  interrupt(): number { this.#revision++; for (const id of [...this.#tracks.keys()]) this.cancel(id); return this.#revision; }
  finish(): void {
    for (const track of this.#tracks.values()) for (const animation of track.animations) {
      try { animation.finish(); } catch { animation.cancel(); }
    }
  }
  dispose(): void { this.#disposed = true; this.interrupt(); }

  arrive(id: string, element: Element | null, from: Bounds, to: Bounds, options: SceneMotionOptions): Promise<void> {
    if (!valid(from) || !valid(to)) return Promise.resolve();
    const { x, y, scale } = flightOffset(from, to);
    return this.#play(id, element, to, [
      { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity: 0.6 },
      { opacity: 1, offset: 0.4 }, { transform: 'none', opacity: 1 },
    ], { ...options, easing: options.easing ?? SETTLE, fill: 'backwards' });
  }
  depart(id: string, element: Element | null, from: Bounds, to: Bounds, options: SceneMotionOptions): Promise<void> {
    if (!valid(from) || !valid(to)) return Promise.resolve();
    const { x, y } = flightOffset(from, to);
    return this.#play(id, element, from, [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${-x}px, ${-y}px) scale(0.4)`, opacity: 0 },
    ], { ...options, easing: options.easing ?? STANDARD, fill: 'forwards' });
  }
  retarget(id: string, element: Element | null, pose: MotionPose | null, after: Bounds, options: SceneMotionOptions): Promise<void> {
    if (!pose || pose.id !== id || !valid(after)) return Promise.resolve();
    return this.#play(id, element, after, [
      { transform: rebasePose(pose, after), opacity: pose.opacity }, { transform: 'none', opacity: 1 },
    ], { ...options, easing: options.easing ?? STANDARD, composite: 'replace', fill: 'backwards' });
  }

  #play(id: string, element: Element | null, bounds: Bounds, frames: Keyframe[], options: SceneMotionOptions & { fill: FillMode }): Promise<void> {
    if (this.#disposed || (options.revision !== undefined && options.revision !== this.#revision)) return Promise.resolve();
    this.cancel(id);
    if (!element?.isConnected || typeof element.animate !== 'function' || options.enabled === false || !Number.isFinite(options.duration) || !Number.isFinite(options.delay ?? 0) || options.duration <= 0) return Promise.resolve();
    const timing: KeyframeAnimationOptions = { id: options.animationId, duration: options.duration, delay: options.delay ?? 0, easing: options.easing, fill: options.fill };
    // Add geometric motion without adding opacity to the native element's opacity.
    const animations = options.composite === 'add' ? [
      element.animate(frames.filter(frame => 'transform' in frame).map(({ transform, offset }) => ({ transform, offset })), { ...timing, composite: 'add' }),
      element.animate(frames.filter(frame => 'opacity' in frame).map(({ opacity, offset }) => ({ opacity, offset })), { ...timing, composite: 'replace' }),
    ] : [element.animate(frames, { ...timing, composite: 'replace' })];
    return new Promise(resolve => {
      let completed = false;
      const done = () => { if (completed) return; completed = true; cancelTimer(); if (options.fill !== 'forwards' && this.#tracks.get(id)?.animations === animations) this.#tracks.delete(id); resolve(); };
      const cancelTimer = later(() => { for (const animation of animations) { try { animation.finish(); } catch { animation.cancel(); } } done(); }, options.duration + (options.delay ?? 0) + 50);
      this.#tracks.set(id, { element, bounds: copy(bounds), animations, done });
      void Promise.all(animations.map(animation => animation.finished.catch(() => undefined))).then(done);
    });
  }
}
