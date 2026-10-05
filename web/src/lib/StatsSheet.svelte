<script lang="ts">
  import { contractLabel } from './cards';
  import { ACHIEVEMENTS, loadUnlocked } from './achievements';
  import { clearStats, loadStats, type Role } from './stats';
  import Icon from './Icon.svelte';

  const unlocked = loadUnlocked();

  let { onclose }: { onclose: () => void } = $props();

  let hands = $state(loadStats());
  const ROLES: { id: Role; label: string }[] = [
    { id: 'declarer', label: '주공' },
    { id: 'friend', label: '프렌드' },
    { id: 'defense', label: '야당' },
  ];
  const rate = (won: number, of: number) => (of ? `${Math.round((won / of) * 100)}%` : '–');
  const wins = $derived(hands.filter((h) => h.won).length);
  const total = $derived(hands.reduce((sum, h) => sum + h.payoff, 0));
  const best = $derived(
    hands
      .filter((h) => h.role === 'declarer' && h.won)
      .sort((a, b) => b.contract.count - a.contract.count || (a.contract.trump ? 1 : 0) - (b.contract.trump ? 1 : 0))[0],
  );
  const recent = $derived(hands.slice(-12).reverse());

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  function reset() {
    if (!confirm('이 기기에 남은 기록을 모두 지울까요?')) return;
    clearStats();
    hands = [];
  }
</script>

<dialog class="sheet" bind:this={dialog} onclose={onclose} aria-labelledby="stats-title">
  <div class="sheet-body">
  <h2 id="stats-title">내 기록</h2>
  <p class="muted note">이 기기에서 플레이한 판만 기록돼요.</p>
  {#if hands.length === 0}
    <p>아직 끝낸 판이 없어요. 한 판 하고 오세요!</p>
  {:else}
    <div class="big">
      <div><strong>{hands.length}</strong><span>판</span></div>
      <div><strong>{rate(wins, hands.length)}</strong><span>승률</span></div>
      <div><strong class:neg={total < 0}>{total > 0 ? '+' : ''}{total}</strong><span>누적 점수</span></div>
    </div>
    <table>
      <thead><tr><th scope="col">역할</th><th scope="col">판</th><th scope="col">승률</th><th scope="col">점수</th></tr></thead>
      <tbody>
        {#each ROLES as r (r.id)}
          {@const mine = hands.filter((h) => h.role === r.id)}
          {@const sum = mine.reduce((s, h) => s + h.payoff, 0)}
          <tr>
            <th scope="row">{r.label}</th>
            <td>{mine.length}</td>
            <td>{rate(mine.filter((h) => h.won).length, mine.length)}</td>
            <td class:neg={sum < 0}>{sum > 0 ? '+' : ''}{sum}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if best}<p>주공으로 이긴 가장 큰 공약: <strong>{contractLabel(best.contract)}</strong></p>{/if}
    <h3>최근 판</h3>
    <ol class="recent">
      {#each recent as h (h.key)}
        <li class:won={h.won} title="{ROLES.find((r) => r.id === h.role)?.label} · {contractLabel(h.contract)}">
          {h.payoff > 0 ? '+' : ''}{h.payoff}
        </li>
      {/each}
    </ol>
  {/if}
  <h3>업적 <span class="muted">{ACHIEVEMENTS.filter((a) => a.id in unlocked).length}/{ACHIEVEMENTS.length}</span></h3>
  <ul class="achievements">
    {#each ACHIEVEMENTS as a (a.id)}
      <li class:got={a.id in unlocked}>
        <strong>{#if !(a.id in unlocked)}<Icon name="lock" size="12px" /><span class="sr">잠김: </span>{/if}{a.title}</strong>
        <span>{a.how}</span>
      </li>
    {/each}
  </ul>
  </div>
  <form method="dialog" class="sheet-foot">
    {#if hands.length}<button type="button" class="ghost" onclick={reset}>기록 지우기</button>{/if}
    <button>닫기</button>
  </form>
</dialog>

<style>
  h2 {
    margin: 0;
    font-size: var(--text-headline);
  }
  h3 {
    margin: 16px 0 8px;
    font-size: var(--text-body);
  }
  .note {
    margin: 2px 0 14px;
    font-size: var(--text-label);
  }
  .big {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .big div {
    display: grid;
    justify-items: center;
    padding: 10px 4px;
    border-radius: var(--r-control);
    background: var(--table);
  }
  .big strong {
    font-family: var(--font-display);
    font-size: 24px;
    font-variant-numeric: tabular-nums;
  }
  .big span {
    font-size: var(--text-caption);
    color: var(--ink-muted);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 6px 4px;
    border-top: 1px solid var(--line);
    text-align: right;
  }
  th:first-child {
    text-align: left;
  }
  thead th {
    border-top: none;
    font-size: var(--text-caption);
    color: var(--ink-muted);
  }
  .neg {
    color: var(--danger);
  }
  .recent {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .recent li {
    min-width: 36px;
    padding: 2px 6px;
    border-radius: 8px;
    background: var(--table);
    color: var(--danger);
    font-size: var(--text-label);
    font-weight: 700;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .recent li.won {
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .achievements {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .achievements li {
    display: grid;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--table);
  }
  /* Locked: a dashed edge, a lock, muted text; still readable. */
  .achievements li:not(.got) {
    background: none;
    outline: 1.5px dashed color-mix(in srgb, var(--ink) 28%, transparent);
    outline-offset: -1px;
  }
  .achievements li:not(.got) strong {
    color: var(--ink-muted);
  }
  .achievements li.got {
    box-shadow: inset 0 0 0 1.5px var(--gold);
  }
  .achievements strong {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 14px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .achievements span {
    font-size: 11px;
    color: var(--ink-muted);
  }
</style>
