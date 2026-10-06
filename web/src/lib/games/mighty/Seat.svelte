<script lang="ts" module>
  /** Where a seat sits at five: you at the bottom, then round the table. */
  export type Place = 'bottom' | 'right' | 'top-right' | 'top-left' | 'left' | 'free';
  export interface Gain { n: number; id: number; }
  export const PLACES: Place[] = ['bottom', 'right', 'top-right', 'top-left', 'left'];
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { juice } from '../../motion';
  import PlayerFigure from './PlayerFigure.svelte';
  import TurnRing from '../../room/TurnRing.svelte';
  import type { Suit } from './types';
  import Badge, { type Team } from '../../ui/Badge.svelte';
  import FeedbackDock from '../../ui/FeedbackDock.svelte';
  let {
    name,
    bot = false,
    offline = false,
    team = null,
    secretFriend = false,
    points = 0,
    turn = false,
    bubble = null,
    reaction = null,
    place = 'free',
    picked = false,
    attach,
    cue = null,
    dim = false,
    reveal = false,
    trumpSuit = null,
    lookAt = null,
    mood = null,
    clock = null,
    away = false,
    empty = false,
    score = null,
    collecting = false,
    gained = $bindable<Gain | null>(null),
  }: {
    name: string;
    bot?: boolean;
    offline?: boolean;
    team?: Team | null;
    /** You hold the called card: the 프렌드, known only to you so far. */
    secretFriend?: boolean;
    /** Point cards won this hand. */
    points?: number;
    turn?: boolean;
    /** A short note in the reserved feedback slot, such as a bid or 패스. */
    bubble?: string | null;
    /** A reaction the player just sent; `id` replays it when repeated. */
    reaction?: { text: string; id: number } | null;
    /** Where it sits round the table. Feedback always stays below its name. */
    place?: Place;
    /** Chosen first in a swap: it stands up a little. */
    picked?: boolean;
    /** Registers the seat's element (the table's motion finds it so). */
    attach?: Attachment<HTMLElement>;
    /** A big moment at this seat: it wiggles, with a short label under it
     * when `text` is set. A new `id` plays it again. */
    cue?: { text: string | null; id: number } | null;
    /** Out of the current round, such as after passing. */
    dim?: boolean;
    /** Just revealed as the friend. */
    reveal?: boolean;
    /** The trump, for the 주공's crown. */
    trumpSuit?: Suit | null;
    /** Where the figure's eyes glance, as a screen-direction vector. */
    lookAt?: { x: number; y: number } | null;
    mood?: 'happy' | 'down' | null;
    /** The turn timer while this seat is to act under a time limit. */
    clock?: { deadline: number; total: number } | null;
    /** Its turn ran out and a bot played it (자리 비움). */
    away?: boolean;
    /** Nobody sits here yet (between hands): a dashed outline waits. */
    empty?: boolean;
    /** The running total, shown between hands. */
    score?: number | null;
    /** Hold the collection cue until the cards reach their player. */
    collecting?: boolean;
    gained?: Gain | null;
  } = $props();


  let el: HTMLElement;
  $effect(() => {
    if (cue) juice(el, 0.6);
  });

  // Credit appears below the name once collection finishes.
  let before = untrack(() => points);
  let gainId = 0;
  let pendingGain = 0;
  let gainTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(gainTimer));
  $effect(() => {
    const now = points;
    const waiting = collecting;
    if (now < before) pendingGain = 0;
    // A loaded score snapshot is not a new trick. Only collect credit
    // while the animator is resolving cards for this seat.
    if (now > before && waiting) pendingGain += now - before;
    before = now;
    if (pendingGain > 0 && !waiting) {
      const id = ++gainId;
      gained = { n: pendingGain, id };
      pendingGain = 0;
      clearTimeout(gainTimer);
      gainTimer = setTimeout(() => { if (gained?.id === id) gained = null; }, 1000);
    }
  });
</script>

<div class="seat {place}" bind:this={el} class:turn class:dim class:reveal class:empty class:picked aria-current={turn ? 'true' : undefined} {@attach attach}>
  <!-- On its turn the name tag lights up in plum. -->
  <div class="stand">
    {#if empty}
      <!-- The dashed outline of a figure waiting to be filled. -->
      <svg class="outline" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg>
    {:else}
    <PlayerFigure
      {team}
      {trumpSuit}
      isBot={bot}
      thinking={turn && bot}
      {lookAt}
      {mood}
      {offline}
    />
    {/if}
    {#if clock}<TurnRing deadline={clock.deadline} total={clock.total} />{/if}
  </div>
  <div class="meta">
    <!-- The badge itself announces 주공 and 프렌드: it pops in when it appears. -->
    {#if team}{#key team}<Badge {team} size="sm" ringed class="pop" />{/key}
    {:else if secretFriend}<Badge secret size="sm" ringed class="pop" title="나만 알아요: 부른 카드를 내면 모두 알게 돼요" />{/if}
    {#if points > 0}
      {#key points}<Badge class={gained ? 'bump' : ''}>{points}점</Badge>{/key}
    {/if}
    {#if score !== null && !empty}<Badge class="score" negative={score < 0} title="누적 점수" label="누적 {score}점">{score > 0 ? '+' : ''}{score}</Badge>{/if}
  </div>
  <div class="name-row">
    {#if away || offline}
      <span class="status-icons">
        {#if away}<span class="away-dot" title="자리 비움" aria-label="자리 비움"></span>{/if}
        {#if offline}<span class="dot" title="연결 끊김" aria-label="연결 끊김"></span>{/if}
      </span>
    {/if}
    <span class="name" title={name}>{name}</span>
    {#if turn && bot}<span class="thinking" aria-label="생각하는 중"><i></i><i></i><i></i></span>{/if}
  </div>
  <FeedbackDock {reaction} {cue} credit={gained} bid={bubble} />
</div>

<style>
  .away-dot { width: 7px; height: 7px; flex: none; border: 1px solid currentColor; border-radius: 50%; }
  .seat {
    position: relative;
    display: grid;
    /* One column no wider than the seat, so long names end in an ellipsis. */
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    gap: 2px;
    /* The figure grows with the table's height (the ring is a size
       container): small on phones, larger on desktop. */
    --figure-w: var(--seat-figure, clamp(36px, 10cqh, 64px));
    width: var(--seat-w, 92px);
    padding: 2px 4px;
    color: var(--ink-muted);
    text-align: center;
    transition: color var(--dur-quick) var(--ease-standard);
  }
  .seat.turn {
    color: var(--ink);
  }
  /* The figure; on its turn the name tag below lights up. */
  .stand::before {
    /* SVG head centre: (60, 48) in its 120 × 110 viewBox. A true circle
       behind the head, with the shoulders deliberately extending below. */
    content: ''; position: absolute; left: 50%; top: calc(48 / 110 * 100%);
    width: 72%; aspect-ratio: 1; border-radius: 50%;
    transform: translate(-50%, -50%);
    background: var(--accent); opacity: 0; pointer-events: none;
    transition: opacity var(--dur-quick) var(--ease-standard);
  }
  .seat.turn .stand::before { opacity: 0.14; }
  .meta :global(.count) { font-size: 11px; padding-inline: 4px; }
  @media (orientation: portrait) and (min-height: 700px) and (max-width: 599px) {
    .seat { --figure-w: var(--seat-figure, clamp(44px, 10cqh, 68px)); }
  }
  .stand {
    position: relative;
    width: var(--figure-w);
  }
  /* The friend's seat turns over like a card. */
  .seat.reveal {
    animation: reveal 520ms var(--ease-standard);
  }
  @keyframes reveal {
    0% {
      transform: perspective(500px) rotateX(0);
    }
    50% {
      transform: perspective(500px) rotateX(90deg);
    }
    100% {
      transform: perspective(500px) rotateX(0);
    }
  }
  :global(:root[data-motion='reduced']) .seat.reveal {
    animation: none;
  }
  .seat.dim {
    opacity: 0.6;
  }
  /* Picked first in a swap: it stands up a little, in ink. */
  .seat.picked {
    translate: 0 -4px;
    color: var(--ink);
  }
  /* An empty seat: an outline the size of a figure, and a muted name. */
  .outline {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 4;
    stroke-dasharray: 8 7;
    stroke-linecap: round;
  }
  .seat.empty .name {
    font-weight: 500;
  }
  .name-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 1px 8px;
    border-radius: var(--r-pill);
    transition:
      background-color var(--dur-quick) var(--ease-standard),
      color var(--dur-quick) var(--ease-standard);
  }
  /* Whose turn it is: the name tag fills with plum. */
  .seat.turn .name-row {
    background: var(--accent);
    color: var(--on-accent);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 7em;
    font-size: var(--name-size, 15px);
    font-weight: 600;
    line-height: 1.27;
  }
  /* Status and thinking sit outside the centered name, without moving it. */
  .status-icons { position: absolute; right: calc(100% + 4px); display: inline-flex; align-items: center; gap: 3px; }
  .status-icons, .thinking { color: var(--ink-muted); }
  /* A bot deciding: three dots breathing in turn. */
  .thinking {
    position: absolute;
    left: calc(100% + 4px);
    display: inline-flex;
    gap: 2px;
  }
  .thinking i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: think 1.2s ease-in-out infinite;
  }
  .thinking i:nth-child(2) {
    animation-delay: 150ms;
  }
  .thinking i:nth-child(3) {
    animation-delay: 300ms;
  }
  @keyframes think {
    0%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }
  /* Team badge and points are pinned on the robe, like a name tag, so the
     seat stays about as short as the old plate. */
  .meta {
    position: relative;
    margin-top: calc(var(--figure-w) * -0.14);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 4px;
    font-size: var(--text-label);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  /* Reserve metadata during play; a compact between-hand layout may
     release the empty spacer while keeping any badges at their own height. */
  .meta {
    min-height: var(--seat-meta-min, 20px);
  }
  /* Tablets: the seats grow with the table instead of staying phone-sized. */
  @media (min-width: 600px) {
    .seat {
      --figure-w: var(--seat-figure, clamp(40px, 9cqh, 84px));
      --name-size: clamp(15px, 2.3cqw, 19px);
    }
    .meta {
      font-size: clamp(13px, 1.8cqw, 15px);
    }
  }
  @media (min-width: 1024px) and (min-height: 640px) {
    /* Desktop: the same stacked character as on phones (figure, badge on
       its chest, name tag below), just larger. */
    .seat {
      --figure-w: var(--seat-figure, clamp(56px, 14cqh, 80px));
    }
    .name {
      font-size: 16px;
    }
  }
</style>
