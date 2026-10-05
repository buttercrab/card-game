<script lang="ts">
  // A small card of choices for one seat, between hands, hung from the seat
  // that was tapped: a bot's level, swapping seats, sending someone to
  // watch, standing up, filling an empty seat or sitting in it.
  import { CATALOG, LEVEL_LABEL } from './catalog';
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { layer } from './layers';
  import { occupantName } from './names';
  import type { BotLevel, SeatInfo } from './types';

  let {
    seat,
    info,
    me,
    anchor,
    name = $bindable(''),
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
  /** Sending a player to watch waits for a yes. */
  let kicking = $state(false);

  // Hung under the seat when it fits, else over it, and always wholly on
  // screen: inside the visual viewport, which a phone's keyboard shrinks
  // (and may scroll) while the name is typed, so 앉기 stays in reach. Too
  // tall for what is left, the card scrolls inside itself.
  let card = $state<HTMLElement>();
  let pos = $state<{ left: number; top: number } | null>(null);
  const MARGIN = 8;
  const GAP = 6;
  function place() {
    if (!card) return;
    const vv = window.visualViewport;
    const vx = vv?.offsetLeft ?? 0;
    const vy = vv?.offsetTop ?? 0;
    const vw = vv?.width ?? innerWidth;
    const vh = vv?.height ?? innerHeight;
    card.style.maxHeight = `${Math.max(0, vh - 2 * MARGIN)}px`;
    card.style.maxWidth = `${Math.max(0, vw - 2 * MARGIN)}px`;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const box = anchor();
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    const below = box.bottom + GAP;
    const above = box.top - GAP - h;
    const bottomEdge = vy + vh - MARGIN;
    const top = below + h <= bottomEdge ? below : above >= vy + MARGIN ? above : below;
    pos = {
      left: clamp(box.left + box.width / 2 - w / 2, vx + MARGIN, vx + vw - MARGIN - w),
      top: clamp(top, vy + MARGIN, bottomEdge - h),
    };
  }
  $effect(() => {
    void kicking;
    void tick().then(place);
  });

  let field = $state<HTMLInputElement>();
  onMount(() => {
    const unlayer = layer(onclose);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    // What the card holds can change its size (내보내기 asks first).
    const sized = new ResizeObserver(() => place());
    if (card) sized.observe(card);
    place();
    // A newcomer's first seat: straight to the name, once the card is where
    // it belongs, so focusing it scrolls nothing.
    if (field && !name.trim()) field.focus({ preventScroll: true });
    else card?.focus({ preventScroll: true });
    return () => {
      unlayer();
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      sized.disconnect();
    };
  });

  function sit(event: SubmitEvent) {
    event.preventDefault();
    if (name.trim()) onsit(name.trim());
  }
</script>

<svelte:window onresize={place} onscrollcapture={place} onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- Anywhere else closes it, as a tap beside a real popover would. -->
<button class="scrim" aria-label="닫기" tabindex="-1" onclick={onclose}></button>
<div
  class="pop-card"
  role="dialog"
  aria-label="{title} 자리"
  tabindex="-1"
  bind:this={card}
  style:left="{pos?.left ?? 0}px"
  style:top="{pos?.top ?? 0}px"
  style:visibility={pos ? null : 'hidden'}
>
  <p class="head"><strong>{title}</strong>{#if sub}<span class="muted"> · {sub}</span>{/if}</p>

  {#if kicking && info.kind === 'human'}
    <p class="ask"><strong>{info.name}</strong> 님을 구경하는 자리로 옮길까요? 다시 앉을 수 있어요.</p>
    <div class="row">
      <button onclick={() => (kicking = false)}>취소</button>
      <button class="danger" onclick={onkick}>내보내기</button>
    </div>
  {:else if !seated}
    <!-- Watching: an empty seat, or a bot's between hands, is yours to take. -->
    <form class="sit" onsubmit={sit}>
      <input bind:this={field} bind:value={name} placeholder="이름" aria-label="이름" maxlength={CATALOG.name_max} autocomplete="nickname" />
      <button type="submit" disabled={!name.trim()}>{info.kind === 'bot' ? '대신 앉기' : '앉기'}</button>
    </form>
    {#if info.kind === 'empty'}
      <button class="item" onclick={oninvite}><Icon name="invite" />친구 초대하기</button>
    {/if}
  {:else if info.kind === 'bot'}
    <span class="levels" role="radiogroup" aria-label="{title} 실력">
      {#each CATALOG.bot_levels as l (l.id)}
        <button role="radio" aria-checked={info.level === l.id} onclick={() => info.level !== l.id && onlevel(l.id)}>{l.label}</button>
      {/each}
    </span>
    <button class="item" onclick={onswap}><Icon name="swap" />자리 바꾸기</button>
    <button class="item" onclick={onclearbot}><Icon name="leave" />비우기</button>
  {:else if info.kind === 'empty'}
    <span class="label">봇 앉히기</span>
    <span class="levels add" role="group" aria-label="봇 앉히기">
      {#each CATALOG.bot_levels as l (l.id)}
        <button onclick={() => onlevel(l.id)} aria-label="{l.label} 봇 앉히기">{l.label}</button>
      {/each}
    </span>
    <button class="item" onclick={oninvite}><Icon name="invite" />친구 초대하기</button>
    <button class="item" onclick={onmovehere}><Icon name="swap" />내가 여기로 옮기기</button>
  {:else if mine}
    <button class="item" onclick={onswap}><Icon name="swap" />자리 바꾸기</button>
    <button class="item" onclick={onstand}><Icon name="leave" />일어나서 구경하기</button>
  {:else}
    <button class="item" onclick={onswap}><Icon name="swap" />자리 바꾸기</button>
    {#if !info.connected}<button class="item" onclick={onrelieve}><Icon name="bot" />봇에게 맡기기</button>{/if}
    <button class="item danger" onclick={() => (kicking = true)}><Icon name="leave" />내보내기</button>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    min-height: 0;
    padding: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    cursor: default;
  }
  .scrim:active:not(:disabled) {
    transform: none;
  }
  /* Card paper on the table: a hairline and the hard, faint lip every
     object on the table has; nothing blurred. */
  .pop-card {
    position: fixed;
    z-index: 41;
    display: grid;
    /* One column no wider than the card: a name field or a row of chips
       never pushes 앉기 out past the card's edge. */
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    width: min(240px, calc(100vw - 16px));
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px;
    border-radius: var(--r-panel);
    background: var(--raised);
    border: 1px solid var(--raised-line);
    box-shadow: 0 3px 0 var(--raised-line);
    animation: pop-in var(--dur-quick) var(--ease-standard) both;
  }
  .pop-card:focus {
    outline: none;
  }
  :global(:root[data-motion='reduced']) .pop-card {
    animation-name: fade;
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }
  .head {
    margin: 0 2px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-body);
  }
  .muted {
    color: var(--ink-muted);
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
  .item {
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    font-size: var(--text-body);
    text-align: left;
  }
  .danger {
    color: var(--danger);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  /* The level as three chips in a well, as on the sheets: ink when chosen. */
  .levels {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-pill);
    background: var(--table);
  }
  .levels button {
    min-height: 40px;
    padding: 2px 0;
    border-radius: var(--r-pill);
    background: none;
    box-shadow: none;
    color: var(--ink);
    font-size: 14px;
    font-weight: 600;
  }
  .levels button[aria-checked='true'] {
    background: var(--ink);
    color: var(--table);
  }
  /* Adding a bot: each level is its own button, on card paper. */
  .levels.add {
    gap: 6px;
    padding: 0;
    background: none;
  }
  .levels.add button {
    border-radius: var(--r-control);
    background: var(--btn);
    color: var(--ink);
    box-shadow: 0 3px 0 var(--btn-lip);
  }
  .sit {
    display: flex;
    gap: 6px;
  }
  .sit input {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
  }
  .sit button {
    flex: none;
  }
</style>
