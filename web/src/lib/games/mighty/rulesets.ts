// The custom sets a group saved on this device; the presets come with the
// build (catalog.ts).
import { MIGHTY } from './catalog';
import { same } from './ruleFields';
import {fillGaps,upgradeRules,decodeMightyCustomCatalog} from './ruleValidation';
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

export {fillGaps,upgradeRules} from './ruleValidation';

/** Saved sets, the last used first. */
export function loadCustom(): CustomSet[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
    return Array.isArray(list)
      ? list
          .filter((s) => s && typeof s.base === 'string' && s.rules)
          .map((s: CustomSet) => ({ ...s, rules: fillGaps(upgradeRules(s.rules), MIGHTY.rule_defaults) }))
      : [];
  } catch {
    return [];
  }
}

function store(list: CustomSet[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, CUSTOM_MAX)));
    return true;
  } catch {
    return false;
  }
}

export type CustomSaveOutcome = {status:'stored';set:CustomSet;raw:string} | {status:'failed'|'conflict'|'unsupported'};
/** Captured by the fixed storage host, never interpreted as a command. */
export function readCustomStorageRaw(): string | null { return localStorage.getItem(CUSTOM_KEY); }

function prepareSave(set: Omit<CustomSet, 'id'> & { id?: string }) {
  const list = loadCustom();
  const sameRules = (s: CustomSet) => same(s.rules, set.rules) && s.base === set.base;
  const old = list.find(
    (s) => s.id === set.id || (set.name.trim() ? s.name.trim() === set.name.trim() : !s.name.trim() && sameRules(s)),
  );
  const saved: CustomSet = { ...set, id: old?.id ?? set.id ?? crypto.randomUUID?.() ?? String(Date.now()) };
  return {saved,list:[saved, ...list.filter((s) => s.id !== saved.id)]};
}

/** Truthful local outcome for an engine-admitted, already validated rules model.
 * Refuse malformed existing catalogs instead of cleansing unrelated saved data.
 * The optional exact snapshot check detects stale catalogs, not a cross-tab CAS.
 */
export function saveCustomWithOutcome(set: Omit<CustomSet, 'id'> & { id?: string }, options: {expectedRaw?:string|null} = {}): CustomSaveOutcome {
  try {
    const raw=readCustomStorageRaw();
    if(Object.hasOwn(options,'expectedRaw')&&raw!==options.expectedRaw)return {status:'conflict'};
    if(raw!==null&&new TextEncoder().encode(raw).length>65536)return {status:'unsupported'};
    try { decodeMightyCustomCatalog(raw); } catch { return {status:'unsupported'}; }
    const {saved,list}=prepareSave(set);
    // A second check also protects against synchronous adapters mutating storage
    // during preparation. localStorage itself offers no multi-tab transaction.
    if(readCustomStorageRaw()!==raw)return {status:'conflict'};
    const written=JSON.stringify(list.slice(0,CUSTOM_MAX));
    localStorage.setItem(CUSTOM_KEY,written);
    return {status:'stored',set:saved,raw:written};
  }catch{return {status:'failed'};}
}

/** Saves `set` as the last used. A set with the same name, or the same rules
 * and no name, is replaced rather than kept twice. */
export function saveCustom(set: Omit<CustomSet, 'id'> & { id?: string }): CustomSet {
  const {saved,list}=prepareSave(set);
  store(list);
  return saved;
}

export function removeCustom(id: string) {
  store(loadCustom().filter((s) => s.id !== id));
}
