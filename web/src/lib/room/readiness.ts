import type { GameTypes, RoomViewOf } from './types';
import { sessionPreparation } from './sessionCore';

/** Typed room facade for the framework-independent readiness decision. */
export function preparation(room: RoomViewOf<GameTypes> | null, me: number | null) {
  return sessionPreparation(room, me);
}
