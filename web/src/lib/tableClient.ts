// What the room page and the table need of a connection to one room. The
// real one is RoomClient (client.svelte.ts); /preview draws the same pages
// on a made-up one (preview/FakeClient.svelte.ts).

import type { Toast } from './toast.svelte';
import type { Action, BotLevel, Preset, RoomView, Rules, StateMsg } from './types';

export interface TableClient {
  /** The room as the server last sent it. */
  readonly room: RoomView | null;
  /** The hand as this seat (or a watcher) sees it; null between hands. */
  readonly game: StateMsg | null;
  /** This tab's seat, or null when watching. */
  readonly seat: number | null;
  readonly status: 'connecting' | 'open' | 'closed' | 'missing';
  /** The toast on screen: an error the server sent, or a notice. */
  readonly toasts: { readonly current: Toast | null };
  /** The latest reaction per seat; `id` restarts its animation. */
  readonly reactions: Record<number, { text: string; id: number }>;
  /** What the bot would do in your place, until the hand moves on. */
  readonly hint: Action | null;
  /** The turn timer, with its deadline on this page's clock (performance.now()). */
  readonly clock: { seat: number; deadline: number; total: number } | null;
  /** Whether finished hands go into this browser's record (내 기록). */
  readonly keepsRecord: boolean;
  /** Called as seats are about to move, while the table still shows them
   * where they were; `order[s]` is where seat `s` goes. */
  onmove: ((order: number[]) => void) | null;

  join(name: string, seat?: number): void;
  leave(): void;
  setTable(table: { turn_secs?: number; shuffle?: boolean; shuffle_next?: boolean }): void;
  shuffleNext(on: boolean): void;
  swapSeats(a: number, b: number): void;
  clearSeat(seat: number): void;
  addBot(seat: number, level?: BotLevel): void;
  removeBot(seat: number): void;
  setRules(preset: Preset, rules: Rules | null, presetRules?: Rules): void;
  notice(text: string): void;
  askHint(): void;
  react(text: string): void;
  start(): void;
  act(action: Action): void;
  /** Stops for good: no socket, no reconnect, no timer left running. */
  close(): void;
}
