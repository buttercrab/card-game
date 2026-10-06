<script lang="ts">
  // The court figures, jokers and the 마이티, drawn as flat shapes (direction
  // A of the card-face study). Robes and outlines take `currentColor`, so the
  // suit colour, four-colour decks and dark cards all follow; gold and skin
  // are fixed. Each suit dresses its court differently: the crown, the
  // headwear and the chest emblem change, the silhouette stays. Each rank
  // also has its own outline and prop, so it reads before the letter does:
  // the king is wide with a sceptre, the queen a bell holding a flower, the
  // jack tall with a halberd; and each glances its own way.
  import { PATHS } from '../../SuitIcon.svelte';
  import type { Suit } from './types';

  let {
    figure,
    suit = 'Spade',
  }: {
    figure: 'K' | 'Q' | 'J' | 'joker' | 'mighty';
    suit?: Suit;
  } = $props();

  const GOLD = 'var(--card-gold)';
  const SKIN = 'var(--skin)';
  const PAPER = 'var(--card)';
</script>

{#snippet emblem(x: number, y: number, size: number)}
  <path d={PATHS[suit]} fill={PAPER} transform="translate({x - size / 2} {y - size / 2}) scale({size / 100})" />
{/snippet}

{#snippet eyes(y: number, dx = 0)}
  <circle cx={53 + dx} cy={y} r="2.3" fill="currentColor" />
  <circle cx={67 + dx} cy={y} r="2.3" fill="currentColor" />
{/snippet}

<svg viewBox="0 0 120 160" class="court-art" aria-hidden="true">
  {#if figure === 'K'}
    <!-- Robe with a gold sash, a beard, and a crown cut to the suit. -->
    <path d="M20 152 L32 96 Q60 84 88 96 L100 152 Z" fill="currentColor" />
    <rect x="34" y="110" width="52" height="5" fill={GOLD} />
    <path d="M90 150 L96 98" stroke={GOLD} stroke-width="4" stroke-linecap="round" />
    <circle cx="96" cy="93" r="5.5" fill={GOLD} />
    {@render emblem(60, 134, 22)}
    <circle cx="60" cy="64" r="20" fill={SKIN} stroke="currentColor" stroke-width="3" />
    <path d="M42 68 Q60 100 78 68 Q60 82 42 68 Z" fill="currentColor" />
    {@render eyes(61, -3)}
    {#if suit === 'Spade'}
      <path d="M38 46 L44 22 L52 36 L60 14 L68 36 L76 22 L82 46 Z" fill={GOLD} />
    {:else if suit === 'Heart'}
      <path d="M38 46 L38 30 Q44 22 49 30 Q54 20 60 20 Q66 20 71 30 Q76 22 82 30 L82 46 Z" fill={GOLD} />
      <circle cx="38" cy="28" r="3.5" fill={GOLD} /><circle cx="60" cy="17" r="3.5" fill={GOLD} /><circle cx="82" cy="28" r="3.5" fill={GOLD} />
    {:else if suit === 'Diamond'}
      <path d="M38 46 L40 28 L50 36 L60 20 L70 36 L80 28 L82 46 Z" fill={GOLD} />
      <path d="M60 28 L65 36 L60 44 L55 36 Z" fill="currentColor" />
    {:else}
      <path d="M38 46 L40 32 L80 32 L82 46 Z" fill={GOLD} />
      <circle cx="44" cy="26" r="5" fill={GOLD} /><circle cx="60" cy="22" r="6" fill={GOLD} /><circle cx="76" cy="26" r="5" fill={GOLD} />
    {/if}
  {:else if figure === 'Q'}
    <!-- Bell gown, hair framing the face, and a tiara cut to the suit. -->
    <path d="M24 154 Q60 70 96 154 Z" fill="currentColor" />
    <path d="M44 118 Q60 112 76 118" stroke={GOLD} stroke-width="3" fill="none" />
    <path d="M46 128 L40 104" stroke={PAPER} stroke-width="2.5" stroke-linecap="round" />
    <g fill={GOLD}>
      <circle cx="40" cy="94" r="4" /><circle cx="46" cy="98" r="4" /><circle cx="44" cy="105" r="4" />
      <circle cx="36" cy="105" r="4" /><circle cx="34" cy="98" r="4" />
    </g>
    <circle cx="40" cy="100" r="3" fill={PAPER} />
    {@render emblem(60, 138, 22)}
    <circle cx="60" cy="64" r="19" fill={SKIN} stroke="currentColor" stroke-width="3" />
    {#if suit === 'Club'}
      <path d="M36 92 Q30 40 60 38 Q90 40 84 92 Q80 64 76 56 Q60 48 44 56 Q40 64 36 92 Z" fill="currentColor" />
    {:else if suit === 'Diamond'}
      <circle cx="60" cy="36" r="10" fill="currentColor" />
      <path d="M38 72 Q36 40 60 42 Q84 40 82 72 Q78 56 60 52 Q42 56 38 72 Z" fill="currentColor" />
    {:else}
      <path d="M38 72 Q36 38 60 40 Q84 38 82 72 Q78 56 60 52 Q42 56 38 72 Z" fill="currentColor" />
    {/if}
    {@render eyes(66)}
    {#if suit === 'Spade'}
      <path d="M46 38 L50 26 L55 34 L60 22 L65 34 L70 26 L74 38 Z" fill={GOLD} />
    {:else if suit === 'Heart'}
      <circle cx="60" cy="30" r="6" fill={GOLD} /><circle cx="47" cy="35" r="4" fill={GOLD} /><circle cx="73" cy="35" r="4" fill={GOLD} />
    {:else if suit === 'Diamond'}
      <path d="M60 18 L66 26 L60 34 L54 26 Z" fill={GOLD} />
    {:else}
      <path d="M40 42 Q60 26 80 42" stroke={GOLD} stroke-width="4" fill="none" stroke-linecap="round" />
      <circle cx="46" cy="36" r="3" fill={GOLD} /><circle cx="60" cy="32" r="3" fill={GOLD} /><circle cx="74" cy="36" r="3" fill={GOLD} />
    {/if}
  {:else if figure === 'J'}
    <!-- Tunic with a zigzag collar, and a hat cut to the suit. -->
    <path d="M22 154 L22 36" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    <path d="M22 34 L12 44 L22 56 Z" fill={GOLD} />
    <rect x="36" y="96" width="48" height="58" rx="6" fill="currentColor" />
    <path d="M38 98 L46 106 L53 98 L60 106 L67 98 L74 106 L82 98" stroke={GOLD} stroke-width="3" fill="none" />
    {@render emblem(60, 132, 22)}
    <circle cx="60" cy="70" r="18" fill={SKIN} stroke="currentColor" stroke-width="3" />
    {@render eyes(70, 3)}
    {#if suit === 'Spade'}
      <path d="M38 58 Q60 30 84 54 L40 60 Z" fill="currentColor" />
      <path d="M78 52 Q100 32 96 14 Q86 34 74 46 Z" fill={GOLD} />
    {:else if suit === 'Heart'}
      <ellipse cx="60" cy="54" rx="26" ry="9" fill="currentColor" />
      <circle cx="80" cy="44" r="7" fill={GOLD} />
    {:else if suit === 'Diamond'}
      <rect x="44" y="26" width="32" height="28" rx="3" fill="currentColor" />
      <rect x="38" y="52" width="44" height="6" rx="3" fill="currentColor" />
      <rect x="44" y="44" width="32" height="5" fill={GOLD} />
    {:else}
      <path d="M40 58 Q44 36 60 36 Q76 36 80 58 Z" fill="currentColor" />
      <path d="M66 38 Q82 22 92 26 Q80 30 72 42 Z" fill={GOLD} />
    {/if}
  {:else if figure === 'joker'}
    <!-- A jester: three-pointed hat with bells, a grin, a diamond-patterned collar. -->
    <path d="M32 152 L42 100 Q60 92 78 100 L88 152 Z" fill="currentColor" />
    <path d="M42 108 L50 116 L58 108 L66 116 L74 108" stroke={PAPER} stroke-width="3" fill="none" />
    <circle cx="60" cy="72" r="20" fill={SKIN} stroke="currentColor" stroke-width="3" />
    <path d="M38 58 Q34 26 16 28 Q34 36 40 60 Z M82 58 Q86 26 104 28 Q86 36 80 60 Z M48 52 Q60 10 72 52 Z" fill="currentColor" />
    <circle cx="16" cy="28" r="5" fill={GOLD} /><circle cx="104" cy="28" r="5" fill={GOLD} /><circle cx="60" cy="14" r="5" fill={GOLD} />
    <path d="M50 80 Q60 90 70 80" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" />
    {@render eyes(70)}
  {:else}
    <!-- The 마이티: its suit inside a gold ring of rays, crowned. The king
         of all the cards, with no stamp needed to say so. -->
    <g stroke={GOLD} stroke-width="3" stroke-linecap="round">
      {#each [2, 3, 4, 5, 6, 7, 8, 9, 10] as i (i)}
        <path d="M60 30 L60 38" transform="rotate({i * 30} 60 82)" />
      {/each}
    </g>
    <circle cx="60" cy="82" r="40" fill="none" stroke={GOLD} stroke-width="2.5" />
    <path d={PATHS[suit]} fill="currentColor" transform="translate(34 56) scale(0.52)" />
    <path d="M44 40 L47 24 L54 33 L60 18 L66 33 L73 24 L76 40 Z" fill={GOLD} />
  {/if}
</svg>

<style>
  .court-art {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
