<script lang="ts">
  import { onDestroy } from 'svelte';
  import TableFrame from '../ui/TableFrame.svelte';
  import EngineFlow from './EngineFlow.svelte';
  import { provideTableCoordinates } from './coordinateContext';
  import { calculateTableLayout, placeMeasuredAt } from './layout';
  let {seatCount=3}:{seatCount?:3|6}=$props();
  let phase=$state<'waiting'|'play'|'result'>('waiting');
  let frame=$state<HTMLElement>();
  let felt=$state<HTMLDivElement>();
  let caption=$state<HTMLDivElement>();
  const coordinates=provideTableCoordinates(()=>frame);
  let metrics=$state({viewport:{width:390,height:844},region:{width:0,height:0}});
  let captionSize=$state({width:0,height:0});
  $effect(()=>{frame;coordinates.measurements.invalidate();});
  $effect(()=>felt&&coordinates.measurements.observeRegion(felt,next=>metrics=next));
  $effect(()=>{const content=caption?.firstElementChild;if(content instanceof HTMLElement)return coordinates.measurements.observeSize(content,size=>captionSize=size);});
  onDestroy(()=>coordinates.measurements.dispose());
  const layout=$derived(calculateTableLayout({...metrics,seatCount,watching:true}));
  const captionBox=$derived(placeMeasuredAt(layout.leadNote,captionSize));
  const phases=[{value:'waiting',label:'대기'},{value:'play',label:'플레이'},{value:'result',label:'결과'}] as const;
</script>
<main class="demo-page" data-layout-demo={seatCount}>
  <header><h1>공통 테이블 · {seatCount}인</h1><nav aria-label="장면">{#each phases as p}<button aria-pressed={phase===p.value} onclick={()=>phase=p.value}>{p.label}</button>{/each}</nav></header>
  <TableFrame class="generic-demo" bind:element={frame}>
    {#snippet children(screen)}
    <div class="status-area" data-frame-region="status">
      <EngineFlow fill minHeight={screen.regions.status.height} justify="between" items={[{id:'title'},{id:'profile'}]}>
        {#snippet children(id)}{#if id==='title'}<span class="demo-status">배치 미리보기</span>{:else}<span class="profile">{seatCount}인 · {layout.mode}</span>{/if}{/snippet}
      </EngineFlow>
    </div>
    <div class="event" data-frame-region="event">같은 자리에 계속 앉아 있어요</div>
    <div class="felt-area scene" data-frame-region="felt" bind:this={felt}>
      <div class="demo-ring" style:left={`${layout.ring.x}px`} style:top={`${layout.ring.y}px`} style:width={`${layout.ring.width}px`} style:height={`${layout.ring.height}px`}>
        {#each layout.seats as seat,relative (relative)}
          {@const box=placeMeasuredAt(seat,{width:layout.seatWidth,height:56})}
          <section class="demo-seat" data-relative={relative} aria-label={`${relative+1}번 자리`} style:left={`${box.x}px`} style:top={`${box.y}px`} style:width={`${box.width}px`} style:height={`${box.height}px`}>
            <EngineFlow fill direction="column" gap={4} align="center" inset={{left:4,right:4,top:4,bottom:4}} items={[{id:'person'},{id:'name',width:'fill'}]}>
              {#snippet children(id)}{#if id==='person'}<span class="person" aria-hidden="true">●</span>{:else}<strong>플레이어 {relative+1}</strong>{/if}{/snippet}
            </EngineFlow>
          </section>
        {/each}
        {#if phase==='play'}
          {#each layout.cards as card,relative (relative)}
            {@const box=placeMeasuredAt(card,{width:layout.cardWidth,height:layout.cardHeight})}
            <div class="demo-card" data-card-seat={relative} style:left={`${box.x}px`} style:top={`${box.y}px`} style:width={`${box.width}px`} style:height={`${box.height}px`}>{relative+1}</div>
          {/each}
        {:else}
          <div class="scene-caption" bind:this={caption} style:left={`${captionBox.x}px`} style:top={`${captionBox.y}px`}>
            <EngineFlow direction="column" align="center" gap={6} items={[{id:'title'},{id:'description'}]}>
              {#snippet children(id)}{#if id==='title'}<span>{phase==='waiting'?'함께 시작해요':'이번 판 결과'}</span>{:else}<small>{phase==='waiting'?'참여자를 기다리고 있어요':'다음 판에도 같은 테이블에서'}</small>{/if}{/snippet}
            </EngineFlow>
          </div>
        {/if}
      </div>
    </div>
    <div class="strip-area" data-frame-region="strip"></div>
    <div class="tray-area" data-frame-region="tray"><EngineFlow fill justify="center" minHeight={screen.regions.tray.height} class="demo-dock" items={[{id:'label'}]}>{#snippet children()}<span>{phase==='waiting'?'시작할 준비':phase==='play'?'내 카드와 선택':'다음 판 이어가기'}</span>{/snippet}</EngineFlow></div>
    <aside class="demo-side" data-frame-region="side"><EngineFlow fill justify="center" minHeight={screen.regions.side.height} items={[{id:'label'}]}>{#snippet children()}<span>장면이 바뀌어도<br />자리와 테이블 크기는 그대로예요.</span>{/snippet}</EngineFlow></aside>
    {/snippet}
  </TableFrame>
</main>
<style>
  .demo-page { --chrome:80px;padding:16px; }
  header { display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;margin-bottom:12px; }
  h1 { margin:0;font-size:14px;font-weight:600; }
  nav { display:flex;gap:4px; }
  nav button { min-height:32px;padding:4px 8px;font-size:12px;border-radius:8px; }
  nav button[aria-pressed='true'] { background:var(--panel);color:var(--ink); }
  .demo-status { font-size:13px; }
  .profile,.event { color:var(--ink-muted);font-size:11px; }
  .event { text-align:center; }
  .demo-ring,.demo-seat,.scene-caption { position:absolute; }
  .person { font-size:20px;color:var(--ink-muted);line-height:22px; }
  .demo-seat strong { display:block;font-size:10px;line-height:16px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .demo-card { position:absolute;display:grid;place-items:center;background:var(--card);color:var(--card-ink);border:1px solid var(--card-edge);border-radius:6px;font-size:18px;font-weight:600; }
  .scene-caption { font-size:14px;text-align:center;white-space:nowrap; }
  .scene-caption small { font-size:11px;color:var(--ink-muted); }
  :global(.generic-demo .demo-dock) { font-size:13px;color:var(--ink-muted);border-top:1px solid var(--line); }
  .demo-side { font-size:12px;line-height:22px;color:var(--ink-muted); }
</style>
