<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import BidPanel from './BidPanel.svelte';
  import Card from './Card.svelte';
  import ExchangePanel from './ExchangePanel.svelte';
  import Hand from './Hand.svelte';
  import Seat, { TEAM_LABEL, type Team } from './Seat.svelte';
  import SuitIcon from './SuitIcon.svelte';
  import { contractLabel, friendCallLabel, isPoint, mightyCard, sameCard, sealOf, SUIT_SYMBOL } from './cards';
  import type { RoomClient } from './client.svelte';
  import { settings } from './settings.svelte';
  import type { Action, Card as CardT, PlayAction, Trick } from './types';

  let { client }: { client: RoomClient } = $props();

  const msg = $derived(client.game!);
  const room = $derived(client.room);
  const view = $derived(msg.view);
  const legal = $derived(msg.legal);
  const phase = $derived(view.phase);
  const me = $derived(view.viewer === 'Spectator' ? null : view.viewer.Seat);
  const n = $derived(view.hand_sizes.length);
  const turn = $derived(typeof msg.turn === 'object' ? msg.turn.Seat : null);
  const myTurn = $derived(me !== null && turn === me);

  const bidding = $derived(typeof phase === 'object' && 'Bidding' in phase ? phase.Bidding : null);
  const exchange = $derived(typeof phase === 'object' && 'Exchange' in phase ? phase.Exchange : null);
  const play = $derived(typeof phase === 'object' && 'Play' in phase ? phase.Play : null);
  const done = $derived(typeof phase === 'object' && 'Done' in phase ? phase.Done : null);
  const stage = $derived(exchange ?? play ?? done);
  const contract = $derived(stage?.contract ?? null);
  const declarer = $derived(stage?.declarer ?? null);
  const friend = $derived(play?.friend ?? done?.friend ?? null);
  const call = $derived(play?.call ?? done?.call ?? null);
  const twoJokers = $derived(view.rules.deck === 'TwoJokers');

  // Seals mark the mighty and joker-call cards once the trump is known.
  function seal(card: CardT) {
    if (contract) return sealOf(card, view.rules, contract.trump);
    return 'Joker' in card ? 'joker' : null;
  }

  function seatName(seat: number): string {
    if (seat === me) return '나';
    const info = room?.seats[seat];
    if (!info || info.kind === 'empty') return `${seat + 1}번 자리`;
    return info.kind === 'bot' ? `봇 ${seat + 1}` : info.name;
  }

  // ---- Where everyone sits -------------------------------------------------
  // Play goes to the next seat number. Seen from the bottom, that runs
  // counter-clockwise: right, top right, top left, left.
  const bottom = $derived(me ?? 0);
  const around = $derived(Array.from({ length: n }, (_, r) => r).filter((r) => me === null || r > 0));
  function angle(r: number): number {
    return ((90 - (r * 360) / n) * Math.PI) / 180;
  }
  function seatAt(r: number): number {
    return (bottom + r) % n;
  }
  function relative(seat: number): number {
    return (seat - bottom + n) % n;
  }

  // ---- Teams and points ----------------------------------------------------
  const friendKnown = $derived(friend !== null || call === 'Alone' || done !== null);
  function team(seat: number): Team | null {
    if (declarer === null) return null;
    if (seat === declarer) return 'declarer';
    if (seat === friend) return 'friend';
    return friendKnown ? 'defense' : null;
  }
  const points = (seat: number) => view.points_taken[seat]?.filter(isPoint).length ?? 0;
  const teamPoints = $derived(
    done ? done.team_points : declarer === null ? 0 : points(declarer) + (friend !== null ? points(friend) : 0),
  );

  function bubble(seat: number): string | null {
    if (!bidding) return null;
    if (bidding.best && bidding.best[0] === seat) return contractLabel(bidding.best[1]);
    if (bidding.passed[seat]) return '패스';
    return null;
  }

  // ---- My choices ----------------------------------------------------------
  const kittySize = $derived(52 + (twoJokers ? 2 : 1) - n * view.rules.hand_size);
  const toDiscard = $derived(exchange ? kittySize - (exchange.discards?.length ?? 0) : 0);
  const plays = $derived(legal.flatMap((a) => (typeof a === 'object' && 'Play' in a ? [a.Play] : [])));
  const discardable = $derived(legal.flatMap((a) => (typeof a === 'object' && 'Discard' in a ? [a.Discard] : [])));
  const handMode = $derived(!myTurn ? 'view' : discardable.length > 0 ? 'choose' : plays.length > 0 ? 'play' : 'view');

  let chosen = $state<CardT[]>([]);
  let variants = $state<PlayAction[] | null>(null);

  // Forget choices that no longer apply once the server moves on.
  $effect(() => {
    void msg;
    const stillLegal = discardable;
    untrack(() => {
      chosen = chosen.filter((c) => stillLegal.some((d) => sameCard(d, c)));
      variants = null;
    });
  });

  // Remember the hand from the bidding so the kitty's cards can be marked.
  let biddingHand = $state<CardT[] | null>(null);
  $effect(() => {
    if (bidding) biddingHand = view.hand;
    else if (!exchange) biddingHand = null;
  });
  const kitty = $derived(
    exchange && exchange.declarer === me && biddingHand
      ? view.hand.filter((c) => !biddingHand!.some((h) => sameCard(h, c)))
      : [],
  );

  function playable(card: CardT): boolean {
    return discardable.some((d) => sameCard(d, card)) || plays.some((p) => sameCard(p.card, card));
  }

  function act(action: Action) {
    variants = null;
    client.act(action);
  }

  function playCard(card: CardT) {
    const options = plays.filter((p) => sameCard(p.card, card));
    if (options.length === 1) act({ Play: options[0] });
    else if (options.length > 1) variants = options;
  }

  function toggle(card: CardT) {
    const i = chosen.findIndex((c) => sameCard(c, card));
    if (i >= 0) chosen = chosen.filter((_, j) => j !== i);
    else if (chosen.length < toDiscard) chosen = [...chosen, card];
  }

  function discardChosen() {
    for (const card of chosen) client.act({ Discard: card });
    chosen = [];
  }

  function variantLabel(p: PlayAction): string {
    if (p.joker_suit) return `${SUIT_SYMBOL[p.joker_suit]}로 내기`;
    if (p.call_joker) return '조커콜';
    return '그냥 내기';
  }

  // ---- The trick on the table ----------------------------------------------
  // The server clears a trick the moment its last card lands. Keep the
  // finished trick on the table briefly so everyone sees how it ended.
  const finished = $derived((play?.tricks ?? done?.tricks)?.at(-1) ?? null);
  let held = $state<Trick | null>(null);
  let seen: string | null | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const key = finished && JSON.stringify(finished);
    // Nothing to replay on first load, such as after a reload mid-hand.
    if (seen !== undefined && key && key !== seen) {
      held = finished;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => (held = null), 1600);
    }
    seen = key;
  });
  onDestroy(() => clearTimeout(holdTimer));

  const shown = $derived(held ? held.plays : (play?.plays ?? []));
  const trickNo = $derived(play ? play.trick_no + (held ? 0 : 1) : 0);
  let review = $state(false);
  const lastTrick = $derived(play?.tricks.at(-1) ?? null);

  const callLabel = $derived.by(() => {
    if (!call) return null;
    if (friend !== null) return seatName(friend);
    if (typeof call === 'object' && 'Card' in call && contract && sameCard(call.Card, mightyCard(contract.trump))) {
      return '마이티';
    }
    return friendCallLabel(call, seatName, twoJokers);
  });

  const waitingFor = $derived.by(() => {
    if (turn === null) return null;
    if (exchange) return `주공 ${seatName(turn)} · 키티 정리 중`;
    if (bidding) return `${seatName(turn)} · 공약 고르는 중`;
    return `${seatName(turn)} 차례`;
  });

  const seated = $derived(client.seat !== null);
  const full = $derived(room?.seats.every((s) => s.kind !== 'empty') ?? false);
</script>

<section class="table" class:mine={myTurn}>
  <!-- 상황판: everything about the hand on one line. -->
  <div class="status" aria-live="polite">
    {#if bidding}
      {#if bidding.best}
        <span class="item">최고 공약 <strong class="contract">{contractLabel(bidding.best[1])}</strong></span>
        <span class="item muted">{seatName(bidding.best[0])}</span>
      {:else}
        <span class="item">공약 없음</span>
        <span class="item muted">최소 {view.rules.bidding.min}</span>
      {/if}
    {:else if contract}
      <span class="item">
        공약
        <strong class="contract">
          {#if contract.trump}<SuitIcon suit={contract.trump} class="trump-icon suit-{contract.trump}" />{:else}노기루다{/if}
          {contract.count}
        </strong>
      </span>
      {#if callLabel}<span class="item">프렌드 <strong>{callLabel}</strong></span>{/if}
      {#if play}<span class="item">트릭 <strong>{trickNo}/{view.rules.hand_size}</strong></span>{/if}
      {#if play || done}
        <span class="item">주공팀 <strong>{teamPoints}/{contract.count}</strong></span>
      {/if}
      {#if lastTrick && !held}
        <button class="ghost review" aria-pressed={review} onclick={() => (review = !review)}>직전 트릭</button>
      {/if}
    {/if}
  </div>

  <div class="felt">
    {#each around as r (r)}
      {@const s = seatAt(r)}
      {@const info = room?.seats[s]}
      <div class="spot" style:--x={Math.cos(angle(r))} style:--y={Math.sin(angle(r))}>
        <Seat
          name={seatName(s)}
          bot={info?.kind === 'bot'}
          offline={info?.kind === 'human' && !info.connected}
          team={team(s)}
          points={points(s)}
          turn={turn === s}
          bubble={bubble(s)}
          dim={bidding?.passed[s] ?? false}
        />
      </div>
    {/each}

    <div class="trick" aria-label={held ? '끝난 트릭' : '이번 트릭'}>
      {#each shown as p (p.seat)}
        {@const r = relative(p.seat)}
        <div class="slot" style:--x={Math.cos(angle(r))} style:--y={Math.sin(angle(r))}>
          <Card
            card={p.card}
            size="trick"
            seal={seal(p.card)}
            {twoJokers}
            powerless={!p.powered}
            won={held !== null && p.seat === held.winner}
          />
        </div>
      {/each}
    </div>

    {#if held}
      <p class="note below won-note">{held.winner === me ? '내가' : seatName(held.winner)} 가져감</p>
    {:else if play && play.plays.length === 0}
      <p class="note">{turn === me ? '내가 선' : `${seatName(play.leader)} 선`}</p>
    {:else if play?.called_joker}
      <p class="note below alert">조커콜 · 조커를 내야 해요</p>
    {:else if play && play.lead && play.plays[0] && 'Joker' in play.plays[0].card}
      <p class="note below">조커 선 · {SUIT_SYMBOL[play.lead]}</p>
    {/if}

    {#if review && lastTrick}
      <div class="sheet review-sheet" role="dialog" aria-label="직전 트릭">
        <div class="review-cards">
          {#each lastTrick.plays as p (p.seat)}
            <figure>
              <Card card={p.card} size="mini" seal={seal(p.card)} {twoJokers} won={p.seat === lastTrick.winner} />
              <figcaption>{seatName(p.seat)}</figcaption>
            </figure>
          {/each}
        </div>
        <button class="ghost" onclick={() => (review = false)}>닫기</button>
      </div>
    {/if}

    {#if done}
      {@const won = done.team_points >= done.contract.count}
      <div class="sheet result" role="status">
        <p class="headline">{won ? '주공 승리' : '야당 승리'}</p>
        <p class="sub">주공팀 <strong>{done.team_points}</strong> / 공약 {done.contract.count}</p>
        <table>
          <thead>
            <tr><th scope="col">이름</th><th scope="col">역할</th><th scope="col">점수</th><th scope="col">이번 판</th><th scope="col">누적</th></tr>
          </thead>
          <tbody>
            {#each done.payoffs as pay, s (s)}
              {@const t = team(s)}
              <tr class:me={s === me}>
                <td class="who">{seatName(s)}</td>
                <td>{#if t}<span class="team {t === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[t]}</span>{/if}</td>
                <td class="num">{points(s)}</td>
                <td class="num" class:neg={pay < 0}>{pay > 0 ? '+' : ''}{pay}</td>
                <td class="num">{room?.scores[s] ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  {#if me !== null}
    <div class="strip">
      {#if variants}
        <div class="variants">
          {#each variants as v, i (i)}
            <button class="chip" onclick={() => act({ Play: v })}>{variantLabel(v)}</button>
          {/each}
          <button class="ghost" onclick={() => (variants = null)}>취소</button>
        </div>
      {:else if myTurn && bidding}
        <BidPanel {legal} onact={act} />
      {:else if myTurn && exchange}
        <ExchangePanel
          {legal}
          contract={exchange.contract}
          rules={view.rules}
          {toDiscard}
          chosen={chosen.length}
          hand={view.hand}
          {seatName}
          onact={act}
          ondiscard={discardChosen}
        />
      {:else if myTurn && play}
        <p class="prompt"><strong>내 차례</strong> · {settings.singleTap ? '낼 카드를 누르세요' : '낼 카드를 두 번 누르세요'}</p>
      {:else if done}
        <div class="next">
          {#if seated && !full}<span class="muted">빈 자리를 채우면 다음 판을 시작할 수 있어요</span>{/if}
          <button class="primary" disabled={!seated || !full} onclick={() => client.start()}>다음 판</button>
        </div>
      {:else if waitingFor}
        <p class="prompt muted">{waitingFor}…</p>
      {/if}
    </div>

    <div class="tray">
      <div class="me-row">
        {#if team(me)}<span class="team {team(me) === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[team(me)!]}</span>{/if}
        {#if points(me) > 0}<span class="my-points">{points(me)}점</span>{/if}
      </div>
      {#if view.hand.length > 0}
        <Hand
          cards={view.hand}
          mode={handMode}
          {playable}
          {chosen}
          {kitty}
          {seal}
          {twoJokers}
          onplay={playCard}
          ontoggle={toggle}
        />
      {/if}
    </div>
  {:else}
    <p class="prompt muted spectating">구경하는 중{waitingFor ? ` · ${waitingFor}` : ''}</p>
  {/if}
</section>

<style>
  .table {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: calc(100dvh - 72px);
  }

  /* 상황판 */
  .status {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 2px 14px;
    min-height: 32px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .status strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .contract {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 17px;
  }
  .status :global(.trump-icon) {
    width: 16px;
    height: 16px;
  }
  .status :global(.suit-Heart) {
    color: var(--suit-heart);
  }
  .status :global(.suit-Diamond) {
    color: var(--suit-diamond);
  }
  .status :global(.suit-Club) {
    color: var(--suit-club);
  }
  .review {
    min-height: 32px;
    padding: 4px 10px;
    font-size: 13px;
    color: var(--ink-muted);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .review[aria-pressed='true'] {
    color: var(--ink);
    border-color: var(--ink);
  }

  /* The table: seats on an ellipse, played cards between each seat and the centre. */
  .felt {
    --rx: 37%;
    --ry: 38%;
    --tx: 70px;
    --ty: 64px;
    position: relative;
    flex: 1;
    min-height: 300px;
  }
  @media (min-width: 1024px) {
    .felt {
      --rx: 40%;
      --tx: 110px;
      --ty: 84px;
      min-height: 420px;
    }
  }
  .spot {
    position: absolute;
    left: calc(50% + var(--x) * var(--rx));
    top: calc(50% + var(--y) * var(--ry));
    transform: translate(-50%, -50%);
  }
  .trick {
    position: absolute;
    left: 50%;
    top: 50%;
  }
  .slot {
    position: absolute;
    transform: translate(calc(-50% + var(--x) * var(--tx)), calc(-50% + var(--y) * var(--ty)));
  }
  .note {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    font-size: 14px;
    color: var(--ink-muted);
    white-space: nowrap;
    pointer-events: none;
  }
  .note.below {
    top: calc(50% + var(--ty) + 52px);
  }
  .won-note {
    color: var(--ink);
    font-weight: 700;
  }
  .alert {
    color: var(--accent);
    font-weight: 700;
  }

  .sheet {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(100%, 420px);
    padding: 16px;
    border-radius: 16px;
    background: var(--panel);
    box-shadow: 0 4px 0 rgb(0 0 0 / 0.08);
    z-index: 2;
  }
  .review-sheet {
    display: grid;
    justify-items: center;
    gap: 8px;
    width: auto;
  }
  .review-cards {
    display: flex;
    gap: 8px;
  }
  figure {
    margin: 0;
    display: grid;
    justify-items: center;
    gap: 4px;
  }
  figcaption {
    max-width: 56px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-muted);
  }

  .result {
    text-align: center;
  }
  .result p {
    margin: 0;
  }
  .headline {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    color: var(--ink);
  }
  .result .sub {
    margin: 4px 0 12px;
    color: var(--ink-muted);
  }
  .result .sub strong {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th {
    padding: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  td {
    padding: 6px 4px;
    border-top: 1px solid var(--line);
  }
  tr.me td {
    font-weight: 700;
  }
  .who {
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .neg {
    color: var(--danger);
  }
  .team {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
  }
  .team.declarer {
    background: var(--team-declarer);
    color: #1c1915;
  }
  .team.defense {
    background: var(--team-defense);
    color: var(--on-team-defense);
  }

  /* The action strip: one slot whose content follows the phase. */
  .strip {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    min-height: 64px;
    padding: 10px 12px;
    border-radius: 16px;
    background: var(--panel);
  }
  .prompt {
    margin: 0;
    text-align: center;
    font-size: 15px;
  }
  .mine .prompt strong {
    color: var(--accent);
  }
  .variants,
  .next {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
  .next .primary {
    min-width: 160px;
  }
  .next .muted {
    font-size: 14px;
  }

  .tray {
    padding: 8px 8px 12px;
    border-radius: 16px;
    outline: 3px solid transparent;
    outline-offset: -3px;
    transition: outline-color var(--dur-quick) var(--ease-standard);
  }
  .mine .tray {
    outline-color: var(--accent);
  }
  .me-row {
    display: flex;
    justify-content: center;
    gap: 8px;
    min-height: 20px;
    font-size: 13px;
    font-weight: 600;
  }
  .my-points {
    font-variant-numeric: tabular-nums;
  }
  .spectating {
    padding: 16px;
  }
</style>
