<script lang="ts">
  // 상황판 on one line, at the top of phones and tablets: the bid so far,
  // or the contract, the friend, the round and the points; between hands,
  // the rules this table plays (a tap opens them) and its turn limit.
  import { contractLabel } from '../cards';
  import SuitIcon, { SUIT_NAME } from '../../../SuitIcon.svelte';
  import SuitText from '../../../SuitText.svelte';
  import type { RoomView, Rules } from '../types';
  import Badge from '../../../ui/Badge.svelte';
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
    room,
    idle,
    rulesName,
    onrules,
  }: {
    hand: HandView;
    rules: Rules;
    trickNo: number;
    tags: Tag[];
    callLabel: string | null;
    seatName: (seat: number) => string;
    room: RoomView | null;
    /** No hand on the table: between hands. */
    idle: boolean;
    rulesName: string;
    onrules?: () => void;
  } = $props();

  const { bidding, contract, play, done } = $derived(hand);
</script>

<div class="status" aria-live="polite">
  {#if bidding}
    {#if bidding.best}
      <span class="item">최고 공약 <strong class="contract"><SuitText text={contractLabel(bidding.best[1])} /></strong></span>
      <span class="item">{seatName(bidding.best[0])}</span>
    {:else}
      <span class="item">공약 없음</span>
      <span class="item">최소 {hand.lastChance ?? rules.bidding.min}</span>
    {/if}
  {:else if contract}
    <span class="item">
      공약
      <strong class="contract">
        {#if contract.trump}<SuitIcon suit={contract.trump} size="16px" label={SUIT_NAME[contract.trump]} />{:else}노기루다{/if}
        {contract.count}
      </strong>
    </span>
    {#if callLabel}<span class="item">프렌드 <strong><SuitText text={callLabel} /></strong></span>{/if}
    {#if play}<span class="item">라운드 <strong>{trickNo}/{rules.hand_size}</strong></span>{/if}
    {#if play || done}
      <span class="item meter">
        <span class="meter-label">여당 {#key hand.teamPoints}<strong class="bump">{hand.teamPoints}/{contract.count}</strong>{/key}</span>
        <Tally tally={hand.tally} goal={contract.count} />
        {#each tags as t (t.text)}<Badge kind="tag" tone={t.tone} class="pop">{t.text}</Badge>{/each}
      </span>
    {/if}
  {:else if idle && room}
    <!-- No hand yet: the rules this table plays, a tap opens them. -->
    <RulesChip name={rulesName} onclick={onrules} />
    {#if room.table.turn_secs}<span class="item">턴 <strong>{room.table.turn_secs}</strong>초</span>{/if}
    {#if room.hands_played > 0}<span class="item"><strong>{room.hands_played}</strong>판 끝</span>{/if}
  {/if}
</div>

<style>
  .status {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    align-content: center;
    gap: 2px 14px;
    min-width: 0;
    height: 100%;
    font-size: clamp(14px, 1.7vw, 16px);
    color: var(--ink-muted);
  }
  strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .contract {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--text-title);
  }
  /* The point cards as twenty ticks, the contract marked between them. */
  .meter {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .meter-label {
    white-space: nowrap;
  }
  /* On phones the tally takes its own row, as wide as the row allows. */
  @media (max-width: 599px) {
    .meter {
      flex: 1 1 100%;
      flex-wrap: wrap;
      justify-content: center;
      row-gap: 2px;
    }
  }
</style>
