<script lang="ts">
  // The lobby as a row of seat tiles, like a character select: one tile per
  // seat in table order, starting from yours. Empty seats are dashed tiles
  // waiting to be filled; a human who sits down slides in and a bot bows as
  // it is added. The start button sits below.
  import type { Snippet } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { EASE_SETTLE, EASE_STANDARD } from './motion';
  import { botName } from './names';
  import PlayerFigure from './PlayerFigure.svelte';
  import { settings } from './settings.svelte';
  import type { BotLevel, RoomMsg } from './types';

  let {
    room,
    me,
    onsit,
    onaddbot,
    onremovebot,
    centre,
  }: {
    room: RoomMsg;
    /** Your seat, or null when you are only watching. */
    me: number | null;
    /** Tapping an empty seat while not seated. */
    onsit: (seat: number) => void;
    onaddbot: (seat: number, level?: BotLevel) => void;
    onremovebot: (seat: number) => void;
    /** What sits in the middle of the table: the start button, a note. */
    centre?: Snippet;
  } = $props();

  const LEVEL: Record<BotLevel, string> = { easy: '초보', normal: '보통', hard: '고수' };
  const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

  const n = $derived(room.seats.length);
  const seated = $derived(me !== null);
  // The same rotation as the table: your seat (or seat 1) at the bottom.
  const bottom = $derived(me ?? 0);
  const order = $derived(Array.from({ length: n }, (_, r) => (bottom + r) % n));

  function label(i: number): string {
    const s = room.seats[i];
    if (s.kind === 'empty') return `${i + 1}번 자리, 빈 자리`;
    if (s.kind === 'bot') return `${i + 1}번 자리, 봇 ${botName(i)}, ${LEVEL[s.level ?? 'hard']}`;
    return `${i + 1}번 자리, ${s.name}${me === i ? ', 나' : ''}${s.connected ? '' : ', 연결 끊김'}`;
  }

  // ---- Arrivals ------------------------------------------------------------
  const moving = $derived(settings.speed !== 'off' && !prefersReducedMotion.current);
  const bodies: HTMLElement[] = [];
  const figures: HTMLElement[] = [];
  let before: string[] | null = null;
  $effect(() => {
    const now = room.seats.map((s) => s.kind);
    const was = before;
    before = now;
    if (!was || !moving) return;
    now.forEach((kind, i) => {
      if (kind === was[i]) return;
      if (kind === 'human') {
        // Slides in from outside the table, towards its seat.
        bodies[i]?.animate(
          [
            { transform: 'translateY(14px)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 320, easing: EASE_STANDARD },
        );
      } else if (kind === 'bot') {
        figures[i]?.animate(
          [{ transform: 'none' }, { transform: 'translateY(2px) rotate(4deg)', offset: 0.4 }, { transform: 'none' }],
          { duration: 420, easing: EASE_SETTLE },
        );
      }
    });
  });
</script>

<div class="frame">
  <ol class="tiles">
    {#each order as i (i)}
      {@const s = room.seats[i]}
      <li class="tile" class:me={me === i} class:empty={s.kind === 'empty'} aria-label={label(i)}>
        <span class="no" aria-hidden="true">{i + 1}</span>
        <div class="body" bind:this={bodies[i]}>
          {#if s.kind === 'empty' && !seated}
            <button class="sit" onclick={() => onsit(i)} aria-label="{i + 1}번 자리에 앉기">
              <span class="fig">{@render outline()}</span>
              <span class="name muted">빈 자리</span>
              <span class="sit-cue">앉기</span>
            </button>
          {:else}
            <span class="fig" bind:this={figures[i]}>
              {#if s.kind === 'empty'}
                {@render outline()}
              {:else}
                <PlayerFigure still isBot={s.kind === 'bot'} offline={s.kind === 'human' && !s.connected} />
              {/if}
            </span>
            {#if s.kind === 'bot' && seated && !room.in_hand}
              <button class="remove" onclick={() => onremovebot(i)} aria-label="{botName(i)} 빼기">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3 L9 9 M9 3 L3 9" /></svg>
              </button>
            {/if}

            {#if s.kind === 'empty'}
              <span class="name muted">빈 자리</span>
            {:else}
              <span class="name">{s.kind === 'bot' ? botName(i) : s.name}</span>
            {/if}

            {#if me === i || (s.kind === 'human' && !s.connected)}
              <span class="tags">
                {#if me === i}<span class="tag">나</span>{/if}
                {#if s.kind === 'human' && !s.connected}<span class="tag warn">연결 끊김</span>{/if}
              </span>
            {/if}

            {#if room.hands_played > 0}
              <span class="score" class:neg={room.scores[i] < 0} title="누적 점수" aria-label="누적 점수 {room.scores[i]}점">
                {room.scores[i] > 0 ? '+' : ''}{room.scores[i]}
              </span>
            {/if}

            {#if s.kind === 'empty' && seated}
              <button class="act" onclick={() => onaddbot(i)}>봇 넣기</button>
            {:else if s.kind === 'bot' && seated}
              <!-- The level as three small chips, not a dropdown. -->
              <span class="levels" role="radiogroup" aria-label="{botName(i)} 실력">
                {#each LEVELS as l (l)}
                  <button
                    role="radio"
                    aria-checked={(s.level ?? 'hard') === l}
                    onclick={() => (s.level ?? 'hard') !== l && onaddbot(i, l)}>{LEVEL[l]}</button>
                {/each}
              </span>
            {:else if s.kind === 'bot'}
              <span class="tag">{LEVEL[s.level ?? 'hard']}</span>
            {:else if s.kind === 'human' && !s.connected && seated}
              <button class="act" onclick={() => onaddbot(i)}>봇으로 바꾸기</button>
            {/if}
          {/if}
        </div>
      </li>
    {/each}
  </ol>
  <div class="centre">{@render centre?.()}</div>
</div>

{#snippet outline()}
  <svg class="outline" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg>
{/snippet}

<style>
  /* Five seat tiles in a row on desktop; on a phone they wrap three and
     two, centred. */
  .frame {
    min-width: 0;
  }
  .tiles {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* All tiles one width, so a wrapped second row lines up with the first;
     their content sits in the middle. */
  /* One frame for every tile, 2px: a filled seat is a panel with a solid
     edge, an empty one a dashed outline, yours an ink edge (and the 나 tag). */
  .tile {
    position: relative;
    display: grid;
    align-content: center;
    flex: 0 0 calc((100% - 40px) / 5);
    min-height: clamp(168px, 14vw, 224px);
    padding: 22px 8px 14px;
    border: 2px solid var(--line);
    border-radius: 16px;
    background: var(--panel);
  }
  @media (max-width: 599px) {
    .tile {
      flex-basis: calc((100% - 20px) / 3);
      min-height: 150px;
    }
  }
  .tile.empty {
    background: none;
    border-style: dashed;
  }
  .tile.me {
    border-color: var(--ink);
  }
  .no {
    position: absolute;
    top: 8px;
    left: 11px;
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .centre {
    display: grid;
    justify-items: center;
    gap: 6px;
    margin-top: 20px;
    text-align: center;
  }

  .body {
    display: grid;
    justify-items: center;
    gap: 3px;
    text-align: center;
    word-break: keep-all;
  }
  .fig {
    display: block;
    width: clamp(56px, 40%, 80px);
    margin-bottom: 4px;
  }
  /* An empty seat: the dashed outline of a figure waiting to be filled. */
  .outline {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 3;
    stroke-dasharray: 7 6;
    stroke-linecap: round;
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
  }
  .me .name {
    font-weight: 800;
  }
  .muted {
    color: var(--ink-muted);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
  }
  .tag {
    padding: 1px 7px;
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-muted);
    background: var(--table);
    white-space: nowrap;
  }
  .tag.warn {
    border-color: var(--danger);
    color: var(--danger);
  }
  .score {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .score.neg {
    color: var(--danger);
  }

  /* Seat controls are small chips so five seats fit a phone. */
  .act {
    min-height: 36px;
    max-width: 100%;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
  }
  .act {
    box-shadow: 0 2px 0 var(--btn-lip);
  }
  .levels {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px;
    width: 100%;
    max-width: 150px;
    margin-top: 4px;
    padding: 2px;
    border-radius: 999px;
    background: var(--table);
  }
  .levels button {
    min-height: 30px;
    padding: 2px 0;
    border-radius: 999px;
    background: none;
    box-shadow: none;
    color: var(--ink-muted);
    font-size: 12px;
    font-weight: 600;
  }
  .levels button[aria-checked='true'] {
    background: var(--btn);
    color: var(--on-btn);
    box-shadow: 0 1px 0 var(--btn-lip);
  }

  /* Not seated: an empty seat is one big button that seats you there. */
  .sit {
    display: grid;
    justify-items: center;
    gap: 3px;
    width: 100%;
    min-height: 0;
    padding: 4px 0 6px;
    border-radius: 16px;
    background: transparent;
    box-shadow: none;
    color: var(--ink);
  }
  .sit-cue {
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--btn);
    color: var(--on-btn);
    box-shadow: 0 2px 0 var(--btn-lip);
    font-size: 13px;
  }
  @media (hover: hover) {
    .sit:hover .outline {
      stroke: var(--ink);
    }
  }

  /* Taking a bot out: a small cross on the figure's shoulder, with a full
     44px touch target around it. */
  .remove {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 26px;
    height: 26px;
    min-height: 0;
    padding: 0;
    border-radius: 50%;
    background: var(--table);
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .remove::before {
    content: '';
    position: absolute;
    inset: -9px;
  }
  .remove svg {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
  @media (hover: hover) {
    .remove:hover {
      color: var(--ink);
    }
  }
</style>
