import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const played = vi.hoisted(() => ({ errors: 0 }));
vi.mock('../sound', () => ({
  sound: {
    error: () => played.errors++,
    react: () => {},
  },
}));

import { RoomClient } from './client.svelte';
import { Toasts } from './toast.svelte';
import type { GameTypes, StateMsgOf } from './types';

/** A WebSocket the test drives: it opens, talks and drops when told. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** The link drops from the server's side. */
  drop() {
    this.close();
  }
}

class MemoryStorage {
  #items = new Map<string, string>();
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value);
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
}

/** The answer to the "does the table exist" fetch, held until released. */
let release: ((status: number) => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  played.errors = 0;
  release = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'test' });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('crypto', { randomUUID: () => 'device' });
  vi.stubGlobal(
    'fetch',
    () => new Promise((resolve) => (release = (status: number) => resolve({ status }))),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sockets = () => FakeSocket.all.length;
const last = () => FakeSocket.all[FakeSocket.all.length - 1];

function state(version: number): { type: 'state' } & StateMsgOf<GameTypes> {
  return {
    type: 'state',
    view: {},
    legal: [],
    notes: null,
    turn: 'Over',
    out_of_turn: [],
    grace_ms: 0,
    version,
  };
}

describe('closing', () => {
  test('a reconnect already scheduled never runs', async () => {
    const client = new RoomClient('abc');
    last().open();
    last().drop();
    expect(client.status).toBe('closed');
    client.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets()).toBe(1);
  });

  test('closing while asking whether the table exists stays closed', async () => {
    const client = new RoomClient('abc');
    // Never opened: the client asks the server whether the table is there.
    last().drop();
    client.close();
    release!(200);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets()).toBe(1);
    expect(client.status).not.toBe('missing');
  });

  test('close stops the reaction timers and takes the toast down', async () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive({ type: 'reaction', seat: 1, text: '👏' });
    client.notice('자리를 섞었어요');
    client.close();
    expect(client.toasts.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the client reconnects on its own until closed', async () => {
    const client = new RoomClient('abc');
    last().open();
    last().drop();
    await vi.advanceTimersByTimeAsync(600);
    expect(sockets()).toBe(2);
    client.close();
  });
});

describe('leaving', () => {
  test('leaving while reconnecting forgets the seat, so it is never reclaimed', async () => {
    const client = new RoomClient('abc');
    const first = last();
    first.open();
    first.receive({ type: 'welcome', seat: 2, token: 'secret' });
    expect(localStorage.getItem('room:abc')).toContain('secret');
    first.drop();
    expect(client.seat).toBeNull();

    client.leave();
    client.close();
    expect(localStorage.getItem('room:abc')).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets()).toBe(1);
  });

  test('a reconnect without a saved seat does not try to reclaim one', async () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive({ type: 'welcome', seat: 2, token: 'secret' });
    last().drop();
    client.leave();
    await vi.advanceTimersByTimeAsync(600);
    expect(sockets()).toBe(2);
    last().open();
    expect(last().sent).toEqual([]);
    client.close();
  });

  test('leaving while seated tells the server', () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive({ type: 'welcome', seat: 0, token: 't' });
    client.leave();
    expect(last().sent).toContainEqual({ type: 'leave' });
    client.close();
  });
});

describe('hints', () => {
  test('a hint for an older state is dropped', () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive(state(4));
    last().receive({ type: 'hint', version: 3, action: 'Pass' });
    expect(client.hint).toBeNull();
    last().receive({ type: 'hint', version: 4, action: 'Pass' });
    expect(client.hint).toBe('Pass');
    // The hand moves on: the hint goes, and a late one stays out.
    last().receive(state(5));
    expect(client.hint).toBeNull();
    last().receive({ type: 'hint', version: 4, action: 'Pass' });
    expect(client.hint).toBeNull();
    client.close();
  });

  test('a hint with no hand on the table is dropped', () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive({ type: 'hint', version: 0, action: 'Pass' });
    expect(client.hint).toBeNull();
    client.close();
  });
});

describe('a table that closed', () => {
  test('is missing, without a toast or a reconnect', async () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive({ type: 'error', code: 'table_gone' });
    last().drop();
    expect(client.status).toBe('missing');
    expect(client.toasts.current).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets()).toBe(1);
    client.close();
  });
});

describe('the session', () => {
  const room = (names: string[]) => ({
    type: 'room',
    protocol: 'x',
    id: 'abc',
    game: 'mighty',
    settings: { preset: 'gshs' },
    rules: {},
    customized: false,
    seats: names.map((name) => ({ kind: 'human', name, connected: true, away: false })),
    in_hand: false,
    table: { turn_secs: 0, shuffle: false, shuffle_next: false },
    clock: null,
    watching: 0,
    showing: false,
  });
  const session = (scores: number[]) => ({ type: 'session', scores, hands_played: 1, history: [scores], hands: [] });

  test('the table keeps the last session sent, through rooms without one', () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive(session([3, -3]));
    last().receive(room(['A', 'B']));
    expect(client.room?.scores).toEqual([3, -3]);
    expect(client.room?.hands_played).toBe(1);
    last().receive(room(['A', 'C']));
    expect(client.room?.seats[1]).toMatchObject({ name: 'C' });
    expect(client.room?.scores).toEqual([3, -3]);
    // A session on its own updates the table at once.
    last().receive(session([5, -5]));
    expect(client.room?.scores).toEqual([5, -5]);
    client.close();
  });

  test('while seats move, the scores move with the room that moves them', () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive(session([3, -3]));
    last().receive(room(['A', 'B']));
    last().receive({ type: 'seats_moved', how: 'swap', seats: [0, 1] });
    last().receive(session([-3, 3]));
    expect(client.room?.scores).toEqual([3, -3]);
    last().receive(room(['B', 'A']));
    expect(client.room?.scores).toEqual([-3, 3]);
    client.close();
  });
});

describe('toasts', () => {
  test('notices are quiet; errors sound, each time', () => {
    const client = new RoomClient('abc');
    last().open();
    client.notice('자리를 섞었어요');
    expect(client.toasts.current).toMatchObject({ kind: 'notice', text: '자리를 섞었어요' });
    last().receive({ type: 'seats_moved', how: 'shuffle', order: [1, 0, 2, 3, 4] });
    expect(client.toasts.current?.kind).toBe('notice');
    expect(played.errors).toBe(0);

    last().receive({ type: 'error', code: 'not_your_turn' });
    const first = client.toasts.current!;
    expect(first).toMatchObject({ kind: 'error', text: '아직 내 차례가 아니에요' });
    last().receive({ type: 'error', code: 'not_your_turn' });
    const second = client.toasts.current!;
    expect(second.text).toBe(first.text);
    expect(second.id).not.toBe(first.id);
    expect(played.errors).toBe(2);
    client.close();
  });

  test("refusals are worded by code, and by the game's own words when it has them", () => {
    const client = new RoomClient('abc');
    last().open();
    last().receive({ type: 'error', code: 'invalid_rules', rule: 'empty_bid_range' });
    expect(client.toasts.current?.text).toBe('그 규칙으로는 게임을 할 수 없어요');
    client.refusal = (e) => (e.code === 'invalid_rules' ? `rule ${e.rule}` : null);
    last().receive({ type: 'error', code: 'invalid_rules', rule: 'empty_bid_range' });
    expect(client.toasts.current?.text).toBe('rule empty_bid_range');
    last().receive({ type: 'error', code: 'table_full' });
    expect(client.toasts.current?.text).toBe('자리가 다 찼어요');
    // A code from a newer server, or an old server's English, still gets words.
    last().receive({ type: 'error', code: 'from_the_future' });
    expect(client.toasts.current?.text).toBe('요청을 처리하지 못했어요');
    last().receive({ type: 'error', message: 'it is not your turn' });
    expect(client.toasts.current?.text).toBe('요청을 처리하지 못했어요');
    client.close();
  });

  test('a toast goes after its time, unless a newer one replaced it', () => {
    const toasts = new Toasts();
    toasts.show('notice', 'a');
    vi.advanceTimersByTime(2000);
    const b = toasts.show('error', 'b');
    vi.advanceTimersByTime(1000);
    expect(toasts.current).toBe(b);
    vi.advanceTimersByTime(3000);
    expect(toasts.current).toBeNull();
  });
});
