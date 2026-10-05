import { sound } from './sound';
import type { Action, BotLevel, RoomMsg, Rules, ServerMsg, StateMsg } from './types';

interface Saved {
  token: string;
  name: string;
}

const NAME_KEY = 'name';

/** A random id for this browser, so the anonymous stats can tell a player
 * who comes back to a new table. The server keeps only a salted hash. */
function device(): string | null {
  try {
    let id = localStorage.getItem('mighty.device');
    if (!id) localStorage.setItem('mighty.device', (id = crypto.randomUUID()));
    return id;
  } catch {
    return null;
  }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// The server answers in English; players see Korean.
const ERRORS: [RegExp, string][] = [
  [/not your turn/, '아직 내 차례가 아니에요'],
  [/not seated/, '먼저 자리에 앉아야 해요'],
  [/only seated players/, '자리에 앉은 사람만 할 수 있어요'],
  [/seat is taken/, '이미 누가 앉은 자리예요'],
  [/bots stay/, '판이 끝날 때까지 봇을 뺄 수 없어요'],
  [/already in progress/, '이미 판이 진행 중이에요'],
  [/every seat needs/, '빈 자리를 먼저 채워 주세요'],
  [/pick a name/, '이름을 적어 주세요'],
  [/illegal action/, '지금은 그렇게 할 수 없어요'],
  [/wait a moment after the deal/, '딜미스할 사람이 있는지 잠깐 기다려요'],
  [/seats move only between hands/, '자리는 판과 판 사이에만 바꿀 수 있어요'],
  [/only between hands/, '규칙은 판과 판 사이에만 바꿀 수 있어요'],
  [/no such turn limit/, '그 시간으로는 정할 수 없어요'],
  [/no player in that seat/, '그 자리에는 사람이 없어요'],
  [/leave your own seat/, '내 자리는 직접 일어나 주세요'],
  [/table is full/, '자리가 다 찼어요'],
  [/nobody to move/, '바꿀 사람이 없어요'],
  [/bidding range is empty/, '공약 최소가 최대보다 클 수 없어요'],
  [/no-trump bonus/, '노기루다 보너스는 최소 공약보다 작아야 해요'],
  [/no way to choose a friend/, '프렌드를 정하는 방법을 하나는 골라 주세요'],
  [/invalid rules/, '그 규칙으로는 게임을 할 수 없어요'],
  [/hints are busy/, '지금은 힌트를 보는 사람이 많아요. 잠시 뒤에 다시 해 주세요'],
  [/hints too often/, '힌트는 잠시 뒤에 다시 볼 수 있어요'],
];

function translate(message: string): string {
  return ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? '요청을 처리하지 못했어요';
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows may refuse storage; the seat just won't survive a reload.
  }
}

export function savedName(): string {
  return load<string>(NAME_KEY) ?? '';
}

/** A live connection to one room. Reconnects and reclaims its seat on its own. */
export class RoomClient {
  room = $state<RoomMsg | null>(null);
  game = $state<StateMsg | null>(null);
  seat = $state<number | null>(null);
  error = $state<string | null>(null);
  status = $state<'connecting' | 'open' | 'closed' | 'missing'>('connecting');
  /** The latest reaction per seat, cleared after a few seconds. `id` restarts its animation. */
  reactions = $state<Record<number, { text: string; id: number }>>({});
  /** What the bot would do in your place, until the hand moves on. */
  hint = $state<Action | null>(null);
  /** The turn timer, with its deadline on this page's clock (performance.now()). */
  clock = $state<{ seat: number; deadline: number; total: number } | null>(null);

  /** Called as seats are about to move, while the table still shows them
   * where they were; `order[s]` is where seat `s` goes (null: unknown). */
  onmove: ((order: number[] | null) => void) | null = null;

  #id: string;
  #ws: WebSocket | null = null;
  #closed = false;
  #retry = 500;
  #errorTimer: ReturnType<typeof setTimeout> | undefined;
  #reactionId = 0;
  /** Seats are moving: the server said where they went, and this tab's new
   * seat waits for the room that seats everyone there, so the table never
   * draws the new seat over the old seating for a moment. */
  #moving = false;
  #movedSeat: number | null = null;
  /** 시작 was pressed and the room has not answered yet. */
  #starting = false;

  constructor(id: string) {
    this.#id = id;
    this.#connect();
  }

  get #key() {
    return `room:${this.#id}`;
  }

  #connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${this.#id}/ws`);
    this.#ws = ws;
    this.status = 'connecting';
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.status = 'open';
      this.#moving = false;
      this.#movedSeat = null;
      this.#starting = false;
      this.#retry = 500;
      const saved = load<Saved>(this.#key);
      // Only to take back our own seat: if it was given away meanwhile, we watch.
      if (saved?.token) this.#send({ type: 'join', name: saved.name, token: saved.token, device: device(), reclaim: true });
    };
    ws.onmessage = (event) => this.#receive(JSON.parse(event.data) as ServerMsg);
    ws.onclose = async () => {
      if (this.#closed) return;
      if (!opened && !(await this.#exists())) {
        this.status = 'missing';
        return;
      }
      this.status = 'closed';
      this.seat = null;
      setTimeout(() => this.#connect(), this.#retry);
      this.#retry = Math.min(this.#retry * 2, 8000);
    };
  }

  /** Only the server's own "not found" means the table is gone. While the
   * server restarts (a deploy), the proxy answers 502 and the fetch may fail
   * outright: keep retrying, and the seat token reclaims the seat after. */
  async #exists(): Promise<boolean> {
    try {
      return (await fetch(`/api/rooms/${this.#id}`)).status !== 404;
    } catch {
      return true;
    }
  }

  #receive(msg: ServerMsg) {
    switch (msg.type) {
      case 'room': {
        this.room = msg;
        this.#starting = false;
        if (this.#moving) {
          this.#moving = false;
          if (this.#movedSeat !== null) this.seat = this.#movedSeat;
          this.#movedSeat = null;
        }
        const c = msg.clock;
        // Kept while it is the same turn, so the ring does not jump with
        // each message's few milliseconds of travel.
        const deadline = c ? performance.now() + c.ms : 0;
        const was = this.clock;
        if (!c) this.clock = null;
        else if (!was || was.seat !== c.seat || was.total !== c.total_ms || Math.abs(was.deadline - deadline) > 400)
          this.clock = { seat: c.seat, deadline, total: c.total_ms };
        // The seats were moved and the last hand put away.
        if (msg.showing === false && !msg.in_hand) this.game = null;
        break;
      }
      case 'state':
        this.game = msg;
        this.hint = null;
        break;
      case 'hint':
        this.hint = msg.action;
        break;
      case 'welcome': {
        if (this.#moving) this.#movedSeat = msg.seat;
        else this.seat = msg.seat;
        const name = load<Saved>(this.#key)?.name ?? savedName();
        store(this.#key, { token: msg.token, name } satisfies Saved);
        break;
      }
      case 'unseated':
        this.seat = null;
        this.#movedSeat = null;
        this.#forget();
        break;
      case 'seats_moved': {
        // The table on screen notes where each seat is before it changes:
        // it slides them to their new places. `order[s]` is where seat `s` went.
        const n = this.room?.seats.length ?? 0;
        const order =
          msg.order ??
          (msg.seats ? Array.from({ length: n }, (_, s) => (s === msg.seats![0] ? msg.seats![1] : s === msg.seats![1] ? msg.seats![0] : s)) : null);
        this.onmove?.(order);
        this.#moving = true;
        // A reaction still showing moves with its seat.
        const moved: typeof this.reactions = {};
        if (order) for (const [seat, r] of Object.entries(this.reactions)) moved[order[Number(seat)] ?? Number(seat)] = r;
        this.reactions = moved;
        // The table on screen was drawn for the old seats; the next hand
        // (or the room) draws afresh.
        this.game = null;
        this.hint = null;
        this.notice(msg.how === 'shuffle' ? '자리를 섞었어요' : '자리를 바꿨어요');
        break;
      }
      case 'reaction': {
        const id = ++this.#reactionId;
        this.reactions[msg.seat] = { text: msg.text, id };
        sound.react();
        // By its id, wherever its seat has moved since.
        setTimeout(() => {
          for (const [seat, r] of Object.entries(this.reactions)) if (r.id === id) delete this.reactions[Number(seat)];
        }, 2800);
        break;
      }
      case 'error':
        this.#starting = false;
        this.error = translate(msg.message);
        clearTimeout(this.#errorTimer);
        this.#errorTimer = setTimeout(() => (this.error = null), 4000);
        break;
    }
  }

  #send(msg: unknown) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg));
  }

  join(name: string, seat?: number) {
    store(NAME_KEY, name);
    const saved = load<Saved>(this.#key);
    store(this.#key, { token: saved?.token ?? '', name });
    this.#send({ type: 'join', name, token: saved?.token || null, seat: seat ?? null, device: device() });
  }

  leave() {
    this.#send({ type: 'leave' });
    this.seat = null;
    this.#forget();
  }

  /** Drops this table's seat token, keeping the name for the next seat. */
  #forget() {
    const name = load<Saved>(this.#key)?.name;
    try {
      localStorage.removeItem(this.#key);
    } catch {
      // Nothing to forget.
    }
    if (name) store(NAME_KEY, name);
  }

  setTable(table: { turn_secs?: number; shuffle?: boolean; shuffle_next?: boolean }) {
    this.#send({ type: 'set_table', ...table });
  }

  /** 섞기: shuffle the seats when the next hand starts, or not after all. */
  shuffleNext(on: boolean) {
    this.setTable({ shuffle_next: on });
  }

  swapSeats(a: number, b: number) {
    this.#send({ type: 'swap_seats', a, b });
  }

  /** Sends the player at `seat` back to watching, between hands. */
  clearSeat(seat: number) {
    this.#send({ type: 'clear_seat', seat });
  }

  /** Seats a bot, or changes the level of the one already there. */
  addBot(seat: number, level: BotLevel = 'hard') {
    this.#send({ type: 'add_bot', seat, level });
  }

  removeBot(seat: number) {
    this.#send({ type: 'remove_bot', seat });
  }

  setRules(preset: string, rules: Rules | null) {
    this.#send({ type: 'set_settings', settings: rules ? { preset, rules } : { preset } });
  }

  /** Shows a short message in the error toast, as if the server had said it. */
  notice(text: string) {
    this.error = text;
    clearTimeout(this.#errorTimer);
    this.#errorTimer = setTimeout(() => (this.error = null), 2500);
  }

  askHint() {
    this.#send({ type: 'hint' });
  }

  react(text: string) {
    this.#send({ type: 'react', text });
  }

  start() {
    // A second tap before the room answers would only earn an error.
    if (this.#starting) return;
    this.#starting = true;
    this.#send({ type: 'start' });
  }

  act(action: Action) {
    this.#send({ type: 'act', action });
  }

  close() {
    this.#closed = true;
    this.#ws?.close();
  }
}
