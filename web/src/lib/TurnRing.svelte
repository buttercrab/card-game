<script lang="ts">
  // The turn timer as a ring that empties, drawn around a seat's figure.
  // Its length is set from the time left on every frame (frame.ts), not by
  // a CSS animation: the ring says how long is left, so it must stay true
  // under reduced motion and with 애니메이션 끄기 too.
  import { eachFrame, share } from './frame';

  let { deadline, total }: { deadline: number; total: number } = $props();

  const C = 2 * Math.PI * 46;
  let left = $state(1);
  $effect(() =>
    eachFrame((now) => {
      // A local, so the effect never depends on what it writes.
      const l = share(deadline, total, now);
      left = l;
      return l > 0;
    }),
  );
</script>

<svg class="turn-ring" viewBox="0 0 100 100" aria-hidden="true">
  <circle class="track" cx="50" cy="50" r="46" />
  <circle class="left" cx="50" cy="50" r="46" style:stroke-dasharray={C} style:stroke-dashoffset={C * (1 - left)} />
</svg>

<style>
  .turn-ring {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 128%;
    height: auto;
    aspect-ratio: 1;
    transform: translate(-50%, -54%) rotate(-90deg);
    pointer-events: none;
    overflow: visible;
  }
  circle {
    fill: none;
    stroke-width: 4;
  }
  .track {
    stroke: var(--line);
  }
  /* Ink, not plum: the plum name tag already says whose turn it is. */
  .left {
    stroke: currentColor;
    stroke-linecap: round;
  }
</style>
