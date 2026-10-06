<script lang="ts">
  // Wide desktops: the hand at a glance, on stacked paper beside the felt.
  // 상황판 (the contract large, the facts beside it, the tally under) over
  // 점수판 (one row a player, in seat order from you).
  import Card from '../Card.svelte';
  import type { Seal } from '../cards';
  import PlayerFigure from '../PlayerFigure.svelte';
  import SuitIcon, { SUIT_NAME } from '../../../SuitIcon.svelte';
  import SuitText from '../../../SuitText.svelte';
  import type { Card as CardT, RoomView, Rules } from '../types';
  import Badge from '../../../ui/Badge.svelte';
  import type { Ring } from '../../../room/seats';
  import RulesChip from './RulesChip.svelte';
  import Tally from './Tally.svelte';
  import type { HandView, Tag } from './view';

  let {
    hand,
    rules,
    trickNo,
    tags,
    callLabel,
    seatName,
    myName,
    seal,
    room,
    me,
    turn,
    ring,
    idle,
    rulesName,
    shuffleNote,
    onrules,
  }: {
    hand: HandView;
    rules: Rules;
    trickNo: number;
    tags: Tag[];
    callLabel: string | null;
    seatName: (seat: number) => string;
    /** Your name as the room knows it. */
    myName: string;
    seal: (card: CardT) => Seal | null;
    room: RoomView | null;
    me: number | null;
    turn: number | null;
    ring: Ring;
    idle: boolean;
    rulesName: string;
    shuffleNote: string | null;
    onrules?: () => void;
  } = $props();

  const { bidding, contract, play, done, declarer, friend, call } = $derived(hand);
</script>

<aside class="side" aria-label="게임 정보">
  <section class="pane board" aria-label="상황판">
    <h3 class="pane-title">
      상황판
      {#if play}<span class="round-no">라운드 <strong>{trickNo}</strong>/{rules.hand_size}</span>{/if}
    </h3>
    {#if turn !== null}
      <p class="turn-line"><span aria-hidden="true">●</span><strong class="clip" title={seatName(turn)}>{turn === me ? '내 차례' : `${seatName(turn)} 차례`}</strong></p>
    {:else if play}<p class="turn-line muted">카드 모으는 중</p>{/if}
    {#if bidding}
      <div class="big-contract">
        {#if bidding.best}
          {@const best = bidding.best[1]}
          <span class="glyph-box">
            {#if best.trump}<SuitIcon suit={best.trump} size="30px" label={SUIT_NAME[best.trump]} />{:else}<span class="nt">노</span>{/if}
          </span>
          <span class="big-num">{best.count}</span>
          <span class="big-sub">최고 공약<br /><strong>{seatName(bidding.best[0])}</strong></span>
        {:else}
          <span class="big-sub">공약 없음<br /><strong>최소 {hand.lastChance ?? rules.bidding.min}</strong></span>
        {/if}
      </div>
    {:else if contract}
      <div class="big-contract">
        <span class="glyph-box">
          {#if contract.trump}<SuitIcon suit={contract.trump} size="30px" label={SUIT_NAME[contract.trump]} />{:else}<span class="nt">노</span>{/if}
        </span>
        <span class="big-num">{contract.count}</span>
        <dl class="facts">
          {#if declarer !== null}<div><dt>주공</dt><dd><span class="clip">{seatName(declarer)}</span></dd></div>{/if}
          {#if callLabel}
            <div>
              <dt>프렌드</dt>
              <dd>
                {#if friend === null && !hand.noFriend && call && typeof call === 'object' && 'Card' in call}
                  <Card card={call.Card} size="mini" width={22} seal={seal(call.Card)} twoJokers={hand.twoJokers} />
                {/if}
                <span class="clip"><SuitText text={callLabel} /></span>
              </dd>
            </div>
          {/if}
        </dl>
      </div>
      {#if play || done}
        <div class="side-meter">
          <span class="meter-row">
            <span>여당 {#key hand.teamPoints}<strong class="bump">{hand.teamPoints}</strong>{/key}<span class="of">/{contract.count}</span></span>
            <span>야당 <strong>{hand.tally.def}</strong></span>
          </span>
          <Tally tally={hand.tally} goal={contract.count} wide />
          {#if tags.length}
            <span class="side-tags">{#each tags as t (t.text)}<Badge kind="tag" tone={t.tone} class="pop">{t.text}</Badge>{/each}</span>
          {/if}
        </div>
      {/if}
    {:else if idle && room}
      <p class="pane-empty">{room.hands_played === 0 ? '첫 판을 기다려요' : `${room.hands_played}판 끝 · 다음 판을 기다려요`}</p>
      {#if shuffleNote}<p class="pane-empty"><strong>{shuffleNote}</strong></p>{/if}
      <p class="pane-rules"><RulesChip name={rulesName} onclick={onrules} /></p>
    {:else}
      <p class="pane-empty">패를 나누는 중</p>
    {/if}
  </section>

  <section class="pane scores" aria-label="점수판">
    <h3 class="pane-title">점수판 <span class="cols"><span>점수</span><span>누적</span></span></h3>
    <ol class="score-rows">
      {#each Array.from({ length: ring.n }, (_, k) => ring.seatAt(k)) as s (s)}
        {@const info = room?.seats[s]}
        {@const t = hand.team(s)}
        {@const vacant = info?.kind === 'empty' && s !== me}
        <li class:me={s === me} class:turn={turn === s}>
          <span class="head" class:on={turn === s}>
            {#if vacant}
              <!-- An empty seat: the dashed outline the seat itself shows. -->
              <svg class="vacant-figure" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg>
            {:else}
              <PlayerFigure still team={t} trumpSuit={contract?.trump ?? null} isBot={info?.kind === 'bot'} offline={info?.kind === 'human' && !info.connected} />
            {/if}
          </span>
          <span class="who-cell">
            <span class="row-name">{s === me ? myName : vacant && idle ? '빈 자리' : seatName(s)}</span>
            {#if t}<Badge team={t} size="sm" />{/if}
          </span>
          <span class="num">{play || done ? hand.points(s) : '–'}</span>
          <span class="num total" class:neg={(room?.scores[s] ?? 0) < 0}>{vacant && idle ? '–' : (room?.scores[s] ?? 0)}</span>
        </li>
      {/each}
    </ol>
  </section>
</aside>

<style>
  .turn-line { display: flex; align-items: center; gap: 8px; min-height: 22px; margin: 0 0 10px; font-size: 14px; }
  .turn-line > span { color: var(--accent); font-size: 9px; }
  .turn-line strong { color: var(--ink); }
  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow: hidden;
  }
  .pane {
    flex: none;
    padding: 10px 12px 12px;
    border-radius: var(--r-panel);
    background: var(--panel);
    font-size: var(--text-label);
  }
  .pane-empty {
    margin: 0;
    color: var(--ink-muted);
  }
  .pane-title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 8px;
    font-size: var(--text-caption);
    font-weight: 700;
    color: var(--ink-muted);
  }
  .round-no {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .round-no strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 800;
  }
  .cols {
    display: flex;
    gap: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cols span {
    width: 40px;
    text-align: right;
  }
  .big-contract {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    column-gap: 6px;
  }
  .glyph-box {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    color: var(--ink);
  }
  .nt {
    font-size: 18px;
    font-weight: 800;
  }
  .big-num {
    font-family: var(--font-display);
    font-size: 38px;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .big-sub {
    padding-left: 6px;
    color: var(--ink-muted);
    line-height: 1.35;
  }
  .big-sub strong {
    color: var(--ink);
  }
  .facts {
    display: grid;
    gap: 3px;
    min-width: 0;
    margin: 0 0 0 8px;
    padding-left: 10px;
    border-left: 1px solid var(--line);
  }
  .facts div {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .facts dt {
    flex: none;
    width: 3em;
    color: var(--ink-muted);
  }
  .facts dd {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .side-meter {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }
  .meter-row {
    display: flex;
    justify-content: space-between;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .meter-row strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-size: var(--text-body);
    font-weight: 800;
  }
  .side-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pane-rules {
    margin: 8px 0 0;
  }
  .score-rows {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .score-rows li {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) 40px 40px;
    align-items: center;
    column-gap: 8px;
    min-height: 30px;
    color: var(--ink-muted);
  }
  .score-rows li.turn,
  .score-rows li.me {
    color: var(--ink);
  }
  .head {
    position: relative;
    width: 26px;
  }
  .vacant-figure {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 6;
    stroke-dasharray: 10 9;
    stroke-linecap: round;
  }
  /* The turn: the same plum ring the seat wears, in small. */
  .head::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 28px;
    height: 28px;
    border: 1.5px solid var(--accent);
    border-radius: 50%;
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.85);
    transition:
      opacity var(--dur-quick) var(--ease-standard),
      transform var(--dur-move) var(--ease-settle);
  }
  .head.on::after {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
  /* Name, then the badge in a column of its own so badges line up. */
  .who-cell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .row-name {
    min-width: 0;
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .num {
    text-align: right;
    font-family: var(--font-display);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .total {
    color: var(--ink);
  }
  .total.neg {
    color: var(--danger);
  }
</style>
