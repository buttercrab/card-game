<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import BidPanel from './BidPanel.svelte';
  import Card from './Card.svelte';
  import ExchangePanel from './ExchangePanel.svelte';
  import Hand from './Hand.svelte';
  import LeadTag from './LeadTag.svelte';
  import Seat, { TEAM_LABEL, type Team } from './Seat.svelte';
  import SuitIcon from './SuitIcon.svelte';
  import { cardLabel, contractLabel, friendCallLabel, isPoint, leadLabel, mightyCard, sameCard, sealOf } from './cards';
  import type { RoomClient } from './client.svelte';
  import { flyFrom, flyTo, pop } from './motion';
  import { settings } from './settings.svelte';
  import { sound } from './sound';
  import type { Action, Card as CardT, FriendCall, Lead, PhaseView, Played, PlayAction, StateMsg, Suit, Trick } from './types';

  let { client }: { client: RoomClient } = $props();

  // What is drawn lags the server by the animations still playing: each new
  // state waits in a queue, and the difference to the one on screen is
  // animated before it is shown.
  let shown = $state(untrack(() => client.game!));
  const msg = $derived(shown);
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
  // The hand answers to the latest server state, not the one still being
  // animated: once it is your turn you can play, and playing skips ahead.
  const live = $derived(client.game!);
  const liveTurn = $derived(me !== null && typeof live.turn === 'object' && live.turn.Seat === me);
  const handLegal = $derived(liveTurn ? live.legal : legal);
  const plays = $derived(handLegal.flatMap((a) => (typeof a === 'object' && 'Play' in a ? [a.Play] : [])));
  const discardable = $derived(
    handLegal.flatMap((a) => (typeof a === 'object' && 'Discard' in a ? [a.Discard] : [])),
  );
  const handMode = $derived(
    !(myTurn || liveTurn) ? 'view' : discardable.length > 0 ? 'choose' : plays.length > 0 ? 'play' : 'view',
  );

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
    skipAhead();
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
    skipAhead();
    for (const card of chosen) client.act({ Discard: card });
    chosen = [];
  }

  function variantLabel(p: PlayAction): string {
    if (p.joker_lead) return 'Suit' in p.joker_lead ? `${leadLabel(p.joker_lead)}로 내기` : `${leadLabel(p.joker_lead)}으로 내기`;
    if (p.call_joker) return '조커콜';
    return '그냥 내기';
  }

  // ---- Motion --------------------------------------------------------------
  const queue: StateMsg[] = [];
  let running = false;
  /** A finished trick kept on the table while it resolves. */
  let resolving = $state<{ plays: Played[]; key: number; lead: Lead } | null>(null);
  let winner = $state<number | null>(null);
  let revealed = $state<number | null>(null);
  let dealing = $state(false);
  let felt: HTMLElement;
  /** Set when the player acts: finish what is animating and show the latest state. */
  let hurry = false;
  const pauses = new Set<() => void>();

  /** A pause that ends early when the player acts. */
  function pause(ms: number): Promise<void> {
    if (hurry || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pauses.delete(done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);
      pauses.add(done);
    });
  }

  function skipAhead() {
    if (!running) return;
    hurry = true;
    for (const a of felt?.getAnimations({ subtree: true }) ?? []) a.finish();
    for (const done of [...pauses]) done();
  }

  $effect(() => {
    const next = client.game;
    if (!next || next === untrack(() => shown)) return;
    queue.push(next);
    untrack(pump);
  });

  /** Duration multiplier: 0 skips motion; a backlog speeds it up. */
  function pace(): number {
    if (settings.speed === 'off' || hurry) return 0;
    // Once it is your turn, what is left to show plays three times as fast.
    const waiting = untrack(() => liveTurn) ? 3 : 1;
    return (settings.speed === 'fast' ? 0.5 : 1) / (1 + 0.5 * queue.length) / waiting;
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift()!;
        const k = pace();
        // Too far behind or not being watched: catch up at once.
        cues(shown, next);
        if (k === 0 || document.hidden || queue.length > 3) {
          for (const a of felt?.getAnimations({ subtree: true }) ?? []) a.finish();
          resolving = null;
          winner = null;
          shown = next;
          continue;
        }
        await transition(shown, next, k);
      }
    } finally {
      running = false;
      hurry = false;
    }
  }

  type Round = { plays: Played[]; tricks: Trick[]; friend: number | null };
  function roundOf(p: PhaseView): Round | null {
    if (typeof p !== 'object') return null;
    if ('Play' in p) return p.Play;
    if ('Done' in p) return { plays: [], tricks: p.Done.tricks, friend: p.Done.friend };
    return null;
  }

  function slotCard(seat: number): Element | null {
    return felt?.querySelector(`[data-slot="${seat}"] .card`) ?? null;
  }

  /** Where a card played by `seat` comes from, or a finished trick goes to. */
  function anchor(seat: number, card?: CardT): DOMRect | null {
    if (seat === me) {
      const inHand = card && document.querySelector(`.tray [data-card='${JSON.stringify(card)}']`);
      return (inHand || document.querySelector('.tray'))?.getBoundingClientRect() ?? null;
    }
    return felt?.querySelector(`[data-seat="${seat}"]`)?.getBoundingClientRect() ?? null;
  }

  function describe(prev: StateMsg, next: StateMsg): string | null {
    const was = prev.view.phase;
    const now = next.view.phase;
    if (typeof now !== 'object') return null;
    if ('Bidding' in now) {
      if (!(typeof was === 'object' && 'Bidding' in was)) return null;
      const passed = now.Bidding.passed.findIndex((p, i) => p && !was.Bidding.passed[i]);
      if (passed >= 0) return `${seatName(passed)} · 패스`;
      const best = now.Bidding.best;
      if (best && JSON.stringify(best) !== JSON.stringify(was.Bidding.best)) {
        return `${seatName(best[0])} · 공약 ${contractLabel(best[1])}`;
      }
      return null;
    }
    if ('Exchange' in now && !(typeof was === 'object' && 'Exchange' in was)) {
      return `${seatName(now.Exchange.declarer)} 주공 · ${contractLabel(now.Exchange.contract)}`;
    }
    if ('Play' in now && typeof was === 'object' && 'Exchange' in was) {
      const label = friendCallLabel(now.Play.call, seatName, twoJokers);
      return `프렌드 ${sameCallMighty(now.Play.call, now.Play.contract.trump) ? '마이티' : label}`;
    }
    const a = roundOf(was);
    const b = roundOf(now);
    if (a && b) {
      if (b.friend !== null && a.friend === null) return `${seatName(b.friend)} 프렌드 공개`;
      if (b.tricks.length > a.tricks.length) {
        const t = b.tricks.at(-1)!;
        const got = t.plays.filter((p) => isPoint(p.card)).length;
        return `${seatName(t.winner)} 가져감${got > 0 ? ` · ${got}점` : ''}`;
      }
    }
    return null;
  }

  function sameCallMighty(c: FriendCall, trump: Suit | null): boolean {
    return typeof c === 'object' && 'Card' in c && sameCard(c.Card, mightyCard(trump));
  }

  /** Shows `fresh` cards arriving from their players while `apply` updates the table. */
  async function land(fresh: Played[], apply: () => void, k: number) {
    const from = fresh.map((p) => anchor(p.seat, p.card));
    apply();
    await tick();
    if (prefersReducedMotion.current) return;
    await Promise.all(
      fresh.map((p, i) => {
        const origin = from[i];
        const duration = (p.seat === me ? 220 : 320) * k;
        sound.card((i * 60 * k + duration * 0.8) / 1000);
        return origin && !hurry ? flyFrom(slotCard(p.seat), origin, duration, i * 60 * k) : undefined;
      }),
    );
  }

  /** The latest thing that happened, for anyone who looked away. */
  let event = $state<string | null>(null);

  /** Sounds and the event line for a change of state. */
  function cues(prev: StateMsg, next: StateMsg) {
    const was = prev.view.phase;
    const now = next.view.phase;
    event = describe(prev, next) ?? event;
    const turnOf = (m: StateMsg) => (typeof m.turn === 'object' ? m.turn.Seat : null);
    if (me !== null && turnOf(next) === me && turnOf(prev) !== me) {
      sound.turn();
      if (settings.haptics) navigator.vibrate?.(18);
    }
    const kind = (p: PhaseView) => (typeof p === 'object' ? Object.keys(p)[0] : p);
    if (kind(now) !== kind(was)) {
      if (kind(now) === 'Exchange') sound.contract();
      if (kind(now) === 'Play' && kind(was) === 'Exchange') sound.call();
      if (kind(now) === 'Bidding') sound.shuffle();
    }
    if (typeof was === 'object' && 'Bidding' in was && typeof now === 'object' && 'Bidding' in now) {
      const moved = JSON.stringify(was.Bidding.best) !== JSON.stringify(now.Bidding.best) ||
        was.Bidding.passed.filter(Boolean).length !== now.Bidding.passed.filter(Boolean).length;
      if (moved) sound.bid();
    }
    if (typeof now === 'object' && 'Done' in now && !(typeof was === 'object' && 'Done' in was)) {
      const d = now.Done;
      const declarerWon = d.team_points >= d.contract.count;
      const mine = me === null || me === d.declarer || me === d.friend;
      sound.result(mine ? declarerWon : !declarerWon);
    }
    // With motion off, cards still make their sound as they land.
    if (pace() === 0 || prefersReducedMotion.current) {
      const a = roundOf(was);
      const b = roundOf(now);
      if (a && b && b.tricks.length === a.tricks.length) {
        b.plays.slice(a.plays.length).forEach((_, i) => sound.card(i * 0.06));
      }
    }
  }

  async function transition(prev: StateMsg, next: StateMsg, k: number) {
    const before = roundOf(prev.view.phase);
    const after = roundOf(next.view.phase);
    const newHand = typeof next.view.phase === 'object' && 'Bidding' in next.view.phase && !('Bidding' in Object(prev.view.phase));
    if (!before || !after) {
      shown = next;
      if (newHand) {
        dealing = true;
        await pause(900 * k);
        dealing = false;
      }
      return;
    }
    const reduced = prefersReducedMotion.current;
    if (after.tricks.length === before.tricks.length) {
      await land(after.plays.slice(before.plays.length), () => (shown = next), k);
    } else if (after.tricks.length === before.tricks.length + 1) {
      const trick = after.tricks.at(-1)!;
      await land(
        trick.plays.slice(before.plays.length),
        () => {
          resolving = { plays: trick.plays, key: after.tricks.length, lead: trick.lead };
          shown = next;
        },
        k,
      );
      // The hero moment: a beat, the winning card pops, the trick sweeps to its winner.
      await pause(150 * k);
      winner = trick.winner;
      await pop(slotCard(trick.winner), reduced || hurry ? 0 : 360 * k);
      await pause((reduced ? 700 : 250) * k);
      const to = anchor(trick.winner);
      sound.sweep(trick.plays.filter((p) => isPoint(p.card)).length);
      if (!reduced && !hurry && to) {
        await Promise.all(trick.plays.map((p, i) => flyTo(slotCard(p.seat), to, 400 * k, i * 40 * k)));
      }
      await land(
        after.plays,
        () => {
          resolving = null;
          winner = null;
        },
        k,
      );
    } else {
      shown = next;
    }
    if (before.friend === null && after.friend !== null && after.friend !== undefined) {
      revealed = after.friend;
      sound.friend();
      await pause(700 * k);
      revealed = null;
    }
  }

  const onTable = $derived(resolving ? resolving.plays : (play?.plays ?? []));
  const onTableLead = $derived(resolving ? resolving.lead : (play?.lead ?? null));
  const trickKey = $derived(resolving ? `r${resolving.key}` : `p${play?.tricks.length ?? 0}`);
  const trickNo = $derived(resolving ? resolving.key : play ? play.trick_no + 1 : 0);
  /** Why a card on the table is hatched: it has no power here. The suit a
   * led joker named is shown on the joker itself. */
  const trickNotes = $derived.by(() => {
    const notes: string[] = [];
    for (const p of onTable) {
      if (p.powered) continue;
      const when = trickNo === 1 ? '첫 라운드라 ' : trickNo === view.rules.hand_size ? '마지막 라운드라 ' : '';
      notes.push(`${when}${cardLabel(p.card)} 효력 없음`);
    }
    return notes;
  });
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
      {#if play}<span class="item">라운드 <strong>{trickNo}/{view.rules.hand_size}</strong></span>{/if}
      {#if play || done}
        <span class="item">여당 {#key teamPoints}<strong class="bump">{teamPoints}/{contract.count}</strong>{/key}</span>
      {/if}
      {#if lastTrick && !resolving}
        <button class="ghost review" aria-pressed={review} onclick={() => (review = !review)}>직전 라운드</button>
      {/if}
    {/if}
  </div>
  {#if event && !done}{#key event}<p class="event fade-up" aria-live="polite">{event}</p>{/key}{/if}

  <div class="felt" bind:this={felt}>
    {#each around as r (r)}
      {@const s = seatAt(r)}
      {@const info = room?.seats[s]}
      <div class="spot pos-{n === 5 ? r : 'free'}" data-seat={s} style:--x={Math.cos(angle(r))} style:--y={Math.sin(angle(r))}>
        <Seat
          name={seatName(s)}
          bot={info?.kind === 'bot'}
          offline={info?.kind === 'human' && !info.connected}
          team={team(s)}
          points={points(s)}
          turn={turn === s}
          bubble={bubble(s)}
          dim={bidding?.passed[s] ?? false}
          reveal={revealed === s}
        />
      </div>
    {/each}

    <div class="trick" aria-label={resolving ? '끝난 라운드' : '이번 라운드'}>
      {#each onTable as p, i (`${trickKey}-${p.seat}`)}
        {@const r = relative(p.seat)}
        <div class="slot" data-slot={p.seat} style:--x={Math.cos(angle(r))} style:--y={Math.sin(angle(r))}>
          <Card
            card={p.card}
            size="trick"
            seal={seal(p.card)}
            {twoJokers}
            powerless={!p.powered}
            won={p.seat === winner}
          />
          {#if i === 0 && 'Joker' in p.card && onTableLead}<LeadTag lead={onTableLead} />{/if}
        </div>
      {/each}
    </div>

    {#if resolving && winner !== null}
      <p class="note below won-note">{winner === me ? '내가' : seatName(winner)} 가져감</p>
    {:else if play && play.plays.length === 0 && !resolving}
      <p class="note">{turn === me ? '내가 선' : `${seatName(play.leader)} 선`}</p>
    {:else if play?.called_joker}
      <p class="note below alert">조커콜 · 조커를 내야 해요</p>
    {:else if trickNotes.length > 0}
      <p class="note below">{trickNotes.join(' · ')}</p>
    {/if}

    {#if review && lastTrick}
      <div class="sheet review-sheet" role="dialog" aria-label="직전 라운드">
        <div class="review-cards">
          {#each lastTrick.plays as p, i (p.seat)}
            <figure>
              <span class="mini-slot">
                <Card card={p.card} size="mini" seal={seal(p.card)} {twoJokers} won={p.seat === lastTrick.winner} />
                {#if i === 0 && 'Joker' in p.card}<LeadTag lead={lastTrick.lead} />{/if}
              </span>
              <figcaption>{seatName(p.seat)}</figcaption>
            </figure>
          {/each}
        </div>
        <button class="ghost" onclick={() => (review = false)}>닫기</button>
      </div>
    {/if}

    {#if done}
      {@const won = done.team_points >= done.contract.count}
      {@const mineWon = me !== null && won === (me === done.declarer || me === done.friend)}
      <div class="sheet result" role="status">
        <p class="headline">
          {won ? '여당 승리' : '야당 승리'}
          {#if mineWon}
            <span class="burst" aria-hidden="true">
              {#each ['Spade', 'Heart', 'Diamond', 'Club', 'Spade', 'Heart', 'Diamond', 'Club'] as const as suit, i (i)}
                <span class="spark suit-{suit}" style:--a="{i * 45 + 20}deg"><SuitIcon {suit} /></span>
              {/each}
            </span>
          {/if}
        </p>
        <p class="sub">여당 <strong>{done.team_points}</strong> / 공약 {done.contract.count}</p>
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

    <div class="tray" class:reveal={revealed === me}>
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
          deal={dealing}
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
  /* The table fills the screen exactly; the felt takes what is left and
     sizes its cards from its own width and height (container units), so
     nothing scrolls and nothing collides. */
  .table {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'status' 'event' 'felt' 'strip' 'tray';
    gap: 6px;
    height: calc(100dvh - var(--chrome, 80px));
  }
  .status {
    grid-area: status;
  }
  .event {
    grid-area: event;
  }
  .felt {
    grid-area: felt;
  }
  .strip,
  .spectating {
    grid-area: strip;
  }
  .tray {
    grid-area: tray;
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
  .event {
    margin: -6px 0 0;
    text-align: center;
    font-size: 13px;
    color: var(--ink-muted);
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

  /* The felt: four seats in fixed bands (two on top, one each side), the
     trick in the middle, each card between its player and the centre. */
  .felt {
    --seat-w: 92px;
    --seat-h: 64px;
    position: relative;
    min-height: 0;
    container-type: size;
  }
  /* Card size from the room left between the seats: wide enough that the
     side cards clear the side seats, short enough that the top cards clear
     the top seats and the bottom card leaves room for the note. */
  .trick,
  .note {
    --card-w: clamp(
      40px,
      min((100cqw - 2 * var(--seat-w) - 16px) / 3.4, (50cqh - var(--seat-h) - 14px) / 1.84, (50cqh - 40px) / 2.1),
      84px
    );
    --card-h: calc(var(--card-w) * 1.4);
    --tx: calc(var(--card-w) * 1.25);
    --ty: calc(var(--card-h) + 6px);
  }
  .spot {
    position: absolute;
    left: calc(50% + var(--x) * 38%);
    top: calc(50% + var(--y) * 40%);
    transform: translate(-50%, -50%);
  }
  .spot.pos-1 {
    left: auto;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .spot.pos-2,
  .spot.pos-3 {
    top: 0;
    transform: translateX(-50%);
  }
  .spot.pos-2 {
    left: 75%;
  }
  .spot.pos-3 {
    left: 25%;
  }
  .spot.pos-4 {
    left: 0;
    top: 50%;
    transform: translateY(-50%);
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
  .trick .slot :global(.card) {
    --w: var(--card-w);
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
    top: calc(50% + var(--ty) + var(--card-h) / 2 + 16px);
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
    max-height: calc(100% - 8px);
    overflow: auto;
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
  .mini-slot {
    position: relative;
    margin-bottom: 8px;
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
    animation: rise var(--dur-reveal) var(--ease-settle) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 24px)) scale(0.96);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .result {
      animation-name: fade;
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
  }
  .result p {
    margin: 0;
  }
  .headline {
    position: relative;
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
    animation: turn-pulse 900ms var(--ease-standard);
  }
  /* Your turn: the tray's ring swells once, then settles. */
  @keyframes turn-pulse {
    0% {
      outline-offset: -3px;
      outline-width: 3px;
    }
    35% {
      outline-offset: 2px;
      outline-width: 5px;
    }
    100% {
      outline-offset: -3px;
      outline-width: 3px;
    }
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

  /* Phones on their side: the strip moves beside the felt, seats go down
     both sides, and the note moves into the event line. */
  @media (orientation: landscape) and (max-height: 520px) {
    .table {
      grid-template-columns: minmax(0, 1fr) minmax(240px, 36%);
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas: 'status status' 'felt strip' 'tray tray';
      gap: 4px 8px;
    }
    .event,
    .note.below,
    .me-row {
      display: none;
    }
    .strip {
      align-self: stretch;
      overflow-y: auto;
    }
    .trick,
    .note {
      --card-w: clamp(36px, min((100cqw - 2 * var(--seat-w) - 16px) / 3.4, (50cqh - 6px) / 2.1), 72px);
    }
    .spot.pos-1,
    .spot.pos-2,
    .spot.pos-3,
    .spot.pos-4 {
      transform: none;
    }
    .spot.pos-3 {
      left: 0;
      top: 0;
    }
    .spot.pos-4 {
      left: 0;
      top: auto;
      bottom: 0;
    }
    .spot.pos-2 {
      left: auto;
      right: 0;
      top: 0;
    }
    .spot.pos-1 {
      right: 0;
      top: auto;
      bottom: 0;
    }
    .tray {
      padding: 0 4px 4px;
    }
    /* Bottom seats show their bubble above, clear of the hand. */
    .spot.pos-1 :global(.bubble),
    .spot.pos-4 :global(.bubble) {
      top: -12px;
      bottom: auto;
      transform: translate(-50%, -50%);
    }
  }

  /* Your side won: suit marks burst out from the headline, once. */
  .burst {
    position: absolute;
    left: 50%;
    top: 50%;
    pointer-events: none;
  }
  .spark {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    opacity: 0;
    animation: spark 900ms var(--ease-standard) 200ms;
  }
  .spark.suit-Heart {
    color: var(--suit-heart);
  }
  .spark.suit-Diamond {
    color: var(--suit-diamond);
  }
  .spark.suit-Club {
    color: var(--suit-club);
  }
  .spark.suit-Spade {
    color: var(--ink);
  }
  @keyframes spark {
    0% {
      opacity: 1;
      transform: rotate(var(--a)) translateX(10px) scale(0.6);
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateX(110px) scale(1);
    }
  }
</style>
