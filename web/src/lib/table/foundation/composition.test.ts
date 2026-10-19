import { beforeAll, describe, expect, it } from 'vitest';
import { numericComposition, type Composition, type CompositionKernel } from './composition';
import { loadYogaComposition, type YogaComposition } from './yogaComposition';

let yoga: YogaComposition;
beforeAll(async () => { yoga = await loadYogaComposition(); });
function close(actual: Composition, expected: Composition) {
    expect(actual.height).toBeCloseTo(expected.height, 4);
    expect(actual.placements).toHaveLength(expected.placements.length);
    actual.placements.forEach((point, index) => {
        expect(point.x).toBeCloseTo(expected.placements[index].x, 4);
        expect(point.y).toBeCloseTo(expected.placements[index].y, 4);
    });
}
describe.each(['numeric', 'yoga'] as const)('%s exact-footprint kernel', name => {
    const kernel = (): CompositionKernel => name === 'numeric' ? numericComposition : yoga;
    it('wraps a mandatory 180px + 160px pair in a 300px row without shrink', () => {
        close(kernel().rows(300, [{ width: 180, height: 50 }, { width: 160, height: 70 }], 12, 'start'),
            { height: 132, placements: [{ x: 0, y: 0 }, { x: 0, y: 62 }] });
    });
    it('centers each independently wrapped line with its full tallest footprint', () => {
        close(kernel().rows(300, [{ width: 100, height: 40 }, { width: 100, height: 60 }, { width: 180, height: 20 }], 12, 'center'),
            { height: 92, placements: [{ x: 44, y: 0 }, { x: 156, y: 0 }, { x: 60, y: 72 }] });
    });
    it('reserves both column paddings and measured child heights', () => {
        close(kernel().column(300, [{ width: 268, height: 89 }, { width: 200, height: 124 }], 12, 16),
            { height: 257, placements: [{ x: 16, y: 16 }, { x: 16, y: 117 }] });
    });
    it('handles empty compositions without a phantom trailing gap', () => {
        close(kernel().column(300, [], 12, 16), { height: 32, placements: [] });
        close(kernel().rows(300, [], 12, 'center'), { height: 0, placements: [] });
    });
    it('rejects infeasible exact footprints and invalid numeric inputs', () => {
        expect(() => kernel().rows(300, [{ width: 301, height: 44 }], 12, 'start')).toThrow(/exceeds/);
        expect(() => kernel().column(300, [{ width: 280, height: 44 }], 12, 16)).toThrow(/exceeds/);
        expect(() => kernel().rows(NaN, [], 12, 'start')).toThrow();
        expect(() => kernel().rows(300, [{ width: 20, height: Infinity }], 12, 'start')).toThrow();
        expect(() => kernel().column(300, [], -1, 16)).toThrow();
    });
});
it('matches independent Yoga results across fractional wrap boundaries and widths', () => {
    for (const width of [99.99, 100, 100.01, 320, 390, 568, 768, 1024, 1440]) {
        const children = [{ width: 40.25, height: 44.125 }, { width: 51.5, height: 61.25 }, { width: 70.75, height: 39.5 }];
        for (const align of ['start', 'center'] as const)
            close(yoga.rows(width, children, 8.25, align), numericComposition.rows(width, children, 8.25, align));
        close(yoga.column(width, children, 8.25, 4.125), numericComposition.column(width, children, 8.25, 4.125));
    }
});
it('returns native allocation counts to zero across repeated solves and rejection', () => {
    for (let index = 0; index < 100; index++) {
        yoga.rows(320, Array.from({ length: 30 }, () => ({ width: 44, height: 44 })), 8, 'start');
        expect(() => yoga.rows(1, [{ width: 44, height: 44 }], 8, 'start')).toThrow();
        expect(yoga.inspect()).toMatchObject({ liveNodes: 0, liveConfigs: 0 });
    }
    expect(yoga.inspect().solves).toBeGreaterThanOrEqual(100);
});
