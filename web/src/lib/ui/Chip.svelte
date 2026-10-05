<script lang="ts">
  // A choice on a pill (the `.chip` primitive in app.css): one of a
  // radiogroup when `checked` is set, a toggle when `pressed` is, a plain
  // button otherwise. Chosen, it fills with ink.
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    checked,
    pressed,
    size = 'md',
    class: className = '',
    children,
    ...rest
  }: HTMLButtonAttributes & {
    /** One of a radiogroup: whether it is the chosen one. */
    checked?: boolean;
    /** A toggle: whether it is on. */
    pressed?: boolean;
    size?: 'md' | 'sm';
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<button
  type="button"
  class={['chip', size === 'sm' && 'sm', className]}
  role={checked !== undefined ? 'radio' : undefined}
  aria-checked={checked}
  aria-pressed={pressed}
  {...rest}
>
  {@render children?.()}
</button>
