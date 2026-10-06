// What is open at the table, held in one place: the menu and its question
// before leaving, a seat's choices and its question before sending a player
// to watch, the seat picked first in a swap, the result folded away. The
// room page makes one; /preview makes one already showing what it draws.

export interface TableUiState {
  /** The table's menu (Room's GameMenu). */
  menu: boolean;
  /** The menu asks before leaving mid-hand. */
  leaving: boolean;
  /** The seat whose choices are open (SeatMenu). */
  seatMenu: number | null;
  /** The seat's choices ask before sending its player to watch. */
  kicking: boolean;
  /** Swapping: the seat chosen first; the next seat tapped trades with it. */
  swapFrom: number | null;
  /** The result folded away, to look at the table. */
  folded: boolean;
}

export class TableUi implements TableUiState {
  menu = $state(false);
  leaving = $state(false);
  seatMenu = $state<number | null>(null);
  kicking = $state(false);
  swapFrom = $state<number | null>(null);
  folded = $state(false);

  constructor(start: Partial<TableUiState> = {}) {
    Object.assign(this, start);
  }

  closeMenu() {
    this.menu = false;
    this.leaving = false;
  }

  closeSeat() {
    this.seatMenu = null;
    this.kicking = false;
  }
}
