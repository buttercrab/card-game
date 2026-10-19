import { expect, test } from 'vitest';
import { selectionTracks } from './selectionMotion';
import type { PresentationFrame } from './contracts';
const frame = (checked = false): PresentationFrame => ({
    id: checked ? 2 : 1, environment: { revision: 'e' } as PresentationFrame['environment'],
    context: { session: 's', audience: 'a', generation: 'g', revision: 'r' }, offerId: 'o', width: 300, height: 200, recipe: 'stacked',
    nodes: [
        { id: 'fan', parent: null, kind: 'group', label: '', box: { x: 0, y: 0, width: 300, height: 150 } },
        { id: 'card', cardId: 'c', parent: 'fan', kind: 'card', label: 'Ace', checked, box: { x: 6, y: checked ? 6 : 20, width: 88, height: 124 } },
    ],
});
test('selection and deselection use only the reserved vertical lift', () => {
    expect(selectionTracks(frame(), frame(true))).toEqual([{ id: 'card', fromY: 14 }]);
    expect(selectionTracks(frame(true), frame())).toEqual([{ id: 'card', fromY: -14 }]);
    expect(selectionTracks(null, frame())).toEqual([]);
    expect(selectionTracks(frame(), frame())).toEqual([]);
});
test('environment, offer, audience and turn changes never animate retained private cards', () => {
    for (const patch of [
        { environment: { revision: 'resize' } as PresentationFrame['environment'] },
        { offerId: 'new' }, ...(['session', 'audience', 'generation', 'revision'] as const).map(key => ({ context: { ...frame().context, [key]: 'new' } })),
    ]) expect(selectionTracks(frame(), { ...frame(true), ...patch })).toEqual([]);
});
test('unreserved displacement, different artwork, reparenting and resized ancestors snap', () => {
    const next = frame(true);
    for (const patch of [
        { box: { ...next.nodes[1].box, y: 0 } }, { box: { ...next.nodes[1].box, x: 7 } },
        { box: { ...next.nodes[1].box, width: 90 } }, { parent: null }, { cardId: 'other' },
        { visual: { kind: 'joker', color: 'Black' } as const },
    ]) expect(selectionTracks(frame(), { ...next, nodes: [next.nodes[0], { ...next.nodes[1], ...patch }] })).toEqual([]);
    expect(selectionTracks(frame(), { ...next, nodes: [{ ...next.nodes[0], box: { ...next.nodes[0].box, y: 4 } }, next.nodes[1]] })).toEqual([]);
});
