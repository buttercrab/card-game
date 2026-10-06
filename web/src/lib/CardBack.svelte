<script lang="ts">
  // A card back: one geometric idea each, the same either way up, drawn in
  // a single lighter tone over the ground inside a thin inset rule. Each
  // idea comes from the achievement that earns it.
  import type { CardBack } from './achievements';
  import { PATHS } from './SuitIcon.svelte';
  import { settings } from './settings.svelte';
  import { BACK_COLOR, THEME } from './tokens';

  let { id }: { id?: CardBack } = $props();

  // Clip ids must be unique on a page full of backs.
  const uid = $props.id();
  const back = $derived(id ?? settings.cardBack);
  const ground = $derived(BACK_COLOR[back] ?? BACK_COLOR.charcoal);
  const tone = $derived(`color-mix(in srgb, ${ground} 62%, ${THEME.card.light})`);
  // 20 point cards around a ring, for 큰 그림.
  const DOTS = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    return [30 + Math.sin(a) * 17, 42 - Math.cos(a) * 17];
  });
</script>

<svg viewBox="0 0 60 84" class="card-back" preserveAspectRatio="none" aria-hidden="true">
  <rect width="60" height="84" fill={ground} />
  {#if back === 'plum'}
    <!-- 첫 승리: a frame inside a frame inside a frame. -->
    <g fill="none" stroke={tone} stroke-width="1.5">
      <rect x="11" y="11" width="38" height="62" rx="3" />
      <rect x="17" y="17" width="26" height="50" rx="2.5" />
    </g>
    <rect x="23" y="23" width="14" height="38" rx="2" fill={tone} />
  {:else if back === 'indigo'}
    <!-- 철벽 야당: a wall. -->
    <clipPath id="wall-{uid}"><rect x="9" y="9" width="42" height="66" /></clipPath>
    <g fill={tone} clip-path="url(#wall-{uid})">
      {#each [0, 1, 2, 3, 4, 5, 6] as row (row)}
        {#each row % 2 ? [-1, 1, 3] : [0, 2] as col (col)}
          <rect x={9 + col * 10.5} y={12 + row * 9} width="19" height="6" rx="1" />
        {/each}
      {/each}
    </g>
  {:else if back === 'gold'}
    <!-- 큰 그림: the twenty point cards, all the way round. -->
    <g fill={tone}>
      {#each DOTS as [x, y], i (i)}<circle cx={x} cy={y} r="1.6" />{/each}
      <circle cx="30" cy="42" r="4" />
    </g>
  {:else if back === 'ink'}
    <!-- 런: one sweep from corner to corner. -->
    <g stroke={tone} stroke-linecap="round">
      <path d="M8 76 L52 8" stroke-width="7" />
      <path d="M8 66 L44 10" stroke-width="1.2" />
      <path d="M16 74 L52 18" stroke-width="1.2" />
    </g>
  {:else if back === 'jade'}
    <!-- 마이티 중독: many hands, ring after ring from two corners. -->
    <g fill="none" stroke={tone} stroke-width="1.5">
      {#each [8, 14, 20, 26, 32] as r (r)}
        <path d="M{3.5 + r} 3.5 A{r} {r} 0 0 1 3.5 {3.5 + r}" />
        <path d="M{56.5 - r} 80.5 A{r} {r} 0 0 1 56.5 {80.5 - r}" />
      {/each}
    </g>
  {:else}
    <!-- The default: the spade both ways up, tip to tip. -->
    <g fill="none" stroke={tone} stroke-width="6" stroke-linejoin="round">
      <path d={PATHS.Spade} transform="translate(18 43) scale(0.24)" />
      <path d={PATHS.Spade} transform="rotate(180 30 42) translate(18 43) scale(0.24)" />
    </g>
  {/if}
  <rect x="3.5" y="3.5" width="53" height="77" rx="3" fill="none" stroke={tone} stroke-width="1" />
</svg>

<style>
  .card-back {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
