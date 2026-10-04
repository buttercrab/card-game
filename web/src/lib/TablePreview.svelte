<script lang="ts">
  // The real table with made-up data, for checking layout at any size:
  // /preview?state=bidding | misdeal | exchange | play | sweep | done | won | run
  import Table from './Table.svelte';
  import type { RoomClient } from './client.svelte';
  import type { Card, PhaseView, Played, RoomMsg, Rules, StateMsg } from './types';

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
  const contract = { trump: 'Spade' as const, count: 15 };
  const trickPlays: Played[] = [
    { seat: 1, card: n('Club', 3), powered: true },
    { seat: 2, card: n('Club', 13), powered: true },
    { seat: 3, card: n('Club', 9), powered: true },
    { seat: 4, card: n('Heart', 6), powered: true },
  ];
  const playPhase = (plays: Played[], tricks: { plays: Played[]; lead: { Suit: 'Club' }; winner: number }[]): PhaseView => ({
    Play: {
      declarer: 2,
      contract,
      call: { Card: { Joker: 'Black' } },
      friend: null,
      trick_no: tricks.length,
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
  const phases: Record<string, PhaseView> = {
    bidding: { Bidding: { to_act: 0, best: [2, { trump: 'Heart', count: 15 }], passed: [false, true, false, true, false], has_bid: [false, false, true, false, false] } },
    exchange: { Exchange: { declarer: 0, contract, trump_changed: false, discards: [] } },
    play: playPhase(trickPlays, []),
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
    exchange: hand.map((card) => ({ Discard: card })),
    play: hand.slice(1, 5).map((card) => ({ Play: { card, joker_lead: null, call_joker: false } })),
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
      hand: key === 'exchange' ? [...hand, n('Club', 2), n('Heart', 5), n('Diamond', 4), n('Spade', 6)] : hand,
      hand_sizes: [10, 10, 10, 10, 10],
      points_taken: [[], [n('Heart', 10)], [n('Spade', 13), n('Club', 12)], [], [n('Diamond', 14)]],
      phase,
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

  const key = which === 'sweep' ? 'play' : which === 'misdeal' ? 'bidding' : which;
  const client = $state({
    room,
    game: msg(phases[key] ?? phases.play, key, key === 'done' || key === 'won' || key === 'run' ? 'Over' : { Seat: 0 }),
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
  <Table client={client as unknown as RoomClient} />
</div>

<style>
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 64px 16px 16px;
  }
</style>
