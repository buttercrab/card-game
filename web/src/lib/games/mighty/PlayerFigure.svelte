<script lang="ts">
  // A player at the table, drawn like the court cards (direction A): a skin
  // circle head with an ink outline over a bell robe. The robe takes the
  // team colour once the team is known, the 주공 wears a gold crown cut to
  // the trump suit, and bots wear a nightcap. All expression is in the eyes:
  // they blink (one shared timer, see blink.ts), glance toward `lookAt`,
  // drift up and aside while thinking, turn to ^^ after a won trick, sink
  // after a loss, and go to dashes when the player is offline.
  import { blinker } from '../../blink';
  import { motion } from '../../settings.svelte';
  import { FIXED } from '../../tokens';
  import type { Suit } from './types';

  let {
    team = null,
    trumpSuit = null,
    isBot = false,
    thinking = false,
    lookAt = null,
    mood = null,
    offline = false,
    still = false,
  }: {
    team?: 'declarer' | 'friend' | 'defense' | null;
    /** The 주공's crown is cut to this suit; a plain crown without one. */
    trumpSuit?: Suit | null;
    isBot?: boolean;
    thinking?: boolean;
    /** A unit vector, in screen directions, for the eyes to glance along. */
    lookAt?: { x: number; y: number } | null;
    /** 'happy' flashes ^^ eyes; 'down' lowers the eyes while it lasts. */
    mood?: 'happy' | 'down' | null;
    offline?: boolean;
    /** A still figure: no blinking or gaze animation. */
    still?: boolean;
  } = $props();

  const GOLD = FIXED['card-gold'];
  const SKIN = FIXED.skin;
  // Eyes are drawn darker and a little larger than on the cards: the figure
  // is small, and the face must read on a dark table too.
  const EYE = FIXED['figure-eye'];
  const GLANCE = 3.5;

  const moving = $derived(!still && motion.level === 'full');
  const robe = $derived(
    team === 'defense' ? 'var(--team-defense)' : team ? 'var(--team-declarer)' : 'var(--ink-muted)',
  );

  let closed = $state(false);
  $effect(() => {
    if (!moving || offline) return;
    return blinker((c) => (closed = c));
  });

  let joy = $state(false);
  $effect(() => {
    if (mood !== 'happy') return;
    joy = true;
    const t = setTimeout(() => (joy = false), 600);
    return () => {
      clearTimeout(t);
      joy = false;
    };
  });

  const down = $derived(mood === 'down' && !joy);
  const gaze = $derived.by(() => {
    if (down) return { x: 0, y: 2.6 };
    if (thinking) return { x: 2.6, y: -3 };
    if (!lookAt) return { x: 0, y: 0 };
    const len = Math.hypot(lookAt.x, lookAt.y) || 1;
    return { x: (lookAt.x / len) * GLANCE, y: (lookAt.y / len) * GLANCE };
  });
  const lid = $derived(closed ? 0.12 : down ? 0.6 : 1);
</script>

<svg viewBox="0 0 120 110" class="figure" aria-hidden="true">
  <!-- Bell robe, cut off at the bottom: head and shoulders. -->
  <path d="M20 110 Q22 76 60 72 Q98 76 100 110 Z" style:fill={robe} />
  <circle cx="60" cy="48" r="20" fill={SKIN} stroke={EYE} stroke-width="3" />

  {#if team === 'declarer'}
    <g transform="translate(60 31) scale(0.55) translate(-60 -46)">
      {#if trumpSuit === 'Heart'}
        <path d="M38 46 L38 30 Q44 22 49 30 Q54 20 60 20 Q66 20 71 30 Q76 22 82 30 L82 46 Z" fill={GOLD} />
        <circle cx="38" cy="28" r="3.5" fill={GOLD} /><circle cx="60" cy="17" r="3.5" fill={GOLD} /><circle cx="82" cy="28" r="3.5" fill={GOLD} />
      {:else if trumpSuit === 'Diamond'}
        <path d="M38 46 L40 28 L50 36 L60 20 L70 36 L80 28 L82 46 Z" fill={GOLD} />
        <path d="M60 28 L65 36 L60 44 L55 36 Z" fill={EYE} />
      {:else if trumpSuit === 'Club'}
        <path d="M38 46 L40 32 L80 32 L82 46 Z" fill={GOLD} />
        <circle cx="44" cy="26" r="5" fill={GOLD} /><circle cx="60" cy="22" r="6" fill={GOLD} /><circle cx="76" cy="26" r="5" fill={GOLD} />
      {:else}
        <path d="M38 46 L44 22 L52 36 L60 14 L68 36 L76 22 L82 46 Z" fill={GOLD} />
      {/if}
    </g>
  {:else if isBot}
    <!-- A nightcap flopping to one side, with a bobble. -->
    <path d="M39 41 Q40 25 60 25 Q78 25 88 38 Q94 46 97 56 Q86 47 80 41 Z" fill="currentColor" />
    <path d="M40 41 Q60 35 80 41" stroke-width="4" stroke-linecap="round" fill="none" style:stroke={robe} />
    <circle cx="97" cy="57" r="4.5" style:fill={robe} />
  {/if}

  {#if team === 'friend'}
    <!-- A partner clasp; the declarer keeps the crown. No hidden friend is exposed. -->
    <g fill="none" stroke={EYE} stroke-width="3.5" stroke-linecap="round">
      <path d="M53 88 l-4 4 a5 5 0 0 0 7 7 l4-4" />
      <path d="M64 98 l4-4 a5 5 0 0 0-7-7 l-4 4" />
    </g>
  {/if}
  {#if offline}
    <path d="M49 49 H57 M63 49 H71" stroke={EYE} stroke-width="3" stroke-linecap="round" />
  {:else if joy}
    <path d="M49 51 Q53 44.5 57 51 M63 51 Q67 44.5 71 51" stroke={EYE} stroke-width="3" stroke-linecap="round" fill="none" />
  {:else}
    <g class="gaze" class:thinking={thinking && moving && !down} style:transform="translate({gaze.x}px, {gaze.y}px)">
      <g class="eyes" style:transform="scaleY({lid})">
        <circle cx="53" cy="49" r="3" fill={EYE} />
        <circle cx="67" cy="49" r="3" fill={EYE} />
      </g>
    </g>
  {/if}
</svg>

<style>
  .figure {
    position: relative;
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    color: var(--ink);
  }
  .gaze {
    transition: transform 220ms var(--ease-standard, ease);
  }
  /* Thinking: the eyes wander from one upper corner to the other. */
  .gaze.thinking {
    animation: wander 2.4s ease-in-out infinite;
  }
  @keyframes wander {
    0%,
    100% {
      transform: translate(2.6px, -3px);
    }
    50% {
      transform: translate(-2.6px, -3px);
    }
  }
  .eyes {
    transform-box: fill-box;
    transform-origin: center;
  }
</style>
