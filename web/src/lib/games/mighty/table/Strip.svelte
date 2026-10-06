<script lang="ts">
  // Phase decisions occupy their own row above the hand (or beside the
  // felt in landscape). The parent reserves controlsHeight in portrait;
  // turn prompts sit on the tray rim. Result folding belongs to ResultSheet.
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

<div class="strip">
  {#if controls}
    <div class="controls" bind:clientHeight={controlsHeight}>{@render controls()}</div>
  {:else if pill}
    <p class="prompt pill"><strong>내 차례</strong> · <span class="instruction">{pill}</span><span class="brief">{pill.includes('두 번') ? '두 번 눌러 내기' : pill.includes('한 번 더') ? '한 번 더 눌러 내기' : '카드 눌러 내기'}</span></p>
  {:else if misdeal}
    <!-- Optional, so secondary: plum stays for your turn. -->
    <div class="aside-act">
      <button class="btn" onclick={onmisdeal} title="패가 약하면 차례가 아니어도 다시 나눌 수 있어요">딜미스</button>
      {@render caption()}
    </div>
  {:else}
    {@render caption()}
  {/if}
</div>

<style>
  .brief { display: none; }
  .strip {
    position: relative;
    z-index: var(--z-controls);
    height: 100%;
    min-width: 0;
  }
  .controls {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 6px 0 4px;
    background: var(--table);
  }
  /* Half over the tray's top edge, like a label on its rim. */
  .prompt {
    position: absolute;
    left: 50%;
    bottom: 0;
    max-width: calc(100% - 16px);
    margin: 0;
    transform: translate(-50%, 50%);
    text-align: center;
    font-size: 14px;
    white-space: nowrap;
  }
  /* Card paper on the rim, with a hairline and the hard lip. */
  .pill {
    --spade-ink: var(--suit-spade);
    padding: 5px 14px;
    border: 1px solid var(--card-edge);
    border-radius: var(--r-pill);
    background: var(--card);
    color: var(--card-ink);
    box-shadow: var(--lip);
  }
  /* On card paper, the light theme's plum keeps its contrast. */
  .pill strong {
    color: var(--accent-on-card);
  }
  /* Someone else's turn is news, not a button: a plain caption. */
  .caption {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  /* A long name gives way, never the words after it. */
  .who {
    display: inline-block;
    max-width: 7em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  /* 딜미스 outside your turn: whose turn it is, and a secondary button. */
  .aside-act {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: start;
    gap: 10px;
    padding: 0 8px 8px;
  }
  .aside-act .prompt {
    position: static;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    transform: none;
  }
  .aside-act .btn {
    flex: none;
    min-width: 88px;
  }
  /* Phones on their side: the strip has room of its own beside the felt,
     so nothing lies over anything. */
  @media (orientation: landscape) and (max-height: 520px) {
    .strip {
      height: auto;
      overflow-y: auto;
    }
    .controls,
    .aside-act,
    .prompt {
      position: static;
      transform: none;
    }
    .prompt {
      align-self: center; font-size: 12px; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .pill { padding: 2px 6px; font-size: 11px; line-height: 12px; }
    .instruction { display: none; }
    .brief { display: inline; }
  }
</style>
