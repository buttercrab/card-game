<script lang="ts">
  import { CATALOG } from '../catalog';
  import Sheet from '../ui/Sheet.svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Bubble from '../ui/Bubble.svelte';
  import PlayerFigure from '../ui/PersonFigure.svelte';
  import type { BotLevel, GameTypes, RoomViewOf } from './types';
  import type { TableClient } from './tableClient';
  import type { TableSession } from './TableSession.svelte';
  import { availableSeat } from './participation';
  let { room, client, session, onclose, onselect }: { room: RoomViewOf<GameTypes>; client: TableClient; session: TableSession<GameTypes>; onclose: () => void; onselect: (seat: number) => void } = $props();
  let botLevel = $state<BotLevel>(CATALOG.default_bot_level);
  const levels = CATALOG.bot_levels.map(level => ({value:level.id,label:level.label}));
  const humans = $derived(room.seats.filter(seat => seat.kind === 'human'));
  const bots = $derived(room.seats.flatMap((seat, index) => seat.kind === 'bot' ? [{...seat,index}] : []));
  const configurable = $derived(client.seat !== null && !room.in_hand && client.status === 'open' && session.arranging);
  function reserved(index: number) { return room.participation?.some(request => request.seat === index) ?? false; }
  const emptySeats = $derived(room.seats.flatMap((seat, index) => seat.kind === 'empty' && !reserved(index) ? [index] : []));
  const observers = $derived(room.observers ?? []);
  const openSeat = $derived(availableSeat(room, client.viewerId));
  const waiting = $derived(room.participation?.find(p => p.seat === null));
  const request = $derived(room.participation?.find(p => p.id === client.viewerId));
  const mineOffer = $derived(room.participation?.find(p => p.offered_by === client.viewerId));
</script>

<Sheet size="small" {onclose}>
  {#snippet head(id)}<h2 class="sheet-title" {id}>함께 있는 사람</h2>{/snippet}
  <section class="roster"><h3>플레이어 <span>{humans.length}명</span></h3>
    {#each room.seats as s, i}{#if s.kind === 'human'}
      <div class="person"><span class="avatar"><PlayerFigure offline={!s.connected} /></span><strong>{s.name}{#if i === client.seat}<small>나</small>{/if}</strong><span class="status">{!s.connected ? '연결 끊김' : room.in_hand ? '플레이 중' : room.ready?.[i] ? '준비' : room.showing ? '검토 중' : '대기'}</span></div>
    {/if}{/each}
  </section>
  <section class="roster"><h3>봇 <span>{bots.length}명</span></h3>
    {#each bots as bot (bot.index)}<div class="person"><span class="avatar"><PlayerFigure bot /></span><strong>{bot.name}</strong><span class="status">{CATALOG.bot_levels.find(level => level.id === bot.level)?.label}{reserved(bot.index) ? ' · 참여 예약' : ''}</span></div>{/each}
    {#if !bots.length}<p class="muted">봇이 없어요.</p>{/if}
  </section>
  <section class="roster"><h3>관전 중 <span>{room.watching}명</span></h3>
    {#each observers as o (o.id)}
      <div class="person"><span class="avatar"><PlayerFigure /></span><strong>{o.name}{#if o.id === client.viewerId}<small>나</small>{/if}</strong><span class="status">{room.participation?.find(p => p.id === o.id)?.seat !== null && room.participation?.find(p => p.id === o.id)?.seat !== undefined ? '다음 판 참여 예약' : o.requested ? `참여 대기 · ${room.participation?.find(p => p.id === o.id)?.order ?? 1}번째` : '관전 중'}</span>
        {#if client.seat !== null && waiting?.id === o.id}<Button size="sm" onclick={() => client.offerSeat(o.id)} disabled={client.status !== 'open'}>다음 판 쉬기</Button>{/if}
        {#if client.observerReactions[o.id]}<div class="reaction-slot">{#key client.observerReactions[o.id].id}<Bubble text={client.observerReactions[o.id].text} />{/key}</div>{/if}
      </div>
    {/each}
    {#if room.watching > observers.length}<p class="muted">이름 없는 관전자 {room.watching - observers.length}명</p>{/if}
    {#if !room.watching}<p class="muted">지금은 관전자가 없어요.</p>{/if}
  </section>
  {#if client.seat === null}
    <form class="name-form" onsubmit={(e) => { e.preventDefault(); session.withName(() => {}); }}><label for="observer-name">내 관전 이름</label><div><input id="observer-name" bind:value={session.sitName} maxlength={CATALOG.name_max} placeholder={client.viewerName || '이름'} /><Button type="submit" disabled={!session.sitName.trim() || client.status !== 'open'}>저장</Button></div></form>
    <div class="participate">
      {#if request}<p class="muted">{request.seat === null ? `자리 양보 기다리는 중 · ${request.order}번째` : room.in_hand ? '이번 판이 끝나면 참여할 수 있어요' : '참여할 자리가 준비됐어요'}</p>{#if request.seat !== null && !room.in_hand}<Button wide variant="primary" onclick={() => session.withName(() => onselect(request.seat!))} disabled={!session.sitName.trim() || client.status !== 'open'}>앉아서 다음 판 준비</Button>{/if}<Button wide onclick={() => client.requestSeat(false)}>참여 취소</Button>
      {:else}<Button wide variant="primary" onclick={() => session.withName(() => openSeat >= 0 ? onselect(openSeat) : client.requestSeat(true))} disabled={!session.sitName.trim() || client.status !== 'open'}>{room.in_hand || openSeat < 0 ? '다음 판 참여' : '빈자리에 앉기'}</Button>{/if}
    </div>
  {/if}
  {#if client.seat !== null}
    <div class="personal"><Button wide disabled={!configurable} onclick={() => { session.stand(); onclose(); }}>관전으로 전환</Button>{#if room.in_hand}<p class="muted">이번 판이 끝나면 자리를 비울 수 있어요.</p>{/if}</div>
    {#if !room.in_hand}
      <details class="bot-config"><summary>봇 구성</summary><div class="bot-controls">
        <p class="muted">빈자리를 채울 봇의 실력을 고르세요.</p>
        <Segmented options={levels} value={botLevel} onchange={(level) => (botLevel = level)} label="새 봇 실력" />
        <Button wide disabled={!configurable || !emptySeats.length} onclick={() => { for (const index of emptySeats) session.addBot(index, botLevel); }}>빈자리 봇으로 채우기</Button>
        {#each bots as bot (bot.index)}
          <div class="bot-row"><strong>{bot.name}</strong>{#if reserved(bot.index)}<span class="status">참여 예약 · 변경할 수 없어요</span>{:else if configurable}<Segmented options={levels} value={bot.level} onchange={(level) => session.addBot(bot.index, level)} label={`${bot.name} 실력`} />{/if}<Button size="sm" disabled={!configurable || reserved(bot.index)} onclick={() => session.removeBot(bot.index)}>봇 빼기</Button></div>
        {/each}
      </div></details>
    {/if}
  {/if}
  {#if mineOffer}<Button wide onclick={() => client.offerSeat(null)}>자리 양보 취소</Button>{/if}
  {#snippet footer(close)}<Button onclick={close}>닫기</Button>{/snippet}
</Sheet>

<style>
  .bot-config { margin-top:12px; } .bot-config summary { cursor:pointer; min-height:44px; display:list-item; align-content:center; font-size:13px; font-weight:600; } .bot-config[open] summary { color:var(--accent); } .bot-controls { display:grid; gap:10px; padding-top:8px; } .bot-config p { margin:0; font-size:12px; } .bot-row { display:grid; gap:8px; padding-block:10px; border-top:1px solid var(--line); } .bot-row > :global(button) { justify-self:end; } .personal { display:grid; gap:6px; margin-top:16px; }
  .roster { margin-bottom: 22px; } h3 { display:flex;justify-content:space-between;margin:0 0 12px;font-size:14px; } h3 span,.status { color:var(--ink-muted);font-size:12px; }
  .person { display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:48px;position:relative; }
  .avatar { width:32px; } strong { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; } small { margin-left:6px;color:var(--accent);font-size:11px; } .reaction-slot { grid-column:2/-1;justify-self:start;margin-bottom:4px; }
  .name-form { display:grid;gap:8px;margin-top:10px; } .name-form>div { display:flex;gap:8px; } input { min-width:0;flex:1; } label { font-size:12px;color:var(--ink-muted); } .participate { display:grid;gap:8px;margin-top:16px; }
</style>
