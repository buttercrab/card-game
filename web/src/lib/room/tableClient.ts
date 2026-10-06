// What the room page and a game's table need of a connection to one room,
// for any game `G`. The real one is RoomClient (client.svelte.ts); /preview
// draws the same pages on a made-up one (fakeClient.svelte.ts).

import type { Toast } from './toast.svelte';
import type { Refusal } from '../errorText';
import type { BotLevel, GameTypes, RoomViewOf, StateMsgOf } from './types';

export interface TableClient<G extends GameTypes = GameTypes> {
  /** The room as the server last sent it. */
  readonly room: RoomViewOf<G> | null;
  /** The hand as this seat (or a watcher) sees it; null between hands. */
  readonly game: StateMsgOf<G> | null;
  /** This tab's seat, or null when watching. */
  readonly seat: number | null;
  readonly status: 'connecting' | 'open' | 'closed' | 'missing';
  /** The toast on screen: an error the server sent, or a notice. */
  readonly toasts: { readonly current: Toast | null };
  /** The latest reaction per seat; `id` restarts its animation. */
  readonly reactions: Record<number, { text: string; id: number }>;
  /** What the bot would do in your place, until the hand moves on. */
  readonly hint: G['action'] | null;
  /** The turn timer, with its deadline on this page's clock (performance.now()). */
  readonly clock: { seat: number; deadline: number; total: number } | null;
  /** Whether finished hands go into this browser's record (내 기록). */
  readonly keepsRecord: boolean;
  /** Called as seats are about to move, while the table still shows them
   * where they were; `order[s]` is where seat `s` goes. */
  onmove: ((order: number[]) => void) | null;
  /** The game's own words for a refusal it alone makes (rules that cannot
   * be played), or null to use the room's. */
  refusal: Refusal | null;

  join(name: string, seat?: number): void;
  leave(): void;
  setTable(table: { turn_secs?: number; shuffle?: boolean; shuffle_next?: boolean }): void;
  shuffleNext(on: boolean): void;
  swapSeats(a: number, b: number): void;
  clearSeat(seat: number): void;
  addBot(seat: number, level?: BotLevel): void;
  removeBot(seat: number): void;
  /** The game's settings for the hands to come (its preset and rules). */
  setSettings(settings: G['settings']): void;
  notice(text: string): void;
  askHint(): void;
  react(text: string): void;
  start(): void;
  act(action: G['action']): void;
  /** Stops for good: no socket, no reconnect, no timer left running. */
  close(): void;
}
