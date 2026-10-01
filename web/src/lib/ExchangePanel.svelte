<script lang="ts">
  import { friendCallLabel, SUITS, trumpLabel } from './cards';
  import type { Action, Card, Contract, FriendCall, Rules, Suit } from './types';

  let {
    legal,
    contract,
    rules,
    toDiscard,
    selected,
    seatName,
    onact,
    ondiscard,
  }: {
    legal: Action[];
    contract: Contract;
    rules: Rules;
    toDiscard: number;
    selected: number;
    seatName: (seat: number) => string;
    onact: (a: Action) => void;
    ondiscard: () => void;
  } = $props();

  const trumpChanges = $derived(
    legal.flatMap((a) => (typeof a === 'object' && 'ChangeTrump' in a ? [a.ChangeTrump] : [])),
  );
  const calls = $derived(legal.flatMap((a) => (typeof a === 'object' && 'CallFriend' in a ? [a.CallFriend] : [])));

  const mighty: Card = $derived(
    contract.trump === 'Spade' ? { Normal: ['Diamond', 14] } : { Normal: ['Spade', 14] },
  );

  /** Most useful calls first: the mighty, jokers, top trumps, then the rest. */
  function rank(call: FriendCall): number {
    if (typeof call === 'string') return 1000 + ['FirstTrick', 'LastTrick', 'Alone'].indexOf(call);
    if ('Seat' in call) return 900 + call.Seat;
    const card = call.Card;
    if (JSON.stringify(card) === JSON.stringify(mighty)) return 0;
    if ('Joker' in card) return 1;
    const [suit, r] = card.Normal;
    const trumpFirst = suit === contract.trump ? 0 : 1;
    return 10 + trumpFirst * 100 + SUITS.indexOf(suit) * 20 + (14 - r);
  }

  const sortedCalls = $derived([...calls].sort((a, b) => rank(a) - rank(b)));
  let choice = $state(0);
  const call = $derived(sortedCalls[Math.min(choice, sortedCalls.length - 1)]);

  function label(c: FriendCall): string {
    const base = friendCallLabel(c, seatName);
    if (typeof c === 'object' && 'Card' in c && JSON.stringify(c.Card) === JSON.stringify(mighty)) {
      return `${base} (mighty)`;
    }
    return base;
  }

  function changedCount(t: Suit | null): number {
    const bonus = (x: Suit | null) => (x === null ? rules.bidding.no_trump_bonus : 0);
    return contract.count + rules.bidding.change_trump_cost + bonus(contract.trump) - bonus(t);
  }
</script>

<div class="panel">
  {#if calls.length > 0}
    <p>Who is your friend?</p>
    <div class="row">
      <select bind:value={choice} aria-label="Friend">
        {#each sortedCalls as c, i (i)}
          <option value={i}>{label(c)}</option>
        {/each}
      </select>
      <button class="primary" onclick={() => call && onact({ CallFriend: call })}>Call friend</button>
    </div>
  {:else}
    <p>
      Pick {toDiscard} card{toDiscard === 1 ? '' : 's'} to put back
      <span class="muted">({selected}/{toDiscard} chosen)</span>
    </p>
    <div class="row">
      <button class="primary" disabled={selected !== toDiscard} onclick={ondiscard}>Put back</button>
    </div>
    {#if trumpChanges.length > 0}
      <div class="row change">
        <span class="muted">Change trump:</span>
        {#each trumpChanges as t (t ?? 'nt')}
          <button onclick={() => onact({ ChangeTrump: t })}>{trumpLabel(t)} {changedCount(t)}</button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .panel {
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
  }

  p {
    margin: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }

  select {
    max-width: 100%;
  }

  .change {
    font-size: 14px;
  }

  .change button {
    min-height: 34px;
    padding: 4px 10px;
  }
</style>
