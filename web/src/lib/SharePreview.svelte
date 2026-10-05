<script lang="ts">
  // /share: the session share card with made-up hands, to check its drawing.
  import { CATALOG, presetRules } from './catalog';
  import ShareCard from './ShareCard.svelte';
  import type { HandSummary, RoomView, Suit } from './types';

  const hand = (trump: Suit | null, count: number, made: boolean, rounds: number[], friend_revealed: number | null): HandSummary => ({
    contract: { trump, count },
    declarer: 0,
    friend: friend_revealed === null ? null : 1,
    made,
    team_points: rounds.filter((r) => r > 0).reduce((a, b) => a + b, 0),
    rounds,
    friend_revealed,
  });
  const hands = [
    hand('Spade', 14, true, [2, 1, 0, -2, 3, 0, 2, 1, -1, 3], 1),
    hand('Heart', 13, false, [0, -3, 2, -1, -2, 1, 0, -2, 3, -1], 4),
    hand(null, 15, true, [3, 2, 2, 0, 1, 3, -1, 2, 1, 3], null),
    hand('Diamond', 14, true, [-1, 2, 0, 3, 2, -2, 1, 2, 0, 3], 0),
    hand('Club', 16, false, [2, -2, -3, 1, 0, -1, 2, -3, -2, 1], 6),
    hand('Spade', 13, true, [1, 3, 2, 0, -1, 2, 2, 0, 1, 2], 2),
    hand('Heart', 14, true, [0, 2, 3, -1, 2, 1, 0, 2, 3, 1], 9),
    hand('Diamond', 15, false, [-2, 1, -3, 0, 2, -1, -2, 1, 0, 3], 3),
    hand('Club', 14, true, [3, 0, 2, 1, -1, 2, 3, 0, 1, 2], 5),
  ];
  const room: RoomView = {
    protocol: CATALOG.protocol,
    id: 'preview',
    game: 'mighty',
    settings: { preset: 'gshs', preset_rules: presetRules('gshs') },
    rules: presetRules('gshs'),
    customized: false,
    seats: [
      { kind: 'human', name: '재용', connected: true, away: false },
      { kind: 'bot', name: '콩떡', level: 'hard' },
      { kind: 'human', name: '아주긴이름의친구입니다', connected: true, away: false },
      { kind: 'human', name: '민수', connected: false, away: false },
      { kind: 'bot', name: '호두', level: 'hard' },
    ],
    scores: [18, -3, 5, -8, -12],
    hands_played: hands.length,
    history: hands.map(() => [0, 0, 0, 0, 0]),
    hands,
    in_hand: false,
    table: { turn_secs: 0, shuffle: false, shuffle_next: false },
    clock: null,
    watching: 0,
    showing: false,
  };
</script>

<ShareCard {room} onclose={() => {}} />
