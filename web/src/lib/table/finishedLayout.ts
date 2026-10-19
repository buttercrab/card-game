/** Round-history geometry. Every seat retains the same chronological columns. */
export function finishedLayout(width: number, rounds: number, identityHeights: readonly number[], compact: boolean) {
  width = Math.max(0, width); rounds = Math.max(1, rounds);
  const tiny = compact && width <= 240;
  const side = compact && !tiny;
  const identityWidth = side ? Math.min(72, width) : width;
  const cardsX = side ? Math.min(width, 80) : 0;
  const cardsWidth = Math.max(0, width - cardsX);
  const columnWidth = Math.max(0, (cardsWidth - (rounds - 1) * 2) / rounds);
  const cardWidth = Math.min(tiny ? 14 : compact ? 32 : 40, columnWidth);
  const cardHeight = cardWidth * 1.4;
  const headerHeight = side || tiny ? 14 : 30;
  let y = headerHeight + (tiny ? 2 : 4);
  const rows = identityHeights.map(identityHeight => {
    const height = side ? Math.max(identityHeight, cardHeight) : identityHeight + (tiny ? 0 : 3) + cardHeight;
    const row = { y, height, identityY: side ? (height - identityHeight) / 2 : 0, cardsY: side ? (height - cardHeight) / 2 : identityHeight + (tiny ? 0 : 3) };
    y += height + (tiny ? 1 : compact ? 3 : 7); return row;
  });
  return { tiny, side, identityWidth, cardsX, columnWidth, cardWidth, cardHeight, headerHeight,
    labelY: 0, columnsY: side || tiny ? 0 : 16, rows, height: rows.length ? y - (tiny ? 1 : compact ? 3 : 7) : headerHeight,
    columnX: (index: number) => cardsX + index * (columnWidth + 2),
    cardX: (index: number) => index * (columnWidth + 2) + (columnWidth - cardWidth) / 2 };
}
