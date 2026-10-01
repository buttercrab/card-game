<script lang="ts">
  let { onopen }: { onopen: (id: string) => void } = $props();

  const PRESETS: { id: string; label: string }[] = [
    { id: 'gshs', label: '경기과고 · two jokers' },
    { id: 'default', label: '기본 5마' },
    { id: 'ddshs', label: '대구동신과고' },
    { id: 'dshs', label: '대구과고' },
    { id: 'kmla', label: '민사고' },
    { id: 'gsa', label: '광주과고' },
    { id: 'skku', label: '성균관대' },
    { id: 'sshs', label: '서울과고' },
    { id: 'yonsei', label: '연세대' },
  ];

  let preset = $state('gshs');
  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function create() {
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      onopen((await res.json()).id);
    } catch (e) {
      error = `Could not create a room: ${e instanceof Error ? e.message : e}`;
    } finally {
      busy = false;
    }
  }

  function join(event: SubmitEvent) {
    event.preventDefault();
    const id = code.trim().toLowerCase().split('/').pop();
    if (id) onopen(id);
  }
</script>

<main>
  <header>
    <div class="mark" aria-hidden="true">♠</div>
    <h1>Mighty</h1>
    <p class="muted">마이티 with your house rules. Make a table, share the link, fill empty seats with bots.</p>
  </header>

  <section class="panel">
    <h2>New table</h2>
    <label>
      <span>House rules</span>
      <select bind:value={preset}>
        {#each PRESETS as p (p.id)}
          <option value={p.id}>{p.label}</option>
        {/each}
      </select>
    </label>
    <button class="primary" onclick={create} disabled={busy}>{busy ? 'Creating…' : 'Create table'}</button>
    {#if error}<p class="error">{error}</p>{/if}
  </section>

  <section class="panel">
    <h2>Join a table</h2>
    <form onsubmit={join}>
      <input bind:value={code} placeholder="Room code or link" aria-label="Room code or link" />
      <button type="submit" disabled={!code.trim()}>Join</button>
    </form>
  </section>
</main>

<style>
  main {
    max-width: 440px;
    margin: 0 auto;
    padding: 48px 16px;
    display: grid;
    gap: 20px;
  }

  header {
    text-align: center;
  }

  .mark {
    width: 56px;
    height: 72px;
    margin: 0 auto 12px;
    display: grid;
    place-items: center;
    font-size: 34px;
    background: var(--card-face);
    color: var(--card-ink);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }

  h1 {
    margin: 0;
    font-size: 32px;
    letter-spacing: -0.02em;
  }

  header p {
    margin: 8px 0 0;
  }

  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    display: grid;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 17px;
  }

  label {
    display: grid;
    gap: 6px;
    font-size: 14px;
    color: var(--muted);
  }

  form {
    display: flex;
    gap: 8px;
  }

  form input {
    flex: 1;
    min-width: 0;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 14px;
  }
</style>
