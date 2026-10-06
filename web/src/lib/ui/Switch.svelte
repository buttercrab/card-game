<script lang="ts">
  // On or off: a track whose knob slides over and fills with ink. Any words
  // beside it (the label, or what the state means) are part of the target,
  // so the state never reads by colour alone.
  import type { Snippet } from 'svelte';

  let {
    checked = $bindable(false),
    onchange,
    label,
    word,
    disabled = false,
    class: className = '',
    children,
  }: {
    checked?: boolean;
    /** Called with the new state; without it the switch just flips `checked`. */
    onchange?: (on: boolean) => void;
    /** What it turns on, for screen readers, when nothing visible says so. */
    label?: string;
    /** A word for the state, beside the track (a rule's 켬 or 끔). */
    word?: string;
    disabled?: boolean;
    class?: string;
    /** A visible label, at the start of the row. */
    children?: Snippet;
  } = $props();

  function flip() {
    if (onchange) onchange(!checked);
    else checked = !checked;
  }
</script>

<button type="button" class={['switch', children && 'row', className]} role="switch" aria-checked={checked} aria-label={label} {disabled} onclick={flip}>
  {#if children}<span class="text">{@render children()}</span>{/if}
  {#if word}<span class="word">{word}</span>{/if}
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</button>

<style>
  .switch {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--ink-muted);
    font-size: var(--text-label);
    font-weight: 600;
  }
  /* With a label: the whole row is the switch, the track at its end. */
  .row {
    display: flex;
    width: 100%;
    color: var(--ink);
    font-size: var(--text-body);
    font-weight: 400;
    text-align: left;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .switch[aria-checked='true'] {
    color: var(--ink);
  }
  .switch:disabled {
    opacity: 0.4;
  }
  .track {
    position: relative;
    flex: none;
    width: 42px;
    height: 26px;
    border-radius: var(--r-pill);
    background: var(--off);
    box-shadow: inset 0 0 0 1.5px var(--ink-muted);
    transition: background-color var(--dur-quick) var(--ease-standard);
  }
  .knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--ink-muted);
    transition: transform var(--dur-quick) var(--ease-standard);
  }
  .switch[aria-checked='true'] .track {
    background: var(--ink);
    box-shadow: none;
  }
  .switch[aria-checked='true'] .knob {
    background: var(--table);
    transform: translateX(16px);
  }
</style>
