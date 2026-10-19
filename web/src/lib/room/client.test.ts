import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const played = vi.hoisted(() => ({ errors: 0, reactions:0 }));
vi.mock('../sound', () => ({
  sound: {
    error: () => played.errors++,
    react: () => played.reactions++,
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
  onclose: ((event?:{code:number;reason:string}) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code=1000,reason='') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({code,reason});
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** The link drops from the server's side. */
  drop(code=1000,reason='') {
    this.close(code,reason);
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
  played.reactions=0;
  release = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'test' });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
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
  test('accepted leave cleanup forgets credentials without transmitting another leave', () => {
    const client = new RoomClient('abc');
    last().open(); last().receive({ type: 'welcome', seat: 2, token: 'secret' });
    const sent = last().sent.length;
    client.forgetSeatCredential();
    expect(client.seat).toBeNull(); expect(localStorage.getItem('room:abc')).toBeNull();
    expect(last().sent).toHaveLength(sent);
    client.close();
  });
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
    expect(last().sent).toEqual([{ type: 'observe', name: '', token: null }]);
    expect(last().sent.some(m => m.type === 'join')).toBe(false);
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

test('seat transfer clears the current role while preserving saved reclaim credentials', () => {
  const client = new RoomClient('abc');
  last().open();
  last().receive({ type: 'welcome', seat: 2, token: 'seat-secret' });
  last().receive({ type: 'visitor_welcome', seat: 2, id: 'person', name: '수연', token: 'visitor-secret' });
  expect(client.seat).toBe(2);
  last().receive({ type: 'visitor_welcome', seat: null, id: 'person', name: '수연', token: 'visitor-secret' });
  expect(client.seat).toBeNull();
  expect(client.viewerId).toBe('person');
  expect(localStorage.getItem('room:abc')).toContain('seat-secret');
  expect(localStorage.getItem('visitor:abc')).toContain('visitor-secret');
  client.close();
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


describe('continuous table participation contract', () => {
  test('initial and reconnect snapshots are quiet while later participation changes are named', () => {
    const client = new RoomClient('abc');
    const notices = vi.spyOn(client, 'notice');
    last().open();
    last().receive({type:'visitor_welcome',seat:null,id:'me',name:'나',token:'visitor'});
    const snapshot = {type:'room',id:'abc',seats:[],clock:null,in_hand:true,observers:[{id:'incoming',name:'수연',requested:false}],participation:[],participant_ids:[]};
    last().receive(snapshot);
    expect(notices).not.toHaveBeenCalled();
    last().receive({...snapshot,participation:[{id:'incoming',name:'수연',order:1,seat:null,target_id:null,offered_by:null}]});
    expect(notices).toHaveBeenCalledExactlyOnceWith('수연님이 다음 판 참여를 기다려요');
    last().drop();
    vi.advanceTimersByTime(500);
    last().open();
    last().receive(snapshot);
    expect(notices).toHaveBeenCalledTimes(1);
    client.close();
  });
  test('reservation and handoff preserve explicit target identity', () => {
    const client = new RoomClient('abc');
    last().open();
    client.requestSeat(true, 3);
    client.offerSeat('incoming');
    client.acceptSeat(3, 'frozen-target');
    client.offerSeat(null);
    client.requestSeat(false);
    client.resetScores();
    expect(last().sent.slice(-6)).toEqual([
      {type: 'request_seat', requested: true, seat: 3},
      {type: 'offer_seat', requester_id: 'incoming'},
      {type: 'accept_seat', seat: 3, target_id: 'frozen-target'},
      {type: 'offer_seat', requester_id: null},
      {type: 'request_seat', requested: false},
      {type: 'reset_scores'},
    ]);
    client.close();
  });
  test('score reset retains the frozen current hand and propagates new seat identities', () => {
    const client = new RoomClient('abc');
    last().open();
    const currentHand = {number: 4, names: ['old'], participant_ids: ['old-id'], payoffs: [8], view: {phase: {Done: {}}}, rules: {}};
    last().receive({type: 'session', scores: [0], hands_played: 0, history: [], hands: [], records: [], current_hand: currentHand});
    last().receive({type: 'room', id: 'abc', seats: [{kind: 'human', name: 'incoming', connected: true}], participant_ids: ['new-id'], participation: [{id: 'waiting', order: 1, seat: null}], clock: null, showing: true, in_hand: false});
    expect(client.room?.current_hand).toEqual(currentHand);
    expect(client.room?.participant_ids).toEqual(['new-id']);
    expect(client.room?.participation?.[0].id).toBe('waiting');
    expect(client.room?.scores).toEqual([0]);
    client.close();
  });
});


describe('socket generation ownership', () => {
  test('a dropped socket cannot publish stale private state while reconnecting', () => {
    const client = new RoomClient('abc');
    const old = last();
    old.open();
    old.receive(state(2));
    old.drop();
    old.receive(state(99));
    old.receive({ type: 'welcome', seat: 4, token: 'stale-secret' });
    expect(client.game?.version).toBe(2);
    expect(client.seat).toBeNull();
    expect(localStorage.getItem('room:abc')).toBeNull();
    client.close();
  });

  test('superseded socket callbacks cannot overwrite identity or close the current connection', async () => {
    const client = new RoomClient('abc');
    const old = last();
    old.open();
    old.drop();
    await vi.advanceTimersByTimeAsync(600);
    const current = last();
    current.open();
    current.receive(state(3));
    current.receive({ type: 'welcome', seat: 1, token: 'current-secret' });
    // Force late callbacks even though the browser has a newer socket.
    old.open();
    old.receive(state(90));
    old.receive({ type: 'welcome', seat: 4, token: 'old-secret' });
    old.onclose?.();
    expect(client.status).toBe('open');
    expect(client.game?.version).toBe(3);
    expect(client.seat).toBe(1);
    expect(localStorage.getItem('room:abc')).toContain('current-secret');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets()).toBe(2);
    client.close();
  });
});


describe('scoped command integration', () => {
  test('native room eligibility fences scoped and legacy lifecycle sends without consuming a refused sequence',()=>{
    const client=new RoomClient('abc'),socket=last();socket.open();
    const expected={domain:'room' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'};
    socket.receive({type:'visitor_welcome',id:'actor',name:'A',seat:0,token:'visitor'});
    const room={type:'room',id:'abc',game:'mighty',seats:[{kind:'human',name:'A'}],participant_ids:['actor'],clock:null,in_hand:false,showing:false,room_version:2,capacity:{can_start:false,can_archive:false,can_play:false,reason:{code:'invariant'}}};
    socket.receive(room);socket.receive({type:'room_command_window',command:{scope:expected,next_sequence:1}});
    expect(client.commandRecovery.ready).toBe(true);
    const before=socket.sent.length;client.start();client.resetScores();client.act('Pass');client.askHint();expect(socket.sent).toHaveLength(before);
    expect(client.commands.submitRoom('blocked-start',expected,{type:'start'})).toBe(false);expect(client.commandRecovery.pending).toBe(0);
    socket.receive({...room,capacity:{...room.capacity,can_start:true}});client.start();expect(socket.sent.at(-1)).toEqual({type:'start'});
    expect(client.commands.submitRoom('allowed-start',expected,{type:'start'})).toBe(true);expect(socket.sent.at(-1)).toMatchObject({type:'submit_room',sequence:1,action:{type:'start'}});
    client.close();expect(vi.getTimerCount()).toBe(0);
  });
  test('native policy fences legacy and scoped actions without leaking refused actions into recovery',()=>{
    const client=new RoomClient('abc'),socket=last();socket.open();
    const expected={domain:'game' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'};
    socket.receive({type:'visitor_welcome',id:'actor',name:'A',seat:0,token:'visitor'});
    const packet={...state(2),turn:{Seat:0},legal:['Pass','Bid'],out_of_turn:['Misdeal'],policy_actions:{legal:['Bid'],out_of_turn:[]},command:{scope:expected,next_sequence:1}};
    socket.receive(packet);const before=socket.sent.length;
    client.act('Pass');client.act('Misdeal');expect(socket.sent).toHaveLength(before);
    expect(client.commands.submit('blocked',expected,'Pass')).toBe(false);expect(client.commandRecovery.pending).toBe(0);
    expect(sessionStorage.getItem('card.commands.v1:abc')).not.toContain('Pass');expect(socket.sent).toHaveLength(before);
    client.act('Bid');expect(socket.sent.at(-1)).toEqual({type:'act',action:'Bid'});
    socket.receive({...packet,policy_actions:{legal:[],out_of_turn:[]}});const empty=socket.sent.length;client.askHint();expect(socket.sent).toHaveLength(empty);
    // A later server policy at the same game version must be used immediately.
    socket.receive({...packet,policy_actions:{legal:['Pass'],out_of_turn:['Misdeal']}});
    client.act('Bid');expect(socket.sent).toHaveLength(empty);client.act('Misdeal');expect(socket.sent.at(-1)).toEqual({type:'act',action:'Misdeal'});
    socket.receive({...packet,policy_actions:null});const invalid=socket.sent.length;client.act('Bid');client.askHint();expect(socket.sent).toHaveLength(invalid);
    client.close();expect(vi.getTimerCount()).toBe(0);
  });
  test('requires the authenticated private window and resolves only a server receipt', () => {
    const client = new RoomClient('abc');
    const socket = last(); socket.open();
    const expected = {domain:'game' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'};
    socket.receive({...state(2),command:{scope:expected,next_sequence:1}});
    expect(client.commands.submit('local',expected,{privateCard:'secret'})).toBe(false);
    socket.receive({type:'visitor_welcome',id:'actor',token:'visitor-token',name:'A',seat:0});
    const resolved: string[] = [];client.commands.onResolution((id,status)=>resolved.push(`${id}:${status}`));
    expect(client.commands.submit('local',expected,{privateCard:'secret'})).toBe(true);
    const submit = socket.sent.at(-1)!;expect(submit.type).toBe('submit');
    expect(sessionStorage.getItem('card.commands.v1:abc')).not.toContain('secret');
    expect(resolved).toEqual([]);
    socket.receive({type:'operation_receipt',operation_id:submit.operation_id,sequence:1,scope:expected,outcome:{status:'accepted',version:3},durability:'persisted'});
    expect(resolved).toEqual(['local:accepted']);expect(client.commandRecovery.ready).toBe(false);
    socket.receive({...state(3),command:{scope:{...expected,version:3},next_sequence:2}});
    expect(client.commandRecovery.ready).toBe(true);expect(socket.sent.some(message=>message.type==='act')).toBe(false);
    client.close();expect(vi.getTimerCount()).toBe(0);
  });
});


test('scoped admission waits for matching public, private and session publication revisions',()=>{
  const client=new RoomClient('abc'),socket=last();socket.open();
  const gameScope={domain:'game' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'};
  const roomScope=(version:number)=>({...gameScope,domain:'room' as const,version});
  const room=(version:number)=>({type:'room',id:'abc',game:'mighty',seats:[{kind:'human',name:'A',connected:true}],participant_ids:['actor'],participation:[],observers:[],ready:[true],clock:null,in_hand:true,showing:true,room_version:version});
  socket.receive({type:'visitor_welcome',id:'actor',token:'visitor-token',name:'A',seat:0});
  socket.receive({type:'session',room_version:1,scores:[0],hands_played:0,history:[],hands:[]});
  socket.receive(room(1));socket.receive({...state(2),room_version:1,command:{scope:gameScope,next_sequence:1}});
  socket.receive({type:'room_command_window',command:{scope:roomScope(1),next_sequence:1}});
  expect(client.commandRecovery.ready).toBe(true);
  socket.receive({type:'session',room_version:2,scores:[1],hands_played:1,history:[[1]],hands:[]});
  expect(client.sessionRoomVersion).toBe(2);expect(client.room?.room_version).toBe(1);expect(client.publicationReady).toBe(false);
  expect(client.commands.submitRoom('stale',roomScope(1),{type:'start'})).toBe(false);
  socket.receive(room(2));socket.receive({type:'room_command_window',command:{scope:roomScope(2),next_sequence:1}});
  expect(client.commands.submit('stale-private',gameScope,{})).toBe(false);
  socket.receive({...state(2),room_version:2,command:{scope:gameScope,next_sequence:1}});
  expect(client.commandRecovery.ready).toBe(true);
  socket.receive(room(3));expect(client.room?.room_version).toBe(3);
  expect(client.commands.submit('mixed',gameScope,{})).toBe(false);
  socket.receive({...state(2),room_version:3,command:{scope:gameScope,next_sequence:1}});
  socket.receive({type:'room_command_window',command:{scope:roomScope(3),next_sequence:1}});
  expect(client.publicationReady).toBe(true);expect(client.commands.submit('fresh',gameScope,{})).toBe(true);client.close();
});

describe('authoritative name bootstrap and recovered adoption',()=>{
 test('existing visitors authenticate without resending stale preferences and reclaim after authoritative welcome',()=>{
  localStorage.setItem('name',JSON.stringify('stale preference'));localStorage.setItem('visitor:abc',JSON.stringify({token:'visitor'}));localStorage.setItem('room:abc',JSON.stringify({token:'seat-token',name:'stale seat name'}));
  const client=new RoomClient('abc'),socket=last();socket.open();expect(socket.sent).toEqual([{type:'observe',name:'',token:'visitor'}]);
  socket.receive({type:'visitor_welcome',id:'actor',name:'server accepted',token:'visitor',seat:null});expect(socket.sent.at(-1)).toMatchObject({type:'join',name:'server accepted',token:'seat-token',reclaim:true});
  socket.receive({type:'visitor_welcome',id:'actor',name:'server accepted',token:'visitor',seat:0});socket.receive({type:'welcome',seat:0,token:'seat-token'});
  expect(JSON.parse(localStorage.getItem('room:abc')!).name).toBe('server accepted');expect(JSON.parse(localStorage.getItem('name')!)).toBe('stale preference');client.close();
 });
 test('forgetting a seat before VisitorWelcome cancels the deferred reclaim',()=>{
  localStorage.setItem('room:abc',JSON.stringify({token:'seat-token',name:'before'}));const client=new RoomClient('abc'),socket=last();socket.open();client.forgetSeatCredential();socket.receive({type:'visitor_welcome',id:'actor',name:'current',token:'visitor',seat:null});expect(socket.sent.filter(value=>value.type==='join')).toEqual([]);client.close();
 });
 test.each(['accepted','rejected','unavailable'] as const)('recovered %s name intent waits for matching current authoritative publication',status=>{
  const expected={domain:'room',room_id:'abc',room_epoch:'a'.repeat(32),actor_id:'actor',seat:null,session_id:1,hand:0,version:1};
  localStorage.setItem('name',JSON.stringify('old'));localStorage.setItem('visitor:abc',JSON.stringify({token:'visitor'}));sessionStorage.setItem('card.commands.v1:abc',JSON.stringify([{operation_id:'1:name',sequence:1,expected,completion:'adopt-name'}]));
  const client=new RoomClient('abc'),socket=last();socket.open();socket.receive({type:'visitor_welcome',id:'actor',name:'current authoritative',token:'visitor',seat:null});
  socket.receive({type:'operation_receipt',operation_id:'1:name',sequence:1,scope:status==='unavailable'?null:expected,outcome:status==='accepted'?{status,version:2}:status==='rejected'?{status,reason:'rule',error:null}:{status,reason:'pruned'},durability:'persisted'});
  expect(JSON.parse(localStorage.getItem('name')!)).toBe('old');
  socket.receive({type:'session',room_version:2,scores:[],hands_played:0,history:[],hands:[]});socket.receive({type:'room',id:'abc',game:'mighty',seats:[],clock:null,in_hand:false,showing:false,room_version:2,observers:[],participation:[],participant_ids:[]});
  expect(JSON.parse(localStorage.getItem('name')!)).toBe('old');socket.receive({type:'room_command_window',command:{scope:{...expected,version:2},next_sequence:2}});
  expect(JSON.parse(localStorage.getItem('name')!)).toBe(status==='accepted'?'current authoritative':'old');expect(socket.sent.filter(value=>value.type==='submit_room')).toEqual([]);client.close();
 });
});

test('accepted recovered name intent cannot cross an actor replacement before publication',()=>{
 const expected={domain:'room',room_id:'abc',room_epoch:'a'.repeat(32),actor_id:'actor',seat:null,session_id:1,hand:0,version:1};
 localStorage.setItem('name',JSON.stringify('preferred'));sessionStorage.setItem('card.commands.v1:abc',JSON.stringify([{operation_id:'1:name',sequence:1,expected,completion:'adopt-name'}]));
 const client=new RoomClient('abc'),socket=last();socket.open();socket.receive({type:'visitor_welcome',id:'actor',name:'accepted',token:'visitor-a',seat:null});socket.receive({type:'operation_receipt',operation_id:'1:name',sequence:1,scope:expected,outcome:{status:'accepted',version:2},durability:'persisted'});
 socket.receive({type:'visitor_welcome',id:'other',name:'other actor',token:'visitor-b',seat:null});socket.receive({type:'session',room_version:2,scores:[],hands_played:0,history:[],hands:[]});socket.receive({type:'room',id:'abc',game:'mighty',seats:[],clock:null,in_hand:false,showing:false,room_version:2,observers:[],participation:[],participant_ids:[]});socket.receive({type:'room_command_window',command:{scope:{...expected,actor_id:'other',version:2},next_sequence:2}});
 expect(JSON.parse(localStorage.getItem('name')!)).toBe('preferred');socket.receive({type:'visitor_welcome',id:'actor',name:'accepted',token:'visitor-a',seat:null});socket.receive({type:'room_command_window',command:{scope:{...expected,version:2},next_sequence:2}});expect(JSON.parse(localStorage.getItem('name')!)).toBe('preferred');client.close();
});

describe('receive-time native ephemeral authority',()=>{
  function coherent(client:RoomClient, socket:FakeSocket, actor='actor'){
    const gameScope={domain:'game' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:actor};
    socket.receive({type:'visitor_welcome',id:actor,name:'A',seat:0,token:'private-token'});
    socket.receive({type:'room',id:'abc',room_version:5,seats:[{kind:'human',name:'A'},{kind:'human',name:'B'}],participant_ids:[actor,'bob'],observers:[{id:'watcher',name:'W'}],in_hand:true,showing:true,clock:null});
    socket.receive({...state(2),room_version:5,view:{viewer:{Seat:0}},turn:{Seat:0},legal:[{Play:'ace'}],command:{scope:gameScope,next_sequence:1}});
    socket.receive({type:'room_command_window',command:{scope:{...gameScope,domain:'room',version:5},next_sequence:1}});
    expect(client.publicationReady).toBe(true);return gameScope;
  }
  test('only coherent current private hint is captured; State and identity changes revoke it',()=>{
    const client=new RoomClient('abc'),socket=last();socket.open();const scope=coherent(client,socket);
    socket.receive({type:'hint',version:2,action:{Play:'ace'}});
    expect(client.nativeHint).toEqual({scope:{connectionEpoch:'1',command:scope,gameVersion:2},action:{Play:'ace'}});
    expect(JSON.stringify(client.nativeHint)).not.toContain('private-token');
    socket.receive({type:'hint',version:2,action:{Play:'unoffered'}});expect(client.nativeHint).toBeNull();
    socket.receive({type:'hint',version:1,action:{Play:'ace'}});expect(client.nativeHint).toBeNull();
    socket.receive({type:'hint',version:2,action:{Play:'ace'}});expect(client.nativeHint).not.toBeNull();
    socket.receive({...state(2),room_version:5,view:{viewer:{Seat:0}},turn:{Seat:1},legal:[{Play:'ace'}],command:{scope,next_sequence:1}});expect(client.nativeHint).toBeNull();
    socket.receive({type:'hint',version:2,action:{Play:'ace'}});expect(client.nativeHint).toBeNull();
    coherent(client,socket);socket.receive({type:'hint',version:2,action:{Play:'ace'}});
    socket.receive({type:'visitor_welcome',id:'foreign',name:'F',seat:0,token:'another'});expect(client.nativeHint).toBeNull();client.close();
  });
  test('connection loss clears sidecars and old sockets cannot inject private advice',async()=>{
    const client=new RoomClient('abc'),old=last();old.open();coherent(client,old);old.receive({type:'hint',version:2,action:{Play:'ace'}});old.receive({type:'reaction',seat:1,text:'👏'});
    expect(client.nativeHint).not.toBeNull();expect(client.nativeReactions).toHaveLength(1);old.drop();expect(client.nativeHint).toBeNull();expect(client.nativeReactions).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);const current=last();current.open();coherent(client,current);old.receive({type:'hint',version:2,action:{Play:'ace'}});expect(client.nativeHint).toBeNull();
    current.receive({type:'hint',version:2,action:{Play:'ace'}});expect(client.nativeHint?.scope.connectionEpoch).toBe('2');client.close();
  });
  test('reaction identity is captured before reseating, and the original single TTL expires it',()=>{
    const client=new RoomClient('abc'),socket=last();socket.open();coherent(client,socket);
    socket.receive({type:'reaction',seat:1,text:'👏'});const original=client.nativeReactions[0];expect(original).toMatchObject({participantId:'bob',eventId:'reaction:1:1'});
    vi.advanceTimersByTime(1000);socket.receive({type:'reaction',seat:1,text:'😂'});expect(client.nativeReactions).toHaveLength(1);expect(client.nativeReactions[0].eventId).toBe('reaction:1:2');
    socket.receive({type:'seats_moved',how:'swap',seats:[0,1]});expect(client.nativeReactions[0].participantId).toBe('bob');expect(client.reactions[0].text).toBe('😂');
    vi.advanceTimersByTime(1800);expect(client.nativeReactions).toHaveLength(1);vi.advanceTimersByTime(1000);expect(client.nativeReactions).toEqual([]);expect(client.reactions).toEqual({});client.close();
  });
  test('unknown participants and unapproved text cannot create native reaction records',()=>{
    const client=new RoomClient('abc'),socket=last();socket.open();coherent(client,socket);
    socket.receive({type:'reaction',seat:99,text:'👏'});socket.receive({type:'reaction',seat:1,text:'arbitrary'});socket.receive({type:'observer_reaction',id:'unknown',text:'👏'});expect(client.nativeReactions).toEqual([]);
    socket.receive({type:'observer_reaction',id:'watcher',text:'👏'});expect(client.nativeReactions[0].participantId).toBe('watcher');vi.advanceTimersByTime(2800);expect(client.nativeReactions).toEqual([]);client.close();
  });
});

test('external feedback ownership suppresses only legacy audio, retaining toasts and reaction TTL',()=>{
 const external=new RoomClient('abc',{feedback:'external'});last().open();last().receive({type:'reaction',seat:0,text:'👏'});last().receive({type:'error',code:'not_your_turn'});
 expect(played.reactions).toBe(0);expect(played.errors).toBe(0);expect(external.toasts.current?.kind).toBe('error');expect(external.reactions[0].text).toBe('👏');
 vi.advanceTimersByTime(2800);expect(external.reactions).toEqual({});external.close();
 const legacy=new RoomClient('abc');last().open();last().receive({type:'reaction',seat:0,text:'👏'});last().receive({type:'error',code:'not_your_turn'});expect(played.reactions).toBe(1);expect(played.errors).toBe(1);legacy.close();
});


describe('read-only public settled checkpoint readiness',()=>{
 const scope=(version=5,actor='actor',session=1)=>({domain:'room' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:session,hand:3,version,seat:0,actor_id:actor});
 const publicRoom=(version=5)=>({type:'room',id:'abc',game:'mighty',seats:[{kind:'human',name:'A'}],participant_ids:['actor'],clock:null,in_hand:false,showing:true,room_version:version});
 const session=(version=5)=>({type:'session',session_id:1,room_version:version,scores:[1],hands_played:1,history:[[1]],hands:[],current_hand:{number:1}});
 const authenticate=(socket:FakeSocket)=>socket.receive({type:'visitor_welcome',id:'actor',name:'A',seat:0,token:'private'});
 const window=(socket:FakeSocket,version=5,actor='actor',sid=1)=>socket.receive({type:'room_command_window',command:{scope:scope(version,actor,sid),next_sequence:1}});
 test('public session can become readable before State, but never before authentication or as game authority',()=>{
  const client=new RoomClient('abc'),socket=last();socket.open();socket.receive(session());socket.receive(publicRoom());window(socket);expect(client.roomPublicationReady).toBe(false);
  authenticate(socket);expect(client.roomPublicationReady).toBe(true);expect(client.publicationReady).toBe(false);expect(client.game).toBeNull();
  expect(client.commands.submit('no-private-state',{...scope(),domain:'game',version:0},{})).toBe(false);
  socket.drop();expect(client.roomPublicationReady).toBe(false);client.close();expect(vi.getTimerCount()).toBe(0);
 });
 test('native Session identity survives presence-only Room proxies but changes on every Session replacement',()=>{
  const client=new RoomClient('abc'),socket=last();socket.open();authenticate(socket);socket.receive(session());socket.receive(publicRoom());window(socket);
  const source=client.publicSessionSource,record=client.room!.current_hand;
  expect(source).not.toBeNull();expect(Object.isFrozen(source)).toBe(true);
  socket.receive({...publicRoom(6),watching:1});window(socket,6);
  socket.receive({...state(2),room_version:6,command:{scope:{...scope(6),domain:'game',version:2},next_sequence:1}});
  expect(client.publicationReady).toBe(true);expect(client.roomPublicationReady).toBe(false);
  expect(client.publicSessionSource).toBe(source);
  // The publication token, rather than a nested Svelte proxy, owns completion
  // retention. A same-count payload must never inherit the old token.
  expect(client.room!.current_hand).toEqual(record);
  socket.receive({...session(6),current_hand:{number:1,replaced:true}});
  expect(client.publicSessionSource).not.toBe(source);expect(client.roomPublicationReady).toBe(true);
  const replaced=client.publicSessionSource;socket.receive(session(6));expect(client.publicSessionSource).not.toBe(replaced);
  const heldRoom=client.room,beforeMove=client.publicSessionSource;
  socket.receive({type:'seats_moved',how:'shuffle',order:[0]});socket.receive(session(6));
  expect(client.room).toBe(heldRoom);expect(client.publicSessionSource).not.toBe(beforeMove);
  client.close();
 });
 test('reconnect requires this connection session and exact actor/session/public revision; ordinary State gate stays independent',async()=>{
  const client=new RoomClient('abc'),old=last();old.open();authenticate(old);old.receive(session());old.receive(publicRoom());window(old);expect(client.roomPublicationReady).toBe(true);
  old.drop();await vi.advanceTimersByTimeAsync(500);const socket=last();socket.open();authenticate(socket);socket.receive(publicRoom());window(socket);expect(client.roomPublicationReady).toBe(false);
  socket.receive(session());expect(client.roomPublicationReady).toBe(true);window(socket,5,'other');expect(client.roomPublicationReady).toBe(false);window(socket,5,'actor',2);expect(client.roomPublicationReady).toBe(false);window(socket);expect(client.roomPublicationReady).toBe(true);
  socket.receive(session(6));expect(client.roomPublicationReady).toBe(false);socket.receive(publicRoom(6));window(socket,6);expect(client.roomPublicationReady).toBe(true);
  socket.receive(publicRoom(7));window(socket,7);expect(client.roomPublicationReady).toBe(false);
  socket.receive({...state(2),room_version:7,command:{scope:{...scope(7),domain:'game',version:2},next_sequence:1}});expect(client.publicationReady).toBe(true);expect(client.roomPublicationReady).toBe(false);
  client.close();expect(vi.getTimerCount()).toBe(0);
 });
});

describe('bounded delivery close recovery',()=>{
 test.each([{code:'unreservable_legacy'},{code:'capacity',resource:'session',limit:4194304},{code:'capacity',resource:'score',limit:Number.MAX_SAFE_INTEGER}])('native restore capacity stops reconnects without deleting pending operation evidence: %j',async reason=>{
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({code:'resource_capacity',reason}),{status:507}));
  const client=new RoomClient('abc'),socket=last();socket.open();
  const expected={domain:'game' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'};
  socket.receive({...state(2),command:{scope:expected,next_sequence:1}});socket.receive({type:'visitor_welcome',id:'actor',token:'visitor-token',name:'A',seat:0});
  expect(client.commands.submit('uncertain-final',expected,{privateCard:'secret'})).toBe(true);
  const retained=sessionStorage.getItem('card.commands.v1:abc');expect(retained).not.toBeNull();expect(retained).not.toContain('secret');
  socket.drop();await vi.advanceTimersByTimeAsync(500);last().drop();await vi.advanceTimersByTimeAsync(0);
  expect(client.deliveryIssue).toBe('capacity');expect(client.status).toBe('closed');expect(client.publicationReady).toBe(false);expect(client.game).toBeNull();
  const evidence=sessionStorage.getItem('card.commands.v1:abc');expect(evidence).toBe(retained);
  await vi.advanceTimersByTimeAsync(60_000);expect(sockets()).toBe(2);expect(sessionStorage.getItem('card.commands.v1:abc')).toBe(evidence);client.close();expect(vi.getTimerCount()).toBe(0);
 });
 test.each(['proxy failure',JSON.stringify({code:'different',reason:{code:'capacity'}}),'x'.repeat(4097),
  ...[{code:'capacity'},{code:'capacity',resource:'unknown',limit:5},{code:'capacity',resource:'session',limit:-1},{code:'capacity',resource:'session',limit:1.5},{code:'invariant',extra:true}].map(reason=>JSON.stringify({code:'resource_capacity',reason})),
 ])('generic or malformed 507 retains transient recovery: %s',async body=>{
  vi.stubGlobal('fetch',async()=>new Response(body,{status:507}));const client=new RoomClient('abc');last().drop();await vi.advanceTimersByTimeAsync(0);
  expect(client.deliveryIssue).toBeNull();await vi.advanceTimersByTimeAsync(500);expect(sockets()).toBe(2);client.close();
 });
 test('late native capacity response cannot overwrite an unmounted client',async()=>{
  let answer!:(response:Response)=>void;vi.stubGlobal('fetch',()=>new Promise<Response>(resolve=>answer=resolve));
  const client=new RoomClient('abc');last().drop();client.close();const status=client.status;answer(new Response(JSON.stringify({code:'resource_capacity',reason:{code:'invariant'}}),{status:507}));await vi.advanceTimersByTimeAsync(0);
  expect(client.deliveryIssue).toBeNull();expect(client.status).toBe(status);expect(sockets()).toBe(1);
 });
 test('exact permanent outbound oversize closes publication and preserves payload-free recovery without retry',async()=>{
  const client=new RoomClient('abc'),socket=last();socket.open();
  const expected={domain:'game' as const,room_id:'abc',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'};
  socket.receive({...state(2),command:{scope:expected,next_sequence:1}});socket.receive({type:'visitor_welcome',id:'actor',token:'visitor-token',name:'A',seat:0});
  expect(client.commands.submit('uncertain-final',expected,{privateCard:'secret'})).toBe(true);
  const retained=sessionStorage.getItem('card.commands.v1:abc');expect(retained).not.toBeNull();expect(retained).not.toContain('secret');
  socket.drop(1009,'outbound_message_limit');expect(client.deliveryIssue).toBe('oversize');expect(client.status).toBe('closed');expect(client.game).toBeNull();expect(client.seat).toBeNull();expect(client.roomPublicationReady).toBe(false);expect(client.publicationReady).toBe(false);
  expect(sessionStorage.getItem('card.commands.v1:abc')).toBe(retained);socket.receive(state(99));expect(client.game).toBeNull();
  await vi.advanceTimersByTimeAsync(60_000);expect(sockets()).toBe(1);expect(sessionStorage.getItem('card.commands.v1:abc')).toBe(retained);client.close();expect(vi.getTimerCount()).toBe(0);
 });
 test('backpressure reconnects with increasing delay until a coherent publication, rather than resetting on socket-open',async()=>{
  const client=new RoomClient('abc');last().open();last().drop(1013,'outbound_backpressure');expect(client.deliveryIssue).toBe('backpressure');
  await vi.advanceTimersByTimeAsync(500);expect(sockets()).toBe(2);last().open();expect(client.deliveryIssue).toBeNull();last().drop(1013,'outbound_backpressure');
  await vi.advanceTimersByTimeAsync(500);expect(sockets()).toBe(2);await vi.advanceTimersByTimeAsync(500);expect(sockets()).toBe(3);client.close();
 });
 test('unknown1009 or stale socket limit reasons cannot permanently disable a current connection',async()=>{
  const client=new RoomClient('abc'),old=last();old.open();old.drop(1009,'other-reason');expect(client.deliveryIssue).toBeNull();await vi.advanceTimersByTimeAsync(500);const current=last();current.open();
  old.onclose?.({code:1009,reason:'outbound_message_limit'});expect(client.status).toBe('open');expect(client.deliveryIssue).toBeNull();client.close();
 });
});
