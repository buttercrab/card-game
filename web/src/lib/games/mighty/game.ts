// Mighty, as the registry (games/registry.ts) gives it to the room page
// and the app: its table, its rules' sheet and name, its pages.
import type { GameEntry } from '../registry';
import { isPreset, presetTitle } from './catalog';
import { ruleRefusal } from './refusals';
import { differences } from './ruleFields';
import Rulebook from './Rulebook.svelte';
import Table from './Table.svelte';
import TableRules from './TableRules.svelte';
import type { Mighty, RoomView } from './types';

/** The rules' name at the table: the preset, and how many rules the table
 * changed from it, against the preset as the table pinned it, not as the
 * preset reads today. */
export function rulesName(room: RoomView): string {
  const changed =
    room.customized && room.settings.preset_rules ? differences(room.rules, room.settings.preset_rules).length : 0;
  return `${presetTitle(room.settings.preset)} 규칙${changed ? ` · 바꾼 것 ${changed}개` : room.customized ? ' · 바꾼 규칙' : ''}`;
}

export const mighty: GameEntry<Mighty> = {
  id: 'mighty',
  name: '마이티',
  Table,
  RulesSheet: TableRules,
  rulesName,
  refusal: ruleRefusal,
  presetTitle: (id) => (isPreset(id) ? presetTitle(id) : null),
  RulebookPage: Rulebook,
  tools: {
    '/deck': () => import('./DeckPreview.svelte'),
    '/preview': () => import('./TablePreview.svelte'),
    '/share': () => import('./SharePreview.svelte'),
  },
};
