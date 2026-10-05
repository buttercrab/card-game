<script lang="ts" module>
  export type IconName =
    | 'hint'
    | 'smile'
    | 'lock'
    | 'menu'
    | 'shuffle'
    | 'sliders'
    | 'invite'
    | 'book'
    | 'sound'
    | 'leave'
    | 'flag'
    | 'swap'
    | 'bot'
    | 'result'
    | 'fold';
</script>

<script lang="ts">
  import { FIXED } from './tokens';
  // Small drawn icons for the play UI, in the flat figure language of
  // CourtArt: ink outlines in `currentColor`, the court's skin and gold
  // fixed. Used instead of system emoji, which differ on every device.
  // Decorative: the button that holds one carries the label.
  let { name, size = '1.3em' }: { name: IconName; size?: string } = $props();

  const GOLD = FIXED['card-gold'];
  const SKIN = FIXED.skin;
  const INK = FIXED['figure-eye'];
</script>

<svg viewBox="0 0 24 24" width={size} height={size} class="icon" aria-hidden="true">
  {#if name === 'hint'}
    <!-- A flat bulb: gold glass, an ink base, three short rays. -->
    <path d="M12 4.2 a6 6 0 0 1 3.6 10.8 q-0.9 0.8 -0.9 2 h-5.4 q0 -1.2 -0.9 -2 A6 6 0 0 1 12 4.2 Z" fill={GOLD} />
    <path d="M10.3 9.6 q1.7 -1.6 3.4 0" stroke={SKIN} stroke-width="1.3" fill="none" stroke-linecap="round" />
    <rect x="9.3" y="17.6" width="5.4" height="1.6" rx="0.8" fill="currentColor" />
    <rect x="10" y="20" width="4" height="1.6" rx="0.8" fill="currentColor" />
    <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M12 0.9 v1.3" />
      <path d="M4.4 4 l1 1" />
      <path d="M19.6 4 l-1 1" />
    </g>
  {:else if name === 'smile'}
    <!-- A figure's head: skin, an ink outline, two dot eyes and a smile. -->
    <!-- The face is skin in every theme, so its features stay dark ink. -->
    <circle cx="12" cy="12" r="9.6" fill={SKIN} stroke={INK} stroke-width="1.8" />
    <circle cx="8.9" cy="10.2" r="1.25" fill={INK} />
    <circle cx="15.1" cy="10.2" r="1.25" fill={INK} />
    <path d="M8 14 q4 4 8 0" stroke={INK} stroke-width="1.8" fill="none" stroke-linecap="round" />
  {:else if name === 'lock'}
    <!-- A padlock: an ink shackle over a gold body with a keyhole. -->
    <path d="M7.5 11 V8 a4.5 4.5 0 0 1 9 0 V11" stroke="currentColor" stroke-width="2.2" fill="none" />
    <rect x="4.5" y="10.5" width="15" height="11" rx="2.5" fill={GOLD} />
    <circle cx="12" cy="15.4" r="1.7" fill={SKIN} />
  {:else}
    <!-- The table's tools: round-capped ink strokes, one idea each. -->
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {#if name === 'menu'}
        <!-- Three rules, the middle one shorter. -->
        <path d="M4.5 6.5 h15" />
        <path d="M4.5 12 h11" />
        <path d="M4.5 17.5 h15" />
      {:else if name === 'shuffle'}
        <!-- Two paths crossing, each ending in an arrowhead. -->
        <path d="M3.5 7 h3.2 c4.6 0 6 10 10.6 10 h3" />
        <path d="M3.5 17 h3.2 c2 0 3.2 -1.9 4.3 -4" />
        <path d="M13.2 9 c1.1 -1.2 2.3 -2 4.1 -2 h3" />
        <path d="M18 4.6 l2.4 2.4 -2.4 2.4" />
        <path d="M18 14.6 l2.4 2.4 -2.4 2.4" />
      {:else if name === 'sliders'}
        <!-- Two sliders, their knobs set apart. -->
        <path d="M4 8 h16" />
        <path d="M4 16 h16" />
        <circle cx="9" cy="8" r="2.4" fill="var(--icon-fill, var(--table))" />
        <circle cx="15" cy="16" r="2.4" fill="var(--icon-fill, var(--table))" />
      {:else if name === 'invite'}
        <!-- A figure's head and shoulders, and a plus. -->
        <circle cx="9.5" cy="8.5" r="3.6" />
        <path d="M3 20 c0.6 -4.2 3.3 -6.2 6.5 -6.2 s5.9 2 6.5 6.2" />
        <path d="M19 6.5 v6" />
        <path d="M16 9.5 h6" />
      {:else if name === 'book'}
        <!-- An open book: two pages from one spine. -->
        <path d="M12 6.5 c-2.2 -1.6 -5 -2 -8 -1.6 v12.6 c3 -0.4 5.8 0 8 1.6" />
        <path d="M12 6.5 c2.2 -1.6 5 -2 8 -1.6 v12.6 c-3 -0.4 -5.8 0 -8 1.6" />
        <path d="M12 6.5 v12.6" />
      {:else if name === 'sound'}
        <!-- A speaker with two arcs. -->
        <path d="M4 9.5 h3 l4.5 -4 v13 l-4.5 -4 h-3 z" />
        <path d="M15 9 c1.2 1.6 1.2 4.4 0 6" />
        <path d="M17.8 6.5 c2.6 3 2.6 8 0 11" />
      {:else if name === 'leave'}
        <!-- An open door and an arrow walking out of it. -->
        <path d="M13 4 h-7.5 v16 h7.5" />
        <path d="M10 12 h10.5" />
        <path d="M17 8.5 l3.5 3.5 -3.5 3.5" />
      {:else if name === 'flag'}
        <path d="M5.5 21 v-17" />
        <path d="M5.5 4.5 h11 l-2.5 4 2.5 4 h-11" />
      {:else if name === 'swap'}
        <!-- Two arrows passing each other. -->
        <path d="M4 8.5 h15" />
        <path d="M15.5 5 l3.5 3.5 -3.5 3.5" />
        <path d="M20 15.5 h-15" />
        <path d="M8.5 12 l-3.5 3.5 3.5 3.5" />
      {:else if name === 'bot'}
        <!-- A round head with an antenna and two dot eyes. -->
        <rect x="4.5" y="8" width="15" height="11.5" rx="4" />
        <path d="M12 8 v-3" />
        <circle cx="12" cy="4" r="1" fill="currentColor" />
        <circle cx="9.3" cy="13.6" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="14.7" cy="13.6" r="1.2" fill="currentColor" stroke="none" />
      {:else if name === 'result'}
        <!-- A score sheet: a page with its rows. -->
        <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
        <path d="M8.5 8.5 h7" />
        <path d="M8.5 12 h7" />
        <path d="M8.5 15.5 h4" />
      {:else if name === 'fold'}
        <!-- A chevron pointing down: put it away. -->
        <path d="M6 9.5 l6 6 6 -6" />
      {/if}
    </g>
  {/if}
</svg>

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: -0.25em;
  }
</style>
