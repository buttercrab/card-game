import type { SeatInfo } from './types';

// Bots go by small, warm names instead of "봇 2". The server gives each bot
// its name when it sits down (crates/server/src/room.rs, BOT_NAMES), and the
// bot keeps it when seats move, so a shuffle never looks like bots trading
// places with each other's names.
const BOT_NAMES = ['두부', '모과', '호두', '보리', '단추', '콩떡', '소금'];

/** The name a bot at `seat` had before the server named its bots. */
export function botName(seat: number): string {
  return BOT_NAMES[seat % BOT_NAMES.length];
}

/** What a seat's occupant is called: a person's name, a bot's own name
 * (servers before bots had names sent "Bot 3": then the seat's), or null
 * for an empty seat. */
export function occupantName(info: SeatInfo | undefined, seat: number): string | null {
  if (!info || info.kind === 'empty') return null;
  if (info.kind === 'bot') return info.name && !/^Bot \d+$/.test(info.name) ? info.name : botName(seat);
  return info.name;
}
