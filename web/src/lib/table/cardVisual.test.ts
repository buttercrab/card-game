import { describe, expect, test } from 'vitest';
import { toStandardCard, type StandardCardDescriptor } from './cardVisual';

describe('descriptor to standard face bridge', () => {
  test('maps standard rank and suit glyphs to the shared card structure', () => {
    for (const [glyph, suit] of [['♠', 'Spade'], ['♥', 'Heart'], ['♦', 'Diamond'], ['♣', 'Club']]) {
      for (const [label, rank] of [['2', 2], ['10', 10], ['J', 11], ['Q', 12], ['K', 13], ['A', 14]]) {
        expect(toStandardCard({ face: 'up', rank: String(label), suit: glyph })).toEqual({ Normal: [suit, rank] });
      }
    }
  });

  test('explicit standard and joker faces take precedence over text metadata', () => {
    expect(toStandardCard({ face: 'up', rank: 'A', suit: '♠', visual: { kind: 'standard', rank: 7, suit: 'Club' } })).toEqual({ Normal: ['Club', 7] });
    for (const color of ['Red', 'Black'] as const) {
      expect(toStandardCard({ face: 'up', visual: { kind: 'joker', color } })).toEqual({ Joker: color });
    }
  });

  test('hidden and unknown faces return before reading private rank, suit, visual, or asset metadata', () => {
    for (const face of ['down', 'custom']) {
      const descriptor = {
        face,
        get rank(): string { throw Error('private rank read'); },
        get suit(): string { throw Error('private suit read'); },
        get visual(): never { throw Error('private visual read'); },
        get artKey(): string { throw Error('private asset read'); },
      };
      expect(toStandardCard(descriptor as StandardCardDescriptor)).toBeNull();
    }
  });

  test('asset keys are opaque and never inspected to manufacture joker or standard faces', () => {
    const descriptor = {
      face: 'up' as const,
      get artKey(): string { throw Error('asset key parsed'); },
    };
    expect(toStandardCard(descriptor)).toBeNull();
    for (const artKey of ['{"Joker":"Red"}', '{"Normal":["Spade",14]}', './Card.svelte']) {
      expect(toStandardCard({ face: 'up', artKey } as StandardCardDescriptor)).toBeNull();
    }
  });

  test('unrecognized faces retain the renderer custom fallback instead of guessing', () => {
    for (const rank of ['1', '14', '01', 'j', 'Ace', 'Dragon', '', 'constructor', '__proto__']) {
      expect(toStandardCard({ face: 'up', rank, suit: '♠' })).toBeNull();
    }
    for (const suit of ['Spade', 'Stars', '❤️', '', 'constructor', '__proto__']) {
      expect(toStandardCard({ face: 'up', rank: 'A', suit })).toBeNull();
    }
  });

  test('invalid explicit visual data cannot fall back to otherwise recognizable text', () => {
    const invalid = [
      null, { kind: 'standard', rank: 1, suit: 'Spade' }, { kind: 'standard', rank: 15, suit: 'Spade' },
      { kind: 'standard', rank: 2.5, suit: 'Spade' }, { kind: 'standard', rank: NaN, suit: 'Spade' },
      { kind: 'standard', rank: 14, suit: 'Stars' }, { kind: 'joker', color: 'Blue' },
      { kind: 'custom', name: 'Dragon' },
    ];
    for (const visual of invalid) {
      expect(toStandardCard({ face: 'up', rank: 'A', suit: '♠', visual } as StandardCardDescriptor)).toBeNull();
    }
  });
});
