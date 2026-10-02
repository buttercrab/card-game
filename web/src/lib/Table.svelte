<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import BidPanel from './BidPanel.svelte';
  import Card from './Card.svelte';
  import ExchangePanel from './ExchangePanel.svelte';
  import { contractLabel, friendCallLabel, isPoint, sameCard, sealOf, SUIT_SYMBOL } from './cards';
  import type { RoomClient } from './client.svelte';
  import type { Action, Card as CardT, PlayAction, Trick } from './types';

  let { client }: { client: RoomClient } = $props();

  const msg = $derived(client.game!);
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
  // Seals mark the mighty and joker-call cards once the trump is known.
  const contract = $derived((exchange ?? play ?? done)?.contract ?? null);
  const twoJokers = $derived(view.rules.deck === 'TwoJokers');
  function seal(card: CardT) {
    if (contract) return sealOf(card, view.rules, contract.trump);
    return 'Joker' in card ? 'joker' : null;
  }
  const stage = $derived(exchange ?? play ?? done);
  const declarer = $derived(stage?.declarer ?? null);
  const friend = $derived(play?.friend ?? done?.friend ?? null);
  const call = $derived(play?.call ?? done?.call ?? null);

  function seatName(seat: number): string {
    const info = client.room?.seats[seat];
    return info && info.kind !== 'empty' ? info.name : `Seat ${seat + 1}`;
  }

  /** Everyone else, starting from the seat after mine, so play order reads left to right. */
  const others = $derived(
    Array.from({ length: me === null ? n : n - 1 }, (_, i) => (me === null ? i : (me + 1 + i) % n)),
  );

  const kittySize = $derived(52 + (view.rules.deck === 'TwoJokers' ? 2 : 1) - n * view.rules.hand_size);
  const toDiscard = $derived(exchange ? kittySize - (exchange.discards?.length ?? 0) : 0);

  const plays = $derived(legal.flatMap((a) => (typeof a === 'object' && 'Play' in a ? [a.Play] : [])));
  const discardable = $derived(legal.flatMap((a) => (typeof a === 'object' && 'Discard' in a ? [a.Discard] : [])));
  const choosingCards = $derived(myTurn && (plays.length > 0 || discardable.length > 0));

  let selected = $state<CardT[]>([]);
  let variants = $state<PlayAction[] | null>(null);

  // Forget choices that no longer apply once the server moves on.
  $effect(() => {
    void msg;
    const stillLegal = discardable;
    untrack(() => {
      selected = selected.filter((c) => stillLegal.some((d) => sameCard(d, c)));
      variants = null;
    });
  });

  function playable(card: CardT): boolean {
    return discardable.some((d) => sameCard(d, card)) || plays.some((p) => sameCard(p.card, card));
  }

  function act(action: Action) {
    variants = null;
    held = null;
    client.act(action);
  }

  function clickCard(card: CardT) {
    if (discardable.length > 0) {
      const i = selected.findIndex((c) => sameCard(c, card));
      if (i >= 0) selected = selected.filter((_, j) => j !== i);
      else if (selected.length < toDiscard) selected = [...selected, card];
      return;
    }
    const options = plays.filter((p) => sameCard(p.card, card));
    if (options.length === 1) act({ Play: options[0] });
    else if (options.length > 1) variants = options;
  }

  function discardSelected() {
    for (const card of selected) client.act({ Discard: card });
    selected = [];
  }

  function variantLabel(p: PlayAction): string {
    if (p.joker_suit) return `Lead joker as ${SUIT_SYMBOL[p.joker_suit]}`;
    if (p.call_joker) return 'Play and kill the joker';
    return 'Just play it';
  }

  function role(seat: number): string | null {
    if (seat === declarer) return 'Declarer';
    if (seat === friend) return 'Friend';
    return null;
  }

  const points = (seat: number) => view.points_taken[seat]?.filter(isPoint).length ?? 0;

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
</script>

<section class="table">
  <div class="seats">
    {#each others as s (s)}
      {@const r = role(s)}
      <div class="seat" class:turn={turn === s} class:passed={bidding?.passed[s]}>
        <div class="name">{seatName(s)}</div>
        <div class="meta">
          {#if r}<span class="role" class:friend={r === 'Friend'}>{r}</span>{/if}
          {#if bidding?.passed[s]}<span class="muted">passed</span>{/if}
          <span class="muted" title="Cards in hand">🂠 {view.hand_sizes[s]}</span>
          {#if points(s) > 0}<span title="Point cards won">★ {points(s)}</span>{/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="felt">
    <div class="info">
      {#if bidding}
        <span>
          {#if bidding.best}
            Highest bid: <strong>{contractLabel(bidding.best[1])}</strong> by {seatName(bidding.best[0])}
          {:else}
            No bids yet · minimum {view.rules.bidding.min}
          {/if}
        </span>
      {:else if stage}
        <span><strong>{contractLabel(stage.contract)}</strong> · {seatName(stage.declarer)}</span>
        {#if call}
          <span>Friend: {friend !== null ? seatName(friend) : friendCallLabel(call, seatName)}</span>
        {/if}
        {#if play}
          <!-- While a finished trick is held, trick_no already points at the next one. -->
          <span>Trick {play.trick_no + (held ? 0 : 1)}/{view.rules.hand_size}</span>
        {/if}
      {/if}
    </div>

    {#if held}
      <div class="trick" aria-label="Finished trick">
        {#each held.plays as p (p.seat)}
          <figure>
            <Card card={p.card} size="trick" seal={seal(p.card)} {twoJokers} powerless={!p.powered} />
            <figcaption class:won={p.seat === held.winner}>{p.seat === me ? 'You' : seatName(p.seat)}</figcaption>
          </figure>
        {/each}
      </div>
      <p class="felt-note">{held.winner === me ? 'You win' : `${seatName(held.winner)} wins`} the trick</p>
    {:else if play}
      <div class="trick" aria-label="Current trick">
        {#each play.plays as p (p.seat)}
          <figure>
            <Card card={p.card} size="trick" seal={seal(p.card)} {twoJokers} powerless={!p.powered} />
            <figcaption>{p.seat === me ? 'You' : seatName(p.seat)}</figcaption>
          </figure>
        {:else}
          <p class="felt-note">{turn === me ? 'Your lead' : `${seatName(play.leader)} leads`}</p>
        {/each}
      </div>
      <div class="trick-notes">
        {#if play.lead && play.plays[0] && 'Joker' in play.plays[0].card}
          <span>Joker led as {SUIT_SYMBOL[play.lead]}</span>
        {/if}
        {#if play.called_joker}<span class="alert">Joker killed — it must come out</span>{/if}
      </div>
    {:else if exchange}
      <p class="felt-note">
        {exchange.declarer === me ? 'You won the bid. Take a look at the kitty.' : `${seatName(exchange.declarer)} is taking the kitty…`}
      </p>
    {:else if done}
      {@const won = done.team_points >= done.contract.count}
      <div class="result">
        <p class="headline">{won ? 'Contract made' : 'Contract failed'}</p>
        <p>
          {seatName(done.declarer)}{done.friend !== null ? ` and ${seatName(done.friend)}` : ''} took
          <strong>{done.team_points}</strong> of {done.contract.count} needed.
        </p>
        <ol class="payoffs" aria-label="This hand">
          {#each done.payoffs as pay, s (s)}
            <li>
              <span>{s === me ? 'You' : seatName(s)}</span>
              <strong class:neg={pay < 0}>{pay > 0 ? '+' : ''}{pay}</strong>
            </li>
          {/each}
        </ol>
      </div>
    {:else if bidding}
      <p class="felt-note">
        {myTurn ? 'Your bid' : turn !== null ? `${seatName(turn)} is bidding…` : ''}
      </p>
    {/if}
  </div>

  {#if me !== null}
    <div class="controls">
      {#if variants}
        <div class="variants">
          {#each variants as v, i (i)}
            <button class="primary" onclick={() => act({ Play: v })}>{variantLabel(v)}</button>
          {/each}
          <button class="ghost" onclick={() => (variants = null)}>Cancel</button>
        </div>
      {:else if myTurn && bidding}
        <BidPanel {legal} onact={act} />
      {:else if myTurn && exchange}
        <ExchangePanel
          {legal}
          contract={exchange.contract}
          rules={view.rules}
          {toDiscard}
          selected={selected.length}
          {seatName}
          onact={act}
          ondiscard={discardSelected}
        />
      {:else if myTurn && play}
        <p class="prompt">Your turn — play a card</p>
      {:else if turn !== null && !done}
        <p class="prompt muted">Waiting for {seatName(turn)}…</p>
      {/if}
    </div>

    <div class="me" class:turn={myTurn}>
      <div class="me-head">
        <strong>You</strong>
        {#if role(me)}<span class="role" class:friend={role(me) === 'Friend'}>{role(me)}</span>{/if}
        {#if points(me) > 0}<span>★ {points(me)}</span>{/if}
      </div>
      {#if view.hand.length > 0}
        <div class="hand" aria-label="Your hand">
          {#each view.hand as card (JSON.stringify(card))}
            {#if choosingCards}
              <Card
                {card}
                seal={seal(card)}
                {twoJokers}
                unplayable={!playable(card)}
                raised={selected.some((c) => sameCard(c, card))}
                onclick={() => clickCard(card)}
              />
            {:else}
              <Card {card} seal={seal(card)} {twoJokers} />
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .table {
    display: grid;
    gap: 12px;
  }

  .seats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
  }

  .seat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    min-width: 0;
  }

  .seat.turn,
  .me.turn {
    border-color: var(--highlight);
    box-shadow: 0 0 0 2px var(--highlight);
  }

  .seat.passed {
    opacity: 0.6;
  }

  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 13px;
    align-items: center;
  }

  .role {
    font-size: 12px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
  }

  .role.friend {
    background: var(--highlight);
    color: #1d2433;
  }

  .felt {
    background: radial-gradient(ellipse at center, var(--felt) 0%, var(--felt-edge) 100%);
    color: var(--felt-text);
    border-radius: 18px;
    padding: 14px 16px 18px;
    min-height: 220px;
    display: grid;
    align-content: start;
    gap: 12px;
  }

  .info {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 16px;
    font-size: 14px;
    color: var(--felt-muted);
  }

  .info strong {
    color: var(--felt-text);
    font-size: 16px;
  }

  .trick {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    min-height: 106px;
    align-items: center;
  }

  figure {
    margin: 0;
    display: grid;
    justify-items: center;
    gap: 4px;
  }

  figcaption {
    font-size: 12px;
    color: var(--felt-muted);
    max-width: 72px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  figcaption.won {
    color: var(--highlight);
    font-weight: 700;
  }

  .felt-note {
    margin: 0;
    text-align: center;
    align-self: center;
    color: var(--felt-muted);
  }

  .trick-notes {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 14px;
    font-size: 13px;
    color: var(--felt-muted);
  }

  .alert {
    color: var(--highlight);
    font-weight: 600;
  }

  .result {
    text-align: center;
  }

  .result p {
    margin: 0 0 6px;
  }

  .headline {
    font-size: 20px;
    font-weight: 700;
  }

  .payoffs {
    list-style: none;
    margin: 10px auto 0;
    padding: 0;
    max-width: 320px;
    display: grid;
    gap: 4px;
  }

  .payoffs li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-variant-numeric: tabular-nums;
  }

  .payoffs .neg {
    color: #ffb4ab;
  }

  .controls {
    min-height: 44px;
    display: grid;
    align-items: center;
  }

  .controls:empty {
    display: none;
  }

  .prompt {
    margin: 0;
    text-align: center;
    font-weight: 600;
  }

  .variants {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .me {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px 14px;
  }

  .me-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 14px;
    margin-bottom: 10px;
  }

  .hand {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 14px;
  }

  @media (max-width: 520px) {
    .felt {
      min-height: 150px;
    }

    .hand {
      gap: 4px;
    }

    .hand :global(.card) {
      width: 50px;
      height: 72px;
    }
  }
</style>
