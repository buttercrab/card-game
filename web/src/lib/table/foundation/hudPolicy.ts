import type {Rect} from './contracts';
// Preserve the existing numeric API's mutable bounds without a legacy edge.
type Bounds={-readonly [K in keyof Rect]:Rect[K]};

export interface HudItem { id: string; width: number; height: number; full?: boolean }
export interface HudBox { id: string; bounds: Bounds }

export function statusHudPolicy(width: number, height: number) {
  const short = width > height && height <= 520;
  return { progressFull: width < 600 && !short, gapX: short ? 8 : 14 };
}

export function resultHudPolicy(width: number, height: number) {
  const short = width > height && height <= 520;
  return { summaryGap: short ? 6 : 8, secondaryOffset: short ? 6 : 0 };
}

export const SCOREBOARD_FIGURE = { artWidth:26, columnWidth:32, offsetX:3 };

export const SCOREBOARD_COLUMNS: readonly HudColumn[] = [
  { id: 'figure', width: SCOREBOARD_FIGURE.columnWidth }, { id: 'identity', width: 'fill' }, { id: 'hand', width: 40 }, { id: 'total', width: 40 },
];

export function layoutHudStack(items: readonly HudItem[], width: number, gap = 8) {
  let y = 0;
  const nodes = items.map(item => {
    const bounds = { x: 0, y, width: Math.max(0, width), height: Math.max(0, item.height) };
    y += bounds.height + gap; return { id: item.id, bounds };
  });
  return { nodes, height: nodes.length ? y - gap : 0 };
}

/** Logical HUD boxes; leaf text and artwork measurements come from the renderer. */
export function layoutHudFlow(items: readonly HudItem[], width: number, options: {
  gapX?: number; gapY?: number; height?: number; justify?: 'start' | 'center' | 'end';
} = {}) {
  width = Math.max(0, width);
  const gapX = options.gapX ?? 14, gapY = options.gapY ?? 2;
  const lines: { items: HudItem[]; width: number; height: number }[] = [];
  for (const item of items) {
    const entry = { ...item, width: item.full ? width : Math.min(width, Math.max(0, item.width)), height: Math.max(0, item.height) };
    let line = lines.at(-1);
    if (!line || entry.full || line.items.some(value => value.full) || line.width + gapX + entry.width > width) {
      line = { items: [], width: 0, height: 0 }; lines.push(line);
    }
    line.width += (line.items.length ? gapX : 0) + entry.width;
    line.height = Math.max(line.height, entry.height); line.items.push(entry);
  }
  const contentHeight = lines.reduce((sum, line) => sum + line.height, 0) + Math.max(0, lines.length - 1) * gapY;
  let y = options.height === undefined ? 0 : (options.height - contentHeight) / 2;
  const nodes: HudBox[] = [];
  for (const line of lines) {
    let x = options.justify === 'start' ? 0 : options.justify === 'end' ? width - line.width : (width - line.width) / 2;
    for (const item of line.items) {
      nodes.push({ id: item.id, bounds: { x, y: y + (line.height - item.height) / 2, width: item.width, height: item.height } });
      x += item.width + gapX;
    }
    y += line.height + gapY;
  }
  return { nodes, height: contentHeight };
}

export interface HudColumn { id: string; width: number | 'fill' }
/** Common scoreboard/list columns, independent of game counters and scoring rules. */
export function layoutHudColumns(columns: readonly HudColumn[], width: number, gap = 8) {
  const fixed = columns.reduce((sum, column) => sum + (column.width === 'fill' ? 0 : column.width), 0);
  const flexible = columns.filter(column => column.width === 'fill').length;
  const fill = flexible ? Math.max(0, width - fixed - Math.max(0, columns.length - 1) * gap) / flexible : 0;
  let x = 0;
  return columns.map(column => {
    const columnWidth = column.width === 'fill' ? fill : column.width;
    const result = { id: column.id, x, width: columnWidth }; x += columnWidth + gap; return result;
  });
}

export function layoutHudResult(width: number, sizes: Record<string, { width: number; height: number }>, gap = 8) {
  const value = sizes.value ?? { width: 0, height: 0 };
  const title = sizes.title ?? { width: 0, height: 0 };
  const description = sizes.description ?? { width: 0, height: 0 };
  const award = sizes.award ?? { width: 0, height: 0 };
  const leftWidth = Math.max(0, width - value.width - (value.width ? gap : 0));
  const contentHeight = Math.max(title.height + 2 + description.height, value.height);
  return { leftWidth, height: contentHeight + (award.height ? award.height + 2 : 0), nodes: [
    { id: 'title', bounds: { x: 0, y: 0, width: leftWidth, height: title.height } },
    { id: 'description', bounds: { x: 0, y: title.height + 2, width: leftWidth, height: description.height } },
    { id: 'value', bounds: { x: width - value.width, y: (contentHeight - value.height) / 2, width: value.width, height: value.height } },
    { id: 'award', bounds: { x: 0, y: contentHeight + 2, width, height: award.height } },
  ] };
}
