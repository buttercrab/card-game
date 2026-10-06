// app.css and tokens.ts state the same colours: CSS for the page, script
// for canvases, SVG fills and swatches. Each is checked against the other.
import { describe, expect, it } from 'vitest';
import css from '../app.css?raw';
import { BACK_COLOR, FIXED, TABLE_TONE, THEME } from './tokens';

/** The value `name` is given in the block that `selector` starts. */
function declared(selector: string, name: string): string | null {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  const block = css.slice(at, css.indexOf('}', at));
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  return m ? m[1].trim().toLowerCase() : null;
}

/** The block that declares every token. */
const ROOT = ':root,\n[data-theme]';

const pair = (light: string, dark: string) => `light-dark(${light}, ${dark})`;

describe('tokens', () => {
  for (const [name, { light, dark }] of Object.entries(THEME)) {
    it(`--${name} follows the theme`, () => {
      expect(declared(ROOT, name)).toBe(pair(light, dark));
    });
  }
  for (const [name, value] of Object.entries(FIXED)) {
    it(`--${name} is the same in both themes`, () => {
      expect(declared(ROOT, name)).toBe(value);
    });
  }
  it('each card back has its ground', () => {
    expect(declared(ROOT, 'card-back')).toBe(BACK_COLOR.charcoal);
    for (const [id, colour] of Object.entries(BACK_COLOR)) {
      if (id === 'charcoal') continue;
      expect(css).toContain(`:root[data-back='${id}'] { --card-back: ${colour}; }`);
    }
  });
  it('each table colour has its table and panel', () => {
    for (const [id, tone] of Object.entries(TABLE_TONE)) {
      if (id === 'hanji') continue;
      expect(declared(`:root[data-table='${id}']`, 'table')).toBe(pair(tone.table.light, tone.table.dark));
      expect(declared(`:root[data-table='${id}']`, 'panel')).toBe(pair(tone.panel.light, tone.panel.dark));
    }
  });
  it('no colour is written twice', () => {
    const end = css.indexOf('}', css.indexOf(`${ROOT} {`));
    const root = css.slice(css.indexOf(`${ROOT} {`), end);
    const inRoot = [...root.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]);
    expect(inRoot.length).toBe(new Set(inRoot).size);
    // Outside :root only the earned looks set colours, and only these.
    const colours = [...css.slice(end).matchAll(/--([a-z0-9-]+):\s*(?:#|light-dark)/g)].map((m) => m[1]);
    expect(new Set(colours)).toEqual(new Set(['card-back', 'table', 'panel']));
  });
});
