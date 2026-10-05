<script lang="ts" module>
  /** A preset id, or `custom:<id>` for a set saved on this device. */
  export type RuleChoice = string;
</script>

<script lang="ts">
  // The rule sets a new table can play, one row each: the name, then what
  // sets it apart from 기본, worked out from the rule data (ruleFields.ts).
  import { PRESET_RULES, PRESETS, presetTitle } from './catalog';
  import { traits } from './ruleFields';
  import { customName, type CustomSet } from './rulesets';
  import type { Rules } from './types';

  let {
    selected,
    customs = [],
    onselect,
    label = '규칙',
  }: {
    selected: RuleChoice;
    customs?: CustomSet[];
    onselect: (choice: RuleChoice) => void;
    label?: string;
  } = $props();

  const all = PRESET_RULES;

  const SHOWN = 3;

  function line(r: Rules | undefined, base: Rules | undefined): { shown: string[]; more: number } | null {
    if (!r || !base) return null;
    const t = traits(r, base);
    // One trait past the cut costs no more room than "외 1개".
    const cut = t.length === SHOWN + 1 ? t.length : SHOWN;
    return { shown: t.slice(0, cut), more: t.length - Math.min(cut, t.length) };
  }
</script>

{#snippet row(key: string, name: string, info: { shown: string[]; more: number } | null, empty: string, sub?: string)}
  <button type="button" class="row" role="radio" aria-checked={selected === key} onclick={() => onselect(key)}>
    <span class="dot" aria-hidden="true"></span>
    <span class="text">
      <span class="name">{name}{#if sub}<span class="sub">{sub}</span>{/if}</span>
      <span class="traits">
        {#if !info}
          &nbsp;
        {:else if info.shown.length === 0}
          <span class="muted">{empty}</span>
        {:else}
          {#each info.shown as t, i (t)}{#if i > 0}<span class="sep" aria-hidden="true">{' · '}</span>{/if}<span class="t">{t}</span>{/each}
          {#if info.more}<span class="more">외 {info.more}개</span>{/if}
        {/if}
      </span>
    </span>
  </button>
{/snippet}

<div class="picker" role="radiogroup" aria-label={label}>
  {#each customs as c (c.id)}
    {@render row(
      `custom:${c.id}`,
      customName(c),
      line(c.rules, all[c.base]),
      '바뀐 것 없음',
      `${presetTitle(c.base)} 바탕`,
    )}
  {/each}
  {#each PRESETS as p (p.id)}
    {@render row(p.id, p.title, line(p.rules, all.default), p.id === 'default' ? '다른 규칙과 견주는 기준' : '기본과 같아요')}
  {/each}
</div>

<style>
  /* One list, rows split by hairlines; the chosen row is lifted onto the
     button surface with an ink ring and a filled dot. */
  .picker {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    border-radius: var(--r-control);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .row {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 10px;
    min-height: 48px;
    padding: 8px 12px;
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    box-shadow: none;
    text-align: left;
    font-weight: 400;
    animation: none;
  }
  .row + .row {
    border-top: 1px solid var(--line);
  }
  .row:first-child {
    border-radius: 12px 12px 0 0;
  }
  .row:last-child {
    border-radius: 0 0 12px 12px;
  }
  .row:active:not(:disabled) {
    transform: none;
  }
  .row[aria-checked='true'] {
    position: relative;
    z-index: 1;
    border-radius: 10px;
    border-top-color: transparent;
    background: var(--btn);
    box-shadow: inset 0 0 0 2px var(--ink);
  }
  .row[aria-checked='true'] + .row {
    border-top-color: transparent;
  }
  .row:focus-visible {
    z-index: 2;
    outline-offset: -3px;
  }
  @media (hover: hover) {
    .row:not([aria-checked='true']):hover {
      background: color-mix(in srgb, var(--ink) 4%, transparent);
    }
  }
  .dot {
    flex: none;
    width: 18px;
    height: 18px;
    margin-top: 2px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--ink-muted);
  }
  .row[aria-checked='true'] .dot {
    box-shadow: inset 0 0 0 1.5px var(--ink), inset 0 0 0 5px var(--btn);
    background: var(--ink);
  }
  .text {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .name {
    font-size: var(--text-body);
    font-weight: 700;
    line-height: 1.35;
  }
  .sub {
    margin-left: 6px;
    font-size: var(--text-caption);
    font-weight: 600;
    color: var(--ink-muted);
  }
  .traits {
    font-size: var(--text-label);
    line-height: 1.4;
    color: var(--ink);
    word-break: keep-all;
  }
  .sep,
  .more {
    color: var(--ink-muted);
  }
  .more {
    margin-left: 6px;
    white-space: nowrap;
  }
</style>
