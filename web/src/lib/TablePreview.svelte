<script lang="ts">
  // The real table with made-up data, for checking layout at any size:
  // /preview?state=bidding | waiting | misdeal | exchange | friend | secret | nofriend | play | watch | late | sweep | done | won | run
  // (waiting and watch are the bidding and the play on someone else's turn).
  import Table from './Table.svelte';
  import type { RoomClient } from './client.svelte';
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
      bids: key === 'bidding' ? bids.slice(0, 3) : bids,
    },
    legal: legal[key] ?? [],
    turn,
  });
  const room: RoomMsg = {
    type: 'room',
    id: 'preview',
    game: 'mighty',
    settings: { preset: 'gshs' },
    seats: [
      { kind: 'human', name: '재용', connected: true },
      { kind: 'bot', name: 'Bot 2' },
      { kind: 'human', name: '아주긴이름의친구입니다', connected: true },
      { kind: 'human', name: '민수', connected: false },
      { kind: 'bot', name: 'Bot 5' },
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

  const alias: Record<string, string> = { sweep: 'play', misdeal: 'bidding', waiting: 'bidding' };
  const key = alias[which] ?? which;
  const turn: StateMsg['turn'] =
    key === 'done' || key === 'won' || key === 'run' ? 'Over' : which === 'waiting' ? { Seat: 4 } : which === 'watch' ? { Seat: 3 } : { Seat: 0 };
  const client = $state({
    room,
    // The exchange opens on the bidding, so the table sees which cards came from the kitty.
    game: key === 'exchange' ? msg(phases.bidding, 'bidding', { Seat: 0 }) : msg(phases[key] ?? phases.play, key, turn),
    seat: 0,
    error: null,
    act: () => {},
    start: () => {},
    react: () => {},
    notice: () => {},
    reactions: { 2: { text: '나이스', id: 1 }, 4: { text: '👏', id: 2 } },
  });

  if (which === 'misdeal') {
    // A new deal arrives after seat 3 threw in a weak hand.
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    setTimeout(() => {
      const next = msg(phases.bidding, 'bidding', { Seat: 0 });
      next.view.redealt = {
        why: { Misdeal: { seat: 3, hand: [n('Spade', 2), n('Spade', 3), n('Diamond', 4), n('Diamond', 5), n('Heart', 2), n('Heart', 6), n('Heart', 7), n('Club', 3), n('Club', 5), n('Club', 8)] } },
        count: 1,
      };
      client.game = next;
    }, 300);
  }

  if (which === 'exchange') {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    setTimeout(() => (client.game = msg(phases.exchange, 'exchange', { Seat: 0 })), 300);
  }

  if (which === 'sweep') {
    // Finish the trick so the table plays its sweep, holding the note on screen.
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    setTimeout(() => {
      const done = [...trickPlays, { seat: 0, card: n('Club', 11), powered: true }];
      client.game = msg(playPhase([], [{ plays: done, lead: { Suit: 'Club' }, winner: 2 }]), 'play', { Seat: 2 });
    }, 300);
  }
</script>

<div class="page">
  <!-- Where the room's header sits (Room.svelte), so the table gets the same height. -->
  <header class="mock" aria-hidden="true">← 미리보기 · {which}</header>
  <Table client={client as unknown as RoomClient} />
</div>

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
