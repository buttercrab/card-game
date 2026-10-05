<script lang="ts">
  // A sheet: a native modal <dialog>, opened as it mounts, over a scrim.
  // Escape, the back gesture (layers.ts closes the topmost open dialog) and
  // `close` all close it, and `onclose` hears each. Its look is the
  // `dialog.sheet` primitive in app.css: a scrolling body under the title,
  // and a footer that stays at the foot.
  import type { Snippet } from 'svelte';

  let {
    title,
    label,
    size = 'normal',
    focus = 'auto',
    onclose,
    class: className = '',
    head,
    children,
    footer,
    dialog = $bindable(),
  }: {
    /** The heading, which names the sheet. */
    title?: string;
    /** The sheet's name for screen readers, when it has no heading. */
    label?: string;
    /** 400px, 420px or 560px wide (less the screen's margins). */
    size?: 'small' | 'normal' | 'large';
    /** 'title' opens with focus on the heading (no ring round the first
     * button); 'auto' leaves it to the browser. */
    focus?: 'auto' | 'title';
    onclose: () => void;
    class?: string;
    /** A heading of its own, in place of `title`, with `id` to name the sheet. */
    head?: Snippet<[string]>;
    children: Snippet;
    /** The footer; `close` closes the sheet. */
    footer?: Snippet<[() => void]>;
    dialog?: HTMLDialogElement;
  } = $props();

  const id = $props.id();
  const titleId = `${id}-title`;
  let heading = $state<HTMLElement>();

  $effect(() => {
    dialog!.showModal();
    if (focus === 'title') (heading ?? dialog!.querySelector<HTMLElement>(`#${CSS.escape(titleId)}`))?.focus();
  });

  const close = () => dialog?.close();
</script>

<dialog
  bind:this={dialog}
  class={['sheet', size !== 'normal' && size, className]}
  aria-labelledby={title || head ? titleId : undefined}
  aria-label={title || head ? undefined : label}
  {onclose}
>
  <div class="sheet-body">
    {#if head}
      {@render head(titleId)}
    {:else if title}
      <h2 class="sheet-title" id={titleId} tabindex="-1" bind:this={heading}>{title}</h2>
    {/if}
    {@render children()}
  </div>
  {#if footer}
    <div class="sheet-foot">{@render footer(close)}</div>
  {/if}
</dialog>
