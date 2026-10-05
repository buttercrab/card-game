<script lang="ts">
  // The table: everything about a hand, drawn from the room's latest state
  // as the animator plays it out. It fills the screen exactly, in fixed
  // rows (the top line, the event line, the felt, the action strip and
  // your tray) so nothing moves from the deal to the result; whatever
  // comes and goes lies over them. The parts are in table/: what to show
  // (view.ts, narration.ts, seats.ts), when (the animator), and each region.
  import { tick, untrack } from 'svelte';
  import { checkHand, type Achievement } from './achievements';
  import BidPanel from './BidPanel.svelte';
  import { actionLabel, cardLabel, kittyCount, sameCard, sealOf } from './cards';
  import { CATALOG, presetRules } from './catalog';
  import { savedName } from './client.svelte';
  import { later } from './clock';
  import ExchangePanel from './ExchangePanel.svelte';
  import HandReplay from './HandReplay.svelte';
  import { refusalText } from './ledger';
  import { EASE_STANDARD, juice } from './motion';
  import { setMood } from './music.svelte';
  import SeatMenu from './SeatMenu.svelte';
  import { motion, settings } from './settings.svelte';
  import ShareCard from './ShareCard.svelte';
  import { sound } from './sound';
  import { loadStats, recordHand } from './stats';
  import SuitText from './SuitText.svelte';
  import { Animator } from './table/animator.svelte';
  import Felt, { type SeatView, type TrickNote } from './table/Felt.svelte';
  import Lobby from './table/Lobby.svelte';
  import { tipFor, variantLabel } from './table/narration';
  import { cardKey, Registry } from './table/registry';
  import ResultSheet from './table/ResultSheet.svelte';
  import { moveNames, rememberNames, Ring, seatLabel, seatName as nameOf } from './table/seats';
  import SidePanel from './table/SidePanel.svelte';
  import StatusBar from './table/StatusBar.svelte';
  import Strip from './table/Strip.svelte';
  import ThrownIn from './table/ThrownIn.svelte';
  import Tools from './table/Tools.svelte';
  import Tray from './table/Tray.svelte';
  import { bidNote, callLabel as callLabelOf, handView, moodOf, tagsOf, trickNotes, trickNumber, waitingFor } from './table/view';
  import { TableUi } from './table/ui.svelte';
  import type { TableClient } from './tableClient';
  import type { Action, Card as CardT, PlayAction, StateMsg } from './types';
  import Button from './ui/Button.svelte';
  import Chip from './ui/Chip.svelte';

  let {
    client,
    ui: givenUi,
    rulesName = '',
    onmenu,
    onrules,
    oninvite,
  }: {
    client: TableClient;
    /** What is open at the table: the room page's own, shared with its menu. */
    ui?: TableUi;
    /** The rules' name, for the table between hands. */
    rulesName?: string;
    /** Opens the table's menu (설정 between hands). */
    onmenu?: () => void;
    onrules?: () => void;
    oninvite?: () => void;
  } = $props();
  const ui = untrack(() => givenUi) ?? new TableUi();

  // Between hands, with no hand on the table (the first one, or once the
  // seats moved), the table shows its seats on an empty state of its own.
  const room = $derived(client.room);
  const idle = $derived(client.game === null);
  const blank = $derived.by((): StateMsg => {
    const n = room?.seats.length ?? 5;
    return {
      view: {
        viewer: client.seat === null ? 'Spectator' : { Seat: client.seat },
        rules: room ? room.rules : presetRules(CATALOG.default_preset),
        first_bidder: 0,
        hand: [],
        hand_sizes: Array.from({ length: n }, () => 0),
        points_taken: Array.from({ length: n }, () => []),
        phase: 'Dealing',
        bids: [],
        redealt: null,
      },
      legal: [],
      notes: { unplayable: [], contracts: [] },
      turn: 'Over',
      out_of_turn: [],
      grace_ms: 0,
      version: 0,
    };
  });

  // ---- What is on screen ----------------------------------------------------
  // Elements by key, for the motion: the trick's cards, the seats and their
  // places, the cards in your hand.
  const trickCards = new Registry<number>();
  const seatEls = new Registry<number>();
  const spots = new Registry<number>();
  const handCards = new Registry<string>();
  let section = $state<HTMLElement>();
  let felt = $state<HTMLElement>();
  let ringEl = $state<HTMLElement>();
  let tray = $state<HTMLElement>();
  /** Until when (performance.now()) the seats are sliding to new places;
   * a deal that comes with a shuffle waits for them to arrive. */
  let slidingUntil = 0;

  const animator: Animator = new Animator(
    {
      me: (): number | null => me,
      seatName,
      twoJokers: (): boolean => hand.twoJokers,
      liveTurn: (): boolean => liveTurn,
      trickCard: (seat) => trickCards.get(seat),
      anchor: (seat, card) => {
        if (seat === me) return (card && handCards.rect(cardKey(card))) || tray?.getBoundingClientRect() || null;
        return spots.rect(seat);
      },
      seatElement: (seat) => (seat === me ? (tray ?? null) : seatEls.get(seat)),
      felt: () => felt ?? null,
      slidingUntil: () => slidingUntil,
    },
    untrack(() => client.game ?? blank),
  );
  $effect(() => {
    const next = client.game;
    untrack(() => (next ? animator.push(next) : animator.reset(blank)));
  });
  // The table can open straight onto a fresh deal (the first hand of a
  // room); deal it in then too, not only when a hand follows another.
  $effect(() => {
    const first = untrack(() => animator.shown).view;
    const fresh = typeof first.phase === 'object' && 'Bidding' in first.phase && first.bids.length === 0;
    if (!fresh || motion.level === 'off') return;
    return animator.dealIn();
  });

  const msg = $derived(idle ? blank : animator.shown);
  const view = $derived(msg.view);
  const rules = $derived(view.rules);
  const me = $derived(view.viewer === 'Spectator' ? null : view.viewer.Seat);
  const n = $derived(view.hand_sizes.length);
  const turn = $derived(typeof msg.turn === 'object' ? msg.turn.Seat : null);
  const myTurn = $derived(me !== null && turn === me);
  const hand = $derived(handView(view, me));
  const { bidding, exchange, play, done, contract } = $derived(hand);
  const ring = $derived(new Ring(n, me ?? 0));
  const resolving = $derived(animator.resolving);
  const winner = $derived(animator.winner);

  /** Who last sat at each seat, so a hand still on the table (its result,
   * its replay) names a player who has since left. */
  let known = $state<(string | null)[]>([]);
  $effect(() => {
    const was = untrack(() => known);
    const now = rememberNames(was, room?.seats ?? []);
    if (now.some((name, i) => name !== was[i]) || now.length !== was.length) known = now;
  });
  function seatName(seat: number): string {
    return nameOf(seat, me, room?.seats, known, !idle);
  }
  /** Your own name as the room knows it, for your seat on the tray. */
  const myName = $derived.by(() => {
    const info = me !== null ? room?.seats[me] : null;
    return info?.kind === 'human' ? info.name : '나';
  });

  // Seals mark the mighty and joker-call cards once the trump is known.
  function seal(card: CardT) {
    if (contract) return sealOf(card, rules, contract.trump);
    return 'Joker' in card ? 'joker' : null;
  }

  const trickNo = $derived(trickNumber(play, resolving?.key ?? null));
  const tags = $derived(tagsOf(hand, rules.hand_size, trickNo, resolving !== null));
  const callLabel = $derived(callLabelOf(hand, seatName));
  const waiting = $derived(waitingFor(hand, turn, seatName));
  const onTable = $derived(resolving ? resolving.plays : (play?.plays ?? []));
  /** Who is winning the trick so far, by the server's reckoning; nobody
   * while a finished trick resolves, when the winner is shown instead. */
  const leading = $derived(resolving ? null : (play?.leading ?? null));

  // A soft chime whenever a new tag appears; reaching the contract
  // resolves the chord.
  let shownTags = '';
  $effect(() => {
    const now = tags.map((t) => t.text);
    const fresh = now.filter((t) => !shownTags.split('|').includes(t));
    if (fresh.includes('공약 확정')) sound.resolve();
    else if (fresh.length) sound.tag();
    shownTags = now.join('|');
  });

  // The music follows the hand; see music.svelte.ts.
  $effect(() => {
    setMood(done ? 'result' : play ? 'play' : bidding || exchange ? 'bidding' : 'lobby');
  });
  $effect(() => () => setMood('lobby'));

  // ---- My choices ----------------------------------------------------------
  // The hand answers to the latest server state, not the one still being
  // animated: once it is your turn you can play, and playing skips ahead.
  const live = $derived(client.game ?? msg);
  const liveTurn = $derived(me !== null && typeof live.turn === 'object' && live.turn.Seat === me);
  const handLegal = $derived(liveTurn ? live.legal : msg.legal);
  /** 딜미스 outside your turn: from the moment the cards land, while your
   * hand qualifies and the rules still allow it. */
  const misdealNow = $derived(!liveTurn && live.out_of_turn.includes('Misdeal'));
  /** How long the first bid still waits after the deal, as last sent. */
  const bidWait = $derived(liveTurn ? live.grace_ms : 0);
  const plays = $derived(handLegal.flatMap((a) => (typeof a === 'object' && 'Play' in a ? [a.Play] : [])));
  const discardable = $derived(handLegal.flatMap((a) => (typeof a === 'object' && 'Discard' in a ? [a.Discard] : [])));
  const handMode = $derived(
    !(myTurn || liveTurn) ? 'view' : discardable.length > 0 ? 'choose' : plays.length > 0 ? 'play' : 'view',
  );
  const toDiscard = $derived(exchange ? kittyCount(rules) - (exchange.discards?.length ?? 0) : 0);
  const tip = $derived(settings.tips ? tipFor(hand, rules, myTurn, misdealNow, toDiscard) : null);

  let chosen = $state<CardT[]>([]);
  /** The card lifted by a first tap, waiting for the second. */
  let raisedCard = $state<CardT | null>(null);
  let variants = $state<PlayAction[] | null>(null);

  // Forget choices that no longer apply once the server moves on.
  $effect(() => {
    void msg;
    const stillLegal = discardable;
    untrack(() => {
      chosen = chosen.filter((c) => stillLegal.some((d) => sameCard(d, c)));
      variants = null;
    });
  });

  // Remember the hand from the bidding so the kitty's cards can be marked.
  let biddingHand = $state<CardT[] | null>(null);
  $effect(() => {
    if (bidding) biddingHand = view.hand;
    else if (!exchange) biddingHand = null;
  });
  const kitty = $derived(
    exchange && exchange.declarer === me && biddingHand ? view.hand.filter((c) => !biddingHand!.some((h) => sameCard(h, c))) : [],
  );

  /** Controls that rise over the felt's foot: bids, the exchange, a joker's choices. */
  const controls = $derived(!!variants || (myTurn && (bidding !== null || exchange !== null)));
  let controlsHeight = $state(0);
  /** How wide your tools are, for the tray to keep clear on a desktop. */
  let toolsWidth = $state(0);
  // Three rows of controls (the exchange with 공약 올리기) would lift your
  // tools into the seats; they step aside until then.
  const crowded = $derived(controls && controlsHeight > 130);

  /** Why a tapped card cannot be played, as the server explains it. Said
   * where the turn is said, in place of the caption or the pill, so it
   * never lands on the hand or on the line it replaces. */
  let refusal = $state<string | null>(null);
  let refusalTimer: ReturnType<typeof setTimeout> | undefined;
  function refuse(card: CardT) {
    const why = live.notes.unplayable.find((u) => sameCard(u.card, card))?.why;
    const reason = why ? refusalText(why) : '지금은 낼 수 없는 카드예요';
    if (controls) return client.notice(reason);
    refusal = reason;
    clearTimeout(refusalTimer);
    refusalTimer = setTimeout(() => (refusal = null), 2200);
  }

  function playable(card: CardT): boolean {
    return discardable.some((d) => sameCard(d, card)) || plays.some((p) => sameCard(p.card, card));
  }

  function act(action: Action) {
    variants = null;
    animator.skip();
    client.act(action);
  }

  function playCard(card: CardT) {
    const options = plays.filter((p) => sameCard(p.card, card));
    if (options.length === 1) act({ Play: options[0] });
    else if (options.length > 1) variants = options;
  }

  function toggle(card: CardT) {
    const i = chosen.findIndex((c) => sameCard(c, card));
    if (i >= 0) chosen = chosen.filter((_, j) => j !== i);
    else if (chosen.length < toDiscard) chosen = [...chosen, card];
  }

  function discardChosen() {
    animator.skip();
    for (const card of chosen) client.act({ Discard: card });
    chosen = [];
  }

  // Waiting on you for a while: the cards you can play give a small wiggle,
  // after 8 s and then every 10 s, three times at most.
  $effect(() => {
    if (!(liveTurn && handMode === 'play')) return;
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const nudge = () => {
      const cards = handCards.entries().filter(([key]) => playable(JSON.parse(key) as CardT));
      cards.forEach(([, el], i) => setTimeout(() => void juice(el, 0.15), i * 40));
      if (++count < 3) timer = setTimeout(nudge, 10_000);
    };
    timer = setTimeout(nudge, 8_000);
    return () => clearTimeout(timer);
  });

  // ---- Where the figures look, and how they feel ----------------------------
  // Everyone watches the player whose turn it is (you, on yours), and
  // glances at the middle for a moment when a card lands there.
  let glanceMiddle = $state(false);
  let landed = 0;
  let glanceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const count = onTable.length;
    const grew = count > landed;
    landed = count;
    if (!grew) return;
    glanceMiddle = true;
    clearTimeout(glanceTimer);
    glanceTimer = setTimeout(() => (glanceMiddle = false), 900);
  });
  $effect(() => () => clearTimeout(glanceTimer));
  const lookAt = (r: number) => ring.lookAt(r, turn, myTurn, glanceMiddle);
  const mood = (seat: number) => moodOf(seat, done, winner, resolving?.plays ?? null);

  // ---- Turn time limit ------------------------------------------------------
  // The server keeps the clock; a seat shows it as a ring once the table has
  // caught up with that turn. Your own turn shows only its last seconds.
  function seatClock(seat: number) {
    const c = client.clock;
    return c && c.seat === seat && turn === seat && !done ? c : null;
  }
  const isAway = (seat: number) => {
    const info = room?.seats[seat];
    return info?.kind === 'human' && !!info.away;
  };
  const myClock = $derived(me !== null && myTurn ? seatClock(me) : null);
  let secsLeft = $state<number | null>(null);
  $effect(() => {
    const c = myClock;
    secsLeft = null;
    if (!c) return;
    const cancels: (() => void)[] = [];
    const now = performance.now();
    for (let k = 5; k >= 1; k--) {
      const at = c.deadline - k * 1000 - now;
      if (at <= -1000) continue;
      cancels.push(
        later(() => {
          secsLeft = k;
          sound.clock(k === 1);
        }, Math.max(0, at)),
      );
    }
    cancels.push(later(() => (secsLeft = null), Math.max(0, c.deadline - now)));
    return () => cancels.forEach((cancel) => cancel());
  });

  // ---- The result -------------------------------------------------------------
  /** Each finished hand goes into this browser's record (내 기록); newly
   * earned achievements appear at the foot of the result. */
  let earned = $state<Achievement[]>([]);
  $effect(() => {
    if (!done || me === null || !room || !client.keepsRecord) return;
    const role = me === done.declarer ? 'declarer' : me === done.friend ? 'friend' : 'defense';
    const declarerWon = done.team_points >= done.contract.count;
    const fresh = recordHand({
      key: `${room.id}-${room.hands_played}`,
      at: Date.now(),
      role,
      won: role === 'defense' ? !declarerWon : declarerWon,
      payoff: done.payoffs[me],
      contract: done.contract,
      teamPoints: done.team_points,
    });
    if (fresh) earned = [...untrack(() => earned), ...checkHand(done, me, loadStats())];
  });
  // They go with the next hand.
  $effect(() => {
    if (!done && untrack(() => earned.length)) earned = [];
  });

  /** The result folded away, to look at the table. */
  const folded = $derived(ui.folded);
  $effect(() => {
    if (!done) ui.folded = false;
  });
  let replay = $state(false);
  let sharing = $state(false);
  /** 런, counted out: the table settles once under the gold word. */
  let nudge = $state(false);

  /** Where the result sits on wider screens, from the felt's top: under
   * the side seats when it fits there; else under the top seats and as
   * wide as the ring, so it covers the side seats whole instead of
   * slicing them. */
  let resultNeed = $state(0);
  let resultFit = $state<{ top: number; width: number | null } | null>(null);
  $effect(() => {
    if (!done || folded || !felt || !section) return;
    void resultNeed;
    const measure = () => {
      if (!felt || !section || innerWidth < 600) return (resultFit = null);
      const f = felt.getBoundingClientRect();
      const side = seatEls.rect(ring.seatAt(1)) ?? seatEls.rect(ring.seatAt(n - 1));
      const top = seatEls.rect(ring.seatAt(2)) ?? seatEls.rect(ring.seatAt(3));
      const ringBox = ringEl?.getBoundingClientRect();
      if (!side || !top || !ringBox) return;
      const floor = section.getBoundingClientRect().bottom;
      const under = side.bottom - f.top + 8;
      resultFit =
        floor - (f.top + under) >= resultNeed ? { top: under, width: null } : { top: top.bottom - f.top + 8, width: ringBox.width + 16 };
    };
    void tick().then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  // ---- Between hands -------------------------------------------------------
  // The table stays: the seats keep their places, the result folds away,
  // and the middle offers the next hand. A tap on a seat opens its choices.
  const seated = $derived(client.seat !== null);
  const between = $derived(!(room?.in_hand ?? false) && (idle || (done !== null && folded)));
  /** What everyone at the table (watchers too) is told about the next shuffle. */
  const shuffleNote = $derived(
    room?.table.shuffle ? '매 판 시작할 때 자리를 섞어요' : room?.table.shuffle_next ? '다음 판 시작할 때 자리를 섞어요' : null,
  );
  const menuSeat = $derived(ui.seatMenu);
  const swapFrom = $derived(ui.swapFrom);
  /** The name a watcher sits down with. */
  let sitName = $state(savedName());
  $effect(() => {
    if (!between) {
      ui.closeSeat();
      ui.swapFrom = null;
    }
  });

  function openSeat(seat: number) {
    if (swapFrom !== null) {
      if (seat !== swapFrom) client.swapSeats(swapFrom, seat);
      ui.swapFrom = null;
      return;
    }
    const info = room?.seats[seat];
    // A watcher has nothing to choose at someone else's seat.
    if (!info || (me === null && info.kind === 'human')) return;
    ui.seatMenu = seat;
  }
  /** One tap to sit for someone whose name is known; else the name first. */
  function sitAt(seat: number) {
    const name = sitName.trim();
    if (name) client.join(name, seat);
    else openSeat(seat);
  }

  // Seats slide to their new places when they move (a swap or a shuffle):
  // the client says so while the old places are still on screen.
  let flip: { rects: Map<number, DOMRect>; order: number[] | null } | null = null;
  function seatBoxes(): Map<number, DOMRect> {
    const boxes = new Map<number, DOMRect>();
    for (const [seat] of spots.entries()) {
      const r = seatEls.rect(seat);
      if (r && r.width > 0) boxes.set(seat, r);
    }
    return boxes;
  }
  /** How long seats take to slide to their new places. */
  const slideMs = () => (settings.speed === 'fast' ? 260 : 460);
  $effect(() => {
    client.onmove = (order) => {
      // A move arriving while the last one still slides starts from where
      // the seats are drawn now: finish that one first.
      for (const a of section?.getAnimations({ subtree: true }) ?? []) if (a.id === 'seat-slide') a.finish();
      flip = { rects: seatBoxes(), order };
      if (motion.level === 'full') slidingUntil = performance.now() + slideMs() + 80;
      ui.closeSeat();
      ui.swapFrom = null;
      if (order) known = moveNames(known, order);
    };
    return () => {
      client.onmove = null;
    };
  });
  let kinds: string[] | null = null;
  $effect(() => {
    const now = (room?.seats ?? []).map((s) => s.kind);
    const was = kinds;
    kinds = now;
    const f = flip;
    flip = null;
    const still = motion.level !== 'full';
    if (f) {
      if (still) return;
      void tick().then(() => {
        for (const [seat, spot] of spots.entries()) {
          // Who sits here now came from `from`: slide from there.
          const from = f.order ? f.order.indexOf(seat) : seat;
          const old = f.rects.get(from);
          const box = seatEls.rect(seat);
          if (!old || !box || box.width === 0) continue;
          const dx = old.left + old.width / 2 - (box.left + box.width / 2);
          const dy = old.top + old.height / 2 - (box.top + box.height / 2);
          if (Math.hypot(dx, dy) < 2) continue;
          // The seat and what hangs under it (an empty seat's buttons) go together.
          for (const part of spot.children) {
            part.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
              id: 'seat-slide',
              duration: slideMs(),
              easing: EASE_STANDARD,
            });
          }
        }
      });
      return;
    }
    // Someone sits down, or a bot is seated: that seat gives a small hop.
    if (!was || was.length !== now.length || still) return;
    now.forEach((kind, i) => {
      if (kind === was[i] || kind === 'empty') return;
      void tick().then(() => juice(seatEls.get(i), 0.4));
    });
  });

  // ---- Each seat, as drawn ----------------------------------------------------
  const seatViews = $derived(
    Array.from({ length: n }, (_, s): SeatView => {
      const info = room?.seats[s];
      return {
        empty: info?.kind === 'empty',
        score: between && (room?.hands_played ?? 0) > 0 ? (room?.scores[s] ?? null) : null,
        name: info?.kind === 'empty' ? '빈 자리' : seatName(s),
        bot: info?.kind === 'bot',
        offline: info?.kind === 'human' && !info.connected,
        team: hand.team(s),
        points: hand.points(s),
        turn: turn === s,
        bubble: bidNote(bidding, s),
        reaction: client.reactions?.[s] ?? null,
        cue: animator.cues[s] ?? null,
        dim: bidding?.passed[s] ?? false,
        reveal: animator.revealed === s,
        trumpSuit: contract?.trump ?? null,
        lookAt: lookAt(ring.relative(s)),
        mood: mood(s),
        clock: seatClock(s),
        away: isAway(s),
      };
    }),
  );

  /** The one line under the trick. */
  const note = $derived.by((): TrickNote | null => {
    if (resolving && winner !== null) return { kind: 'won', who: winner === me ? '내가' : seatName(winner), text: ' 가져감' };
    if (play && play.plays.length === 0 && !resolving) {
      return turn === me ? { kind: 'lead', text: '내가 선' } : { kind: 'lead', who: seatName(play.leader), text: ' 선' };
    }
    if (play?.called_joker) return { kind: 'alert', text: '조커콜 · 조커를 내야 해요' };
    const notes = trickNotes(onTable, trickNo, rules.hand_size, cardLabel).join(' · ');
    if (leading === null) return notes ? { kind: 'plain', text: notes } : null;
    return { kind: 'plain', who: leading === me ? '내가' : seatName(leading), text: ` 이기는 중${notes ? ` · ${notes}` : ''}` };
  });

  const hint = $derived(client.hint && myTurn ? actionLabel(client.hint, seatName) : null);
  const pill = $derived(
    myTurn && play ? (settings.singleTap ? '낼 카드를 누르세요' : raisedCard ? '한 번 더 누르면 내요' : '낼 카드를 두 번 누르세요') : null,
  );
</script>

{#snippet seatTap(seat: number)}
  <!-- Between hands a seat is one button: its choices, or the other half of a swap. -->
  {@const label = seatLabel(seat, me, room?.seats[seat])}
  <button
    class="seat-tap"
    class:picked={swapFrom === seat}
    aria-label={swapFrom === null ? `${label} 자리 메뉴` : swapFrom === seat ? `${label} 그만 고르기` : `${label}: 여기와 바꾸기`}
    aria-pressed={swapFrom === seat ? true : undefined}
    aria-haspopup={swapFrom === null ? 'dialog' : undefined}
    onclick={() => openSeat(seat)}
  ></button>
{/snippet}
{#snippet mySeatTap()}
  {#if me !== null}{@render seatTap(me)}{/if}
{/snippet}
{#snippet seatActs(seat: number)}
  <!-- An empty seat says how to fill it, right there. -->
  <span class="seat-acts">
    {#if me !== null}
      <button class="chip sm seat-act" onclick={() => client.addBot(seat)} aria-label="{seat + 1}번 자리에 봇 앉히기">+ 봇</button>
      <button class="chip sm seat-act" onclick={oninvite} aria-label="친구 초대하기">초대</button>
    {:else}
      <button class="chip sm seat-act" onclick={() => sitAt(seat)} aria-label="{seat + 1}번 자리에 앉기">앉기</button>
    {/if}
  </span>
{/snippet}
{#snippet controlPanel()}
  {#if variants}
    <div class="variants">
      {#each variants as v, i (i)}
        <Chip onclick={() => act({ Play: v })}><SuitText text={variantLabel(v)} /></Chip>
      {/each}
      <Button variant="ghost" onclick={() => (variants = null)}>취소</Button>
    </div>
  {:else if bidding}
    <BidPanel legal={msg.legal} lastChance={hand.lastChance} wait={bidWait} onact={act} />
  {:else if exchange}
    <ExchangePanel
      legal={msg.legal}
      contract={exchange.contract}
      contracts={live.notes.contracts}
      {rules}
      {toDiscard}
      chosen={chosen.length}
      hand={view.hand}
      {seatName}
      onact={act}
      ondiscard={discardChosen}
    />
  {/if}
{/snippet}
{#snippet strip(isFolded: boolean)}
  <div class="strip-area">
    <Strip
      controls={controls ? controlPanel : undefined}
      {refusal}
      {pill}
      waiting={done ? null : waiting}
      misdeal={misdealNow}
      folded={isFolded}
      onmisdeal={() => act('Misdeal')}
      onunfold={() => (ui.folded = false)}
      bind:controlsHeight
    />
  </div>
{/snippet}

<section
  class="table"
  bind:this={section}
  class:seated={me !== null}
  class:nudge
  class:tips={settings.tips}
  class:swapping={swapFrom !== null}
  class:result-open={done !== null && !folded}
  style:--over="{controls ? controlsHeight : 0}px"
  style:--tools-w="{toolsWidth}px"
>
  <div class="status-area">
    <StatusBar {hand} {rules} {trickNo} {tags} {callLabel} {seatName} {room} {idle} {rulesName} {onrules} />
  </div>
  <!-- Always there, at a fixed height, so the felt below never moves. -->
  <div class="event">
    {#if animator.event && !done}{#key animator.event}<p class="fade-up" aria-live="polite"><SuitText text={animator.event} /></p>{/key}{/if}
    {#if tip}{#key tip}<p class="tip fade-up" aria-live="polite"><SuitText text={tip} /></p>{/key}{/if}
  </div>

  <div class="side-area">
    <SidePanel {hand} {rules} {trickNo} {tags} {callLabel} {seatName} {myName} {seal} {room} {me} {turn} {ring} {idle} {rulesName} {shuffleNote} {onrules} />
  </div>

  <div class="felt-area">
    <Felt
      {ring}
      seats={seatViews}
      watching={me === null}
      {onTable}
      trickKey={resolving ? `r${resolving.key}` : `p${play?.tricks.length ?? 0}`}
      {trickNo}
      lead={resolving ? resolving.lead : (play?.lead ?? null)}
      {winner}
      {leading}
      {note}
      {seal}
      twoJokers={hand.twoJokers}
      attachSeat={(s) => seatEls.at(s)}
      attachSpot={(s) => spots.at(s)}
      attachCard={(s) => trickCards.at(s)}
      {between}
      {swapFrom}
      {seatTap}
      {seatActs}
      bind:felt
      bind:ringEl
    >
      {#if animator.thrownIn && bidding}
        <ThrownIn who={seatName(animator.thrownIn.seat)} hand={animator.thrownIn.hand} twoJokers={hand.twoJokers} onclose={() => animator.dismissThrownIn()} />
      {/if}
      {#if between && room}
        <Lobby
          {room}
          seated={me !== null}
          swapping={swapFrom !== null}
          {sitName}
          {shuffleNote}
          onstart={() => client.start()}
          onshuffle={(on) => client.shuffleNext(on)}
          {onmenu}
          oncancelswap={() => (ui.swapFrom = null)}
        />
      {/if}
    </Felt>
  </div>

  {#if done && !folded}
    <ResultSheet
      {done}
      {me}
      {room}
      {seatName}
      team={hand.team}
      points={hand.points}
      {earned}
      {seated}
      {shuffleNote}
      fit={resultFit}
      bind:need={resultNeed}
      onfold={() => (ui.folded = true)}
      onreplay={() => (replay = true)}
      onshare={() => (sharing = true)}
      onstart={() => client.start()}
      onrun={() => {
        nudge = true;
        setTimeout(() => (nudge = false), 320);
      }}
    />
  {/if}

  {#if me !== null}
    {@render strip(done !== null && folded)}
    <div class="tray-area" data-seat={between ? me : undefined}>
      <Tray
        seat={{
          name: myName,
          score: between && (room?.hands_played ?? 0) > 0 ? (room?.scores[me] ?? null) : null,
          team: hand.team(me),
          secretFriend: hand.secretFriend,
          points: hand.points(me),
          turn: myTurn,
          trumpSuit: contract?.trump ?? null,
          lookAt: lookAt(0),
          mood: mood(me),
          away: isAway(me),
        }}
        team={hand.team(me)}
        secretFriend={hand.secretFriend}
        points={hand.points(me)}
        mine={myTurn}
        {between}
        picked={swapFrom === me}
        reaction={client.reactions?.[me] ?? null}
        cue={animator.cues[me] ?? null}
        {secsLeft}
        seatTap={mySeatTap}
        attachSeat={seatEls.at(me)}
        attachSpot={spots.at(me)}
        bind:tray
        bind:raised={raisedCard}
        hand={{
          cards: view.hand,
          mode: handMode,
          playable,
          chosen,
          kitty,
          seal,
          twoJokers: hand.twoJokers,
          deal: animator.dealing,
          quickDeal: animator.quickDeal,
          onplay: playCard,
          ontoggle: toggle,
          onrefuse: refuse,
          hinted: client.hint && typeof client.hint === 'object' && 'Play' in client.hint && myTurn ? client.hint.Play.card : null,
          attachCard: (key) => handCards.at(key),
        }}
      />
    </div>
    <!-- Your tools, once, where the layout puts them: the felt's foot on a
         phone, the result's foot while it shows, the top line on a phone
         held sideways, the tray's right end on a desktop. -->
    <div class="tools-area" class:crowded bind:clientWidth={toolsWidth}>
      <Tools {hint} canHint={settings.hints && liveTurn} onhint={() => client.askHint()} onreact={(text) => client.react(text)} />
    </div>
  {:else if done && folded}
    {@render strip(true)}
  {:else if !done && !between}
    <!-- Watching: no hand, no strip; one line says whose turn it is. -->
    <p class="spectating">구경하는 중{waiting ? ` · ${waiting.pre}${waiting.name}${waiting.post}` : ''}</p>
  {/if}

  {#if sharing && room}
    <ShareCard {room} onclose={() => (sharing = false)} />
  {/if}
  {#if menuSeat !== null && room?.seats[menuSeat]}
    {@const seat = menuSeat}
    {@const close = () => ui.closeSeat()}
    <SeatMenu
      {seat}
      info={room.seats[seat]}
      {me}
      anchor={() => (seatEls.get(seat) ?? section ?? document.body).getBoundingClientRect()}
      bind:name={sitName}
      bind:kicking={ui.kicking}
      onclose={close}
      onlevel={(level) => {
        client.addBot(seat, level);
        if (room?.seats[seat]?.kind !== 'bot') close();
      }}
      onswap={() => {
        ui.swapFrom = seat;
        close();
      }}
      onmovehere={() => {
        if (me !== null) client.swapSeats(me, seat);
        close();
      }}
      onclearbot={() => {
        client.removeBot(seat);
        close();
      }}
      onkick={() => {
        client.clearSeat(seat);
        close();
      }}
      onrelieve={() => {
        client.addBot(seat);
        close();
      }}
      onstand={() => {
        client.leave();
        close();
      }}
      onsit={(name) => {
        client.join(name, seat);
        close();
      }}
      oninvite={() => {
        oninvite?.();
        close();
      }}
    />
  {/if}
  {#if replay && done}
    <HandReplay
      tricks={done.tricks}
      discards={done.discards}
      hiddenDiscards={rules.reveal_discards === false && done.declarer !== me}
      declarer={done.declarer}
      friend={done.friend}
      {seatName}
      {seal}
      twoJokers={hand.twoJokers}
      onclose={() => (replay = false)}
    />
  {/if}
</section>

<style>
  /* Every row but the felt has a fixed height for the screen size, and the
     tray never changes height either, so the felt (and every seat and the
     trick on it) stays put from the deal to the result. Whatever comes and
     goes (bids, the exchange, the result, the turn pill) lies over it.
     Breakpoints are lib/tokens.ts's: 600, 1024 and 1100. */
  .table {
    --status-h: 48px;
    --event-h: 18px;
    --strip-h: 16px;
    /* The top seats' height: the result stops under them. */
    --seat-top: 84px;
    /* Room your tools take in the result's footer. */
    --tools-room: 0px;
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--status-h) var(--event-h) minmax(0, 1fr) var(--strip-h) auto;
    grid-template-areas: 'status' 'event' 'felt' 'strip' 'tray';
    gap: 4px;
    height: calc(100dvh - var(--chrome, 80px) - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  }
  .table.seated {
    --tools-room: 52px;
  }
  @media (min-width: 600px) {
    .table {
      --status-h: 34px;
      --seat-top: 116px;
    }
  }
  .table.tips {
    --event-h: 54px;
  }
  .status-area {
    grid-area: status;
    /* Above the felt, so what opens from the top line lies over the seats. */
    position: relative;
    z-index: var(--z-status);
    min-width: 0;
  }
  .event {
    grid-area: event;
    min-width: 0;
    text-align: center;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .event p {
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    line-height: 18px;
  }
  .event .tip {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    font-weight: 600;
    color: var(--ink);
  }
  .felt-area {
    grid-area: felt;
    display: grid;
    min-height: 0;
  }
  .strip-area,
  .spectating {
    grid-area: strip;
    min-width: 0;
  }
  .spectating {
    margin: 0;
    padding: 16px;
    text-align: center;
    font-size: var(--text-body);
    color: var(--ink-muted);
  }
  .tray-area {
    grid-area: tray;
    min-width: 0;
  }
  .side-area {
    display: none;
  }
  /* A joker's ways to be played, in a row over the felt's foot. */
  .variants {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }

  /* Your tools: at the felt's foot, at the right; they step up over the
     bid or exchange controls while those are out, and aside when those
     are three rows tall. */
  .tools-area {
    --lift: max(0px, var(--over, 0px) - var(--strip-h) - 4px);
    grid-area: felt;
    align-self: end;
    justify-self: end;
    z-index: 6;
    margin: 0 4px calc(4px + var(--lift)) 0;
  }
  .tools-area.crowded {
    display: none;
  }
  /* While the result shows: at the start of its footer, which keeps room. */
  .result-open .tools-area {
    grid-area: tray;
    justify-self: start;
    z-index: calc(var(--z-result) + 1);
    margin: 0 0 10px 12px;
  }
  @media (min-width: 600px) {
    .result-open .tools-area {
      margin: 0 0 14px 16px;
    }
  }
  /* 런: the table settles once under the gold word. */
  .table.nudge {
    animation: nudge 300ms var(--ease-standard);
  }
  @keyframes nudge {
    30% {
      translate: 0 2px;
    }
    60% {
      translate: 0 -1px;
    }
  }
  :global(:root[data-motion='reduced']) .table.nudge {
    animation: none;
  }

  /* Desktop: your seat at the tray's left, your tools at its right. */
  @media (min-width: 1024px) and (min-height: 640px) {
    .table {
      --seat-top: 112px;
    }
    .table.seated {
      --tools-room: 0px;
    }
    .tools-area,
    .result-open .tools-area {
      grid-area: tray;
      align-self: center;
      justify-self: end;
      z-index: 1;
      margin: 4px 10px 0 0;
    }
    .tools-area.crowded {
      display: block;
    }
  }

  /* Wide desktop: a column of stacked paper beside the felt takes the
     상황판 and the scores; the top line goes. */
  @media (min-width: 1100px) and (orientation: landscape) and (min-height: 600px) {
    .table {
      --event-h: 0px;
      grid-template-columns: minmax(0, 1fr) clamp(260px, 21vw, 300px);
      grid-template-rows: var(--event-h) minmax(0, 1fr) var(--strip-h) auto;
      grid-template-areas: 'event side' 'felt side' 'strip side' 'tray side';
      column-gap: 16px;
    }
    .table.tips {
      --event-h: 36px;
    }
    .status-area {
      display: none;
    }
    .side-area {
      grid-area: side;
      display: grid;
      min-height: 0;
    }
  }

  /* Phones on their side: the strip moves beside the felt, seats go down
     both sides, the note moves into the strip, and your tools sit at the
     end of the wide top line. */
  @media (orientation: landscape) and (max-height: 520px) {
    .table {
      grid-template-columns: minmax(0, 1fr) minmax(240px, 36%);
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas: 'status status' 'felt strip' 'tray tray';
      gap: 4px 8px;
    }
    .table.seated {
      --tools-room: 0px;
    }
    .event {
      display: none;
    }
    .strip-area {
      align-self: stretch;
    }
    .tools-area,
    .result-open .tools-area,
    .tools-area.crowded {
      display: block;
      grid-area: status;
      align-self: center;
      justify-self: end;
      z-index: calc(var(--z-status) + 1);
      margin: 0;
    }
  }

  /* ---- Between hands -------------------------------------------------------
     Every seat is one tap from its choices: a transparent button over it. */
  .seat-tap {
    position: absolute;
    inset: -4px;
    z-index: 3;
    border-radius: var(--r-panel);
  }
  .seat-tap:active {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  @media (hover: hover) {
    .seat-tap:hover {
      background: color-mix(in srgb, var(--ink) 5%, transparent);
    }
  }
  /* Swapping: every seat shows it can be tapped; the first one chosen
     stands up a little, inside an ink frame. */
  .swapping .seat-tap {
    box-shadow: inset 0 0 0 2px var(--line);
  }
  .seat-tap.picked {
    box-shadow: inset 0 0 0 2px var(--ink);
  }
  /* What an empty seat offers, right under its outline. */
  .seat-acts {
    position: relative;
    z-index: 4;
    display: flex;
    justify-content: center;
    gap: 4px;
    margin-top: 4px;
  }
  .seat-act {
    padding-inline: 10px;
    font-size: var(--text-label);
    white-space: nowrap;
  }
</style>
