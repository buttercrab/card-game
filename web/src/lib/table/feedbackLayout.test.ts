import { describe, expect, it } from 'vitest';
import { bubbleTypography, layoutFeedback } from './feedbackLayout';

describe('numeric player feedback', () => {
  it('keeps bid and event in one reserved band even when labels exceed the seat width', () => {
    const layout = layoutFeedback(92, [
      { id: 'bid', width: 90, height: 20 }, { id: 'event', width: 100, height: 24 },
    ], { width: 0, height: 0 });
    const [bid, event] = layout.nodes;
    expect(bid.bounds.y).toBe(0);
    expect(event.bounds.y).toBe(0);
    expect(event.bounds.x).toBeCloseTo(bid.bounds.x + bid.bounds.width + 4);
    expect(event.bounds.x + event.bounds.width).toBeCloseTo(92);
    expect(layout.height).toBe(28);
  });

  it('positions a reaction independently above the identity with the measured bubble height', () => {
    const layout = layoutFeedback(100, [], { width: 70, height: 42 }, {
      reaction: { x: 50, y: -70, width: 100 },
    });
    expect(layout.reaction).toEqual({ x: 15, y: -112, width: 70, height: 42 });
    expect(layout.height).toBe(28);
  });

  it('supports side-aligned tray bubbles and compact below-anchor placement', () => {
    const side = layoutFeedback(100, [], { width: 200, height: 50 }, {
      reaction: { x: 160, y: 5, width: 90, align: 'end', below: true }, height: 24,
    });
    expect(side.reaction).toEqual({ x: 70, y: 5, width: 90, height: 50 });
    expect(side.height).toBe(24);
    expect(bubbleTypography('reaction', true, true, true)).toMatchObject({ fontSize: 28, minHeight: 32, enterY: 0 });
  });
});
