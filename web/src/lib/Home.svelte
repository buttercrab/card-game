<script lang="ts">
  import Card from './Card.svelte';
  import InstallHint from './InstallHint.svelte';
  import ReportSheet from './ReportSheet.svelte';
  import RulebookSheet from './RulebookSheet.svelte';
  import { PRESETS } from './presets';

  let { onopen }: { onopen: (id: string) => void } = $props();

  let preset = $state('gshs');
  let code = $state('');
  let busy = $state(false);
  let showRules = $state(false);
  let reporting = $state(false);
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
      if (!res.ok) throw new Error(String(res.status));
      onopen((await res.json()).id);
    } catch {
      error = '테이블을 만들지 못했어요. 잠시 뒤에 다시 해 보세요.';
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
    <div class="mark" aria-hidden="true">
      <Card card={{ Joker: 'Black' }} size="mini" seal="joker" />
      <Card card={{ Normal: ['Spade', 14] }} size="hand" seal="mighty" />
      <Card size="mini" />
    </div>
    <h1>마이티</h1>
    <p class="muted">우리 규칙으로 하는 마이티. 테이블을 만들고 링크를 보내세요. 빈 자리는 봇이 채워요.</p>
  </header>

  <section class="panel">
    <div class="panel-head">
      <h2>새 테이블</h2>
      <button class="ghost small" onclick={() => (showRules = true)}>규칙 보기</button>
    </div>
    <div class="presets" role="radiogroup" aria-label="규칙">
      {#each PRESETS as p (p.id)}
        <button class="chip" role="radio" aria-checked={preset === p.id} onclick={() => (preset = p.id)}>
          {p.name}{#if p.note}<span class="note">{p.note}</span>{/if}
        </button>
      {/each}
    </div>
    <button class="primary" onclick={create} disabled={busy}>{busy ? '만드는 중…' : '테이블 만들기'}</button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>

  <section class="panel">
    <h2>테이블 들어가기</h2>
    <form onsubmit={join}>
      <input bind:value={code} placeholder="테이블 코드나 링크" aria-label="테이블 코드나 링크" />
      <button type="submit" disabled={!code.trim()}>들어가기</button>
    </form>
  </section>

  <InstallHint />
  <button class="ghost small footer" onclick={() => (reporting = true)}>문제 신고</button>
</main>
{#if reporting}
  <ReportSheet onclose={() => (reporting = false)} />
{/if}

{#if showRules}
  <RulebookSheet {preset} onclose={() => (showRules = false)} />
{/if}

<style>
  main {
    max-width: 460px;
    margin: 0 auto;
    padding: 40px 16px;
    display: grid;
    gap: 16px;
  }
  header {
    text-align: center;
  }
  .mark {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    margin-bottom: 16px;
  }
  .mark > :global(.card:first-child) {
    transform: rotate(-10deg) translate(10px, 4px);
  }
  .mark > :global(.card:last-child) {
    transform: rotate(10deg) translate(-10px, 4px);
  }
  .mark > :global(.card:nth-child(2)) {
    z-index: 1;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 36px;
    font-weight: 800;
  }
  header p {
    margin: 8px 0 0;
  }
  .panel {
    display: grid;
    gap: 12px;
    padding: 20px;
    border-radius: 16px;
    background: var(--panel);
  }
  .small {
    min-height: 36px;
    padding: 4px 10px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .footer {
    justify-self: center;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 6px;
  }
  .note {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 500;
    opacity: 0.7;
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
