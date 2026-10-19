<script lang="ts">
  // Phase decisions occupy their own row above the hand (or beside the
  // felt in landscape). The parent reserves controlsHeight in portrait;
  // turn prompts sit on the tray rim. Result folding belongs to ResultSheet.
  import DecisionRegion from '../../../table/DecisionRegion.svelte';
  import type { Snippet } from 'svelte';

  let {
    controls,
    pill = null,
    waiting = null,
    misdeal = false,
    onmisdeal,
    controlsHeight = $bindable(0),
  }: {
    /** Bids, the exchange or a joker's choices. */
    controls?: Snippet;
    /** Your turn to play: what a tap does now. */
    pill?: string | null;
    /** Whose turn it is, in parts, so a long name gives way. */
    waiting?: { pre: string; name: string; post: string } | null;
    /** 딜미스 is open outside your turn. */
    misdeal?: boolean;
    onmisdeal?: () => void;
    controlsHeight?: number;
  } = $props();
</script>

{#snippet caption()}
  {#if waiting}<p class="prompt caption">{waiting.pre}<span class="who">{waiting.name}</span>{waiting.post}…</p>{/if}
{/snippet}

<DecisionRegion class="strip" mode="strip" fillHeight>
  {#if controls}
    <DecisionRegion class="controls" mode="stack" gap={0} inset={8} bind:height={controlsHeight}>{@render controls()}</DecisionRegion>
  {:else if pill}
    <p class="prompt pill"><strong>내 차례</strong> · <span class="instruction">{pill}</span><span class="brief">{pill.includes('두 번') ? '두 번 눌러 내기' : pill.includes('한 번 더') ? '한 번 더 눌러 내기' : '카드 눌러 내기'}</span></p>
  {:else if misdeal}
    <!-- Optional, so secondary: plum stays for your turn. -->
    <DecisionRegion class="aside" mode="actions" gap={10}>
      <button class="btn" onclick={onmisdeal} title="패가 약하면 차례가 아니어도 다시 나눌 수 있어요">딜미스</button>
      {@render caption()}
    </DecisionRegion>
  {:else}
    {@render caption()}
  {/if}
</DecisionRegion>

<style>
  .prompt { margin:0; text-align:center; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pill { --spade-ink:var(--suit-spade); padding:5px 14px; border:1px solid var(--card-edge); border-radius:var(--r-pill); background:var(--card); color:var(--card-ink); box-shadow:var(--lip); }
  .pill strong { color:var(--accent-on-card); }
  .caption { font-size:var(--text-label);color:var(--ink-muted); }
  .who { display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
  .brief { display:none; }
</style>
