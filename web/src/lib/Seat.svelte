<script lang="ts" module>
  export type Team = 'declarer' | 'friend' | 'defense';
  export const TEAM_LABEL: Record<Team, string> = { declarer: '주공', friend: '프렌드', defense: '야당' };
</script>

<script lang="ts">
  import Callout from './Callout.svelte';
  import { juice } from './motion';
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
  } = $props();

  let el: HTMLElement;
  $effect(() => {
    if (cue) juice(el, 0.6);
  });
</script>

<div class="seat" bind:this={el} class:turn class:dim class:reveal aria-current={turn ? 'true' : undefined}>
  <div class="name-row">
    {#if offline}<span class="dot" title="연결 끊김" aria-label="연결 끊김"></span>{/if}
    <span class="name">{name}</span>
    {#if bot && !name.startsWith('봇')}<span class="bot" title="봇">봇</span>{/if}
  </div>
  <div class="meta">
    {#if team}<span class="team {team === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[team]}</span>{/if}
    {#if points > 0}{#key points}<span class="points bump">{points}점</span>{/key}{/if}
  </div>
  {#if bubble}{#key bubble}<span class="bubble"><span class="pop">{bubble}</span></span>{/key}{/if}
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
    gap: 3px;
    width: var(--seat-w, 92px);
    padding: 6px 6px 7px;
    border-radius: 12px;
    background: var(--panel);
    color: var(--ink-muted);
    text-align: center;
    transition:
      color var(--dur-quick) var(--ease-standard),
      outline-color var(--dur-quick) var(--ease-standard);
    outline: 3px solid transparent;
    outline-offset: 2px;
  }
  .seat.turn {
    color: var(--ink);
    outline-color: var(--accent);
  }
  /* The friend's plate turns over like a card and comes up in the team colour. */
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
      box-shadow: 0 0 0 3px var(--team-declarer);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .seat.reveal {
      animation: none;
      outline-color: var(--team-declarer);
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
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 600;
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
  .meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 4px;
    min-height: 20px;
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
    color: var(--ink);
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
    color: var(--ink);
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
</style>
