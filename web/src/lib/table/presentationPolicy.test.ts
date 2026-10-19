import panelSource from './ActionPanel.svelte?raw';
import demoSource from './ContractDemo.svelte?raw';
import contractSource from './presentation.ts?raw';
import commandSource from './CommandButton.svelte?raw';
import bidSource from '../games/mighty/BidPanel.svelte?raw';
import exchangeSource from '../games/mighty/ExchangePanel.svelte?raw';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

/** Policy for the new contract surfaces; legacy game controls migrate separately. */
function visit(value: unknown, fn: (node: Record<string, unknown>) => void) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(child => visit(child, fn)); return; }
  const node = value as Record<string, unknown>;
  fn(node);
  Object.values(node).forEach(child => visit(child, fn));
}

describe('presentation component policy', () => {
  const surfaces = { 'ActionPanel.svelte':panelSource, 'ContractDemo.svelte':demoSource, 'CommandButton.svelte':commandSource, 'BidPanel.svelte':bidSource, 'ExchangePanel.svelte':exchangeSource };
  it.each(Object.entries(surfaces))('%s uses approved controls without private visual overrides', (_file, source) => {
    const ast = parse(source);
    const violations: string[] = [];
    visit(ast.html, node => {
      if (node.type === 'Element' && node.name === 'button') violations.push('raw button');
      if (node.type !== 'InlineComponent' || !['Button', 'Chip', 'ActionPanel', 'CommandButton'].includes(String(node.name))) return;
      for (const attribute of node.attributes as Record<string, unknown>[] ?? []) {
        if (attribute.name === 'style' || attribute.type === 'StyleDirective') violations.push(`${node.name} private inline style`);
      }
    });
    visit(ast.css, node => {
      if (node.type !== 'Rule') return;
      const prelude = node.prelude as { start: number; end: number };
      const selector = source.slice(prelude.start, prelude.end);
      if (!/(?:\bbutton\b|\binput\b|\.btn\b|\.chip\b|\.primary\b|\.command-button\b)/.test(selector)) return;
      visit(node.block, declaration => {
        if (declaration.type !== 'Declaration') return;
        if (/^(?:background|color|font|border|outline|box-shadow|opacity|transform|translate|scale)/.test(String(declaration.property)))
          violations.push(`${selector}: ${declaration.property}`);
      });
    });
    expect(violations).toEqual([]);
  });

  it('the shared contract has no renderer or game imports', () => {
    const source = contractSource;
    expect(source).not.toMatch(/\bfrom\s+['"][^'"]*(?:svelte|games\/|room\/|domMovement)/);
    expect(source).not.toMatch(/\b(?:document|window|HTMLElement|DOMRect)\b/);
  });

  it('shared card artwork does not depend on a game module or its wire types', () => {
    const sources = import.meta.glob<string>('../ui/cards/*.svelte', { eager: true, query: '?raw', import: 'default' });
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
    for (const source of Object.values(sources))
      expect(source).not.toMatch(/\bfrom\s+['"][^'"]*(?:games\/|generated\/protocol)/);
  });
});
