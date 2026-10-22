<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../../ui/Button.svelte';
  import { createCardSession } from './index';
  import { createCardTable } from './runtime';
  import { createDomSurface } from './domSurface';
  import { proofDocument, type ProofAction } from './fixtures';
  import {persistentCaptionDocument} from './shellFixture';
  import {shellDocument,type ShellProofAction} from './shellFixture';
  import {essentialInputDocument,type EssentialInputAction} from './essentialInputFixture';
  import {mightyBidPressureDocument} from './mightyBidPressureFixture';
  import {mightyJokerDocument} from './mightyJokerFixture';
  import type {MightyCommand} from '../../games/mighty/foundation';
  import {largeChoiceDocument,type LargeChoiceAction} from './largeChoiceFixture';
  import {informationDocument} from './informationFixture';
  import {arenaDocument} from './arenaFixture';
  import {cardDocument,type CardProofAction} from './cardFixtures';
  import {initialSeatDeal,advanceSeatDeal,seatDealDocument,type SeatDealAction} from './seatDealFixture';
  import {initialFlow,advanceFlow,flowDocument,type FlowAction} from './flowFixture';
  import { pressureDocument, type PressureKind, type PressureAction } from './pressureFixtures';
  import {initialDomainPressure,applyDomainPressure,domainPressureDocument,type DomainPressureAction} from './domainPressure';
  import { createPlanner } from './planner';
  import { numericComposition, type CompositionKernel } from './composition';
  import type { SurfacePort, Planner, TableDocument } from './contracts';

  type Fixture = 'persistent-caption' | 'essential-input' | 'mighty-bid-max' | 'mighty-joker' | 'hulla-flow' | 'one-card-flow' | 'shell' | 'large-choice' | 'information' | 'information-extreme' | 'arena' | 'mighty' | PressureKind | 'play' | 'discard' | 'flow' | 'hidden' | 'seats';
  type Action = EssentialInputAction | MightyCommand | DomainPressureAction | ShellProofAction | LargeChoiceAction | ProofAction | PressureAction | CardProofAction | FlowAction | SeatDealAction;
  const params = new URLSearchParams(location.search);
  const stage=params.get('stage')==='1';
  const requestedOptions=Number(params.get('options')??197);
  const optionCount=Number.isSafeInteger(requestedOptions)&&requestedOptions>=1&&requestedOptions<=300?requestedOptions:197;
  const requestedKernel = params.get('kernel') ?? 'numeric';
  let fixture = $state<Fixture>(['persistent-caption','essential-input','mighty-bid-max','mighty-joker','hulla-flow','one-card-flow','shell','large-choice','information','information-extreme','arena','poker','melds','one-card','play','discard','flow','hidden','seats'].includes(params.get('fixture') ?? '') ? params.get('fixture') as Fixture : 'mighty');
  let host: HTMLDivElement;
  let revision = 1;
  let essentialDealt=$state(false);
  let flow = initialFlow();
  let seatState=initialSeatDeal();
  let viewer=$state(0);
  let domainState=initialDomainPressure(params.get('fixture')==='one-card-flow'?'one-card':'hulla');
  const requestedTextScale=Number(params.get('textScale')),initialTextScale=[1,1.25,1.5,2].includes(requestedTextScale)?requestedTextScale:1,largeTextScale=initialTextScale>1?initialTextScale:1.5;
  let longName=$state(params.get('longName')==='1'),manyCards=$state(false),largeText=$state(initialTextScale>1),sparse=$state(false),attached=$state(true);
  let initialized=$state(false);
  let lastAction=$state(''),summary=$state('준비 중');
  let dom:ReturnType<typeof createDomSurface>|undefined,surface:SurfacePort|undefined,alive=true;
  let table:ReturnType<typeof createCardTable<Action>>|undefined;
  let kernel:CompositionKernel & {inspect?:()=>unknown}=numericComposition;
  let solveCpuMs=0,solveCalls=0,loadMs=0,lastCommit=0;
  const session=createCardSession<Action>({transport(submission){lastAction=JSON.stringify(submission.action);if(fixture==='essential-input')host.dataset.essentialLastAction=lastAction;if(fixture==='hulla-flow'||fixture==='one-card-flow'){domainState=applyDomainPressure(domainState,{generation:Number(submission.context.generation),revision:Number(submission.context.revision)},viewer as 0|1,submission.action as DomainPressureAction);}session.resolve(submission.id,'accepted');if(fixture==='hulla-flow'||fixture==='one-card-flow'){update();}else if(fixture==='essential-input'&&typeof submission.action==='object'&&submission.action!==null&&'kind'in submission.action&&submission.action.kind==='deal'){essentialDealt=true;update();}else if(fixture==='seats'){seatState=advanceSeatDeal(seatState,submission.action as SeatDealAction);update();}else if(fixture==='flow'||fixture==='hidden'){flow=advanceFlow(flow,submission.action as FlowAction);update();}}});
  const document=():TableDocument<Action>=>fixture==='persistent-caption'?persistentCaptionDocument({revision,longName}):fixture==='essential-input'?essentialInputDocument({revision,dealt:essentialDealt}):fixture==='mighty-bid-max'?mightyBidPressureDocument({revision,longName}):fixture==='mighty-joker'?mightyJokerDocument({revision,longName}):fixture==='hulla-flow'||fixture==='one-card-flow'?domainPressureDocument(domainState,viewer as 0|1):fixture==='shell'?shellDocument({revision,longName,sparse}):fixture==='large-choice'?largeChoiceDocument({revision,longName,sparse,count:optionCount}):fixture==='information-extreme'?informationDocument({revision,longName:true,extremeTotals:true,cards:manyCards?40:10,sparse}):fixture==='information'?informationDocument({revision,longName,cards:manyCards?40:10,sparse}):fixture==='arena'?arenaDocument({revision,longName,cards:manyCards?40:10,sparse}):fixture==='seats'?seatDealDocument(seatState,revision,viewer):fixture==='flow'||fixture==='hidden' ? flowDocument(flow,revision,fixture==='hidden') : fixture==='mighty'
    ? proofDocument({revision,longName,cards:manyCards?40:10,sparse})
    : fixture==='play'||fixture==='discard' ? cardDocument(fixture,{revision,longName,sparse}) : pressureDocument(fixture,{revision,longName,...(manyCards?{cards:40}:{}),sparse});
  async function createLiveRoom(){
    const response=await fetch('/api/games/mighty/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset:'default'})});
    if(!response.ok){summary='방을 만들지 못했어요';return;}
    const value=await response.json();location.assign(`/r/${value.id}?foundation=1`);
  }
  function update(){revision++;session.receive(document());}
  function choose(value:Fixture){if(value==='essential-input')essentialDealt=false;if(value==='hulla-flow'||value==='one-card-flow'){domainState=initialDomainPressure(value==='hulla-flow'?'hulla':'one-card',domainState.generation+1);viewer=0;}if(value==='seats')seatState=initialSeatDeal(seatState.generation+1);if(value==='flow'||value==='hidden')flow=initialFlow(flow.round+1);fixture=value;lastAction='';update();}
  function diagnostic(){
    if(!alive||!table)return;
    const state=table.inspect();
    summary=`${state.status} · ${kernel.name} · 자원 ${state.resourceCount} · 측정 캐시 ${state.cacheSize}`;
    host.dataset.foundationPerformance=JSON.stringify({...dom?.timings(),solveCpuMs,solveCalls,loadMs,lastCommit,resources:dom?.resources(),kernelResources:kernel.inspect?.(),frame:state.frame?.id});
  }
  function remount(){if(!surface||!table)return;if(attached)table.detach();else table.attach(surface);attached=!attached;diagnostic();}
  onMount(()=>{
    alive=true;
    let stop=()=>{};
    void (async()=>{
      const started=performance.now();
      if(requestedKernel==='yoga')kernel=await (await import('./yogaComposition')).loadYogaComposition();
      else if(requestedKernel==='native')kernel=(await import('./nativeComposition')).createNativeComposition(host);
      else if(requestedKernel!=='numeric')throw new Error('Unknown comparison kernel');
      loadMs=performance.now()-started;
      if(!alive)return;
      const planner=createPlanner(kernel);
      const measuredPlanner:Planner=(...args)=>{const started=performance.now();try{return planner(...args);}finally{solveCpuMs+=performance.now()-started;solveCalls++;}};
      table=createCardTable({session,planner:measuredPlanner,effects:{invoke(effect){lastAction=`effect:${effect}`;}}});
      dom=createDomSurface(host);dom.setTextScale(largeText?largeTextScale:1);
      surface={...dom,publish(frame){dom!.publish(frame);lastCommit=performance.now();queueMicrotask(diagnostic);},invalidate(){dom!.invalidate();queueMicrotask(diagnostic);},clear(){dom!.clear();queueMicrotask(diagnostic);},fallback(reason){dom!.fallback(reason);queueMicrotask(diagnostic);}};
      session.receive(document());table.attach(surface);initialized=true;
      stop=session.subscribe(()=>queueMicrotask(diagnostic));
    })().catch(error=>{if(alive){summary=`실험 초기화 실패: ${String(error)}`;host.dataset.foundationStatus='failed';}});
    return()=>{alive=false;stop();table?.dispose();session.dispose();};
  });
</script>

<main class="foundation-page">
  {#if stage}
    <header class="stage-header" class:stage-domain={fixture==='hulla-flow'||fixture==='one-card-flow'}><h1>{fixture==='mighty-joker'?'조커 검증 · 실제 투영 / 합성 상태':'테이블 배치 · 합성 상태'}</h1><a class="btn ghost" href="/preview?foundation=1&fixture=arena">검증 도구</a>
      {#if fixture==='hulla-flow'||fixture==='one-card-flow'}
        <nav aria-label="합성 게임 시점과 재시작">
          {#if fixture==='one-card-flow'}<Button disabled={!initialized} size="sm" onclick={()=>{viewer=viewer===0?1:0;update();}}>다음 플레이어 시점</Button>{/if}
          <Button disabled={!initialized} size="sm" onclick={()=>choose(fixture)}>다시 시작</Button>
        </nav>
      {/if}
    </header>
  {:else}
  <header>
    <h1>카드 테이블 · 새 기반 검증</h1>
    <p>하나의 런타임이 배치와 입력을 소유하는 독립 실험 화면이에요.</p>
    <nav aria-label="실제 방 연결"><Button disabled={!initialized} size="sm" onclick={createLiveRoom}>실제 Mighty 방 만들기</Button></nav>
    <nav aria-label="게임 구성 실험">
      <Button disabled={!initialized} size="sm" onclick={()=>choose('shell')}>테이블 메뉴 검증</Button>
      <Button disabled={!initialized} size="sm" onclick={()=>choose('large-choice')}>많은 선택지 검증</Button>
      <Button disabled={!initialized} size="sm" onclick={()=>choose('information')}>정보·점수 검증</Button>
      <Button disabled={!initialized} size="sm" variant={fixture==='mighty'?'primary':'secondary'} onclick={()=>choose('mighty')}>마이티</Button>
      <Button disabled={!initialized} size="sm" variant={fixture==='poker'?'primary':'secondary'} onclick={()=>choose('poker')}>포커</Button>
      <Button disabled={!initialized} size="sm" variant={fixture==='melds'?'primary':'secondary'} onclick={()=>choose('melds')}>공개 묶음</Button>
      <Button disabled={!initialized} size="sm" variant={fixture==='one-card'?'primary':'secondary'} onclick={()=>choose('one-card')}>원카드</Button>
    </nav>
    {#if fixture==='mighty-joker'}<p>실제 Mighty 투영 · 합성 스냅샷 검증. 제출 내용만 기록하며 서버 게임을 진행하지 않아요.</p>{/if}
    <nav aria-label="카드 선택 검증">
      <Button disabled={!initialized} size="sm" variant={fixture==='mighty-joker'?'primary':'secondary'} onclick={()=>choose('mighty-joker')}>조커 내기 방법 검증</Button>
      <Button disabled={!initialized} size="sm" variant={fixture==='play'?'primary':'secondary'} onclick={()=>choose('play')}>카드 내기 검증</Button>
      <Button disabled={!initialized} size="sm" variant={fixture==='discard'?'primary':'secondary'} onclick={()=>choose('discard')}>3장 선택 검증</Button>
      <Button disabled={!initialized} size="sm" variant={fixture==='flow'?'primary':'secondary'} onclick={()=>choose('flow')}>이동 흐름 검증</Button>
    </nav>
    <nav aria-label="숨긴 덱 검증"><Button disabled={!initialized} size="sm" variant={fixture==='hidden'?'primary':'secondary'} onclick={()=>choose('hidden')}>숨긴 덱 배분 검증</Button></nav>
    <nav aria-label="5인 배분 검증"><Button disabled={!initialized} size="sm" variant={fixture==='arena'?'primary':'secondary'} onclick={()=>choose('arena')}>테이블 배치</Button><Button disabled={!initialized} size="sm" variant={fixture==='seats'?'primary':'secondary'} onclick={()=>choose('seats')}>5인 배분 검증</Button>
      {#if fixture==='seats'}<Button disabled={!initialized} size="sm" onclick={()=>{viewer=(viewer+1)%5;update();}}>다음 시점</Button>{/if}
    </nav>
    <nav aria-label="실행 가능한 규칙 검증">
      <Button disabled={!initialized} size="sm" onclick={()=>choose('hulla-flow')}>훌라 실행 검증</Button>
      <Button disabled={!initialized} size="sm" onclick={()=>choose('one-card-flow')}>원카드 실행 검증</Button>
      {#if fixture==='one-card-flow'}<Button disabled={!initialized} size="sm" onclick={()=>{viewer=viewer===0?1:0;update();}}>다음 플레이어 시점</Button>{/if}
    </nav>
    <nav aria-label="검증 조건">
      <Button disabled={!initialized} size="sm" variant={longName?'primary':'secondary'} aria-pressed={longName} onclick={()=>{longName=!longName;update();}}>긴 이름</Button>
      <Button disabled={!initialized} size="sm" variant={manyCards?'primary':'secondary'} aria-pressed={manyCards} onclick={()=>{manyCards=!manyCards;update();}}>40장</Button>
      <Button disabled={!initialized} size="sm" variant={largeText?'primary':'secondary'} aria-pressed={largeText} onclick={()=>{largeText=!largeText;dom?.setTextScale(largeText?largeTextScale:1);}}>큰 글자</Button>
      <Button disabled={!initialized} size="sm" variant={sparse?'primary':'secondary'} aria-pressed={sparse} onclick={()=>{sparse=!sparse;update();}}>제한된 선택지</Button>
      <Button disabled={!initialized} size="sm" onclick={update}>새 선택지</Button>
      <Button disabled={!initialized} size="sm" onclick={remount}>{attached?'분리':'다시 연결'}</Button>
      <Button disabled={!initialized} size="sm" onclick={()=>{lastAction='';session.revoke();diagnostic();}}>권한 해제</Button>
    </nav>
    <p class="diagnostic" data-foundation-summary>{summary}</p>
    <output aria-live="polite" data-foundation-action>{lastAction}</output>
  </header>
  {/if}
  <div class="foundation-surface" aria-label="카드 테이블" data-foundation-action={stage?lastAction:undefined} bind:this={host}></div>
</main>

<style>
  .foundation-page { height:100dvh;box-sizing:border-box;padding:12px;display:flex;flex-direction:column;gap:12px;background:var(--table);color:var(--ink); }
  header { flex:none; }
  .stage-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .stage-header a{font-size:13px;min-height:44px;}
  .stage-domain{flex-wrap:wrap;gap:8px 12px;}
  .stage-domain nav{flex-basis:100%;display:flex;flex-wrap:wrap;gap:8px;margin:0;}
  h1 { margin:0;font-size:18px; }
  p { margin:4px 0;font-size:13px;color:var(--ink-muted); }
  nav { display:flex;flex-wrap:wrap;gap:6px;margin-top:8px; }
  output { display:block;min-height:18px;font-size:12px;overflow-wrap:anywhere; }
  .diagnostic { font-variant-numeric:tabular-nums; }
  .foundation-surface { position:relative;flex:1;min-height:120px;overflow:auto;overscroll-behavior:contain;border-radius:12px;background:var(--table); }
</style>
