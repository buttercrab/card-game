// What is drawn lags the server by the animations still playing: each new
// state waits in a queue, and the difference to the one on screen is
// animated before it is shown (docs/DESIGN.md, Motion). The animator owns
// that queue and what it is showing (the state on screen, a trick being
// swept, the cues at the seats); the table draws from it.
//
// - pump: plays the queue in order; too far behind, it jumps to the latest.
// - pause: a beat that ends early when the player acts.
// - hurry: the player acted, so what is left plays at once.
// - skip: finish every motion now and show the latest state.

import { tick } from 'svelte';
import { isPoint } from '../cards';
import { later } from '../../../clock';
import { flyFrom, flyTo, hold, juice, pop, ring, settle } from '../../../motion';
import { motion, settings } from '../../../settings.svelte';
import { sound } from '../../../sound';
import type { Card, Lead, PhaseView, Played, StateMsg, Suit } from '../types';
import { describe, redealtBetween, roundOf } from './narration';
import { phaseOf, weight } from './view';

/** A big moment at a seat (docs/DESIGN.md, Moments): the seat wiggles,
 * with a short label under it when there is one. */
export type CueKind = 'declarer' | 'friend' | 'mighty' | 'joker' | 'call' | 'misdeal' | 'answer';
export interface Cue {
  text: string | null;
  id: number;
}

/** What the animator needs of the table. */
export interface Stage {
  /** Your seat, or null when watching. */
  me(): number | null;
  seatName(seat: number): string;
  twoJokers(): boolean;
  /** Suppress a turn cue if the queued turn is no longer actionable. */
  liveTurn(): boolean;
  /** The card on the trick that `seat` played, as drawn. */
  trickCard(seat: number): Element | null;
  /** Where a card played by `seat` comes from, or a finished trick goes to:
   * the card in your hand (or your tray), or the seat. */
  anchor(seat: number, card?: Card): DOMRect | null;
  /** The element that wiggles for a seat: its figure, or your tray. */
  seatElement(seat: number): Element | null;
  /** Everything on the table that moves (to finish it all at once). */
  felt(): Element | null;
  /** Until when (performance.now()) the seats are sliding to new places. */
  slidingUntil(): number;
}

export class Animator {
  /** The state on screen. */
  shown: StateMsg = $state()!;
  /** A finished trick kept on the table while it resolves. */
  resolving = $state<{ plays: Played[]; key: number; lead: Lead } | null>(null);
  winner = $state<number | null>(null);
  /** The friend just revealed, while their seat turns over. */
  revealed = $state<number | null>(null);
  dealing = $state(false);
  /** The deal after a redeal, dealt in half the time. */
  quickDeal = $state(false);
  /** The latest thing that happened, for anyone who looked away. */
  event = $state<string | null>(null);
  /** A hand thrown in as 딜미스, shown face up for a while as at a real table. */
  thrownIn = $state<{ seat: number; hand: Card[] } | null>(null);
  cues = $state<Record<number, Cue>>({});

  #stage: Stage;
  #queue: StateMsg[] = [];
  #running = false;
  #hurry = false;
  #pauses = new Set<() => void>();
  #cueId = 0;
  #thrownInTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(stage: Stage, first: StateMsg) {
    this.#stage = stage;
    this.shown = first;
  }

  /** Whether a queue is playing. */
  get running(): boolean {
    return this.#running;
  }

  /** The next state from the server. */
  push(next: StateMsg) {
    if (next === this.shown) return;
    this.#queue.push(next);
    void this.#pump();
  }

  /** The hand was put away (the seats moved): start again from `blank`. */
  reset(blank: StateMsg) {
    this.#queue.length = 0;
    this.#finishAll();
    this.resolving = null;
    this.winner = null;
    this.event = null;
    this.thrownIn = null;
    this.shown = blank;
  }

  /** The player acted: finish what is animating and show the latest state. */
  skip() {
    if (!this.#running) return;
    this.#hurry = true;
    this.#finishAll();
    for (const done of [...this.#pauses]) done();
  }

  /** Deals the hand on screen in, as the table opens onto a fresh deal. */
  dealIn(): () => void {
    this.dealing = true;
    sound.shuffle();
    const release = hold();
    const timer = setTimeout(() => {
      this.dealing = false;
      release();
    }, settings.speed === 'fast' ? 450 : 900);
    return () => {
      clearTimeout(timer);
      release();
    };
  }

  /** A big moment at `seat`: it wiggles, with `text` under it for 1.5 s. */
  cueAt(seat: number, text: string | null, kind: CueKind) {
    const id = ++this.#cueId;
    this.cues[seat] = { text, id };
    sound.cue(kind);
    if (seat === this.#stage.me()) void juice(this.#stage.seatElement(seat), 0.25);
    later(() => {
      if (this.cues[seat]?.id === id) delete this.cues[seat];
    }, 1500);
  }

  dismissThrownIn() {
    this.thrownIn = null;
  }

  /** A pause that ends early when the player acts. */
  #pause(ms: number): Promise<void> {
    if (this.#hurry || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.#pauses.delete(done);
        cancel();
        resolve();
      };
      const cancel = later(done, ms);
      this.#pauses.add(done);
    });
  }

  /** Ends every motion on the table at once, except the endless ones (a
   * figure's blink), which have no end to jump to. */
  #finishAll() {
    for (const a of this.#stage.felt()?.getAnimations({ subtree: true }) ?? []) {
      if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish();
    }
  }

  /** Explicit Fast mode and backlogs can hurry; a turn arriving never
   * silently changes the player's chosen motion speed. */
  #pace(): number {
    return this.#paceUnhurried();
  }
  /** Respect the selected speed, with bounded catch-up for queued updates. */
  #paceUnhurried(): number {
    if (motion.level === 'off' || this.#hurry) return 0;
    return (settings.speed === 'fast' ? 0.5 : 1) / (1 + 0.5 * this.#queue.length);
  }

  async #pump() {
    if (this.#running) return;
    this.#running = true;
    const release = hold();
    try {
      // Seats moved for this hand (a shuffle at 다음 판): they slide to
      // their places first, then the cards are dealt.
      const slide = this.#stage.slidingUntil() - performance.now();
      if (slide > 0) await new Promise((done) => setTimeout(done, slide));
      while (this.#queue.length > 0) {
        const next = this.#queue.shift()!;
        const k = this.#pace();
        const previous = this.shown;
        this.#cues(previous, next);
        // Too far behind: catch up at once. A hidden tab plays on as if
        // watched, on the worker clock, so coming back finds the hand
        // where it would be.
        if (k === 0 || this.#queue.length > 3) {
          this.#finishAll();
          this.resolving = null;
          this.winner = null;
          this.shown = next;
          this.#settled(previous, next);
          continue;
        }
        await this.#transition(previous, next, k);
        this.#settled(previous, next);
      }
    } finally {
      this.#running = false;
      this.#hurry = false;
      release();
    }
  }

  #showThrownIn(prev: StateMsg, next: StateMsg) {
    const redeal = next.view.redealt;
    if (!redeal || !redealtBetween(prev, next)) return;
    // Up until the next deal lands, or for at most 4 s.
    clearTimeout(this.#thrownInTimer);
    if (redeal.why === 'AllPassed') {
      this.thrownIn = null;
      return;
    }
    this.thrownIn = redeal.why.Misdeal;
    this.#thrownInTimer = setTimeout(() => (this.thrownIn = null), 4000);
  }

  /** Sounds, cues and the event line for a change of state. */
  #cues(prev: StateMsg, next: StateMsg) {
    const me = this.#stage.me();
    const was = prev.view.phase;
    const now = next.view.phase;
    this.event = describe(prev, next, (s) => this.#stage.seatName(s), this.#stage.twoJokers()) ?? this.event;
    this.#showThrownIn(prev, next);
    const redeal = next.view.redealt;
    const redealt = redealtBetween(prev, next);
    if (redeal && redeal.why !== 'AllPassed' && redealt) this.cueAt(redeal.why.Misdeal.seat, '딜미스', 'misdeal');
    const calledBefore = roundOf(was)?.called_joker;
    const { play } = phaseOf(now);
    if (play && play.called_joker && !calledBefore && play.plays[0]) this.cueAt(play.plays[0].seat, '조커콜', 'call');
    const kind = (p: PhaseView) => (typeof p === 'object' ? Object.keys(p)[0] : p);
    if (kind(now) !== kind(was)) {
      const { exchange } = phaseOf(now);
      if (exchange) this.cueAt(exchange.declarer, null, 'declarer');
      if (kind(now) === 'Play' && kind(was) === 'Exchange') sound.call();
      if (kind(now) === 'Bidding') sound.shuffle();
    } else if (redealt) {
      sound.shuffle();
    }
    const a = phaseOf(was).bidding;
    const b = phaseOf(now).bidding;
    if (a && b) {
      const raised = JSON.stringify(a.best) !== JSON.stringify(b.best);
      const moved = raised || a.passed.filter(Boolean).length !== b.passed.filter(Boolean).length;
      if (moved) sound.bid(raised ? next.view.bids.filter((x) => x.contract !== null).length : 0);
    }
    // With motion off, cards still make their sound as they land.
    if (this.#pace() === 0 || motion.level !== 'full') {
      const r = roundOf(was);
      const s = roundOf(now);
      if (r && s && s.tricks.length === r.tricks.length) {
        s.plays.slice(r.plays.length).forEach((_, i) => sound.card(i * 0.06, r.plays.length + i > 0));
      }
    }
  }

  /** Ready/result cues follow the visible action, never its queued packet. */
  #settled(prev: StateMsg, next: StateMsg) {
    if (!this.#stage.felt()?.isConnected) return;
    const me = this.#stage.me();
    const turnOf = (m: StateMsg) => typeof m.turn === 'object' ? m.turn.Seat : null;
    if (me !== null && turnOf(next) === me && turnOf(prev) !== me && this.#stage.liveTurn()) {
      sound.turn();
      if (settings.haptics) navigator.vibrate?.(18);
    }
    const done = phaseOf(next.view.phase).done;
    if (done && !phaseOf(prev.view.phase).done) {
      const mine = me === null || me === done.declarer || me === done.friend;
      const made = done.team_points >= done.contract.count;
      sound.result(mine ? made : !made);
    }
  }

  /** Shows `fresh` cards arriving from their players while `apply` updates
   * the table; resolves to which of them landed heavy. */
  async #land(
    fresh: Played[],
    apply: () => void,
    k: number,
    context?: { all: Played[]; lead: Lead | null; trump: Suit | null; taker: number | null },
  ): Promise<boolean[]> {
    const stage = this.#stage;
    const me = stage.me();
    const from = fresh.map((p) => stage.anchor(p.seat, p.card));
    apply();
    await tick();
    const twoJokers = stage.twoJokers();
    const heavy = fresh.map((p) =>
      context ? weight(p, context.all[0]?.seat === p.seat, context.lead, context.trump, context.taker, twoJokers) : null,
    );
    if (motion.level === 'full') {
      await Promise.all(
        fresh.map((p, i) => {
          const origin = from[i];
          const duration = (p.seat === me ? 220 : 320) * k;
          // A card landing on others gets an extra edge tick.
          const onTop = (context?.all.findIndex((q) => q.seat === p.seat) ?? 0) > 0;
          if (!heavy[i]) sound.card((i * 60 * k + duration * 0.8) / 1000, onTop);
          return origin && !this.#hurry ? flyFrom(stage.trickCard(p.seat), origin, duration, i * 60 * k) : undefined;
        }),
      );
    }
    // Heavy cards land with a thump and a beat's hold; the 마이티 and jokers
    // are called out at the seat that played them.
    for (const [i, p] of fresh.entries()) {
      const kind = heavy[i];
      if (!kind) continue;
      sound.heavy();
      const card = stage.trickCard(p.seat);
      if (kind !== 'cut') void ring(card, 'var(--ink)');
      void settle(card);
      if (kind === 'mighty') this.cueAt(p.seat, '마이티', 'mighty');
      if (kind === 'joker') this.cueAt(p.seat, '조커', 'joker');
      if (!this.#hurry) await this.#pause(110 * k);
    }
    return heavy.map(Boolean);
  }

  async #transition(prev: StateMsg, next: StateMsg, k: number) {
    const stage = this.#stage;
    const before = roundOf(prev.view.phase);
    const after = roundOf(next.view.phase);
    // A redeal (딜미스, or everyone passing) is a fresh deal too: the cards
    // are gathered and dealt again, as at a real table.
    const redealt = redealtBetween(prev, next);
    const newHand = phaseOf(next.view.phase).bidding !== null && (phaseOf(prev.view.phase).bidding === null || redealt);
    if (!before || !after) {
      this.shown = next;
      if (newHand) {
        // Like a trick's end, the deal is not hurried by your turn. A
        // redeal goes twice as fast: everyone has just seen a deal.
        this.dealing = true;
        this.quickDeal = redealt;
        await this.#pause((redealt ? 450 : 900) * this.#paceUnhurried());
        this.dealing = false;
        this.quickDeal = false;
      }
      return;
    }
    const reduced = motion.level !== 'full';
    const play = phaseOf(next.view.phase).play;
    const trump = play?.contract.trump ?? null;
    if (after.tricks.length === before.tricks.length) {
      const fresh = (after.plays as Played[]).slice(before.plays.length);
      const heavy = await this.#land(fresh, () => (this.shown = next), k, {
        all: after.plays as Played[],
        lead: play?.lead ?? null,
        trump,
        taker: after.leading ?? null,
      });
      // A card that takes the lead gives a small bounce once it has landed;
      // heavy cards have already made their own entrance.
      const was = before.leading ?? null;
      const now = after.leading ?? null;
      const taker = fresh.findIndex((p) => p.seat === now);
      if (was !== null && now !== null && now !== was && taker >= 0 && !heavy[taker] && !this.#hurry) {
        void juice(stage.trickCard(now), 0.15);
      }
    } else if (after.tricks.length === before.tricks.length + 1) {
      const trick = after.tricks.at(-1)!;
      await this.#land(
        trick.plays.slice(before.plays.length),
        () => {
          this.resolving = { plays: trick.plays, key: after.tricks.length, lead: trick.lead };
          this.shown = next;
        },
        k,
        { all: trick.plays, lead: trick.lead, trump, taker: trick.winner },
      );
      // The hero moment: a beat, the winning card pops, the whole trick
      // stays a moment to be read, then sweeps to its winner. The hold is
      // not hurried by your turn: everyone gets to see how the round ended.
      const kh = this.#paceUnhurried();
      await this.#pause(150 * kh);
      this.winner = trick.winner;
      await pop(stage.trickCard(trick.winner), reduced || this.#hurry ? 0 : 360 * kh);
      await this.#pause((reduced ? 1100 : 1050) * kh);
      const to = stage.anchor(trick.winner);
      // The sweep is heard from the winner's side of the table.
      const pan = to ? ((to.left + to.width / 2) / innerWidth - 0.5) * 1.2 : 0;
      sound.sweep(0, pan);
      if (!reduced && !this.#hurry && to) {
        await Promise.all(trick.plays.map((p, i) => flyTo(stage.trickCard(p.seat), to, 400 * k, i * 40 * k)));
      }
      sound.score(trick.plays.filter((p) => isPoint(p.card)).length);
      // The winner's plate takes the cards with a small bounce.
      void juice(stage.seatElement(trick.winner), trick.winner === stage.me() ? 0.15 : 0.35);
      await this.#land(
        after.plays as Played[],
        () => {
          this.resolving = null;
          this.winner = null;
        },
        k,
      );
    } else {
      this.shown = next;
    }
    if (before.friend === null && after.friend !== null && after.friend !== undefined) {
      this.revealed = after.friend;
      this.cueAt(after.friend, null, 'friend');
      // The 주공's seat answers, linking the two.
      const partner = play?.declarer ?? null;
      if (partner !== null) later(() => this.cueAt(partner, null, 'answer'), 260 * k);
      await this.#pause(700 * k);
      this.revealed = null;
    }
  }
}
