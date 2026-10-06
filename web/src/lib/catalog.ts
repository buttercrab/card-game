// What the server knows before any table opens (crates/server/src/catalog.rs),
// generated into the build: the table's choices, and Mighty's own catalog
// (its presets with their rules).
import { CATALOG as SITE } from './generated/catalog';
import { CATALOG as MIGHTY } from './generated/mighty/catalog';
import type { BotLevel, Preset, PresetInfo, Rules } from './types';

export const CATALOG = { ...SITE, ...MIGHTY };

/** The presets in the order players pick them. */
export const PRESETS: PresetInfo[] = CATALOG.presets;

export function isPreset(id: string): id is Preset {
  return PRESETS.some((p) => p.id === id);
}

/** A preset's short name, or the id itself for one this build does not know. */
export function presetTitle(id: string): string {
  return PRESETS.find((p) => p.id === id)?.title ?? id;
}

/** Every preset's rules, by id; not to be changed (see presetRules). */
export const PRESET_RULES: Record<string, Rules> = Object.fromEntries(PRESETS.map((p) => [p.id, p.rules]));

/** A bot level's name at the table. */
export const LEVEL_LABEL = Object.fromEntries(CATALOG.bot_levels.map((l) => [l.id, l.label])) as Record<BotLevel, string>;

/** A preset's rules, as a copy the caller may change. */
export function presetRules(id: Preset): Rules {
  const info = PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === CATALOG.default_preset)!;
  return structuredClone(info.rules);
}
