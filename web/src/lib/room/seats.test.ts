import { describe, expect, it } from 'vitest';
import type { SeatInfo } from './types';
import { moveNames, rememberNames, Ring, seatLabel, seatName } from './seats';

describe('Ring', () => {
  const ring = new Ring(5, 2);
  it('counts places round from your seat', () => {
    expect(ring.seatAt(0)).toBe(2);
    expect(ring.seatAt(3)).toBe(0);
    expect(ring.relative(0)).toBe(3);
    expect(ring.relative(2)).toBe(0);
  });
  it('draws everyone but you round the felt; a watcher sees all five', () => {
    expect(ring.around(true)).toEqual([1, 2, 3, 4]);
    expect(ring.around(false)).toEqual([0, 1, 2, 3, 4]);
  });
  it('lands five players’ cards in mirror-image bands', () => {
    expect(ring.slot(1)).toEqual([1.15, 0.05]);
    expect(ring.slot(4)).toEqual([-1.15, 0.05]);
    const [x, y] = new Ring(4, 0).slot(1);
    // Four players: the next seat sits straight to the right.
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
  });
  it('looks at whoever is to play, and at the middle on its own turn', () => {
    const r = new Ring(5, 0);
    expect(r.lookAt(1, 1, false, false)).toEqual({ x: -r.direction(1).x, y: -r.direction(1).y });
    expect(r.lookAt(1, null, false, false)).toBeNull();
    // On your turn everyone looks at you, at the bottom.
    const atYou = r.lookAt(2, 0, true, false)!;
    expect(atYou.y).toBeGreaterThan(0);
  });
});

describe('seat names', () => {
  const seats: SeatInfo[] = [
    { kind: 'human', name: '재용', connected: true, away: false },
    { kind: 'bot', name: '콩떡', level: 'hard' },
    { kind: 'empty' },
  ];
  it('names you 나, others as they sit, an empty seat by number', () => {
    expect(seatName(0, 0, seats, [], true)).toBe('나');
    expect(seatName(1, 0, seats, [], true)).toBe('콩떡');
    expect(seatName(2, 0, seats, [], false)).toBe('3번 자리');
  });
  it('keeps a leaver’s name while their hand is on the table', () => {
    const known = rememberNames([null, null, '민수'], seats);
    expect(known).toEqual(['재용', '콩떡', '민수']);
    expect(seatName(2, 0, seats, known, true)).toBe('민수');
    expect(seatName(2, 0, seats, known, false)).toBe('3번 자리');
  });
  it('moves names with their seats', () => {
    expect(moveNames(['a', 'b', 'c'], [2, 0, 1])).toEqual(['b', 'c', 'a']);
  });
  it('labels seats for their menu buttons', () => {
    expect(seatLabel(0, 0, seats[0])).toBe('내 자리');
    expect(seatLabel(1, 0, seats[1])).toBe('콩떡');
    expect(seatLabel(2, 0, seats[2])).toBe('3번 자리');
  });
});
