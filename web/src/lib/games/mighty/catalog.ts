// Mighty's own catalog (crates/mighty/src/table.rs, `Table::catalog`),
// generated into the build as generated/mighty/catalog.ts: the presets with
// their rules. Mighty's values are read only through here; the site-wide
// ones through lib/catalog.ts.
import { CATALOG as GENERATED } from '../../generated/mighty/catalog';
import type { MightyCatalog, Preset, PresetInfo, Rules } from './types';

export type { MightyCatalog };

export const MIGHTY: MightyCatalog = GENERATED;

/** The presets in the order players pick them. */
export const PRESETS: PresetInfo[] = MIGHTY.presets;

export function isPreset(id: string): id is Preset {
  return PRESETS.some((p) => p.id === id);
}

/** A preset's short name, or the id itself for one this build does not know. */
export function presetTitle(id: string): string {
  return PRESETS.find((p) => p.id === id)?.title ?? id;
}

/** Every preset's rules, by id; not to be changed (see presetRules). */
export const PRESET_RULES: Record<string, Rules> = Object.fromEntries(PRESETS.map((p) => [p.id, p.rules]));

/** A preset's rules, as a copy the caller may change. */
export function presetRules(id: Preset): Rules {
  const info = PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === MIGHTY.default_preset)!;
  return structuredClone(info.rules);
}
