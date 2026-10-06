<script lang="ts">
  // The table's rules over the room page: to read (규칙 보기), or to
  // change between hands (규칙 바꾸기), from the room's preset, its own
  // rules and the preset's rules as the table pinned them.
  import type { RulesSheetProps } from '../../room/game';
  import { isPreset } from './catalog';
  import RuleEditor from './RuleEditor.svelte';
  import RulebookSheet from './RulebookSheet.svelte';
  import type { Mighty } from './types';

  let { room, client, edit, onclose }: RulesSheetProps<Mighty> = $props();
  const settings = $derived(room.settings);
</script>

{#if edit}
  <RuleEditor
    preset={settings.preset}
    rules={settings.rules ?? null}
    base={settings.preset_rules ?? null}
    onsave={(base, rules) => {
      if (!isPreset(base)) return;
      // On the same preset, the table keeps the preset's rules it pinned.
      const pinned = base === settings.preset ? settings.preset_rules : undefined;
      client.setSettings({ preset: base, ...(rules ? { rules } : {}), ...(pinned ? { preset_rules: pinned } : {}) });
    }}
    {onclose}
  />
{:else}
  <RulebookSheet preset={settings.preset} rules={settings.rules ?? null} base={settings.preset_rules ?? null} {onclose} />
{/if}
