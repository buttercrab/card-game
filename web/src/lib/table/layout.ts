import { shortDecisionColumn } from './frameLayout';

/** Numeric table geometry. Identity/perspective and game state belong to callers. */
export interface Size { width: number; height: number }
export interface Anchor { x: number; y: number; originX: number; originY: number }
export type SeatCount = 3 | 5 | 6;
type Pair = readonly [number, number];
export const LAYOUT_PRESETS: Readonly<Record<SeatCount, readonly Pair[]>> = {
  3: [[0, 1], [.8660254037844386, -.5], [-.8660254037844386, -.5]],
  5: [[0, 1], [1.15, .05], [.6, -.9], [-.6, -.9], [-1.15, .05]],
  6: [[0, 1], [.8660254037844386, .5], [.8660254037844386, -.5], [0, -1], [-.8660254037844386, -.5], [-.8660254037844386, .5]],
};
const clamp = (low: number, value: number, high: number) => Math.max(low, Math.min(high, value));
const anchor = (x: number, y: number, originX = .5, originY = .5): Anchor => ({x, y, originX, originY});

export interface TableLayoutInput {
  viewport: Size;
  region: Size;
  seatCount: SeatCount;
  watching: boolean;
}

export function calculateTableLayout({ viewport, region, seatCount, watching }: TableLayoutInput) {
  const landscape = viewport.width > viewport.height && viewport.height <= 520;
  const compact = region.height <= 320 || landscape;
  const desktop = viewport.width >= 1024 && viewport.height >= 640;
  const tablet = viewport.width >= 600 && viewport.width <= 1023;
  const width = compact ? region.width : Math.min(region.width * (tablet ? .94 : 1), region.height * 1.35);
  const height = region.height;
  let seatWidth = desktop ? clamp(160, height * .32, 192) : tablet ? clamp(92, width * .16, 160) : clamp(92, width * .1, 148);
  if (compact) seatWidth = Math.min(width * .23, 92);
  if (compact && seatCount === 6) seatWidth = Math.max(0, Math.min(seatWidth, width / 5 - 4));
  // The generic identity renderer reserves a compact 56px footprint. Mighty
  // retains its established larger five-seat band measurements.
  const nominalSeatHeight = seatCount !== 5 ? 56 : desktop ? 100 : tablet ? 116 : 106;
  const seatHeight = compact && seatCount !== 5 ? Math.max(0, Math.min(nominalSeatHeight, height / 2 - 4)) : nominalSeatHeight;
  const cardMax = desktop ? 1.2 * clamp(88, viewport.height * .12, 124) : tablet ? 100 : 92;
  const centerY = watching || landscape ? height / 2 : height / 2 + seatHeight / 2 - 12;
  let cardWidth = watching
    ? clamp(36, Math.min((width - 2 * seatWidth - 16) / 3.55, (height / 2 - seatHeight - 40) / 2.2), cardMax)
    : clamp(40, Math.min((width - 2 * seatWidth - 16) / 3.55, (height / 2 - seatHeight / 2 - 23) / 2.04, (height / 2 - seatHeight / 2 - 82) / 2.18), cardMax);
  if (landscape) cardWidth = 32;
  if (seatCount !== 5) {
    const arenaHeight = Math.max(0, height - 2 * seatHeight - 16);
    const arenaWidth = Math.max(0, width - (compact || seatCount === 3 ? 16 : 2 * seatWidth + 16));
    const fit = compact
      ? Math.min((arenaWidth - (seatCount - 1) * 4) / seatCount, arenaHeight / 1.4)
      : Math.min(arenaWidth / (1 + 2 * .8660254037844386 * 1.3), arenaHeight / ((seatCount === 3 ? 2.65 : 3.2) * 1.4));
    cardWidth = Math.max(0, Math.min(cardMax, fit));
  }
  const cardHeight = cardWidth * 1.4;
  const tx = cardWidth * 1.1;
  const ty = cardHeight * 1.06 + 8;
  const top = Math.max(0, centerY - .9 * ty - cardHeight / 2 - seatHeight - 20);
  const seats = LAYOUT_PRESETS[seatCount].map(([x, y], relative): Anchor => {
    if (relative === 0 && watching) return anchor(width / 2, height - seatHeight, .5, 0);
    if (compact && relative > 0) return anchor(width * (seatCount - relative - .5) / (seatCount - 1), 0, .5, 0);
    if (seatCount === 5) {
      if (relative === 1) return anchor(width, centerY - seatHeight / 2, 1, 0);
      if (relative === 2) return anchor(width * .75, top, .5, 0);
      if (relative === 3) return anchor(width * .25, top, .5, 0);
      if (relative === 4) return anchor(0, centerY - seatHeight / 2, 0, 0);
    }
    if (seatCount === 3) {
      return relative === 1 ? anchor(width - seatWidth / 2, 0, .5, 0)
        : relative === 2 ? anchor(seatWidth / 2, 0, .5, 0)
        : anchor(width / 2, height - seatHeight, .5, 0);
    }
    // Six identities reserve three columns around a central card arena.
    if (relative === 0) return anchor(width / 2, height - seatHeight, .5, 0);
    if (relative === 3) return anchor(width / 2, 0, .5, 0);
    return anchor(relative < 3 ? width - seatWidth / 2 : seatWidth / 2, height * (relative === 1 || relative === 5 ? .72 : .28));
  });
  let cards = LAYOUT_PRESETS[seatCount].map(([x, y]) => anchor(width / 2 + x * tx, centerY + y * ty));
  if (seatCount !== 5) {
    if (compact) {
      const rowWidth = seatCount * cardWidth + (seatCount - 1) * 4;
      cards = LAYOUT_PRESETS[seatCount].map((_, index) => anchor((width - rowWidth) / 2 + cardWidth / 2 + index * (cardWidth + 4), height / 2));
    } else {
      const horizontal = cardWidth * 1.3;
      const vertical = cardHeight * 1.1;
      const center = height / 2 - (seatCount === 3 ? vertical / 4 : 0);
      cards = LAYOUT_PRESETS[seatCount].map(([x,y]) => anchor(width / 2 + x * horizontal, center + y * vertical));
    }
  }
  const rowCenterX = width + 8 + shortDecisionColumn(Math.max(0,viewport.width-32)).width / 2;
  return {
    mode: landscape ? 'landscape' as const : compact ? 'compact' as const : 'regular' as const,
    ring: {x: (region.width - width) / 2, y: 0, width, height},
    seatWidth, seatHeight, cardWidth, cardHeight, centerY, seats, cards,
    note: watching ? anchor(width / 2, height - seatHeight - 6, .5, 1) : anchor(width / 2, Math.min(centerY + ty + cardHeight / 2 + 20, height - 30), .5, 0),
    leadNote: anchor(width / 2, centerY),
    rowCenterX,
  };
}

/** Preserve the short landscape trick's played-order row. */
export function cardRowAnchor(centerX: number, index: number, count: number): Anchor {
  return anchor(centerX - (count * 32 + Math.max(0, count - 1) * 4) / 2 + index * 36, 0, 0, 0);
}

/** Arena overlays use the same numeric ring budget as seats and played cards. */
export function calculateArenaOverlays(viewport: Size, layout: ReturnType<typeof calculateTableLayout>, admissionHeight = 0) {
  const width = layout.ring.width, height = layout.ring.height;
  const short = viewport.width > viewport.height && viewport.height <= 520;
  const compact = height <= 320;
  const reviewWidth = Math.max(0, short ? width - 16 : compact ? width - 20 : Math.min(500, width - 2 * layout.seatWidth - 16));
  const reviewTop = short ? 76 : compact ? 84 : Math.max(layout.centerY - 150, layout.seatHeight + 24);
  const reviewBottom = short || compact ? 4 : 152;
  const admissionWidth = short ? width : Math.min(280, Math.max(0, width - 16));
  return {
    review: { x: (width - reviewWidth) / 2, y: reviewTop, width: reviewWidth, height: Math.max(0, height - reviewTop - reviewBottom) },
    admission: { x: (width - admissionWidth) / 2, y: short ? height - admissionHeight : layout.centerY - admissionHeight / 2, width: admissionWidth, height: admissionHeight },
  };
}

export interface OwnDockInput { viewport: Size; region: Size; centered: boolean }
export function calculateOwnDock({viewport, region, centered}: OwnDockInput) {
  const landscape = viewport.width > viewport.height && viewport.height <= 520;
  const desktop = viewport.width >= 1024 && viewport.height >= 640;
  if (desktop) return { ...anchor(centered ? region.width / 2 : 95, centered ? region.height / 2 : (region.height + 6) / 2), width: 170 };
  if (landscape) {
    // The full-width dock spans arena and decisions. Waiting beneath the
    // decision lane keeps its normal-size identity clear of opponent actions.
    const decision=shortDecisionColumn(region.width);
    return centered
      ? {...anchor(decision.centerX,(region.height-4)/2),width:Math.min(170,Math.max(0,region.width))}
      : {...anchor(50,2,.5,0),width:92};
  }
  if (centered) return {...anchor(region.width/2,region.height/2),width:Math.min(170,Math.max(0,region.width))};
  const padding = viewport.width <= 360 ? 3 : 8;
  // The playing identity owns its measured height, including feedback. Centering
  // that complete box in a fixed 60/64px row pushed its paint above the tray.
  return {...anchor(region.width / 2, 4, .5, 0), width:Math.max(0, region.width - padding * 2)};
}

/** Resolve an intrinsic HTML leaf/group against an engine anchor. */
export function placeMeasuredAt(anchor:Anchor,size:Size) { return {x:anchor.x-anchor.originX*size.width,y:anchor.y-anchor.originY*size.height,width:size.width,height:size.height}; }
export function arenaTextPolicy(ringWidth:number) { return {maxWidth:Math.max(0,ringWidth-16),whoMaxWidth:98}; }
