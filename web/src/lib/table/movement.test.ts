import { describe, expect, it } from 'vitest';
import { flightOffset, planMovement, type IdentityPosition } from './movement';

const position = (id: string, x: number, width = 40): IdentityPosition => ({ id, bounds: { x, y: 10, width, height: 60 } });
const options = { enabled: true, duration: 300 };

describe('identity movement', () => {
  it('uses card centers and bounded scaling for travel from any region', () => {
    expect(flightOffset({ x: 0, y: 0, width: 200, height: 100 }, { x: 300, y: 100, width: 50, height: 70 }))
      .toEqual({ x: -225, y: -85, scale: 1.6 });
    expect(flightOffset({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 }).scale).toBe(.4);
  });
  it('follows people through reordered seats and ignores new occupants', () => {
    expect(planMovement([position('a', 0), position('b', 100)], [position('b', 0), position('new', 50), position('a', 100)], options))
      .toEqual([{ id: 'b', x: 100, y: 0, duration: 300 }, { id: 'a', x: -100, y: 0, duration: 300 }]);
  });
  it('centers identities of different rendered widths', () => {
    expect(planMovement([position('a', 0, 100)], [position('a', 100, 40)], options)[0].x).toBe(-70);
  });
  it('returns to waiting by reversing the same movement', () => {
    const waiting = [position('a', 250)];
    const playing = [position('a', 20)];
    expect(planMovement(waiting, playing, options)[0].x).toBe(230);
    expect(planMovement(playing, waiting, options)[0].x).toBe(-230);
  });
  it('does not animate unchanged positions, absent measurements or reduced motion', () => {
    expect(planMovement([position('a', 0)], [position('a', 1)], options)).toEqual([]);
    expect(planMovement([position('a', 0, 0)], [position('a', 100)], options)).toEqual([]);
    expect(planMovement([position('a', 0)], [position('a', 100)], { ...options, enabled: false })).toEqual([]);
  });
});
