<script lang="ts">
  // How one rule set differs from another: pick the other side with a chip,
  // read only the rows that differ.
  import { untrack } from 'svelte';
  import { PRESET_RULES, PRESETS } from '../../catalog';
  import RuleDiff from './RuleDiff.svelte';
  import { customName, type CustomSet } from './rulesets';
  import type { Rules } from './types';
  import Button from '../../ui/Button.svelte';
  import Chip from '../../ui/Chip.svelte';
  import Sheet from '../../ui/Sheet.svelte';

  let {
    name,
    rules,
    preset,
    against = 'default',
    customs = [],
    onclose,
  }: {
    /** The set being looked at. */
    name: string;
    /** Its rules; null to use `preset`'s. */
    rules: Rules | null;
    preset?: string;
    /** What to compare it with first: a preset id or `custom:<id>`. */
    against?: string;
    customs?: CustomSet[];
    onclose: () => void;
  } = $props();

  let other = $state(untrack(() => against));
  const all = PRESET_RULES;

  const choices = $derived([
    ...customs.map((c) => ({ key: `custom:${c.id}`, name: customName(c), rules: c.rules as Rules | undefined })),
    ...PRESETS.map((p) => ({ key: p.id as string, name: p.title, rules: p.rules as Rules | undefined })),
  ]);
  const left = $derived(rules ?? (preset ? all[preset] : undefined));
  const right = $derived(choices.find((c) => c.key === other) ?? choices.find((c) => c.key === 'default'));

</script>

<Sheet title="{name} 규칙 비교" size="large" {onclose}>
  <p class="lead muted">무엇과 견줄까요? 다른 것만 보여요.</p>
  <div class="chips" role="radiogroup" aria-label="견줄 규칙">
    {#each choices as c (c.key)}
      <Chip size="sm" checked={right?.key === c.key} onclick={() => (other = c.key)}>{c.name}</Chip>
    {/each}
  </div>
  {#if left && right?.rules}
    <RuleDiff a={left} b={right.rules} aName={name} bName={right.name} />
  {:else}
    <p class="muted">불러오는 중…</p>
  {/if}
  {#snippet footer(close)}
    <Button onclick={close}>닫기</Button>
  {/snippet}
</Sheet>

<style>
  .lead {
    margin: -8px 0 12px;
    font-size: 14px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 16px;
  }
</style>
