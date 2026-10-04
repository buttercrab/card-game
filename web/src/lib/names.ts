// Bots go by small, warm names instead of "봇 2". The name belongs to the
// seat, so a bot that takes over a seat keeps the same name for everyone.
const BOT_NAMES = ['두부', '모과', '호두', '보리', '단추', '콩떡', '소금'];

export function botName(seat: number): string {
  return BOT_NAMES[seat % BOT_NAMES.length];
}
