import { sound } from './sound';
import type { Action, BotLevel, BotPace, RoomMsg, Rules, ServerMsg, StateMsg } from './types';

interface Saved {
  token: string;
  name: string;
}

const NAME_KEY = 'name';

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
  [/only between hands/, '규칙은 판과 판 사이에만 바꿀 수 있어요'],
  [/bidding range is empty/, '공약 최소가 최대보다 클 수 없어요'],
  [/no-trump bonus/, '노기루다 보너스는 최소 공약보다 작아야 해요'],
  [/no way to choose a friend/, '프렌드를 정하는 방법을 하나는 골라 주세요'],
  [/invalid rules/, '그 규칙으로는 게임을 할 수 없어요'],
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

  #id: string;
  #ws: WebSocket | null = null;
  #closed = false;
  #retry = 500;
  #errorTimer: ReturnType<typeof setTimeout> | undefined;
  #reactionId = 0;

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
      this.#retry = 500;
      const saved = load<Saved>(this.#key);
      if (saved) this.#send({ type: 'join', name: saved.name, token: saved.token });
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

  async #exists(): Promise<boolean> {
    try {
      return (await fetch(`/api/rooms/${this.#id}`)).ok;
    } catch {
      return true;
    }
  }

  #receive(msg: ServerMsg) {
    switch (msg.type) {
      case 'room':
        this.room = msg;
        break;
      case 'state':
        this.game = msg;
        this.hint = null;
        break;
      case 'hint':
        this.hint = msg.action;
        break;
      case 'welcome': {
        this.seat = msg.seat;
        const name = load<Saved>(this.#key)?.name ?? savedName();
        store(this.#key, { token: msg.token, name } satisfies Saved);
        break;
      }
      case 'reaction': {
        const id = ++this.#reactionId;
        this.reactions[msg.seat] = { text: msg.text, id };
        sound.react();
        setTimeout(() => {
          if (this.reactions[msg.seat]?.id === id) delete this.reactions[msg.seat];
        }, 2800);
        break;
      }
      case 'error':
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
    this.#send({ type: 'join', name, token: saved?.token || null, seat: seat ?? null });
  }

  leave() {
    this.#send({ type: 'leave' });
    this.seat = null;
    try {
      localStorage.removeItem(this.#key);
    } catch {
      // Nothing to forget.
    }
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

  setPace(pace: BotPace) {
    this.#send({ type: 'set_pace', pace });
  }

  askHint() {
    this.#send({ type: 'hint' });
  }

  react(text: string) {
    this.#send({ type: 'react', text });
  }

  start() {
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
