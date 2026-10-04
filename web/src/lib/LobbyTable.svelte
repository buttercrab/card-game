<script lang="ts">
  // The lobby drawn as the table itself: five seats around an oval, in the
  // places they will have once the hand is dealt (you at the bottom, then
  // right, top right, top left, left; see Table.svelte). Empty seats are a
  // dashed outline waiting to be filled; a human who sits down slides in and
  // a bot bows as it is added.
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
<div class="room-table">
  <div class="oval" aria-hidden="true"></div>
  <div class="centre">{@render centre?.()}</div>

  {#each order as i, r (i)}
    {@const s = room.seats[i]}
    <div class="seat pos-{n === 5 ? r : 'free'}"
      style:--x={Math.cos(((90 - (r * 360) / n) * Math.PI) / 180)}
      style:--y={Math.sin(((90 - (r * 360) / n) * Math.PI) / 180)}
      class:me={me === i} role="group" aria-label={label(i)}>
      <div class="body" bind:this={bodies[i]}>
        {#if s.kind === 'empty' && !seated}
          <button class="sit" onclick={() => onsit(i)} aria-label="{i + 1}번 자리에 앉기">
            <span class="fig"><svg class="outline" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg></span>
            <span class="name muted">빈 자리</span>
            <span class="sit-cue">앉기</span>
          </button>
        {:else}
          <span class="fig" bind:this={figures[i]}>
            {#if s.kind === 'empty'}
              <svg class="outline" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg>
            {:else}
              <PlayerFigure still isBot={s.kind === 'bot'} offline={s.kind === 'human' && !s.connected} />
            {/if}
            {#if s.kind === 'bot' && seated && !room.in_hand}
              <button class="remove" onclick={() => onremovebot(i)} aria-label="{botName(i)} 빼기">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3 L9 9 M9 3 L3 9" /></svg>
              </button>
            {/if}
          </span>

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
            <select
              class="level"
              aria-label="{botName(i)} 실력"
              value={s.level ?? 'hard'}
              onchange={(e) => onaddbot(i, e.currentTarget.value as BotLevel)}
            >
              <option value="easy">초보</option>
              <option value="normal">보통</option>
              <option value="hard">고수</option>
            </select>
          {:else if s.kind === 'bot'}
            <span class="tag">{LEVEL[s.level ?? 'hard']}</span>
          {:else if s.kind === 'human' && !s.connected && seated}
            <button class="act" onclick={() => onaddbot(i)}>봇으로 바꾸기</button>
          {/if}
        {/if}
      </div>
    </div>
  {/each}
</div>
</div>

<style>
  /* The table: seats on the rim of a flat oval, the middle left for what
     happens next. Seats are sized from the width, so a phone gets 84px
     seats and a desktop up to 128px. */
  .frame {
    container-type: inline-size;
    min-width: 0;
  }
  .room-table {
    --seat-w: clamp(84px, 17cqw, 128px);
    position: relative;
    height: clamp(430px, 64cqw, 520px);
  }
  .oval {
    position: absolute;
    inset: 13% calc(var(--seat-w) * 0.5) 17%;
    border: 2px solid var(--line);
    border-radius: 50%;
    background: var(--panel);
  }
  .centre {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: calc(100% - 2 * var(--seat-w) - 16px);
    display: grid;
    justify-items: center;
    gap: 6px;
    text-align: center;
  }

  .seat {
    position: absolute;
    width: var(--seat-w);
  }
  /* The same bands as the table: bottom, right, top right, top left, left. */
  .pos-0 {
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
  }
  .pos-1 {
    right: 0;
    top: 47%;
    transform: translateY(-50%);
  }
  .pos-2,
  .pos-3 {
    top: 0;
    transform: translateX(-50%);
  }
  .pos-2 {
    left: 72%;
  }
  .pos-3 {
    left: 28%;
  }
  .pos-4 {
    left: 0;
    top: 47%;
    transform: translateY(-50%);
  }
  /* Any other count: round the oval, seat 0 at the bottom. */
  .pos-free {
    left: calc(50% + var(--x) * 40%);
    top: calc(50% + var(--y) * 38%);
    transform: translate(-50%, -50%);
  }

  .body {
    display: grid;
    justify-items: center;
    gap: 3px;
    text-align: center;
    word-break: keep-all;
  }
  .fig {
    position: relative;
    display: block;
    width: 72%;
    max-width: 76px;
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
  .act,
  .level {
    min-height: 36px;
    max-width: 100%;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
  }
  .act {
    box-shadow: 0 2px 0 var(--card-edge);
  }
  .level {
    width: 100%;
    max-width: 92px;
    border: 1px solid var(--line);
    background: var(--table);
    color: var(--ink);
    text-align: center;
    text-align-last: center;
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
  .sit .fig {
    width: 72%;
  }
  .sit-cue {
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--card);
    color: #1c1915;
    box-shadow: 0 2px 0 var(--card-edge);
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
    top: 6%;
    right: -12%;
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
