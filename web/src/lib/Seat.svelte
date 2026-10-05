<script lang="ts" module>
  export type Team = 'declarer' | 'friend' | 'defense';
  export const TEAM_LABEL: Record<Team, string> = { declarer: '주공', friend: '프렌드', defense: '야당' };

  /** A name with its subject particle: 재용이, 민수가, 봇 3이; 나 is 내가. */
  export function subject(name: string): string {
    if (name === '나') return '내가';
    const last = name.charCodeAt(name.length - 1);
    let batchim: boolean;
    if (last >= 0xac00 && last <= 0xd7a3) batchim = (last - 0xac00) % 28 !== 0;
    // Digits read as 영 일 이 삼 사 오 육 칠 팔 구.
    else if (last >= 48 && last <= 57) batchim = [0, 1, 3, 6, 7, 8].includes(last - 48);
    else batchim = true;
    return name + (batchim ? '이' : '가');
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import Callout from './Callout.svelte';
  import { juice } from './motion';
  import PlayerFigure from './PlayerFigure.svelte';
  import TurnRing from './TurnRing.svelte';
  import type { Suit } from './types';
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
    reactSide = 'up',
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
    /** A short note beside the seat, such as a bid or 패스. */
    bubble?: string | null;
    /** A reaction the player just sent; `id` replays it when repeated. */
    reaction?: { text: string; id: number } | null;
    /** Where a reaction rises: over the seat, or beside it, outwards, for the
     * top seats, whose space above is the status line. */
    reactSide?: 'up' | 'left' | 'right';
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
  } = $props();


  let el: HTMLElement;
  $effect(() => {
    if (cue) juice(el, 0.6);
  });

  // Points taken float up from the plate as "+2", then the count bumps.
  let gained = $state<{ n: number; id: number } | null>(null);
  let before = untrack(() => points);
  let gainId = 0;
  $effect(() => {
    const now = points;
    if (now > before) {
      const id = ++gainId;
      gained = { n: now - before, id };
      setTimeout(() => {
        if (gained?.id === id) gained = null;
      }, 900);
    }
    before = now;
  });
</script>

<div class="seat" bind:this={el} class:turn class:dim class:reveal class:empty aria-current={turn ? 'true' : undefined}>
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
      active={turn}
      {lookAt}
      {mood}
      {offline}
    />
    {/if}
    {#if clock}<TurnRing deadline={clock.deadline} total={clock.total} />{/if}
    <!-- A bid or 패스, beside the figure, clear of the neighbours. -->
    {#if bubble}{#key bubble}<span class="bubble"><span class="pop">{bubble}</span></span>{/key}{/if}
  </div>
  <div class="meta">
    <!-- The badge itself announces 주공 and 프렌드: it pops in when it appears. -->
    {#if team}{#key team}<span class="team pop {team === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[team]}</span>{/key}
    {:else if secretFriend}<span class="team secret pop" title="나만 알아요: 부른 카드를 내면 모두 알게 돼요">프렌드</span>{/if}
    {#if points > 0}
      {#key points}<span class="points bump">{points}점</span>{/key}
    {/if}
    {#if away}<span class="away">자리 비움</span>{/if}
    {#if score !== null && !empty}<span class="score" class:neg={score < 0} title="누적 점수" aria-label="누적 {score}점">{score > 0 ? '+' : ''}{score}</span>{/if}
  </div>
  <div class="name-row">
    {#if offline}<span class="dot" title="연결 끊김" aria-label="연결 끊김"></span>{/if}
    <span class="name">{name}</span>
    {#if turn && bot}<span class="thinking" aria-label="생각하는 중"><i></i><i></i><i></i></span>{/if}
  </div>
  {#if gained}{#key gained.id}<span class="gain" aria-hidden="true">+{gained.n}</span>{/key}{/if}
  {#if cue?.text}{#key cue.id}<Callout text={cue.text} />{/key}{/if}
  {#if reaction}
    {#key reaction.id}
      <span class="reaction side-{reactSide}" class:emoji={/^\p{Extended_Pictographic}/u.test(reaction.text)} aria-live="polite">{reaction.text}</span>
    {/key}
  {/if}
</div>

<style>
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
  .stand {
    position: relative;
    width: var(--figure-w);
  }
  .stand :global(.figure) {
    position: relative;
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
  @media (prefers-reduced-motion: reduce) {
    .seat.reveal {
      animation: none;
    }
  }
  .seat.dim {
    opacity: 0.6;
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
  /* The running total: tabular, quiet, red below zero. */
  .score {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--table);
    box-shadow: 0 0 0 1px var(--line);
    font-family: var(--font-display);
    font-weight: 800;
    color: var(--ink);
    line-height: 18px;
  }
  .score.neg {
    color: var(--danger);
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 1px 8px;
    border-radius: 999px;
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
  /* A bot deciding: three dots breathing in turn. */
  .thinking {
    display: inline-flex;
    gap: 2px;
    margin-left: 2px;
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
  .gain {
    position: absolute;
    right: 6px;
    top: 0;
    z-index: 5;
    font-size: 14px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    pointer-events: none;
    animation: gain 900ms var(--ease-standard) both;
  }
  @keyframes gain {
    0% {
      opacity: 0;
      transform: translateY(4px);
    }
    20% {
      opacity: 1;
      transform: translateY(-6px);
    }
    100% {
      opacity: 0;
      transform: translateY(-22px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .thinking i {
      animation: none;
      opacity: 0.6;
    }
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--danger);
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
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  /* Kept even when empty, so every seat is the same height in every phase. */
  .meta {
    min-height: 20px;
  }
  .team {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 18px;
    /* A ring of table colour keeps the badge apart from a robe of the
       same team colour behind it. */
    box-shadow: 0 0 0 2px var(--table);
  }
  .team.declarer {
    background: var(--team-declarer);
    color: #1c1915;
  }
  .team.defense {
    background: var(--team-defense);
    color: var(--on-team-defense);
  }
  /* The 프렌드 only you know about: the team colour as an outline, not yet
     a filled badge, until the called card is played. */
  .team.secret {
    color: var(--ink);
    box-shadow:
      inset 0 0 0 1.5px var(--team-declarer),
      0 0 0 2px var(--table);
    background: var(--table);
  }
  /* 자리 비움: a quiet outlined pill, like a note pinned on the robe. */
  .away {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--table);
    color: var(--ink-muted);
    line-height: 18px;
    font-size: 12px;
    box-shadow: inset 0 0 0 1px var(--ink-muted);
    white-space: nowrap;
  }
  /* Points won: a small pill; the count only, never the cards. */
  .points {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--table);
    color: var(--ink);
    line-height: 18px;
    box-shadow: 0 0 0 1px var(--line);
  }
  /* Rises above the seat, holds, then fades; the client drops it after 2.8 s. */
  .reaction {
    position: absolute;
    left: 50%;
    top: 0;
    z-index: 5;
    padding: 4px 12px;
    border-radius: 16px;
    background: var(--card);
    /* The bubble is card paper in both themes, so its text is card ink. */
    color: var(--card-ink);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.16);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    transform: translate(-50%, -100%);
    animation: react 2.8s var(--ease-standard, ease) both;
  }
  .reaction.emoji {
    padding: 2px 8px;
    font-size: 28px;
  }
  .reaction.side-left,
  .reaction.side-right {
    top: 2px;
    transform: none;
    animation-name: react-side;
  }
  .reaction.side-right {
    left: calc(50% + var(--figure-w) / 2 + 4px);
  }
  .reaction.side-left {
    left: auto;
    right: calc(50% + var(--figure-w) / 2 + 4px);
  }
  @keyframes react-side {
    0% {
      opacity: 0;
      transform: scale(0.6);
    }
    10% {
      opacity: 1;
      transform: scale(1.08);
    }
    16%,
    82% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: translateY(-12px);
    }
  }
  @keyframes react {
    0% {
      opacity: 0;
      transform: translate(-50%, -40%) scale(0.6);
    }
    10% {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1.08);
    }
    16%,
    82% {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -130%) scale(1);
    }
  }
  .bubble {
    position: absolute;
    left: calc(100% - 6px);
    top: 0;
    z-index: 4;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--table);
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    /* A long note (노기루다 20) takes two short lines, so the
       two top seats' notes never meet in the middle. */
    width: max-content;
    max-width: 4.6em;
    line-height: 1.2;
    text-align: center;
    word-break: keep-all;
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
    .reaction.side-right {
      left: calc(100% + 4px);
    }
    .reaction.side-left {
      right: calc(100% + 4px);
    }
  }
</style>
