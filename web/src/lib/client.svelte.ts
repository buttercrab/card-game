import { errorText } from './errorText';
import { sound } from './sound';
import { Toasts } from './toast.svelte';
import type { Action, BotLevel, ClientMsg, Preset, RoomMsg, Rules, ServerMsg, StateMsg } from './types';

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
  /** The toast: the server's errors, which sound, and the table's notices, which don't. */
  toasts = new Toasts((t) => {
    if (t.kind === 'error') sound.error();
  });
  status = $state<'connecting' | 'open' | 'closed' | 'missing'>('connecting');
  /** The latest reaction per seat, cleared after a few seconds. `id` restarts its animation. */
  reactions = $state<Record<number, { text: string; id: number }>>({});
  /** What the bot would do in your place, until the hand moves on. */
  hint = $state<Action | null>(null);
  /** The turn timer, with its deadline on this page's clock (performance.now()). */
  clock = $state<{ seat: number; deadline: number; total: number } | null>(null);

  /** Called as seats are about to move, while the table still shows them
   * where they were; `order[s]` is where seat `s` goes. */
  onmove: ((order: number[]) => void) | null = null;

  #id: string;
  #ws: WebSocket | null = null;
  #closed = false;
  #retry = 500;
  /** The pending reconnect, cancelled by close(). */
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  /** Each reaction's clearing timer, cancelled by close(). */
  #reactionTimers = new Set<ReturnType<typeof setTimeout>>();
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
    this.#reconnect = undefined;
    // A closed client never opens another socket: a reconnect that was
    // already due, or one scheduled across an await, stops here.
    if (this.#closed) return;
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
    ws.onmessage = (event) => {
      if (!this.#closed) this.#receive(JSON.parse(event.data) as ServerMsg);
    };
    ws.onclose = async () => {
      if (this.#closed) return;
      if (!opened) {
        const exists = await this.#exists();
        // Left (or unmounted) while asking: stay closed.
        if (this.#closed) return;
        if (!exists) {
          this.status = 'missing';
          return;
        }
      }
      this.status = 'closed';
      this.seat = null;
      clearTimeout(this.#reconnect);
      this.#reconnect = setTimeout(() => this.#connect(), this.#retry);
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
        // Asked for a state the hand has since moved on from: no longer true.
        if (this.game && msg.version === this.game.version) this.hint = msg.action;
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
          msg.how === 'shuffle'
            ? msg.order
            : Array.from({ length: n }, (_, s) => (s === msg.seats[0] ? msg.seats[1] : s === msg.seats[1] ? msg.seats[0] : s));
        this.onmove?.(order);
        this.#moving = true;
        // A reaction still showing moves with its seat.
        const moved: typeof this.reactions = {};
        for (const [seat, r] of Object.entries(this.reactions)) moved[order[Number(seat)] ?? Number(seat)] = r;
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
        const timer = setTimeout(() => {
          this.#reactionTimers.delete(timer);
          for (const [seat, r] of Object.entries(this.reactions)) if (r.id === id) delete this.reactions[Number(seat)];
        }, 2800);
        this.#reactionTimers.add(timer);
        break;
      }
      case 'error':
        this.#starting = false;
        this.toasts.show('error', errorText(msg));
        break;
    }
  }

  #send(msg: ClientMsg) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg));
  }

  join(name: string, seat?: number) {
    store(NAME_KEY, name);
    const saved = load<Saved>(this.#key);
    store(this.#key, { token: saved?.token ?? '', name });
    this.#send({ type: 'join', name, token: saved?.token || null, seat: seat ?? null, device: device() });
  }

  /** Gives up this tab's seat, and forgets its token even when not seated
   * just now (the link dropped), so a reconnect can never reclaim it. */
  leave() {
    if (this.seat !== null) this.#send({ type: 'leave' });
    this.seat = null;
    this.#movedSeat = null;
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

  /** `presetRules`: the preset's rules as the table pinned them, to keep
   * them; without it the server pins the preset as it is today. */
  setRules(preset: Preset, rules: Rules | null, presetRules?: Rules) {
    this.#send({
      type: 'set_settings',
      settings: { preset, ...(rules ? { rules } : {}), ...(presetRules ? { preset_rules: presetRules } : {}) },
    });
  }

  /** Shows a short message in the toast, without the error sound. */
  notice(text: string) {
    this.toasts.show('notice', text);
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

  /** Stops for good: no socket, no reconnect, no timer left running. */
  close() {
    this.#closed = true;
    clearTimeout(this.#reconnect);
    this.#reconnect = undefined;
    for (const timer of this.#reactionTimers) clearTimeout(timer);
    this.#reactionTimers.clear();
    this.toasts.clear();
    this.#ws?.close();
    this.#ws = null;
  }
}
