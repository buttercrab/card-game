<script lang="ts">
  // The action strip: one fixed slot between the felt and the hand, whose
  // content follows the phase. It has no panel of its own and nothing in
  // it takes room: controls (bids, the exchange, a joker's choices) rise
  // from it over the felt's foot, on the table's own paper so the seats
  // behind never show through; the turn sits on the tray's rim as a pill.
  import type { Snippet } from 'svelte';
  import Icon from '../../../Icon.svelte';
  import SuitText from '../../../SuitText.svelte';

  let {
    controls,
    refusal = null,
    pill = null,
    waiting = null,
    misdeal = false,
    folded = false,
    onmisdeal,
    onunfold,
    controlsHeight = $bindable(0),
  }: {
    /** Bids, the exchange or a joker's choices, risen over the felt. */
    controls?: Snippet;
    /** Why the card just tapped cannot be played. */
    refusal?: string | null;
    /** Your turn to play: what a tap does now. */
    pill?: string | null;
    /** Whose turn it is, in parts, so a long name gives way. */
    waiting?: { pre: string; name: string; post: string } | null;
    /** 딜미스 is open outside your turn. */
    misdeal?: boolean;
    /** The result is folded away: a tab brings it back. */
    folded?: boolean;
    onmisdeal?: () => void;
    onunfold?: () => void;
    controlsHeight?: number;
  } = $props();
</script>

{#snippet caption()}
  {#if waiting}<p class="prompt caption">{waiting.pre}<span class="who">{waiting.name}</span>{waiting.post}…</p>{/if}
{/snippet}

<div class="strip">
  {#if controls}
    <div class="controls" bind:clientHeight={controlsHeight}>{@render controls()}</div>
  {:else if refusal}
    <p class="prompt pill refusal" role="alert"><SuitText text={refusal} /></p>
  {:else if pill}
    <p class="prompt pill"><strong>내 차례</strong> · {pill}</p>
  {:else if misdeal}
    <!-- Optional, so secondary: plum stays for your turn. -->
    <div class="aside-act">
      {@render caption()}
      <button class="btn" onclick={onmisdeal} title="패가 약하면 차례가 아니어도 다시 나눌 수 있어요">딜미스</button>
    </div>
  {:else if folded}
    <!-- The folded result waits on the tray's rim, like a sheet's tab. -->
    <button class="prompt pill unfold" onclick={onunfold}><Icon name="result" size="18px" />결과 다시 보기</button>
  {:else}
    {@render caption()}
  {/if}
</div>

<style>
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
  .refusal {
    font-weight: 700;
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
    justify-content: center;
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
  .unfold {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 6px 16px;
    font-weight: 600;
  }
  .unfold:active {
    transform: translate(-50%, calc(50% + 2px)) scale(0.97);
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
      align-self: center;
      white-space: normal;
    }
  }
</style>
