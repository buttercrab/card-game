import type {NativeAdvice,NativeReaction} from './ephemeral';
import { Toasts } from './toast.svelte';
// A room that is not there, for /preview: the room and hand it is given,
// and nothing it is asked to do goes anywhere. Its state changes as the
// preview script says, and the table animates them as it would a server's.

import type { TableClient } from './tableClient';
import type { GameTypes, RoomViewOf, StateMsgOf } from './types';

export class FakeClient<G extends GameTypes = GameTypes> implements TableClient<G> {
  room = $state<RoomViewOf<G> | null>(null);
  game = $state<StateMsgOf<G> | null>(null);
  seat = $state<number | null>(null);
  viewerId = $state<string | null>('preview');
  viewerName = $state('관전자');
  observerReactions = $state<Record<string, {text: string; id: number}>>({});
  status = $state<TableClient['status']>('open');
  toasts = new Toasts();
  reactions = $state<Record<number, { text: string; id: number }>>({});
  hint = $state<G['action'] | null>(null);
  /** Preview has no authenticated receive-time authority. */
  nativeHint = $state<NativeAdvice<G['action']>|null>(null);
  nativeReactions = $state<readonly NativeReaction[]>([]);
  readonly ephemeralConnectionEpoch='preview';
  clock = $state<TableClient['clock']>(null);
  /** A made-up hand is no one's record. */
  readonly keepsRecord = false;
  onmove: ((order: number[]) => void) | null = null;
  refusal: TableClient['refusal'] = null;

  constructor(start: Partial<Pick<FakeClient<G>, 'room' | 'game' | 'seat' | 'reactions' | 'clock' | 'hint'>>) {
    Object.assign(this, start);
  }

  observe(name: string) { this.viewerName = name; }
  requestSeat(requested: boolean, _seat?: number) { if (this.room?.observers) this.room.observers = this.room.observers.map(o => o.id === this.viewerId ? {...o, requested} : o); }
  offerSeat(_requesterId: string | null) {}
  acceptSeat(_seat: number, _targetId: string) {}
  resetScores() { if (this.room) this.room.scores = this.room.scores.map(() => 0); }
  ready(ready: boolean) { if (this.room && this.seat !== null) { this.room.ready ??= this.room.seats.map(s => s.kind === 'bot'); this.room.ready[this.seat] = ready; } }
  join() {}
  leave() {}
  setTable() {}
  shuffleNext() {}
  swapSeats() {}
  clearSeat() {}
  addBot() {}
  removeBot() {}
  setSettings() {}
  notice(text: string) { this.toasts.show('notice', text); }
  askHint() { this.hint = this.game?.legal[0] ?? null; }
  react(text: string) { if (this.seat !== null) this.reactions[this.seat] = { text, id: Date.now() }; }
  start() {}
  act(action: G['action']) { window.dispatchEvent(new CustomEvent('preview-action', { detail: action })); }
  close() { this.toasts.clear(); }
}
