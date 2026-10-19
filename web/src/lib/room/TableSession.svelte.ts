import { untrack } from 'svelte';
import { savedName } from './client.svelte';
import type { TableClient } from './tableClient';
import type { BotLevel, GameTypes, RoomViewOf } from './types';
import type { TableUi } from './ui.svelte';
import { createSessionState, SessionCore, type SessionOptions } from './sessionCore';

/** Svelte state and lifecycle adapter; room decisions belong to SessionCore. */
export class TableSession<G extends GameTypes = GameTypes> {
  #core: SessionCore;

  constructor(
    readonly client: TableClient<G>,
    readonly ui: TableUi,
    private readonly getRoom: () => RoomViewOf<G> | null,
    options: SessionOptions = {},
  ) {
    const state = $state(createSessionState(untrack(() => savedName() || client.viewerName), options.initialBottom));
    this.#core = untrack(() => new SessionCore(client, ui, getRoom, options, state));
    $effect(() => {
      // Track authoritative inputs, then refresh without subscribing to command callbacks.
      const room = this.getRoom();
      void room?.in_hand;
      void room?.seats;
      void client.seat;
      void client.viewerName;
      void ui.participationSeat;
      void (options.getSettling?.() ?? state.settling);
      untrack(() => this.#core.sync());
    });
  }

  get room() { return this.getRoom(); }
  get visitorBottom() { return this.#core.visitorBottom; }
  set visitorBottom(value: number | null) { this.#core.visitorBottom = value; }
  get choosing() { return this.#core.choosing; }
  set choosing(value: boolean) { this.#core.choosing = value; }
  get previewSeat() { return this.#core.previewSeat; }
  set previewSeat(value: number | null) { this.#core.previewSeat = value; }
  get sitName() { return this.#core.sitName; }
  set sitName(value: string) { this.#core.sitName = value; }
  get settling() { return this.#core.settling; }
  set settling(value: boolean) { this.#core.settling = value; }
  get bottom() { return this.#core.bottom; }
  get arranging() { return this.#core.arranging; }
  get centered() { return this.#core.centered; }
  get prep() { return this.#core.prep; }
  get shuffleNote() { return this.#core.shuffleNote; }
  sync() { this.#core.sync(); }
  advance() { this.#core.advance(); }
  setShuffle(on: boolean) { this.#core.setShuffle(on); }
  withName(action: () => void) { this.#core.withName(action); }
  seatsMoved() { this.#core.seatsMoved(); }
  choose() { this.#core.choose(); }
  cancelChoice() { this.#core.cancelChoice(); }
  openSeat(seat: number) { this.#core.openSeat(seat); }
  sitAt(seat: number) { this.#core.sitAt(seat); }
  commitChoice(seat: number) { this.#core.commitChoice(seat); }
  confirmChoice() { this.#core.confirmChoice(); }
  addBot(seat: number, level?: BotLevel) { this.#core.addBot(seat, level); }
  swap(seat: number) { this.#core.swap(seat); }
  moveHere(seat: number) { this.#core.moveHere(seat); }
  removeBot(seat: number) { this.#core.removeBot(seat); }
  kick(seat: number) { this.#core.kick(seat); }
  relieve(seat: number) { this.#core.relieve(seat); }
  stand() { this.#core.stand(); }
}
