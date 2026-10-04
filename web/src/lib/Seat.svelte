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
  import Card from './Card.svelte';
  import type { Seal } from './cards';
  import PlayerFigure from './PlayerFigure.svelte';
  import type { Card as CardT, Suit } from './types';
  let {
    name,
    bot = false,
    offline = false,
    team = null,
    points = 0,
    turn = false,
    bubble = null,
    reaction = null,
    cue = null,
    dim = false,
    reveal = false,
    trumpSuit = null,
    lookAt = null,
    mood = null,
    pointsOpen = false,
    onpoints = null,
    taken = [],
    seal = () => null,
    twoJokers = true,
  }: {
    name: string;
    bot?: boolean;
    offline?: boolean;
    team?: Team | null;
    /** Point cards won this hand. */
    points?: number;
    turn?: boolean;
    /** A short note beside the seat, such as a bid or 패스. */
    bubble?: string | null;
    /** A reaction the player just sent; `id` replays it when repeated. */
    reaction?: { text: string; id: number } | null;
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
    /** The point cards this seat took are showing. */
    pointsOpen?: boolean;
    /** Makes the points a button that shows the point cards taken. */
    onpoints?: ((anchor: HTMLElement) => void) | null;
    /** The point cards won, drawn as a small fan beside the seat on desktop. */
    taken?: CardT[];
    seal?: (card: CardT) => Seal | null;
    twoJokers?: boolean;
  } = $props();

  /** The fan stays within about 112px however many cards it holds. */
  const FAN_CARD = 30;
  const fanStep = $derived(taken.length <= 1 ? 0 : Math.min(15, (112 - FAN_CARD) / (taken.length - 1)));
  let pill = $state<HTMLElement>();

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

<div class="seat" bind:this={el} class:turn class:dim class:reveal aria-current={turn ? 'true' : undefined}>
  <!-- On its turn the name tag lights up in plum. -->
  <div class="stand">
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
  </div>
  <div class="meta">
    <!-- The badge itself announces 주공 and 프렌드: it pops in when it appears. -->
    {#if team}{#key team}<span class="team pop {team === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[team]}</span>{/key}{/if}
    {#if points > 0}
      {#if onpoints}
        <button
          bind:this={pill}
          type="button"
          class="points peek-btn"
          aria-expanded={pointsOpen}
          aria-haspopup="dialog"
          aria-label="{subject(name)} 가져온 점수 카드 {points}장 보기"
          onclick={(e) => onpoints(e.currentTarget)}
        >{#key points}<span class="bump">{points}점</span>{/key}</button>
      {:else}
        {#key points}<span class="points bump">{points}점</span>{/key}
      {/if}
    {/if}
  </div>
  {#if taken.length > 0}
    <!-- The cards themselves, fanned like a won pile. The pill beside the
         badge is the button for keys and screen readers; this is the same
         thing for a pointer. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="fan"
      class:open={pointsOpen}
      class:live={!!onpoints}
      aria-hidden="true"
      style:--step="{fanStep}px"
      onclick={() => pill && onpoints?.(pill)}
    >
      {#each taken as c, i (JSON.stringify(c))}
        <span class="fan-card" style:--i={i} style:--tilt="{((i * 5) % 7) - 3}deg"><Card card={c} size="mini" width={FAN_CARD} seal={seal(c)} {twoJokers} /></span>
      {/each}
    </div>
  {/if}
  <div class="name-row">
    {#if offline}<span class="dot" title="연결 끊김" aria-label="연결 끊김"></span>{/if}
    <span class="name">{name}</span>
    {#if bot && !name.startsWith('봇')}<span class="bot" title="봇">봇</span>{/if}
    {#if turn && bot}<span class="thinking" aria-label="생각하는 중"><i></i><i></i><i></i></span>{/if}
  </div>
  {#if bubble}{#key bubble}<span class="bubble"><span class="pop">{bubble}</span></span>{/key}{/if}
  {#if gained}{#key gained.id}<span class="gain" aria-hidden="true">+{gained.n}</span>{/key}{/if}
  {#if cue?.text}{#key cue.id}<Callout text={cue.text} />{/key}{/if}
  {#if reaction}
    {#key reaction.id}
      <span class="reaction" class:emoji={/^\p{Extended_Pictographic}/u.test(reaction.text)} aria-live="polite">{reaction.text}</span>
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
  /* The friend's plate turns over like a card. */
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
    font-size: 15px;
    font-weight: 600;
    line-height: 19px;
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
  .bot {
    flex: none;
    padding: 0 5px;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
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
  .meta:empty {
    display: none;
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
  .points {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--table);
    color: var(--ink);
    line-height: 18px;
  }
  /* A button only by its hit area: it looks like the pill beside it. */
  .peek-btn {
    position: relative;
    display: inline-block;
    min-height: 0;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--table);
    color: var(--ink);
    font-size: 13px;
    line-height: 18px;
    /* A hairline says it opens; no lip, it is a label first. */
    box-shadow: 0 0 0 1px var(--line);
  }
  /* A 44px target round an 18px pill. */
  .peek-btn::before {
    content: '';
    position: absolute;
    inset: -13px -8px;
  }
  .peek-btn[aria-expanded='true'] {
    background: var(--ink);
    color: var(--table);
    box-shadow: none;
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
    left: 50%;
    bottom: -12px;
    transform: translate(-50%, 50%);
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--table);
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  /* The won pile: hidden on phones, where the pill says the same. */
  .fan {
    display: none;
  }
  @media (min-width: 1024px) and (min-height: 640px) {
    /* Desktop: a plate with the figure on the left and the name, badges and
       won pile stacked beside it, so a seat carries more at a glance. */
    .seat {
      --figure-w: var(--seat-figure, clamp(56px, 14cqh, 80px));
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        'stand name'
        'stand meta'
        'stand fan';
      align-content: center;
      justify-items: start;
      column-gap: 10px;
      row-gap: 3px;
      padding: 4px 6px;
      text-align: left;
    }
    .stand {
      grid-area: stand;
      align-self: center;
    }
    .name-row {
      grid-area: name;
      align-self: end;
    }
    .name {
      font-size: 16px;
    }
    .meta {
      grid-area: meta;
      margin-top: 0;
      flex-wrap: nowrap;
      justify-content: flex-start;
    }
    .meta:empty {
      display: flex;
      min-height: 18px;
    }
    .fan {
      grid-area: fan;
      display: flex;
      align-self: start;
      height: 44px;
      padding-top: 2px;
    }
    .fan.live {
      cursor: pointer;
    }
    .fan-card {
      display: block;
      rotate: var(--tilt);
      transition: translate var(--dur-quick) var(--ease-standard);
      animation: fan-in var(--dur-move) var(--ease-settle) both;
    }
    .fan-card + .fan-card {
      margin-left: calc(var(--step) - 30px);
    }
    /* Pointing at the pile lifts it a little, as the cards in hand do. */
    .fan.live:hover .fan-card,
    .fan.open .fan-card {
      translate: 0 -3px;
    }
    .fan-card :global(.card) {
      box-shadow: 0 1px 0 rgb(28 25 21 / 0.12);
    }
    @keyframes fan-in {
      from {
        opacity: 0;
        translate: 0 -8px;
      }
    }
    .bubble {
      left: calc(var(--figure-w) / 2 + 6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fan-card {
      animation: none;
    }
  }
</style>
