<script lang="ts">
  import { onDestroy } from 'svelte';
  import HudResult from '../../../table/HudResult.svelte';
  import EngineFlow from '../../../table/EngineFlow.svelte';
  import { resultSurfacePolicy } from '../../../table/hudSurfacePolicy';
  import { innerWidth, innerHeight } from 'svelte/reactivity/window';
  import { tableCoordinates } from '../../../table/coordinateContext';
  import { createFrameMeasurements } from '../../../table/frameMeasurements';
  import HudActions from '../../../table/HudActions.svelte';
  import { IntentGuard } from '../../../ui/intentGuard.svelte';
  import { preparation } from '../../../room/readiness';
  import type { Achievement } from '../achievements';
  import type { RoomView } from '../types';
  import type { Team } from '../../../ui/Badge.svelte';
  import { resultOf, type Done } from './view';
  let { done, me, room, earned, inline = false, dock = false, onreplay, onadvance }: {
    done: Done; me: number | null; room: RoomView | null;
    seatName: (seat: number) => string; team: (seat: number) => Team | null; points: (seat: number) => number;
    earned: Achievement[]; inline?:boolean; dock?:boolean; seated: boolean; shuffleNote: string | null;
    onreplay: (done: Done) => void; onshare: () => void;
    onadvance: () => void;
  } = $props();
  const result = $derived(resultOf(done));
  const policy = $derived(resultSurfacePolicy(innerWidth.current??390,innerHeight.current??844,dock));
  const prep = $derived(preparation(room, me));
  const participated = $derived(me !== null && (!room?.current_hand || room.current_hand.participant_ids[me] === room.participant_ids?.[me]));
  const personal = $derived(participated && me !== null ? done.payoffs[me] : null);
  let summaryReady = $state(false), actionsReady = $state(false), stackReady = $state(false);
  let layer:HTMLDivElement, sheet:HTMLElement;
  const coordinates=tableCoordinates();
  const measurements=coordinates?.measurements??createFrameMeasurements(()=>layer);
  let layerSize=$state({width:0,height:0}),sheetSize=$state({width:0,height:0});
  $effect(()=>layer&&measurements.observeSize(layer,size=>{layerSize=size}));
  $effect(()=>sheet&&measurements.observeSize(sheet,size=>{sheetSize=size}));
  const frameReady=$derived(layerSize.width>0&&sheetSize.height>0&&Math.abs(layerSize.height-sheetSize.height)<=1&&Math.abs(layerSize.width-sheetSize.width)<=1);
  const reportStackReady = (ready:boolean) => { stackReady=ready; };
  let summaryHeight=$state(0),actionsHeight=$state(0);
  const reportSummaryReady = (ready: boolean,size:{width:number;height:number}) => { summaryReady = ready;summaryHeight=size.height; };
  const reportActionsReady = (ready: boolean,size:{width:number;height:number}) => { actionsReady = ready;actionsHeight=size.height; };
  const entryGuard = new IntentGuard();
  // The last card and the newly revealed continuation share a hand-region surface.
  // A deliberate new gesture is required even when animation is disabled.
  entryGuard.update(true);
  const guard = new IntentGuard();
  $effect(() => guard.update(!prep.solo && !!room?.ready && prep.allReady));
  onDestroy(() => { entryGuard.close(); guard.close(); if(!coordinates)measurements.dispose(); });
</script>
<div class="result-layer" bind:this={layer} class:inline class:dock style:position={inline?'relative':undefined} style:margin-top={inline?`${policy.inlineGap}px`:undefined} style:visibility={summaryReady && actionsReady && stackReady && frameReady ? undefined : 'hidden'}>
  <section class="result sheet" bind:this={sheet} style:max-height={policy.maxHeight===undefined?undefined:`${policy.maxHeight}px`} style:overflow-y={dock?'auto':undefined} aria-label="이번 판 결과">
    <EngineFlow fill direction="column" onready={reportStackReady} inset={{left:policy.paddingX,right:policy.paddingX,top:policy.paddingY,bottom:policy.paddingY}} items={[{id:'summary',width:'fill',expectedHeight:summaryHeight,gapAfter:policy.summaryGap},{id:'actions',width:'fill',expectedHeight:actionsHeight,allowEmpty:me===null&&done.tricks.length===0,gapAfter:(prep.waiting||!prep.full)&&me!==null?policy.noteGap:0},...(prep.waiting&&me!==null?[{id:'waiting',width:'fill' as const,gapAfter:!prep.full?policy.noteGap:0}]:[]),...(!prep.full&&me!==null?[{id:'vacant',width:'fill' as const}]:[])]}>
      {#snippet children(part)}{#if part==='summary'}
    <HudResult
      title={result.run ? '런' : result.won ? '여당 승리' : '야당 승리'}
      description={`공약 ${done.contract.count} · 획득 ${done.team_points}${me !== null && personal === null ? ' · 다음 판부터 참여해요' : ''}`}
      value={personal === null ? null : `이번 판 ${personal > 0 ? '+' : ''}${personal}점`}
      negative={personal !== null && personal < 0} award={earned.map(a => a.title).join(' · ')} onready={reportSummaryReady}
    />
    {:else if part==='actions'}<HudActions onready={reportActionsReady}>
      {#snippet primary()}<div class="continuation">
        {#if me !== null}<button class="btn primary" disabled={entryGuard.blocked || !prep.full || prep.pending || (!prep.solo && prep.allReady && guard.blocked)} onclick={() => { if (entryGuard.blocked) return; onadvance(); }}>{prep.pending ? '자리 확인 중' : prep.solo || prep.allReady ? '다음 판' : prep.mineReady ? '준비 취소' : '다음 판 준비'}</button>{/if}
      </div>{/snippet}
      {#snippet secondary()}<div class="secondary">{#if done.tricks.length}<button class="btn ghost replay-button" aria-label="더보기" title="이번 판 자세히 보기" onclick={() => onreplay(done)}>더보기</button>{/if}</div>{/snippet}
    </HudActions>
    {:else if part==='waiting'}<p class="preparation-note">{prep.waiting}</p>{:else}<p class="preparation-note">빈 자리를 채우면 이어갈 수 있어요</p>{/if}{/snippet}
    </EngineFlow>
  </section>
</div>
<style>
  .result-layer { min-width:0; min-height:0; z-index:var(--z-result); pointer-events:none; }
  .sheet { pointer-events:auto; background:var(--panel); border-radius:var(--r-panel); box-shadow:var(--lip); text-align:center; }
  p { margin:0; font-size:12px; line-height:16px; color:var(--ink-muted); text-wrap:balance; }
  .continuation .btn { width:100%; min-height:44px; font-size:16px; padding-block:8px; }
  .secondary { width:max-content; }
  .secondary button { font-size:12px; min-height:44px; padding:6px 10px; }

</style>
