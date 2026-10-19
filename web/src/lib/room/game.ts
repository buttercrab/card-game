// What the room page needs of the game its table plays: the table itself,
// the rules' name and the sheet that shows and changes them. Each game
// gives these through the registry (games/registry.ts), which the app
// hands to the room page; the room never imports a game.
import type { Component } from 'svelte';
import type { Refusal } from '../errorText';
import type { TableClient } from './tableClient';
import type { GameTypes, RoomViewOf, StateMsgOf } from './types';
import type { GamePresenter } from '../table/presentation';
import type { TableUi } from './ui.svelte';
import type { TableSession } from './TableSession.svelte';

/** What a game's table is given by the room page. */
export interface TableProps<G extends GameTypes> {
  client: TableClient<G>;
  /** Game-owned projection; shared controls consume its semantic action offers. */
  present?: GamePresenter<StateMsgOf<G>, G['action']>;
  /** What is open at the table: the room page's own, shared with its menu. */
  ui?: TableUi;
  /** Shared room lifecycle and seating, owned by Room rather than the game. */
  session?: TableSession<G>;
  /** The rules' name, for the table between hands. */
  rulesName?: string;
  /** Opens the table menu. */
  onmenu?: () => void;
  /** Opens the single settings panel directly. */
  onsettings?: () => void;
  onrules?: () => void;
  oninvite?: () => void;
  onpeople?: () => void;

}

/** The game's rules as a sheet over the room: to read (규칙 보기), or
 * with `edit` to change between hands (규칙 바꾸기). */
export interface RulesSheetProps<G extends GameTypes> {
  room: RoomViewOf<G>;
  client: TableClient<G>;
  /** Game-owned projection; shared controls consume its semantic action offers. */
  present?: GamePresenter<StateMsgOf<G>, G['action']>;
  edit: boolean;
  onclose: () => void;
}

export interface RoomGame<G extends GameTypes = GameTypes> {
  /** Every registered game supplies a framework-independent presentation adapter. */
  present: GamePresenter<StateMsgOf<G>, G['action']>;
  /** The table: everything about a hand, and the lobby between hands. */
  Table: Component<TableProps<G>>;
  /** The table's rules, to read or to change. */
  RulesSheet: Component<RulesSheetProps<G>>;
  /** The rules' name at the table and in its menu, with what the table changed. */
  rulesName(room: RoomViewOf<G>): string;
  /** The game's own words for a refusal only it makes. */
  refusal?: Refusal;
}

/** The game for a room's `game` id, if this build has it. */
export type GameResolver = (id: string) => RoomGame<any> | null;
