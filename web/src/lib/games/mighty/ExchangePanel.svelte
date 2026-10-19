<script lang="ts">
  // The declarer's strip during the exchange: put cards back, maybe change
  // trump or raise the contract, then name the friend.
  import DecisionRegion from '../../table/DecisionRegion.svelte';
  import { tick, untrack } from 'svelte';
  import Sheet from '../../ui/Sheet.svelte';
  import Button from '../../ui/Button.svelte';
  import Card from './Card.svelte';
  import CommandButton from '../../table/CommandButton.svelte';
  import { commandForPayload, commandSpecs, type ActionOffer } from '../../table/presentation';
  import { cardLabel, contractLabel, friendCallLabel, mightyCard, sameCard, sealOf, SUITS, trumpLabel } from './cards';
  import SuitText from '../../SuitText.svelte';
  import Chip from '../../ui/Chip.svelte';
  import type { Action, Card as CardT, Contract, ContractChange, FriendCall, Rules, Suit } from './types';

  let {
    offer,
    contract,
    contracts,
    rules,
    toDiscard,
    chosen,
    chosenRevision,
    hand,
    seatName,
    onact,
    ondiscard,
  }: {
    offer: ActionOffer<Action>;
    contract: Contract;
    /** What each trump change or raise sets, as the server works it out. */
    contracts: ContractChange[];
    rules: Rules;
    toDiscard: number;
    chosen: number;
    chosenRevision?: string | null;
    /** Calling a card you hold is allowed but rarely meant, so it is not offered first. */
    hand: CardT[];
    seatName: (seat: number) => string;
    onact: (a: Action, expectedOfferId: string) => void;
    ondiscard: (expectedOfferId: string) => void;
  } = $props();

  const twoJokers = $derived(rules.deck === 'TwoJokers');
  const legal = $derived(commandSpecs(offer).filter(spec => spec.enabled).map(spec => spec.action));
  const discardCommand = $derived(commandSpecs(offer).find(spec => spec.enabled && typeof spec.action === 'object' && 'Discard' in spec.action) ?? null);
  const batchCurrent = $derived(chosenRevision === undefined || chosenRevision === offer.id);
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
  let draftCall = $state<FriendCall | null>(null);
  let draftRevision = $state<string | null>(null);
  let pickerOpener: HTMLElement | null = null;
  function openPicker(opener: HTMLElement) { pickerOpener = opener; draftCall = chosenCall; draftRevision = offer.id; picking = true; }
  function closePicker() { picking = false; void tick().then(() => { if (pickerOpener?.isConnected) pickerOpener.focus(); }); }
  function confirmPicker(action: Action, expectedOfferId: string) {
    if (!draftCall || draftRevision !== offer.id || expectedOfferId !== draftRevision) return;
    call = draftCall; onact(action, expectedOfferId); closePicker();
  }
  const draftMine = $derived(draftCall !== null && typeof draftCall === 'object' && 'Card' in draftCall && isMine(draftCall.Card));
  const chosenCall = $derived(call && calls.some((c) => sameCall(c, call!)) ? call : (shortcuts[0]?.call ?? calls[0] ?? null));
  const callsMine = $derived(
    chosenCall !== null && typeof chosenCall === 'object' && 'Card' in chosenCall && isMine(chosenCall.Card),
  );
  const chosenCallCommand = $derived(chosenCall ? commandForPayload(offer, {CallFriend:chosenCall}) : null);
  const draftCallCommand = $derived(draftCall ? commandForPayload(offer, {CallFriend:draftCall}) : null);
  const chosenCallLabel = $derived(chosenCall && typeof chosenCall === 'object' && 'Card' in chosenCall && sameCard(chosenCall.Card, mighty)
    ? `프렌드 마이티 (${cardLabel(mighty)})${callsMine ? ' (내 카드)' : ''}`
    : `프렌드 ${chosenCall ? friendCallLabel(chosenCall, seatName, twoJokers) : ''}${callsMine ? ' (내 카드)' : ''}`);
  const draftCallLabel = $derived(`프렌드 ${draftCall ? friendCallLabel(draftCall, seatName, twoJokers) : ''}${draftMine ? ' (내 카드)' : ''}`);

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
  const choiceCommand = $derived(choice ? commandForPayload(offer, choice) : null);
  const discardOffer = $derived<ActionOffer<Action>>({id:`${offer.id}:discard:${choice ? JSON.stringify(choice) : 'plain'}`,actions:offer.actions.map(spec => spec.id === discardCommand?.id ? {...spec,intent:choice ? 'secondary' : 'primary'} : spec)});
  let observedRevision = $state(untrack(() => offer.id));
  $effect(() => {
    if (observedRevision === offer.id) return;
    observedRevision = offer.id;
    call = null;
    selected = null;
    target = undefined;
    draftCall = null;
    draftRevision = null;
    if (picking) closePicker();
  });

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
  <DecisionRegion class="panel" mode="stack" gap={8}>
    <DecisionRegion class="chips" mode="row" scroll role="radiogroup" label="프렌드" gap={6}>
      {#each shortcuts as s (JSON.stringify(s.call))}
        <Chip
          checked={chosenCall !== null && sameCall(chosenCall, s.call)}
          onclick={() => {
            call = s.call;
            picking = false;
          }}>{s.label}</Chip
        >
      {/each}
      <Chip pressed={picking} aria-haspopup="dialog" onclick={(event) => openPicker(event.currentTarget)}>다른 카드…</Chip>
    </DecisionRegion>
    <DecisionRegion class="actions" mode="actions" align="end" gap={8}>
      <CommandButton {offer} actionId={chosenCallCommand?.id ?? null} label={chosenCallLabel} onaction={onact}>
        {#if chosenCall && typeof chosenCall === 'object' && 'Card' in chosenCall && sameCard(chosenCall.Card, mighty)}
          프렌드 마이티 <span class="sub">(<SuitText text={cardLabel(mighty)} />)</span>
        {:else}
          프렌드 <SuitText text={chosenCall ? friendCallLabel(chosenCall, seatName, twoJokers) : ''} />
        {/if}
        {#if callsMine}<span class="sub">(내 카드)</span>{/if}
      </CommandButton>
    </DecisionRegion>
  </DecisionRegion>
{:else}
  {@const baseOfferId = offer.id}
  <DecisionRegion class="panel exchange" mode="exchange" gap={8}>
    <DecisionRegion class="discard" mode="discard" gap={10}>
      <span class="count">{#key chosen}<strong class="bump">{chosen}</strong>{/key}/{toDiscard}</span>
      <span class="muted">버릴 카드를 고르세요</span>
      {#if confirm && choice}<DecisionRegion class="desktop-confirm" mode="actions"><CommandButton {offer} actionId={choiceCommand?.id ?? null} label={confirm} onaction={onact}><SuitText text={confirm} /></CommandButton></DecisionRegion>{/if}
      <!-- While a contract change is chosen, its button is the one to press. -->
      <DecisionRegion class="discard-btn" mode="actions"><CommandButton offer={discardOffer} actionId={discardCommand?.id ?? null} label="버리기" blocked={chosen !== toDiscard || !batchCurrent} onaction={(_action, expectedOfferId) => { if (expectedOfferId === discardOffer.id) ondiscard(baseOfferId); }} /></DecisionRegion>
    </DecisionRegion>
    <DecisionRegion class="contract-controls" mode="stack" gap={8}>
    {#if trumpChanges.length > 0 && raises.length > 0}
      <DecisionRegion class="chips change" mode="row" scroll fade role="radiogroup" label="기루다 변경" gap={6}>
        <span class="muted">기루다 변경</span>
        {#each trumpChanges as t (t ?? 'nt')}
          <Chip
            checked={t === picked}
            onclick={() => {
              target = t === picked ? undefined : t;
              selected = null;
            }}
          >
            <SuitText text="{trumpLabel(t)} {changedCount(t)}" />
          </Chip>
        {/each}
      </DecisionRegion>
    {:else if trumpChanges.length > 0}
      <DecisionRegion class="chips change" mode="row" scroll fade role="radiogroup" label="기루다 변경" gap={6}>
        <span class="muted">기루다 변경</span>
        {#each trumpChanges as t (t ?? 'nt')}
          {@const action = { ChangeTrump: t }}
          <Chip checked={!!choice && same(choice, action)} onclick={() => select(action)}>
            <SuitText text="{trumpLabel(t)} {changedCount(t)}" />
          </Chip>
        {/each}
      </DecisionRegion>
    {/if}
    {#if offers.length > 0}
      <DecisionRegion class="chips change" mode="row" scroll fade role="radiogroup" label={picked === contract.trump ? '공약 올리기' : '바꿀 공약'} gap={6}>
        <span class="muted">{picked === contract.trump ? '공약 올리기' : `${trumpLabel(picked)}로 바꾸기`}</span>
        {#each offers as o (JSON.stringify(o.action))}
          <Chip checked={!!choice && same(choice, o.action)} onclick={() => select(o.action)}>
            <SuitText text={contractLabel(o.contract)} />
          </Chip>
        {/each}
      </DecisionRegion>
    {/if}
    </DecisionRegion>
    {#if confirm && choice}
      <DecisionRegion class="actions contract-confirm" mode="actions" align="end">
        <CommandButton {offer} actionId={choiceCommand?.id ?? null} label={confirm} onaction={onact}><SuitText text={confirm} /></CommandButton>
      </DecisionRegion>
    {/if}
  </DecisionRegion>
{/if}

{#if picking}
<Sheet size="large" title="프렌드 카드 선택" focus="title" onclose={closePicker}>
      <DecisionRegion class="picker" mode="stack" gap={8}>
        <DecisionRegion class="grid" mode="flow" gap={10}>
          {#each cardCalls as card (JSON.stringify(card))}
            <Card
              {card}
              size="mini"
              width={44}
              {twoJokers}
              seal={sealOf(card, rules, contract.trump)}
              selected={draftCall !== null && sameCall(draftCall, { Card: card })}
              stationary
              onclick={() => (draftCall = { Card: card })}
            />
          {/each}
        </DecisionRegion>
        {#if ownCalls.length > 0}
          <p class="own-head muted">내 카드 · 부르면 혼자 하지만, 아무도 몰라요</p>
          <DecisionRegion class="grid" mode="flow" gap={10}>
            {#each ownCalls as card (JSON.stringify(card))}
              <Card
                {card}
                size="mini"
              width={44}
                {twoJokers}
                seal={sealOf(card, rules, contract.trump)}
                selected={draftCall !== null && sameCall(draftCall, { Card: card })}
                stationary
                onclick={() => (draftCall = { Card: card })}
              />
            {/each}
          </DecisionRegion>
        {/if}
        {#if otherCalls.length > 0}
          <DecisionRegion class="chips" mode="flow" gap={6}>
            {#each otherCalls as c (JSON.stringify(c))}
              <Chip checked={draftCall !== null && sameCall(draftCall, c)} onclick={() => (draftCall = c)}>
                <SuitText text={friendCallLabel(c, seatName, twoJokers)} />
              </Chip>
            {/each}
          </DecisionRegion>
        {/if}
      </DecisionRegion>
      <p class="own-warning" class:inactive={!draftMine} aria-hidden={!draftMine}>내 카드를 프렌드로 부르면 혼자 플레이해요.</p>
      {#snippet footer()}
        <DecisionRegion mode="actions" gap={8} align="end">
        <Button onclick={closePicker}>취소</Button>
        <CommandButton {offer} actionId={draftCallCommand?.id ?? null} label={draftCallLabel} blocked={draftRevision !== offer.id} onaction={confirmPicker}>프렌드 <SuitText text={draftCall ? friendCallLabel(draftCall, seatName, twoJokers) : ''} />{#if draftMine}<span class="sub">(내 카드)</span>{/if}</CommandButton>
        </DecisionRegion>
      {/snippet}
    </Sheet>
{/if}

<style>
  .own-warning { color:var(--gold);font-size:13px; }
  .own-warning.inactive { visibility:hidden; }
  .own-head { margin:0; font-size:var(--text-label); }
  .sub { font-weight:400;opacity:.8; }
  .count { font-family:var(--font-display); font-size:20px; font-variant-numeric:tabular-nums; }
  .muted { font-size:var(--text-label); }
</style>
