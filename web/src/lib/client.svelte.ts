import type { Action, RoomMsg, ServerMsg, StateMsg } from './types';

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

  #id: string;
  #ws: WebSocket | null = null;
  #closed = false;
  #retry = 500;
  #errorTimer: ReturnType<typeof setTimeout> | undefined;

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
        break;
      case 'welcome': {
        this.seat = msg.seat;
        const name = load<Saved>(this.#key)?.name ?? savedName();
        store(this.#key, { token: msg.token, name } satisfies Saved);
        break;
      }
      case 'error':
        this.error = msg.message;
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

  addBot(seat: number) {
    this.#send({ type: 'add_bot', seat });
  }

  removeBot(seat: number) {
    this.#send({ type: 'remove_bot', seat });
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
