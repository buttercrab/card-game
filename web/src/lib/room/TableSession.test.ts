import { describe, expect, test, vi } from 'vitest';
import { TableSession } from './TableSession.svelte';
import { SessionCore, type SessionUi } from './sessionCore';
import { TableUi } from './ui.svelte';
import type { TableClient } from './tableClient';
import type { GameTypes, RoomViewOf } from './types';

// A three-seat game whose payloads share no Mighty concepts or imports.
interface CountingGame extends GameTypes {
  settings: { goal: number };
  rules: { direction: 'up' };
  view: { total: number };
  action: { increment: number };
  notes: { remaining: number };
  hand: { winner: string };
}

function fixture() {
  const room = {
    seats: [{ kind: 'empty' }, { kind: 'bot', name: 'Counter', level: 'easy' }, { kind: 'human', name: 'Player', connected: true, away: false }],
    participant_ids: ['empty:0', 'counter', 'player'], participation: [],
    table: { shuffle: false, shuffle_next: false, turn_secs: 0 },
    ready: [false, true, false], in_hand: false,
    settings: { goal: 12 }, rules: { direction: 'up' },
  } as unknown as RoomViewOf<CountingGame>;
  const client = {
    seat: null as number | null, viewerId: 'visitor', viewerName: 'Visitor', status: 'open' as const,
    observe: vi.fn(), join: vi.fn(), requestSeat: vi.fn(), acceptSeat: vi.fn(), notice: vi.fn(),
    swapSeats: vi.fn(), addBot: vi.fn(), removeBot: vi.fn(), clearSeat: vi.fn(), leave: vi.fn(),
    setTable: vi.fn(), ready: vi.fn(), start: vi.fn(),
  };
  const ui: SessionUi = {
    participationSeat: null, swapFrom: null, seatMenu: null,
    closeSeat() { this.seatMenu = null; },
  };
  const session = new SessionCore(client, ui, () => room);
  session.sitName = 'Visitor';
  return { room, client, ui, session };
}

describe('generic table seat admission', () => {
  test('joins the bottom directly, previews another seat, and restores orientation on cancel', () => {
    const { client, session } = fixture();
    expect(session.bottom).toBe(0);
    session.sitAt(0);
    expect(client.join).toHaveBeenCalledWith('Visitor', 0);
    session.sitAt(1);
    expect(session.previewSeat).toBe(1);
    expect(session.bottom).toBe(1);
    session.cancelChoice();
    expect(session.bottom).toBe(0);
    session.sitAt(1);
    session.confirmChoice();
    expect(client.join).toHaveBeenLastCalledWith('Visitor', 1);
  });

  test('requests during a hand, accepts an offered human seat, and blocks another reservation', () => {
    const { room, client, session } = fixture();
    room.in_hand = true;
    session.sitAt(0);
    expect(client.requestSeat).toHaveBeenCalledWith(true, 0);
    expect(client.join).not.toHaveBeenCalled();
    room.in_hand = false;
    room.participation = [{ id: 'visitor', name: 'Visitor', order: 1, seat: 2, target_id: 'player', offered_by: 'player' }];
    session.sitAt(2);
    session.confirmChoice();
    expect(client.acceptSeat).toHaveBeenCalledWith(2, 'player');
    room.participation = [{ id: 'other', name: 'Other', order: 1, seat: 1, target_id: 'counter', offered_by: null }];
    session.sitAt(1);
    expect(session.previewSeat).toBeNull();
    expect(client.notice).toHaveBeenCalledWith('이 자리는 다른 분이 확인하는 중이에요');
  });

  test('a changed identity rejects confirmation and restores the previous bottom', () => {
    const { room, client, session } = fixture();
    session.sitAt(1);
    room.participant_ids![1] = 'replacement';
    session.confirmChoice();
    expect(client.join).not.toHaveBeenCalled();
    expect(session.bottom).toBe(0);
    expect(session.previewSeat).toBeNull();
    expect(client.notice).toHaveBeenCalledWith('자리가 바뀌었어요. 참여할 자리를 다시 골라주세요');
  });

  test('all admission commands wait for the draft name acknowledgement and recheck identity', () => {
    const { room, client, session } = fixture();
    session.sitName = ' New name ';
    session.sitAt(0);
    expect(client.observe).toHaveBeenCalledWith('New name');
    expect(client.join).not.toHaveBeenCalled();
    client.viewerName = 'New name';
    session.sync();
    expect(client.join).toHaveBeenCalledWith('New name', 0);
    session.sync();
    expect(client.join).toHaveBeenCalledTimes(1);
    room.in_hand = true;
    session.sitName = 'Next name';
    session.sitAt(0);
    expect(client.requestSeat).not.toHaveBeenCalled();
    room.participant_ids![0] = 'new occupant';
    client.viewerName = 'Next name';
    session.sync();
    expect(client.requestSeat).not.toHaveBeenCalled();
  });

  test('name acknowledgement precedes both a next-hand request and offered-seat acceptance', () => {
    const { room, client, session } = fixture();
    room.in_hand = true;
    session.sitName = 'Waiting';
    session.sitAt(0);
    expect(client.requestSeat).not.toHaveBeenCalled();
    client.viewerName = 'Waiting';
    session.sync();
    expect(client.requestSeat).toHaveBeenCalledWith(true, 0);
    room.in_hand = false;
    room.participation = [{ id: 'visitor', name: 'Waiting', order: 1, seat: 2, target_id: 'player', offered_by: 'player' }];
    session.sitName = 'Accepted';
    session.sitAt(2);
    session.confirmChoice();
    expect(client.acceptSeat).not.toHaveBeenCalled();
    client.viewerName = 'Accepted';
    session.sync();
    expect(client.acceptSeat).toHaveBeenCalledWith(2, 'player');
    session.sitName = '   ';
    session.withName(() => client.requestSeat(true));
    expect(client.requestSeat).toHaveBeenCalledTimes(1);
  });

  test('acknowledged renames update a clean draft while preserving an edited draft', () => {
    const { client, session } = fixture();
    client.viewerName = 'Settings rename';
    session.sync();
    expect(session.sitName).toBe('Settings rename');
    session.sitName = 'Unsaved draft';
    client.viewerName = 'Another acknowledged name';
    session.sync();
    expect(session.sitName).toBe('Unsaved draft');
  });

  test('cancelling a choice cancels admission waiting for a name acknowledgement', () => {
    const { client, session } = fixture();
    session.sitName = 'Pending';
    session.sitAt(0);
    expect(client.observe).toHaveBeenCalledWith('Pending');
    session.cancelChoice();
    client.viewerName = 'Pending';
    session.sync();
    expect(client.join).not.toHaveBeenCalled();
    expect(client.requestSeat).not.toHaveBeenCalled();
  });
});

describe('shared seat and session commands', () => {
  test('bot changes protect reservations and accept only empty, bot, or disconnected human seats', () => {
    const { client, room, session } = fixture();
    client.seat = 2;
    room.participation = [{ id: 'visitor', name: 'Visitor', order: 1, seat: 1, target_id: 'counter', offered_by: null }];
    session.addBot(1, 'hard');
    session.removeBot(1);
    session.relieve(1);
    expect(client.addBot).not.toHaveBeenCalled();
    expect(client.removeBot).not.toHaveBeenCalled();
    room.participation = [];
    session.addBot(2);
    session.addBot(99);
    session.removeBot(0);
    expect(client.addBot).not.toHaveBeenCalled();
    expect(client.removeBot).not.toHaveBeenCalled();
    room.seats[2] = { kind: 'human', name: 'Offline', connected: false, away: true };
    session.addBot(2);
    expect(client.addBot).toHaveBeenCalledWith(2, undefined);
    session.addBot(0);
    session.removeBot(1);
    expect(client.addBot).toHaveBeenCalledWith(0, undefined);
    expect(client.removeBot).toHaveBeenCalledWith(1);
  });

  test('standing preserves the latest seat before a synchronous leave acknowledgement', () => {
    const { client, session } = fixture();
    client.seat = 2;
    client.leave.mockImplementation(() => { client.seat = null; });
    session.stand();
    expect(session.bottom).toBe(2);
  });
  test('keeps seated orientation on stand and owns menu actions and active-hand guards', () => {
    const { client, room, ui, session } = fixture();
    client.seat = 2;
    session.sync();
    session.openSeat(1);
    expect(ui.seatMenu).toBe(1);
    session.addBot(1, 'hard');
    expect(client.addBot).toHaveBeenCalledWith(1, 'hard');
    expect(ui.seatMenu).toBe(1);
    session.swap(2);
    session.openSeat(0);
    expect(client.swapSeats).toHaveBeenCalledWith(2, 0);
    session.stand();
    expect(client.leave).toHaveBeenCalledOnce();
    client.seat = null;
    expect(session.bottom).toBe(2);
    ui.participationSeat = 1;
    session.sync();
    expect(ui.participationSeat).toBeNull();
    expect(session.previewSeat).toBe(1);
    client.seat = 2;
    ui.seatMenu = 1;
    ui.swapFrom = 2;
    room.in_hand = true;
    session.sync();
    expect(ui.seatMenu).toBeNull();
    expect(ui.swapFrom).toBeNull();
    session.kick(1);
    expect(client.clearSeat).not.toHaveBeenCalled();
  });

  test('centers again after a hand settles and shares readiness and persistent shuffle commands', () => {
    const { room, client, session } = fixture();
    expect(session.centered).toBe(true);
    room.in_hand = true;
    expect(session.centered).toBe(false);
    room.in_hand = false;
    session.settling = true;
    expect(session.centered).toBe(false);
    session.settling = false;
    expect(session.centered).toBe(true);
    session.setShuffle(true);
    expect(client.setTable).toHaveBeenCalledWith({ shuffle: true, shuffle_next: false });
    room.seats[0] = { kind: 'bot', name: 'Other counter', level: 'easy' };
    client.seat = 2;
    session.advance();
    expect(client.start).toHaveBeenCalledOnce();
    room.seats[0] = { kind: 'human', name: 'Other', connected: true, away: false };
    session.advance();
    expect(client.ready).toHaveBeenCalledWith(true);
  });
});


test('the Svelte adapter preserves the session API and delegates core decisions', () => {
  const { client, room } = fixture();
  const adapter = new TableSession(client as unknown as TableClient<CountingGame>, new TableUi(), () => room, { initialBottom: 1 });
  adapter.sitName = 'Visitor';
  expect(adapter.bottom).toBe(1);
  adapter.sitAt(0);
  expect(adapter.previewSeat).toBe(0);
  adapter.confirmChoice();
  expect(client.join).toHaveBeenCalledWith('Visitor', 0);
  adapter.settling = true;
  expect(adapter.centered).toBe(false);
  adapter.setShuffle(true);
  expect(client.setTable).toHaveBeenCalledWith({ shuffle: true, shuffle_next: false });
});
