<script lang="ts">
  import ActionPanel from './ActionPanel.svelte';
  import Button from '../ui/Button.svelte';
  import Chip from '../ui/Chip.svelte';
  import CardView from '../ui/cards/CardView.svelte';
  import { projectMighty } from '../games/mighty/presentation';
  import { presetRules } from '../games/mighty/catalog';
  import type { Action, StateMsg } from '../games/mighty/types';
  import { createPokerPresentation, POKER_EXAMPLE, type PokerAction } from './examples/poker';

  let observing = $state(false);
  let blocked = $state(false);
  let revised = $state(false);
  let sent = $state<{ game: 'mighty' | 'poker'; action: Action | PokerAction }[]>([]);
  const mightyPlayers = Array.from({ length:5 }, (_, seat) => ({ id:`mighty-player-${seat}`, seat, label:seat === 0 ? '나' : `플레이어 ${seat + 1}` }));
  const mightyState: StateMsg = {
    view: { viewer:{Seat:0}, rules:presetRules('gshs'), first_bidder:0, hand:[{Normal:['Spade',14]}], hand_sizes:[1,1,1,1,1], points_taken:[[],[],[],[],[]],
      phase:{Play:{declarer:0,contract:{trump:null,count:14},call:'Alone',friend:null,no_friend:true,trick_no:0,leader:0,lead:null,plays:[],leading:null,called_joker:null,tricks:[],discards:null}}, bids:[], redealt:null },
    legal:[{Play:{card:{Normal:['Spade',14]},joker_lead:null,call_joker:false}}],turn:{Seat:0},out_of_turn:[],grace_ms:0,version:1,notes:{unplayable:[],contracts:[]},
  };
  const mighty = $derived(projectMighty(observing ? {...mightyState,view:{...mightyState.view,viewer:'Spectator',hand:[]},legal:[],out_of_turn:[]} : mightyState, {viewer:observing ? null : 0,players:mightyPlayers,active:!observing}));
  const pokerSnapshot = $derived.by(() => {
    const raise = revised ? {min:200,max:500,step:25,initial:200} : POKER_EXAMPLE.legal.raise;
    return {...POKER_EXAMPLE,viewerId:observing ? null : POKER_EXAMPLE.viewerId,offerId:`example:${revised ? 'turn:8' : 'flop:7'}`,
      legal:{...POKER_EXAMPLE.legal,raise:raise ? {...raise,enabled:!blocked,reason:blocked ? '이번 차례에는 레이즈할 수 없어요.' : undefined} : null}};
  });
  const poker = $derived(createPokerPresentation(pokerSnapshot));
  function mightyAction(action: Action) { if (!observing) sent.push({game:'mighty',action}); }
  function pokerAction(action: PokerAction) { if (!observing && !(blocked && action.kind === 'raise')) sent.push({game:'poker',action}); }
</script>

<main class="contract-demo" data-contract-demo>
  <header><h1>표현 계약 데모</h1><p>마이티의 실제 프런트엔드 투영과 포커 예시를 같은 행동 패널로 보여줘요. 실제 게임이나 베팅을 실행하지 않아요.</p></header>
  <nav class="demo-controls" aria-label="데모 조건">
    <Chip pressed={observing} onclick={() => observing = !observing}>관전 모드</Chip>
    <Chip pressed={blocked} onclick={() => blocked = !blocked}>레이즈 잠금</Chip>
    <Button variant="secondary" onclick={() => revised = !revised}>선택지 갱신</Button>
  </nav>
  <div class="gallery">
    <section data-game="mighty" aria-label="마이티 투영">
      <h2>마이티 · 카드 내기</h2><p>{observing ? '관전 중' : mighty.status}</p>
      {#each mighty.zones as zone (zone.id)}
        {@const cards = mighty.cards.filter(card => card.zoneId === zone.id)}
        {#if cards.length}<div class="zone"><h3>{zone.label}</h3><ul class="cards">{#each cards as card (card.id)}<li data-card={card.id} data-face={card.face}><CardView {card} /></li>{/each}</ul></div>{/if}
      {/each}
      <ActionPanel offer={mighty.offer} onaction={mightyAction} label="마이티 행동" />
      {#if observing}<p>관전자에게는 행동을 제시하지 않아요.</p>{/if}
    </section>
    <section data-game="poker" aria-label="포커 예시">
      <h2>포커 · 베팅 예시</h2><p>{observing ? '관전 중' : poker.status}</p>
      <ul class="counters">{#each poker.players as player (player.id)}<li>{player.name} {#each player.counters ?? [] as counter}<span>{counter.label} {counter.value}</span>{/each}</li>{/each}</ul>
      {#each poker.zones as zone (zone.id)}
        <div class="zone"><h3>{zone.label}</h3><ul class="cards">{#each poker.cards.filter(card => card.zoneId === zone.id) as card (card.id)}<li data-face={card.face} data-card={card.id}><CardView {card} /></li>{/each}</ul></div>
      {/each}
      <ActionPanel offer={poker.offer} onaction={pokerAction} label="포커 행동" />
      {#if observing}<p>관전자에게는 행동을 제시하지 않아요.</p>{/if}
    </section>
  </div>
  <section class="dispatches" aria-label="데모 행동 기록"><h2>선택한 행동</h2><output aria-live="polite" data-dispatch-count={sent.length}>{sent.length}회</output><ol>{#each sent as entry, index (index)}<li data-dispatch={entry.game}><code>{JSON.stringify(entry.action)}</code></li>{/each}</ol></section>
</main>

<style>
  .contract-demo { padding:var(--space-4); max-width:1100px; margin-inline:auto; }
  header { margin-bottom:var(--space-4); }
  .demo-controls { display:flex; flex-wrap:wrap; gap:var(--space-2); margin-bottom:var(--space-5); }
  .gallery { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-5); }
  .gallery > section { min-width:0; }
  .zone { margin-block:var(--space-3); }
  .cards,.counters { display:flex; flex-wrap:wrap; gap:var(--space-3); padding:0; list-style:none; }
  .counters span { margin-left:var(--space-1); }
  .dispatches { margin-top:var(--space-5); }
  code { overflow-wrap:anywhere; }
  @media (max-width:700px) { .gallery { grid-template-columns:minmax(0,1fr); } }
</style>
