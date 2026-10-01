<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { RoomClient, savedName } from './client.svelte';
  import Table from './Table.svelte';

  let { id, onleave }: { id: string; onleave: () => void } = $props();

  const client = new RoomClient(untrack(() => id));
  onDestroy(() => client.close());

  let name = $state(savedName());
  let copied = $state(false);

  const room = $derived(client.room);
  const seated = $derived(client.seat !== null);
  const inHand = $derived(room?.in_hand ?? false);
  const full = $derived(room?.seats.every((s) => s.kind !== 'empty') ?? false);
  const showTable = $derived(client.game !== null && (inHand || (room?.hands_played ?? 0) > 0));
  const offline = $derived(
    room?.seats.flatMap((s, i) => (s.kind === 'human' && !s.connected ? [{ seat: i, name: s.name }] : [])) ?? [],
  );

  function take(event: SubmitEvent) {
    event.preventDefault();
    if (name.trim()) client.join(name.trim());
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      prompt('Copy this link', location.href);
    }
  }
</script>

<div class="page">
  <header>
    <button class="ghost back" onclick={onleave} aria-label="Back to start">←</button>
    <div class="title">
      <strong>Table {id}</strong>
      {#if room}<span class="muted">· {room.settings.preset}</span>{/if}
    </div>
    <span class="status" data-status={client.status} title={client.status}></span>
    <button onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
  </header>

  {#if client.status === 'missing'}
    <section class="panel center">
      <h2>No table called {id}</h2>
      <p class="muted">It may have closed when the server restarted.</p>
      <button class="primary" onclick={onleave}>Start a new table</button>
    </section>
  {:else if !room}
    <p class="muted center">Connecting…</p>
  {:else}
    {#if inHand && seated && offline.length > 0}
      <div class="banner">
        {#each offline as o (o.seat)}
          <span>{o.name} is offline.</span>
          <button onclick={() => client.addBot(o.seat)}>Let a bot play for {o.name}</button>
        {/each}
      </div>
    {/if}

    {#if showTable}
      <Table {client} />
    {/if}

    {#if !inHand}
      <section class="panel lobby">
        <div class="lobby-head">
          <h2>{room.hands_played === 0 ? 'Seats' : 'Between hands'}</h2>
          {#if seated}
            <button class="primary" disabled={!full} onclick={() => client.start()}>
              {room.hands_played === 0 ? 'Deal' : 'Deal next hand'}
            </button>
          {/if}
        </div>
        {#if seated && !full}
          <p class="muted hint">Fill every seat with a friend or a bot to deal.</p>
        {/if}

        <ol class="seats">
          {#each room.seats as s, i (i)}
            <li class:me={client.seat === i}>
              <span class="seat-no">{i + 1}</span>
              <span class="seat-name">
                {#if s.kind === 'empty'}
                  <span class="muted">Empty</span>
                {:else}
                  {s.name}
                  {#if client.seat === i}<span class="tag">you</span>{/if}
                  {#if s.kind === 'bot'}<span class="tag">bot</span>{/if}
                  {#if s.kind === 'human' && !s.connected}<span class="tag warn">offline</span>{/if}
                {/if}
              </span>
              {#if room.hands_played > 0}
                <span class="score" class:neg={room.scores[i] < 0}>{room.scores[i] > 0 ? '+' : ''}{room.scores[i]}</span>
              {/if}
              <span class="seat-actions">
                {#if s.kind === 'empty' && !seated && name.trim()}
                  <button onclick={() => client.join(name.trim(), i)}>Sit here</button>
                {:else if s.kind === 'empty' && seated}
                  <button onclick={() => client.addBot(i)}>Add bot</button>
                {:else if s.kind === 'bot' && seated}
                  <button class="ghost" onclick={() => client.removeBot(i)}>Remove</button>
                {:else if s.kind === 'human' && !s.connected && seated}
                  <button class="ghost" onclick={() => client.addBot(i)}>Replace with bot</button>
                {/if}
              </span>
            </li>
          {/each}
        </ol>

        {#if !seated}
          <form onsubmit={take}>
            <input bind:value={name} placeholder="Your name" aria-label="Your name" maxlength="24" />
            <button class="primary" type="submit" disabled={!name.trim() || full}>Take a seat</button>
          </form>
          {#if full}<p class="muted hint">The table is full. You are watching.</p>{/if}
        {:else}
          <button class="ghost leave" onclick={() => client.leave()}>Leave my seat</button>
        {/if}
      </section>
    {/if}
  {/if}

  {#if client.error}
    <div class="toast" role="alert">{client.error}</div>
  {/if}
</div>

<style>
  .page {
    max-width: 920px;
    margin: 0 auto;
    padding: 12px 16px 32px;
    display: grid;
    gap: 16px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .back {
    padding: 4px 10px;
    font-size: 18px;
  }

  .title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--muted);
  }

  .status[data-status='open'] {
    background: var(--accent);
  }

  .status[data-status='closed'] {
    background: var(--danger);
  }

  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
  }

  .center {
    text-align: center;
  }

  h2 {
    margin: 0;
    font-size: 17px;
  }

  .lobby {
    display: grid;
    gap: 12px;
  }

  .lobby-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .hint {
    margin: 0;
    font-size: 14px;
  }

  .seats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }

  .seats li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    min-height: 52px;
  }

  .seats li.me {
    outline: 2px solid var(--accent);
  }

  .seat-no {
    width: 22px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .seat-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    margin-left: 6px;
    font-size: 12px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--text);
  }

  .tag.warn {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
  }

  .score {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--accent);
  }

  .score.neg {
    color: var(--danger);
  }

  form {
    display: flex;
    gap: 8px;
  }

  form input {
    flex: 1;
    min-width: 0;
  }

  .leave {
    justify-self: start;
    font-size: 14px;
  }

  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 14px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--highlight) 22%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--highlight) 50%, var(--border));
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    max-width: calc(100% - 32px);
    padding: 10px 16px;
    border-radius: 8px;
    background: var(--text);
    color: var(--bg);
    box-shadow: var(--shadow);
    z-index: 10;
  }
</style>
