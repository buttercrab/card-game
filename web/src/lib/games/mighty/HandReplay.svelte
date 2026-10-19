<script lang="ts">
  // The finished hand, face up: round by round as it was played, or every
  // player's cards at once. Everything here was public by the end of the hand.
  import Card from './Card.svelte';
  import FinishedHands from './FinishedHands.svelte';
  import { isPoint } from './cards';
  import Icon from '../../Icon.svelte';
  import LeadTag from './LeadTag.svelte';
  import type { Seal } from './cards';
  import type { Card as CardT, Trick } from './types';
  import Badge from '../../ui/Badge.svelte';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Sheet from '../../ui/Sheet.svelte';

  let {
    tricks,
    context = '',
    discards,
    hiddenDiscards = false,
    declarer,
    friend,
    seatName,
    seal,
    twoJokers,
    payoffs,
    teamPoints,
    contractCount,
    onclose,
  }: {
    tricks: Trick[];
    context?: string;
    discards: CardT[];
    /** The rules keep the discards from all but the declarer. */
    hiddenDiscards?: boolean;
    declarer: number;
    friend: number | null;
    seatName: (seat: number) => string;
    seal: (card: CardT) => Seal | null;
    twoJokers: boolean;
    payoffs?: number[];
    teamPoints?: number;
    contractCount?: number;
    onclose: () => void;
  } = $props();

  const TABS = [
    { value: 'rounds', label: '라운드별' },
    { value: 'hands', label: '전체 라운드' },
    { value: 'details', label: '점수·교환' },
  ] as const;
  let tab = $state<'rounds' | 'hands' | 'details'>('rounds');
  let round = $state(0);
  const trick = $derived(tricks[round]);
  const seats = $derived(tricks[0]?.plays.map((p) => p.seat).sort((a, b) => a - b) ?? []);

  const team = (seat: number) => (seat === declarer ? 'declarer' : seat === friend ? 'friend' : 'defense');

  const pointsWon = (seat: number) => tricks.filter(t => t.winner === seat).flatMap(t => t.plays.filter(p => isPoint(p.card)).map(p => p.card));
  const pointsIn = (t: Trick) => t.plays.filter((p) => isPoint(p.card)).length;

  function key(e: KeyboardEvent) {
    if (tab !== 'rounds' || (e.target as HTMLElement).closest('[role=radiogroup]')) return;
    if (e.key === 'ArrowLeft') round = Math.max(0, round - 1);
    if (e.key === 'ArrowRight') round = Math.min(tricks.length - 1, round + 1);
  }
</script>

<svelte:window onkeydown={key} />

<Sheet size="large" class="replay" {onclose}>
  {#snippet head(id)}
    <div class="head">
      <h2 class="sheet-title" {id}>더보기</h2>
      <Segmented options={TABS} value={tab} onchange={(t) => (tab = t)} label="보기" />
    </div>
  {/snippet}

  {#if context}<p class="muted">{context}</p>{/if}
  {#if tab === 'rounds' && trick}
    <div class="stepper">
      <Button variant="icon" raised onclick={() => (round = Math.max(0, round - 1))} disabled={round === 0} aria-label="이전 라운드"><Icon name="prev" /></Button>
      <strong>
        {round === 0 ? '첫 라운드' : round === tricks.length - 1 ? '마지막 라운드' : `${round + 1}라운드`}
        <span class="muted">{round + 1}/{tricks.length}</span>
      </strong>
      <Button variant="icon" raised onclick={() => (round = Math.min(tricks.length - 1, round + 1))} disabled={round === tricks.length - 1} aria-label="다음 라운드"><Icon name="next" /></Button>
    </div>
    {#key round}
      <ol class="plays fade-up">
        {#each trick.plays as p, i (p.seat)}
          <li class:won={p.seat === trick.winner}>
            <span class="slot">
              <Card card={p.card} size="mini" seal={seal(p.card)} {twoJokers} powerless={!p.powered} />
              {#if i === 0 && 'Joker' in p.card}<LeadTag lead={trick.lead} compact />{/if}
            </span>
            <span class="who">
              <span class="name">{seatName(p.seat)}</span>
              <Badge team={team(p.seat)} size="sm" />
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
    <FinishedHands {tricks} {declarer} {friend} {seatName} {seal} {twoJokers} />
  {:else if tab === 'details'}
    {#if contractCount !== undefined || teamPoints !== undefined}<p class="details-summary">{#if contractCount !== undefined}공약 {contractCount}{/if}{#if contractCount !== undefined && teamPoints !== undefined} · {/if}{#if teamPoints !== undefined}여당 획득 {teamPoints}점{/if}</p>{/if}
    <ul class="hands">
      {#each seats as s (s)}
        {@const won = pointsWon(s)}
        <li>
          <span class="who">
            <span class="name">{seatName(s)}</span>
            <Badge team={team(s)} size="sm" />
            {#if payoffs?.[s] !== undefined}<strong class="payoff" class:negative={payoffs[s] < 0}>이번 판 {payoffs[s] > 0 ? '+' : ''}{payoffs[s]}점</strong>{/if}
          </span>
          <span class="muted hidden-note">가져온 점수 카드 {won.length}장</span>
          {#if won.length}<span class="row">{#each won as c, i (i)}<Card card={c} size="mini" seal={seal(c)} {twoJokers} />{/each}</span>{/if}
        </li>
      {/each}
      {#if hiddenDiscards}
        <li><span class="who">주공이 버린 카드</span><span class="muted hidden-note">버린 카드는 주공만 알아요</span></li>
      {:else if discards.length}
        <li>
          <span class="who">주공이 버린 카드</span>
          <span class="row">
            {#each discards as c, i (i)}<Card card={c} size="mini" seal={seal(c)} {twoJokers} />{/each}
          </span>
        </li>
      {/if}
    </ul>
  {/if}
  {#snippet footer(close)}
    <Button variant="primary" onclick={close}>{context ? '현재 테이블로 돌아가기' : '닫기'}</Button>
  {/snippet}
</Sheet>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 14px;
  }
  .head h2 {
    margin: 0;
  }
  .stepper {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 14px;
  }
  .stepper strong {
    display: grid;
    justify-items: center;
    font-size: var(--text-title);
  }
  .stepper .muted {
    font-size: var(--text-caption);
    font-weight: 600;
  }
  .plays {
    display: grid;
    gap: 8px;
    margin: 0 0 14px;
    padding: 0;
    list-style: none;
  }
  .plays li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 6px 12px 6px 6px;
    border-radius: var(--r-control);
    background: var(--table);
  }
  /* Who took the round: an ink outline; plum is only for "act now". */
  .plays li.won {
    outline: 2px solid var(--ink);
  }
  .slot {
    position: relative;
    flex: none;
  }
  /* A long name gives way; the badge and the notes after it stay. */
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
  }
  /* A long name wraps rather than running off the sheet. */
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .took {
    flex: none;
    font-size: var(--text-label);
    font-weight: 800;
  }
  .plays .muted {
    flex: none;
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
    min-width: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .hidden-note {
    font-size: 14px;
  }
  .details-summary { margin:0 0 14px; font-size:14px; font-weight:600; }
  .payoff { margin-left:auto; flex:none; font-size:12px; font-weight:600; }
  .payoff.negative { color:var(--danger); }
</style>
