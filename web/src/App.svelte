<script lang="ts">
  import DeckPreview from './lib/DeckPreview.svelte';
  import TablePreview from './lib/TablePreview.svelte';
  import SharePreview from './lib/SharePreview.svelte';
  import Home from './lib/Home.svelte';
  import Room from './lib/Room.svelte';
  import Rulebook from './lib/Rulebook.svelte';

  let path = $state(location.pathname);

  function navigate(to: string) {
    history.pushState(null, '', to);
    path = to;
  }

  const rulesFor = $derived(path.match(/^\/rules\/([a-z]+)\/?$/)?.[1] ?? null);
  const roomId = $derived(path.match(/^\/r\/([a-z0-9]+)\/?$/)?.[1] ?? null);
</script>

<svelte:window onpopstate={() => (path = location.pathname)} />

{#if path === '/deck'}
  <DeckPreview />
{:else if path === '/preview'}
  <TablePreview />
{:else if path === '/share'}
  <SharePreview />
{:else if rulesFor}
  <main class="rules-page"><Rulebook preset={rulesFor} /></main>
{:else if roomId}
  {#key roomId}
    <Room id={roomId} onleave={() => navigate('/')} />
  {/key}
{:else}
  <Home onopen={(id) => navigate(`/r/${id}`)} />
{/if}

<style>
  .rules-page {
    max-width: 640px;
    margin: 0 auto;
    padding: 32px 16px 48px;
  }
</style>
