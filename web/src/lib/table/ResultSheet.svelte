<script lang="ts" module>
  /** Results already counted out, so one reopened (or unfolded) shows at once. */
  const counted = new Set<string>();
</script>

<script lang="ts">
  // The hand's result. It rises from the foot of the table (the hand is
  // empty by now) and stops under the seats; its buttons are its own
  // footer. The count is played out step by step, as 맞고 and mahjong
  // results are: the points, over or short, each ×2, then everyone's
  // payoff. A tap anywhere skips it.
  import { BACK_NAMES, TABLE_NAMES, type Achievement } from '../achievements';
  import { after, later } from '../clock';
  import Icon from '../Icon.svelte';
  import { motion } from '../settings.svelte';
  import { sound } from '../sound';
  import SuitText from '../SuitText.svelte';
  import type { RoomView } from '../types';
  import Badge, { type Team } from '../ui/Badge.svelte';
  import { resultOf, wonHand, type Done } from './view';

  let {
    done,
    me,
    room,
    seatName,
    team,
    points,
    earned,
    seated,
    shuffleNote,
    fit,
    need = $bindable(0),
    onfold,
    onreplay,
    onshare,
    onstart,
    onrun,
  }: {
    done: Done;
    me: number | null;
    room: RoomView | null;
    seatName: (seat: number) => string;
    team: (seat: number) => Team | null;
    points: (seat: number) => number;
    /** Achievements this hand earned, shown at its foot once it settles. */
    earned: Achievement[];
    seated: boolean;
    shuffleNote: string | null;
    /** Where it may start, from the felt's top, and how wide it may be. */
    fit: { top: number; width: number | null } | null;
    /** How tall it would be with nothing cut off (for the table's fit). */
    need?: number;
    onfold: () => void;
    onreplay: () => void;
    onshare: () => void;
    onstart: () => void;
    /** A 런, counted out: the table settles once under the gold word. */
    onrun: () => void;
  } = $props();

  const result = $derived(resultOf(done));
  const full = $derived(room?.seats.every((s) => s.kind !== 'empty') ?? false);
  const mineWon = $derived(me !== null && wonHand(done, me));

  let step = $state(99);
  let shownPay = $state<number[]>([]);
  /** The result has been counted out (or shown at once). */
  let tallied = $state(false);
  $effect(() => {
    const key = `${room?.id}-${room?.hands_played}-${JSON.stringify(done.payoffs)}`;
    const instant = counted.has(key) || motion.level !== 'full';
    counted.add(key);
    const pays = done.payoffs;
    const lines = result.lines.length;
    if (instant) {
      step = 99;
      shownPay = pays;
      tallied = true;
      return;
    }
    tallied = false;
    step = 0;
    shownPay = pays.map(() => 0);
    let cancelled = false;
    const k = motion.speed;
    (async () => {
      await after(450 * k);
      for (let i = 1; i <= lines && !cancelled; i++) {
        step = i;
        sound.tally(i);
        await after(380 * k);
      }
      if (cancelled) return;
      step = lines + 1;
      const t0 = performance.now();
      const span = 520 * k;
      const frame = (now: number) => {
        if (cancelled) return;
        const f = Math.min((now - t0) / span, 1);
        const ease = 1 - (1 - f) ** 3;
        shownPay = pays.map((p) => Math.round(p * ease));
        // A hidden tab draws no frames: the count steps on the worker clock.
        if (f < 1) (document.hidden ? later(() => frame(performance.now()), 50) : requestAnimationFrame(frame));
        else {
          tallied = true;
          if (result.run) {
            sound.run();
            onrun();
          }
        }
      };
      frame(t0);
    })();
    return () => {
      cancelled = true;
    };
  });
  function skip() {
    if (step < 99) {
      step = 99;
      shownPay = done.payoffs;
      tallied = true;
    }
  }

  // An award arrives at the foot once the count settles; on a short phone
  // the result scrolls, so it is brought into view.
  let achieved = $state<HTMLElement>();
  $effect(() => {
    if (!earned.length) return;
    const start = setTimeout(() => {
      sound.achieve();
      achieved?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 1800);
    return () => clearTimeout(start);
  });

  let body = $state<HTMLElement>();
  let foot = $state<HTMLElement>();
  $effect(() => {
    if (!body || !foot) return;
    const measure = () => (need = body!.scrollHeight + foot!.offsetHeight);
    const sized = new ResizeObserver(measure);
    sized.observe(body);
    sized.observe(foot);
    measure();
    return () => sized.disconnect();
  });
</script>

<div
  class="result-layer"
  class:cover={!!fit?.width}
  style:--fit-top={fit ? `${fit.top}px` : undefined}
  style:--fit-w={fit?.width ? `${fit.width}px` : undefined}
>
  <!-- A tap anywhere on the result skips the count; keys need nothing to skip. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div class="sheet result" class:big={result.made && result.margin >= 3} class:lost={!mineWon && me !== null} role="status" onclick={skip}>
    <!-- Folds the result down to look at the table; the middle of the
         table then offers the next hand and brings the result back. -->
    <button
      class="btn ghost fold"
      onclick={(e) => {
        e.stopPropagation();
        onfold();
      }}><span>테이블 보기</span><Icon name="fold" size="18px" /></button
    >
    <div class="body" bind:this={body}>
      <div class="head">
        <p class="headline">
          {#if result.run && tallied}<span class="run-word">런</span>{:else}{result.won ? '여당 승리' : '야당 승리'}{/if}
        </p>
        <!-- When made, the first line of the count already says the points. -->
        <p class="sub" class:said={result.made}>여당 <strong>{done.team_points}</strong> / 공약 {done.contract.count}</p>
        <ol class="ledger" aria-label="점수 계산">
          {#each result.lines as line, i (i)}
            <li class:shown={step > i} class:total={i === result.lines.length - 1}><SuitText text={line} /></li>
          {/each}
        </ol>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col" class="who">이름</th>
            <th scope="col" class="role">역할</th>
            <th scope="col" class="num">점수</th>
            <th scope="col" class="num">이번 판</th>
            <th scope="col" class="num">누적</th>
          </tr>
        </thead>
        <tbody>
          {#each done.payoffs as pay, s (s)}
            {@const t = team(s)}
            <tr class:me={s === me}>
              <td class="who">{seatName(s)}</td>
              <td class="role">{#if t}<Badge team={t} />{/if}</td>
              <td class="num">{points(s)}</td>
              <td class="num" class:neg={pay < 0}>{(shownPay[s] ?? pay) > 0 ? '+' : ''}{shownPay[s] ?? pay}</td>
              <td class="num">{room?.scores[s] ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if earned.length}
        <div class="achieved" role="status" bind:this={achieved}>
          {#each earned as a (a.id)}
            <div class="award" title={a.how}>
              <span class="kicker">업적 달성</span>
              <strong>{a.title}</strong>
              {#if a.reward}
                <span class="reward">
                  {a.reward.kind === 'back' ? '카드 뒷면' : '테이블 색'}
                  ‘{a.reward.kind === 'back' ? BACK_NAMES[a.reward.id] : TABLE_NAMES[a.reward.id]}’을 쓸 수 있어요 · 설정
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <div class="foot" bind:this={foot}>
      {#if seated && !full}<p class="muted wait-seats">빈 자리를 채우면 다음 판을 시작할 수 있어요</p>
      {:else if shuffleNote}<p class="muted wait-seats" role="status">{shuffleNote}</p>{/if}
      <div class="next">
        {#if done.tricks.length}<button class="btn" onclick={onreplay}>다시 보기</button>{/if}
        {#if room}<button class="btn" onclick={onshare}>결과 카드</button>{/if}
        {#if me !== null}<button class="btn primary" disabled={!seated || !full} onclick={onstart}>다음 판</button>{/if}
      </div>
    </div>
  </div>
</div>

<style>
  /* The result's room: from under the seats to the table's foot, in the
     felt's column. */
  .result-layer {
    position: absolute;
    grid-column: felt;
    grid-row: felt-start / tray-end;
    inset: var(--fit-top, var(--seat-top)) 0 0;
    z-index: var(--z-result);
    display: flex;
    justify-content: center;
    align-items: flex-end;
    pointer-events: none;
  }
  .sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(100%, 440px);
    max-height: 100%;
    overflow: hidden;
    border-radius: var(--r-panel);
    background: var(--panel);
    box-shadow: var(--lip);
    pointer-events: auto;
  }
  .body {
    min-height: 0;
    overflow: auto;
    padding: 14px 16px 8px;
  }
  /* Phones have no room beside the side seats: the sheet covers them
     whole, from under the top seats down, rather than cutting them in
     half; so does a wider screen whose result does not fit beside them. */
  .cover .sheet {
    height: 100%;
  }
  .cover .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: safe center;
  }
  @media (max-width: 599px) {
    .sheet {
      height: 100%;
    }
    .body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: safe center;
    }
  }
  @media (min-width: 600px) {
    .sheet {
      width: min(100%, max(440px, var(--fit-w, 0px)));
    }
  }
  .foot {
    flex: none;
    padding: 8px 16px 14px;
  }
  /* A short desktop window: the result tightens to fit. */
  @media (min-width: 600px) and (max-height: 760px) {
    .body {
      padding: 8px 14px 4px;
    }
    /* The headline and its count side by side. */
    .head {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 4px 16px;
    }
    .head .ledger {
      text-align: left;
    }
    .headline {
      font-size: var(--text-headline);
    }
    .sub.said {
      display: none;
    }
    .ledger {
      margin: 2px 0 4px;
    }
    th {
      padding: 2px 4px;
    }
    td {
      height: 26px;
    }
    .foot {
      padding: 4px 14px 8px;
    }
    .foot .btn {
      min-height: 40px;
    }
  }
  /* The result's buttons fill its width; the primary takes what is left;
     room at the start for your tools, which the table places there. */
  .next {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding-left: var(--tools-room, 0px);
  }
  .next .primary {
    flex: 1 1 auto;
    min-width: 120px;
  }
  .next > .btn:not(.primary) {
    flex: none;
  }
  /* A label never breaks; on a narrow phone the primary wraps to its own row. */
  .next > .btn {
    white-space: nowrap;
  }
  .wait-seats {
    margin: 0 0 8px;
    font-size: var(--text-label);
  }
  .result {
    text-align: center;
    animation: rise var(--dur-reveal) var(--ease-settle) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 24px;
      scale: 0.96;
    }
  }
  .result p {
    margin: 0;
  }
  /* Result rows come in one after another (Wordle's stats sheet). */
  tbody tr {
    animation: fade-up 260ms var(--ease-standard) both;
  }
  tbody tr:nth-child(2) {
    animation-delay: 60ms;
  }
  tbody tr:nth-child(3) {
    animation-delay: 120ms;
  }
  tbody tr:nth-child(4) {
    animation-delay: 180ms;
  }
  tbody tr:nth-child(5) {
    animation-delay: 240ms;
  }
  :global(:root[data-motion='reduced']) :is(.result, tbody tr, .achieved, .run-word) {
    animation-name: fade;
  }
  .ledger {
    display: grid;
    gap: 2px;
    margin: 8px 0 10px;
    padding: 0;
    list-style: none;
    font-variant-numeric: tabular-nums;
    font-size: var(--text-body);
    color: var(--ink-muted);
  }
  .ledger li {
    opacity: 0;
    transform: translateY(4px);
    transition:
      opacity 200ms var(--ease-standard),
      transform 200ms var(--ease-standard);
  }
  .ledger li.shown {
    opacity: 1;
    transform: none;
  }
  .ledger li.total {
    color: var(--ink);
    font-weight: 700;
  }
  /* Phones: the result fits under the top seats without scrolling. */
  @media (max-width: 599px) {
    .headline {
      font-size: 24px;
    }
    .big .headline {
      font-size: 28px;
    }
    .run-word {
      font-size: 40px;
    }
    .sub.said {
      display: none;
    }
    .ledger {
      margin: 4px 0 6px;
      font-size: 14px;
    }
    td {
      height: 28px;
    }
    .body {
      padding: 10px 12px 4px;
    }
    .foot {
      padding: 6px 12px 10px;
    }
    .next {
      flex-wrap: nowrap;
      gap: 6px;
    }
    .next > .btn:not(.primary) {
      padding-inline: 12px;
    }
    .next .primary {
      min-width: 0;
    }
  }
  /* An earned achievement slides up after the result. */
  .achieved {
    display: grid;
    gap: 6px;
    margin-top: 12px;
    animation: achieved 420ms var(--ease-settle) 1.6s both;
  }
  @keyframes achieved {
    from {
      opacity: 0;
      translate: 0 10px;
    }
  }
  /* One line where it fits: kicker, title, then the reward. */
  .award {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: baseline;
    column-gap: 8px;
    padding: 8px 14px;
    border-radius: var(--r-control);
    background: var(--ink);
    color: var(--table);
    text-align: center;
  }
  .award .kicker {
    font-size: 11px;
    font-weight: 700;
    color: var(--gold);
  }
  .award strong {
    font-family: var(--font-display);
    font-size: 16px;
  }
  .award .reward {
    font-size: var(--text-caption);
    color: var(--gold);
  }
  /* A loss reads quieter, not angrier. */
  .lost .headline {
    color: var(--ink-muted);
  }
  /* 런: the headline turns into one large gold word once the count is done. */
  .run-word {
    display: inline-block;
    font-size: 56px;
    line-height: 1;
    color: var(--gold);
    animation: run-word 520ms var(--ease-settle) both;
  }
  @keyframes run-word {
    from {
      opacity: 0;
      scale: 0.7;
    }
  }
  .big .headline {
    font-size: 36px;
  }
  .headline {
    position: relative;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    line-height: 1.15;
    color: var(--ink);
  }
  .sub {
    margin: 2px 0 0;
    color: var(--ink-muted);
  }
  .sub strong {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th {
    padding: 4px;
    font-size: var(--text-caption);
    font-weight: 600;
    color: var(--ink-muted);
  }
  td {
    height: 34px;
    padding: 0 4px;
    border-top: 1px solid var(--line);
  }
  /* Headers sit over their columns: names left, roles centred, numbers right. */
  .role {
    text-align: center;
  }
  tr.me td {
    font-weight: 700;
  }
  .who {
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .neg {
    color: var(--danger);
  }
  /* Folds the result down to show the table. */
  .fold {
    flex: none;
    align-self: center;
    gap: 4px;
    margin-top: 2px;
    padding: 4px 14px;
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
</style>
