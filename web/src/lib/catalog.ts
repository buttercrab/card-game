// What the server knows before any table opens (crates/server/src/catalog.rs),
// generated into the build: the presets with their rules, and the table's
// other choices.
import { CATALOG } from './generated/catalog';
import type { Preset, PresetInfo, Rules } from './types';

export { CATALOG };

/** The presets in the order players pick them. */
export const PRESETS: PresetInfo[] = CATALOG.presets;

export function isPreset(id: string): id is Preset {
  return PRESETS.some((p) => p.id === id);
}

/** A preset's short name, or the id itself for one this build does not know. */
export function presetTitle(id: string): string {
  return PRESETS.find((p) => p.id === id)?.title ?? id;
}

/** A preset's rules, as a copy the caller may change. */
export function presetRules(id: Preset): Rules {
  const info = PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === CATALOG.default_preset)!;
  return structuredClone(info.rules);
}
