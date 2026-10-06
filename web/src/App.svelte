<script lang="ts">
  import type { Component } from 'svelte';
  import About from './lib/About.svelte';
  import Home from './lib/Home.svelte';
  import NotFound from './lib/NotFound.svelte';
  import Privacy from './lib/Privacy.svelte';
  import Room from './lib/room/Room.svelte';
  import { gameFor, MAIN_GAME, TOOLS } from './lib/games/registry';

  let path = $state(location.pathname);

  function navigate(to: string, state: Record<string, unknown> | null = null) {
    history.pushState(state, '', to);
    path = location.pathname;
  }

  /** Off a table to the home page. Opened from home, the table steps back to
   * it, so the history is as it was before; opened from a link, its entry
   * becomes the home page, so back does not lead to the table again. */
  function leaveTable() {
    if (history.state?.from === 'home') history.back();
    else {
      history.replaceState(null, '', '/');
      path = location.pathname;
    }
  }

  const rulesFor = $derived(path.match(/^\/rules\/([a-z]+)\/?$/)?.[1] ?? null);
  const roomId = $derived(path.match(/^\/r\/([a-z0-9]+)\/?$/)?.[1] ?? null);
  /** The page by name; a trailing slash is the same page. */
  const page = $derived(path.replace(/(.)\/$/, '$1'));

  // The games' tool pages (Mighty's deck, the table's states, the share
  // image) load on their own, so players never download them.
  const tools: Record<string, () => Promise<{ default: Component }>> = TOOLS;
  /** The rulebook pages are the main game's, as is the site's name. */
  const RulebookPage = MAIN_GAME.RulebookPage;
  const site = MAIN_GAME.name;

  // The server titles the first page it sends; moving around in the app
  // keeps the title in step.
  $effect(() => {
    const preset = rulesFor && MAIN_GAME.presetTitle(rulesFor);
    document.title = rulesFor
      ? `${preset ? `${preset} 규칙` : '규칙'} · ${site}`
      : roomId
        ? `${site} · 테이블`
        : page === '/about'
          ? `소개 · ${site}`
          : page === '/privacy'
            ? `개인정보 처리방침 · ${site}`
            : page === '/' || page in tools
              ? site
              : `페이지를 찾을 수 없어요 · ${site}`;
  });

  /** Links between the app's own pages move without reloading it. */
  function follow(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = (event.target as Element | null)?.closest?.('a');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    if (url.href === location.href) return;
    navigate(url.pathname + url.search + url.hash);
    scrollTo(0, 0);
  }
</script>

<svelte:window onpopstate={() => (path = location.pathname)} />
<svelte:document onclick={follow} />

{#if tools[page]}
  {#await tools[page]() then { default: Tool }}
    <Tool />
  {/await}
{:else if rulesFor}
  <main class="page"><RulebookPage preset={rulesFor} /></main>
{:else if roomId}
  {#key roomId}
    <Room id={roomId} games={gameFor} onleave={leaveTable} />
  {/key}
{:else if page === '/about'}
  <main class="page"><About /></main>
{:else if page === '/privacy'}
  <main class="page"><Privacy /></main>
{:else if page === '/'}
  <Home onopen={(id) => navigate(`/r/${id}`, { from: 'home' })} />
{:else}
  <main class="page"><NotFound /></main>
{/if}

<style>
  /* The reading pages: a rulebook, 소개, the privacy policy. */
  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: 32px 16px 48px;
  }
</style>
