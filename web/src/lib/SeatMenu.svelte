<script lang="ts">
  // A small card of choices for one seat, between hands, hung from the seat
  // that was tapped: a bot's level, swapping seats, sending someone to
  // watch, standing up, filling an empty seat or sitting in it.
  import { CATALOG, LEVEL_LABEL } from './catalog';
  import Icon from './Icon.svelte';
  import { occupantName } from './names';
  import type { BotLevel, SeatInfo } from './types';
  import Button from './ui/Button.svelte';
  import Popover from './ui/Popover.svelte';
  import Segmented from './ui/Segmented.svelte';

  let {
    seat,
    info,
    me,
    anchor,
    name = $bindable(''),
    kicking = $bindable(false),
    onclose,
    onlevel,
    onswap,
    onmovehere,
    onclearbot,
    onkick,
    onrelieve,
    onstand,
    onsit,
    oninvite,
  }: {
    seat: number;
    info: SeatInfo;
    /** Your seat, or null when watching. */
    me: number | null;
    /** Where the seat is on screen now, to hang the card from. */
    anchor: () => DOMRect;
    /** The name a watcher sits down with. */
    name?: string;
    /** Sending a player to watch waits for a yes: asking. */
    kicking?: boolean;
    onclose: () => void;
    /** Seat a bot of this level here, or change the bot's level. */
    onlevel: (level: BotLevel) => void;
    /** Start swapping this seat with another. */
    onswap: () => void;
    /** Move yourself to this empty seat. */
    onmovehere: () => void;
    onclearbot: () => void;
    onkick: () => void;
    /** A player who dropped: a bot takes the seat. */
    onrelieve: () => void;
    onstand: () => void;
    onsit: (name: string) => void;
    oninvite: () => void;
  } = $props();

  const seated = $derived(me !== null);
  const mine = $derived(me === seat);
  const title = $derived.by(() => {
    const name = occupantName(info, seat);
    if (name === null) return `${seat + 1}번 자리`;
    return mine ? `${name} (나)` : name;
  });
  const sub = $derived(
    info.kind === 'empty'
      ? '빈 자리'
      : info.kind === 'bot'
        ? `봇 · ${LEVEL_LABEL[info.level]}`
        : !info.connected
          ? '연결 끊김'
          : info.away
            ? '자리 비움'
            : null,
  );
  const LEVELS = CATALOG.bot_levels.map((l) => ({ value: l.id, label: l.label }));

  let field = $state<HTMLInputElement>();

  function sit(event: SubmitEvent) {
    event.preventDefault();
    if (name.trim()) onsit(name.trim());
  }
</script>

<!-- The seat's own card: a tap beside it only closes it, as beside a real
     popover; the keyboard can still reach the table underneath. A
     newcomer's first seat goes straight to the name. -->
<Popover
  {anchor}
  {onclose}
  modal
  width="min(240px, calc(100vw - 16px))"
  label="{title} 자리"
  autofocus={() => (field && !name.trim() ? field : undefined)}
>
  <p class="head"><strong>{title}</strong>{#if sub}<span class="muted"> · {sub}</span>{/if}</p>

  {#if kicking && info.kind === 'human'}
    <p class="ask"><strong>{info.name}</strong> 님을 구경하는 자리로 옮길까요? 다시 앉을 수 있어요.</p>
    <div class="row">
      <Button onclick={() => (kicking = false)}>취소</Button>
      <Button variant="danger" onclick={onkick}>내보내기</Button>
    </div>
  {:else if !seated}
    <!-- Watching: an empty seat, or a bot's between hands, is yours to take. -->
    <form class="sit" onsubmit={sit}>
      <input bind:this={field} bind:value={name} placeholder="이름" aria-label="이름" maxlength={CATALOG.name_max} autocomplete="nickname" />
      <Button type="submit" disabled={!name.trim()}>{info.kind === 'bot' ? '대신 앉기' : '앉기'}</Button>
    </form>
    {#if info.kind === 'empty'}
      <Button wide onclick={oninvite}><Icon name="invite" />친구 초대하기</Button>
    {/if}
  {:else if info.kind === 'bot'}
    <Segmented options={LEVELS} value={info.level} onchange={onlevel} label="{title} 실력" />
    <Button wide onclick={onswap}><Icon name="swap" />자리 바꾸기</Button>
    <Button wide onclick={onclearbot}><Icon name="leave" />비우기</Button>
  {:else if info.kind === 'empty'}
    <span class="label">봇 앉히기</span>
    <span class="levels" role="group" aria-label="봇 앉히기">
      {#each CATALOG.bot_levels as l (l.id)}
        <Button onclick={() => onlevel(l.id)} aria-label="{l.label} 봇 앉히기">{l.label}</Button>
      {/each}
    </span>
    <Button wide onclick={oninvite}><Icon name="invite" />친구 초대하기</Button>
    <Button wide onclick={onmovehere}><Icon name="swap" />내가 여기로 옮기기</Button>
  {:else if mine}
    <Button wide onclick={onswap}><Icon name="swap" />자리 바꾸기</Button>
    <Button wide onclick={onstand}><Icon name="leave" />일어나서 구경하기</Button>
  {:else}
    <Button wide onclick={onswap}><Icon name="swap" />자리 바꾸기</Button>
    {#if !info.connected}<Button wide onclick={onrelieve}><Icon name="bot" />봇에게 맡기기</Button>{/if}
    <Button wide variant="danger" onclick={() => (kicking = true)}><Icon name="leave" />내보내기</Button>
  {/if}
</Popover>

<style>
  .head {
    margin: 0 2px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-body);
  }
  .muted {
    font-size: var(--text-label);
  }
  .label {
    margin: 2px 2px 0;
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--ink-muted);
  }
  .ask {
    margin: 0 2px;
    font-size: 14px;
    word-break: keep-all;
  }
  .row,
  .levels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .levels {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .sit {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }
  .sit input {
    min-width: 0;
  }
</style>
