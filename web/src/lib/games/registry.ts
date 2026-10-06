// Every game this build can draw, by the id the server gives it (the room
// message's `game`). The room page asks here for the table it shows; the
// app for the rulebook pages and the tool pages. Mighty is the only game
// today; the next one registers beside it.
import type { Component } from 'svelte';
import type { RoomGame } from '../room/game';
import type { GameTypes } from '../room/types';
import { mighty } from './mighty/game';

export interface GameEntry<G extends GameTypes = GameTypes> extends RoomGame<G> {
  /** The id the server knows it by. */
  id: string;
  /** Its name, in Korean: page titles. */
  name: string;
  /** A preset's title, or null for an id the game does not know. */
  presetTitle(id: string): string | null;
  /** The rulebook page, /rules/{preset}. */
  RulebookPage: Component<{ preset: string }>;
  /** Pages of its own that load on their own, so players never download
   * them (the deck, the table's states, the share image), by path. */
  tools: Record<string, () => Promise<{ default: Component }>>;
}

/** A game of any types, as the registry holds it. */
export type AnyGame = GameEntry<any>;

export const GAMES: Record<string, AnyGame> = { [mighty.id]: mighty };

/** The game the site is about: its rulebook pages and its titles. */
export const MAIN_GAME: AnyGame = mighty;

/** The game for a room's `game` id, or null when this build does not have it. */
export function gameFor(id: string): AnyGame | null {
  return Object.hasOwn(GAMES, id) ? GAMES[id] : null;
}

/** Every game's tool pages, by path. */
export const TOOLS: Record<string, () => Promise<{ default: Component }>> = Object.assign(
  {},
  ...Object.values(GAMES).map((g) => g.tools),
);
