<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Chip from '../ui/Chip.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import TablePreview from '../games/mighty/TablePreview.svelte';
  import { rendering } from './renderMode.svelte';
  let selectedState=$state(new URLSearchParams(location.search).get('state')??'play');
  let options=$state(false),creating=$state(false),error=$state('');
  let tools:HTMLDivElement;
  let toolsHeight=$state(48);
  onMount(()=>{
    const measure=()=>{toolsHeight=Math.ceil(tools.getBoundingClientRect().height);};
    const observer=new ResizeObserver(measure);observer.observe(tools);measure();
    return()=>observer.disconnect();
  });
  const states=[['lobby','방'],['bidding','입찰'],['exchange','키티'],['friend','프렌드'],['play','카드 내기'],['arrival','카드 도착'],['sweep','카드 수거'],['done','결과'],['watch','관전'],['misdealtransition','딜미스'],['room','자리 이동']] as const;
  async function createGame(){creating=true;error='';try{const response=await fetch('/api/games/mighty/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset:'default'})});if(!response.ok)throw new Error('방을 만들지 못했어요.');const room=await response.json();location.assign(`/r/${room.id}`);}catch(e){error=e instanceof Error?e.message:'방을 만들지 못했어요.';}finally{creating=false;}}
</script>
<div class="renderer-preview" data-renderer={rendering.mode} data-renderer-preview style:--preview-tools-height={`${toolsHeight}px`}>
  <div bind:this={tools} class="review-tools" aria-label="좌표 엔진 미리보기">
    <strong>DOM 좌표 엔진</strong>
    <Button size="sm" onclick={()=>options=true}>장면 선택</Button><Button size="sm" onclick={createGame} disabled={creating}>{creating?'방 만드는 중':'실제 게임하기'}</Button>
  </div>
  {#key selectedState}<TablePreview state={selectedState} roomMode={true} />{/key}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if options}<Sheet title="미리보기 장면" onclose={()=>options=false}><div class="states">{#each states as [id,label]}<Chip pressed={selectedState===id} onclick={()=>{selectedState=id;options=false;}}>{label}</Chip>{/each}</div><p>미리보기는 예시 상태예요. 실제 게임하기를 누르면 서버의 새 방으로 들어가요.</p></Sheet>{/if}
</div>
<style>
  .review-tools{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 16px;}
  .review-tools strong{margin-right:auto;font-size:13px;color:var(--ink-muted);}
  .states{display:flex;flex-wrap:wrap;gap:8px;}
  .renderer-preview :global(.page){--chrome:calc(128px + var(--preview-tools-height));}
  p{font-size:13px;color:var(--ink-muted);}
</style>
