<script lang="ts">
  import CompareSheet from './CompareSheet.svelte';
  import { PRESET_NAME } from './presets';
  import Rulebook from './Rulebook.svelte';
  import RuleDiff from './RuleDiff.svelte';
  import { differences, otherDifferences } from './ruleFields';
  import { loadCustom, presetRules } from './rulesets';
  import type { Rules } from './types';

  let {
    preset,
    rules = null,
    title,
    onclose,
  }: {
    preset: string;
    /** The table's own rules, when its players changed the preset's. */
    rules?: Rules | null;
    /** What to call the changed set; 이 테이블 by default. */
    title?: string;
    onclose: () => void;
  } = $props();

  let base = $state<Rules | null>(null);
  $effect(() => {
    presetRules(preset)
      .then((r) => (base = r))
      .catch(() => (base = null));
  });
  const name = $derived(PRESET_NAME[preset] ?? preset);
  const custom = $derived(rules && base && (differences(rules, base).length || otherDifferences(rules, base)) ? rules : null);
  let comparing = $state(false);

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog class="sheet rulebook" bind:this={dialog} onclose={onclose} aria-label="규칙">
  <div class="sheet-body">
    {#if custom && base}
      <!-- What this table changed comes first, so a friend who knows the
           preset reads only what is new to them. -->
      <section class="changes" aria-labelledby="changes-title">
        <h2 id="changes-title">{name} 규칙에서 바꾼 것</h2>
        <RuleDiff a={base} b={custom} aName={name} bName={title ?? '이 테이블'} />
      </section>
    {/if}
    <Rulebook {preset} rules={rules ?? null} />
  </div>
  <form method="dialog" class="sheet-foot">
    <button type="button" class="ghost" onclick={() => (comparing = true)} disabled={!base}>다른 규칙과 비교</button>
    <button>닫기</button>
  </form>
</dialog>

{#if comparing}
  <CompareSheet
    name={custom ? (title ?? '이 테이블') : name}
    rules={rules ?? null}
    {preset}
    against={custom ? preset : preset === 'default' ? 'gshs' : 'default'}
    customs={loadCustom()}
    onclose={() => (comparing = false)}
  />
{/if}

<style>
  .rulebook {
    width: min(100% - 32px, 560px);
    max-height: min(100dvh - 32px, 860px);
  }
  .changes {
    display: grid;
    gap: 10px;
    margin-bottom: 24px;
    padding: 14px 16px;
    border-radius: 12px;
    box-shadow: inset 0 0 0 1.5px var(--ink);
  }
  .changes h2 {
    margin: 0;
    font-size: 17px;
  }
  /* The diff's sticky header sits inside this box, not at the sheet's top. */
  .changes :global(.head) {
    position: static;
    background: transparent;
  }
</style>
