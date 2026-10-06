<script lang="ts">
  import CompareSheet from './CompareSheet.svelte';
  import Rulebook from './Rulebook.svelte';
  import RuleDiff from './RuleDiff.svelte';
  import { differences, otherDifferences } from './ruleFields';
  import { isPreset, presetRules, presetTitle } from '../../catalog';
  import { loadCustom } from './rulesets';
  import type { Rules } from './types';
  import Button from '../../ui/Button.svelte';
  import Sheet from '../../ui/Sheet.svelte';

  let {
    preset,
    rules = null,
    base: pinned = null,
    title,
    onclose,
  }: {
    preset: string;
    /** The table's own rules, when its players changed the preset's. */
    rules?: Rules | null;
    /** The preset's rules as the table pinned them (the room's
     * `preset_rules`); null for the preset's today. */
    base?: Rules | null;
    /** What to call the changed set; 이 테이블 by default. */
    title?: string;
    onclose: () => void;
  } = $props();

  const base = $derived(pinned ?? (isPreset(preset) ? presetRules(preset) : null));
  /** What the table plays by: its own rules, or its pinned preset's. */
  const effective = $derived(rules ?? pinned ?? (isPreset(preset) ? presetRules(preset) : null));
  const name = $derived(presetTitle(preset));
  const custom = $derived(rules && base && (differences(rules, base).length || otherDifferences(rules, base)) ? rules : null);
  let comparing = $state(false);

</script>

<Sheet label="규칙" size="large" {onclose}>
  {#if custom && base}
    <!-- What this table changed comes first, so a friend who knows the
         preset reads only what is new to them. -->
    <section class="changes" aria-labelledby="changes-title">
      <h2 id="changes-title">{name} 규칙에서 바꾼 것</h2>
      <RuleDiff a={base} b={custom} aName={name} bName={title ?? '이 테이블'} sticky={false} />
    </section>
  {/if}
  <Rulebook {preset} rules={effective} changed={rules !== null} />
  {#snippet footer(close)}
    <Button variant="ghost" onclick={() => (comparing = true)} disabled={!base}>다른 규칙과 비교</Button>
    <Button onclick={close}>닫기</Button>
  {/snippet}
</Sheet>

{#if comparing}
  <CompareSheet
    name={custom ? (title ?? '이 테이블') : name}
    rules={effective}
    {preset}
    against={custom ? preset : preset === 'default' ? 'gshs' : 'default'}
    customs={loadCustom()}
    onclose={() => (comparing = false)}
  />
{/if}

<style>
  .changes {
    display: grid;
    gap: 10px;
    margin-bottom: 24px;
    padding: 14px 16px;
    border-radius: var(--r-control);
    box-shadow: inset 0 0 0 1.5px var(--ink);
  }
  .changes h2 {
    margin: 0;
    font-size: var(--text-title);
  }
</style>
