<script lang="ts">
  import {capacityAllows} from './capacity';
  import EngineFlow from '../table/EngineFlow.svelte';
  import { tableCoordinates } from '../table/coordinateContext';
  import { createFrameMeasurements } from '../table/frameMeasurements';
  import { lobbyLayout } from '../table/lobbyLayout';
  import type { SeatCount } from '../table/layout';
  import { onDestroy } from 'svelte';
  import { preparation } from './readiness';
  import { IntentGuard } from '../ui/intentGuard.svelte';
  // Between hands the middle of the table holds what comes next: 시작 (or
  // 다음 판) once every seat is filled, 섞기 and 설정; for a watcher, how to
  // sit down; while swapping, which seat to pick.
  import Icon from '../Icon.svelte';
  import type { GameTypes, RoomViewOf } from './types';
  import Button from '../ui/Button.svelte';

  let {
    room,
    seated,
    swapping,
    sitName,
    shuffleNote,
    onadvance,
    me,
    onshuffle,
    onsettings,
    oncancelswap,
  }: {
    room: RoomViewOf<GameTypes>;
    seated: boolean;
    /** Picking the seat to swap with. */
    swapping: boolean;
    /** The name a watcher sits down with, if known. */
    sitName: string;
    /** What everyone is told about the next shuffle. */
    shuffleNote: string | null;
    onadvance: () => void;
    me: number | null;
    onshuffle: (on: boolean) => void;
    onsettings?: () => void;
    oncancelswap: () => void;
  } = $props();

  const emptySeats = $derived(room.seats.filter((s) => s.kind === 'empty').length);
  const full = $derived(emptySeats === 0);
  const prep = $derived(preparation(room, me));
  const startGuard = new IntentGuard();
  $effect(() => startGuard.update(!prep.solo && !!room?.ready && prep.allReady));
  onDestroy(() => startGuard.close());
  let host: HTMLDivElement;
  const shared=tableCoordinates();
  const measurements=shared?.measurements??createFrameMeasurements(()=>host);
  let metrics=$state({viewport:{width:390,height:844},region:{x:0,y:0,width:0,height:0}});
  let contentHeight=$state(0);
  let seats=$state<readonly {id:string;bounds:{x:number;y:number;width:number;height:number}}[]>([]);
  $effect(()=>{
    const parent=host?.parentElement;
    if(!parent)return;
    return measurements.observeRegion(parent,next=>metrics=next);
  });
  $effect(()=>shared?.bounds.subscribe(next=>seats=next));
  $effect(()=>{
    const content=host?.querySelector<HTMLElement>('.lobby-content');
    if(content)return measurements.observeSize(content,size=>contentHeight=size.height);
  });
  const arenaSeatWidth=$derived(seats.find(node=>node.id.startsWith('player:')&&node.bounds.y>=metrics.region.y&&node.bounds.y<metrics.region.y+metrics.region.height)?.bounds.width);
  const geometry=$derived(lobbyLayout(metrics.viewport,metrics.region,room.seats.length as SeatCount,contentHeight,arenaSeatWidth,seated));
  const parts=$derived(swapping?['note','cancel']:seated?full?['advance',...(prep.waiting?['waiting']:[]),'tools']:['note']:[]);
  onDestroy(()=>{if(!shared)measurements.dispose();});
</script>

<div class="centre" bind:this={host} style:left={`${geometry.x}px`} style:top={`${geometry.y}px`} style:width={`${geometry.width}px`} data-engine-layout="lobby">
  <EngineFlow class="lobby-content" items={parts.map(id=>({id,...(id==='advance'?{width:geometry.goWidth}:id==='tools'?{width:geometry.toolsWidth}:id==='note'||id==='waiting'?{width:'fill' as const}:{})}))} fill direction={geometry.direction} justify="center" gap={geometry.gap}>
    {#snippet children(id)}
      {#if id==='note'}<p class="note">{#if swapping}바꿀 자리를 누르세요{:else}빈 자리 <strong>{emptySeats}</strong>개{/if}</p>
      {:else if id==='cancel'}<Button onclick={oncancelswap}>취소</Button>
      {:else if id==='advance'}<button class="btn primary go" style:width={`${geometry.goWidth}px`} style:min-height={`${geometry.goHeight}px`} style:font-size={`${geometry.goFont}px`} disabled={prep.pending || (prep.solo||prep.allReady)&&!capacityAllows(room,'can_start') || (!prep.solo && prep.allReady && startGuard.blocked)} onclick={onadvance}>{prep.pending ? '자리 확인 중' : prep.solo || prep.allReady ? room.hands_played === 0 ? '시작' : '다음 판' : prep.mineReady ? '준비 취소' : '준비하기'}</button>
      {:else if id==='waiting'}<p class="sub">{prep.waiting}</p>
      {:else if id==='tools'}<div style:width={`${geometry.toolsWidth}px`}><EngineFlow fill items={[{id:'shuffle',width:geometry.toolWidth},{id:'settings',width:geometry.toolWidth}]} gap={8}>
        {#snippet children(tool)}<button class="btn tool" class:on={tool==='shuffle'&&room.table.shuffle} style:width={`${geometry.toolWidth}px`} style:min-height={`${geometry.toolHeight}px`}
          aria-pressed={tool==='shuffle'?room.table.shuffle:undefined}
          aria-label={tool==='shuffle'?room.table.shuffle?'섞기 끄기: 매 판 자리 섞기 켜짐':'섞기 켜기: 매 판 시작할 때 자리를 섞어요':'설정'}
          onclick={()=>tool==='shuffle'?onshuffle(!room.table.shuffle):onsettings?.()}>
          <EngineFlow fill direction="column" gap={2} items={[{id:'icon',width:'fill'},{id:'label',width:'fill'}]}>
            {#snippet children(leaf)}{#if leaf==='icon'}<EngineFlow fill justify="center" items={[{id:'art'}]}>{#snippet children()}<Icon name={tool==='shuffle'?'shuffle':'sliders'} size="22px" />{/snippet}</EngineFlow>{:else}<span>{tool==='shuffle'?`섞기${room.table.shuffle?' 켜짐':''}`:'설정'}</span>{/if}{/snippet}
          </EngineFlow>
        </button>{/snippet}
      </EngineFlow></div>{/if}
    {/snippet}
  </EngineFlow>
  {#if shuffleNote}<p class="sub shuffle-note" role="status" style:left={`${(geometry.width-geometry.noteWidth)/2}px`} style:top={`${geometry.noteY}px`} style:width={`${geometry.noteWidth}px`}>{shuffleNote}</p>{/if}
</div>

<style>
  .centre { position:absolute; z-index:4; text-align:center; pointer-events:none; animation:fade-up 240ms var(--ease-standard) both; }
  .centre :global(button) { pointer-events:auto; }
  :global(:root[data-motion='reduced']) .centre { animation-name:fade; }
  .note,.sub { margin:0; font-size:14px; font-weight:600; color:var(--ink-muted); text-wrap:balance; }
  .sub { font-size:var(--text-label); font-weight:400; }
  .note strong { color:var(--ink); }
  .tool { display:block; padding:6px 8px 5px; font-size:var(--text-caption); }
  .tool.on { background:var(--ink); color:var(--table); box-shadow:0 1px 0 var(--btn-lip); translate:0 2px; }
  .shuffle-note { position:absolute; color:var(--ink); font-weight:600; }
</style>
