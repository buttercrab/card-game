<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import BidPanel from './BidPanel.svelte';
  import Card from './Card.svelte';
  import ExchangePanel from './ExchangePanel.svelte';
  import Hand from './Hand.svelte';
  import HandReplay from './HandReplay.svelte';
  import LeadTag from './LeadTag.svelte';
  import Reactions from './Reactions.svelte';
  import Seat, { TEAM_LABEL, type Team } from './Seat.svelte';
  import Callout from './Callout.svelte';
  import SuitIcon from './SuitIcon.svelte';
  import { actionLabel, cardLabel, contractLabel, friendCallLabel, isPoint, leadLabel, mightyCard, sameCard, sealOf } from './cards';
  import type { RoomClient } from './client.svelte';
  import { flyFrom, flyTo, juice, pop, ring, settle } from './motion';
  import { settings } from './settings.svelte';
  import { recordHand } from './stats';
  import { sound } from './sound';
  import type { Action, Card as CardT, FriendCall, Lead, PhaseView, Played, PlayAction, StateMsg, Suit, Trick } from './types';

  let { client }: { client: RoomClient } = $props();

  // What is drawn lags the server by the animations still playing: each new
  // state waits in a queue, and the difference to the one on screen is
  // animated before it is shown.
  let shown = $state(untrack(() => client.game!));
  const msg = $derived(shown);
  const room = $derived(client.room);
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
    recordHand({
      key: `${room.id}-${room.hands_played}`,
      at: Date.now(),
      role,
      won: role === 'defense' ? !declarerWon : declarerWon,
      payoff: done.payoffs[me],
      contract: done.contract,
      teamPoints: done.team_points,
    });
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
    const info = room?.seats[seat];
    if (!info || info.kind === 'empty') return `${seat + 1}번 자리`;
    return info.kind === 'bot' ? `봇 ${seat + 1}` : info.name;
  }

  // ---- Where everyone sits -------------------------------------------------
  // Play goes to the next seat number. Seen from the bottom, that runs
  // counter-clockwise: right, top right, top left, left.
  const bottom = $derived(me ?? 0);
  const around = $derived(Array.from({ length: n }, (_, r) => r).filter((r) => me === null || r > 0));
  function angle(r: number): number {
    return ((90 - (r * 360) / n) * Math.PI) / 180;
  }
  function seatAt(r: number): number {
    return (bottom + r) % n;
  }
  function relative(seat: number): number {
    return (seat - bottom + n) % n;
  }

  // ---- Teams and points ----------------------------------------------------
  const friendKnown = $derived(friend !== null || call === 'Alone' || done !== null);
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

  function bubble(seat: number): string | null {
    if (!bidding) return null;
    if (bidding.best && bidding.best[0] === seat) return contractLabel(bidding.best[1]);
    if (bidding.passed[seat]) return '패스';
    return null;
  }

  // ---- Result ledger -----------------------------------------------------------
  // The result is counted out step by step, as 맞고 and mahjong results are:
  // the points, over or short, each ×2, then everyone's payoff.
  type Done = Extract<PhaseView, { Done: unknown }>['Done'];
  function ledger(d: Done) {
    const made = d.team_points >= d.contract.count;
    const lines: string[] = [];
    let value: number;
    if (made) {
      const base = Math.max(d.team_points - 10, 1);
      lines.push(`여당 ${d.team_points}점 − 10 = ${base}`);
      value = base;
      const doubles = [
        d.contract.trump === null && '노기루다',
        d.call === 'Alone' && '노프렌드',
        d.team_points === 20 && '런',
      ].filter((x): x is string => !!x);
      for (const why of doubles) {
        value *= 2;
        lines.push(`${why} ×2 = ${value}`);
      }
    } else {
      const short = d.contract.count - d.team_points;
      lines.push(short === 1 ? `아깝게 1점 모자람` : `공약 ${d.contract.count}에서 ${short}점 모자람`);
      value = short;
      if (d.team_points <= 10) {
        value *= 2;
        lines.push(`10점 이하 ×2 = ${value}`);
      }
    }
    const margin = d.team_points - d.contract.count;
    return { made, lines, value, run: d.team_points === 20, margin };
  }
  const result = $derived(done ? ledger(done) : null);

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
      await new Promise((r) => setTimeout(r, 450 * k));
      for (let i = 1; i <= lines && !cancelled; i++) {
        step = i;
        sound.tally(i);
        await new Promise((r) => setTimeout(r, 380 * k));
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
        if (f < 1) requestAnimationFrame(frame);
        else {
          tallied = true;
          if (result.run) {
            sound.run();
            nudge = true;
            setTimeout(() => (nudge = false), 320);
          }
        }
      };
      requestAnimationFrame(frame);
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
    if (!settings.tips || !myTurn) return null;
    if (bidding)
      return bidding.best
        ? `${contractLabel(bidding.best[1])}보다 높게 부르거나 패스. 센 카드가 많으면 도전!`
        : '많이 가진 무늬를 기루다로 골라 불러요. 자신 없으면 패스.';
    if (exchange)
      return toDiscard > 0
        ? `필요 없는 카드 ${toDiscard}장을 버려요. 버린 점수 카드도 여당 점수예요.`
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
  const kittySize = $derived(52 + (twoJokers ? 2 : 1) - n * view.rules.hand_size);
  const toDiscard = $derived(exchange ? kittySize - (exchange.discards?.length ?? 0) : 0);
  // The hand answers to the latest server state, not the one still being
  // animated: once it is your turn you can play, and playing skips ahead.
  const live = $derived(client.game!);
  const liveTurn = $derived(me !== null && typeof live.turn === 'object' && live.turn.Seat === me);
  const handLegal = $derived(liveTurn ? live.legal : legal);
  const plays = $derived(handLegal.flatMap((a) => (typeof a === 'object' && 'Play' in a ? [a.Play] : [])));
  const discardable = $derived(
    handLegal.flatMap((a) => (typeof a === 'object' && 'Discard' in a ? [a.Discard] : [])),
  );
  const handMode = $derived(
    !(myTurn || liveTurn) ? 'view' : discardable.length > 0 ? 'choose' : plays.length > 0 ? 'play' : 'view',
  );

  let chosen = $state<CardT[]>([]);
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

  /** Why a tapped card cannot be played, in a few words. */
  function refuse(card: CardT) {
    const reason = (() => {
      if (!play || 'Joker' in card) return '지금은 낼 수 없는 카드예요';
      if (play.called_joker && view.hand.some((c) => 'Joker' in c)) return '조커콜 · 조커를 내야 해요';
      const trump = play.contract.trump;
      const suit = card.Normal[0];
      const black = (s: Suit) => s === 'Spade' || s === 'Club';
      const lead = play.lead;
      if (lead && play.plays.length > 0) {
        const follows = (c: CardT) =>
          'Normal' in c && ('Suit' in lead ? c.Normal[0] === lead.Suit : black(c.Normal[0]) === (lead.Color === 'Black'));
        if (view.hand.some(follows)) {
          return 'Suit' in lead ? `${leadLabel(lead)}를 따라 내야 해요` : `${leadLabel(lead)} 카드를 내야 해요`;
        }
      }
      if (suit === trump && trickNo === 1) return '첫 라운드엔 기루다를 낼 수 없어요';
      return '지금은 낼 수 없는 카드예요';
    })();
    client.notice(reason);
  }

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
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);
      pauses.add(done);
    });
  }

  function skipAhead() {
    if (!running) return;
    hurry = true;
    for (const a of felt?.getAnimations({ subtree: true }) ?? []) a.finish();
    for (const done of [...pauses]) done();
  }

  $effect(() => {
    const next = client.game;
    if (!next || next === untrack(() => shown)) return;
    queue.push(next);
    untrack(pump);
  });

  /** Duration multiplier: 0 skips motion; a backlog speeds it up. */
  function pace(): number {
    if (settings.speed === 'off' || hurry) return 0;
    // Once it is your turn, what is left to show plays three times as fast.
    const waiting = untrack(() => liveTurn) ? 3 : 1;
    return (settings.speed === 'fast' ? 0.5 : 1) / (1 + 0.5 * queue.length) / waiting;
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift()!;
        const k = pace();
        // Too far behind or not being watched: catch up at once.
        cues(shown, next);
        if (k === 0 || document.hidden || queue.length > 3) {
          for (const a of felt?.getAnimations({ subtree: true }) ?? []) a.finish();
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
    }
  }

  type Round = { plays: Played[]; tricks: Trick[]; friend: number | null; called_joker?: CardT | null };
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
  async function land(fresh: Played[], apply: () => void, k: number, context?: { all: Played[]; lead: Lead | null; trump: Suit | null }) {
    const from = fresh.map((p) => anchor(p.seat, p.card));
    apply();
    await tick();
    const heavy = fresh.map((p) =>
      context ? weight(p, context.all[0]?.seat === p.seat, context.lead, context.trump) : null,
    );
    if (!prefersReducedMotion.current) {
      await Promise.all(
        fresh.map((p, i) => {
          const origin = from[i];
          const duration = (p.seat === me ? 220 : 320) * k;
          if (!heavy[i]) sound.card((i * 60 * k + duration * 0.8) / 1000);
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
    setTimeout(() => {
      if (seatCues[seat]?.id === id) delete seatCues[seat];
    }, 1500);
  }
  /** The result has been counted out (or shown at once). */
  let tallied = $state(false);

  /** How hard a card lands: the 마이티 and jokers ring; a trump cutting the round thumps. */
  function weight(p: Played, leader: boolean, lead: Lead | null, trump: Suit | null): 'mighty' | 'joker' | 'cut' | null {
    if (!p.powered) return null;
    if ('Joker' in p.card) return 'joker';
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
    if (redeal.why === 'AllPassed') return;
    thrownIn = redeal.why.Misdeal;
    clearTimeout(thrownInTimer);
    thrownInTimer = setTimeout(() => (thrownIn = null), 8000);
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
      if (kind(now) === 'Exchange' && typeof now === 'object' && 'Exchange' in now) cueAt(now.Exchange.declarer, '주공', 'declarer');
      if (kind(now) === 'Play' && kind(was) === 'Exchange') sound.call();
      if (kind(now) === 'Bidding') sound.shuffle();
    }
    if (typeof was === 'object' && 'Bidding' in was && typeof now === 'object' && 'Bidding' in now) {
      const moved = JSON.stringify(was.Bidding.best) !== JSON.stringify(now.Bidding.best) ||
        was.Bidding.passed.filter(Boolean).length !== now.Bidding.passed.filter(Boolean).length;
      if (moved) {
        const raised = JSON.stringify(was.Bidding.best) !== JSON.stringify(now.Bidding.best);
        const raises = (next.view.bids ?? []).filter((b) => b.contract !== null).length;
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
        b.plays.slice(a.plays.length).forEach((_, i) => sound.card(i * 0.06));
      }
    }
  }

  async function transition(prev: StateMsg, next: StateMsg, k: number) {
    const before = roundOf(prev.view.phase);
    const after = roundOf(next.view.phase);
    const newHand = typeof next.view.phase === 'object' && 'Bidding' in next.view.phase && !('Bidding' in Object(prev.view.phase));
    if (!before || !after) {
      shown = next;
      if (newHand) {
        dealing = true;
        await pause(900 * k);
        dealing = false;
      }
      return;
    }
    const reduced = prefersReducedMotion.current;
    const nowPhase = next.view.phase;
    const trump = typeof nowPhase === 'object' && 'Play' in nowPhase ? nowPhase.Play.contract.trump : null;
    const liveLead = typeof nowPhase === 'object' && 'Play' in nowPhase ? nowPhase.Play.lead : null;
    if (after.tricks.length === before.tricks.length) {
      await land(after.plays.slice(before.plays.length), () => (shown = next), k, {
        all: after.plays,
        lead: liveLead,
        trump,
      });
    } else if (after.tricks.length === before.tricks.length + 1) {
      const trick = after.tricks.at(-1)!;
      await land(
        trick.plays.slice(before.plays.length),
        () => {
          resolving = { plays: trick.plays, key: after.tricks.length, lead: trick.lead };
          shown = next;
        },
        k,
        { all: trick.plays, lead: trick.lead, trump },
      );
      // The hero moment: a beat, the winning card pops, the trick sweeps to its winner.
      await pause(150 * k);
      winner = trick.winner;
      await pop(slotCard(trick.winner), reduced || hurry ? 0 : 360 * k);
      await pause((reduced ? 700 : 250) * k);
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
      cueAt(after.friend, '프렌드', 'friend');
      // The 주공's seat answers, linking the two.
      const partner = typeof next.view.phase === 'object' && 'Play' in next.view.phase ? next.view.phase.Play.declarer : null;
      if (partner !== null) setTimeout(() => cueAt(partner, null, 'answer'), 260 * k);
      await pause(700 * k);
      revealed = null;
    }
  }

  const onTable = $derived(resolving ? resolving.plays : (play?.plays ?? []));
  const onTableLead = $derived(resolving ? resolving.lead : (play?.lead ?? null));
  const trickKey = $derived(resolving ? `r${resolving.key}` : `p${play?.tricks.length ?? 0}`);
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
  let review = $state(false);
  let replay = $state(false);
  const lastTrick = $derived(play?.tricks.at(-1) ?? null);

  const callLabel = $derived.by(() => {
    if (!call) return null;
    if (friend !== null) return seatName(friend);
    if (typeof call === 'object' && 'Card' in call && contract && sameCard(call.Card, mightyCard(contract.trump))) {
      return '마이티';
    }
    return friendCallLabel(call, seatName, twoJokers);
  });

  const waitingFor = $derived.by(() => {
    if (turn === null) return null;
    if (exchange) return `주공 ${seatName(turn)} · 키티 정리 중`;
    if (bidding) return `${seatName(turn)} · 공약 고르는 중`;
    return `${seatName(turn)} 차례`;
  });

  const seated = $derived(client.seat !== null);
  const full = $derived(room?.seats.every((s) => s.kind !== 'empty') ?? false);
</script>

<section class="table" class:mine={myTurn} class:nudge>
  <!-- 상황판: everything about the hand on one line. -->
  {#snippet hintTools()}
    {#if client.hint && myTurn}
      <span class="hint-text pop" role="status">💡 봇이라면 <strong>{actionLabel(client.hint, seatName)}</strong></span>
    {:else if settings.hints && liveTurn}
      <button class="hint-btn" aria-label="봇이라면 뭘 할지 보기" onclick={() => client.askHint()}>💡</button>
    {/if}
  {/snippet}
  <div class="status" aria-live="polite">
    {#if bidding}
      {#if bidding.best}
        <span class="item">최고 공약 <strong class="contract">{contractLabel(bidding.best[1])}</strong></span>
        <span class="item muted">{seatName(bidding.best[0])}</span>
      {:else}
        <span class="item">공약 없음</span>
        <span class="item muted">최소 {view.rules.bidding.min}</span>
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
        <span class="item meter" class:made={contractState === 'made'} class:lost={contractState === 'lost'}>
          여당 {#key teamPoints}<strong class="bump">{teamPoints}/{contract.count}</strong>{/key}
          <span class="bar" aria-hidden="true">
            <span class="fill" style:width="{(Math.min(teamPoints, 20) / 20) * 100}%"></span>
            <span class="goal" style:left="{(contract.count / 20) * 100}%"></span>
          </span>
        </span>
        {#each tags as t (t.text)}<span class="tag-chip {t.tone} pop">{t.text}</span>{/each}
      {/if}
      {#if lastTrick && !resolving}
        <button class="ghost review" aria-pressed={review} onclick={() => (review = !review)}>직전 라운드</button>
      {/if}
    {/if}
    {#if me !== null}
      <span class="react-status">
        {@render hintTools()}
        <Reactions below onreact={(text) => client.react(text)} />
      </span>
    {/if}
  </div>
  {#if (event && !done) || tip}
    <div class="event">
      {#if event && !done}{#key event}<p class="fade-up" aria-live="polite">{event}</p>{/key}{/if}
      {#if tip}{#key tip}<p class="tip fade-up" aria-live="polite">💬 {tip}</p>{/key}{/if}
    </div>
  {/if}

  <div class="felt" bind:this={felt}>
    {#if me !== null}
      <span class="react-spot">
        {@render hintTools()}
        <Reactions onreact={(text) => client.react(text)} />
      </span>
    {/if}
    {#each around as r (r)}
      {@const s = seatAt(r)}
      {@const info = room?.seats[s]}
      <div class="spot pos-{n === 5 ? r : 'free'}" data-seat={s} style:--x={Math.cos(angle(r))} style:--y={Math.sin(angle(r))}>
        <Seat
          name={seatName(s)}
          bot={info?.kind === 'bot'}
          offline={info?.kind === 'human' && !info.connected}
          team={team(s)}
          points={points(s)}
          turn={turn === s}
          bubble={bubble(s)}
          reaction={client.reactions?.[s] ?? null}
          cue={seatCues[s] ?? null}
          dim={bidding?.passed[s] ?? false}
          reveal={revealed === s}
        />
      </div>
    {/each}

    <div class="trick" aria-label={resolving ? '끝난 라운드' : '이번 라운드'}>
      {#each onTable as p, i (`${trickKey}-${p.seat}`)}
        {@const r = relative(p.seat)}
        <div
          class="slot"
          class:beaten={winner !== null && p.seat !== winner}
          data-slot={p.seat}
          style:--tilt="{((p.seat * 7 + trickNo * 3) % 5) - 2}deg"
          style:--x={Math.cos(angle(r))} style:--y={Math.sin(angle(r))}>
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

    {#if resolving && winner !== null}
      <p class="note below won-note">{winner === me ? '내가' : seatName(winner)} 가져감</p>
    {:else if play && play.plays.length === 0 && !resolving}
      <p class="note">{turn === me ? '내가 선' : `${seatName(play.leader)} 선`}</p>
    {:else if play?.called_joker}
      <p class="note below alert">조커콜 · 조커를 내야 해요</p>
    {:else if trickNotes.length > 0}
      <p class="note below">{trickNotes.join(' · ')}</p>
    {/if}

    {#if thrownIn && bidding}
      <div class="sheet review-sheet thrown-in fade-up" role="status" aria-label="딜미스로 보여 준 패">
        <p class="thrown-title"><strong>{seatName(thrownIn.seat)}</strong> 딜미스 · 이 패를 보여 줬어요</p>
        <div class="thrown-cards">
          {#each thrownIn.hand as c, i (i)}<Card card={c} size="mini" {twoJokers} />{/each}
        </div>
        <button class="ghost" onclick={() => (thrownIn = null)}>닫기</button>
      </div>
    {/if}
    {#if review && lastTrick}
      <div class="sheet review-sheet" role="dialog" aria-label="직전 라운드">
        <div class="review-cards">
          {#each lastTrick.plays as p, i (p.seat)}
            <figure>
              <span class="mini-slot">
                <Card card={p.card} size="mini" seal={seal(p.card)} {twoJokers} won={p.seat === lastTrick.winner} />
                {#if i === 0 && 'Joker' in p.card}<LeadTag lead={lastTrick.lead} />{/if}
              </span>
              <figcaption>{seatName(p.seat)}</figcaption>
            </figure>
          {/each}
        </div>
        <button class="ghost" onclick={() => (review = false)}>닫기</button>
      </div>
    {/if}

    {#if done}
      {@const won = done.team_points >= done.contract.count}
      {@const mineWon = me !== null && won === (me === done.declarer || me === done.friend)}
      <!-- A tap anywhere on the result skips the count; keys need nothing to skip. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <div class="sheet result" class:big={result && result.made && result.margin >= 3} class:lost={!mineWon && me !== null} role="status" onclick={skipCount}>
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
        <p class="sub">여당 <strong>{done.team_points}</strong> / 공약 {done.contract.count}</p>
        {#if result}
          <ol class="ledger" aria-label="점수 계산">
            {#each result.lines as line, i (i)}
              <li class:shown={step > i} class:total={i === result.lines.length - 1}>{line}</li>
            {/each}
          </ol>
        {/if}
        <table>
          <thead>
            <tr><th scope="col">이름</th><th scope="col">역할</th><th scope="col">점수</th><th scope="col">이번 판</th><th scope="col">누적</th></tr>
          </thead>
          <tbody>
            {#each done.payoffs as pay, s (s)}
              {@const t = team(s)}
              <tr class:me={s === me}>
                <td class="who">{seatName(s)}</td>
                <td>{#if t}<span class="team {t === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[t]}</span>{/if}</td>
                <td class="num">{points(s)}</td>
                <td class="num" class:neg={pay < 0}>{(shownPay[s] ?? pay) > 0 ? '+' : ''}{shownPay[s] ?? pay}</td>
                <td class="num">{room?.scores[s] ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  {#if me !== null}
    <div class="strip">
      {#if variants}
        <div class="variants">
          {#each variants as v, i (i)}
            <button class="chip" onclick={() => act({ Play: v })}>{variantLabel(v)}</button>
          {/each}
          <button class="ghost" onclick={() => (variants = null)}>취소</button>
        </div>
      {:else if myTurn && bidding}
        <BidPanel {legal} onact={act} />
      {:else if myTurn && exchange}
        <ExchangePanel
          {legal}
          contract={exchange.contract}
          rules={view.rules}
          {toDiscard}
          chosen={chosen.length}
          hand={view.hand}
          {seatName}
          onact={act}
          ondiscard={discardChosen}
        />
      {:else if myTurn && play}
        <p class="prompt"><strong>내 차례</strong> · {settings.singleTap ? '낼 카드를 누르세요' : '낼 카드를 두 번 누르세요'}</p>
      {:else if done}
        <div class="next">
          {#if seated && !full}<span class="muted">빈 자리를 채우면 다음 판을 시작할 수 있어요</span>{/if}
          {#if done.tricks.length}<button onclick={() => (replay = true)}>다시 보기</button>{/if}
          <button class="primary" disabled={!seated || !full} onclick={() => client.start()}>다음 판</button>
        </div>
      {:else if waitingFor}
        <p class="prompt muted">{waitingFor}…</p>
      {/if}
    </div>

    <div class="tray" class:reveal={revealed === me} bind:this={tray}>
      {#if seatCues[me]?.text}{#key seatCues[me].id}<Callout text={seatCues[me].text!} below={false} />{/key}{/if}
      <div class="me-row">
        {#if team(me)}<span class="team {team(me) === 'defense' ? 'defense' : 'declarer'}">{TEAM_LABEL[team(me)!]}</span>{/if}
        {#if points(me) > 0}<span class="my-points">{points(me)}점</span>{/if}
      </div>
      {#if view.hand.length > 0}
        <Hand
          cards={view.hand}
          mode={handMode}
          {playable}
          {chosen}
          {kitty}
          {seal}
          {twoJokers}
          deal={dealing}
          onplay={playCard}
          ontoggle={toggle}
          onrefuse={refuse}
        />
      {/if}
    </div>
  {:else}
    <p class="prompt muted spectating">구경하는 중{waitingFor ? ` · ${waitingFor}` : ''}</p>
  {/if}
  {#if replay && done}
    <HandReplay
      tricks={done.tricks}
      discards={done.discards ?? []}
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
  .table {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'status' 'event' 'felt' 'strip' 'tray';
    gap: 6px;
    height: calc(100dvh - var(--chrome, 80px) - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  }
  .status {
    grid-area: status;
    /* Above the felt, so the reactions menu opens over the seats. */
    position: relative;
    z-index: 8;
  }
  .event {
    grid-area: event;
  }
  /* 여당's points against the contract, on a 0–20 bar with the goal marked. */
  .meter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .meter .bar {
    position: relative;
    width: 48px;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
  }
  .meter .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 3px;
    background: var(--ink-muted);
    transition: width var(--dur-quick) var(--ease-standard);
  }
  .meter .goal {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 12px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--ink);
  }
  .meter.made .fill {
    background: var(--accent);
  }
  .meter.made strong {
    color: var(--accent);
  }
  .meter.lost .fill {
    background: var(--danger);
  }
  .tag-chip {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 12px;
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
  }
  .event .tip {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }
  .felt {
    grid-area: felt;
  }
  .react-status {
    display: none;
  }
  .react-spot {
    position: absolute;
    right: 4px;
    bottom: 4px;
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
    border-radius: 999px;
    font-size: 18px;
  }
  .hint-text {
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--card);
    color: var(--ink);
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
    gap: 2px 14px;
    min-height: 32px;
    font-size: 14px;
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
    font-size: 17px;
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
    margin: -6px 0 0;
    text-align: center;
    font-size: 13px;
    color: var(--ink-muted);
  }
  .review {
    min-height: 32px;
    padding: 4px 10px;
    font-size: 13px;
    color: var(--ink-muted);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .review[aria-pressed='true'] {
    color: var(--ink);
    border-color: var(--ink);
  }

  /* The felt: four seats in fixed bands (two on top, one each side), the
     trick in the middle, each card between its player and the centre. */
  .felt {
    --seat-w: 92px;
    --seat-h: 64px;
    position: relative;
    min-height: 0;
    container-type: size;
  }
  /* Card size from the room left between the seats: wide enough that the
     side cards clear the side seats, short enough that the top cards clear
     the top seats and the bottom card leaves room for the note. */
  .trick,
  .note {
    --card-w: clamp(
      40px,
      min((100cqw - 2 * var(--seat-w) - 16px) / 3.4, (50cqh - var(--seat-h) - 14px) / 1.84, (50cqh - 40px) / 2.1),
      84px
    );
    --card-h: calc(var(--card-w) * 1.4);
    --tx: calc(var(--card-w) * 1.25);
    --ty: calc(var(--card-h) + 6px);
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
    top: 50%;
    transform: translateY(-50%);
  }
  .spot.pos-2,
  .spot.pos-3 {
    top: 0;
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
    top: 50%;
    transform: translateY(-50%);
  }
  .trick {
    position: absolute;
    left: 50%;
    top: 50%;
  }
  .slot {
    position: absolute;
    transform: translate(calc(-50% + var(--x) * var(--tx)), calc(-50% + var(--y) * var(--ty)));
  }
  /* Cards on the table lie a little crooked, each its own way. */
  .trick .slot :global(.card) {
    --w: var(--card-w);
    rotate: var(--tilt, 0deg);
    transition: opacity var(--dur-quick) var(--ease-standard);
  }
  /* While a round resolves, the cards that lost step back. */
  .trick .slot.beaten :global(.card) {
    opacity: 0.55;
  }
  .note {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    font-size: 14px;
    color: var(--ink-muted);
    white-space: nowrap;
    pointer-events: none;
  }
  .note.below {
    top: calc(50% + var(--ty) + var(--card-h) / 2 + 16px);
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
    border-radius: 16px;
    background: var(--panel);
    box-shadow: 0 4px 0 rgb(0 0 0 / 0.08);
    z-index: 2;
  }
  .review-sheet {
    display: grid;
    justify-items: center;
    gap: 8px;
    width: auto;
  }
  .thrown-title {
    margin: 0;
    font-size: 15px;
  }
  .thrown-cards {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 3px;
  }
  .mini-slot {
    position: relative;
    margin-bottom: 8px;
  }
  .review-cards {
    display: flex;
    gap: 8px;
  }
  figure {
    margin: 0;
    display: grid;
    justify-items: center;
    gap: 4px;
  }
  figcaption {
    max-width: 56px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-muted);
  }

  .result {
    text-align: center;
    animation: rise var(--dur-reveal) var(--ease-settle) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 24px)) scale(0.96);
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
    font-size: 15px;
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
    color: var(--ink);
  }
  .result .sub {
    margin: 4px 0 12px;
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
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  td {
    padding: 6px 4px;
    border-top: 1px solid var(--line);
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
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
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

  /* The action strip: one slot whose content follows the phase. */
  .strip {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    min-height: 64px;
    padding: 10px 12px;
    border-radius: 16px;
    background: var(--panel);
  }
  .prompt {
    margin: 0;
    text-align: center;
    font-size: 15px;
  }
  .mine .prompt strong {
    color: var(--accent);
  }
  .variants,
  .next {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
  .next .primary {
    min-width: 160px;
  }
  .next .muted {
    font-size: 14px;
  }

  .tray {
    position: relative;
    padding: 8px 8px 12px;
    border-radius: 16px;
    outline: 3px solid transparent;
    outline-offset: -3px;
    transition: outline-color var(--dur-quick) var(--ease-standard);
  }
  .tray :global(.hand) {
    transition: translate 420ms var(--ease-settle);
  }
  /* Your turn: the hand rises a touch to meet you. */
  .mine .tray :global(.hand) {
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
    gap: 8px;
    min-height: 20px;
    font-size: 13px;
    font-weight: 600;
  }
  .my-points {
    font-variant-numeric: tabular-nums;
  }
  .spectating {
    padding: 16px;
  }

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
    .strip {
      align-self: stretch;
      overflow-y: auto;
    }
    .trick,
    .note {
      --card-w: clamp(36px, min((100cqw - 2 * var(--seat-w) - 16px) / 3.4, (50cqh - 6px) / 2.1), 72px);
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
