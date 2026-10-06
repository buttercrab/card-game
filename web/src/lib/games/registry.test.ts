// The game boundary: the registry finds each game by the id the server
// sends, and the room (room/) knows no game. A room file that imports a
// game, or names one of Mighty's types, fails here.
import { describe, expect, it } from 'vitest';
import { GAMES, gameFor, MAIN_GAME, TOOLS } from './registry';

describe('the registry', () => {
  it('finds Mighty by the id the server sends', () => {
    const mighty = gameFor('mighty');
    expect(mighty).not.toBeNull();
    expect(mighty?.id).toBe('mighty');
    expect(mighty?.name).toBe('마이티');
    expect(mighty?.Table).toBeTypeOf('function');
    expect(mighty?.RulesSheet).toBeTypeOf('function');
    expect(MAIN_GAME).toBe(mighty);
  });

  it('has nothing for a game this build does not know', () => {
    expect(gameFor('poker')).toBeNull();
    expect(gameFor('constructor')).toBeNull();
    expect(gameFor('')).toBeNull();
  });

  it("words Mighty's own refusals: which rule check failed", () => {
    expect(MAIN_GAME.refusal?.({ code: 'invalid_rules', rule: 'empty_bid_range' })).toBe('최소 공약이 최대 공약보다 클 수 없어요');
    expect(MAIN_GAME.refusal?.({ code: 'table_full' })).toBeNull();
  });

  it("names Mighty's presets, and only those", () => {
    expect(MAIN_GAME.presetTitle('default')).toBe('기본');
    expect(MAIN_GAME.presetTitle('nope')).toBeNull();
  });

  it('keeps every game under its own id, and the tool pages at their paths', () => {
    for (const [id, game] of Object.entries(GAMES)) expect(game.id).toBe(id);
    expect(Object.keys(TOOLS).sort()).toEqual(['/deck', '/preview', '/share']);
  });
});

/** Every file of the room, as text. */
const ROOM: Record<string, string> = import.meta.glob(['../room/**/*.ts', '../room/**/*.svelte', '!../room/**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Mighty's own types, which the room carries only as type parameters. */
const MIGHTY_TYPES = [
  'Action',
  'Card',
  'Contract',
  'HandSummary',
  'MightyNotes',
  'MightySettings',
  'PhaseView',
  'Preset',
  'PresetInfo',
  'Rules',
  'StateMsg',
  'RoomMsg',
  'SessionMsg',
  'View',
];

/** The code without its comments, so a comment may still say "Mighty". */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the room', () => {
  it('is all there to check', () => {
    expect(Object.keys(ROOM).length).toBeGreaterThan(10);
  });

  for (const [path, text] of Object.entries(ROOM)) {
    const imports = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

    it(`${path} imports no game`, () => {
      for (const spec of imports) {
        expect(spec, `${path} imports ${spec}`).not.toMatch(/(^|\/)games(\/|$)|mighty/i);
      }
    });

    it(`${path} names none of Mighty's types`, () => {
      const body = code(text);
      // The generated messages are read only through room/types.ts, which
      // makes each game's parts type parameters.
      const allowed = path.endsWith('/types.ts') ? ['StateMsg', 'RoomMsg', 'SessionMsg'] : [];
      for (const name of MIGHTY_TYPES) {
        if (allowed.includes(name)) continue;
        expect(body, `${path} names ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    });
  }
});
