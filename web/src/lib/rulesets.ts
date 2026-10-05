// Where rule sets come from: the server's presets (fetched once and kept),
// and the custom sets a group saved on this device.
import { PRESETS } from './presets';
import { same } from './ruleFields';
import type { Rules } from './types';

const cache = new Map<string, Promise<Rules>>();

/** A preset's full rules; the same promise for every caller. */
export function presetRules(id: string): Promise<Rules> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/presets/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** What a table plays by: its own rules, or its preset's as the table
 * pinned them (which may differ from the preset's today); null from a
 * server too old to say. */
export function tableRules(settings: { rules?: Rules; preset_rules?: Rules }): Rules | null {
  return settings.rules ?? settings.preset_rules ?? null;
}

/** Every preset's rules, by id. */
export async function allPresetRules(): Promise<Record<string, Rules>> {
  const entries = await Promise.all(PRESETS.map(async (p) => [p.id, await presetRules(p.id)] as const));
  return Object.fromEntries(entries);
}

/** Rules a group made from a preset and kept on this device. */
export interface CustomSet {
  id: string;
  /** The group's own name for it; empty means 우리 규칙. */
  name: string;
  base: string;
  rules: Rules;
}

const CUSTOM_KEY = 'mighty.rules.custom';
const CUSTOM_MAX = 5;

export function customName(set: CustomSet): string {
  return set.name.trim() || '우리 규칙';
}

/** Saved sets, the last used first. */
export function loadCustom(): CustomSet[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s) => s && typeof s.base === 'string' && s.rules) : [];
  } catch {
    return [];
  }
}

function store(list: CustomSet[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, CUSTOM_MAX)));
  } catch {
    // Without storage the set lasts as long as the page.
  }
}

/** Saves `set` as the last used. A set with the same name, or the same rules
 * and no name, is replaced rather than kept twice. */
export function saveCustom(set: Omit<CustomSet, 'id'> & { id?: string }): CustomSet {
  const list = loadCustom();
  const sameRules = (s: CustomSet) => same(s.rules, set.rules) && s.base === set.base;
  const old = list.find(
    (s) => s.id === set.id || (set.name.trim() ? s.name.trim() === set.name.trim() : !s.name.trim() && sameRules(s)),
  );
  const saved: CustomSet = { ...set, id: old?.id ?? set.id ?? crypto.randomUUID?.() ?? String(Date.now()) };
  store([saved, ...list.filter((s) => s.id !== saved.id)]);
  return saved;
}

export function removeCustom(id: string) {
  store(loadCustom().filter((s) => s.id !== id));
}

// A table made from home with custom rules starts on the preset; the rules
// are set once its maker sits down, since only seated players may.
const PENDING_KEY = 'mighty.rules.pending';

export function setPending(room: string, base: string, rules: Rules) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ room, base, rules }));
  } catch {
    // The table just keeps its preset.
  }
}

export function takePending(room: string): { base: string; rules: Rules } | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    if (!p || p.room !== room) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return { base: p.base, rules: p.rules };
  } catch {
    return null;
  }
}
