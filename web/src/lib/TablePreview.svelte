<script lang="ts">
  // The real table with made-up data, for checking layout at any size:
  // /preview?state=bidding | waiting | misdeal | misdealnow | grace | exchange | friend | secret | nofriend | play | watch | late | sweep | done | won | run
  // (waiting and watch are the bidding and the play on someone else's turn;
  // misdealnow is 딜미스 outside your turn, grace the first bid held back
  // after the deal), and for the turn limit and the room: timer (another
  // seat's ring, a seat away) | mytimer (your last seconds) | spectate |
  // contract (the exchange with a trump change and raises). Between hands,
  // with the room's own bar and menu: lobby (the first hand, seats to fill) |
  // lobbywatch (the same, watching) | room (the table after the seats moved)
  // | folded (the last hand's result folded away) | seatbot | seatperson |
  // seatkick (sending a player to watch, asking first) | seatme | seatempty
  // (a seat's choices) | seatsit | seatsitbot (a watcher's name entry at an
  // empty seat, at a bot's) | swap (picking a seat to swap with) | pending
  // (섞기 pressed for the next hand) | menu (the table's menu) | leave
  // (나가기 mid-hand, asking first).
  import Room from './Room.svelte';
  import Table from './Table.svelte';
  import type { RoomClient } from './client.svelte';
  import { settled } from './motion';
  import type { Bid, Card, PhaseView, Played, RoomMsg, Rules, StateMsg, Trick } from './types';

  const which = new URLSearchParams(location.search).get('state') ?? 'play';

  const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): Card => ({ Normal: [suit, rank] });
  const rules: Rules = {
    players: 5,
    hand_size: 10,
    deck: 'TwoJokers',
    bidding: { min: 14, max: 20, allow_no_trump: true, no_trump_bonus: 1, first_bidder_may_pass: true, change_trump_cost: 2 },
    joker_call: {
      calls: [
        [n('Club', 3), n('Spade', 3)],
        [n('Heart', 3), n('Diamond', 3)],
      ],
      mighty_defense: true,
      called_joker_has_power: false,
    },
  };
  const hand: Card[] = [
    { Joker: 'Red' },
    n('Spade', 14),
    n('Spade', 10),
    n('Spade', 4),
    n('Diamond', 13),
    n('Diamond', 9),
    n('Heart', 12),
    n('Heart', 3),
    n('Club', 11),
    n('Club', 7),
  ];
  const kittyCards: Card[] = [n('Club', 2), n('Heart', 5), n('Diamond', 4), n('Spade', 6)];
  const contract = { trump: 'Spade' as const, count: 15 };
  const trickPlays: Played[] = [
    { seat: 1, card: n('Club', 3), powered: true },
    { seat: 2, card: n('Club', 13), powered: true },
    { seat: 3, card: n('Club', 9), powered: true },
    { seat: 4, card: n('Heart', 6), powered: true },
  ];
  const playPhase = (
    plays: Played[],
    tricks: Trick[],
    friend: number | null = null,
    trickNo = tricks.length,
  ): PhaseView => ({
    Play: {
      declarer: 2,
      contract,
      call: { Card: { Joker: 'Black' } },
      friend,
      trick_no: trickNo,
      leader: 1,
      lead: plays.length ? { Suit: 'Club' } : null,
      plays,
      // Club K, the highest club so far; the preview has no rules engine.
      leading: plays.length ? 2 : null,
      called_joker: null,
      tricks,
      discards: null,
    },
  });
  // A few rounds already played, for the log and the last round.
  const round = (lead: Trick['lead'], winner: number, cards: [number, Card][]): Trick => ({
    plays: cards.map(([seat, card]) => ({ seat, card, powered: true })),
    lead,
    winner,
  });
  const lateTricks: Trick[] = [
    round({ Suit: 'Club' }, 2, [[1, n('Club', 4)], [2, n('Club', 12)], [3, n('Club', 2)], [4, n('Club', 5)], [0, n('Club', 10)]]),
    round({ Suit: 'Diamond' }, 2, [[2, n('Diamond', 14)], [3, n('Diamond', 3)], [4, n('Diamond', 10)], [0, n('Diamond', 5)], [1, n('Diamond', 6)]]),
    round({ Suit: 'Heart' }, 3, [[2, n('Heart', 4)], [3, n('Heart', 14)], [4, n('Heart', 2)], [0, n('Heart', 11)], [1, n('Heart', 10)]]),
    round({ Suit: 'Heart' }, 3, [[3, { Joker: 'Black' }], [4, n('Heart', 5)], [0, n('Heart', 7)], [1, n('Heart', 13)], [2, n('Heart', 8)]]),
  ];
  const bids: Bid[] = [
    { seat: 0, contract: null },
    { seat: 1, contract: { trump: 'Heart', count: 14 } },
    { seat: 2, contract: { trump: 'Spade', count: 15 } },
    { seat: 3, contract: null },
    { seat: 4, contract: null },
    { seat: 1, contract: null },
  ];
  const phases: Record<string, PhaseView> = {
    bidding: { Bidding: { to_act: 0, best: [2, { trump: 'Heart', count: 15 }], passed: [false, true, false, true, false], has_bid: [false, false, true, false, false] } },
    // Fresh off the deal: nobody has bid yet.
    grace: { Bidding: { to_act: 0, best: null, passed: [false, false, false, false, false], has_bid: [false, false, false, false, false] } },
    exchange: { Exchange: { declarer: 0, contract, trump_changed: false, discards: [] } },
    // The discards are down; the declarer names the friend.
    friend: { Exchange: { declarer: 0, contract, trump_changed: false, discards: kittyCards } },
    play: playPhase(trickPlays, []),
    // You hold the called card (the 홍조커): the 프렌드 only you know about.
    secret: { Play: { ...(playPhase(trickPlays, []) as { Play: object }).Play, call: { Card: { Joker: 'Red' } } } } as PhaseView,
    // The 주공 took the first trick that named the friend: nobody is.
    nofriend: {
      Play: {
        ...(playPhase([], lateTricks.slice(0, 1).map((t) => ({ ...t, winner: 2 })), null, 1) as { Play: object }).Play,
        call: 'FirstTrick',
        no_friend: true,
      },
    } as PhaseView,
    watch: playPhase(trickPlays.slice(0, 2), []),
    // Later in the hand: the 프렌드 is out and both sides have points.
    late: playPhase(trickPlays, lateTricks, 3, 7),
    done: {
      Done: {
        declarer: 2,
        contract,
        call: { Card: { Joker: 'Black' } },
        friend: 3,
        team_points: 16,
        payoffs: [-1, -1, 4, 2, -4],
        tricks: [
          { plays: [2, 3, 4, 0, 1].map((seat, i) => ({ seat, card: [n('Spade', 14), n('Spade', 9), n('Spade', 2), n('Spade', 10), n('Heart', 4)][i], powered: true })), lead: { Suit: 'Spade' }, winner: 2 },
          { plays: [2, 3, 4, 0, 1].map((seat, i) => ({ seat, card: [{ Joker: 'Red' } as Card, n('Heart', 13), n('Diamond', 12), n('Heart', 3), n('Diamond', 2)][i], powered: true })), lead: { Color: 'Red' }, winner: 2 },
        ],
        discards: [n('Club', 2), n('Heart', 5), n('Diamond', 4), n('Club', 10)],
      },
    },
    run: {
      Done: { declarer: 0, contract, call: 'Alone', friend: null, team_points: 20, payoffs: [160, -40, -40, -40, -40], tricks: [] },
    },
    won: {
      Done: { declarer: 0, contract, call: { Card: { Joker: 'Black' } }, friend: 3, team_points: 17, payoffs: [6, -2, -2, 2, -2], tricks: [] },
    },
  };
  const legal: Record<string, StateMsg['legal']> = {
    bidding: ['Pass', ...[15, 16, 17].map((count) => ({ Bid: { trump: 'Spade' as const, count } }))],
    grace: ['Pass', ...[14, 15, 16, 17].map((count) => ({ Bid: { trump: 'Spade' as const, count } }))],
    exchange: [...hand, ...kittyCards].map((card) => ({ Discard: card })),
    friend: [
      // Every card, as in a real hand: the picker must hold the whole deck.
      ...[{ Joker: 'Black' } as Card, { Joker: 'Red' } as Card]
        .concat((['Spade', 'Diamond', 'Heart', 'Club'] as const).flatMap((suit) => [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((rank) => n(suit, rank))))
        .map((card) => ({ CallFriend: { Card: card } })),
      ...[0, 1, 2, 3, 4].filter((s) => s !== 0).map((seat) => ({ CallFriend: { Seat: seat } })),
      { CallFriend: 'LastTrick' as const },
      { CallFriend: 'FirstTrick' as const },
      { CallFriend: 'Alone' as const },
    ],
    play: hand.slice(1, 5).map((card) => ({ Play: { card, joker_lead: null, call_joker: false } })),
    late: hand.slice(1, 5).map((card) => ({ Play: { card, joker_lead: null, call_joker: false } })),
    secret: hand.slice(1, 5).map((card) => ({ Play: { card, joker_lead: null, call_joker: false } })),
    nofriend: hand.slice(1, 5).map((card) => ({ Play: { card, joker_lead: null, call_joker: false } })),
    done: [],
    won: [],
    run: [],
  };
  const msg = (phase: PhaseView, key: string, turn: StateMsg['turn']): StateMsg => ({
    type: 'state',
    view: {
      viewer: { Seat: 0 },
      rules,
      first_bidder: 0,
      // Every card has been played by the result.
      hand: key === 'exchange' ? [...hand, ...kittyCards] : key === 'done' || key === 'won' || key === 'run' ? [] : hand,
      hand_sizes: [10, 10, 10, 10, 10],
      points_taken:
        key === 'late'
          ? [
              [n('Club', 10), n('Heart', 11)],
              [n('Heart', 10), n('Diamond', 11)],
              [n('Spade', 13), n('Club', 12), n('Diamond', 10), n('Spade', 12), n('Heart', 13)],
              [n('Heart', 14), n('Club', 13), n('Diamond', 13)],
              [n('Diamond', 14), n('Club', 14)],
            ]
          : [[n('Club', 10)], [n('Heart', 10)], [n('Spade', 13), n('Club', 12)], [], [n('Diamond', 14)]],
      phase,
      bids: key === 'bidding' ? bids.slice(0, 3) : key === 'grace' ? [] : bids,
    },
    legal: legal[key] ?? [],
    turn,
    out_of_turn: which === 'misdealnow' ? ['Misdeal'] : [],
    grace_ms: key === 'grace' ? 2000 : 0,
  });
  const room: RoomMsg = {
    type: 'room',
    id: 'preview',
    game: 'mighty',
    settings: { preset: 'gshs' },
    seats: [
      { kind: 'human', name: '재용', connected: true },
      { kind: 'bot', name: '콩떡' },
      { kind: 'human', name: '아주긴이름의친구입니다', connected: true },
      { kind: 'human', name: '민수', connected: false },
      { kind: 'bot', name: '호두' },
    ],
    scores: [12, -3, 5, -8, -6],
    hands_played: 3,
    history: [
      [4, -1, -1, -1, -1],
      [-2, -2, 6, 2, -4],
      [10, -1, 0, -7, -2],
    ],
    in_hand: which !== 'done' && which !== 'won' && which !== 'run',
  };

  const alias: Record<string, string> = {
    sweep: 'play',
    misdeal: 'bidding',
    waiting: 'bidding',
    misdealnow: 'bidding',
    timer: 'watch',
    spectate: 'watch',
    mytimer: 'play',
    contract: 'exchange',
  };
  const key = which === 'folded' ? 'done' : which === 'leave' ? 'play' : (alias[which] ?? which);
  const turn: StateMsg['turn'] =
    key === 'done' || key === 'won' || key === 'run' ? 'Over' : which === 'waiting' || which === 'misdealnow' ? { Seat: 4 } : key === 'watch' ? { Seat: 3 } : { Seat: 0 };

  /** States drawn by the whole room page (Room.svelte), bar and menu too. */
  const ROOM_STATES = [
    'lobby',
    'lobbywatch',
    'room',
    'pending',
    'folded',
    'seatbot',
    'seatperson',
    'seatkick',
    'seatme',
    'seatempty',
    'seatsit',
    'seatsitbot',
    'swap',
    'menu',
    'leave',
  ];
  const inRoom = ROOM_STATES.includes(which);
  /** Watching between hands: the lobby with an empty seat, a watcher's name entry. */
  const watching = ['lobbywatch', 'seatsit', 'seatsitbot'].includes(which);
  /** Between hands with nothing on the table: the lobby, or once the seats moved. */
  const idle = inRoom && !['folded', 'leave'].includes(which);
  if (which === 'timer' || which === 'mytimer' || which === 'spectate' || inRoom) {
    room.table = { turn_secs: 20, shuffle: which === 'room' };
    room.watching = 2;
    room.seats[2] = { kind: 'human', name: '아주긴이름의친구입니다', connected: true, away: true };
  }
  if (inRoom) {
    // Everyone is here (the offline banner is the hand's business).
    room.seats[3] = { kind: 'human', name: '민수', connected: true };
    room.in_hand = which === 'leave';
    room.showing = !idle;
  }
  // 섞기 pressed: the next hand starts with a shuffle.
  if (which === 'pending' && room.table) room.table = { ...room.table, shuffle: false, shuffle_next: true };
  if (which === 'lobby' || watching || which === 'seatempty') {
    room.seats = [
      { kind: 'human', name: '재용', connected: true },
      { kind: 'bot', name: '콩떡', level: 'normal' },
      { kind: 'empty' },
      { kind: 'empty' },
      { kind: 'human', name: '아주긴이름의친구입니다', connected: true },
    ];
    room.scores = [0, 0, 0, 0, 0];
    room.hands_played = 0;
    room.history = [];
    room.watching = watching ? 1 : 0;
  }
  if (watching) room.seats[0] = { kind: 'empty' };
  if (which === 'contract') {
    // 공약 올리기 on: a trump chip picks the trump, the row under it the contract.
    rules.bidding.raise_on_exchange = true;
    const counts = [16, 17, 18, 19, 20];
    legal.exchange = [
      ...legal.exchange,
      ...(['Heart', 'Diamond', 'Club', null] as const).map((t) => ({ ChangeTrump: t })),
      ...counts.map((count) => ({ Raise: { trump: 'Spade' as const, count } })),
      ...counts.slice(1).map((count) => ({ Raise: { trump: 'Heart' as const, count } })),
    ];
  }
  const game = key === 'exchange' ? msg(phases.bidding, 'bidding', { Seat: 0 }) : msg(phases[key] ?? phases.play, key, turn);
  if (which === 'spectate') {
    game.view.viewer = 'Spectator';
    game.view.hand = [];
    game.legal = [];
  }
  const noop = () => {};
  const client = $state({
    room,
    // The exchange opens on the bidding, so the table sees which cards came from the kitty.
    game: idle ? null : game,
    seat: which === 'spectate' || watching ? null : 0,
    onmove: null,
    toasts: { current: null },
    status: 'open',
    clock:
      which === 'timer' || which === 'spectate'
        ? { seat: 3, deadline: performance.now() + 13000, total: 20000 }
        : which === 'mytimer'
          ? { seat: 0, deadline: performance.now() + 4800, total: 20000 }
          : null,
    act: noop,
    start: noop,
    react: noop,
    notice: noop,
    close: noop,
    join: noop,
    leave: noop,
    addBot: noop,
    removeBot: noop,
    setRules: noop,
    setTable: noop,
    shuffleNext: noop,
    swapSeats: noop,
    clearSeat: noop,
    askHint: noop,
    reactions: { 2: { text: '나이스', id: 1 }, 4: { text: '👏', id: 2 } },
  });

  /** The preview's scripted steps, which [`ready`] waits for. */
  const steps: Promise<void>[] = [];
  function step(ms: number, run: () => void) {
    steps.push(
      new Promise((done) =>
        setTimeout(() => {
          run();
          done();
        }, ms),
      ),
    );
  }

  if (which === 'misdeal') {
    // A new deal arrives after seat 3 threw in a weak hand.
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    step(300, () => {
      const next = msg(phases.bidding, 'bidding', { Seat: 0 });
      next.view.redealt = {
        why: { Misdeal: { seat: 3, hand: [n('Spade', 2), n('Spade', 3), n('Diamond', 4), n('Diamond', 5), n('Heart', 2), n('Heart', 6), n('Heart', 7), n('Club', 3), n('Club', 5), n('Club', 8)] } },
        count: 1,
      };
      client.game = next;
    });
  }

  if (key === 'exchange') {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    step(300, () => (client.game = msg(phases.exchange, 'exchange', { Seat: 0 })));
  }

  // The states that need a tap: done here, as a player would, once drawn.
  const tapSeat = { seatbot: 1, seatperson: 2, seatkick: 2, seatme: 0, seatempty: 2, seatsit: 0, seatsitbot: 1, swap: 1 }[which];
  if (tapSeat !== undefined || which === 'folded' || which === 'leave') {
    const click = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();
    step(200, () => {
      if (which === 'folded') click('.result .fold');
      if (which === 'leave') click('dialog .leave');
      if (tapSeat !== undefined) click(`[data-seat="${tapSeat}"] .seat-tap`);
    });
    const pick = (text: string) => [...document.querySelectorAll<HTMLElement>('.pop-card button')].find((b) => b.textContent?.includes(text))?.click();
    if (which === 'swap') step(250, () => pick('자리 바꾸기'));
    if (which === 'seatkick') step(250, () => pick('내보내기'));
  }

  if (which === 'sweep') {
    // Finish the trick so the table plays its sweep, holding the note on screen.
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    step(300, () => {
      const done = [...trickPlays, { seat: 0, card: n('Club', 11), powered: true }];
      client.game = msg(playPhase([], [{ plays: done, lead: { Suit: 'Club' }, winner: 2 }]), 'play', { Seat: 2 });
    });
  }

  /** Resolves once `selector` is on the page. */
  function shown(selector: string): Promise<void> {
    return new Promise((done) => {
      const check = () => (document.querySelector(selector) ? done() : requestAnimationFrame(check));
      check();
    });
  }

  /** Marks the page `data-ready` once the preview is drawn as it will stay:
   * its steps taken, the table done dealing and moving (or, for the sweep,
   * holding on its winner), the fonts in and every short animation
   * over. The e2e tests (web/e2e) wait for it instead of a fixed time. */
  async function ready() {
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    // A frame after each step, so the table has taken up what it changed.
    await frame();
    await Promise.all(steps);
    await frame();
    // The sweep holds on its winner; with motion off it goes straight past.
    await (which === 'sweep' ? Promise.race([shown('.won-note'), settled()]) : settled());
    await document.fonts.ready;
    // Entrances and transitions, not the endless loops or a clock's countdown.
    const short = () =>
      document.getAnimations().filter((a) => {
        const end = Number(a.effect?.getComputedTiming().endTime ?? Infinity);
        return a.playState === 'running' && end < 5000;
      });
    for (let round = 0; round < 10 && short().length > 0; round++) {
      await Promise.allSettled(short().map((a) => a.finished));
    }
    await frame();
    await frame();
    document.documentElement.dataset.ready = '';
  }
  $effect(() => {
    void ready();
  });
</script>

{#if inRoom}
  <Room id="preview" onleave={noop} preview={client as unknown as RoomClient} menu={which === 'menu' || which === 'leave'} />
{:else}
  <div class="page">
    <!-- Where the room's header sits (Room.svelte), so the table gets the same height. -->
    <header class="mock" aria-hidden="true">← 미리보기 · {which}</header>
    <Table client={client as unknown as RoomClient} />
  </div>
{/if}

<style>
  .page {
    /* As wide as the room page at the table (see Room.svelte). */
    max-width: max(1100px, calc((100dvh - 64px) * 1.7));
    margin: 0 auto;
    padding: 8px 16px 16px;
  }
  .mock {
    display: flex;
    align-items: center;
    height: 48px;
    margin-bottom: 8px;
    padding: 0 8px;
    font-size: 14px;
    color: var(--ink-muted);
  }
</style>
