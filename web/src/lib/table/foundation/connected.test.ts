import { expect, test, vi } from 'vitest';
import { createConnectedCommandClient, submitConnectedOnce, type ConnectedCommandClient } from './connected';
import type { GameTypes } from '../../room/types';
import { createCardSession } from './session';
import { proofDocument } from './fixtures';

test('adapter command input is an inert whitelisted object without owner methods', () => {
    const owner = { status: 'open' as const, room: null, game: null, seat: null, viewerId: 'viewer', viewerName: 'Viewer',
        act: vi.fn(), join: vi.fn(), start: vi.fn(), close: vi.fn(), commands: { submit: vi.fn() } };
    const view = createConnectedCommandClient<GameTypes>(owner);
    expect(view).not.toBe(owner);
    expect(Object.keys(view).sort()).toEqual(['game', 'room', 'seat', 'status', 'viewerId', 'viewerName']);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.getPrototypeOf(view)).toBe(Object.prototype);
    for (const method of ['act', 'join', 'start', 'ready', 'leave', 'close', 'commands']) expect(method in view).toBe(false);
    const forbidden = (client: ConnectedCommandClient<GameTypes>) => {
        // @ts-expect-error Command adapters have no direct action capability.
        client.act('play');
        // @ts-expect-error Command adapters cannot get transport through the client.
        client.commands.submit('operation', {}, 'play');
        // @ts-expect-error Host state is a read-only projection.
        client.status = 'closed';
    };
    expect(forbidden).toBeTypeOf('function');
});

test('successful game and room callbacks establish the actual submission result', () => {
    const game = vi.fn(() => true), room = vi.fn(() => true);
    expect(submitConnectedOnce(send => send('play'), game, room)).toBe(true);
    expect(game).toHaveBeenCalledExactlyOnceWith('play'); expect(room).not.toHaveBeenCalled();
    game.mockClear();
    expect(submitConnectedOnce((_, send) => send('ready'), game, room)).toBe(true);
    expect(room).toHaveBeenCalledExactlyOnceWith('ready'); expect(game).not.toHaveBeenCalled();
});
test('only one callback may execute across both domains, even when the first rejects', () => {
    for (const firstAccepted of [false, true]) for (const first of ['game', 'room']) {
        const game = vi.fn(() => firstAccepted), room = vi.fn(() => firstAccepted);
        const result = submitConnectedOnce((sendGame, sendRoom) => {
            const start = first === 'game' ? sendGame : sendRoom;
            const next = first === 'game' ? sendRoom : sendGame;
            expect(start('first')).toBe(firstAccepted);
            expect(next('second')).toBe(false);
            expect(start('third')).toBe(false);
            return true;
        }, game, room);
        expect(result).toBe(firstAccepted);
        expect(game.mock.calls.length + room.mock.calls.length).toBe(1);
    }
});
test('adapter return values cannot manufacture admission without a callback', () => {
    for (const answer of [false, true]) {
        const game = vi.fn(() => true), room = vi.fn(() => true);
        expect(submitConnectedOnce(() => answer, game, room)).toBe(false);
        expect(game).not.toHaveBeenCalled(); expect(room).not.toHaveBeenCalled();
    }
    expect(submitConnectedOnce(() => { throw new Error('adapter before send'); }, () => true, () => true)).toBe(false);
});
test('false or throw after actual admission cannot report a local rejection', () => {
    for (const fail of [false, true]) {
        const send = vi.fn(() => true);
        expect(submitConnectedOnce(submit => {
            submit('play');
            if (fail) throw new Error('adapter after send');
            return false;
        }, send, () => true)).toBe(true);
        expect(send).toHaveBeenCalledTimes(1);
    }
});
test('a transport rejection remains rejected regardless of the adapter assertion', () => {
    const game = vi.fn(() => false);
    expect(submitConnectedOnce(send => { send('play'); return true; }, game, () => true)).toBe(false);
    expect(game).toHaveBeenCalledTimes(1);
});
test('transport exceptions stay uncertain even if the adapter catches them', () => {
    const transportError = new Error('possibly transmitted');
    const room = vi.fn(() => true), game = vi.fn(() => { throw transportError; });
    expect(() => submitConnectedOnce((sendGame, sendRoom) => {
        try { sendGame('play'); } catch { /* Adapter cannot relabel uncertainty. */ }
        expect(sendRoom('ready')).toBe(false);
        return false;
    }, game, room)).toThrow(transportError);
    expect(game).toHaveBeenCalledTimes(1); expect(room).not.toHaveBeenCalled();
});
test('retained callbacks lose authority when the synchronous hook returns', () => {
    let retained: ((action: string) => boolean) | undefined;
    const game = vi.fn(() => true);
    expect(submitConnectedOnce(send => { retained = send; return true; }, game, () => true)).toBe(false);
    expect(retained!('late')).toBe(false); expect(game).not.toHaveBeenCalled();
});
test('session keeps admitted operations uncertain until a correlated receipt despite adapter failure', async () => {
    for (const fail of [false, true]) {
        const transport = vi.fn(() => true);
        const session = createCardSession({ transport(submission) {
            const accepted = submitConnectedOnce(send => {
                send(submission.action);
                if (fail) throw new Error('after admission');
                return false;
            }, transport, () => false);
            if (!accepted) session.resolve(submission.id, 'rejected');
        } });
        session.receive(proofDocument());
        const doc = session.snapshot().document!, action = doc.offer.actions.find(item => item.kind === 'command')!;
        if (action.kind !== 'command') throw new Error('Command fixture');
        expect(session.admit(doc.context, doc.offer.id, action.id, action.action)).toBe(true);
        await Promise.resolve();
        expect(transport).toHaveBeenCalledTimes(1);
        const operation = session.snapshot().operations[0];
        expect(operation.status).toBe('uncertain');
        session.resolve(operation.id, 'accepted');
        expect(session.snapshot().operations[0].status).toBe('accepted');
        session.dispose();
    }
});
test('session rejects a known-unsent operation instead of waiting for an impossible receipt', async () => {
    const session = createCardSession({ transport(submission) {
        const accepted = submitConnectedOnce(() => true, () => true, () => true);
        if (!accepted) session.resolve(submission.id, 'rejected');
    } });
    session.receive(proofDocument());
    const doc = session.snapshot().document!, action = doc.offer.actions.find(item => item.kind === 'command')!;
    if (action.kind !== 'command') throw new Error('Command fixture');
    session.admit(doc.context, doc.offer.id, action.id, action.action);
    await Promise.resolve();
    expect(session.snapshot().operations[0].status).toBe('rejected');
    session.dispose();
});
