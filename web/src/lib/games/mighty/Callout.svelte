<script lang="ts">
  // A short label that pops in under whoever just did something big
  // (주공, 마이티, 조커콜…), letter by letter, then drifts away. The seat
  // itself wiggles at the same moment; see Seat.
  let { text, below = true }: { text: string; below?: boolean } = $props();
  const letters = $derived([...text]);
</script>

<span class="callout" class:above={!below} aria-hidden="true">
  {#each letters as ch, i (i)}<span class="ch" style:--i={i}>{ch}</span>{/each}
</span>

<style>
  .callout {
    position: absolute;
    left: 50%;
    top: calc(100% + 4px);
    z-index: 6;
    display: inline-flex;
    padding: 1px 9px 2px;
    border-radius: var(--r-pill);
    background: var(--ink);
    color: var(--table);
    font-size: var(--text-caption);
    font-weight: 800;
    white-space: nowrap;
    pointer-events: none;
    transform: translateX(-50%);
    animation: callout 1500ms var(--ease-standard, ease-out) both;
  }
  .callout.above {
    top: auto;
    bottom: calc(100% + 4px);
  }
  .ch {
    display: inline-block;
    animation: letter 220ms cubic-bezier(0.2, 1.6, 0.4, 1) both;
    animation-delay: calc(60ms + var(--i) * 45ms);
  }
  @keyframes callout {
    0% {
      opacity: 0;
      transform: translate(-50%, 4px);
    }
    10% {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    78% {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -6px);
    }
  }
  @keyframes letter {
    from {
      opacity: 0;
      transform: translateY(3px) scale(0.6);
    }
  }
  /* Reduced: the label fades in and out where it sits, letters and all;
     with motion off it simply shows, and the table removes it. */
  :global(:root[data-motion='reduced']) .callout {
    animation-name: callout-fade;
  }
  :global(:root[data-motion='reduced']) .ch {
    animation: none;
  }
  @keyframes callout-fade {
    0%,
    100% {
      opacity: 0;
    }
    10%,
    78% {
      opacity: 1;
    }
  }
</style>
