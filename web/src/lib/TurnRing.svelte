<script lang="ts">
  // The turn timer as a ring that empties, drawn around a seat's figure.
  // A CSS animation does the emptying, started part-way through by a
  // negative delay, so it keeps time whether or not the tab is looked at.
  let { deadline, total }: { deadline: number; total: number } = $props();

  const left = $derived(Math.max(0, deadline - performance.now()));
  const C = 2 * Math.PI * 46;
</script>

{#key deadline}
  <svg class="turn-ring" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="track" cx="50" cy="50" r="46" />
    <circle
      class="left"
      cx="50"
      cy="50"
      r="46"
      style:stroke-dasharray={C}
      style:--c={C}
      style:animation-duration="{total}ms"
      style:animation-delay="-{total - left}ms"
    />
  </svg>
{/key}

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
    animation-name: empty;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }
  @keyframes empty {
    from {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: var(--c);
    }
  }
</style>
