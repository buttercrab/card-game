<script lang="ts" module>
  import type { Suit } from './games/mighty/types';

  // Drawn on a 100 × 100 grid so every suit has the same visual weight.
  export const PATHS: Record<Suit | 'Star', string> = {
    Spade:
      'M50 4C67 24 96 40 96 63c0 14-10 24-23 24-9 0-16-4-20-11 1 10 5 17 13 22H34c8-5 12-12 13-22-4 7-11 11-20 11C14 87 4 77 4 63 4 40 33 24 50 4Z',
    Heart: 'M50 94C24 72 4 56 4 33 4 17 16 6 29 6c10 0 17 6 21 14 4-8 11-14 21-14 13 0 25 11 25 27 0 23-20 39-46 61Z',
    Diamond: 'M50 2C62 20 76 36 92 50 76 64 62 80 50 98 38 80 24 64 8 50 24 36 38 20 50 2Z',
    Club: 'M30 30a20 20 0 1 0 40 0a20 20 0 1 0-40 0ZM8 62a20 20 0 1 0 40 0a20 20 0 1 0-40 0ZM52 62a20 20 0 1 0 40 0a20 20 0 1 0-40 0ZM40 54a10 10 0 1 0 20 0a10 10 0 1 0-20 0ZM46 50c0 28-4 40-14 46h36c-10-6-14-18-14-46Z',
    Star: 'M50 4l12.6 30.4 32.9 2.6-25 21.4 7.7 32L50 73.2 21.8 90.4l7.7-32-25-21.4 32.9-2.6Z',
  };

  export const SUIT_NAME: Record<Suit, string> = { Spade: '스페이드', Diamond: '다이아몬드', Heart: '하트', Club: '클로버' };
</script>

<script lang="ts">
  // A suit, drawn: never a font glyph or emoji, so it looks the same on
  // every device. It colours itself with its suit's ink (the four-colour
  // setting remaps diamonds and clubs); the spade is the surface's ink
  // (--spade-ink on card paper, else --ink). Where a surface has a colour
  // of its own (a card's index, a chosen chip), --suit-tone: currentColor
  // makes it follow. `inline` sets it in running text, at the text's size.
  let {
    suit,
    inline = false,
    size,
    label,
    class: className = '',
  }: {
    suit: Suit | 'Star';
    inline?: boolean;
    /** Its width and height, if not its container's rules. */
    size?: string;
    /** Its name for screen readers; without one it is decoration. */
    label?: string;
    class?: string;
  } = $props();
</script>

<svg
  class={['suit', `s-${suit}`, inline && 'inline', className]}
  viewBox="0 0 100 100"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  style:width={size}
  style:height={size}
><path d={PATHS[suit]} fill="currentColor" /></svg>

<style>
  svg {
    display: block;
  }
  .inline {
    display: inline-block;
    width: 0.92em;
    height: 0.92em;
    margin: 0 0.04em;
    vertical-align: -0.12em;
  }
  .s-Spade {
    color: var(--suit-tone, var(--spade-ink, var(--ink)));
  }
  .s-Heart {
    color: var(--suit-tone, var(--suit-heart));
  }
  .s-Diamond {
    color: var(--suit-tone, var(--suit-diamond));
  }
  .s-Club {
    color: var(--suit-tone, var(--suit-club));
  }
</style>
