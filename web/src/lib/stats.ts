// A record of the hands this browser has played, kept in local storage.
// There are no accounts, so stats belong to the device.

import type { Contract } from './types';

export type Role = 'declarer' | 'friend' | 'defense';

export interface HandRecord {
  /** Room id and hand number, so a hand is counted once. */
  key: string;
  at: number;
  role: Role;
  won: boolean;
  payoff: number;
  contract: Contract;
  teamPoints: number;
}

const KEY = 'mighty.stats';
const LIMIT = 1000;

export function loadStats(): HandRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function recordHand(hand: HandRecord) {
  const all = loadStats();
  if (all.some((h) => h.key === hand.key)) return;
  all.push(hand);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(-LIMIT)));
  } catch {
    // Storage full or refused: this hand goes unrecorded.
  }
}

export function clearStats() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
