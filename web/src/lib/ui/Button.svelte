<script lang="ts" module>
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger';
</script>

<script lang="ts">
  // The one button. Its look is the `.btn` primitive in app.css, so a link
  // can wear it too (`<a class="btn">`), and a component can adjust one in
  // place: primary is plum, for "act now" only; secondary sits on card
  // paper with its lip; ghost and icon have no surface; danger is a
  // secondary that removes something. `sm` is drawn smaller and keeps a
  // 44px target.
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    variant = 'secondary',
    size = 'md',
    raised = false,
    wide = false,
    type = 'button',
    class: className = '',
    element = $bindable(),
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: ButtonVariant;
    size?: 'md' | 'sm';
    /** An icon button on card paper, with its lip. */
    raised?: boolean;
    /** A row of a menu: full width, its icon and words at the start. */
    wide?: boolean;
    class?: string;
    element?: HTMLButtonElement;
    children?: Snippet;
  } = $props();
</script>

<button
  bind:this={element}
  {type}
  class={['btn', variant !== 'secondary' && variant, size === 'sm' && 'sm', raised && 'raised', wide && 'wide', className]}
  {...rest}
>
  {@render children?.()}
</button>
