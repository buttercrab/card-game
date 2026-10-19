import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneMotion, rebasePose } from './sceneMotion';

class FakeAnimation {
  playState = 'running';
  #resolve!: () => void;
  finished = new Promise<void>(resolve => { this.#resolve = resolve; });
  finish = vi.fn(() => { this.playState = 'finished'; this.#resolve(); });
  cancel = vi.fn(() => { this.playState = 'idle'; this.#resolve(); });
}
const from = { x: 10, y: 20, width: 100, height: 140 };
const to = { x: 160, y: 200, width: 50, height: 70 };
function target() {
  const animations: FakeAnimation[] = [];
  const element = { isConnected: true, onclick: () => 'same handler', getBoundingClientRect: () => { throw new Error('DOM geometry forbidden'); }, animate: vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => { const animation = new FakeAnimation(); animations.push(animation); return animation; }) };
  return { element: element as unknown as Element, animate: element.animate, animations, handler: element.onclick };
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(0.5,0,0,0.5,12,-7)', opacity: '0.7' })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('authoritative numeric scene motion', () => {
  it('uses numeric travel centers and keeps the original arrival curve/timing', async () => {
    const motion = new SceneMotion(), t = target();
    const done = motion.arrive('card:one', t.element, from, to, { duration: 160, delay: 60 });
    expect(t.animate.mock.calls[0]).toEqual([
      [{ transform: 'translate(-125px, -145px) scale(1.6)', opacity: 0.6 }, { opacity: 1, offset: 0.4 }, { transform: 'none', opacity: 1 }],
      { duration: 160, delay: 60, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'backwards', composite: 'replace', id: undefined },
    ]);
    expect((t.element as unknown as { onclick: unknown }).onclick).toBe(t.handler);
    motion.finish(); await done; motion.dispose();
  });
  it('adds only geometry, while the opacity curve replaces native opacity', async () => {
    const motion = new SceneMotion(), t = target();
    const done = motion.depart('card:one', t.element, from, to, { duration: 240, delay: 25, composite: 'add' });
    expect(t.animate).toHaveBeenCalledTimes(2);
    expect(t.animate.mock.calls[0][1]).toMatchObject({ composite: 'add', duration: 240, delay: 25, fill: 'forwards' });
    expect(t.animate.mock.calls[1][1]).toMatchObject({ composite: 'replace' });
    expect(t.animate.mock.calls[0][0]).toEqual([{ transform: 'none', offset: undefined }, { transform: 'translate(125px, 145px) scale(0.4)', offset: undefined }]);
    motion.finish(); await done;
    // A terminal forward-filled effect must remain cancellable on node reuse.
    motion.cancel('card:one'); expect(t.animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
    motion.dispose();
  });
  it('samples an in-flight pose and rebases center and size without DOM geometry', async () => {
    const motion = new SceneMotion(), t = target();
    const first = motion.arrive('card:one', t.element, from, to, { duration: 220 });
    const pose = motion.capture('card:one', t.element, to)!;
    const after = { x: 200, y: 260, width: 100, height: 140 };
    expect(rebasePose(pose, after)).toBe('matrix3d(0.25,0,0,0,0,0.25,0,0,0,0,1,0,-53,-102,0,1)');
    const next = motion.retarget('card:one', t.element, pose, after, { duration: 100 });
    expect(t.animations[0].cancel).toHaveBeenCalledOnce();
    expect(t.animate.mock.calls[1][0]).toEqual([{ transform: rebasePose(pose, after), opacity: 0.7 }, { transform: 'none', opacity: 1 }]);
    motion.interrupt(); await Promise.all([first, next]); motion.dispose();
  });
  it('preserves projected corners of a perspective pose when the numeric box changes', () => {
    const old = { x: 110, y: 80, width: 80, height: 112 }, after = { x: 400, y: 250, width: 60, height: 84 };
    const matrix = [0.94,0,0.1,0.0003,0,0.98,0.03,-0.0001,0,0,1,0.0003,20,-10,1,1];
    const result = rebasePose({ id: 'card:one', bounds: old, transform: `matrix3d(${matrix.join(',')})`, opacity: 1 }, after);
    const rebased = result.slice(9, -1).split(',').map(Number);
    const point = (m: number[], x: number, y: number, box: typeof old) => {
      const w = m[3] * x + m[7] * y + m[15];
      return { x: (m[0] * x + m[4] * y + m[12]) / w + box.x + box.width / 2, y: (m[1] * x + m[5] * y + m[13]) / w + box.y + box.height / 2 };
    };
    for (const [x,y] of [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]) {
      const beforePoint = point(matrix, x * old.width, y * old.height, old);
      const afterPoint = point(rebased, x * after.width, y * after.height, after);
      expect(afterPoint.x).toBeCloseTo(beforePoint.x, 8); expect(afterPoint.y).toBeCloseTo(beforePoint.y, 8);
    }
  });
  it('rejects old revisions, safely settles hidden-tab playback, and stops after disposal', async () => {
    const motion = new SceneMotion(), t = target();
    motion.interrupt(); await motion.arrive('card:one', t.element, from, to, { duration: 160, revision: 0 });
    expect(t.animate).not.toHaveBeenCalled();
    const done = motion.arrive('card:one', t.element, from, to, { duration: 160, delay: 60, revision: motion.revision });
    await vi.advanceTimersByTimeAsync(270); await done; expect(t.animations[0].finish).toHaveBeenCalledOnce();
    motion.dispose(); await motion.arrive('card:one', t.element, from, to, { duration: 160 }); expect(t.animate).toHaveBeenCalledTimes(1);
  });
});
