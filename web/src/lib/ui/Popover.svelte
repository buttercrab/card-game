<script lang="ts">
  // A small card of paper hung from something on screen: a seat's choices,
  // the reactions, the hint. It sits under (or over) its anchor where it
  // fits, flips when it does not, and stays wholly inside the visual
  // viewport, which a phone's keyboard shrinks (and may scroll) while a
  // field in it has focus; too tall for what is left, it scrolls inside.
  // Escape, a tap outside and the back gesture (layers.ts) close it.
  import { untrack, type Snippet } from 'svelte';
  import { layer } from '../layers';

  let {
    anchor,
    trigger,
    onclose,
    side = 'below',
    align = 'center',
    modal = false,
    role = 'dialog',
    label,
    autofocus,
    width,
    class: className = '',
    children,
  }: {
    /** Where the anchor is on screen now. */
    anchor: () => DOMRect;
    /** The button that opened it: a tap there toggles it, not "outside". */
    trigger?: HTMLElement | null;
    onclose: () => void;
    /** Where it goes when both fit. */
    side?: 'below' | 'above';
    /** Its edge that lines up with the anchor's, or its centre. */
    align?: 'start' | 'center' | 'end';
    /** A tap outside only closes it, and reaches nothing under it. */
    modal?: boolean;
    role?: 'dialog' | 'menu' | 'status';
    label?: string;
    /** What takes focus as it opens; the card itself by default. Return
     * null to leave focus where it is. */
    autofocus?: () => HTMLElement | null | undefined;
    /** Its width, if not its content's (never wider than the screen). */
    width?: string;
    class?: string;
    children: Snippet;
  } = $props();

  const MARGIN = 8;
  const GAP = 6;
  let card = $state<HTMLElement>();
  let pos = $state<{ left: number; top: number } | null>(null);

  function place() {
    if (!card) return;
    const vv = window.visualViewport;
    const vx = vv?.offsetLeft ?? 0;
    const vy = vv?.offsetTop ?? 0;
    const vw = vv?.width ?? innerWidth;
    const vh = vv?.height ?? innerHeight;
    card.style.maxHeight = `${Math.max(0, vh - 2 * MARGIN)}px`;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const box = anchor();
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    const below = box.bottom + GAP;
    const above = box.top - GAP - h;
    const top = vy + MARGIN;
    const bottom = vy + vh - MARGIN;
    const fitsBelow = below + h <= bottom;
    const fitsAbove = above >= top;
    const y = side === 'below' ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
    const x = align === 'start' ? box.left : align === 'end' ? box.right - w : box.left + box.width / 2 - w / 2;
    pos = {
      left: clamp(x, vx + MARGIN, vx + vw - MARGIN - w),
      top: clamp(y, top, bottom - h),
    };
  }

  /** Off the component's place in the page, onto the body: an ancestor
   * with a transform or containment (the felt is a size container) would
   * otherwise be what a fixed position is measured from. */
  function portal(node: HTMLElement) {
    document.body.append(node);
    return () => node.remove();
  }

  $effect(() => {
    if (!card) return;
    return untrack(open);
  });
  function open() {
    const unlayer = layer(() => onclose());
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    // What the card holds can change its size (내보내기 asks first).
    const sized = new ResizeObserver(() => place());
    sized.observe(card!);
    place();
    // Once it is where it belongs, so focusing it scrolls nothing.
    const want = autofocus?.();
    (want === null ? null : (want ?? card))?.focus({ preventScroll: true });
    return () => {
      unlayer();
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      sized.disconnect();
    };
  }

  function outside(e: PointerEvent) {
    if (modal || !card) return;
    const target = e.target as Node;
    if (card.contains(target) || trigger?.contains(target)) return;
    onclose();
  }
</script>

<svelte:window
  onresize={place}
  onscrollcapture={place}
  onpointerdown={outside}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
/>

{#if modal}
  <!-- Anywhere else closes it, as a tap beside a real popover would. -->
  <button class="scrim" aria-label="닫기" tabindex="-1" onclick={onclose} {@attach portal}></button>
{/if}
<div
  class={['pop-card', className]}
  {role}
  aria-label={label}
  tabindex="-1"
  bind:this={card}
  style:left="{pos?.left ?? 0}px"
  style:top="{pos?.top ?? 0}px"
  style:width={width}
  style:visibility={pos ? null : 'hidden'}
  {@attach portal}
>
  {@render children()}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    cursor: default;
  }
  /* Card paper on the table: a hairline and the hard lip every object on
     the table has; nothing blurred. */
  .pop-card {
    position: fixed;
    z-index: calc(var(--z-popover) + 1);
    display: grid;
    /* One column no wider than the card: a name field or a row of chips
       never pushes a button out past the card's edge. */
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    width: max-content;
    max-width: min(300px, calc(100vw - 16px));
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px;
    border: 1px solid var(--raised-line);
    border-radius: var(--r-panel);
    background: var(--raised);
    box-shadow: 0 3px 0 var(--raised-line);
    animation: pop-in var(--dur-quick) var(--ease-standard) both;
  }
  .pop-card:focus {
    outline: none;
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      scale: 0.96;
    }
  }
  :global(:root[data-motion='reduced']) .pop-card {
    animation-name: fade;
  }
</style>
