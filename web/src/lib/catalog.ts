// What the server knows before any table opens (crates/server/src/catalog.rs),
// generated into the build: the site's own part, the same for every game
// (the games, bot levels, turn limits, reactions and limits). Site-wide
// values are read only through here, and each game's own catalog (Mighty's
// presets and rules) only through its wrapper (games/mighty/catalog.ts).
import { CATALOG as GENERATED } from './generated/catalog';
import type { BotLevel, Catalog } from './generated/protocol';

/** The site-wide part of the catalog. */
export type SiteCatalog = Catalog;

export const CATALOG: SiteCatalog = GENERATED;

/** A bot level's name at the table. */
export const LEVEL_LABEL = Object.fromEntries(CATALOG.bot_levels.map((l) => [l.id, l.label])) as Record<BotLevel, string>;
