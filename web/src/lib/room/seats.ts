// Where everyone sits, and what each seat is called. You sit at the bottom;
// play goes to the next seat number, which seen from the bottom runs
// counter-clockwise: right, top right, top left, left. Pure, so it is
// tested on its own (seats.test.ts).

import { occupantName } from './names';
import type { SeatInfo } from '../games/mighty/types';

/** A seat's place on screen, counted from the bottom seat. */
export class Ring {
  constructor(
    /** How many seats. */
    readonly n: number,
    /** The seat drawn at the bottom: yours, or seat 0 for a watcher. */
    readonly bottom: number,
  ) {}

  /** The seat `r` places round from the bottom. */
  seatAt(r: number): number {
    return (this.bottom + r) % this.n;
  }

  /** How many places round from the bottom `seat` is. */
  relative(seat: number): number {
    return (seat - this.bottom + this.n) % this.n;
  }

  /** The angle of place `r`, in radians, the bottom pointing down. */
  angle(r: number): number {
    return ((90 - (r * 360) / this.n) * Math.PI) / 180;
  }

  /** Where place `r` is from the middle, as a unit vector (y down). */
  direction(r: number): { x: number; y: number } {
    return { x: Math.cos(this.angle(r)), y: Math.sin(this.angle(r)) };
  }

  /** Where the card played from place `r` lands, in multiples of the
   * card's spacing. Five players sit in fixed bands (me, right, top right,
   * top left, left), so their cards land on matching, mirror-image spots
   * rather than on a pentagon, which bunched the trick off-centre on
   * narrow screens. */
  slot(r: number): [number, number] {
    if (this.n === 5) return BANDS[r];
    const d = this.direction(r);
    return [d.x, d.y];
  }

  /** The places drawn round the felt: all but yours when seated. */
  around(seated: boolean): number[] {
    return Array.from({ length: this.n }, (_, r) => r).filter((r) => !seated || r > 0);
  }

  /**
   * Where the figure at place `r` looks: at the middle when a card has
   * just landed or it is its own turn, else at whoever's turn it is (you,
   * on yours). Null to look ahead.
   */
  lookAt(r: number, turn: number | null, myTurn: boolean, glanceMiddle: boolean): { x: number; y: number } | null {
    const from = this.direction(r);
    const toward = (x: number, y: number) => (x === from.x && y === from.y ? null : { x: x - from.x, y: y - from.y });
    if (glanceMiddle || (turn !== null && this.relative(turn) === r)) return toward(0, 0);
    if (turn === null) return null;
    const t = this.direction(myTurn ? 0 : this.relative(turn));
    return toward(t.x, t.y);
  }
}

const BANDS: [number, number][] = [
  [0, 1],
  [1.15, 0.05],
  [0.6, -0.9],
  [-0.6, -0.9],
  [-1.15, 0.05],
];

/** The name a seat is shown by: 나 for yours; the one sitting there; else,
 * while a hand that player was in is still on the table, the name they
 * had; else its number. */
export function seatName(seat: number, me: number | null, seats: SeatInfo[] | undefined, known: (string | null)[], inHand: boolean): string {
  if (seat === me) return '나';
  return occupantName(seats?.[seat], seat) ?? (inHand ? known[seat] : null) ?? `${seat + 1}번 자리`;
}

/** Who last sat at each seat, kept while they are away so a hand still on
 * the table (its result, its replay) names a player who has since left. */
export function rememberNames(was: (string | null)[], seats: SeatInfo[]): (string | null)[] {
  return seats.map((s, i) => occupantName(s, i) ?? was[i] ?? null);
}

/** The names moved with their seats: `order[s]` is where seat `s` went. */
export function moveNames(known: (string | null)[], order: number[]): (string | null)[] {
  const moved: (string | null)[] = [];
  known.forEach((name, s) => (moved[order[s] ?? s] = name));
  return moved;
}

/** A seat as its menu's button names it. */
export function seatLabel(seat: number, me: number | null, info: SeatInfo | undefined): string {
  const name = occupantName(info, seat);
  if (name === null) return `${seat + 1}번 자리`;
  return seat === me ? '내 자리' : name;
}
