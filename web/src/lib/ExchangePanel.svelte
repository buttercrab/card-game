<script lang="ts">
  // The declarer's strip during the exchange: put cards back, maybe change
  // trump or raise the contract, then name the friend.
  import Card from './Card.svelte';
  import { cardLabel, contractLabel, friendCallLabel, mightyCard, sameCard, sealOf, SUITS, trumpLabel } from './cards';
  import { scrollFade } from './scrollFade';
  import type { Action, Card as CardT, Contract, ContractChange, FriendCall, Rules, Suit } from './types';

  let {
    legal,
    contract,
    contracts,
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
    /** What each trump change or raise sets, as the server works it out. */
    contracts: ContractChange[];
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

  const allCardCalls: CardT[] = $derived(
    calls.flatMap((c) => (typeof c === 'object' && 'Card' in c ? [c.Card] : [])).sort((a, b) => order(a) - order(b)),
  );
  const isMine = (card: CardT) => hand.some((h) => sameCard(h, card));
  const cardCalls = $derived(allCardCalls.filter((card) => !isMine(card)));
  /** Your own cards, when the rules allow naming one: a 가짜 프렌드, playing
   * alone while the table thinks you have a partner. */
  const ownCalls = $derived(allCardCalls.filter(isMine));
  const otherCalls = $derived(calls.filter((c) => typeof c === 'string' || 'Seat' in c));

  function order(card: CardT): number {
    if ('Joker' in card) return card.Joker === 'Black' ? 0 : 1;
    const [suit, rank] = card.Normal;
    return 10 + SUITS.indexOf(suit) * 20 + (14 - rank);
  }

  let call = $state<FriendCall | null>(null);
  let picking = $state(false);
  const chosenCall = $derived(call && calls.some((c) => sameCall(c, call!)) ? call : (shortcuts[0]?.call ?? calls[0] ?? null));
  const callsMine = $derived(
    chosenCall !== null && typeof chosenCall === 'object' && 'Card' in chosenCall && isMine(chosenCall.Card),
  );

  /** The contract's number after the least change to `t`, as the server
   * says it would be. */
  function changedCount(t: Suit | null): number {
    const change = contracts.find((c) => typeof c.action === 'object' && 'ChangeTrump' in c.action && c.action.ChangeTrump === t);
    return change?.contract.count ?? contract.count;
  }

  // Where the contract may also be raised (공약 올리기), a trump chip picks
  // the trump instead of changing at once, and the row under it offers the
  // contracts for that trump: the least change first, then every raise.
  const raises = $derived(legal.flatMap((a) => (typeof a === 'object' && 'Raise' in a ? [a.Raise] : [])));
  let target = $state<Suit | null | undefined>(undefined);
  const picked = $derived(target !== undefined && trumpChanges.includes(target) ? target : contract.trump);
  const offers = $derived.by(() => {
    const out: { action: Action; contract: Contract }[] = [];
    if (picked !== contract.trump) {
      out.push({ action: { ChangeTrump: picked }, contract: { trump: picked, count: changedCount(picked) } });
    }
    for (const c of raises.filter((r) => r.trump === picked).sort((a, b) => a.count - b.count)) {
      out.push({ action: { Raise: c }, contract: c });
    }
    return out;
  });

  // Changing the contract is a big step: a chip only selects it (a second
  // tap lets go), and the button under the chips says what it will do.
  let selected = $state<Action | null>(null);
  const same = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);
  const choice = $derived(selected && legal.some((a) => same(a, selected!)) ? selected : null);
  function select(action: Action) {
    selected = choice && same(choice, action) ? null : action;
  }

  /** 으로 or 로 after a number, as it is read: 16으로, 17로. */
  function ro(count: number): string {
    return [0, 3, 6].includes(count % 10) ? '으로' : '로';
  }
  const confirm = $derived.by(() => {
    if (!choice || typeof choice !== 'object') return null;
    if ('ChangeTrump' in choice) {
      const t = choice.ChangeTrump;
      const count = changedCount(t);
      return `${trumpLabel(t)} ${count}${ro(count)} 바꾸기`;
    }
    if ('Raise' in choice) {
      const c = choice.Raise;
      return c.trump === contract.trump ? `${c.count}${ro(c.count)} 올리기` : `${contractLabel(c)}${ro(c.count)} 바꾸기`;
    }
    return null;
  });
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
        {#if ownCalls.length > 0}
          <p class="own-head muted">내 카드 · 부르면 혼자 하지만, 아무도 몰라요</p>
          <div class="grid">
            {#each ownCalls as card (JSON.stringify(card))}
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
        {/if}
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
        {#if callsMine}<span class="sub">(내 카드)</span>{/if}
      </button>
    </div>
  </div>
{:else}
  <div class="panel">
    <div class="discard">
      <span class="count">{#key chosen}<strong class="bump">{chosen}</strong>{/key}/{toDiscard}</span>
      <span class="muted">버릴 카드를 고르세요</span>
      <!-- While a contract change is chosen, its button is the one to press. -->
      <button
        class:primary={!confirm}
        class="discard-btn"
        class:ready={chosen === toDiscard && !confirm}
        disabled={chosen !== toDiscard}
        onclick={ondiscard}>버리기</button
      >
    </div>
    {#if trumpChanges.length > 0 && raises.length > 0}
      <div class="chips change" use:scrollFade role="radiogroup" aria-label="기루다 변경">
        <span class="muted">기루다 변경</span>
        {#each trumpChanges as t (t ?? 'nt')}
          <button
            class="chip"
            role="radio"
            aria-checked={t === picked}
            onclick={() => {
              target = t === picked ? undefined : t;
              selected = null;
            }}
          >
            {trumpLabel(t)} {changedCount(t)}
          </button>
        {/each}
      </div>
    {:else if trumpChanges.length > 0}
      <div class="chips change" use:scrollFade role="radiogroup" aria-label="기루다 변경">
        <span class="muted">기루다 변경</span>
        {#each trumpChanges as t (t ?? 'nt')}
          {@const action = { ChangeTrump: t }}
          <button class="chip" role="radio" aria-checked={!!choice && same(choice, action)} onclick={() => select(action)}>
            {trumpLabel(t)} {changedCount(t)}
          </button>
        {/each}
      </div>
    {/if}
    {#if offers.length > 0}
      <div class="chips change" use:scrollFade role="radiogroup" aria-label={picked === contract.trump ? '공약 올리기' : '바꿀 공약'}>
        <span class="muted">{picked === contract.trump ? '공약 올리기' : `${trumpLabel(picked)}로 바꾸기`}</span>
        {#each offers as o (JSON.stringify(o.action))}
          <button class="chip num" role="radio" aria-checked={!!choice && same(choice, o.action)} onclick={() => select(o.action)}>
            {contractLabel(o.contract)}
          </button>
        {/each}
      </div>
    {/if}
    {#if confirm && choice}
      <div class="actions">
        <button class="primary confirm" onclick={() => onact(choice)}>{confirm}</button>
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
    /* Rows keep their full height and the picker scrolls; a scrolling chip
       row would otherwise be squeezed to half a chip. */
    grid-auto-rows: max-content;
    gap: 8px;
    /* What the window can spare above the tray and below the contract line;
       on a short window the picker scrolls rather than covering it. */
    max-height: min(40vh, max(120px, 100dvh - 560px));
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
  /* Inside the picker every choice shows, wrapped, rather than scrolling
     sideways in a box of its own. */
  .picker .chips {
    flex-wrap: wrap;
    overflow: visible;
  }
  .own-head {
    margin: 4px 0 0;
    font-size: var(--text-label);
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
  /* Not enough cards chosen yet: a plain, quiet button, not a faded plum. */
  .discard .primary:disabled {
    opacity: 1;
    background: var(--panel);
    color: var(--ink-muted);
    box-shadow: 0 3px 0 var(--line);
  }
  @media (min-width: 600px) {
    .panel {
      max-width: 760px;
      width: 100%;
      margin: 0 auto;
    }
  }
  .count {
    font-family: var(--font-display);
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }
  /* When the row runs past the screen, its right edge fades to say so. */
  .chips.change:global(.more) {
    mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  }
  .change .muted {
    flex: none;
    font-size: var(--text-label);
  }
  .num {
    font-variant-numeric: tabular-nums;
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
