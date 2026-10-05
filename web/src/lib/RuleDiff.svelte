<script lang="ts">
  // Only the rules that differ between two sets, grouped by phase, both
  // values in plain Korean side by side.
  import { GROUPS, differences, otherDifferences, say } from './ruleFields';
  import SuitText from './SuitText.svelte';
  import type { Rules } from './types';

  let {
    a,
    b,
    aName,
    bName,
    sticky = true,
  }: {
    a: Rules;
    b: Rules;
    aName: string;
    bName: string;
    /** The names' header sticks to the top of the sheet as it scrolls. */
    sticky?: boolean;
  } = $props();

  const diff = $derived(differences(a, b));
  const other = $derived(otherDifferences(a, b));
  const groups = $derived(
    GROUPS.map((g) => ({ ...g, fields: diff.filter((f) => f.group === g.id) })).filter((g) => g.fields.length),
  );
</script>

<div class="diff">
  {#if diff.length === 0 && other === 0}
    <p class="same muted">두 규칙이 같아요.</p>
  {:else}
    <div class="head" class:sticky aria-hidden="true">
      <span></span><span class="name">{aName}</span><span class="name">{bName}</span>
    </div>
    {#each groups as g (g.id)}
      <section aria-label={g.label}>
        <h4>{g.label}</h4>
        <dl>
          {#each g.fields as f (f.path)}
            <div class="row">
              <dt>{f.label}</dt>
              <dd><span class="sr">{aName}: </span><SuitText text={say(f, a)} /></dd>
              <dd><span class="sr">{bName}: </span><SuitText text={say(f, b)} /></dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
    {#if other}
      <p class="muted other">그 밖에 이 화면이 아직 설명하지 못하는 규칙 {other}개가 달라요.</p>
    {/if}
  {/if}
</div>

<style>
  .diff {
    container-type: inline-size;
    display: grid;
    gap: 12px;
    font-size: 14px;
  }
  .same,
  .other {
    margin: 0;
  }
  .other {
    font-size: var(--text-label);
  }
  /* Phone: the label on its own line, the two values under it. Wider: one
     line of label, value, value. */
  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: baseline;
    gap: 2px 12px;
  }
  .head > span:first-child,
  .row dt {
    grid-column: 1 / -1;
  }
  .head > span:first-child {
    display: none;
  }
  @container (min-width: 460px) {
    .head,
    .row {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr);
    }
    .head > span:first-child {
      display: block;
    }
    .head > span:first-child,
    .row dt {
      grid-column: auto;
    }
  }
  .head {
    padding: 6px 0;
    border-bottom: 1.5px solid var(--ink);
  }
  .head.sticky {
    position: sticky;
    top: calc(-1 * var(--pad, 20px));
    z-index: 1;
    background: var(--raised);
  }
  .name {
    font-weight: 800;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  section {
    display: grid;
    gap: 2px;
  }
  section + section {
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
  h4 {
    margin: 0 0 2px;
    font-size: var(--text-caption);
    font-weight: 700;
    color: var(--ink-muted);
  }
  dl {
    margin: 0;
    display: grid;
  }
  .row {
    padding: 6px 0;
  }
  .row + .row {
    border-top: 1px solid var(--line);
  }
  dt {
    font-weight: 700;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
    font-weight: 600;
    word-break: keep-all;
  }
</style>
