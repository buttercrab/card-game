// The custom sets a group saved on this device; the presets come with the
// build (catalog.ts).
import { same } from './ruleFields';
import type { Rules } from './types';

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
