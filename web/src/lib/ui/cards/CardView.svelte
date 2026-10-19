<script lang="ts">
  // Read-only normalized artwork. ActionPanel or a game card control owns
  // availability and refusal behavior; enabled does not dim public table cards.
  import type { CardSpec } from '../../table/presentation';
  import { toStandardCard } from '../../table/cardVisual';
  import PlayingCard from './PlayingCard.svelte';

  let { card, width = 84 }: { card: CardSpec; width?: number } = $props();
  const standard = $derived(toStandardCard(card));
</script>

{#if card.face === 'down' || standard}
  <!-- Visibility changes keep the same primitive; hidden props stay redacted. -->
  <PlayingCard card={card.face === 'down' ? null : standard} {width} id={card.id}
    labelOverride={card.face === 'down' ? undefined : card.label}
    picked={card.face === 'down' ? false : card.selected}
    emphasis={card.face === 'down' ? null : card.emphasis}
    twoJokers={card.face === 'down' ? true : card.twoJokers}
    tilt={card.face === 'down' ? 0 : card.rotation} />
{:else}
  <!-- Unsupported artwork stays explicit instead of inventing a card face. -->
  <span role="img" aria-label={card.label}>{card.label}</span>
{/if}
