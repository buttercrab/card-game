import { expect, test, vi } from 'vitest';
import type { Environment, HostEffects, SurfaceCallbacks, SurfacePort, TableDocument } from './contracts';
import type { PreferenceField } from './roomShell';
import { shellDocument } from './shellFixture';
import { cardDocument } from './cardFixtures';
import { createCardSession } from './session';
import { createCardTable } from './runtime';
const environment: Environment = { width: 390, height: 844, revision: '1', fontRevision: '1', fontFamily: 'sans-serif', textScale: 1,
    controls: { command: { fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 16, paddingY: 10, minHeight: 44, pulse: 1 }, choice: { fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 14, paddingY: 8, minHeight: 40, pulse: 1.08 } } };
const fields: readonly PreferenceField[] = [
    { id: 'opaque-a', kind: 'toggle', label: '표시', enabled: true, value: false },
    { id: 'opaque-b', kind: 'number', label: '음량', enabled: true, value: 0.4, min: 0, max: 1, step: 0.1 },
    { id: 'opaque-c', kind: 'select', label: '선택', enabled: true, value: 'one', options: [{ id: 'one', label: '하나', enabled: true }, { id: 'two', label: '둘', enabled: true }, { id: 'locked', label: '잠김', enabled: false }] },
];
function document(preferences = fields, revision = 1) {
    const doc = shellDocument({ revision }), open = { id: 'settings-open', purpose: 'settings' as const, label: '설정', enabled: true, intent: { kind: 'open-page' as const, page: 'settings' as const } };
    return { ...doc, shell: { ...doc.shell!, header: { ...doc.shell!.header, actions: [...doc.shell!.header.actions, open] },
        pages: [...doc.shell!.pages, { id: 'settings' as const, title: '설정', preferences, actions: [{ id: 'settings-close', purpose: 'close' as const, label: '닫기', enabled: true, intent: { kind: 'close' as const } }] }] } };
}
function fixture<A>(doc: TableDocument<A>, effects?: HostEffects) {
    const send = vi.fn(), session = createCardSession<A>({ transport: send }); session.receive(doc);
    let callbacks: SurfaceCallbacks;
    const surface: SurfacePort = { identity: {}, environment: () => environment, listen(value) { callbacks = value; return () => {}; },
        measure(requests, reply) { reply(requests.map(request => { const natural = [...request.text].length * 8, width = request.width ?? natural; return { key: request.key, size: { width: Math.min(width, natural), height: Math.max(1, Math.ceil(natural / Math.max(1, width))) * 24 } }; })); return () => {}; },
        publish: () => {}, invalidate: () => {}, disarm: () => {}, fallback: vi.fn(), clear: () => {} };
    const table = createCardTable({ session, effects }); table.attach(surface);
    const activate = (nodeId: string) => callbacks.intent({ kind: 'activate', frameId: table.inspect().frame!.id, nodeId });
    return { table, session, send, activate, get callbacks() { return callbacks; }, dispose() { table.dispose(); session.dispose(); } };
}
function openSettings(f: ReturnType<typeof fixture>) { f.activate(f.table.inspect().frame!.nodes.find(node => node.shellActionId === 'settings-open')!.id); expect(f.table.inspect().shellPage).toBe('settings'); }
test('local native changes use exact canonical field/value/context and never game admission', () => {
    const changePreference = vi.fn(), f = fixture(document(), { invoke: vi.fn(), changePreference }); openSettings(f);
    const frame = f.table.inspect().frame!, toggle = frame.nodes.find(node => node.preference?.id === 'opaque-a')!;
    f.activate(toggle.id);
    expect(changePreference).toHaveBeenLastCalledWith({ fieldId: 'opaque-a', value: true }, f.session.snapshot().document!.context);
    for (const [id, value] of [['opaque-b', 0.8], ['opaque-c', 'two']] as const) {
        const node = frame.nodes.find(node => node.preference?.id === id)!;
        f.callbacks.intent({ kind: 'preference', frameId: frame.id, nodeId: node.id, value });
        expect(changePreference).toHaveBeenLastCalledWith({ fieldId: id, value }, f.session.snapshot().document!.context);
    }
    expect(Object.isFrozen(changePreference.mock.calls[0][0])).toBe(true);
    expect(f.session.snapshot().operations).toEqual([]); expect(f.send).not.toHaveBeenCalled(); f.dispose();
});
test('unknown, locked, disabled, wrong-type, out-of-range and off-step native changes are rejected', () => {
    const changePreference = vi.fn(), f = fixture(document([...fields, { ...fields[0], id: 'disabled', enabled: false }]), { invoke: vi.fn(), changePreference }); openSettings(f);
    const frame = f.table.inspect().frame!;
    for (const [id, value] of [['opaque-b', 2], ['opaque-b', NaN], ['opaque-b', 0.55], ['opaque-b', '0.5'], ['opaque-c', 'foreign'], ['opaque-c', 'locked'], ['opaque-a', 'true'], ['disabled', true], ['missing', true]] as const) {
        const node = frame.nodes.find(node => node.preference?.id === id);
        f.callbacks.intent({ kind: 'preference', frameId: frame.id, nodeId: node?.id ?? 'foreign-control', value });
    }
    expect(changePreference).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); f.dispose();
});
test('preference input cannot cross frame replacement, modal dismissal or audience revocation', () => {
    const changePreference = vi.fn(), f = fixture(document(), { invoke: vi.fn(), changePreference }); openSettings(f);
    const old = f.table.inspect().frame!, node = old.nodes.find(node => node.preference?.id === 'opaque-b')!;
    f.session.receive(document(fields, 2));
    f.callbacks.intent({ kind: 'preference', frameId: old.id, nodeId: node.id, value: 0.8 });
    const current = f.table.inspect().frame!;
    f.table.back(); f.callbacks.intent({ kind: 'preference', frameId: current.id, nodeId: node.id, value: 0.8 });
    f.session.revoke(); f.callbacks.intent({ kind: 'preference', frameId: current.id, nodeId: node.id, value: 0.8 });
    expect(changePreference).not.toHaveBeenCalled(); f.dispose();
});
test('range focus and bounded page history survive compatible preference publications', () => {
    const f = fixture(document(), { invoke: vi.fn(), changePreference: vi.fn() }); openSettings(f);
    const old = f.table.inspect().frame!, node = old.nodes.find(node => node.preference?.id === 'opaque-b')!;
    f.callbacks.intent({ kind: 'focus', frameId: old.id, nodeId: node.id });
    f.session.receive(document(fields.map(field => field.id === 'opaque-b' ? { ...field, value: 0.8 } : field) as PreferenceField[], 2));
    expect(f.table.inspect().frame!.focusId).toBe(node.id);
    for (let index = 0; index < 40; index++) { f.table.back(); openSettings(f); }
    expect(f.table.inspect().shellHistoryDepth).toBeLessThanOrEqual(5); f.dispose();
});
test('no local effect capability means controls remain disabled; backend unavailability does not disable device settings', () => {
    const absent = fixture(document(), { invoke: vi.fn() }); openSettings(absent);
    expect(absent.table.inspect().frame!.nodes.filter(node => node.preference).every(node => !node.enabled)).toBe(true); absent.dispose();
    const changePreference = vi.fn(), present = fixture(document(), { invoke: vi.fn(), changePreference });
    present.session.receive(document(), { connected: false }); openSettings(present);
    present.activate(present.table.inspect().frame!.nodes.find(node => node.preference?.id === 'opaque-a')!.id);
    expect(changePreference).toHaveBeenCalledTimes(1); present.dispose();
});
test.each(['single', 'repeat'] as const)('one-card %s activation uses only an unambiguous current offered action', async policy => {
    const source = cardDocument('play'), f = fixture({ ...source, interaction: { cardActivation: policy } });
    const first = f.table.inspect().frame!.nodes.find(node => node.cardId)!;
    f.activate(first.id);
    await Promise.resolve();
    expect(f.send).toHaveBeenCalledTimes(policy === 'single' ? 1 : 0);
    if (policy === 'repeat') { f.activate(first.id); await Promise.resolve(); expect(f.send).toHaveBeenCalledTimes(1); }
    expect(f.send.mock.calls[0][0].action).toEqual({ Play: { cardId: first.cardId } }); f.dispose();
});
test('multi-card drafts and default explicit-confirmation behavior never inherit one-card auto-submit', async () => {
    const many = fixture({ ...cardDocument('discard'), interaction: { cardActivation: 'single' as const } });
    const cards = many.table.inspect().frame!.nodes.filter(node => node.cardId).slice(0, 3);
    for (const card of cards) many.activate(card.id);
    await Promise.resolve(); expect(many.send).not.toHaveBeenCalled(); many.dispose();
    const explicit = fixture(cardDocument('play')); const card = explicit.table.inspect().frame!.nodes.find(node => node.cardId)!;
    explicit.activate(card.id); explicit.activate(card.id); await Promise.resolve(); expect(explicit.send).not.toHaveBeenCalled(); explicit.dispose();
});
test('automatic one-card admission cannot cross a held frame or execute a disabled variant', async () => {
    const source = cardDocument('play'), f = fixture({ ...source, interaction: { cardActivation: 'repeat' as const } });
    const before = f.table.inspect().frame!, card = before.nodes.find(node => node.cardId)!;
    f.callbacks.intent({ kind: 'begin', frameId: before.id, nodeId: card.id });
    f.session.receive({ ...cardDocument('play', { revision: 2 }), interaction: { cardActivation: 'single' } });
    f.callbacks.intent({ kind: 'activate', frameId: before.id, nodeId: card.id });
    await Promise.resolve(); expect(f.send).not.toHaveBeenCalled(); f.dispose();
    const disabled = fixture({ ...source, interaction: { cardActivation: 'single' as const }, offer: { ...source.offer, actions: source.offer.actions.map(action => ({ ...action, enabled: false })) } });
    const target = disabled.table.inspect().frame!.nodes.find(node => node.cardId)!;
    disabled.activate(target.id); await Promise.resolve(); expect(disabled.send).not.toHaveBeenCalled(); disabled.dispose();
});
