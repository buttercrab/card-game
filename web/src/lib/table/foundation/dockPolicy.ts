import type {Size as CoreSize,Rect} from './contracts';
// Preserve the existing numeric API's mutable shapes without a legacy edge.
type Size={-readonly [K in keyof CoreSize]:CoreSize[K]};
type Bounds={-readonly [K in keyof Rect]:Rect[K]};

export interface DockLayoutInput {
  viewport: Size;
  region: Size;
  /** Intrinsic rendered hand height, including the space above raised cards. */
  handHeight: number;
  /** Full identity/feedback footprint, supplied by the identity geometry owner. */
  identityHeight?: number;
}

export function dockIdentityRow(viewport: Size, identityHeight = 0): number {
  if (viewport.width >= 1024 && viewport.height >= 640 || viewport.width > viewport.height && viewport.height <= 520) return 0;
  return Math.ceil(Math.max(viewport.width < 600 && viewport.height <= 620 ? 60 : 64, identityHeight));
}

/** Shared dock policy; outputs are local to the tray, independent of game state. */
function calculateDockAllocation({ viewport, region, handHeight, identityHeight = 0 }: DockLayoutInput): {
  profile: 'portrait' | 'short-portrait' | 'desktop' | 'landscape';
  handArea: Bounds;
  hand: Bounds;
  countdown: Bounds;
  identity:Bounds;
  tools:Bounds;
  minimumHeight:number;
} {
  for (const value of [viewport.width, viewport.height, region.width, region.height, handHeight, identityHeight]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Dock dimensions must be finite and non-negative');
  }
  let profile: 'portrait' | 'short-portrait' | 'desktop' | 'landscape' = 'portrait';
  let horizontalPadding = viewport.width <= 360 ? 3 : 8;
  let top = 4;
  let bottom = 4;
  let identityRow = dockIdentityRow(viewport, identityHeight);
  let sideColumn = 0;
  let columnGap = 0;
  if (viewport.width >= 1024 && viewport.height >= 640) {
    profile = 'desktop';
    horizontalPadding = 10; top = 14; bottom = 8;
    identityRow = 0; sideColumn = 170; columnGap = 12;
  } else if (viewport.width > viewport.height && viewport.height <= 520) {
    profile = 'landscape';
    horizontalPadding = 4; top = 0; bottom = 4;
    identityRow = 0; sideColumn = 92; columnGap = 4;
  } else if (viewport.width <= 599 && viewport.height <= 620 && viewport.height >= viewport.width) {
    profile = 'short-portrait';
    horizontalPadding = 3;
  }
  const x = horizontalPadding + sideColumn + columnGap;
  const y = top + identityRow;
  const width = Math.max(0, region.width - horizontalPadding * 2 - (sideColumn + columnGap) * 2);
  const height = Math.max(0, region.height - top - bottom - identityRow);
  const handArea = { x, y, width, height };
  // Match native align-items:center even when the intrinsic hand is taller
  // than its reservation. Clamping here would move the existing card fan.
  return { profile, handArea, hand: { x, y: y + (height - handHeight) / 2, width, height: handHeight }, countdown:{x:region.width-48,y:-18,width:36,height:36},identity:{x:horizontalPadding,y:top,width:sideColumn,height:Math.max(0,region.height-top-bottom)},tools:{x:region.width-horizontalPadding-sideColumn,y:top,width:sideColumn,height:Math.max(0,region.height-top-bottom)},minimumHeight:top+bottom+identityRow+Math.max(handHeight,sideColumn?identityHeight:0) };
}

/** Existing public numeric output remains byte-for-byte unchanged. */
export function calculateDockLayout(input:DockLayoutInput){const {profile,handArea,hand,countdown}=calculateDockAllocation(input);return {profile,handArea,hand,countdown};}
/** Internal compositor bridge: the same owner exposes its actual side columns
 * and minimum footprint, instead of copying desktop/landscape constants. */
export function calculateDockRegions(input:DockLayoutInput){return calculateDockAllocation(input);}

