<script lang="ts">
  // The table: everything about a hand, drawn from the room's latest state
  // as the animator plays it out. It fills the screen exactly, in fixed
  // rows (the top line, the event line, the felt, the action strip and
  // your tray) so nothing moves from the deal to the result; whatever
  // comes and goes lies over them. The parts are in table/: what to show
  // (view.ts, narration.ts, seats.ts), when (the animator), and each region.
  import { tick, untrack, onDestroy } from 'svelte';
  import {readActionPolicy} from '../../room/actionPolicy';
  import {innerWidth, innerHeight} from 'svelte/reactivity/window';
  import { resultUsesDock, observerFeedbackPolicy } from '../../table/frameLayout';
  const observerPolicy=$derived(observerFeedbackPolicy({width:innerWidth.current??390,height:innerHeight.current??844}));
  const inlineResult = $derived(resultUsesDock({width: innerWidth.current ?? Infinity, height: innerHeight.current ?? Infinity}));
  import { ACHIEVEMENTS, type Achievement } from './achievements';
  import {recordMightyCompletion} from './completion';
  import BidPanel from './BidPanel.svelte';
  import { actionLabel, cardLabel, kittyCount, sameCard, sealOf } from './cards';
  import { MIGHTY, presetRules } from './catalog';
  import { later } from '../../clock';
  import ExchangePanel from './ExchangePanel.svelte';
  import HandReplay from './HandReplay.svelte';
  import FinishedHands from './FinishedHands.svelte';
  import TurnCue from './table/TurnCue.svelte';
  import ParticipationLane from '../../room/ParticipationLane.svelte';
  import Bubble from '../../ui/Bubble.svelte';
  import TableFrame from '../../ui/TableFrame.svelte';
  import { refusalText } from './ledger';
  import { EASE_STANDARD, juice } from '../../motion';
  import { SceneMotion, sampleVisualBounds, type MotionPose } from '../../table/sceneMotion';
  import { provideTableCoordinates } from '../../table/coordinateContext';
  import { coordinateId } from '../../table/sceneCoordinates';
  import type { IdentityPosition } from '../../table/movement';
  import { setMood } from '../../music.svelte';
  import SeatMenuHost from '../../room/SeatMenuHost.svelte';
  import { TableSession } from '../../room/TableSession.svelte';
  import { motion, settings } from '../../settings.svelte';
  import ShareCard from './ShareCard.svelte';
  import { sound } from '../../sound';
  import SuitText from '../../SuitText.svelte';
  import { Animator } from './table/animator.svelte';
  import Felt, { type SeatView, type TrickNote } from './table/Felt.svelte';
  import Lobby from '../../room/Lobby.svelte';
  import { tipFor, variantLabel } from './table/narration';
  import { cardKey, Registry } from './table/registry';
  import ResultSheet from './table/ResultSheet.svelte';
  import { moveNames, rememberNames, Ring, seatLabel, seatName as nameOf } from '../../room/seats';
  import SidePanel from './table/SidePanel.svelte';
  import StatusBar from './table/StatusBar.svelte';
  import Strip from './table/Strip.svelte';
  import ThrownIn from './table/ThrownIn.svelte';
  import Tools from './table/Tools.svelte';
  import DecisionRegion from '../../table/DecisionRegion.svelte';
  import EngineFlow from '../../table/EngineFlow.svelte';
  import Tray from './table/Tray.svelte';
  import { bidNote, callLabel as callLabelOf, handView, moodOf, tagsOf, trickNotes, trickNumber, waitingFor } from './table/view';
  import { TableUi } from '../../room/ui.svelte';
  import type { TableProps } from '../../room/game';
  import type { Action, Card as CardT, Mighty, PlayAction, StateMsg } from './types';
  import Button from '../../ui/Button.svelte';
  import ActionPanel from '../../table/ActionPanel.svelte';
  import { cardActionSpecs, projectMighty, selectPlayActions } from './presentation';
  import { commandForPayload, resolveCommand, type ActionOffer } from '../../table/presentation';
  import { resolveCommandBatch } from '../../table/commandBatch';

  let {
    client,
    present: givenPresenter,
    ui: givenUi,
    session: givenSession,
    rulesName = '',
    onsettings,
    onrules,
    oninvite,
    onpeople,
  }: TableProps<Mighty> = $props();
  const presenter = untrack(() => givenPresenter) ?? projectMighty;
  const ui = untrack(() => givenUi) ?? new TableUi();
  const session = untrack(() => givenSession) ?? new TableSession(untrack(() => client), ui, () => client.room);

  // Between hands, with no hand on the table (the first one, or once the
  // seats moved), the table shows its seats on an empty state of its own.
  const room = $derived(client.room);
  const idle = $derived(client.game === null);
  const blank = $derived.by((): StateMsg => {
    const n = room?.seats.length ?? 5;
    return {
      view: {
        viewer: client.seat === null ? 'Spectator' : { Seat: client.seat },
        rules: room ? room.rules : presetRules(MIGHTY.default_preset),
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
  const coordinates = provideTableCoordinates(() => section);
  let observerEntry = $state<HTMLElement>();
  let admissionHeight = $state(0);
  $effect(() => observerEntry && coordinates.measurements.observeSize(observerEntry, size => { admissionHeight = size.height; }));
  $effect(() => { section; coordinates.measurements.invalidate(); });
  onDestroy(() => coordinates.measurements.dispose());
  let felt = $state<HTMLElement>();
  let ringEl = $state<HTMLElement>();
  let mobileSeat = $state<HTMLElement>();
  let tray = $state<HTMLElement>();
  /** Until when (performance.now()) the seats are sliding to new places;
   * a deal that comes with a shuffle waits for them to arrive. */
  let slidingUntil = 0;
  const centered = $derived(session.centered);
  const ownMovement = new SceneMotion();
  const seatMovement = new SceneMotion();
  $effect(() => () => { ownMovement.interrupt(); seatMovement.interrupt(); });
  $effect(() => {
    const stop = () => {
      ownMovement.interrupt();
      seatMovement.interrupt();
      slidingUntil = 0;
    };
    addEventListener('resize', stop);
    return () => removeEventListener('resize', stop);
  });
  $effect(() => {
    if (motion.level !== 'full') {
      ownMovement.interrupt();
      seatMovement.interrupt();
      slidingUntil = 0;
    }
  });
  let wasCentered = untrack(() => centered);
  $effect.pre(() => {
    const next = centered;
    if (next === wasCentered) return;
    wasCentered = next;
    const own = seatEls.get(bottomSeat);
    const oldBounds=coordinates.bounds.get(coordinateId('player',`seat:${bottomSeat}`));
    const old=oldBounds?ownMovement.capture('local-player',own,oldBounds):null;
    const revision = ownMovement.interrupt();
    if (!old?.bounds.width || motion.level !== 'full' || flip) return;
    const duration = 300 * motion.speed;
    slidingUntil = Math.max(slidingUntil, performance.now() + duration + 50);
    void tick().then(() => {
      const currentBounds=coordinates.bounds.get(coordinateId('player',`seat:${bottomSeat}`));
      const current=currentBounds?{id:'local-player',bounds:currentBounds}:null;
      if (!own || !current) return;
      void ownMovement.retarget('local-player',own,old,current.bounds,{enabled:motion.level==='full',duration,animationId:'own-seat-transition',easing:EASE_STANDARD,revision});
    });
  });

  const animator: Animator = new Animator(
    {
      me: (): number | null => me,
      seatName,
      liveTurn: () => liveTurn,
      twoJokers: (): boolean => hand.twoJokers,
      trickCard: (seat) => trickCards.get(seat),
      anchor: (seat, card) => {
        if(seat===me&&card){const key=cardKey(card);const bound=coordinates.bounds.get(coordinateId('card',key));if(bound)return sampleVisualBounds(handCards.get(key),bound,section);}
        const bound=coordinates.bounds.get(coordinateId('player',`seat:${seat}`));
        return bound?sampleVisualBounds(movementTarget(seat),bound,section):null;
      },
      trickBounds: seat => {const played=onTable.find(card=>card.seat===seat);const bound=played?coordinates.bounds.get(coordinateId('card',cardKey(played.card))):null;return bound?sampleVisualBounds(trickCards.get(seat),bound,section):null;},
      frameOrigin:()=>{const frame=section?.getBoundingClientRect();return{x:frame?.x??0,y:frame?.y??0};},
      felt: () => felt ?? null,
      slidingUntil: () => slidingUntil,
    },
    untrack(() => client.game ?? blank),
  );
  onDestroy(() => animator.dispose());
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
  const turn = $derived(animator.resolving ? null : typeof msg.turn === 'object' ? msg.turn.Seat : null);
  const myTurn = $derived(me !== null && turn === me);
  const hand = $derived(handView(view, me));
  const { bidding, exchange, play, done, contract } = $derived(hand);
  const ring = $derived.by(() => new Ring(n, session.bottom));
  const bottomSeat = $derived(me ?? ring.bottom);
  const resolving = $derived(animator.resolving);
  $effect.pre(() => { session.settling = resolving !== null || (!idle && done === null && !(room?.in_hand ?? false)); });
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
  const livePolicy=$derived(readActionPolicy(live));
  const liveTurn = $derived(me !== null && typeof live.turn === 'object' && live.turn.Seat === me);
  const handLegal = $derived(livePolicy.legal);
  const presentation = $derived(presenter({ ...msg, legal: live.legal, out_of_turn: live.out_of_turn, policy_actions:live.policy_actions,version: live.version, turn: live.turn, notes: live.notes }, {
    viewer: me,
    active: liveTurn && client.seat !== null,
    players: Array.from({ length: n }, (_, seat) => ({
      id: room?.participant_ids?.[seat] || `seat:${seat}`, seat, label: seatName(seat),
      kind: room?.seats[seat]?.kind === 'bot' ? 'bot' : 'human',
    })),
  }));
  /** 딜미스 outside your turn: from the moment the cards land, while your
   * hand qualifies and the rules still allow it. */
  const misdealNow = $derived(!liveTurn && livePolicy.out_of_turn.includes('Misdeal'));
  /** How long the first bid still waits after the deal, as last sent. */
  const bidWait = $derived(liveTurn ? live.grace_ms : 0);
  const plays = $derived(selectPlayActions(handLegal).map(action => action.Play));
  const discardable = $derived(handLegal.flatMap((a) => (typeof a === 'object' && 'Discard' in a ? [a.Discard] : [])));
  const handMode = $derived(
    !(myTurn || liveTurn) ? 'view' : discardable.length > 0 ? 'choose' : plays.length > 0 ? 'play' : 'view',
  );
  const toDiscard = $derived(exchange ? kittyCount(rules) - (exchange.discards?.length ?? 0) : 0);
  const tip = $derived(settings.tips ? tipFor(hand, rules, myTurn, misdealNow, toDiscard) : null);

  let chosen = $state<CardT[]>([]);
  let chosenRevision = $state<string | null>(null);
  /** The card lifted by a first tap, waiting for the second. */
  let raisedCard = $state<CardT | null>(null);
  let variants = $state<PlayAction[] | null>(null);
  const variantOffer = $derived<ActionOffer<Action>>({
    id: presentation.offer.id,
    actions: presentation.offer.actions.flatMap(spec => {
      if (spec.kind !== 'command' || typeof spec.action !== 'object' || !('Play' in spec.action)) return [];
      const played = spec.action.Play;
      return variants?.some(variant => JSON.stringify(variant) === JSON.stringify(played))
        ? [{ ...spec, label: variantLabel(played) }] : [];
    }),
  });

  // Forget choices that no longer apply once the server moves on.
  $effect(() => {
    void msg;
    const stillLegal = discardable;
    const offerId = presentation.offer.id;
    untrack(() => {
      if (chosenRevision !== offerId) { chosen = []; chosenRevision = null; }
      else chosen = chosen.filter((c) => stillLegal.some((d) => sameCard(d, c)));
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
  const turnAction = $derived(bidding ? '공약 고르기' : exchange ? (msg.legal.some(a => typeof a === 'object' && 'CallFriend' in a) ? '프렌드 정하기' : '키티 정리') : play ? '카드 내기' : null);
  const controls = $derived(!!variants || (myTurn && (bidding !== null || exchange !== null)));
  let controlsHeight = $state(0);
  /** Why a tapped card cannot be played, as the server explains it. Said
   * where the turn is said, in place of the caption or the pill, so it
   * never lands on the hand or on the line it replaces. */
  function refuse(card: CardT) {
    const why = live.notes.unplayable.find((u) => sameCard(u.card, card))?.why;
    const reason = why ? refusalText(why) : '지금은 낼 수 없는 카드예요';
    client.notice(reason);
  }

  function playable(card: CardT): boolean {
    return presentation.cards.some(spec => spec.zoneId === 'own-hand' && spec.id === cardKey(card) && spec.enabled);
  }

  function act(action: Action, expectedOfferId = presentation.offer.id) {
    const spec = commandForPayload(presentation.offer, action);
    if (!spec) { client.notice('선택지가 바뀌었어요. 다시 확인해주세요.'); return; }
    const current = resolveCommand(presentation.offer, expectedOfferId, spec.id);
    if (!current.ok) { client.notice(current.reason); return; }
    variants = null;
    animator.skip();
    client.act(current.action);
  }

  function playCard(card: CardT) {
    const options = cardActionSpecs(presentation, cardKey(card)).filter(spec => spec.enabled && typeof spec.action === 'object' && 'Play' in spec.action);
    if (options.length === 1) act(options[0].action);
    else if (options.length > 1) variants = options.flatMap(spec => typeof spec.action === 'object' && 'Play' in spec.action ? [spec.action.Play] : []);
  }

  function toggle(card: CardT) {
    if (chosenRevision !== presentation.offer.id) { chosen = []; chosenRevision = presentation.offer.id; }
    const i = chosen.findIndex((c) => sameCard(c, card));
    if (i >= 0) chosen = chosen.filter((_, j) => j !== i);
    else if (chosen.length < toDiscard) chosen = [...chosen, card];
  }

  function discardChosen(expectedOfferId: string) {
    if (chosenRevision !== expectedOfferId || chosen.length !== toDiscard || !chosen.length) {
      client.notice('버릴 카드를 다시 확인해주세요.'); return;
    }
    const ids = chosen.map(card => commandForPayload(presentation.offer, { Discard: card })?.id ?? '');
    const prepared = resolveCommandBatch(presentation.offer, expectedOfferId, ids);
    if (!prepared.ok) { client.notice(prepared.reason); return; }
    animator.skip();
    for (const action of prepared.action) client.act(action);
    chosen = [];
    chosenRevision = null;
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
  let completionNoticeKey='';
  $effect(() => {
    if (!done || !room || !client.keepsRecord) return;
    const result=recordMightyCompletion({room:$state.snapshot(room),scope:$state.snapshot(client.roomCommandWindow?.scope??client.game?.command?.scope??null),actorId:client.viewerId,seat:me,keepsRecord:client.keepsRecord},Date.now());
    if(result.status==='stored'&&result.earnedIds.length)earned=[...untrack(()=>earned),...ACHIEVEMENTS.filter(item=>result.earnedIds.includes(item.id))];
    if('message'in result&&result.message){
      const key=JSON.stringify([room.id,room.session_id,room.current_hand?.number,client.viewerId,result.status]);
      if(untrack(()=>completionNoticeKey)!==key){completionNoticeKey=key;client.notice(result.message);}
    }
  });
  // They go with the next hand.
  $effect(() => {
    if (!done && untrack(() => earned.length)) earned = [];
  });

  type ReplaySnapshot = {
    done: NonNullable<ReturnType<typeof handView>['done']>;
    names: string[];
    rules: StateMsg['view']['rules'];
    twoJokers: boolean;
    hiddenDiscards: boolean;
    context?: string;
  };
  // Transport copies and Svelte proxies need not share object identity.
  // The complete immutable deal identifies the replay across both views.
  const replayFrames = new Map<string, ReplaySnapshot>();
  const replayKey = (finished: ReplaySnapshot['done']) => `${room?.id}:${room?.session_id ?? 1}:${JSON.stringify(finished)}`;
  let replay = $state.raw<ReplaySnapshot | null>(null);
  let replayOpener: HTMLElement | null = null;
  function rememberReplay(source: StateMsg['view']) {
    if (typeof source.phase !== 'object' || source.phase === null || !('Done' in source.phase)) return;
    const finished = source.phase.Done;
    const key = replayKey(finished);
    if (replayFrames.has(key)) return;
    const viewer = source.viewer === 'Spectator' ? null : source.viewer.Seat;
    replayFrames.set(key, {
      done: finished,
      names: room?.current_hand?.names ?? Array.from({ length: source.hand_sizes.length }, (_, s) => nameOf(s, viewer, room?.seats, known, true)),
      rules: source.rules, twoJokers: handView(source, viewer).twoJokers,
      hiddenDiscards: source.rules.reveal_discards === false && finished.declarer !== viewer,
    });
    // An open replay holds its own frame; bound historical cache growth.
    if (replayFrames.size > 8) replayFrames.delete(replayFrames.keys().next().value!);
  }
  // Freeze live metadata before the room advances, and retain displayed
  // completions even when intermediate incoming updates were batched.
  $effect(() => {
    const source = client.game?.view;
    if (source) rememberReplay(source);
  });
  $effect(() => rememberReplay(view));
  function openReplay(finished: ReplaySnapshot['done']) {
    const key = replayKey(finished);
    if (!replayFrames.has(key)) rememberReplay({ ...view, phase: { Done: finished } });
    replayOpener = document.querySelector<HTMLElement>('.replay-button') ?? document.querySelector<HTMLElement>('.menu-btn');
    const saved = room?.current_hand;
    const source = saved?.view as StateMsg['view'] | undefined;
    replay = saved && source?.rules && typeof source.phase === 'object' && source.phase !== null && 'Done' in source.phase ? {done: source.phase.Done, names: saved.names, rules: source.rules, twoJokers: source.rules.deck === 'TwoJokers', hiddenDiscards: source.rules.reveal_discards === false, context: '이번 판 다시 보기'} : replayFrames.get(key)!;
  }
  $effect(() => {
    if (!ui.replay) return;
    ui.replay = false;
    // A reconnect receives the immutable completed record before the live
    // state. Replay follows that record, not the hand animator's readiness.
    const recorded = room?.current_hand?.view as StateMsg['view'] | undefined;
    const finished = done ?? (recorded && typeof recorded.phase === 'object' && recorded.phase !== null && 'Done' in recorded.phase ? recorded.phase.Done : null);
    if (finished) openReplay(finished);
    else client.notice('현재 판이 끝나면 다시 볼 수 있어요');
  });
  function closeReplay() {
    replay = null;
    void tick().then(() => {
      const target = replayOpener?.isConnected ? replayOpener : document.querySelector<HTMLElement>('.menu-btn');
      target?.focus();
    });
  }
  let sharing = $state(false);

  // ---- Between hands -------------------------------------------------------
  // The table stays: the seats keep their places, the completed hands show,
  // and the middle offers the next hand. A tap on a seat opens its choices.
  const seated = $derived(client.seat !== null);
  const observerReaction = $derived.by(() => {
    const reactions = Object.entries(client.observerReactions ?? {}).sort((a, b) => b[1].id - a[1].id);
    const latest = reactions[0];
    if (!latest) return null;
    const observer = room?.observers?.find(o => o.id === latest[0]);
    return observer ? { name: observer.name, ...latest[1] } : null;
  });
  const between = $derived(!(room?.in_hand ?? false) && idle);
  const arranging = $derived(session.arranging);
  const shuffleNote = $derived(session.shuffleNote);
  const swapFrom = $derived(ui.swapFrom);
  const choosing = $derived(session.choosing);
  const previewSeat = $derived(session.previewSeat);

  // Seats slide to their new places when they move (a swap or a shuffle):
  // the client says so while the old places are still on screen.
  let flip: { positions: MotionPose[]; order: number[] | null; revision: number } | null = null;
  function positionId(seat: number): string {
    return room?.participant_ids?.[seat] || `seat:${seat}`;
  }
  function movementTarget(seat:number):HTMLElement|null {
    const spot=spots.get(seat);
    return spot?.querySelector<HTMLElement>('.seat-box')??seatEls.get(seat);
  }
  function seatPositions(): MotionPose[] {
    return [...spots.entries()].flatMap(([seat]) => {
      const bounds=coordinates.bounds.get(coordinateId('player',`seat:${seat}`));
      const position=bounds?seatMovement.capture(positionId(seat),movementTarget(seat),bounds):null;
      return position?.bounds.width ? [position] : [];
    });
  }

  /** How long seats take to slide to their new places. */
  const slideMs = () => (settings.speed === 'fast' ? 260 : 460);
  $effect(() => {
    client.onmove = (order) => {
      // A move arriving while the last one still slides starts from where
      // the seats are drawn now: measure that frame before cancelling it.
      const positions = seatPositions();
      const revision = seatMovement.interrupt();
      flip = { positions, order, revision };
      if (motion.level === 'full') slidingUntil = performance.now() + slideMs() + 80;
      session.seatsMoved();
      if (order) known = moveNames(known, order);
    };
    return () => {
      client.onmove = null;
    };
  });
  $effect(() => {
    void room?.seats;
    const f = flip;
    flip = null;
    const still = motion.level !== 'full';
    if (f) {
      if (still) return;
      void tick().then(() => {
        const after: IdentityPosition[] = [];
        const targets = new Map<string, Element[]>();
        for (const [seat, spot] of spots.entries()) {
          const from = f.order ? f.order.indexOf(seat) : seat;
          const id = room?.participant_ids?.[seat] || `seat:${from}`;
          const bounds=coordinates.bounds.get(coordinateId('player',`seat:${seat}`));
          const current=bounds?{id,bounds}:null;
          if (!current) continue;
          after.push(current);
          const target=movementTarget(seat);if(target)targets.set(id,[target]);
        }
        for(const pose of f.positions){
          const current=after.find(position=>position.id===pose.id);const target=targets.get(pose.id)?.[0];
          if(current&&target)void seatMovement.retarget(pose.id,target,pose,current.bounds,{enabled:motion.level==='full',duration:slideMs(),animationId:'seat-slide',easing:EASE_STANDARD,revision:f.revision});
        }
      });
      return;
    }
    // Occupants fill the existing anchor without hopping the character.
  });

  function finishedSeatMatches(seat: number) { return !done || !room?.current_hand || room.current_hand.participant_ids[seat] === room.participant_ids?.[seat]; }
  // ---- Each seat, as drawn ----------------------------------------------------
  const seatViews = $derived(
    Array.from({ length: n }, (_, s): SeatView => {
      const info = room?.seats[s];
      return {
        empty: info?.kind === 'empty',
        score: null,
        name: info?.kind === 'empty' ? '빈 자리' : seatName(s),
        bot: info?.kind === 'bot',
        offline: info?.kind === 'human' && !info.connected,
        team: finishedSeatMatches(s) ? hand.team(s) : null,
        points: finishedSeatMatches(s) ? hand.points(s) : 0,
        collecting: resolving !== null,
        ready: between || done ? (room?.ready?.[s] ?? null) : null,
        reviewing: done !== null,
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
    liveTurn && play ? (settings.singleTap ? '낼 카드를 누르세요' : raisedCard ? '한 번 더 누르면 내요' : '낼 카드를 두 번 누르세요') : null,
  );
</script>

{#snippet participation()}
  {#if room}<ParticipationLane {room} {client} {session} preview={previewSeat} {choosing} onchoose={() => session.choose()} onselect={(seat) => session.sitAt(seat)} onconfirm={() => session.confirmChoice()} oncancel={() => session.cancelChoice()} />{/if}
{/snippet}
{#snippet seatTap(seat: number)}
  <!-- Between hands a seat is one button: its choices, or the other half of a swap. -->
  {@const label = seatLabel(seat, me, room?.seats[seat])}
  <button
    class="seat-tap"
    class:picked={swapFrom === seat}
    aria-label={swapFrom === null ? `${label} 자리 메뉴` : swapFrom === seat ? `${label} 그만 고르기` : `${label}: 여기와 바꾸기`}
    aria-pressed={swapFrom === seat ? true : undefined}
    aria-haspopup={swapFrom === null ? 'dialog' : undefined}
    onclick={() => session.openSeat(seat)}
  ></button>
{/snippet}
{#snippet mySeatTap()}
  {@render seatTap(bottomSeat)}
{/snippet}
{#snippet seatActs(seat: number, onheight:(height:number)=>void)}
  <!-- An empty seat says how to fill it, right there. -->
  <DecisionRegion class="seat-acts" mode="flow" align="center" gap={4} {onheight}>
    {#if swapFrom !== null}
      <Button class="seat-act" onclick={() => session.openSeat(seat)} aria-label="{seat + 1}번 자리: 여기와 바꾸기">여기로 옮기기</Button>
    {:else if me !== null}
      <Button class="seat-act bot-action" onclick={() => session.addBot(seat)} aria-label="{seat + 1}번 자리에 봇 앉히기">봇 추가</Button>
    {:else}
      <Button class="seat-act" onclick={() => session.sitAt(seat)} aria-label="{seat + 1}번 자리에 앉기">자리 선택</Button>
    {/if}
  </DecisionRegion>
{/snippet}
{#snippet controlPanel()}
  {#if variants}
    <DecisionRegion class="variants" mode="flow" align="center" gap={8}>
      <ActionPanel offer={variantOffer} selection label="카드 내기 선택" onaction={act} />
      <Button variant="ghost" onclick={() => (variants = null)}>취소</Button>
    </DecisionRegion>
  {:else if bidding}
    <BidPanel offer={presentation.offer} lastChance={hand.lastChance} wait={bidWait} onact={act} />
  {:else if exchange}
    <ExchangePanel
      offer={presentation.offer}
      {chosenRevision}
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
{#snippet strip()}
  <div class="strip-area" data-frame-region="strip">
    <Strip
      controls={controls ? controlPanel : undefined}
      {pill}
      waiting={done ? null : waiting}
      misdeal={misdealNow}
      onmisdeal={() => act('Misdeal')}
      bind:controlsHeight
    />
  </div>
{/snippet}

{#snippet resultPanel()}
  {#if done && !resolving}
    <ResultSheet dock={inlineResult}
      {done}
      {me}
      {room}
      {seatName}
      team={hand.team}
      points={hand.points}
      {earned}
      {seated}
      {shuffleNote}
      onreplay={openReplay}
      onshare={() => (sharing = true)}
      onadvance={() => session.advance()}
    />
  {/if}
{/snippet}

<TableFrame
  bind:element={section}
  class={`table ${me !== null ? 'seated' : 'observing'} ${settings.tips ? 'tips' : ''} ${swapFrom !== null ? 'swapping' : ''} ${done !== null && !resolving ? 'completed' : ''} ${controls ? 'controls-out' : ''} ${between ? 'between' : ''}`}
  {controls} {controlsHeight} {between} completed={done !== null && !resolving}
>
  <div class="status-area" data-frame-region="status">
    <StatusBar {hand} {rules} {trickNo} {tags} {callLabel} {seatName} {room} {idle} {rulesName} {onrules} />
  </div>
  <!-- Always there, at a fixed height, so the felt below never moves. -->
  <div class="event" data-frame-region="event">
    <EngineFlow fill direction="column" align="center" items={[...(turn!==null&&!between||resolving||animator.event&&!done?[{id:'turn'}]:[]),...(tip?[{id:'tip',width:'fill' as const}]:[])]}>
      {#snippet children(id)}
        {#if id==='turn'}
          {#if turn!==null&&!between}<TurnCue name={seatName(turn)} mine={myTurn} action={turnAction} compact />
          {:else if resolving}<TurnCue collecting compact />
          {:else if animator.event&&!done}{#key animator.event}<p class="fade-up" aria-live="polite"><SuitText text={animator.event} /></p>{/key}{/if}
        {:else if tip}{#key tip}<p class="tip fade-up" aria-live="polite"><SuitText text={tip} /></p>{/key}{/if}
      {/snippet}
    </EngineFlow>
  </div>

  <div class="side-area" data-frame-region="side">
    <SidePanel observerReactions={client.observerReactions} {onpeople} collecting={resolving !== null} {turnAction} {hand} {rules} {trickNo} {tags} {callLabel} {seatName} {myName} {seal} {room} {me} {turn} {ring} {idle} {rulesName} {shuffleNote} {onrules} />
  </div>

  <div class="felt-area" data-frame-region="felt">
    <Felt
      seatIds={Array.from({length:n},(_,seat)=>positionId(seat))}
      {ring}
      {admissionHeight}
      seats={seatViews}
      watching={false}
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
      interactive={arranging || choosing}
      {swapFrom}
      {seatTap}
      {seatActs}
      bind:felt
      bind:ringEl
    >
      {#if animator.thrownIn && bidding}
        <ThrownIn who={seatName(animator.thrownIn.seat)} hand={animator.thrownIn.hand} twoJokers={hand.twoJokers} onclose={() => animator.dismissThrownIn()} />
      {/if}
      {#if done && !resolving && done.tricks.length}
        <section class="finished-hands" data-engine-layout="arena-review" aria-label="전체 라운드">
          <FinishedHands compact tricks={done.tricks} declarer={done.declarer} friend={done.friend}
            seatName={(s) => room?.current_hand?.names[s] ?? seatName(s)} {seal} twoJokers={hand.twoJokers} />
        </section>
      {/if}
      {#if between && room}
        {#if me === null}
          <div class="participation-area observer-entry" data-engine-layout="arena-admission" bind:this={observerEntry}>
            <EngineFlow fill direction="column" gap={8} items={[{id:'participation',width:'fill'},...(shuffleNote?[{id:'note',width:'fill' as const}]:[])]}>
              {#snippet children(id)}{#if id==='participation'}{@render participation()}{:else}<p class="observer-note" role="status">{shuffleNote}</p>{/if}{/snippet}
            </EngineFlow>
          </div>
        {/if}
        <Lobby
          {room}
          seated={me !== null}
          {me}
          swapping={swapFrom !== null}
          sitName={session.sitName}
          shuffleNote={me === null ? null : shuffleNote}
          onadvance={() => session.advance()}
          onshuffle={(on) => session.setShuffle(on)}
          {onsettings}
          oncancelswap={() => (ui.swapFrom = null)}
        />
      {/if}
    </Felt>
  </div>

  {@render strip()}
  {@render resultPanel()}

    <div class="tray-area" data-frame-region="tray">
      <Tray
        coordinatePlayerId={`seat:${bottomSeat}`}
        reserveHand={me !== null && !!room?.in_hand}
        seat={{
          name: me === null ? seatName(bottomSeat) : myName,
          empty: room?.seats[bottomSeat]?.kind === 'empty',
          bot: room?.seats[bottomSeat]?.kind === 'bot',
          ready: between || done ? (room?.ready?.[bottomSeat] ?? null) : null,
          reviewing: done !== null,
          score: null,
          team: finishedSeatMatches(bottomSeat) ? hand.team(bottomSeat) : null,
          secretFriend: hand.secretFriend,
          points: finishedSeatMatches(bottomSeat) ? hand.points(bottomSeat) : 0,
          collecting: resolving !== null,
          turn: turn === bottomSeat,
          trumpSuit: contract?.trump ?? null,
          lookAt: lookAt(0),
          mood: mood(bottomSeat),
          away: isAway(bottomSeat),
        }}
        mine={liveTurn}
        {between}
        {centered}
        interactive={arranging || choosing}
        picked={swapFrom === bottomSeat}
        reaction={client.reactions?.[bottomSeat] ?? null}
        cue={animator.cues[bottomSeat] ?? null}
        {secsLeft}
        seatTap={mySeatTap}
        attachSeat={seatEls.at(bottomSeat)}
        attachSpot={spots.at(bottomSeat)}
        bind:tray
        bind:mobileSeat
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
    <div class="tools-area" data-frame-region="tools">
      <Tools {hint} canHint={settings.hints && liveTurn} onhint={() => client.askHint()} onreact={(text) => client.react(text)} />
    </div>
  {#if sharing && room}
    <ShareCard {room} onclose={() => (sharing = false)} />
  {/if}
  {#if room}
    <SeatMenuHost {session} {room} {oninvite}
      anchor={(seat) => {const frame=section?.getBoundingClientRect();const bound=coordinates.bounds.get(coordinateId('player',`seat:${seat}`));return frame&&bound?DOMRect.fromRect({...bound,x:bound.x+frame.x,y:bound.y+frame.y}):frame??new DOMRect();}} />
  {/if}
  {#if replay}
    {@const snapshot = replay}
    <HandReplay
      context={snapshot.context ?? ''}
      tricks={snapshot.done.tricks}
      payoffs={snapshot.done.payoffs}
      teamPoints={snapshot.done.team_points}
      contractCount={snapshot.done.contract.count}
      discards={snapshot.done.discards}
      hiddenDiscards={snapshot.hiddenDiscards}
      declarer={snapshot.done.declarer}
      friend={snapshot.done.friend}
      seatName={(s) => snapshot.names[s] ?? `${s + 1}번 자리`}
      seal={(card) => sealOf(card, snapshot.rules, snapshot.done.contract.trump)}
      twoJokers={snapshot.twoJokers}
      onclose={closeReplay}
    />
  {/if}
  {#if (room?.observers?.length ?? 0) > 0}<div class="observer-feedback" data-frame-region="feedback" aria-live="polite" aria-atomic="true">
    {#if observerReaction}{#key observerReaction.id}
      <EngineFlow items={[...(observerPolicy.compact?[]:[{id:'name'}]),{id:'reaction',width:'fill'}]} fill direction="column" align="center" gap={2}>
        {#snippet children(id)}{#if id==='name'}<span class="observer-name">{observerReaction.name}</span>{:else}<Bubble text={observerReaction.text} compact={observerPolicy.compact} mobile={observerPolicy.mobile} announce={false} />{/if}{/snippet}
      </EngineFlow>
    {/key}{/if}
  </div>{/if}
  {#if room && me === null && !between}
    <div class="social-area participation-area" data-frame-region="social">{@render participation()}</div>
  {/if}
</TableFrame>

<style>
  /* The shared frame owns placement, visibility and responsive budgets. */
  .event { text-align:center; font-size:var(--text-label); color:var(--ink-muted); }
  .event p { margin:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; line-height:18px; }
  .event .tip { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; white-space:normal; font-weight:600; color:var(--ink); }
  /* A joker's ways to be played, in a row over the felt's foot. */


  /* ---- Between hands -------------------------------------------------------
     Every seat is one tap from its choices: a transparent button over it. */
  .seat-tap {
    position: absolute;
    left:0; top:0; width:100%; height:100%;
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
  :global(.swapping) .seat-tap {
    box-shadow: inset 0 0 0 2px var(--line);
  }
  .seat-tap.picked {
    box-shadow: inset 0 0 0 2px var(--ink);
  }
  /* What an empty seat offers, right under its outline. */

  /* Functional additions retain the production table geometry. */

  .observer-feedback { font-size:11px; color:var(--ink-muted); pointer-events:none; }
  .observer-name { max-width:8em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .finished-hands {
    position:absolute; left:var(--arena-review-x); top:var(--arena-review-y);
    width:var(--arena-review-w); height:var(--arena-review-h);
    min-height:0; overflow-y:auto; overscroll-behavior:contain; pointer-events:auto;
  }
  .finished-hands :global(.hands) { width:100%; }
  .observer-entry {
    position:absolute; left:var(--arena-admission-x); top:var(--arena-admission-y);
    width:var(--arena-admission-w); z-index:var(--z-controls); padding:0; pointer-events:none;
  }
  .observer-note { margin:0; text-align:center; color:var(--ink-muted); font-size:var(--text-caption); text-wrap:balance; }
  :global(.between) :global(.tray) { pointer-events:none; }
  :global(.between) :global(.me-seat) { pointer-events:auto; }
  :global(.between) .strip-area { pointer-events:none; }

</style>
