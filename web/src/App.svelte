<script lang="ts">
  import DeckPreview from './lib/DeckPreview.svelte';
  import Home from './lib/Home.svelte';
  import Room from './lib/Room.svelte';

  let path = $state(location.pathname);

  function navigate(to: string) {
    history.pushState(null, '', to);
    path = to;
  }

  const roomId = $derived(path.match(/^\/r\/([a-z0-9]+)\/?$/)?.[1] ?? null);
</script>

<svelte:window onpopstate={() => (path = location.pathname)} />

{#if path === '/deck'}
  <DeckPreview />
{:else if roomId}
  {#key roomId}
    <Room id={roomId} onleave={() => navigate('/')} />
  {/key}
{:else}
  <Home onopen={(id) => navigate(`/r/${id}`)} />
{/if}
