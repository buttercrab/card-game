// Suits in running text, for any game played with a standard deck.
import type { Suit } from './generated/protocol';

const GLYPH: Record<string, Suit> = { '♠': 'Spade', '♦': 'Diamond', '♥': 'Heart', '♣': 'Club' };

/** A label in runs of words and suits: the labels here write a suit as its
 * glyph (♠A, ♥ 15), and the page draws each one (SuitText.svelte). */
export function suitRuns(text: string): ({ text: string } | { suit: Suit })[] {
  const out: ({ text: string } | { suit: Suit })[] = [];
  for (const part of text.split(/([♠♦♥♣])/u)) {
    if (!part) continue;
    const suit = GLYPH[part];
    out.push(suit ? { suit } : { text: part });
  }
  return out;
}
