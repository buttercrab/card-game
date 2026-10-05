// A room that is not there, for /preview: the room and hand it is given,
// and nothing it is asked to do goes anywhere. Its state changes as the
// preview script says, and the table animates them as it would a server's.

import type { TableClient } from '../tableClient';
import type { Toast } from '../toast.svelte';
import type { Action, RoomMsg, StateMsg } from '../types';

export class FakeClient implements TableClient {
  room = $state<RoomMsg | null>(null);
  game = $state<StateMsg | null>(null);
  seat = $state<number | null>(null);
  status = $state<TableClient['status']>('open');
  toasts = $state<{ current: Toast | null }>({ current: null });
  reactions = $state<Record<number, { text: string; id: number }>>({});
  hint = $state<Action | null>(null);
  clock = $state<TableClient['clock']>(null);
  /** A made-up hand is no one's record. */
  readonly keepsRecord = false;
  onmove: ((order: number[]) => void) | null = null;

  constructor(start: Partial<Pick<FakeClient, 'room' | 'game' | 'seat' | 'reactions' | 'clock' | 'hint'>>) {
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
  setRules() {}
  notice() {}
  askHint() {}
  react() {}
  start() {}
  act() {}
  close() {}
}
