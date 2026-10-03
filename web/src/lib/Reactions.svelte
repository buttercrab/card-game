<script lang="ts">
  // A small button that opens the table's quick reactions. The list matches
  // the server's; it refuses anything else.
  /** `below` opens the menu downward, for a button near the top of the screen. */
  let { onreact, below = false }: { onreact: (text: string) => void; below?: boolean } = $props();

  const EMOJI = ['👏', '😂', '😮', '😭', '🔥', '🙏'];
  const PHRASES = ['나이스', '아…', 'ㅋㅋㅋ', '빨리요~', '미안', '굿'];

  let open = $state(false);
  let root: HTMLElement;

  function pick(text: string) {
    onreact(text);
    open = false;
  }

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) open = false;
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (open = false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  });
</script>

<span class="reactions" bind:this={root}>
  <button class="trigger" aria-label="반응 보내기" aria-expanded={open} onclick={() => (open = !open)}>😊</button>
  {#if open}
    <div class="menu pop" class:below role="menu" aria-label="반응">
      <div class="emoji">
        {#each EMOJI as e (e)}<button role="menuitem" onclick={() => pick(e)}>{e}</button>{/each}
      </div>
      <div class="phrases">
        {#each PHRASES as p (p)}<button class="chip" role="menuitem" onclick={() => pick(p)}>{p}</button>{/each}
      </div>
    </div>
  {/if}
</span>

<style>
  .reactions {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    min-height: 40px;
    min-width: 40px;
    padding: 0;
    border-radius: 999px;
    font-size: 18px;
    line-height: 1;
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    z-index: 30;
    display: grid;
    gap: 8px;
    width: max-content;
    max-width: min(300px, 90vw);
    padding: 10px;
    border-radius: 16px;
    background: var(--panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
  }
  .menu.below {
    top: calc(100% + 6px);
    bottom: auto;
  }
  .emoji {
    display: grid;
    grid-template-columns: repeat(6, 40px);
    gap: 4px;
  }
  .emoji button {
    min-height: 40px;
    padding: 0;
    border: none;
    background: none;
    box-shadow: none;
    font-size: 24px;
  }
  .phrases {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
