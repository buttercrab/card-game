<script lang="ts">
  // A small button that opens the table's quick reactions: the server's
  // list (it refuses anything else), emoji in a row, words as chips.
  import { tableShortcut } from '../ui/shortcuts';
  import { CATALOG } from '../catalog';
  import Icon from '../Icon.svelte';
  import Button from '../ui/Button.svelte';
  import Chip from '../ui/Chip.svelte';
  import Popover from '../ui/Popover.svelte';
  /** `below` opens the menu downward, for a button near the top of the screen. */
  let { onreact, below = false }: { onreact: (text: string) => void; below?: boolean } = $props();

  const emoji = (r: string) => /\p{Extended_Pictographic}/u.test(r);
  const EMOJI = CATALOG.reactions.filter(emoji);
  const PHRASES = CATALOG.reactions.filter((r) => !emoji(r));

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let palette = $state<HTMLElement>();
  function shortcut(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 'r' || !tableShortcut(e, open)) return;
    e.preventDefault(); open = !open;
  }
  function navigate(e: KeyboardEvent) {
    const items = [...palette!.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
    if (!delta && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + delta + items.length) % items.length]?.focus();
  }

  function pick(text: string) {
    onreact(text);
    open = false;
  }
</script>

<svelte:window onkeydown={shortcut} />

<Button aria-keyshortcuts="R" title="반응 보내기 · R" variant="icon" raised class="reactions" aria-label="반응 보내기" aria-expanded={open} bind:element={trigger} onclick={() => (open = !open)}>
  <Icon name="smile" />
</Button>
{#if open && trigger}
  <Popover
    anchor={() => trigger!.getBoundingClientRect()}
    {trigger}
    side={below ? 'below' : 'above'}
    align="end"
    role="menu"
    label="반응"
    autofocus={() => palette?.querySelector<HTMLButtonElement>('[role=menuitem]')}
    onclose={() => (open = false)}
  >
    <div class="picker" bind:this={palette} onkeydown={navigate} role="presentation">
    <div class="emoji">
      {#each EMOJI as e (e)}<button role="menuitem" onclick={() => pick(e)}>{e}</button>{/each}
    </div>
    <div class="phrases">
      {#each PHRASES as p (p)}<Chip role="menuitem" onclick={() => pick(p)}>{p}</Chip>{/each}
    </div>
    <p class="shortcut">R 열기/닫기 · 방향키 선택 · Enter 보내기</p>
    </div>
  </Popover>
{/if}

<style>
  .shortcut { margin: 10px 0 0; font-size: 11px; color: var(--ink-muted); }
  .emoji {
    display: grid;
    grid-template-columns: repeat(6, 44px);
    gap: 2px;
  }
  .emoji button {
    min-height: 44px;
    border-radius: var(--r-control);
    font-size: 24px;
    text-align: center;
  }
  .emoji button:active {
    scale: 0.92;
  }
  .phrases {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 6px;
    max-width: 280px;
  }
</style>
