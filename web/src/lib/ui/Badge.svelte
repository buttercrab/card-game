<script lang="ts" module>
  export type Team = 'declarer' | 'friend' | 'defense';
  export const TEAM_LABEL: Record<Team, string> = { declarer: '주공', friend: '프렌드', defense: '야당' };
</script>

<script lang="ts">
  // A small pill of label text (lib/ui is the table's vocabulary):
  // - team: 주공 and 프렌드 on the declarer's orange, 야당 on the defence's
  //   blue; `secret` is the 프렌드 only you know about, outlined in orange
  //   until the called card is played. The word is always there; the
  //   colour is the second cue.
  // - count: a number won (2점, a running total), quiet and tabular.
  // - outline: a quiet note pinned on a seat (자리 비움).
  // - tag: news about the hand (공약 확정, 런 찬스), outlined in its tone.
  import type { Snippet } from 'svelte';

  let {
    team,
    secret = false,
    kind = team || secret ? 'team' : 'count',
    tone = 'plain',
    size = 'md',
    ringed = false,
    negative = false,
    class: className = '',
    title,
    label,
    children,
  }: {
    team?: Team | null;
    secret?: boolean;
    kind?: 'team' | 'count' | 'outline' | 'tag';
    /** A tag's tone. */
    tone?: 'plain' | 'accent' | 'danger' | 'gold';
    size?: 'md' | 'sm';
    /** A ring of table colour, apart from a robe of the same colour behind. */
    ringed?: boolean;
    /** A count below zero: in red. */
    negative?: boolean;
    class?: string;
    title?: string;
    label?: string;
    children?: Snippet;
  } = $props();

  const side = $derived(team === 'defense' ? 'defense' : team ? 'declarer' : secret ? 'secret' : null);
</script>

<span
  class={[kind, side, kind === 'tag' && tone, size === 'sm' && 'sm', ringed && 'ringed', negative && 'neg', className]}
  {title}
  aria-label={label}
>
  {#if children}{@render children()}{:else if team}{TEAM_LABEL[team]}{:else if secret}프렌드{/if}
</span>

<style>
  span {
    display: inline-block;
    flex: none;
    padding: 1px 8px;
    border-radius: var(--r-pill);
    font-size: var(--text-caption);
    font-weight: 600;
    line-height: 18px;
    white-space: nowrap;
  }
  .sm {
    padding: 0 6px;
    font-size: 11px;
    line-height: 16px;
  }
  .declarer {
    background: var(--team-declarer);
    color: var(--on-team-declarer);
  }
  .defense {
    background: var(--team-defense);
    color: var(--on-team-defense);
  }
  .secret {
    background: var(--table);
    color: var(--ink);
    box-shadow: inset 0 0 0 1.5px var(--team-declarer);
  }
  .ringed {
    box-shadow: 0 0 0 2px var(--table);
  }
  .secret.ringed {
    box-shadow:
      inset 0 0 0 1.5px var(--team-declarer),
      0 0 0 2px var(--table);
  }
  .count {
    padding: 0 6px;
    background: var(--table);
    color: var(--ink);
    font-size: inherit;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 0 0 1px var(--line);
  }
  .neg {
    color: var(--danger);
  }
  .outline {
    padding: 0 6px;
    background: var(--table);
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--ink-muted);
  }
  .tag {
    font-weight: 700;
    border: 1.5px solid var(--ink-muted);
    color: var(--ink-muted);
  }
  .tag.accent {
    border-color: var(--accent);
    color: var(--accent);
  }
  .tag.danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .tag.gold {
    border-color: var(--gold);
    color: var(--gold-text);
  }
</style>
