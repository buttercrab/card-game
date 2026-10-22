import {expect, test, vi} from 'vitest';
import type {CandidateLayout, Environment, TableDocument} from './contracts';
import {createCardTable} from './runtime';
import {createCardSession} from './session';
import {persistentCaptionDocument} from './shellFixture';
import {typography, validateLayout} from './planner';

const controls = {
    command: {fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 16, paddingY: 10, minHeight: 44, pulse: 1},
    choice: {fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 14, paddingY: 8, minHeight: 40, pulse: 1.08},
};
function harness<A>(source: TableDocument<A>, width = 461, height = 677, gutter = 15) {
    const environment: Environment = {width, height, textScale: 1, scrollbarWidth: gutter, scrollbarHeight: gutter,
        revision: 'narrow-hand-budget', fontRevision: 'narrow-hand-budget', fontFamily: 'sans-serif', controls};
    const session = createCardSession<A>({transport: () => {}}), fallback = vi.fn();
    session.receive(source);
    const table = createCardTable({session});
    table.attach({identity: {}, environment: () => environment, listen: () => () => {},
        measure(batch, reply) {
            reply(batch.map(request => {
                const natural = [...request.text].length * 9 * environment.textScale;
                const allocation = request.width ?? natural;
                return {key: request.key, size: {width: Math.min(natural, allocation),
                    height: Math.max(1, Math.ceil(natural / Math.max(1, allocation))) * typography(request.role, environment).lineHeight}};
            }));
            return () => {};
        }, publish() {}, disarm() {}, invalidate() {}, clear() {}, fallback});
    return {session, environment,
        frame() {expect(table.inspect().status, JSON.stringify(fallback.mock.calls)).toBe('ready'); return table.inspect().frame!;},
        close() {table.dispose(); session.dispose();}};
}
function global(layout: CandidateLayout, id: string) {
    let node = layout.nodes.find(node => node.id === id)!;
    const bounds = {...node.box};
    while (node.parent) {
        node = layout.nodes.find(parent => parent.id === node.parent)!;
        bounds.x += node.box.x; bounds.y += node.box.y;
    }
    return bounds;
}
function completeHand(layout: CandidateLayout, environment: Environment) {
    expect(validateLayout(layout)).toEqual([]);
    expect(layout.height).toBe(environment.height);
    expect(layout.nodes.find(node => node.id === 'table')?.scroll).not.toBe(true);
    const hand = layout.nodes.find(node => node.id === 'hand')!, bounds = global(layout, hand.id);
    expect(hand.scroll).not.toBe(true);
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(environment.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(environment.height);
    const cards = layout.nodes.filter(node => node.zoneId === 'hand' && node.entityId);
    expect(cards).toHaveLength(10);
    for (const card of cards) {
        const box = global(layout, card.id);
        expect(card.box.width).toBeGreaterThanOrEqual(56);
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.y).toBeGreaterThanOrEqual(bounds.y);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
        expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
    }
    // Real session-derived decisions, never the empty-choice geometry shortcut.
    const commands = layout.nodes.filter(node => node.kind === 'command').map(node => node.label);
    expect(commands).toEqual(expect.arrayContaining(['공약 ♠ 스페이드 14', '패스']));
}
// Actual500px browser surface:461 with root gutter,476 once that gutter goes away.
// Both axes use native15px scrollbars; overlay-only tests miss this regression.
for (const width of [461, 476]) for (const gutter of [0, 15]) for (const badges of [false, true]) {
    test(`complete narrow hand ${width}×677 gutter${gutter} badges${badges}`, () => {
        const h = harness(persistentCaptionDocument({badges}), width, 677, gutter);
        try {
            const frame = h.frame(); completeHand(frame, h.environment);
            expect(frame.nodes.some(node => node.id === 'room-notices')).toBe(false);
            expect(global(frame, 'hand').width).toBe(256);
        } finally {h.close();}
    });
}
test.each([[390, 844], [500, 757], [1158, 677]])('complete hand survives adjacent viewport%s×%s', (width, height) => {
    const h = harness(persistentCaptionDocument({badges: true}), width, height);
    try {completeHand(h.frame(), h.environment);} finally {h.close();}
});
test.each([461, 476])('important notice appears and disappears without moving the hand at%s', width => {
    const h = harness(persistentCaptionDocument({badges: true}), width);
    try {
        const before = global(h.frame(), 'hand');
        for (const [index, notice] of [true, false].entries()) {
            h.session.receive(persistentCaptionDocument({revision: index + 2, badges: true, notice}));
            const frame = h.frame(); completeHand(frame, h.environment);
            expect(global(frame, 'hand')).toEqual(before);
            const band = frame.nodes.find(node => node.id === 'room-notices');
            if (notice) {
                expect(band?.scroll).not.toBe(true); expect(band?.box.height).toBe(20);
                expect(frame.nodes.some(node => node.label === '잠깐 다시 연결하는 중…')).toBe(true);
            } else expect(band).toBeUndefined();
        }
    } finally {h.close();}
});
test('long important notice retains bounded native scrolling rather than losing its text', () => {
    const source = persistentCaptionDocument({notice: true}), text = '다시 연결하는 동안 중요한 안내를 확인하세요. '.repeat(10);
    const h = harness({...source, shell: {...source.shell!, notices: [{id: 'long-notice', text, tone: 'plain'}]}});
    try {
        const frame = h.frame(), band = frame.nodes.find(node => node.id === 'room-notices')!;
        expect(validateLayout(frame)).toEqual([]);
        expect(band.scroll).toBe(true); expect(band.scrollAxis).toBe('y');
        expect(band.box.height).toBeGreaterThanOrEqual(44); expect(band.scrollbarGutter).toBe(15);
        expect(frame.nodes.some(node => node.label === text)).toBe(true);
    } finally {h.close();}
});
