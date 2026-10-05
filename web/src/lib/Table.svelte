<script lang="ts">
  import { occupantName } from './names';
  import { tick, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import BidPanel from './BidPanel.svelte';
  import Card from './Card.svelte';
  import ExchangePanel from './ExchangePanel.svelte';
  import Hand from './Hand.svelte';
  import HandReplay from './HandReplay.svelte';
  import Icon from './Icon.svelte';
  import LeadTag from './LeadTag.svelte';
  import PlayerFigure from './PlayerFigure.svelte';
  import Reactions from './Reactions.svelte';
  import ShareCard from './ShareCard.svelte';
  import Seat, { TEAM_LABEL, subject, type Team } from './Seat.svelte';
  import Callout from './Callout.svelte';
  import SuitIcon from './SuitIcon.svelte';
  import { actionLabel, cardLabel, contractLabel, friendCallLabel, isPoint, kittyCount, leadLabel, mightyCard, sameCard, sealOf } from './cards';
  import { savedName, type RoomClient } from './client.svelte';
  import SeatMenu from './SeatMenu.svelte';
  import { after, later } from './clock';
  import { EASE_STANDARD, flyFrom, flyTo, hold, juice, pop, ring, settle } from './motion';
  import { setMood } from './music.svelte';
  import { settings } from './settings.svelte';
  import { BACK_NAMES, TABLE_NAMES, checkHand, type Achievement } from './achievements';
  import { loadStats, recordHand } from './stats';
  import { sound } from './sound';
  import { CATALOG, presetRules } from './catalog';
  import { ledgerLines, refusalText } from './ledger';
  import type { Action, Card as CardT, FriendCall, Lead, PhaseView, Played, PlayAction, Rules, StateMsg, Suit, Trick } from './types';

  let {
    client,
    rulesName = '',
    onmenu,
    onrules,
    oninvite,
  }: {
    client: RoomClient;
    /** The rules' name, for the table between hands. */
    rulesName?: string;
    /** Opens the table's menu (설정 between hands). */
    onmenu?: () => void;
    onrules?: () => void;
    oninvite?: () => void;
  } = $props();

  // What is drawn lags the server by the animations still playing: each new
  // state waits in a queue, and the difference to the one on screen is
  // animated before it is shown.
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
  let shown = $state(untrack(() => client.game ?? blank));
  const msg = $derived(idle ? blank : shown);
  const view = $derived(msg.view);
  const legal = $derived(msg.legal);
  const phase = $derived(view.phase);
  const me = $derived(view.viewer === 'Spectator' ? null : view.viewer.Seat);
  const n = $derived(view.hand_sizes.length);
  const turn = $derived(typeof msg.turn === 'object' ? msg.turn.Seat : null);
  const myTurn = $derived(me !== null && turn === me);

  const bidding = $derived(typeof phase === 'object' && 'Bidding' in phase ? phase.Bidding : null);
  const exchange = $derived(typeof phase === 'object' && 'Exchange' in phase ? phase.Exchange : null);
  const play = $derived(typeof phase === 'object' && 'Play' in phase ? phase.Play : null);
  const done = $derived(typeof phase === 'object' && 'Done' in phase ? phase.Done : null);

  // Each finished hand goes into this browser's record (내 기록).
  $effect(() => {
    if (!done || me === null || !room || room.id === 'preview') return;
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

  // Newly earned achievements appear at the foot of the result, once it
  // settles, so they never cover the headline; they go with the next hand.
  let earned = $state<Achievement[]>([]);
  const anyEarned = $derived(earned.length > 0);
  $effect(() => {
    if (!done && untrack(() => earned.length)) earned = [];
  });
  $effect(() => {
    if (!anyEarned) return;
    const start = setTimeout(() => {
      sound.achieve();
      // On a short phone the result scrolls; bring the award into view.
      document.querySelector('.result .achieved')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 1800);
    return () => clearTimeout(start);
  });
  const stage = $derived(exchange ?? play ?? done);
  const contract = $derived(stage?.contract ?? null);
  const declarer = $derived(stage?.declarer ?? null);
  const friend = $derived(play?.friend ?? done?.friend ?? null);
  const call = $derived(play?.call ?? done?.call ?? null);
  const twoJokers = $derived(view.rules.deck === 'TwoJokers');

  // Seals mark the mighty and joker-call cards once the trump is known.
  function seal(card: CardT) {
    if (contract) return sealOf(card, view.rules, contract.trump);
    return 'Joker' in card ? 'joker' : null;
  }

  function seatName(seat: number): string {
    if (seat === me) return '나';
    // A seat left empty since the hand on the table keeps its player's name there.
    return occupantName(room?.seats[seat], seat) ?? (!idle ? known[seat] : null) ?? `${seat + 1}번 자리`;
  }

  /** Who last sat at each seat, so a hand still on the table (its result,
   * its replay) names a player who has since left. Seats that move take
   * their names along. */
  let known = $state<(string | null)[]>([]);
  $effect(() => {
    const seats = room?.seats ?? [];
    const was = untrack(() => known);
    const now = seats.map((s, i) => occupantName(s, i) ?? was[i] ?? null);
    if (now.some((name, i) => name !== was[i]) || now.length !== was.length) known = now;
  });

  /** Your own name as the room knows it, for your seat on the tray. */
  const myName = $derived.by(() => {
    const info = me !== null ? room?.seats[me] : null;
    return info?.kind === 'human' ? info.name : '나';
  });

  // ---- Where everyone sits -------------------------------------------------
  // Play goes to the next seat number. Seen from the bottom, that runs
  // counter-clockwise: right, top right, top left, left.
  const bottom = $derived(me ?? 0);
  const around = $derived(Array.from({ length: n }, (_, r) => r).filter((r) => me === null || r > 0));
  function angle(r: number): number {
    return ((90 - (r * 360) / n) * Math.PI) / 180;
  }
  // Five players sit in fixed bands (me, right, top right, top left, left),
  // so their cards land on matching, mirror-image spots rather than on a
  // pentagon, which bunched the trick off-centre on narrow screens.
  const BANDS: [number, number][] = [
    [0, 1],
    [1.15, 0.05],
    [0.6, -0.9],
    [-0.6, -0.9],
    [-1.15, 0.05],
  ];
  function slotVector(r: number): [number, number] {
    if (n === 5) return BANDS[r];
    return [Math.cos(angle(r)), Math.sin(angle(r))];
  }
  function seatAt(r: number): number {
    return (bottom + r) % n;
  }
  function relative(seat: number): number {
    return (seat - bottom + n) % n;
  }

  // ---- Teams and points ----------------------------------------------------
  // The engine says when the viewer can tell there is no friend: called
  // alone, the 주공 took the first trick that named it or played the called
  // card, or (on the 주공's own screen) the called card is theirs.
  const noFriend = $derived(friend === null && (call === 'Alone' || (play?.no_friend ?? false) || done !== null));
  const friendKnown = $derived(friend !== null || noFriend);
  // You hold the card the 주공 called: you are the 프렌드, and so far only
  // you know it. It shows on your own seat until the card is played.
  const secretFriend = $derived(
    me !== null &&
      me !== declarer &&
      friend === null &&
      !noFriend &&
      play !== null &&
      typeof call === 'object' &&
      call !== null &&
      'Card' in call &&
      view.hand.some((c) => sameCard(c, call.Card)),
  );
  function team(seat: number): Team | null {
    if (declarer === null) return null;
    if (seat === declarer) return 'declarer';
    if (seat === friend) return 'friend';
    return friendKnown ? 'defense' : null;
  }
  const points = (seat: number) => view.points_taken[seat]?.filter(isPoint).length ?? 0;
  const teamPoints = $derived(
    done ? done.team_points : declarer === null ? 0 : points(declarer) + (friend !== null ? points(friend) : 0),
  );

  // ---- The dealer's extra turn ----------------------------------------------
  /** The dealer's extra turn after five passes, from this count; else null. */
  const lastChance = $derived.by(() => {
    const min = view.rules.bidding.last_chance_min;
    if (!bidding || bidding.best || min == null) return null;
    return view.bids.length === n ? min : null;
  });

  function bubble(seat: number): string | null {
    if (!bidding) return null;
    if (bidding.best && bidding.best[0] === seat) return contractLabel(bidding.best[1]);
    if (bidding.passed[seat]) return '패스';
    return null;
  }

  // ---- Result ledger -----------------------------------------------------------
  // The result is counted out step by step, as 맞고 and mahjong results are:
  // the points, over or short, each ×2, then everyone's payoff.
  // The count as the server scored it: what one opponent pays, then each
  // doubling on its own line.
  const result = $derived(
    done
      ? {
          made: done.value.made,
          lines: ledgerLines(done.value),
          run: done.team_points === 20,
          margin: done.team_points - done.contract.count,
        }
      : null,
  );

  /** Results already counted out, so a reopened one shows at once. */
  const counted = new Set<string>();
  let step = $state(99);
  let shownPay = $state<number[]>([]);
  let nudge = $state(false);
  $effect(() => {
    if (!done || !result) return;
    const key = `${room?.id}-${room?.hands_played}-${JSON.stringify(done.payoffs)}`;
    const instant = counted.has(key) || prefersReducedMotion.current || settings.speed === 'off';
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
    const k = settings.speed === 'fast' ? 0.5 : 1;
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
            nudge = true;
            setTimeout(() => (nudge = false), 320);
          }
        }
      };
      frame(t0);
    })();
    return () => {
      cancelled = true;
    };
  });
  function skipCount() {
    if (step < 99 && done) {
      step = 99;
      shownPay = done.payoffs;
      tallied = true;
    }
  }

  // ---- Idle reminder -----------------------------------------------------------
  // Waiting on you for a while: the cards you can play give a small wiggle,
  // after 8 s and then every 10 s, three times at most.
  $effect(() => {
    if (!(liveTurn && handMode === 'play')) return;
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const nudge = () => {
      const cards = [...document.querySelectorAll('.tray button.card:not(.unplayable)')];
      cards.forEach((el, i) => setTimeout(() => void juice(el, 0.15), i * 40));
      if (++count < 3) timer = setTimeout(nudge, 10_000);
    };
    timer = setTimeout(nudge, 8_000);
    return () => clearTimeout(timer);
  });

  // ---- Contract meter and tags ----------------------------------------------
  /** Points the defence has taken, once the teams are known. */
  const defensePoints = $derived(
    friendKnown ? view.points_taken.reduce((sum, _, s) => sum + (team(s) === 'defense' ? points(s) : 0), 0) : null,
  );
  /** Made: the 여당 has its points. Lost: too few points are left to make it. */
  const contractState = $derived.by(() => {
    if (!play || !contract) return null;
    if (teamPoints >= contract.count) return 'made';
    if (defensePoints !== null && 20 - defensePoints < contract.count) return 'lost';
    return null;
  });
  // ---- Point-card tally -----------------------------------------------------
  // Twenty ticks, one per point card: 여당 fill from the left, 야당 from the
  // right. Until the 프렌드 is known, its points count for 야당, as everyone
  // sees them.
  const TICKS = Array.from({ length: 20 }, (_, i) => i);
  const tallyDecl = $derived(Math.min(teamPoints, 20));
  const tallyDef = $derived(
    Math.min(
      20 - tallyDecl,
      defensePoints ?? view.points_taken.reduce((sum, _, s) => sum + (s !== declarer && s !== friend ? points(s) : 0), 0),
    ),
  );
  // What the tally showed last, so the ticks that just filled pop in turn.
  let tallyFrom = $state({ decl: 0, def: 0 });
  $effect(() => {
    tallyFrom = { decl: tallyDecl, def: tallyDef };
  });
  /** Where the line after tick `k` sits in a 20-column grid with 2px gaps. */
  const tickEdge = (k: number) => `calc((100% - 38px) * ${k / 20} + ${2 * k - 2}px)`;
  /** Lets the ticks pop only for points taken after the tally appeared. */
  function goLive(node: HTMLElement) {
    const id = requestAnimationFrame(() => node.classList.add('live'));
    return { destroy: () => cancelAnimationFrame(id) };
  }

  // The music follows the hand; see music.svelte.ts.
  $effect(() => {
    setMood(done ? 'result' : play ? 'play' : bidding || exchange ? 'bidding' : 'lobby');
  });
  $effect(() => () => setMood('lobby'));

  const tags = $derived.by(() => {
    const list: { text: string; tone: 'accent' | 'danger' | 'gold' | 'plain' }[] = [];
    if (!play) return list;
    if (contractState === 'made') list.push({ text: '공약 확정', tone: 'accent' });
    if (contractState === 'lost') list.push({ text: '공약 불가', tone: 'danger' });
    if (defensePoints === 0 && teamPoints > 0 && play.tricks.length >= 5 && trickNo <= view.rules.hand_size) {
      list.push({ text: '런 찬스', tone: 'gold' });
    }
    if (trickNo === view.rules.hand_size && !resolving) list.push({ text: '마지막 라운드', tone: 'plain' });
    return list;
  });
  // A soft chime whenever a new tag appears.
  let shownTags = '';
  $effect(() => {
    const now = tags.map((t) => t.text);
    const fresh = now.filter((t) => !shownTags.split('|').includes(t));
    // Reaching the contract resolves the chord; other tags just chime.
    if (fresh.includes('공약 확정')) sound.resolve();
    else if (fresh.length) sound.tag();
    shownTags = now.join('|');
  });

  // ---- Tips for learners (초보 도움말) ---------------------------------------
  const tip = $derived.by(() => {
    if (settings.tips && misdealNow) return '패가 약해요. 차례가 아니어도 딜미스로 다시 나눌 수 있어요.';
    if (!settings.tips || !myTurn) return null;
    if (bidding)
      return bidding.best
        ? `${contractLabel(bidding.best[1])}보다 높게 부르거나 패스. 센 카드가 많으면 도전!`
        : lastChance !== null
          ? `모두 패스했어요. ${lastChance}부터 부르거나, 또 패스하면 다시 나눠요.`
          : '많이 가진 무늬를 기루다로 골라 불러요. 자신 없으면 패스.';
    if (exchange)
      return toDiscard > 0
        ? `필요 없는 카드 ${toDiscard}장을 버려요. 버린 점수 카드${!view.rules.scoring.discards_to_declarer ? '는 야당 점수가 돼요.' : '도 여당 점수예요.'}`
        : '프렌드를 불러요. 보통 마이티나 조커를 불러요.';
    if (play) {
      if (play.plays.length === 0) return '내가 선이에요. 아무 카드나 내도 돼요.';
      const lead = play.lead;
      if (lead && 'Suit' in lead) return `${leadLabel(lead)}를 따라 내요. 없으면 아무거나. 마이티·조커는 언제든.`;
      return '처음 낸 색이 있으면 그 색을 내요. 없으면 아무거나.';
    }
    return null;
  });

  // ---- My choices ----------------------------------------------------------
  const kittySize = $derived(kittyCount(view.rules));
  const toDiscard = $derived(exchange ? kittySize - (exchange.discards?.length ?? 0) : 0);
  // The hand answers to the latest server state, not the one still being
  // animated: once it is your turn you can play, and playing skips ahead.
  const live = $derived(client.game ?? msg);
  const liveTurn = $derived(me !== null && typeof live.turn === 'object' && live.turn.Seat === me);
  const handLegal = $derived(liveTurn ? live.legal : legal);
  /** 딜미스 outside your turn: from the moment the cards land, while your
   * hand qualifies and the rules still allow it. */
  const misdealNow = $derived(!liveTurn && live.out_of_turn.includes('Misdeal'));
  /** How long the first bid still waits after the deal, as last sent. */
  const bidWait = $derived(liveTurn ? live.grace_ms : 0);
  const plays = $derived(handLegal.flatMap((a) => (typeof a === 'object' && 'Play' in a ? [a.Play] : [])));
  const discardable = $derived(
    handLegal.flatMap((a) => (typeof a === 'object' && 'Discard' in a ? [a.Discard] : [])),
  );
  const handMode = $derived(
    !(myTurn || liveTurn) ? 'view' : discardable.length > 0 ? 'choose' : plays.length > 0 ? 'play' : 'view',
  );

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
    exchange && exchange.declarer === me && biddingHand
      ? view.hand.filter((c) => !biddingHand!.some((h) => sameCard(h, c)))
      : [],
  );

  /** Why a tapped card cannot be played, as the server explains it. */
  function refuse(card: CardT) {
    const why = live.notes.unplayable.find((u) => sameCard(u.card, card))?.why;
    const reason = why ? refusalText(why) : '지금은 낼 수 없는 카드예요';
    // Said where the turn is said, in place of the caption or the pill, so
    // it never lands on the hand or on the line it replaces.
    if (controls) return client.notice(reason);
    refusal = reason;
    clearTimeout(refusalTimer);
    refusalTimer = setTimeout(() => (refusal = null), 2200);
  }
  let refusal = $state<string | null>(null);
  let refusalTimer: ReturnType<typeof setTimeout> | undefined;

  function playable(card: CardT): boolean {
    return discardable.some((d) => sameCard(d, card)) || plays.some((p) => sameCard(p.card, card));
  }

  function act(action: Action) {
    variants = null;
    skipAhead();
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
    skipAhead();
    for (const card of chosen) client.act({ Discard: card });
    chosen = [];
  }

  function variantLabel(p: PlayAction): string {
    if (p.joker_lead) return 'Suit' in p.joker_lead ? `${leadLabel(p.joker_lead)}로 내기` : `${leadLabel(p.joker_lead)}으로 내기`;
    if (p.call_joker) return '조커콜';
    return '그냥 내기';
  }

  // ---- Motion --------------------------------------------------------------
  const queue: StateMsg[] = [];
  let running = false;
  /** A finished trick kept on the table while it resolves. */
  let resolving = $state<{ plays: Played[]; key: number; lead: Lead } | null>(null);
  let winner = $state<number | null>(null);
  let revealed = $state<number | null>(null);
  let dealing = $state(false);
  /** The deal after a redeal, dealt in half the time. */
  let quickDeal = $state(false);
  // The table can open straight onto a fresh deal (the first hand of a
  // room); deal it in then too, not only when a hand follows another.
  $effect(() => {
    const first = untrack(() => shown);
    const phase = first.view.phase;
    const fresh = typeof phase === 'object' && 'Bidding' in phase && first.view.bids.length === 0;
    if (!fresh || settings.speed === 'off') return;
    dealing = true;
    sound.shuffle();
    const release = hold();
    const timer = setTimeout(() => {
      dealing = false;
      release();
    }, 900);
    return () => {
      clearTimeout(timer);
      release();
    };
  });
  let felt: HTMLElement;
  /** Set when the player acts: finish what is animating and show the latest state. */
  let hurry = false;
  const pauses = new Set<() => void>();

  /** A pause that ends early when the player acts. */
  function pause(ms: number): Promise<void> {
    if (hurry || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pauses.delete(done);
        cancel();
        resolve();
      };
      const cancel = later(done, ms);
      pauses.add(done);
    });
  }

  /** Ends every motion on the table at once, except the endless ones (a
   * figure's blink, a raised card's sway), which have no end to jump to. */
  function finishAll() {
    for (const a of felt?.getAnimations({ subtree: true }) ?? []) {
      if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish();
    }
  }

  function skipAhead() {
    if (!running) return;
    hurry = true;
    finishAll();
    for (const done of [...pauses]) done();
  }

  $effect(() => {
    const next = client.game;
    if (!next) {
      // The hand was put away (the seats moved): start again from nothing.
      queue.length = 0;
      untrack(() => {
        finishAll();
        resolving = null;
        winner = null;
        event = null;
        thrownIn = null;
        shown = blank;
      });
      return;
    }
    if (next === untrack(() => shown)) return;
    queue.push(next);
    untrack(pump);
  });

  /** Duration multiplier: 0 skips motion; a backlog speeds it up. */
  function pace(): number {
    // Once it is your turn, what is left to show plays three times as fast.
    const waiting = untrack(() => liveTurn) ? 3 : 1;
    return paceUnhurried() / waiting;
  }
  /** The same without your turn's hurry: a finished trick is always shown. */
  function paceUnhurried(): number {
    if (settings.speed === 'off' || hurry) return 0;
    return (settings.speed === 'fast' ? 0.5 : 1) / (1 + 0.5 * queue.length);
  }

  async function pump() {
    if (running) return;
    running = true;
    const release = hold();
    try {
      // Seats moved for this hand (a shuffle at 다음 판): they slide to
      // their places first, then the cards are dealt.
      const slide = slidingUntil - performance.now();
      if (slide > 0) await new Promise((done) => setTimeout(done, slide));
      while (queue.length > 0) {
        const next = queue.shift()!;
        const k = pace();
        // Too far behind: catch up at once. A hidden tab plays on as if
        // watched, on the worker clock, so coming back finds the hand where
        // it would be.
        cues(shown, next);
        if (k === 0 || queue.length > 3) {
          finishAll();
          resolving = null;
          winner = null;
          shown = next;
          continue;
        }
        await transition(shown, next, k);
      }
    } finally {
      running = false;
      hurry = false;
      release();
    }
  }

  type Round = { plays: Played[]; tricks: Trick[]; friend: number | null; no_friend?: boolean; called_joker?: CardT | null; leading?: number | null };
  function roundOf(p: PhaseView): Round | null {
    if (typeof p !== 'object') return null;
    if ('Play' in p) return p.Play;
    if ('Done' in p) return { plays: [], tricks: p.Done.tricks, friend: p.Done.friend };
    return null;
  }

  function slotCard(seat: number): Element | null {
    return felt?.querySelector(`[data-slot="${seat}"] .card`) ?? null;
  }

  /** Where a card played by `seat` comes from, or a finished trick goes to. */
  function anchor(seat: number, card?: CardT): DOMRect | null {
    if (seat === me) {
      const inHand = card && document.querySelector(`.tray [data-card='${JSON.stringify(card)}']`);
      return (inHand || document.querySelector('.tray'))?.getBoundingClientRect() ?? null;
    }
    return felt?.querySelector(`[data-seat="${seat}"]`)?.getBoundingClientRect() ?? null;
  }

  function describe(prev: StateMsg, next: StateMsg): string | null {
    const was = prev.view.phase;
    const now = next.view.phase;
    if (typeof now !== 'object') return null;
    const redeal = next.view.redealt;
    if (redeal && JSON.stringify(redeal) !== JSON.stringify(prev.view.redealt)) {
      return redeal.why === 'AllPassed'
        ? '모두 패스 · 패를 다시 나눠요'
        : `${seatName(redeal.why.Misdeal.seat)} 딜미스 · 패를 다시 나눠요`;
    }
    if ('Bidding' in now) {
      if (!(typeof was === 'object' && 'Bidding' in was)) return null;
      const passed = now.Bidding.passed.findIndex((p, i) => p && !was.Bidding.passed[i]);
      if (passed >= 0) return `${seatName(passed)} · 패스`;
      const best = now.Bidding.best;
      if (best && JSON.stringify(best) !== JSON.stringify(was.Bidding.best)) {
        return `${seatName(best[0])} · 공약 ${contractLabel(best[1])}`;
      }
      return null;
    }
    if ('Exchange' in now && !(typeof was === 'object' && 'Exchange' in was)) {
      return `${seatName(now.Exchange.declarer)} 주공 · ${contractLabel(now.Exchange.contract)}`;
    }
    if ('Exchange' in now && typeof was === 'object' && 'Exchange' in was) {
      const before = was.Exchange.contract;
      const after = now.Exchange.contract;
      if (before.trump !== after.trump) {
        return `기루다 변경 · ${contractLabel(after)}`;
      }
      if (before.count !== after.count) return `공약 올리기 · ${contractLabel(after)}`;
      return null;
    }
    if ('Play' in now && typeof was === 'object' && 'Exchange' in was) {
      const label = friendCallLabel(now.Play.call, seatName, twoJokers);
      return `프렌드 ${sameCallMighty(now.Play.call, now.Play.contract.trump) ? '마이티' : label}`;
    }
    const a = roundOf(was);
    const b = roundOf(now);
    if (a && b) {
      if (b.friend !== null && a.friend === null) return `${seatName(b.friend)} 프렌드 공개`;
      if (b.no_friend && !a.no_friend) return '프렌드 없음 · 주공 혼자';
      if (b.called_joker && !a.called_joker) return '조커콜 · 조커를 가진 사람은 조커를 내야 해요';
      if (b.tricks.length > a.tricks.length) {
        const t = b.tricks.at(-1)!;
        const got = t.plays.filter((p) => isPoint(p.card)).length;
        return `${seatName(t.winner)} 가져감${got > 0 ? ` · ${got}점` : ''}`;
      }
    }
    return null;
  }

  function sameCallMighty(c: FriendCall, trump: Suit | null): boolean {
    return typeof c === 'object' && 'Card' in c && sameCard(c.Card, mightyCard(trump));
  }

  /** Shows `fresh` cards arriving from their players while `apply` updates the table. */
  async function land(
    fresh: Played[],
    apply: () => void,
    k: number,
    context?: { all: Played[]; lead: Lead | null; trump: Suit | null; taker: number | null },
  ): Promise<boolean[]> {
    const from = fresh.map((p) => anchor(p.seat, p.card));
    apply();
    await tick();
    const heavy = fresh.map((p) =>
      context ? weight(p, context.all[0]?.seat === p.seat, context.lead, context.trump, context.taker) : null,
    );
    if (!prefersReducedMotion.current) {
      await Promise.all(
        fresh.map((p, i) => {
          const origin = from[i];
          const duration = (p.seat === me ? 220 : 320) * k;
          // A card landing on others gets an extra edge tick.
          const onTop = (context?.all.findIndex((q) => q.seat === p.seat) ?? 0) > 0;
          if (!heavy[i]) sound.card((i * 60 * k + duration * 0.8) / 1000, onTop);
          return origin && !hurry ? flyFrom(slotCard(p.seat), origin, duration, i * 60 * k) : undefined;
        }),
      );
    }
    // Heavy cards land with a thump and a beat's hold; the 마이티 and jokers
    // are called out at the seat that played them.
    for (const [i, p] of fresh.entries()) {
      const kind = heavy[i];
      if (!kind) continue;
      sound.heavy();
      const card = slotCard(p.seat);
      if (kind !== 'cut') void ring(card, 'var(--ink)');
      void settle(card);
      if (kind === 'mighty') cueAt(p.seat, '마이티', 'mighty');
      if (kind === 'joker') cueAt(p.seat, '조커', 'joker');
      if (!hurry) await pause(110 * k);
    }
    return heavy.map(Boolean);
  }

  /** The latest thing that happened, for anyone who looked away. */
  let event = $state<string | null>(null);

  // ---- Cues ---------------------------------------------------------------------
  // Big moments play at the seat that made them: the seat wiggles and a short
  // label pops in under it (Balatro-style), never blocking play.
  type CueKind = 'declarer' | 'friend' | 'mighty' | 'joker' | 'call' | 'misdeal' | 'answer';
  let seatCues = $state<Record<number, { text: string | null; id: number }>>({});
  let cueId = 0;
  let tray = $state<HTMLElement>();
  function cueAt(seat: number, text: string | null, kind: CueKind) {
    const id = ++cueId;
    seatCues[seat] = { text, id };
    sound.cue(kind);
    if (seat === me) juice(tray ?? null, 0.25);
    later(() => {
      if (seatCues[seat]?.id === id) delete seatCues[seat];
    }, 1500);
  }
  /** The result has been counted out (or shown at once). */
  let tallied = $state(false);

  /** How hard a card lands: the 마이티 and jokers ring; a trump cutting the round thumps.
   * With two jokers the other-colour one ranks below every trump, so a joker
   * rings only while it takes the round (`taker`); otherwise it lands plainly. */
  function weight(
    p: Played,
    leader: boolean,
    lead: Lead | null,
    trump: Suit | null,
    taker: number | null,
  ): 'mighty' | 'joker' | 'cut' | null {
    if (!p.powered) return null;
    if ('Joker' in p.card) return !twoJokers || taker === p.seat ? 'joker' : null;
    if (sameCard(p.card, mightyCard(trump))) return 'mighty';
    const suit = p.card.Normal[0];
    if (leader || trump === null || suit !== trump || !lead) return null;
    const followsLead = 'Suit' in lead ? lead.Suit === trump : (['Spade', 'Club'].includes(trump) ? 'Black' : 'Red') === lead.Color;
    return followsLead ? null : 'cut';
  }

  /** A hand thrown in as 딜미스, shown face up for a while as at a real table. */
  let thrownIn = $state<{ seat: number; hand: CardT[] } | null>(null);
  let thrownInTimer: ReturnType<typeof setTimeout> | undefined;
  function showThrownIn(next: StateMsg, prev: StateMsg) {
    const redeal = next.view.redealt;
    if (!redeal || JSON.stringify(redeal) === JSON.stringify(prev.view.redealt)) return;
    // Up until the next deal lands, or for at most 4 s.
    clearTimeout(thrownInTimer);
    if (redeal.why === 'AllPassed') {
      thrownIn = null;
      return;
    }
    thrownIn = redeal.why.Misdeal;
    thrownInTimer = setTimeout(() => (thrownIn = null), 4000);
  }

  /** Sounds and the event line for a change of state. */
  function cues(prev: StateMsg, next: StateMsg) {
    const was = prev.view.phase;
    const now = next.view.phase;
    event = describe(prev, next) ?? event;
    showThrownIn(next, prev);
    const redeal = next.view.redealt;
    if (redeal && redeal.why !== 'AllPassed' && JSON.stringify(redeal) !== JSON.stringify(prev.view.redealt)) {
      cueAt(redeal.why.Misdeal.seat, '딜미스', 'misdeal');
    }
    const calledBefore = roundOf(was)?.called_joker;
    if (typeof now === 'object' && 'Play' in now && now.Play.called_joker && !calledBefore && now.Play.plays[0]) {
      cueAt(now.Play.plays[0].seat, '조커콜', 'call');
    }
    const turnOf = (m: StateMsg) => (typeof m.turn === 'object' ? m.turn.Seat : null);
    if (me !== null && turnOf(next) === me && turnOf(prev) !== me) {
      sound.turn();
      if (settings.haptics) navigator.vibrate?.(18);
    }
    const kind = (p: PhaseView) => (typeof p === 'object' ? Object.keys(p)[0] : p);
    if (kind(now) !== kind(was)) {
      if (kind(now) === 'Exchange' && typeof now === 'object' && 'Exchange' in now) cueAt(now.Exchange.declarer, null, 'declarer');
      if (kind(now) === 'Play' && kind(was) === 'Exchange') sound.call();
      if (kind(now) === 'Bidding') sound.shuffle();
    } else if (redeal && JSON.stringify(redeal) !== JSON.stringify(prev.view.redealt)) {
      sound.shuffle();
    }
    if (typeof was === 'object' && 'Bidding' in was && typeof now === 'object' && 'Bidding' in now) {
      const moved = JSON.stringify(was.Bidding.best) !== JSON.stringify(now.Bidding.best) ||
        was.Bidding.passed.filter(Boolean).length !== now.Bidding.passed.filter(Boolean).length;
      if (moved) {
        const raised = JSON.stringify(was.Bidding.best) !== JSON.stringify(now.Bidding.best);
        const raises = next.view.bids.filter((b) => b.contract !== null).length;
        sound.bid(raised ? raises : 0);
      }
    }
    if (typeof now === 'object' && 'Done' in now && !(typeof was === 'object' && 'Done' in was)) {
      const d = now.Done;
      const declarerWon = d.team_points >= d.contract.count;
      const mine = me === null || me === d.declarer || me === d.friend;
      sound.result(mine ? declarerWon : !declarerWon);
    }
    // With motion off, cards still make their sound as they land.
    if (pace() === 0 || prefersReducedMotion.current) {
      const a = roundOf(was);
      const b = roundOf(now);
      if (a && b && b.tricks.length === a.tricks.length) {
        b.plays.slice(a.plays.length).forEach((_, i) => sound.card(i * 0.06, a.plays.length + i > 0));
      }
    }
  }

  async function transition(prev: StateMsg, next: StateMsg, k: number) {
    const before = roundOf(prev.view.phase);
    const after = roundOf(next.view.phase);
    // A redeal (딜미스, or everyone passing) is a fresh deal too: the cards
    // are gathered and dealt again, as at a real table.
    const redealt = next.view.redealt != null && JSON.stringify(next.view.redealt) !== JSON.stringify(prev.view.redealt);
    const newHand =
      typeof next.view.phase === 'object' && 'Bidding' in next.view.phase && (!('Bidding' in Object(prev.view.phase)) || redealt);
    if (!before || !after) {
      shown = next;
      if (newHand) {
        // Like a trick's end, the deal is not hurried by your turn. A
        // redeal goes twice as fast: everyone has just seen a deal.
        dealing = true;
        quickDeal = redealt;
        await pause((redealt ? 450 : 900) * paceUnhurried());
        dealing = false;
        quickDeal = false;
      }
      return;
    }
    const reduced = prefersReducedMotion.current;
    const nowPhase = next.view.phase;
    const trump = typeof nowPhase === 'object' && 'Play' in nowPhase ? nowPhase.Play.contract.trump : null;
    const liveLead = typeof nowPhase === 'object' && 'Play' in nowPhase ? nowPhase.Play.lead : null;
    if (after.tricks.length === before.tricks.length) {
      const fresh = after.plays.slice(before.plays.length);
      const heavy = await land(fresh, () => (shown = next), k, {
        all: after.plays,
        lead: liveLead,
        trump,
        taker: after.leading ?? null,
      });
      // A card that takes the lead gives a small bounce once it has landed;
      // heavy cards have already made their own entrance.
      const was = before.leading ?? null;
      const now = after.leading ?? null;
      const taker = fresh.findIndex((p) => p.seat === now);
      if (was !== null && now !== null && now !== was && taker >= 0 && !heavy[taker] && !hurry) {
        void juice(slotCard(now), 0.15);
      }
    } else if (after.tricks.length === before.tricks.length + 1) {
      const trick = after.tricks.at(-1)!;
      await land(
        trick.plays.slice(before.plays.length),
        () => {
          resolving = { plays: trick.plays, key: after.tricks.length, lead: trick.lead };
          shown = next;
        },
        k,
        { all: trick.plays, lead: trick.lead, trump, taker: trick.winner },
      );
      // The hero moment: a beat, the winning card pops, the whole trick
      // stays a moment to be read, then sweeps to its winner. The hold is
      // not hurried by your turn: everyone gets to see how the round ended.
      const kh = paceUnhurried();
      await pause(150 * kh);
      winner = trick.winner;
      await pop(slotCard(trick.winner), reduced || hurry ? 0 : 360 * kh);
      await pause((reduced ? 1100 : 900) * kh);
      const to = anchor(trick.winner);
      // The sweep is heard from the winner's side of the table.
      const pan = to ? ((to.left + to.width / 2) / innerWidth - 0.5) * 1.2 : 0;
      sound.sweep(trick.plays.filter((p) => isPoint(p.card)).length, 0, pan);
      if (!reduced && !hurry && to) {
        await Promise.all(trick.plays.map((p, i) => flyTo(slotCard(p.seat), to, 400 * k, i * 40 * k)));
      }
      // The winner's plate takes the cards with a small bounce.
      void juice(trick.winner === me ? (tray ?? null) : (felt?.querySelector(`[data-seat="${trick.winner}"] .seat`) ?? null), trick.winner === me ? 0.15 : 0.35);
      await land(
        after.plays,
        () => {
          resolving = null;
          winner = null;
        },
        k,
      );
    } else {
      shown = next;
    }
    if (before.friend === null && after.friend !== null && after.friend !== undefined) {
      revealed = after.friend;
      cueAt(after.friend, null, 'friend');
      // The 주공's seat answers, linking the two.
      const partner = typeof next.view.phase === 'object' && 'Play' in next.view.phase ? next.view.phase.Play.declarer : null;
      if (partner !== null) later(() => cueAt(partner, null, 'answer'), 260 * k);
      await pause(700 * k);
      revealed = null;
    }
  }

  const onTable = $derived(resolving ? resolving.plays : (play?.plays ?? []));
  const onTableLead = $derived(resolving ? resolving.lead : (play?.lead ?? null));
  /** Who is winning the trick so far, by the server's reckoning; nobody
   * while a finished trick resolves, when the winner is shown instead. */
  const leading = $derived(resolving ? null : (play?.leading ?? null));
  const trickKey = $derived(resolving ? `r${resolving.key}` : `p${play?.tricks.length ?? 0}`);

  // ---- Where the figures look, and how they feel ---------------------------------
  // Everyone watches the player whose turn it is (you, on yours), and glances
  // at the middle for a moment when a card lands there.
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
  function lookAt(r: number): { x: number; y: number } | null {
    const from = { x: Math.cos(angle(r)), y: Math.sin(angle(r)) };
    const toward = (x: number, y: number) => (x === from.x && y === from.y ? null : { x: x - from.x, y: y - from.y });
    if (glanceMiddle || (turn !== null && relative(turn) === r)) return toward(0, 0);
    if (turn === null) return null;
    const t = myTurn ? 0 : relative(turn);
    return toward(Math.cos(angle(t)), Math.sin(angle(t)));
  }
  function mood(seat: number): 'happy' | 'down' | null {
    if (done) {
      const declarerWon = done.team_points >= done.contract.count;
      return (seat === done.declarer || seat === done.friend) === declarerWon ? 'happy' : 'down';
    }
    if (winner === null) return null;
    if (seat === winner) return 'happy';
    return resolving?.plays.some((p) => p.seat === seat && isPoint(p.card)) ? 'down' : null;
  }
  const trickNo = $derived(resolving ? resolving.key : play ? play.trick_no + 1 : 0);
  /** Why a card on the table is hatched: it has no power here. The suit a
   * led joker named is shown on the joker itself. */
  const trickNotes = $derived.by(() => {
    const notes: string[] = [];
    for (const p of onTable) {
      if (p.powered) continue;
      const when = trickNo === 1 ? '첫 라운드라 ' : trickNo === view.rules.hand_size ? '마지막 라운드라 ' : '';
      notes.push(`${when}${cardLabel(p.card)} 효력 없음`);
    }
    return notes;
  });
  let replay = $state(false);
  let sharing = $state(false);

  const callLabel = $derived.by(() => {
    if (!call) return null;
    if (friend !== null) return seatName(friend);
    if (noFriend && call !== 'Alone') return '없음';
    if (typeof call === 'object' && 'Card' in call && contract && sameCard(call.Card, mightyCard(contract.trump))) {
      return '마이티';
    }
    return friendCallLabel(call, seatName, twoJokers);
  });

  /** Whose turn it is, in parts, so a long name gives way and the rest stays. */
  const waiting = $derived.by(() => {
    if (turn === null) return null;
    const name = seatName(turn);
    if (exchange) return { pre: '주공 ', name, post: ' · 키티 정리 중' };
    if (lastChance !== null) return { pre: '모두 패스했어요 · 딜러 ', name, post: ` 한 번 더 (${lastChance}부터)` };
    if (bidding) return { pre: '', name, post: ' · 공약 고르는 중' };
    return { pre: '', name, post: ' 차례' };
  });
  const waitingFor = $derived(waiting ? waiting.pre + waiting.name + waiting.post : null);
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

  /** Controls that rise over the felt's foot: bids, the exchange, a joker's choices. */
  const controls = $derived(!!variants || (myTurn && (bidding !== null || exchange !== null)));
  let controlsHeight = $state(0);
  // Three rows of controls (the exchange with 공약 올리기) would lift the
  // hint and reaction buttons into the seats; they step aside until then.
  const crowded = $derived(controls && controlsHeight > 130);

  /** Where the result sits on wider screens, from the felt's top: under
   * the side seats when it fits there; else under the top seats and as wide
   * as the ring, so it covers the side seats whole instead of slicing them. */
  let resultFit = $state<{ top: number; width: number | null } | null>(null);
  $effect(() => {
    if (!done || !felt) return;
    const measure = () => {
      const f = felt.getBoundingClientRect();
      const side = felt.querySelector('.spot.pos-1 .seat, .spot.pos-4 .seat')?.getBoundingClientRect();
      const top = felt.querySelector('.spot.pos-2 .seat, .spot.pos-3 .seat')?.getBoundingClientRect();
      const ring = felt.querySelector('.ring')?.getBoundingClientRect();
      const sheet = document.querySelector<HTMLElement>('.result-layer .sheet');
      const body = sheet?.querySelector<HTMLElement>('.result-body');
      const foot = sheet?.querySelector<HTMLElement>('.result-foot');
      if (!side || !top || !ring || !sheet?.parentElement || !body || !foot) return;
      const floor = sheet.parentElement.getBoundingClientRect().bottom;
      const under = side.bottom - f.top + 8;
      resultFit =
        floor - (f.top + under) >= body.scrollHeight + foot.offsetHeight
          ? { top: under, width: null }
          : { top: top.bottom - f.top + 8, width: ring.width + 16 };
    };
    void tick().then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const seated = $derived(client.seat !== null);
  const full = $derived(room?.seats.every((s) => s.kind !== 'empty') ?? false);

  // ---- Between hands -------------------------------------------------------
  // The table stays: the seats keep their places, the result folds away,
  // and the middle offers the next hand. A tap on a seat opens its choices.
  /** The result folded away, to look at the table. */
  let folded = $state(false);
  $effect(() => {
    if (!done) folded = false;
  });
  const between = $derived(!(room?.in_hand ?? false) && (idle || (done !== null && folded)));
  const emptySeats = $derived(room?.seats.filter((s) => s.kind === 'empty').length ?? 0);
  /** 섞기 pressed: the seats are shuffled when the next hand starts. */
  const shuffleNext = $derived(room?.table.shuffle_next ?? false);
  /** What everyone at the table (watchers too) is told about the next shuffle. */
  const shuffleNote = $derived(
    room?.table.shuffle ? '매 판 시작할 때 자리를 섞어요' : shuffleNext ? '다음 판 시작할 때 자리를 섞어요' : null,
  );
  /** The seat whose choices are open, and where it is on screen. */
  let menuSeat = $state<number | null>(null);
  let menuAnchor = $state<HTMLElement | null>(null);
  /** Swapping: the seat chosen first; the next seat tapped trades with it. */
  let swapFrom = $state<number | null>(null);
  /** The name a watcher sits down with. */
  let sitName = $state(savedName());
  $effect(() => {
    if (!between) {
      menuSeat = null;
      swapFrom = null;
    }
  });

  function openSeat(seat: number, event: MouseEvent) {
    if (swapFrom !== null) {
      if (seat !== swapFrom) client.swapSeats(swapFrom, seat);
      swapFrom = null;
      return;
    }
    const info = room?.seats[seat];
    // A watcher has nothing to choose at someone else's seat.
    if (!info || (me === null && info.kind === 'human')) return;
    const box = (event.currentTarget as HTMLElement).closest('[data-seat]')?.querySelector('.seat');
    menuAnchor = (box as HTMLElement | null) ?? (event.currentTarget as HTMLElement);
    menuSeat = seat;
  }
  /** Where `seat`'s choices hang from now: the seat tapped, or, if it was
   * drawn afresh since, the seat as it is drawn now. */
  function seatRect(seat: number): DOMRect {
    const el = menuAnchor?.isConnected ? menuAnchor : section?.querySelector(`[data-seat="${seat}"] .seat`);
    return (el ?? section ?? document.body).getBoundingClientRect();
  }
  /** One tap to sit for someone whose name is known; else the name first. */
  function sitAt(seat: number, event: MouseEvent) {
    const name = sitName.trim();
    if (name) client.join(name, seat);
    else openSeat(seat, event);
  }
  function seatLabel(seat: number): string {
    const name = occupantName(room?.seats[seat], seat);
    if (name === null) return `${seat + 1}번 자리`;
    return seat === me ? '내 자리' : name;
  }

  // Seats slide to their new places when they move (a swap or a shuffle):
  // the client says so while the old places are still on screen.
  let section = $state<HTMLElement>();
  let flip: { rects: Map<number, DOMRect>; order: number[] | null } | null = null;
  function seatBoxes(): Map<number, DOMRect> {
    const boxes = new Map<number, DOMRect>();
    for (const el of section?.querySelectorAll<HTMLElement>('[data-seat]') ?? []) {
      const r = (el.querySelector('.seat') ?? el).getBoundingClientRect();
      if (r.width > 0) boxes.set(Number(el.dataset.seat), r);
    }
    return boxes;
  }
  /** How long seats take to slide to their new places. */
  const slideMs = () => (settings.speed === 'fast' ? 260 : 460);
  /** Until when the seats are sliding (performance.now()); a deal that
   * comes with a shuffle waits for them to arrive. */
  let slidingUntil = 0;
  $effect(() => {
    client.onmove = (order) => {
      const still = prefersReducedMotion.current || settings.speed === 'off';
      // A move arriving while the last one still slides starts from where
      // the seats are drawn now: finish that one first.
      for (const a of section?.getAnimations({ subtree: true }) ?? []) if (a.id === 'seat-slide') a.finish();
      flip = { rects: seatBoxes(), order };
      if (!still) slidingUntil = performance.now() + slideMs() + 80;
      menuSeat = null;
      swapFrom = null;
      if (order) {
        const moved: (string | null)[] = [];
        known.forEach((name, s) => (moved[order[s] ?? s] = name));
        known = moved;
      }
    };
    return () => {
      client.onmove = null;
    };
  });
  let kinds: string[] | null = null;
  $effect(() => {
    const seats = room?.seats ?? [];
    const now = seats.map((s) => s.kind);
    const was = kinds;
    kinds = now;
    const f = flip;
    flip = null;
    const still = prefersReducedMotion.current || settings.speed === 'off';
    if (f) {
      if (still) return;
      void tick().then(() => {
        for (const el of section?.querySelectorAll<HTMLElement>('[data-seat]') ?? []) {
          const seat = Number(el.dataset.seat);
          // Who sits here now came from `from`: slide from there.
          const from = f.order ? f.order.indexOf(seat) : seat;
          const old = f.rects.get(from);
          const box = (el.querySelector<HTMLElement>('.seat') ?? el).getBoundingClientRect();
          if (!old || box.width === 0) continue;
          const dx = old.left + old.width / 2 - (box.left + box.width / 2);
          const dy = old.top + old.height / 2 - (box.top + box.height / 2);
          if (Math.hypot(dx, dy) < 2) continue;
          // The seat and what hangs under it (an empty seat's buttons) go together.
          for (const part of el.children) {
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
      void tick().then(() => juice(section?.querySelector(`[data-seat="${i}"] .seat`) ?? null, 0.4));
    });
  });
</script>

<section class="table" bind:this={section} class:mine={myTurn} class:watching={me === null} class:nudge class:tips={settings.tips} class:between class:swapping={swapFrom !== null}>
  <!-- 상황판: everything about the hand on one line. -->
  {#snippet hintTools()}
    {#if client.hint && myTurn}
      <span class="hint-text pop" role="status"><Icon name="hint" /> 봇이라면 <strong>{actionLabel(client.hint, seatName)}</strong></span>
    {:else if settings.hints && liveTurn}
      <button class="hint-btn" aria-label="봇이라면 뭘 할지 보기" onclick={() => client.askHint()}><Icon name="hint" /></button>
    {/if}
  {/snippet}
  {#snippet seatTap(seat: number)}
    <!-- Between hands a seat is one button: its choices, or the other half of a swap. -->
    <button
      class="seat-tap"
      aria-label={swapFrom === null
        ? `${seatLabel(seat)} 자리 메뉴`
        : swapFrom === seat
          ? `${seatLabel(seat)} 그만 고르기`
          : `${seatLabel(seat)}: 여기와 바꾸기`}
      aria-pressed={swapFrom === seat ? true : undefined}
      aria-haspopup={swapFrom === null ? 'dialog' : undefined}
      onclick={(e) => openSeat(seat, e)}
    ></button>
  {/snippet}
  {#snippet unfold()}
    <!-- The folded result waits on the tray's rim, like a sheet's tab. -->
    <button class="prompt pill unfold" onclick={() => (folded = false)}><Icon name="result" size="18px" />결과 다시 보기</button>
  {/snippet}
  {#snippet ticks()}
    {#if contract}
      <!-- One tick per point card: 여당 from the left, 야당 from the right.
           The line is the contract. (Where 야당 would break it is always the
           tick just before, so it needs no mark of its own.) -->
      <span class="tally" role="img" aria-label="점수 카드 20장 중 여당 {tallyDecl}장, 야당 {tallyDef}장" use:goLive>
        {#each TICKS as i (i)}
          {@const side = i < tallyDecl ? 'decl' : i >= 20 - tallyDef ? 'def' : ''}
          <span
            class="tick {side}"
            style:--d="{Math.max(0, side === 'decl' ? i - tallyFrom.decl : side === 'def' ? 19 - i - tallyFrom.def : 0) * 40}ms"
          ></span>
        {/each}
        <span class="goal" style:left={tickEdge(contract.count)}></span>
      </span>
    {/if}
  {/snippet}
  <div class="status" aria-live="polite">
    {#if bidding}
      {#if bidding.best}
        <span class="item">최고 공약 <strong class="contract">{contractLabel(bidding.best[1])}</strong></span>
        <span class="item muted">{seatName(bidding.best[0])}</span>
      {:else}
        <span class="item">공약 없음</span>
        <span class="item muted">최소 {lastChance ?? view.rules.bidding.min}</span>
      {/if}
    {:else if contract}
      <span class="item">
        공약
        <strong class="contract">
          {#if contract.trump}<SuitIcon suit={contract.trump} class="trump-icon suit-{contract.trump}" />{:else}노기루다{/if}
          {contract.count}
        </strong>
      </span>
      {#if callLabel}<span class="item">프렌드 <strong>{callLabel}</strong></span>{/if}
      {#if play}<span class="item">라운드 <strong>{trickNo}/{view.rules.hand_size}</strong></span>{/if}
      {#if play || done}
        <span class="item meter">
          <span class="meter-label">여당 {#key teamPoints}<strong class="bump">{teamPoints}/{contract.count}</strong>{/key}</span>
          {@render ticks()}
          {#each tags as t (t.text)}<span class="tag-chip {t.tone} pop">{t.text}</span>{/each}
        </span>
      {/if}
    {:else if idle && room}
      <!-- No hand yet: the rules this table plays, a tap opens them. -->
      <button class="rules-chip" onclick={onrules}>{rulesName}</button>
      {#if room.table.turn_secs}<span class="item">턴 <strong>{room.table.turn_secs}</strong>초</span>{/if}
      {#if room.hands_played > 0}<span class="item"><strong>{room.hands_played}</strong>판 끝</span>{/if}
    {/if}
    {#if me !== null}
      <span class="react-status">
        {@render hintTools()}
        <Reactions below onreact={(text) => client.react(text)} />
      </span>
    {/if}
  </div>
  <!-- Always there, at a fixed height, so the felt below never moves. -->
  <div class="event">
    {#if event && !done}{#key event}<p class="fade-up" aria-live="polite">{event}</p>{/key}{/if}
    {#if tip}{#key tip}<p class="tip fade-up" aria-live="polite">{tip}</p>{/key}{/if}
  </div>

  <!-- Desktop: the hand at a glance, on stacked paper beside the felt. -->
  <aside class="side" aria-label="게임 정보">
    <section class="pane board" aria-label="상황판">
      <h3 class="pane-title">
        상황판
        {#if play}<span class="round-no">라운드 <strong>{trickNo}</strong>/{view.rules.hand_size}</span>{/if}
      </h3>
      {#if bidding}
        <div class="big-contract">
          {#if bidding.best}
            {@const best = bidding.best[1]}
            <span class="glyph-box">
              {#if best.trump}<SuitIcon suit={best.trump} class="suit-{best.trump}" />{:else}<span class="nt">노</span>{/if}
            </span>
            <span class="big-num">{best.count}</span>
            <span class="big-sub">최고 공약<br /><strong>{seatName(bidding.best[0])}</strong></span>
          {:else}
            <span class="big-sub">공약 없음<br /><strong>최소 {lastChance ?? view.rules.bidding.min}</strong></span>
          {/if}
        </div>
      {:else if contract}
        <div class="big-contract">
          <span class="glyph-box">
            {#if contract.trump}<SuitIcon suit={contract.trump} class="suit-{contract.trump}" />{:else}<span class="nt">노</span>{/if}
          </span>
          <span class="big-num">{contract.count}</span>
          <dl class="facts">
            {#if declarer !== null}<div><dt>주공</dt><dd><span class="clip">{seatName(declarer)}</span></dd></div>{/if}
            {#if callLabel}
              <div>
                <dt>프렌드</dt>
                <dd>
                  {#if friend === null && !noFriend && call && typeof call === 'object' && 'Card' in call}
                    <Card card={call.Card} size="mini" width={22} seal={seal(call.Card)} {twoJokers} />
                  {/if}
                  <span class="clip">{callLabel}</span>
                </dd>
              </div>
            {/if}
          </dl>
        </div>
        {#if play || done}
          <div class="side-meter">
            <span class="meter-row">
              <span>여당 {#key teamPoints}<strong class="bump">{teamPoints}</strong>{/key}<span class="of">/{contract.count}</span></span>
              <span>야당 <strong>{tallyDef}</strong></span>
            </span>
            {@render ticks()}
            {#if tags.length}
              <span class="side-tags">{#each tags as t (t.text)}<span class="tag-chip {t.tone} pop">{t.text}</span>{/each}</span>
            {/if}
          </div>
        {/if}
      {:else if idle && room}
        <p class="pane-empty">{room.hands_played === 0 ? '첫 판을 기다려요' : `${room.hands_played}판 끝 · 다음 판을 기다려요`}</p>
        {#if shuffleNote}<p class="pane-empty"><strong>{shuffleNote}</strong></p>{/if}
        <button class="rules-chip side-rules" onclick={onrules}>{rulesName}</button>
      {:else}
        <p class="pane-empty">패를 나누는 중</p>
      {/if}
    </section>

    <section class="pane scores" aria-label="점수판">
      <h3 class="pane-title">점수판 <span class="cols"><span>점수</span><span>누적</span></span></h3>
      <ol class="score-rows">
        {#each Array.from({ length: n }, (_, k) => seatAt(k)) as s (s)}
          {@const info = room?.seats[s]}
          {@const t = team(s)}
          {@const vacant = info?.kind === 'empty' && s !== me}
          <li class:me={s === me} class:turn={turn === s} class:vacant>
            <span class="head" class:on={turn === s}>
              {#if vacant}
                <!-- An empty seat: the dashed outline the seat itself shows. -->
                <svg class="vacant-figure" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg>
              {:else}
                <PlayerFigure still team={t} trumpSuit={contract?.trump ?? null} isBot={info?.kind === 'bot'} offline={info?.kind === 'human' && !info.connected} />
              {/if}
            </span>
            <span class="who-cell">
              <span class="row-name">{s === me ? myName : vacant && idle ? '빈 자리' : seatName(s)}</span>
              {#if t}<span class="team mini-team {t === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[t]}</span>{/if}
            </span>
            <span class="num hand-pts">{play || done ? points(s) : '–'}</span>
            <span class="num total" class:neg={(room?.scores[s] ?? 0) < 0}>{vacant && idle ? '–' : (room?.scores[s] ?? 0)}</span>
          </li>
        {/each}
      </ol>
    </section>


  </aside>

  <div class="felt" bind:this={felt} style:--over="{controls ? controlsHeight : 0}px">
    {#if me !== null && !done && !crowded}
      <span class="react-spot">
        {@render hintTools()}
        <Reactions onreact={(text) => client.react(text)} />
      </span>
    {/if}
    <!-- The seats and the trick sit in a ring no wider than the felt is tall,
         so on a wide screen the seats stay near their cards. -->
    <div class="ring">
      {#each around as r (r)}
        {@const s = seatAt(r)}
        {@const info = room?.seats[s]}
        <div
          class="spot pos-{n === 5 ? r : 'free'}"
          class:picked={swapFrom === s}
          data-seat={s}
          style:--x={Math.cos(angle(r))}
          style:--y={Math.sin(angle(r))}
        >
          <div class="seat-box">
          <Seat
            empty={info?.kind === 'empty'}
            score={between && (room?.hands_played ?? 0) > 0 ? (room?.scores[s] ?? null) : null}
            name={info?.kind === 'empty' ? '빈 자리' : seatName(s)}
            bot={info?.kind === 'bot'}
            offline={info?.kind === 'human' && !info.connected}
            team={team(s)}
            points={points(s)}
            turn={turn === s}
            bubble={bubble(s)}
            reaction={client.reactions?.[s] ?? null}
            reactSide={n === 5 && r === 2 ? 'right' : n === 5 && r === 3 ? 'left' : 'up'}
            cue={seatCues[s] ?? null}
            dim={bidding?.passed[s] ?? false}
            reveal={revealed === s}
            trumpSuit={contract?.trump ?? null}
            lookAt={lookAt(r)}
            mood={mood(s)}
            clock={seatClock(s)}
            away={isAway(s)}
          />
          {#if between}{@render seatTap(s)}{/if}
          </div>
          {#if between && swapFrom === null && info?.kind === 'empty'}
            <!-- An empty seat says how to fill it, right there. -->
            <span class="seat-acts">
              {#if me !== null}
                <button class="seat-act" onclick={() => client.addBot(s)} aria-label="{s + 1}번 자리에 봇 앉히기">+ 봇</button>
                <button class="seat-act" onclick={oninvite} aria-label="친구 초대하기">초대</button>
              {:else}
                <button class="seat-act" onclick={(e) => sitAt(s, e)} aria-label="{s + 1}번 자리에 앉기">앉기</button>
              {/if}
            </span>
          {/if}
        </div>
      {/each}

      <div class="trick" aria-label={resolving ? '끝난 라운드' : '이번 라운드'}>
        {#each onTable as p, i (`${trickKey}-${p.seat}`)}
          {@const [x, y] = slotVector(relative(p.seat))}
          <div
            class="slot"
            class:beaten={winner !== null && p.seat !== winner}
            class:leading={p.seat === leading}
            data-slot={p.seat}
            style:--tilt="{((p.seat * 7 + trickNo * 3) % 5) - 2}deg"
            style:--x={x} style:--y={y}>
            <Card
              card={p.card}
              size="trick"
              seal={seal(p.card)}
              {twoJokers}
              powerless={!p.powered}
              won={p.seat === winner}
            />
            {#if i === 0 && 'Joker' in p.card && onTableLead}<LeadTag lead={onTableLead} />{/if}
          </div>
        {/each}
      </div>

      <!-- One line right under the trick; a long name gives way first. -->
      {#if resolving && winner !== null}
        <p class="note below won-note"><span class="who-name">{winner === me ? '내가' : seatName(winner)}</span> 가져감</p>
      {:else if play && play.plays.length === 0 && !resolving}
        <p class="note">{#if turn === me}내가 선{:else}<span class="who-name">{seatName(play.leader)}</span> 선{/if}</p>
      {:else if play?.called_joker}
        <p class="note below alert">조커콜 · 조커를 내야 해요</p>
      {:else if leading !== null || trickNotes.length > 0}
        <p class="note below">
          {#if leading !== null}<span class="who-name">{leading === me ? '내가' : seatName(leading)}</span> 이기는 중{/if}{#if trickNotes.length}{leading !== null ? ' · ' : ''}{trickNotes.join(' · ')}{/if}
        </p>
      {/if}

      <!-- A hand thrown in sits where the trick goes, between the seats. -->
      {#if thrownIn && bidding}
        <div class="sheet thrown-in fade-up" role="status" aria-label="딜미스로 보여 준 패">
          <div class="thrown-head">
            <p class="thrown-title"><span class="who-name">{seatName(thrownIn.seat)}</span> 딜미스</p>
            <button class="close" onclick={() => (thrownIn = null)}>닫기</button>
          </div>
          <div class="thrown-cards">
            {#each [thrownIn.hand.slice(0, Math.ceil(thrownIn.hand.length / 2)), thrownIn.hand.slice(Math.ceil(thrownIn.hand.length / 2))] as row, r (r)}
              <div class="thrown-row">
                {#each row as c, i (i)}<Card card={c} size="mini" {twoJokers} />{/each}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if between && room}
        <!-- Between hands the middle of the table holds what comes next. -->
        <div class="centre">
          {#if swapFrom !== null}
            <p class="centre-note">바꿀 자리를 누르세요</p>
            <button onclick={() => (swapFrom = null)}>취소</button>
          {:else if me !== null}
            {#if full}
              <button class="primary go" onclick={() => client.start()}>{room.hands_played === 0 ? '시작' : '다음 판'}</button>
            {:else}
              <p class="centre-note">빈 자리 <strong>{emptySeats}</strong>개 · 봇이나 친구로 채우면 시작해요</p>
            {/if}
            {#if shuffleNote}<p class="centre-sub shuffle-note" role="status">{shuffleNote}</p>{/if}
            <div class="tools">
              {#if room.table.shuffle}
                <!-- 매 판 자리 섞기 is on: 섞기 is already as on as it gets; the
                     setting itself is under 설정. -->
                <button class="tool on" aria-pressed="true" aria-label="섞기: 매 판 자리 섞기 켜짐 (설정에서 바꿔요)" onclick={onmenu}>
                  <Icon name="shuffle" size="22px" /><span>섞기</span>
                </button>
              {:else}
                <button
                  class="tool"
                  class:on={shuffleNext}
                  aria-pressed={shuffleNext}
                  aria-label={shuffleNext ? '섞기 취소: 자리 그대로 시작해요' : '섞기: 다음 판 시작할 때 자리를 섞어요'}
                  onclick={() => client.shuffleNext(!shuffleNext)}
                >
                  <Icon name="shuffle" size="22px" /><span>섞기</span>
                </button>
              {/if}
              <button class="tool" onclick={onmenu}><Icon name="sliders" size="22px" /><span>설정</span></button>
            </div>
          {:else}
            <p class="centre-note">
              {#if emptySeats > 0}빈 자리를 눌러 앉으세요
              {:else if room.seats.some((x) => x.kind === 'bot')}봇 자리를 눌러 대신 앉을 수 있어요
              {:else}자리가 다 찼어요 · 구경하는 중{/if}
            </p>
            {#if sitName.trim() && (emptySeats > 0 || room.seats.some((x) => x.kind === 'bot'))}
              <p class="centre-sub"><strong class="who-name">{sitName.trim()}</strong> 이름으로 앉아요</p>
            {/if}
            {#if shuffleNote}<p class="centre-sub shuffle-note" role="status">{shuffleNote}</p>{/if}
          {/if}
        </div>
      {/if}
    </div>

  </div>

  {#if done && !folded}
    {@const won = done.team_points >= done.contract.count}
    {@const mineWon = me !== null && won === (me === done.declarer || me === done.friend)}
    <!-- The result rises from the foot of the table (the hand is empty by
         now) and stops under the top seats; its buttons are its own footer. -->
    <div
      class="result-layer"
      class:cover={!!resultFit?.width}
      style:--fit-top={resultFit ? `${resultFit.top}px` : undefined}
      style:--fit-w={resultFit?.width ? `${resultFit.width}px` : undefined}
    >
      <!-- A tap anywhere on the result skips the count; keys need nothing to skip. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <div class="sheet result" class:big={result && result.made && result.margin >= 3} class:lost={!mineWon && me !== null} role="status" onclick={skipCount}>
        <!-- Folds the result down to look at the table; the middle of the
             table then offers the next hand and brings the result back. -->
        <button
          class="fold"
          onclick={(e) => {
            e.stopPropagation();
            folded = true;
          }}><span>테이블 보기</span><Icon name="fold" size="18px" /></button
        >
        <div class="result-body">
          <div class="result-head">
            <p class="headline">
              {#if result?.run && tallied}<span class="run-word">런</span>{:else}{won ? '여당 승리' : '야당 승리'}{/if}
              {#if mineWon}
                <span class="burst" aria-hidden="true">
                  {#each ['Spade', 'Heart', 'Diamond', 'Club', 'Spade', 'Heart', 'Diamond', 'Club'] as const as suit, i (i)}
                    <span class="spark suit-{suit}" style:--a="{i * 45 + 20}deg"><SuitIcon {suit} /></span>
                  {/each}
                </span>
              {/if}
            </p>
            <!-- When made, the first line of the count already says the points. -->
            <p class="sub" class:said={result?.made}>여당 <strong>{done.team_points}</strong> / 공약 {done.contract.count}</p>
            {#if result}
              <ol class="ledger" aria-label="점수 계산">
                {#each result.lines as line, i (i)}
                  <li class:shown={step > i} class:total={i === result.lines.length - 1}>{line}</li>
                {/each}
              </ol>
            {/if}
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
                  <td class="role">{#if t}<span class="team {t === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[t]}</span>{/if}</td>
                  <td class="num">
                    {points(s)}
                  </td>
                  <td class="num" class:neg={pay < 0}>{(shownPay[s] ?? pay) > 0 ? '+' : ''}{shownPay[s] ?? pay}</td>
                  <td class="num">{room?.scores[s] ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if earned.length}
            <div class="achieved" role="status">
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
        <div class="result-foot">
          {#if seated && !full}<p class="muted wait-seats">빈 자리를 채우면 다음 판을 시작할 수 있어요</p>
          {:else if shuffleNote}<p class="muted wait-seats" role="status">{shuffleNote}</p>{/if}
          <div class="next">
            {#if me !== null}
              <span class="foot-react">
                <Reactions onreact={(text) => client.react(text)} />
              </span>
            {/if}
            {#if done.tricks.length}<button onclick={() => (replay = true)}>다시 보기</button>{/if}
            {#if room}<button onclick={() => (sharing = true)}>결과 카드</button>{/if}
            {#if me !== null}<button class="primary" disabled={!seated || !full} onclick={() => client.start()}>다음 판</button>{/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if me !== null}
    <!-- One fixed slot between the felt and the hand. What it holds rises
         over the felt's foot instead of pushing the table up, so the seats
         never move: bids and the exchange on the table's own paper, the turn
         as a pill on the tray's rim. -->
    <div class="strip">
      {#if controls}
        <div class="controls" bind:clientHeight={controlsHeight}>
          {#if variants}
            <div class="variants">
              {#each variants as v, i (i)}
                <button class="chip" onclick={() => act({ Play: v })}>{variantLabel(v)}</button>
              {/each}
              <button class="ghost" onclick={() => (variants = null)}>취소</button>
            </div>
          {:else if bidding}
            <BidPanel {legal} {lastChance} wait={bidWait} onact={act} />
          {:else if exchange}
            <ExchangePanel
              {legal}
              contract={exchange.contract}
              contracts={live.notes.contracts}
              rules={view.rules}
              {toDiscard}
              chosen={chosen.length}
              hand={view.hand}
              {seatName}
              onact={act}
              ondiscard={discardChosen}
            />
          {/if}
        </div>
      {:else if refusal}
        <p class="prompt pill refusal" role="alert">{refusal}</p>
      {:else if myTurn && play}
        <p class="prompt pill">
          <strong>내 차례</strong> ·
          {settings.singleTap ? '낼 카드를 누르세요' : raisedCard ? '한 번 더 누르면 내요' : '낼 카드를 두 번 누르세요'}
        </p>
      {:else if misdealNow}
        <!-- Optional, so secondary: plum stays for your turn. -->
        <div class="aside-act">
          {#if waiting}<p class="prompt caption">{waiting.pre}<span class="who-name">{waiting.name}</span>{waiting.post}…</p>{/if}
          <button onclick={() => act('Misdeal')} title="패가 약하면 차례가 아니어도 다시 나눌 수 있어요">딜미스</button>
        </div>
      {:else if waiting && !done}
        <p class="prompt caption">{waiting.pre}<span class="who-name">{waiting.name}</span>{waiting.post}…</p>
      {:else if done && folded}
        {@render unfold()}
      {/if}
    </div>

    <div class="tray" class:reveal={revealed === me} bind:this={tray}>
      {#if client.reactions?.[me]}
        {@const mine = client.reactions[me]}
        {#key mine.id}
          <span class="my-reaction" class:emoji={/^\p{Extended_Pictographic}/u.test(mine.text)}>{mine.text}</span>
        {/key}
      {/if}
      {#if seatCues[me]?.text}{#key seatCues[me].id}<Callout text={seatCues[me].text!} below={false} />{/key}{/if}
      <!-- Desktop: your own seat at the tray's left, your tools at its right. -->
      <div class="me-seat" class:picked={swapFrom === me} data-seat={between ? me : undefined}>
        <Seat
          score={between && (room?.hands_played ?? 0) > 0 ? (room?.scores[me] ?? null) : null}
          name={myName}
          team={team(me)}
          {secretFriend}
          points={points(me)}
          turn={myTurn}
          trumpSuit={contract?.trump ?? null}
          lookAt={lookAt(0)}
          mood={mood(me)}
          away={isAway(me)}
        />
        {#if between}{@render seatTap(me)}{/if}
      </div>
      {#if secsLeft !== null}
        <!-- The last seconds of your turn, then a bot plays it for you. -->
        <span class="countdown" role="timer" aria-live="polite" aria-label="{secsLeft}초 남음">{#key secsLeft}<span class="pop">{secsLeft}</span>{/key}</span>
      {/if}
      <div class="tray-tools">
        {@render hintTools()}
        <Reactions onreact={(text) => client.react(text)} />
      </div>
      <div class="me-row">
        {#if team(me)}{#key team(me)}<span class="team pop {team(me) === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[team(me)!]}</span>{/key}
        {:else if secretFriend}<span class="team secret pop" title="나만 알아요: 부른 카드를 내면 모두 알게 돼요">프렌드</span>{/if}
        {#if points(me) > 0}
          <span class="my-points">{points(me)}점</span>
        {/if}
      </div>
      <!-- Always drawn, even empty, so the tray keeps its height. -->
      <Hand
        cards={view.hand}
        mode={handMode}
        {playable}
        {chosen}
        {kitty}
        {seal}
        {twoJokers}
        deal={dealing}
        {quickDeal}
        onplay={playCard}
        ontoggle={toggle}
        onrefuse={refuse}
        bind:raised={raisedCard}
        hinted={client.hint && typeof client.hint === 'object' && 'Play' in client.hint && myTurn ? client.hint.Play.card : null}
      />
    </div>
  {:else if done && folded}
    <div class="strip">{@render unfold()}</div>
  {:else if !done && !between}
    <!-- Watching: no hand, no strip; one line says whose turn it is. -->
    <p class="prompt muted spectating">구경하는 중{waitingFor ? ` · ${waitingFor}` : ''}</p>
  {/if}
  {#if sharing && room}
    <ShareCard {room} onclose={() => (sharing = false)} />
  {/if}
  {#if menuSeat !== null && menuAnchor && room?.seats[menuSeat]}
    {@const seat = menuSeat}
    {@const close = () => (menuSeat = null)}
    <SeatMenu
      {seat}
      info={room.seats[seat]}
      {me}
      anchor={() => seatRect(seat)}
      bind:name={sitName}
      onclose={close}
      onlevel={(level) => {
        client.addBot(seat, level);
        if (room?.seats[seat]?.kind !== 'bot') close();
      }}
      onswap={() => {
        swapFrom = seat;
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
      hiddenDiscards={view.rules.reveal_discards === false && done.declarer !== me}
      declarer={done.declarer}
      friend={done.friend}
      {seatName}
      {seal}
      {twoJokers}
      onclose={() => (replay = false)}
    />
  {/if}
</section>


<style>
  /* The table fills the screen exactly; the felt takes what is left and
     sizes its cards from its own width and height (container units), so
     nothing scrolls and nothing collides. */
  /* Every row but the felt has a fixed height for the screen size, and the
     tray never changes height either, so the felt (and every seat and the
     trick on it) stays put from the deal to the result. Whatever comes and
     goes (bids, the exchange, the result, the turn pill) lies over it. */
  .table {
    --status-h: 48px;
    --event-h: 18px;
    --strip-h: 16px;
    /* The top seats' height: the result stops under them. */
    --seat-top: 84px;
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--status-h) var(--event-h) minmax(0, 1fr) var(--strip-h) auto;
    grid-template-areas: 'status' 'event' 'felt' 'strip' 'tray';
    gap: 4px;
    height: calc(100dvh - var(--chrome, 80px) - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  }
  @media (min-width: 600px) {
    .table {
      --status-h: 34px;
      --seat-top: 116px;
    }
  }
  .status {
    grid-area: status;
    /* Above the felt, so the reactions menu opens over the seats. */
    position: relative;
    z-index: 8;
  }
  .event {
    grid-area: event;
    min-width: 0;
  }
  .table.tips {
    --event-h: 54px;
  }
  /* The point cards as twenty ticks: 여당 from the left, 야당 from the right,
     the contract marked between them. */
  .meter {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .meter-label {
    white-space: nowrap;
  }
  .tally {
    position: relative;
    display: grid;
    grid-template-columns: repeat(20, 1fr);
    gap: 2px;
    width: clamp(160px, 40vw, 320px);
    height: 10px;
  }
  .tick {
    border-radius: 2px;
    background: var(--line);
    transition: background-color var(--dur-quick) var(--ease-standard);
  }
  .tick.decl {
    background: var(--team-declarer);
  }
  .tick.def {
    background: var(--team-defense);
  }
  /* A tick that just filled hops once, in the order the cards came in. */
  .tally:global(.live) .tick.decl,
  .tally:global(.live) .tick.def {
    animation: tick-pop 280ms var(--ease-settle) var(--d, 0ms) both;
  }
  @keyframes tick-pop {
    0% {
      transform: translateY(0);
    }
    45% {
      transform: translateY(-4px);
    }
    100% {
      transform: translateY(0);
    }
  }
  /* The contract: a tall ink line. */
  .tally .goal {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    border-radius: 1px;
    background: var(--ink);
  }
  /* On phones the tally takes its own row, as wide as the row allows. */
  @media (max-width: 599px) {
    .meter {
      flex: 1 1 100%;
      flex-wrap: wrap;
      justify-content: center;
      row-gap: 2px;
    }
    .tally {
      flex: 1 1 auto;
      width: auto;
      min-width: 160px;
      max-width: 320px;
    }
  }

  /* The point cards one seat took, on card paper beside its seat. */
  /* The points in the result table and on your tray open the same cards;
     they keep looking like text, with a hairline to say they open. */
  .tag-chip {
    padding: 1px 8px;
    border-radius: var(--r-pill);
    font-size: var(--text-caption);
    font-weight: 700;
    white-space: nowrap;
    border: 1.5px solid var(--ink-muted);
    color: var(--ink-muted);
  }
  .tag-chip.accent {
    border-color: var(--accent);
    color: var(--accent);
  }
  .tag-chip.danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .tag-chip.gold {
    border-color: var(--gold);
    color: var(--gold);
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
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--ink);
  }
  .felt {
    grid-area: felt;
  }
  .react-status {
    display: none;
  }
  /* The felt's foot: your tools at the right, 직전 라운드 at the left.
     Both step up over the bid or exchange controls when those are out. */
  .felt {
    --lift: max(0px, var(--over, 0px) - var(--strip-h) - 4px);
  }
  .react-spot {
    position: absolute;
    right: 4px;
    bottom: calc(4px + var(--lift));
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .react-status {
    align-items: center;
    gap: 6px;
  }
  .hint-btn {
    min-height: 40px;
    min-width: 40px;
    padding: 0;
    border-radius: var(--r-pill);
    font-size: 18px;
  }
  .hint-text {
    padding: 6px 12px;
    border-radius: var(--r-pill);
    background: var(--card);
    color: var(--card-ink);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.14);
    font-size: 14px;
    white-space: nowrap;
  }
  .strip,
  .spectating {
    grid-area: strip;
  }
  .tray {
    grid-area: tray;
  }

  /* 상황판 */
  .status {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    align-content: center;
    gap: 2px 14px;
    height: var(--status-h);
    font-size: clamp(14px, 1.7vw, 16px);
    color: var(--ink-muted);
  }
  .status strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .contract {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--text-title);
  }
  .status :global(.trump-icon) {
    width: 16px;
    height: 16px;
  }
  .status :global(.suit-Heart) {
    color: var(--suit-heart);
  }
  .status :global(.suit-Diamond) {
    color: var(--suit-diamond);
  }
  .status :global(.suit-Club) {
    color: var(--suit-club);
  }
  .event {
    text-align: center;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  /* The felt: four seats in fixed bands (two on top, one each side), the
     trick in the middle, each card between its player and the centre. */
  .felt {
    position: relative;
    min-height: 0;
    container-type: size;
  }
  /* At most 1.6 times as wide as it is tall: on a wide screen the side
     seats come in towards the trick instead of hugging the window edges. */
  .ring {
    --seat-w: clamp(92px, 10cqw, 148px);
    --seat-h: 78px;
    /* A trick card is never much bigger than a card in your hand. */
    --trick-max: 92px;
    position: absolute;
    inset: 0;
    max-width: calc(100cqh * 1.35);
    margin-inline: auto;
    container-type: size;
    /* The trick's centre: the middle of the room under the top seats, not
       of the whole felt, whose foot has no seat (you sit on the tray). */
    --cy: calc(50cqh + var(--seat-h) / 2 - 12px);
  }
  /* Tablets: seats and cards grow with the table, the side seats come in. */
  @media (min-width: 600px) and (max-width: 1023px) {
    .ring {
      --seat-w: clamp(92px, 16cqw, 160px);
      --seat-h: 116px;
      --trick-max: 100px;
      inset-inline: 3cqw;
    }
  }
  /* Card size from the room left between the seats: wide enough that the
     side cards (1.15 across) clear the side seats, short enough that the top
     cards (0.9 up) clear the top seats and the bottom card leaves room for
     the note. */
  .ring {
    --card-w: clamp(
      40px,
      min(
        (100cqw - 2 * var(--seat-w) - 16px) / 3.55,
        (50cqh - var(--seat-h) / 2 - 23px) / 2.04,
        /* Under the bottom card: a lead tag's 20px, the note's 20px and the
           turn pill's 46px, so the note never has to sit on a card. */
        (50cqh - var(--seat-h) / 2 - 82px) / 2.18
      ),
      var(--trick-max)
    );
    --card-h: calc(var(--card-w) * 1.4);
    --tx: calc(var(--card-w) * 1.1);
    /* The side cards sit only 0.95 of this below the top ones, so it must
       outgrow the card height or big cards would overlap. */
    --ty: calc(var(--card-h) * 1.06 + 8px);
  }
  .spot {
    position: absolute;
    left: calc(50% + var(--x) * 38%);
    top: calc(50% + var(--y) * 40%);
    transform: translate(-50%, -50%);
  }
  .spot.pos-1 {
    left: auto;
    right: 0;
    top: var(--cy);
    transform: translateY(-50%);
  }
  /* The top seats sit just clear of the trick's top cards: at the felt's
     top on a phone, nearer the middle on a tall tablet. */
  .spot.pos-2,
  .spot.pos-3 {
    top: max(0px, var(--cy) - 0.9 * var(--ty) - var(--card-h) / 2 - var(--seat-h) - 20px);
    transform: translateX(-50%);
  }
  .spot.pos-2 {
    left: 75%;
  }
  .spot.pos-3 {
    left: 25%;
  }
  .spot.pos-4 {
    left: 0;
    top: var(--cy);
    transform: translateY(-50%);
  }
  /* Phones: a long name on a top seat ends sooner, so it keeps clear of the
     trick's top cards beside it. */
  @media (max-width: 599px) {
    .spot.pos-2 :global(.name),
    .spot.pos-3 :global(.name) {
      max-width: 5em;
    }
  }
  /* Phones and tablets: a bid on a right-hand seat hangs inwards. */
  @media (max-width: 1023px), (max-height: 639px) {
    .spot.pos-1 :global(.bubble),
    .spot.pos-2 :global(.bubble) {
      left: auto;
      right: calc(100% - 6px);
    }
  }
  .trick {
    position: absolute;
    left: 50%;
    top: var(--cy);
  }
  .slot {
    position: absolute;
    transform: translate(calc(-50% + var(--x) * var(--tx)), calc(-50% + var(--y) * var(--ty)));
  }
  /* Cards on the table lie a little crooked, each its own way. */
  .trick .slot :global(.card) {
    --w: var(--card-w);
    rotate: var(--tilt, 0deg);
    transition:
      opacity var(--dur-quick) var(--ease-standard),
      translate 220ms var(--ease-settle);
  }
  /* The card winning so far sits up a little, outlined in ink: it is news,
     not a call to act, which is what the accent means. */
  .trick .slot.leading :global(.card) {
    translate: 0 -6px;
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  /* While a round resolves, the cards that lost step back: they lose some
     colour but stay solid paper, never see-through. */
  .trick .slot.beaten :global(.card) {
    filter: saturate(0.4) brightness(0.9);
  }
  .note {
    position: absolute;
    left: 50%;
    top: var(--cy);
    transform: translate(-50%, -50%);
    margin: 0;
    font-size: 14px;
    color: var(--ink-muted);
    white-space: nowrap;
    pointer-events: none;
  }
  /* Right under the bottom card's place, on one line. */
  .note.below {
    /* Clear of a joker's lead tag (it hangs 14px under its card), but
       never down into the turn pill on the tray's rim. */
    top: min(calc(var(--cy) + var(--ty) + var(--card-h) / 2 + 20px), calc(100% - 30px));
    transform: translateX(-50%);
    max-width: calc(100cqw - 16px);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* A long name gives way, never the words after it. */
  .who-name {
    display: inline-block;
    max-width: 7em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  .won-note {
    color: var(--ink);
    font-weight: 700;
  }
  .alert {
    color: var(--accent);
    font-weight: 700;
  }

  .sheet {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(100%, 420px);
    max-height: calc(100% - 8px);
    overflow: auto;
    padding: 16px;
    border-radius: var(--r-panel);
    background: var(--panel);
    box-shadow: 0 4px 0 rgb(0 0 0 / 0.08);
    z-index: 2;
  }
  /* Sheet buttons that only close: secondary, and small. */
  .sheet .close {
    min-height: 32px;
    padding: 4px 12px;
    font-size: 14px;
  }
  /* The hand thrown in: two rows of five where the trick would be, so it
     sits between the seats instead of over them. */
  .thrown-in {
    /* Hung from just under the top seats, so it clears the bid controls. */
    top: calc(var(--seat-h) + 2px);
    transform: translateX(-50%);
    --m: clamp(40px, calc(var(--card-w) * 0.85), 56px);
    display: grid;
    gap: 4px;
    width: auto;
    max-width: none;
    padding: 6px;
    overflow: visible;
    z-index: 3;
  }
  .thrown-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .thrown-in .close {
    min-height: 26px;
    padding: 2px 10px;
    font-size: var(--text-label);
  }
  .thrown-title {
    margin: 0 0 0 4px;
    font-size: var(--text-label);
    font-weight: 700;
    white-space: nowrap;
  }
  .thrown-title .who-name {
    max-width: 5em;
  }
  .thrown-cards {
    display: grid;
    justify-items: center;
    gap: 4px;
  }
  .thrown-row {
    display: flex;
  }
  .thrown-row :global(.card) {
    --w: var(--m);
  }
  .thrown-row :global(.card:not(:first-child)) {
    margin-left: calc(var(--m) * -0.42);
  }
  /* As in the hand, only the last card shows its big glyph. */
  .thrown-row :global(.card:not(:last-child) .glyph) {
    visibility: hidden;
  }

  /* The result's room: from under the top seats to the table's foot, in
     the felt's column. */
  .result-layer {
    position: absolute;
    grid-column: felt;
    grid-row: felt-start / tray-end;
    inset: var(--seat-top) 0 0;
    z-index: 9;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    pointer-events: none;
  }
  .result-layer .sheet {
    position: relative;
    left: auto;
    top: auto;
    transform: none;
    display: flex;
    flex-direction: column;
    width: min(100%, 440px);
    max-height: 100%;
    padding: 0;
    overflow: hidden;
    pointer-events: auto;
  }
  .result-body {
    min-height: 0;
    overflow: auto;
    padding: 14px 16px 8px;
  }
  /* Phones have no room beside the side seats: the sheet covers them
     whole, from under the top seats down, rather than cutting them in half. */
  @media (max-width: 599px) {
    .result-layer .sheet {
      height: 100%;
    }
    .result-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: safe center;
    }
  }
  .result-layer.cover .sheet {
    height: 100%;
  }
  .result-layer.cover .result-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: safe center;
  }
  /* Wider screens: under the side seats, clear of every seat. */
  @media (min-width: 600px) {
    .result-layer {
      top: var(--fit-top, var(--seat-top));
    }
    .result-layer .sheet {
      width: min(100%, max(440px, var(--fit-w, 0px)));
    }
  }
  /* A short desktop window: the result tightens to fit. */
  @media (min-width: 600px) and (max-height: 760px) {
    .result-body {
      padding: 8px 14px 4px;
    }
    /* The headline and its count side by side. */
    .result-head {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 4px 16px;
    }
    .result-head .ledger {
      text-align: left;
    }
    .result .headline {
      font-size: var(--text-headline);
    }
    .result .sub.said {
      display: none;
    }
    .ledger {
      margin: 2px 0 4px;
    }
    .result th {
      padding: 2px 4px;
    }
    .result td {
      height: 26px;
    }
    .result-foot {
      padding: 4px 14px 8px;
    }
    .result-foot button {
      min-height: 40px;
    }
  }
  .result-foot {
    flex: none;
    padding: 8px 16px 14px;
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
      transform: translateY(24px) scale(0.96);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .result {
      animation-name: fade;
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
  }
  .result p {
    margin: 0;
  }
  /* Result rows come in one after another (Wordle's stats sheet). */
  .result tbody tr {
    animation: fade-up 260ms var(--ease-standard) both;
  }
  .result tbody tr:nth-child(2) {
    animation-delay: 60ms;
  }
  .result tbody tr:nth-child(3) {
    animation-delay: 120ms;
  }
  .result tbody tr:nth-child(4) {
    animation-delay: 180ms;
  }
  .result tbody tr:nth-child(5) {
    animation-delay: 240ms;
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
    .result.big .headline {
      font-size: 28px;
    }
    .run-word {
      font-size: 40px;
    }
    .result .sub.said {
      display: none;
    }
    .ledger {
      margin: 4px 0 6px;
      font-size: 14px;
    }
    .result td {
      height: 28px;
    }
    .result-body {
      padding: 10px 12px 4px;
    }
    .result-foot {
      padding: 6px 12px 10px;
    }
    .result-foot .next {
      flex-wrap: nowrap;
      gap: 6px;
    }
    .result-foot .next > button:not(.primary) {
      padding-inline: 12px;
    }
    .result-foot .next .primary {
      min-width: 0;
    }
  }
  /* An earned achievement slides down from the top after the result. */
  .achieved {
    display: grid;
    gap: 6px;
    margin-top: 12px;
    animation: achieved 420ms var(--ease-settle) 1.6s both;
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
    letter-spacing: 0.08em;
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
  @media (prefers-reduced-motion: reduce) {
    .achieved {
      animation: none;
    }
  }
  @keyframes achieved {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
  /* A loss reads quieter, not angrier. */
  .result.lost .headline {
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
      transform: scale(0.7);
    }
  }
  .result.big .headline {
    font-size: 36px;
  }
  /* 런: the table settles once under the gold seal. */
  .table.nudge {
    animation: nudge 300ms var(--ease-standard);
  }
  @keyframes nudge {
    30% {
      transform: translateY(2px);
    }
    60% {
      transform: translateY(-1px);
    }
  }
  .headline {
    position: relative;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    line-height: 1.15;
    color: var(--ink);
  }
  .result .sub {
    margin: 2px 0 0;
    color: var(--ink-muted);
  }
  .result .sub strong {
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
  .team {
    display: inline-block;
    padding: 1px 8px;
    border-radius: var(--r-pill);
    font-size: var(--text-caption);
    font-weight: 600;
    line-height: 18px;
  }
  .team.declarer {
    background: var(--team-declarer);
    color: var(--on-team-declarer);
  }
  .team.defense {
    background: var(--team-defense);
    color: var(--on-team-defense);
  }
  /* The 프렌드 only you know about (see Seat.svelte). */
  .team.secret {
    color: var(--ink);
    background: var(--table);
    box-shadow: inset 0 0 0 1.5px var(--team-declarer);
  }

  /* The action strip: one fixed slot whose content follows the phase. It
     has no panel of its own, and nothing in it takes room: controls rise
     from it over the felt's foot, on the table's own paper so the seats
     behind never show through; the turn sits on the tray's rim. */
  .strip {
    position: relative;
    z-index: 7;
    height: var(--strip-h);
    min-width: 0;
  }
  .controls {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 6px 0 4px;
    background: var(--table);
  }
  .prompt {
    margin: 0;
    text-align: center;
    font-size: var(--text-body);
  }
  /* Half over the tray's top edge, like a label on its rim. */
  .strip .prompt {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translate(-50%, 50%);
    max-width: calc(100% - 16px);
    white-space: nowrap;
  }
  .strip .pill {
    padding: 5px 14px;
    border-radius: var(--r-pill);
    background: var(--card);
    color: var(--card-ink);
    font-size: 14px;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
  }
  .strip .refusal {
    font-weight: 700;
  }
  /* Someone else's turn is news, not a button: a plain caption. */
  .strip .caption {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  /* 딜미스 outside your turn: whose turn it is, and a secondary button. */
  .aside-act {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 8px 8px;
  }
  .strip .aside-act .prompt {
    position: static;
    transform: none;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .aside-act button {
    flex: none;
    min-width: 88px;
  }
  /* On the card-paper pill, the light-theme plum keeps its contrast. */
  .strip .pill strong {
    color: var(--accent-on-card);
  }
  .variants,
  .next {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
  /* The result's buttons fill its width; the primary takes what is left. */
  .next .primary {
    flex: 1 1 auto;
    min-width: 120px;
  }
  .next > button:not(.primary) {
    flex: none;
  }
  /* A label never breaks; on a narrow phone the primary wraps to its own row. */
  .next > button {
    white-space: nowrap;
  }
  .foot-react {
    display: inline-flex;
    flex: none;
  }
  .tray {
    position: relative;
    padding: 18px 8px 10px;
    border-radius: var(--r-panel);
    outline: 3px solid transparent;
    outline-offset: -3px;
    transition: outline-color var(--dur-quick) var(--ease-standard);
  }
  /* Your own reaction rises over your hand, as others' rise over their seats. */
  /* Your reaction rises at the tray's left, over your own seat, clear of
     the turn pill and the round note in the middle. */
  .my-reaction {
    position: absolute;
    left: 64px;
    top: 0;
    z-index: 6;
    padding: 4px 12px;
    border-radius: var(--r-panel);
    background: var(--card);
    color: var(--card-ink);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.16);
    font-size: var(--text-body);
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    transform: translate(-50%, -100%);
    animation: my-reaction 2.8s var(--ease-standard) both;
  }
  .my-reaction.emoji {
    padding: 2px 8px;
    font-size: 28px;
  }
  @keyframes my-reaction {
    0% {
      opacity: 0;
      transform: translate(-50%, -40%) scale(0.6);
    }
    12%,
    82% {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -130%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .my-reaction {
      animation: none !important;
    }
  }
  /* Only the hand's container (its direct child), never the cards, which
     also carry a "hand" size class. */
  .tray > :global(.hand) {
    transition: translate 420ms var(--ease-settle);
  }
  /* Your turn: the hand rises a touch to meet you. */
  .mine .tray > :global(.hand) {
    translate: 0 -4px;
  }
  .mine .tray {
    outline-color: var(--accent);
    animation: turn-pulse 900ms var(--ease-standard);
  }
  /* Your turn: the tray's ring swells once, then settles. */
  @keyframes turn-pulse {
    0% {
      outline-offset: -3px;
      outline-width: 3px;
    }
    35% {
      outline-offset: 2px;
      outline-width: 5px;
    }
    100% {
      outline-offset: -3px;
      outline-width: 3px;
    }
  }
  .me-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    height: 20px;
    font-size: var(--text-label);
    font-weight: 600;
  }
  /* Your points: the same pill as on every seat. */
  .my-points {
    padding: 0 6px;
    border-radius: var(--r-pill);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    line-height: 18px;
    box-shadow: 0 0 0 1px var(--line);
  }
  .spectating {
    padding: 16px;
  }
  /* Your last seconds: an ink disc on the tray's rim, by the turn ring. */
  .countdown {
    position: absolute;
    right: 12px;
    top: -18px;
    z-index: 7;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--ink);
    color: var(--table);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  /* Watching, nobody sits on the tray: the bottom seat sits at the felt's
     foot, and the trick makes room for it. */
  .watching .ring {
    --cy: 50cqh;
    --card-w: clamp(
      36px,
      min((100cqw - 2 * var(--seat-w) - 16px) / 3.55, (50cqh - var(--seat-h) - 40px) / 2.2),
      var(--trick-max)
    );
  }
  .watching .spot.pos-0 {
    top: auto;
    bottom: 0;
    transform: translateX(-50%);
  }
  .watching .note.below {
    top: auto;
    bottom: calc(var(--seat-h) + 6px);
  }

  /* Desktop-only parts: the side panel, your seat and tools on the tray. */
  .side,
  .me-seat,
  .tray-tools {
    display: none;
  }

  /* Desktop: seats become plates with their won pile, and the tray carries
     your own seat at its left and your tools at its right. */
  @media (min-width: 1024px) and (min-height: 640px) {
    .table {
      --seat-top: 112px;
    }
    .ring {
      --seat-w: clamp(160px, 32cqh, 192px);
      --seat-h: 100px;
      /* 1.2 times the hand's card (Hand.svelte: 12% of the window's height). */
      --trick-max: calc(1.2 * clamp(88px, 12vh, 124px));
    }
    .react-spot,
    .me-row,
    .foot-react {
      display: none;
    }
    /* Your seat, the hand across all the room between, your tools. */
    .tray {
      display: grid;
      grid-template-columns: 170px minmax(0, 1fr) auto;
      grid-template-areas: 'me hand tools';
      align-items: center;
      column-gap: 12px;
      padding: 14px 10px 8px;
    }
    .tray > :global(.hand) {
      grid-area: hand;
    }
    .me-seat {
      grid-area: me;
      display: block;
      align-self: center;
      --seat-w: 100%;
      --seat-figure: 60px;
    }
    .tray-tools {
      grid-area: tools;
      display: flex;
      align-items: center;
      gap: 8px;
      /* The hint's text opens leftwards, over the hand's edge. */
      flex-direction: row-reverse;
      flex-wrap: wrap-reverse;
      justify-content: flex-start;
    }
  }

  /* Wide desktop: a column of stacked paper beside the felt takes the
     상황판, the scores, the log and the last round; the top line goes. */
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
    .status {
      display: none;
    }
    .side {
      grid-area: side;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      overflow: hidden;
    }
  }
  .pane {
    flex: none;
    padding: 10px 12px 12px;
    border-radius: var(--r-panel);
    background: var(--panel);
    font-size: var(--text-label);
  }
  .pane-empty {
    margin: 0;
    color: var(--ink-muted);
  }
  .pane-title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 8px;
    font-size: var(--text-caption);
    font-weight: 700;
    color: var(--ink-muted);
  }
  .round-no {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .pane-title .cols {
    display: flex;
    gap: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .round-no strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 800;
  }
  /* 상황판: the contract large, the facts beside it, the tally under. */
  .big-contract {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    column-gap: 6px;
  }
  .glyph-box {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    color: var(--ink);
  }
  .glyph-box :global(svg) {
    width: 30px;
    height: 30px;
  }
  .glyph-box :global(.suit-Heart) {
    color: var(--suit-heart);
  }
  .glyph-box :global(.suit-Diamond) {
    color: var(--suit-diamond);
  }
  .glyph-box :global(.suit-Club) {
    color: var(--suit-club);
  }
  .nt {
    font-size: 18px;
    font-weight: 800;
  }
  .big-num {
    font-family: var(--font-display);
    font-size: 38px;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .big-sub {
    padding-left: 6px;
    color: var(--ink-muted);
    line-height: 1.35;
  }
  .big-sub strong {
    color: var(--ink);
  }
  .facts {
    display: grid;
    gap: 3px;
    min-width: 0;
    margin: 0 0 0 8px;
    padding-left: 10px;
    border-left: 1px solid var(--line);
  }
  .facts div {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .facts dt {
    flex: none;
    width: 3em;
    color: var(--ink-muted);
  }
  .facts dd {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .side-meter {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }
  .meter-row {
    display: flex;
    justify-content: space-between;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .meter-row strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-size: var(--text-body);
    font-weight: 800;
  }
  .meter-row .of {
    color: var(--ink-muted);
  }
  .side-meter .tally {
    width: 100%;
  }
  .side-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  /* 점수판: one row a player, in seat order from you. */
  .score-rows {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .score-rows li {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) 40px 40px;
    align-items: center;
    column-gap: 8px;
    min-height: 30px;
    color: var(--ink-muted);
  }
  .score-rows li.turn,
  .score-rows li.me {
    color: var(--ink);
  }
  .head {
    position: relative;
    width: 26px;
  }
  .vacant-figure {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 6;
    stroke-dasharray: 10 9;
    stroke-linecap: round;
  }
  /* The turn: the same plum ring the seat wears, in small. */
  .head::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 28px;
    height: 28px;
    border: 1.5px solid var(--accent);
    border-radius: 50%;
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.85);
    transition:
      opacity var(--dur-quick) var(--ease-standard),
      transform var(--dur-move) var(--ease-settle);
  }
  .head.on::after {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
  /* Name, then the badge in a column of its own so badges line up. */
  .who-cell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .row-name {
    min-width: 0;
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .mini-team {
    flex: none;
    padding: 0 6px;
    font-size: 11px;
    line-height: 16px;
  }
  .score-rows .num {
    text-align: right;
    font-family: var(--font-display);
    font-weight: 700;
  }
  .score-rows .total {
    color: var(--ink);
  }
  .score-rows .total.neg {
    color: var(--danger);
  }
  .scores .cols span {
    width: 40px;
    text-align: right;
  }
  /* 기록: newest on top; it takes what height is left. */
  /* A short log takes only its lines, not an empty block. */
  /* The friend's line carries a dot of the 여당 colour. */
  /* 직전 라운드: its five cards, small, with who played each. */
  /* Who took the round: an ink outline; plum is only for "act now". */

  /* Phones on their side: the strip moves beside the felt, seats go down
     both sides, and the note moves into the event line. */
  @media (orientation: landscape) and (max-height: 520px) {
    /* Seats fill the felt's corners here; the wide status row has room. */
    .react-spot {
      display: none;
    }
    .react-status {
      display: inline-flex;
    }
    .table {
      grid-template-columns: minmax(0, 1fr) minmax(240px, 36%);
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas: 'status status' 'felt strip' 'tray tray';
      gap: 4px 8px;
    }
    .event,
    .note.below,
    .me-row {
      display: none;
    }
    /* Beside the felt the strip has room of its own: nothing lies over. */
    .strip {
      align-self: stretch;
      height: auto;
      overflow-y: auto;
    }
    .controls,
    .aside-act,
    .strip .prompt {
      position: static;
      transform: none;
    }
    .strip .prompt {
      align-self: center;
      white-space: normal;
    }
    .tray {
      padding-top: 0;
    }
    .ring {
      --cy: 50cqh;
      max-width: none;
    }
    .ring {
      --card-w: clamp(36px, min((100cqw - 2 * var(--seat-w) - 16px) / 3.55, (50cqh - 6px) / 2.1), 72px);
    }
    .spot.pos-1,
    .spot.pos-2,
    .spot.pos-3,
    .spot.pos-4 {
      transform: none;
    }
    .spot.pos-3 {
      left: 0;
      top: 0;
    }
    .spot.pos-4 {
      left: 0;
      top: auto;
      bottom: 0;
    }
    .spot.pos-2 {
      left: auto;
      right: 0;
      top: 0;
    }
    .spot.pos-1 {
      right: 0;
      top: auto;
      bottom: 0;
    }
    .tray {
      padding: 0 4px 4px;
    }
    /* Bottom seats show their bubble above, clear of the hand. */
    .spot.pos-1 :global(.bubble),
    .spot.pos-4 :global(.bubble) {
      top: -12px;
      bottom: auto;
      transform: translate(-50%, -50%);
    }
  }


  /* ---- Between hands -------------------------------------------------------
     The same table: seats where they sat, the trick's place in the middle
     holding the next hand, and every seat one tap from its choices. */
  .seat-box {
    position: relative;
  }
  .seat-tap {
    position: absolute;
    inset: -4px;
    z-index: 3;
    min-height: 0;
    padding: 0;
    border-radius: var(--r-panel);
    background: transparent;
    box-shadow: none;
  }
  .seat-tap:active:not(:disabled) {
    transform: none;
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
  .picked .seat-tap,
  .swapping .picked .seat-tap {
    box-shadow: inset 0 0 0 2px var(--ink);
  }
  .picked :global(.seat) {
    translate: 0 -4px;
    color: var(--ink);
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
    position: relative;
    min-height: 34px;
    padding: 4px 10px;
    border-radius: var(--r-pill);
    font-size: var(--text-label);
    white-space: nowrap;
    box-shadow: 0 2px 0 var(--btn-lip);
  }
  /* A 44px target around a small chip. */
  .seat-act::before {
    content: '';
    position: absolute;
    inset: -5px -2px;
  }
  .centre {
    position: absolute;
    left: 50%;
    top: var(--cy);
    transform: translate(-50%, -50%);
    z-index: 4;
    display: grid;
    justify-items: center;
    gap: 10px;
    width: max-content;
    max-width: max(150px, calc(100cqw - 2 * var(--seat-w) - 8px));
    text-align: center;
    animation: fade-up 240ms var(--ease-standard) both;
  }
  .go {
    min-width: 136px;
    min-height: 52px;
    font-size: 18px;
  }
  .centre-note,
  .centre-sub {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink-muted);
    word-break: keep-all;
    text-wrap: balance;
  }
  .centre-sub {
    font-size: var(--text-label);
    font-weight: 400;
  }
  .centre-note strong,
  .centre-sub strong {
    color: var(--ink);
  }
  .tools {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
  /* Small drawn tools: an icon over a word, on card paper with its lip. */
  .tool {
    flex-direction: column;
    gap: 2px;
    min-width: 56px;
    min-height: 56px;
    padding: 6px 8px 5px;
    font-size: var(--text-caption);
    font-weight: 600;
  }
  /* 섞기 is on: the tool is pressed into the table, in ink, until the
     next hand uses it (or it is pressed again). */
  .tool.on {
    background: var(--ink);
    color: var(--table);
    box-shadow: 0 1px 0 var(--btn-lip);
    translate: 0 2px;
  }
  /* Hung under the middle's buttons, so it takes no height from them: the
     middle stays clear of the top seats on a short phone. */
  .shuffle-note {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    width: max-content;
    max-width: min(220px, calc(100cqw - 2 * var(--seat-w) - 8px));
    transform: translateX(-50%);
    color: var(--ink);
    font-weight: 600;
  }
  .rules-chip {
    min-height: 32px;
    max-width: 100%;
    padding: 4px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--r-pill);
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--line);
    color: var(--ink);
    font-size: 14px;
  }
  .side-rules {
    margin-top: 8px;
  }
  /* Your own seat sits on the empty tray, in the middle, between hands. */
  .between .me-seat {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    display: block;
    width: 120px;
    transform: translate(-50%, -50%);
    --seat-w: 100%;
  }
  .between .me-row {
    visibility: hidden;
  }
  .strip .unfold {
    gap: 6px;
    min-height: 40px;
    padding: 6px 16px;
    font-weight: 600;
    color: var(--card-ink);
  }
  .strip .unfold:active:not(:disabled) {
    transform: translate(-50%, calc(50% + 2px)) scale(0.97);
  }
  /* The result folds down to show the table. */
  .fold {
    flex: none;
    align-self: center;
    gap: 4px;
    min-height: 40px;
    margin-top: 2px;
    padding: 4px 14px;
    background: transparent;
    box-shadow: none;
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  @media (min-width: 1024px) and (min-height: 640px) {
    .between .me-seat {
      position: relative;
      left: auto;
      top: auto;
      width: auto;
      transform: none;
    }
  }

  /* Your side won: suit marks burst out from the headline, once. */
  .burst {
    position: absolute;
    left: 50%;
    top: 50%;
    pointer-events: none;
  }
  .spark {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    opacity: 0;
    animation: spark 900ms var(--ease-standard) 200ms;
  }
  .spark.suit-Heart {
    color: var(--suit-heart);
  }
  .spark.suit-Diamond {
    color: var(--suit-diamond);
  }
  .spark.suit-Club {
    color: var(--suit-club);
  }
  .spark.suit-Spade {
    color: var(--ink);
  }
  @keyframes spark {
    0% {
      opacity: 1;
      transform: rotate(var(--a)) translateX(10px) scale(0.6);
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateX(110px) scale(1);
    }
  }
</style>
