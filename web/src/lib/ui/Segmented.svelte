<script lang="ts" generics="T">
  // One strip of choices in a well, the chosen one filled with ink: a bot's
  // level, the turn limit, a rule's options, the animation speed. A
  // radiogroup; arrow keys move along it as in any.
  let {
    options,
    value,
    onchange,
    label,
    stack = false,
    same = (a: T, b: T) => a === b,
    class: className = '',
  }: {
    options: readonly { value: T; label: string }[];
    value: T;
    /** A choice other than the current one was made. */
    onchange: (value: T) => void;
    /** What the group chooses, for screen readers. */
    label: string;
    /** Long choices, one per line. */
    stack?: boolean;
    /** How to tell two values apart, for values that are objects. */
    same?: (a: T, b: T) => boolean;
    class?: string;
  } = $props();

  let group: HTMLElement;
  function key(e: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const at = options.findIndex((o) => same(o.value, value));
    const next = options[(at + step + options.length) % options.length];
    onchange(next.value);
    // Focus follows the choice, once it is drawn.
    queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
</script>

<span class={['segmented', stack && 'stack', className]} role="radiogroup" aria-label={label} bind:this={group} onkeydown={key} tabindex="-1">
  {#each options as o (o.label)}
    {@const on = same(o.value, value)}
    <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} onclick={() => !on && onchange(o.value)}>{o.label}</button>
  {/each}
</span>

<style>
  .segmented {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .segmented:focus {
    outline: none;
  }
  .stack {
    grid-auto-flow: row;
    border-radius: var(--r-control);
  }
  button {
    min-height: 40px;
    padding: 4px 6px;
    border-radius: var(--r-pill);
    color: var(--ink-muted);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    font-variant-numeric: tabular-nums;
    word-break: keep-all;
    transition: background-color var(--dur-quick) var(--ease-standard);
  }
  .stack button {
    padding: 6px 10px;
    border-radius: 10px;
  }
  button[aria-checked='true'] {
    background: var(--ink);
    color: var(--table);
  }
  @media (hover: hover) {
    button[aria-checked='false']:hover {
      color: var(--ink);
    }
  }
</style>
