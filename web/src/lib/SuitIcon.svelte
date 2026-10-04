<script lang="ts" module>
  import type { Suit } from './types';

  // Drawn on a 100 × 100 grid so every suit has the same visual weight.
  export const PATHS: Record<Suit | 'Star', string> = {
    Spade:
      'M50 4C67 24 96 40 96 63c0 14-10 24-23 24-9 0-16-4-20-11 1 10 5 17 13 22H34c8-5 12-12 13-22-4 7-11 11-20 11C14 87 4 77 4 63 4 40 33 24 50 4Z',
    Heart: 'M50 94C24 72 4 56 4 33 4 17 16 6 29 6c10 0 17 6 21 14 4-8 11-14 21-14 13 0 25 11 25 27 0 23-20 39-46 61Z',
    Diamond: 'M50 2C62 20 76 36 92 50 76 64 62 80 50 98 38 80 24 64 8 50 24 36 38 20 50 2Z',
    Club: 'M30 30a20 20 0 1 0 40 0a20 20 0 1 0-40 0ZM8 62a20 20 0 1 0 40 0a20 20 0 1 0-40 0ZM52 62a20 20 0 1 0 40 0a20 20 0 1 0-40 0ZM40 54a10 10 0 1 0 20 0a10 10 0 1 0-20 0ZM46 50c0 28-4 40-14 46h36c-10-6-14-18-14-46Z',
    Star: 'M50 4l12.6 30.4 32.9 2.6-25 21.4 7.7 32L50 73.2 21.8 90.4l7.7-32-25-21.4 32.9-2.6Z',
  };
</script>

<script lang="ts">
  let { suit, class: className = '' }: { suit: Suit | 'Star'; class?: string } = $props();
</script>

<svg class={className} viewBox="0 0 100 100" aria-hidden="true"><path d={PATHS[suit]} fill="currentColor" /></svg>

<style>
  svg {
    display: block;
  }
</style>
