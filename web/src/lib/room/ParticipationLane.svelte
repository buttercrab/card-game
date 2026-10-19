<script lang="ts">
  import { innerWidth } from 'svelte/reactivity/window';
  import EngineFlow from '../table/EngineFlow.svelte';
  import { participationLayout } from '../table/participationLayout';
  import { CATALOG } from '../catalog';
  import Button from '../ui/Button.svelte';
  import type { GameTypes, RoomViewOf } from './types';
  import type { TableClient } from './tableClient';
  import type { TableSession } from './TableSession.svelte';
  import { availableSeat } from './participation';
  let { room, client, session, preview = null, choosing = false, onchoose, onselect, onconfirm, oncancel }: {
    room: RoomViewOf<GameTypes>; client: TableClient; session: TableSession<GameTypes>; preview?: number | null; choosing?: boolean;
    onchoose: () => void; onselect: (seat: number) => void; onconfirm: () => void; oncancel: () => void;
  } = $props();
  const own = $derived(room.participation?.find(p => p.id === client.viewerId));
  const requests = $derived(room.participation ?? []);
  const available = $derived(availableSeat(room, client.viewerId));
  const offered = $derived(requests.find(p => p.offered_by === client.viewerId));
  const waiting = $derived(requests.find(p => p.seat === null));
  const target = $derived(own?.seat !== null && own?.seat !== undefined ? room.seats[own.seat] : null);
  const geometry = $derived(participationLayout(session.sitName.length,innerWidth.current??390));
  const actions = $derived(preview !== null ? ['primary','cancel'] : choosing ? ['cancel'] : own ? own.seat !== null && !room.in_hand ? ['primary','cancel'] : ['cancel'] : available >= 0 ? ['primary','alternate'] : ['primary']);
</script>
{#if client.seat === null}
  <section class="participation" aria-label="관전자 참여" style:width={`${geometry.width}px`}>
    <EngineFlow items={[{id:'identity',width:'fill'},{id:'actions',width:'fill'}]} fill direction="column" gap={4}>{#snippet children(part)}{#if part === 'identity'}<div class="identity"><EngineFlow items={[{id:'form',width:'fill'}, ...(preview !== null || choosing || own ? [{id:'note',width:'fill' as const}] : [])]} fill direction="column" gap={geometry.identityGap}>{#snippet children(id)}{#if id === 'form'}
      <form class="entry-name" onsubmit={(e) => { e.preventDefault(); session.withName(() => {}); }}>
        <EngineFlow items={[{id:'nickname'}, ...(session.sitName.trim() && session.sitName.trim() !== client.viewerName ? [{id:'save'}] : []), {id:'state'}]} gap={8} rowGap={4} nowrap={false} fill justify="center" minHeight={44}>{#snippet children(entry)}{#if entry === 'nickname'}<label class="nickname" style:width={`${geometry.nameWidth + 14}px`}><EngineFlow items={[{id:'input'},{id:'edit'}]} gap={geometry.editGap}>{#snippet children(leaf)}{#if leaf === 'input'}
          <span class="sr-only">내 이름</span>
          <input bind:value={session.sitName} maxlength={CATALOG.name_max} placeholder="내 이름" autocomplete="nickname" disabled={client.status !== 'open'} style:width={`${geometry.nameWidth}px`} />
          {:else}<svg class="edit-mark" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m3 10 7-7 3 3-7 7-4 1z M9 4l3 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
        {/if}{/snippet}</EngineFlow></label>{:else if entry === 'save'}
        
          <Button size="sm" variant="ghost" type="submit" disabled={client.status !== 'open'}>저장</Button>
        {:else}<span class="observer-state">관전 중</span>{/if}{/snippet}</EngineFlow>
      </form>
      {:else}
        <p>{preview !== null ? `${room.seats[preview].kind === 'empty' ? '빈자리' : room.seats[preview].name} 자리에서 참여` : choosing ? '빈자리나 봇을 골라주세요' : own?.seat === null ? `자리 양보 기다리는 중 · ${own.order}번째` : room.in_hand ? `${target?.kind === 'empty' ? '빈자리' : target?.name} 대신 다음 판부터` : '참여할 자리가 준비됐어요'}</p>
      {/if}{/snippet}</EngineFlow>
    </div>
    {:else}<div class="actions"><EngineFlow items={actions.map(id => ({id}))} gap={geometry.actionGap} rowGap={geometry.actionGap} nowrap={false} fill justify="center">
      {#snippet children(id)}
        {#if id === 'primary'}
          {#if preview !== null}<Button size="sm" variant="primary" onclick={() => session.withName(onconfirm)} disabled={!session.sitName.trim()}>이 자리에서 참여</Button>
          {:else if own}<Button size="sm" variant="primary" onclick={() => session.withName(() => onselect(own.seat!))} disabled={!session.sitName.trim()}>앉아서 다음 판 준비</Button>
          {:else}<Button size="sm" variant="primary" onclick={() => session.withName(() => available >= 0 ? onselect(available) : client.requestSeat(true))} disabled={!session.sitName.trim() || client.status !== 'open'}>{room.in_hand || available < 0 ? '다음 판 참여' : room.seats[available].kind === 'bot' ? '봇 대신 앉기' : '빈자리에 앉기'}</Button>{/if}
        {:else if id === 'alternate'}<Button size="sm" onclick={() => session.withName(onchoose)} disabled={!session.sitName.trim()}>다른 자리</Button>
        {:else if preview !== null || choosing}<Button size="sm" onclick={oncancel}>{preview !== null ? '취소' : '선택 취소'}</Button>
        {:else if own}<Button size="sm" onclick={() => { client.requestSeat(false); oncancel(); }} disabled={client.status !== 'open'}>참여 취소</Button>
        {:else}<Button size="sm" onclick={oncancel}>{choosing ? '선택 취소' : '취소'}</Button>{/if}
      {/snippet}
    </EngineFlow></div>{/if}{/snippet}</EngineFlow>
  </section>
{:else if offered || waiting}
  <section class="participation handoff" aria-label="자리 양보" style:width={`${geometry.width}px`}><EngineFlow items={[{id:'note'},{id:'action'}]} gap={8} fill nowrap={false} justify="center">{#snippet children(id)}{#if id === 'note'}<p>{offered ? `${offered.name}님이 다음 판 자리를 확인해요` : `${waiting!.name}님이 다음 판 참여를 기다려요`}</p>{:else}<div class="actions"><Button size="sm" onclick={() => client.offerSeat(offered ? null : waiting!.id)} disabled={client.status !== 'open'}>{offered ? '자리 양보 취소' : '다음 판 쉬기'}</Button></div>{/if}{/snippet}</EngineFlow></section>
{/if}
<style>
  .participation { pointer-events:none; text-align:center; width:100%; }
  .identity,.entry-name,.actions { width:100%; min-width:0; }
  .entry-name { pointer-events:auto; margin:0; }
  .nickname { display:block; }
  .nickname input { min-height:44px; padding:4px 0; border:0; border-bottom:1px solid transparent; border-radius:0; background:transparent; box-shadow:none; font-size:15px; font-weight:600; text-align:center; outline:none; }
  .nickname input:hover { border-bottom-color:var(--line); }
  .nickname input:focus { border-bottom-color:var(--accent); }
  .edit-mark { color:var(--ink-muted); pointer-events:none; }
  .observer-state { color:var(--ink-muted); font-size:11px; white-space:nowrap; }
  .observer-state::before { content:'· '; color:var(--ink-muted); }
  p { font-size:12px; color:var(--ink-muted); margin:0; text-wrap:balance; }
  .actions :global(.btn), .entry-name :global(.btn) { pointer-events:auto; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
</style>
