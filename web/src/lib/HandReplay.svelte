<script lang="ts">
  // The finished hand, face up: round by round as it was played, or every
  // player's cards at once. Everything here was public by the end of the hand.
  import Card from './Card.svelte';
  import { isPoint } from './cards';
  import LeadTag from './LeadTag.svelte';
  import type { Seal } from './cards';
  import type { Card as CardT, Trick } from './types';

  let {
    tricks,
    discards,
    hiddenDiscards = false,
    declarer,
    friend,
    seatName,
    seal,
    twoJokers,
    onclose,
  }: {
    tricks: Trick[];
    discards: CardT[];
    /** The rules keep the discards from all but the declarer. */
    hiddenDiscards?: boolean;
    declarer: number;
    friend: number | null;
    seatName: (seat: number) => string;
    seal: (card: CardT) => Seal | null;
    twoJokers: boolean;
    onclose: () => void;
  } = $props();

  let tab = $state<'rounds' | 'hands'>('rounds');
  let round = $state(0);
  const trick = $derived(tricks[round]);
  const seats = $derived(tricks[0]?.plays.map((p) => p.seat).sort((a, b) => a - b) ?? []);

  const role = (seat: number) => (seat === declarer ? '주공' : seat === friend ? '프렌드' : '야당');
  const team = (seat: number) => (seat === declarer || seat === friend ? 'declarer' : 'defense');

  const SUIT_ORDER = { Spade: 0, Diamond: 1, Club: 2, Heart: 3 } as const;
  function order(card: CardT): number {
    if ('Joker' in card) return card.Joker === 'Black' ? -2 : -1;
    const [suit, rank] = card.Normal;
    return SUIT_ORDER[suit] * 20 - rank;
  }
  /** Every card a seat played, which is its hand after the exchange. */
  const handOf = (seat: number) =>
    tricks
      .flatMap((t) => t.plays.filter((p) => p.seat === seat).map((p) => p.card))
      .sort((a, b) => order(a) - order(b));
  const pointsIn = (t: Trick) => t.plays.filter((p) => isPoint(p.card)).length;

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  function key(e: KeyboardEvent) {
    if (tab !== 'rounds') return;
    if (e.key === 'ArrowLeft') round = Math.max(0, round - 1);
    if (e.key === 'ArrowRight') round = Math.min(tricks.length - 1, round + 1);
  }
</script>

<dialog bind:this={dialog} onclose={onclose} onkeydown={key} aria-labelledby="replay-title">
  <div class="body">
    <div class="head">
      <h2 id="replay-title">다시 보기</h2>
      <div class="chips" role="radiogroup" aria-label="보기">
        <button class="chip" role="radio" aria-checked={tab === 'rounds'} onclick={() => (tab = 'rounds')}>
          라운드별
        </button>
        <button class="chip" role="radio" aria-checked={tab === 'hands'} onclick={() => (tab = 'hands')}>
          각자 패
        </button>
      </div>
    </div>

    {#if tab === 'rounds' && trick}
      <div class="stepper">
        <button onclick={() => (round = Math.max(0, round - 1))} disabled={round === 0} aria-label="이전 라운드">◀</button>
        <strong>
          {round === 0 ? '첫 라운드' : round === tricks.length - 1 ? '마지막 라운드' : `${round + 1}라운드`}
          <span class="muted">{round + 1}/{tricks.length}</span>
        </strong>
        <button onclick={() => (round = Math.min(tricks.length - 1, round + 1))} disabled={round === tricks.length - 1} aria-label="다음 라운드">▶</button>
      </div>
      {#key round}
        <ol class="plays fade-up">
          {#each trick.plays as p, i (p.seat)}
            <li class:won={p.seat === trick.winner}>
              <span class="slot">
                <Card card={p.card} size="mini" seal={seal(p.card)} {twoJokers} powerless={!p.powered} won={p.seat === trick.winner} />
                {#if i === 0 && 'Joker' in p.card}<LeadTag lead={trick.lead} />{/if}
              </span>
              <span class="who">
                {seatName(p.seat)}
                <span class="team {team(p.seat)}">{role(p.seat)}</span>
              </span>
              {#if i === 0}<span class="muted">선</span>{/if}
              {#if p.seat === trick.winner}<span class="took">가져감</span>{/if}
            </li>
          {/each}
        </ol>
      {/key}
      <p class="muted sum">
        {seatName(trick.winner)} · 점수 카드 {pointsIn(trick)}장
      </p>
    {:else if tab === 'hands'}
      <ul class="hands">
        {#each seats as s (s)}
          <li>
            <span class="who">
              {seatName(s)}
              <span class="team {team(s)}">{role(s)}</span>
            </span>
            <span class="row">
              {#each handOf(s) as c, i (i)}<Card card={c} size="mini" seal={seal(c)} {twoJokers} />{/each}
            </span>
          </li>
        {/each}
        {#if discards.length}
          <li>
            <span class="who">주공이 버린 카드</span>
            <span class="row">
              {#each discards as c, i (i)}<Card card={c} size="mini" seal={seal(c)} {twoJokers} />{/each}
            </span>
          </li>
        {:else if hiddenDiscards}
          <li>
            <span class="who">주공이 버린 카드</span>
            <span class="muted hidden-note">버린 카드는 주공만 알아요</span>
          </li>
        {/if}
      </ul>
    {/if}
  </div>
  <form method="dialog">
    <button class="primary">닫기</button>
  </form>
</dialog>

<style>
  dialog {
    width: min(100% - 32px, 560px);
    max-height: min(100% - 32px, 860px);
    padding: 0;
    border: none;
    border-radius: 16px;
    background: var(--bg);
    color: var(--ink);
    overflow: hidden;
  }
  dialog[open] {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
  }
  dialog::backdrop {
    background: rgb(23 25 28 / 0.4);
  }
  .body {
    display: grid;
    align-content: start;
    gap: 14px;
    overflow-y: auto;
    padding: 20px;
    scrollbar-width: thin;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
  }
  .chips {
    display: flex;
    gap: 6px;
  }
  .stepper {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .stepper button {
    min-width: 48px;
  }
  .stepper strong {
    display: grid;
    justify-items: center;
    font-size: 17px;
  }
  .stepper .muted {
    font-size: 12px;
    font-weight: 600;
  }
  .plays {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plays li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px 6px 6px;
    border-radius: 12px;
    background: var(--panel);
  }
  .plays li.won {
    outline: 2px solid var(--accent);
  }
  .slot {
    position: relative;
    flex: none;
  }
  .slot :global(.tag) {
    transform: translateX(-50%) scale(0.8);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .team {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
  }
  .team.declarer {
    background: var(--team-declarer);
    color: #1c1915;
  }
  .team.defense {
    background: var(--team-defense);
    color: var(--on-team-defense);
  }
  .took {
    color: var(--accent);
    font-size: 13px;
    font-weight: 800;
  }
  .sum {
    margin: 0;
    text-align: center;
    font-size: 14px;
  }
  .hands {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hands li {
    display: grid;
    gap: 6px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .hidden-note {
    font-size: 14px;
  }
  form {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--line);
  }
  form .primary {
    min-width: 120px;
  }
</style>
