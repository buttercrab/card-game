<script lang="ts">
  import DeckPreview from './lib/DeckPreview.svelte';
  import TablePreview from './lib/TablePreview.svelte';
  import SharePreview from './lib/SharePreview.svelte';
  import About from './lib/About.svelte';
  import Home from './lib/Home.svelte';
  import NotFound from './lib/NotFound.svelte';
  import Privacy from './lib/Privacy.svelte';
  import Room from './lib/Room.svelte';
  import Rulebook from './lib/Rulebook.svelte';
  import { PRESET_NAME } from './lib/presets';

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

  // The server titles the first page it sends; moving around in the app
  // keeps the title in step.
  $effect(() => {
    document.title = rulesFor
      ? `${PRESET_NAME[rulesFor] ? `${PRESET_NAME[rulesFor]} 규칙` : '규칙'} · 마이티`
      : roomId
        ? '마이티 · 테이블'
        : page === '/about'
          ? '소개 · 마이티'
          : page === '/privacy'
            ? '개인정보 처리방침 · 마이티'
            : ['/', '/deck', '/preview', '/share'].includes(page)
              ? '마이티'
              : '페이지를 찾을 수 없어요 · 마이티';
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

{#if page === '/deck'}
  <DeckPreview />
{:else if page === '/preview'}
  <TablePreview />
{:else if page === '/share'}
  <SharePreview />
{:else if rulesFor}
  <main class="page"><Rulebook preset={rulesFor} /></main>
{:else if roomId}
  {#key roomId}
    <Room id={roomId} onleave={leaveTable} />
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
