// The design tokens (docs/DESIGN.md) for code that cannot read CSS custom
// properties: the share card's canvas, SVG figures, the settings' swatches
// and media queries in script. app.css writes the same values as custom
// properties; tokens.test.ts checks the two never drift apart.

import type { CardBack, TableTone } from './looks';
import type { Suit } from './generated/protocol';

/** A colour for the light theme and one for the dark. */
export interface Pair {
  light: string;
  dark: string;
}

/** The surfaces and inks that change with the theme (app.css `:root`). */
export const THEME = {
  table: { light: '#efebe3', dark: '#17191c' },
  panel: { light: '#e6e1d6', dark: '#202327' },
  line: { light: '#d6cfc1', dark: '#2f343a' },
  ink: { light: '#1c1915', dark: '#ece7dd' },
  'ink-muted': { light: '#645d53', dark: '#9a958b' },
  card: { light: '#fbf8f2', dark: '#ece6da' },
  'card-edge': { light: '#d9d1c2', dark: '#cfc8ba' },
  'card-warm': { light: '#fbf4e6', dark: '#efe6d3' },
  accent: { light: '#8e2f6b', dark: '#d27bb0' },
  'accent-deep': { light: '#6b2251', dark: '#a2558a' },
  'on-accent': { light: '#ffffff', dark: '#17191c' },
  'team-defense': { light: '#3b4a6b', dark: '#8fa3c9' },
  'on-team-defense': { light: '#ffffff', dark: '#17191c' },
  gold: { light: '#a77a12', dark: '#d9b04f' },
  /** Gold words on the table's paper (런 찬스): darker, to read at 4.5:1. */
  'gold-text': { light: '#7d5a09', dark: '#d9b04f' },
  danger: { light: '#b3261e', dark: '#ef6b62' },
} as const satisfies Record<string, Pair>;

/** Colours that stay put in both themes: cards are light paper either way,
 * so what is drawn on them keeps its light-theme ink. */
export const FIXED = {
  'suit-spade': '#1c1915',
  /* Darker than the diamond, so the two reds part by lightness too. */
  'suit-heart': '#a3271f',
  'suit-diamond': '#c2620a',
  'suit-club': '#1d5fb0',
  'team-declarer': '#e69f00',
  /** Ink on the declarer's orange, in both themes. */
  'on-team-declarer': '#1c1915',
  'card-gold': '#a77a12',
  /** Text on card paper (reaction bubbles, the turn pill, hint text). */
  'card-ink': '#1c1915',
  'card-ink-muted': '#645d53',
  /** The light theme's plum, which keeps its contrast on card paper. */
  'accent-on-card': '#8e2f6b',
  /** Faces of the figures, and their eyes. */
  skin: '#f3e3cf',
  'figure-eye': '#2b2620',
} as const satisfies Record<string, string>;

export const SUIT_INK: Record<Suit, string> = {
  Spade: FIXED['suit-spade'],
  Heart: FIXED['suit-heart'],
  Diamond: FIXED['suit-diamond'],
  Club: FIXED['suit-club'],
};

/** The ground of each card back (app.css `[data-back]`). */
export const BACK_COLOR: Record<CardBack, string> = {
  charcoal: '#2a2622',
  plum: '#5a2445',
  indigo: '#22305c',
  gold: '#6a4c10',
  ink: '#0d0d0e',
  jade: '#1e4a3e',
};

/** The table colours earned through 업적 (app.css `[data-table]`). */
export const TABLE_TONE: Record<TableTone, { table: Pair; panel: Pair }> = {
  hanji: { table: THEME.table, panel: THEME.panel },
  celadon: { table: { light: '#e2eae2', dark: '#151b18' }, panel: { light: '#d6dfd7', dark: '#1d2621' } },
  indigo: { table: { light: '#e3e7ef', dark: '#15181f' }, panel: { light: '#d7dce6', dark: '#1d222c' } },
  blush: { table: { light: '#f1e8e4', dark: '#1c1718' }, panel: { light: '#e7dcd7', dark: '#272022' } },
};

/** Screen widths where the layout changes. CSS media queries cannot read
 * custom properties, so stylesheets write these numbers out; keep them in
 * step with this list. */
export const BREAKPOINT = {
  /** Phones are narrower than this; tablets start here. */
  tablet: 600,
  /** Desktops: your seat on the tray, larger cards. */
  desktop: 1024,
  /** Wide desktops in landscape: the side panel replaces the top line. */
  wide: 1100,
} as const;

/** The same breakpoints as media queries, for script. */
export const MEDIA = {
  phone: `(max-width: ${BREAKPOINT.tablet - 1}px)`,
  desktop: `(min-width: ${BREAKPOINT.desktop}px)`,
  /** A phone on its side: too short for the stacked table. */
  short: '(orientation: landscape) and (max-height: 520px)',
} as const;
