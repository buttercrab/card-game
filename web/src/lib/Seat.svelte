<script lang="ts" module>
  export type Team = 'declarer' | 'friend' | 'defense';
  export const TEAM_LABEL: Record<Team, string> = { declarer: '주공', friend: '프렌드', defense: '야당' };
</script>

<script lang="ts">
  let {
    name,
    bot = false,
    offline = false,
    team = null,
    points = 0,
    turn = false,
    bubble = null,
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
    /** Out of the current round, such as after passing. */
    dim?: boolean;
    /** Just revealed as the friend. */
    reveal?: boolean;
  } = $props();
</script>

<div class="seat" class:turn class:dim class:reveal aria-current={turn ? 'true' : undefined}>
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
  .seat.reveal {
    animation: reveal var(--dur-reveal) var(--ease-standard);
  }
  @keyframes reveal {
    0% {
      transform: scale(1);
      box-shadow: 0 0 0 0 var(--team-declarer);
    }
    35% {
      transform: scale(1.12);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 14px transparent;
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
