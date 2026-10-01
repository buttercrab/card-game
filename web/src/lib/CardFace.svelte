<script lang="ts">
  import { isRed, rankLabel, SUIT_SYMBOL, cardLabel } from './cards';
  import type { Card } from './types';

  let {
    card,
    small = false,
    dim = false,
    selected = false,
    powerless = false,
    onclick,
  }: {
    card: Card;
    small?: boolean;
    dim?: boolean;
    selected?: boolean;
    powerless?: boolean;
    onclick?: () => void;
  } = $props();

  const red = $derived(isRed(card));
  const joker = $derived('Joker' in card);
  const corner = $derived('Normal' in card ? `${rankLabel(card.Normal[1])}` : '');
  const suit = $derived('Normal' in card ? SUIT_SYMBOL[card.Normal[0]] : '★');
</script>

{#snippet face()}
  {#if joker}
    <span class="joker-word">JOKER</span>
    <span class="pip">★</span>
  {:else}
    <span class="corner">{corner}<br />{suit}</span>
    <span class="pip">{suit}</span>
  {/if}
{/snippet}

{#if onclick}
  <button
    class="card"
    class:small
    class:red
    class:dim
    class:selected
    class:powerless
    aria-label={cardLabel(card)}
    aria-pressed={selected}
    disabled={dim}
    {onclick}
  >
    {@render face()}
  </button>
{:else}
  <div class="card" class:small class:red class:dim class:powerless role="img" aria-label={cardLabel(card)}>
    {@render face()}
  </div>
{/if}

<style>
  .card {
    position: relative;
    width: 58px;
    height: 82px;
    min-height: 0;
    padding: 0;
    flex: none;
    border-radius: 7px;
    border: 1px solid var(--card-border);
    background: var(--card-face);
    color: var(--card-ink);
    box-shadow: var(--shadow);
    font-family: Georgia, 'Times New Roman', serif;
    transition:
      transform 120ms ease,
      box-shadow 120ms ease;
  }

  .card.small {
    width: 42px;
    height: 60px;
    border-radius: 5px;
  }

  .red {
    color: var(--card-red);
  }

  button.card:hover:not(:disabled) {
    transform: translateY(-6px);
    border-color: var(--card-border);
  }

  button.card:disabled {
    opacity: 1;
    filter: grayscale(0.4) brightness(0.82);
    cursor: default;
  }

  .selected {
    transform: translateY(-12px);
    outline: 3px solid var(--highlight);
    outline-offset: -1px;
  }

  button.card.selected:hover:not(:disabled) {
    transform: translateY(-14px);
  }

  .powerless::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: repeating-linear-gradient(-45deg, transparent 0 6px, rgb(0 0 0 / 0.08) 6px 8px);
  }

  .corner {
    position: absolute;
    top: 4px;
    left: 5px;
    font-size: 15px;
    line-height: 1;
    font-weight: 700;
    text-align: center;
  }

  .small .corner {
    font-size: 12px;
    top: 3px;
    left: 4px;
  }

  .pip {
    position: absolute;
    right: 6px;
    bottom: 4px;
    font-size: 28px;
    line-height: 1;
  }

  .small .pip {
    font-size: 20px;
    right: 4px;
    bottom: 3px;
  }

  .joker-word {
    position: absolute;
    top: 6px;
    left: 4px;
    writing-mode: vertical-rl;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    font-family: var(--font);
  }

  .small .joker-word {
    font-size: 8px;
    top: 4px;
    left: 3px;
  }
</style>
