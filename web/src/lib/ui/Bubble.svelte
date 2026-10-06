<script lang="ts">
  // A reaction a player just sent, on card paper over their seat (or over
  // your tray): it rises in, holds, then fades; the client drops it after
  // 2.8 s. An emoji alone is drawn large. It hangs from its container's
  // top, at --bubble-x across (the middle by default); `side` puts it
  // beside a top seat's figure instead (--figure-w), whose space above is
  // the status line.
  let { text, side = 'up' }: { text: string; side?: 'up' | 'left' | 'right' } = $props();

  const emoji = $derived(/^\p{Extended_Pictographic}/u.test(text));
</script>

<span class={['reaction', `side-${side}`, emoji && 'emoji']} aria-live="polite">{text}</span>

<style>
  .reaction {
    position: absolute;
    left: var(--bubble-x, 50%);
    top: 0;
    z-index: var(--z-seat-over);
    padding: 4px 12px;
    border: 1px solid var(--card-edge);
    border-radius: var(--r-panel);
    background: var(--card);
    /* Card paper in both themes, so its text is card ink. */
    color: var(--card-ink);
    box-shadow: var(--lip);
    font-size: var(--text-body);
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    transform: translate(-50%, -100%);
    animation: rise 2.8s var(--ease-standard) both;
  }
  .emoji {
    padding: 2px 8px;
    font-size: 28px;
  }
  .side-left,
  .side-right {
    top: 2px;
    transform: none;
    animation-name: rise-beside;
  }
  .side-right {
    left: calc(50% + var(--figure-w) / 2 + 4px);
  }
  .side-left {
    left: auto;
    right: calc(50% + var(--figure-w) / 2 + 4px);
  }
  @keyframes rise {
    0% {
      opacity: 0;
      translate: 0 60%;
      scale: 0.6;
    }
    10% {
      opacity: 1;
      translate: 0 0;
      scale: 1.08;
    }
    16%,
    82% {
      opacity: 1;
      scale: 1;
    }
    100% {
      opacity: 0;
      translate: 0 -30%;
    }
  }
  @keyframes rise-beside {
    0% {
      opacity: 0;
      scale: 0.6;
    }
    10% {
      opacity: 1;
      scale: 1.08;
    }
    16%,
    82% {
      opacity: 1;
      scale: 1;
    }
    100% {
      opacity: 0;
      translate: 0 -12px;
    }
  }
  /* Reduced: it fades in where it rests, then out. */
  :global(:root[data-motion='reduced']) .reaction {
    animation-name: fade-hold;
  }
  @keyframes fade-hold {
    0%,
    100% {
      opacity: 0;
    }
    8%,
    82% {
      opacity: 1;
    }
  }
  /* Desktop: beside the larger seat, clear of its plate. */
  @media (min-width: 1024px) and (min-height: 640px) {
    .side-right {
      left: calc(100% + 4px);
    }
    .side-left {
      right: calc(100% + 4px);
    }
  }
</style>
