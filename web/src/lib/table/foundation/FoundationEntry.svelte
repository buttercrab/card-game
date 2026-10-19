<script lang="ts">
  import {onMount,type Component} from 'svelte';
  import {isNativeCapacityResponse,DELIVERY_NOTICES} from '../../room/delivery';
  const id=location.pathname.split('/')[2];
  const roots:Record<string,()=>Promise<{default:Component}>>={
    mighty:()=>import('../../games/mighty/FoundationRoom.svelte'),
    poker:()=>import('../../games/poker/FoundationRoom.svelte'),
  };
  let Root=$state<Component>(),error=$state(''),unavailable=$state(false);
  onMount(()=>{
    const controller=new AbortController();let alive=true;
    void(async()=>{
      const response=await fetch(`/api/rooms/${encodeURIComponent(id)}`,{signal:controller.signal});
      if(await isNativeCapacityResponse(response)){if(alive)unavailable=true;throw new Error(DELIVERY_NOTICES.capacity);}
      if(!response.ok)throw new Error(response.status===404?'테이블을 찾을 수 없어요.':'테이블 정보를 불러오지 못했어요.');
      const metadata:unknown=await response.json();
      if(!metadata||typeof metadata!=='object'||!('id' in metadata)||metadata.id!==id||!('game' in metadata)||typeof metadata.game!=='string'||!Object.hasOwn(roots,metadata.game))throw new Error('이 게임을 표시할 수 없어요.');
      const module=await roots[metadata.game]();if(alive)Root=module.default;
    })().catch(reason=>{if(alive&&!controller.signal.aborted)error=reason instanceof Error?reason.message:'테이블 정보를 불러오지 못했어요.';});
    return()=>{alive=false;controller.abort();};
  });
</script>
{#if Root}<Root/>{:else}<main class="foundation-entry"><p role="status">{error||'테이블을 불러오는 중…'}</p>{#if unavailable}<button class="btn" onclick={()=>location.reload()}>다시 확인</button>{/if}{#if error}<a class="btn" href="/">돌아가기</a>{/if}</main>{/if}
<style>.foundation-entry{min-height:100dvh;display:grid;align-content:center;justify-items:center;gap:12px;padding:24px;background:var(--table);color:var(--ink)}p{margin:0}</style>
