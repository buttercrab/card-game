// A room that is not there, for /preview: the room and hand it is given,
// and nothing it is asked to do goes anywhere. Its state changes as the
// preview script says, and the table animates them as it would a server's.

import type { TableClient } from './tableClient';
import type { Toast } from './toast.svelte';
import type { GameTypes, RoomViewOf, StateMsgOf } from './types';

export class FakeClient<G extends GameTypes = GameTypes> implements TableClient<G> {
  room = $state<RoomViewOf<G> | null>(null);
  game = $state<StateMsgOf<G> | null>(null);
  seat = $state<number | null>(null);
  status = $state<TableClient['status']>('open');
  toasts = $state<{ current: Toast | null }>({ current: null });
  reactions = $state<Record<number, { text: string; id: number }>>({});
  hint = $state<G['action'] | null>(null);
  clock = $state<TableClient['clock']>(null);
  /** A made-up hand is no one's record. */
  readonly keepsRecord = false;
  onmove: ((order: number[]) => void) | null = null;
  refusal: TableClient['refusal'] = null;

  constructor(start: Partial<Pick<FakeClient<G>, 'room' | 'game' | 'seat' | 'reactions' | 'clock' | 'hint'>>) {
    Object.assign(this, start);
  }

  join() {}
  leave() {}
  setTable() {}
  shuffleNext() {}
  swapSeats() {}
  clearSeat() {}
  addBot() {}
  removeBot() {}
  setSettings() {}
  notice() {}
  askHint() {}
  react() {}
  start() {}
  act() {}
  close() {}
}
