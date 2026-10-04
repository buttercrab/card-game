<script lang="ts">
  // The declarer's strip during the exchange: put cards back, maybe change
  // trump, then name the friend.
  import Card from './Card.svelte';
  import { cardLabel, friendCallLabel, mightyCard, sameCard, sealOf, SUITS, trumpLabel } from './cards';
  import type { Action, Card as CardT, Contract, FriendCall, Rules, Suit } from './types';

  let {
    legal,
    contract,
    rules,
    toDiscard,
    chosen,
    hand,
    seatName,
    onact,
    ondiscard,
  }: {
    legal: Action[];
    contract: Contract;
    rules: Rules;
    toDiscard: number;
    chosen: number;
    /** Calling a card you hold is allowed but rarely meant, so it is not offered first. */
    hand: CardT[];
    seatName: (seat: number) => string;
    onact: (a: Action) => void;
    ondiscard: () => void;
  } = $props();

  const twoJokers = $derived(rules.deck === 'TwoJokers');
  const trumpChanges = $derived(
    legal.flatMap((a) => (typeof a === 'object' && 'ChangeTrump' in a ? [a.ChangeTrump] : [])),
  );
  const calls = $derived(legal.flatMap((a) => (typeof a === 'object' && 'CallFriend' in a ? [a.CallFriend] : [])));
  const mighty = $derived(mightyCard(contract.trump));

  function sameCall(a: FriendCall, b: FriendCall): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /** The calls people make most: the mighty, the jokers, the top trump, the first trick, nobody. */
  const shortcuts = $derived.by(() => {
    const out: { call: FriendCall; label: string }[] = [];
    const add = (call: FriendCall, label: string) => {
      const mine = typeof call === 'object' && 'Card' in call && hand.some((h) => sameCard(h, call.Card));
      if (!mine && calls.some((c) => sameCall(c, call)) && !out.some((o) => sameCall(o.call, call))) out.push({ call, label });
    };
    add({ Card: mighty }, '마이티');
    add({ Card: { Joker: 'Black' } }, twoJokers ? '흑조커' : '조커');
    add({ Card: { Joker: 'Red' } }, '홍조커');
    if (contract.trump) add({ Card: { Normal: [contract.trump, 14] } }, `기루다 A`);
    if (contract.trump) add({ Card: { Normal: [contract.trump, 13] } }, `기루다 K`);
    add('FirstTrick', '첫 라운드');
    add('Alone', '노프렌드');
    return out;
  });

  const cardCalls: CardT[] = $derived(
    calls
      .flatMap((c) => (typeof c === 'object' && 'Card' in c ? [c.Card] : []))
      .filter((card) => !hand.some((h) => sameCard(h, card)))
      .sort((a, b) => order(a) - order(b)),
  );
  const otherCalls = $derived(calls.filter((c) => typeof c === 'string' || 'Seat' in c));

  function order(card: CardT): number {
    if ('Joker' in card) return card.Joker === 'Black' ? 0 : 1;
    const [suit, rank] = card.Normal;
    return 10 + SUITS.indexOf(suit) * 20 + (14 - rank);
  }

  let call = $state<FriendCall | null>(null);
  let picking = $state(false);
  const chosenCall = $derived(call && calls.some((c) => sameCall(c, call!)) ? call : (shortcuts[0]?.call ?? calls[0] ?? null));

  function changedCount(t: Suit | null): number {
    const bonus = (x: Suit | null) => (x === null ? rules.bidding.no_trump_bonus : 0);
    return contract.count + rules.bidding.change_trump_cost + bonus(contract.trump) - bonus(t);
  }
</script>

{#if calls.length > 0}
  <div class="panel">
    <div class="chips" role="radiogroup" aria-label="프렌드">
      {#each shortcuts as s (JSON.stringify(s.call))}
        <button
          class="chip"
          role="radio"
          aria-checked={chosenCall !== null && sameCall(chosenCall, s.call)}
          onclick={() => {
            call = s.call;
            picking = false;
          }}>{s.label}</button
        >
      {/each}
      <button class="chip" aria-pressed={picking} onclick={() => (picking = !picking)}>다른 카드…</button>
    </div>
    {#if picking}
      <div class="picker">
        <div class="grid">
          {#each cardCalls as card (JSON.stringify(card))}
            <Card
              {card}
              size="mini"
              {twoJokers}
              seal={sealOf(card, rules, contract.trump)}
              raised={chosenCall !== null && sameCall(chosenCall, { Card: card })}
              onclick={() => (call = { Card: card })}
            />
          {/each}
        </div>
        {#if otherCalls.length > 0}
          <div class="chips">
            {#each otherCalls as c (JSON.stringify(c))}
              <button class="chip" role="radio" aria-checked={chosenCall !== null && sameCall(chosenCall, c)} onclick={() => (call = c)}>
                {friendCallLabel(c, seatName, twoJokers)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <div class="actions">
      <button class="primary" disabled={!chosenCall} onclick={() => chosenCall && onact({ CallFriend: chosenCall })}>
        {#if chosenCall && typeof chosenCall === 'object' && 'Card' in chosenCall && sameCard(chosenCall.Card, mighty)}
          프렌드 마이티 <span class="sub">({cardLabel(mighty)})</span>
        {:else}
          프렌드 {chosenCall ? friendCallLabel(chosenCall, seatName, twoJokers) : ''}
        {/if}
      </button>
    </div>
  </div>
{:else}
  <div class="panel">
    <div class="discard">
      <span class="count">{#key chosen}<strong class="bump">{chosen}</strong>{/key}/{toDiscard}</span>
      <span class="muted">버릴 카드를 고르세요</span>
      <button class="primary" class:ready={chosen === toDiscard} disabled={chosen !== toDiscard} onclick={ondiscard}>버리기</button>
    </div>
    {#if trumpChanges.length > 0}
      <div class="chips change">
        <span class="muted">기루다 변경</span>
        {#each trumpChanges as t (t ?? 'nt')}
          <button class="chip" onclick={() => onact({ ChangeTrump: t })}>{trumpLabel(t)} {changedCount(t)}</button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .chips {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    padding: 2px 2px 4px;
    scrollbar-width: none;
  }
  .picker {
    display: grid;
    gap: 8px;
    max-height: 40vh;
    overflow-y: auto;
    padding: 12px 2px 2px;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .actions .primary {
    flex: 1;
    max-width: 280px;
  }
  .sub {
    font-weight: 400;
    opacity: 0.8;
  }
  .discard {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .discard .muted {
    flex: 1;
    font-size: 14px;
  }
  .count {
    font-family: var(--font-display);
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }
  .change .muted {
    flex: none;
    font-size: 13px;
  }
  /* Enough cards chosen: the button wakes up once. */
  .ready {
    animation: ready 360ms var(--ease-settle);
  }
  @keyframes ready {
    0% {
      scale: 1;
    }
    40% {
      scale: 1.07;
    }
    100% {
      scale: 1;
    }
  }
</style>
