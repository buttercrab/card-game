import { validateTableDecision } from './decisions';
import { describe, expect, test, vi } from 'vitest';
import { DecisionController, reconcileChoices, validateDecision } from '../decision';
import { pressureDocument, type PressureKind } from './pressureFixtures';

describe('semantic game composition pressure fixtures', () => {
    test.each<PressureKind>(['poker', 'melds', 'one-card'])('%s supplies a valid exact offer and stable semantic identities', kind => {
        const document = pressureDocument(kind, { longName: true, cards: 40, revision: 3 });
        expect(validateTableDecision(document)).toEqual([]);
        expect(document.context).toEqual({ session: 'foundation-proof', audience: 'player', generation: '1', revision: '3' });
        expect(document.hand).toHaveLength(40);
        const ids = [...document.hand.map(card => card.id), ...document.collections!.flatMap(group => group.cards.map(card => card.id))];
        expect(new Set(ids).size).toBe(ids.length);
        expect(document.offer.actions.every(action => action.kind === 'command')).toBe(true);
        expect(pressureDocument(kind, { longName: true, cards: 40, revision: 3 })).toEqual(document);
    });

    test.each([false, true])('poker binds the whole joint tuple to the exact amount including exceptional all-in (sparse=%s)', sparse => {
        const document = pressureDocument('poker', { sparse });
        const spec = document.decision;
        if (spec.kind !== 'finite-choice') throw new Error('Expected finite poker choice');
        expect(document.collections![0].cards).toHaveLength(5);
        const amounts = sparse ? [40, 160] : [40, 80, 160];
        expect(spec.variants.map(row => row.tuple)).toEqual([
            ...amounts.map(amount => ({ 'bet-kind': 'raise', amount: String(amount) })),
            { 'bet-kind': 'all-in', amount: '37' },
        ]);
        const send = vi.fn();
        const controller = new DecisionController(send);
        const handle = controller.bind(spec, document.offer, 'foundation-proof:player');
        for (const row of spec.variants) {
            expect(controller.choose(handle, 'amount', row.tuple.amount)).toBe(true);
            const selected = controller.snapshot(handle)?.selected;
            expect(selected?.id).toBe(row.actionId);
            const payload = selected?.action;
            expect(payload).toEqual(row.tuple['bet-kind'] === 'all-in'
                ? { kind: 'poker-all-in', amount: 37 }
                : { kind: 'poker-raise', amount: Number(row.tuple.amount) });
        }
        expect(reconcileChoices(spec, document.offer, spec.initialValues, 'amount', '41')).toBeNull();
        expect(spec.variants.some(row => row.tuple['bet-kind'] === 'raise' && row.tuple.amount === '37')).toBe(false);
        if (sparse) expect(reconcileChoices(spec, document.offer, spec.initialValues, 'amount', '80')).toBeNull();
        const token = controller.capture(handle, 'poker:all-in:37');
        expect(token).not.toBeNull();
        expect(controller.dispatch(token!)).toBe(true);
        expect(send).toHaveBeenCalledWith({ kind: 'poker-all-in', amount: 37 }, document.offer.id);
    });

    test('melds pressure many individually identified runs and sets without claiming structured selection legality', () => {
        const document = pressureDocument('melds', { longName: true });
        expect(document.decision.kind).toBe('commands');
        expect(document.collections).toHaveLength(12);
        for (const [index, group] of document.collections!.entries()) {
            const faces = group.cards.map(card => {
                if (card.visual.kind !== 'standard') throw new Error('Expected standard face');
                return card.visual;
            });
            if (index % 2 === 0) {
                expect(new Set(faces.map(face => face.suit)).size).toBe(1);
                expect(faces.map(face => face.rank)).toEqual(Array.from({ length: 4 }, (_, offset) => 2 + index % 10 + offset));
            } else {
                expect(new Set(faces.map(face => face.rank)).size).toBe(1);
                expect(new Set(faces.map(face => face.suit)).size).toBe(3);
            }
        }
    });

    test('one-card exposes only authorized discard faces and independent catch command', () => {
        const document = pressureDocument('one-card');
        expect(document.collections!.find(group => group.id === 'one-card:stock')?.cards).toEqual([]);
        expect(document.collections!.find(group => group.id === 'one-card:discard')?.cards).toHaveLength(1);
        expect(document.facts.find(fact => fact.id === 'effective-suit')?.value).toContain('클로버');
        expect(document.facts.find(fact => fact.id === 'pending-penalty')?.value).toContain('4장');
        expect(document.decision.commands).toEqual(['one-card:draw', 'one-card:catch']);
        const controller = new DecisionController(vi.fn());
        if(document.decision.kind==='card-selection'||document.decision.kind==='composition')throw new Error('Expected legacy finite/command fixture');
        const handle = controller.bind(document.decision, document.offer, 'foundation-proof:player');
        expect(controller.snapshot(handle)?.commands.map(command => command.action)).toEqual([{ kind: 'one-card-draw' }, { kind: 'one-card-catch' }]);
    });
});
