<script lang="ts">
  // 상황판 on one line, at the top of phones and tablets: the bid so far,
  // or the contract, the friend, the round and the points; between hands,
  // the rules this table plays (a tap opens them) and its turn limit.
  import { contractLabel } from '../cards';
  import SuitIcon, { SUIT_NAME } from '../../../SuitIcon.svelte';
  import SuitText from '../../../SuitText.svelte';
  import type { RoomView, Rules } from '../types';
  import Badge from '../../../ui/Badge.svelte';
  import RulesChip from '../../../ui/RulesChip.svelte';
  import Tally from './Tally.svelte';
  import type { HandView, Tag } from './view';
  import { innerWidth, innerHeight } from 'svelte/reactivity/window';
  import HudFlow from '../../../table/HudFlow.svelte';
  import EngineRow from '../../../table/EngineRow.svelte';
  import { statusHudPolicy } from '../../../table/hudLayout';

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
  const policy = $derived({...statusHudPolicy(innerWidth.current ?? 390, innerHeight.current ?? 844), short: (innerWidth.current ?? 390) > (innerHeight.current ?? 844) && (innerHeight.current ?? 844) <= 520});
  const items = $derived.by(() => {
    if (bidding) return [{ id: bidding.best ? 'best' : 'none' }, { id: bidding.best ? 'bidder' : 'minimum' }];
    if (contract) return [{ id: 'contract' }, ...(callLabel ? [{ id: 'friend' }] : []), ...(play ? [{ id: 'round' }] : []),
      ...(play || done ? [{ id: 'progress', full: policy.progressFull }] : [])];
    if (idle && room) return [{ id: 'rules' }, ...(room.table.turn_secs ? [{ id: 'timer' }] : []), ...(room.hands_played > 0 ? [{ id: 'hands' }] : [])];
    return [];
  });
</script>

<div class="status" aria-live="polite">
  <HudFlow {items} fill gapX={policy.gapX}>
  {#snippet children(id)}
    {#if id === 'best' && bidding?.best}
      <span class="item">최고 공약 <strong class="contract"><SuitText text={contractLabel(bidding.best[1])} /></strong></span>
    {:else if id === 'bidder' && bidding?.best}
      <span class="item">{seatName(bidding.best[0])}</span>
    {:else if id === 'none'}
      <span class="item">공약 없음</span>
    {:else if id === 'minimum'}
      <span class="item">최소 {hand.lastChance ?? rules.bidding.min}</span>
    {:else if id === 'contract' && contract}
      <div class="item"><EngineRow items={[{id:'label'},{id:'contract'}]} gap={4}>
        {#snippet children(part)}{#if part==='label'}<span>공약</span>{:else}<div class="contract"><EngineRow items={[{id:'glyph'},{id:'count'}]} gap={3}>
          {#snippet children(piece)}{#if piece==='glyph'}{#if contract.trump}<SuitIcon suit={contract.trump} size="16px" label={SUIT_NAME[contract.trump]} />{:else}<span>노기루다</span>{/if}{:else}<span>{contract.count}</span>{/if}{/snippet}
        </EngineRow></div>{/if}{/snippet}
      </EngineRow></div>
    {:else if id === 'friend'}<span class="item">프렌드 <strong><SuitText text={callLabel ?? ''} /></strong></span>
    {:else if id === 'round'}<span class="item">라운드 <strong>{trickNo}/{rules.hand_size}</strong></span>
    {:else if id === 'progress' && contract}
      <div class="item meter"><EngineRow fill={policy.progressFull} nowrap={!policy.progressFull} gap={8} rowGap={2} justify={policy.progressFull?'center':'start'}
        items={[{id:'label'}, ...(policy.short ? [] : [{id:'tally', ...(policy.progressFull ? {width:'fill' as const,minWidth:160,maxWidth:320}: {})}]), ...tags.map(t=>({id:`tag:${t.text}`}))]}>
        {#snippet children(part)}{#if part==='label'}<span class="meter-label">여당 {#key hand.teamPoints}<strong class="bump">{hand.teamPoints}/{contract.count}</strong>{/key}</span>
        {:else if part==='tally'}<Tally tally={hand.tally} goal={contract.count} wide={policy.progressFull} />
        {:else}{@const tag=tags.find(t=>`tag:${t.text}`===part)}{#if tag}<Badge kind="tag" tone={tag.tone} class="pop">{tag.text}</Badge>{/if}{/if}{/snippet}
      </EngineRow></div>
    {:else if id === 'rules'}
    <RulesChip name={rulesName} onclick={onrules} />
    {:else if id === 'timer' && room}<span class="item">턴 <strong>{room.table.turn_secs}</strong>초</span>
    {:else if id === 'hands' && room}<span class="item"><strong>{room.hands_played}</strong>판 끝</span>
    {/if}
  {/snippet}
  </HudFlow>
</div>

<style>
  .status {
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
  .contract { font-size: var(--text-title); color:var(--ink); font-family:var(--font-display);font-weight:800; }
  .meter-label {
    white-space: nowrap;
  }
  @media (orientation: landscape) and (max-height: 520px) {
    .status { font-size: 12px; }
    .contract { font-size: 16px; }
  }
</style>
