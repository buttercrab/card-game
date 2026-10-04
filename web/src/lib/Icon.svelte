<script lang="ts" module>
  export type IconName = 'hint' | 'smile';
</script>

<script lang="ts">
  // Small drawn icons for the play UI, in the flat figure language of
  // CourtArt: ink outlines in `currentColor`, the court's skin and gold
  // fixed. Used instead of system emoji, which differ on every device.
  // Decorative: the button that holds one carries the label.
  let { name, size = '1.3em' }: { name: IconName; size?: string } = $props();

  const GOLD = '#A77A12';
  const SKIN = '#F3E3CF';
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
    <circle cx="12" cy="12" r="9.6" fill={SKIN} stroke="currentColor" stroke-width="1.8" />
    <circle cx="8.9" cy="10.2" r="1.25" fill="currentColor" />
    <circle cx="15.1" cy="10.2" r="1.25" fill="currentColor" />
    <path d="M8 14 q4 4 8 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" />
  {/if}
</svg>

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: -0.25em;
  }
</style>
