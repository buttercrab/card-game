<script lang="ts">
  // Lets the table change its rules between hands, starting from what it
  // plays now. The server checks the result; an unplayable set comes back as
  // an error toast and the table keeps its old rules.
  import { PRESET_NAME } from './presets';
  import type { Card, CardPolicy, Rules, TrickPolicy } from './types';

  let {
    preset,
    rules,
    onsave,
    onclose,
  }: {
    preset: string;
    /** The table's own rules, or null when it plays the preset as is. */
    rules: Rules | null;
    /** null goes back to the preset. */
    onsave: (rules: Rules | null) => void;
    onclose: () => void;
  } = $props();

  let base = $state<Rules | null>(null);
  let draft = $state<Rules | null>(null);

  $effect(() => {
    fetch(`/api/presets/${preset}`)
      .then((r) => r.json())
      .then((r: Rules) => {
        base = r;
        draft = structuredClone($state.snapshot(rules) ?? r);
      })
      .catch((e) => console.error('rule editor', e));
  });

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  const changed = $derived(base && draft && JSON.stringify(base) !== JSON.stringify(draft));

  function save() {
    if (!draft) return;
    onsave(changed ? $state.snapshot(draft) : null);
    dialog.close();
  }

  const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): Card => ({ Normal: [suit, rank] });

  function setTwoJokers(on: boolean) {
    if (!draft) return;
    draft.deck = on ? 'TwoJokers' : 'OneJoker';
    draft.joker_call.calls = on
      ? [draft.joker_call.calls[0], [n('Heart', 3), n('Diamond', 3)]]
      : draft.joker_call.calls.slice(0, 1);
  }

  const POLICIES: { id: CardPolicy; label: string }[] = [
    { id: 'Valid', label: '보통' },
    { id: 'NoEffect', label: '힘 없음' },
    { id: 'Invalid', label: '못 냄' },
    { id: 'NoLead', label: '선 못 냄' },
  ];
  const CALL_POLICIES: { id: CardPolicy; label: string }[] = [
    { id: 'Valid', label: '됨' },
    { id: 'NoEffect', label: '안 됨' },
  ];
  type PolicyKey = 'mighty' | 'joker' | 'trump' | 'joker_call';
  const POLICY_ROWS: { key: PolicyKey; label: string }[] = [
    { key: 'mighty', label: '마이티' },
    { key: 'joker', label: '조커' },
    { key: 'trump', label: '기루다' },
    { key: 'joker_call', label: '조커 콜' },
  ];
  const FRIEND_WAYS: { key: 'by_card' | 'by_seat' | 'first_trick' | 'last_trick' | 'alone' | 'fake'; label: string }[] = [
    { key: 'by_card', label: '카드로 부르기' },
    { key: 'by_seat', label: '자리로 부르기' },
    { key: 'first_trick', label: '첫 라운드 승자' },
    { key: 'last_trick', label: '마지막 라운드 승자' },
    { key: 'alone', label: '노프렌드' },
    { key: 'fake', label: '가짜 프렌드' },
  ];
</script>

{#snippet stepper(value: number, min: number, max: number, set: (v: number) => void, label: string)}
  <span class="stepper" role="group" aria-label={label}>
    <button type="button" onclick={() => set(value - 1)} disabled={value <= min} aria-label="{label} 줄이기">−</button>
    <output>{value}</output>
    <button type="button" onclick={() => set(value + 1)} disabled={value >= max} aria-label="{label} 늘리기">+</button>
  </span>
{/snippet}

{#snippet policy(p: TrickPolicy, which: 'first' | 'last', options: { id: CardPolicy; label: string }[], label: string)}
  <select bind:value={p[which]} aria-label={label}>
    {#each options as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
  </select>
{/snippet}

<dialog class="sheet editor" bind:this={dialog} onclose={onclose} aria-labelledby="editor-title">
  <div class="sheet-body">
    <h2 id="editor-title">규칙 바꾸기</h2>
    <p class="muted">{PRESET_NAME[preset] ?? preset} 규칙에서 시작해요. 다음 판부터 적용돼요.</p>

    {#if draft}
      {@const d = draft}
      <h3>덱</h3>
      <label class="row">
        <span>조커 두 장</span>
        <input type="checkbox" checked={d.deck === 'TwoJokers'} onchange={(e) => setTwoJokers(e.currentTarget.checked)} />
      </label>

      <h3>공약</h3>
      <div class="row">
        <span>최소</span>
        {@render stepper(d.bidding.min, 1, d.bidding.max, (v) => (d.bidding.min = v), '최소 공약')}
      </div>
      <div class="row">
        <span>최대</span>
        {@render stepper(d.bidding.max, d.bidding.min, 20, (v) => (d.bidding.max = v), '최대 공약')}
      </div>
      <label class="row">
        <span>노기루다</span>
        <input type="checkbox" bind:checked={d.bidding.allow_no_trump} />
      </label>
      {#if d.bidding.allow_no_trump}
        <div class="row">
          <span>노기루다 보너스 <span class="muted">노기루다 n = 기루다 n+보너스</span></span>
          {@render stepper(d.bidding.no_trump_bonus, 0, 3, (v) => (d.bidding.no_trump_bonus = v), '노기루다 보너스')}
        </div>
        <label class="row">
          <span>같은 높이면 노기루다가 이김</span>
          <input type="checkbox" bind:checked={d.bidding.no_trump_wins_ties} />
        </label>
      {/if}
      <label class="row">
        <span>첫 사람도 패스 가능</span>
        <input type="checkbox" bind:checked={d.bidding.first_bidder_may_pass} />
      </label>
      <div class="row">
        <span>기루다 바꾸는 값 <span class="muted">공약에 더하는 점수</span></span>
        {@render stepper(d.bidding.change_trump_cost, 0, 5, (v) => (d.bidding.change_trump_cost = v), '기루다 바꾸는 값')}
      </div>

      {#if d.friend}
        {@const f = d.friend}
        <h3>프렌드</h3>
        <div class="chips">
          {#each FRIEND_WAYS as w (w.key)}
            <button type="button" class="chip way" aria-pressed={f[w.key]} onclick={() => (f[w.key] = !f[w.key])}>
              <svg class="check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 L5 9 L9.5 3.5" /></svg>{w.label}
            </button>
          {/each}
        </div>
      {/if}

      <h3>조커</h3>
      <label class="row">
        <span>불려 나온 조커도 힘 있음</span>
        <input type="checkbox" bind:checked={d.joker_call.called_joker_has_power} />
      </label>
      <label class="row">
        <span>조커 콜을 마이티로 막기</span>
        <input type="checkbox" bind:checked={d.joker_call.mighty_defense} />
      </label>
      {#if d.joker_lead}
        <label class="row">
          <span>조커로 색 부르기 <span class="muted">무늬 대신 빨강·검정</span></span>
          <input type="checkbox" bind:checked={d.joker_lead.by_color} />
        </label>
        <label class="row">
          <span>힘 없는 조커 선은 넘김 <span class="muted">다음 카드가 무늬를 정해요</span></span>
          <input type="checkbox" bind:checked={d.joker_lead.powerless_passes} />
        </label>
      {/if}

      {#if d.policy}
        {@const p = d.policy}
        <h3>첫 라운드와 마지막 라운드</h3>
        <div class="grid">
          <span></span><span class="muted">첫 라운드</span><span class="muted">마지막 라운드</span>
          {#each POLICY_ROWS as row (row.key)}
            {@const options = row.key === 'joker_call' ? CALL_POLICIES : POLICIES}
            <span>{row.label}</span>
            {@render policy(p[row.key], 'first', options, `${row.label} 첫 라운드`)}
            {@render policy(p[row.key], 'last', options, `${row.label} 마지막 라운드`)}
          {/each}
        </div>
      {/if}
    {:else}
      <p class="muted">불러오는 중…</p>
    {/if}
  </div>
  <div class="sheet-foot">
    <button type="button" class="ghost" disabled={!base} onclick={() => base && (draft = structuredClone($state.snapshot(base)))}>
      처음대로
    </button>
    <button type="button" onclick={() => dialog.close()}>취소</button>
    <button type="button" class="primary" disabled={!draft} onclick={save}>적용</button>
  </div>
</dialog>

<style>
  .editor {
    width: min(100% - 32px, 480px);
    max-height: min(100dvh - 32px, 860px);
  }
  h2 {
    margin: 0;
    font-size: 22px;
  }
  h2 + p {
    margin: 4px 0 0;
    font-size: 14px;
  }
  h3 {
    margin: 20px 0 4px;
    font-size: 15px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 48px;
    border-top: 1px solid var(--line);
  }
  .row .muted {
    display: block;
    font-size: 12px;
  }
  input[type='checkbox'] {
    width: 22px;
    height: 22px;
    min-height: 0;
    flex: none;
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .stepper button {
    min-width: 40px;
    min-height: 36px;
    padding: 0;
  }
  .stepper output {
    min-width: 28px;
    text-align: center;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  /* Ways to pick a friend are toggles: several can be on at once, so an
     "on" chip is outlined with a check, not filled, and a set of them
     reads as a list rather than a wall of ink. */
  .chips .way {
    min-height: 36px;
    padding: 6px 12px;
    background: transparent;
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 14px;
    animation: none;
  }
  .chips .way[aria-pressed='true'] {
    background: var(--btn);
    color: var(--on-btn);
    box-shadow:
      inset 0 0 0 1.5px var(--ink),
      0 2px 0 var(--btn-lip);
  }
  .check {
    display: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .way[aria-pressed='true'] .check {
    display: block;
  }
  .grid {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: 6px 8px;
    font-size: 14px;
  }
  select {
    min-height: 36px;
    min-width: 0;
    padding: 0 8px;
    border-radius: 10px;
  }
</style>
