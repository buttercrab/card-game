import { expect, test } from '@playwright/test';

test('joker corner words fit their columns and card borders at every illustrated size', async ({ page }) => {
  await page.goto('/deck');
  await expect(page.locator('.joker-samples figure')).toHaveCount(64);
  await page.evaluate(() => document.fonts.ready);
  const problems = await page.locator('.joker-samples figure').evaluateAll(figures => {
    const out: string[] = [];
    for (const figure of figures) {
      const card = figure.querySelector('.card')!.getBoundingClientRect();
      for (const label of figure.querySelectorAll<HTMLElement>('.index-joker')) {
        const r = label.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const corner = label.closest('.corner')!.getBoundingClientRect();
        const id = `${figure.getAttribute('data-width')}px, two=${figure.getAttribute('data-two-jokers')}, ${label.closest('.corner')!.className}`;
        if (r.left < card.left + 1 || r.right > card.right - 1 || r.top < card.top + 1 || r.bottom > card.bottom - 1) out.push(`${id}: label crosses card border`);
        if (r.left < corner.left - 0.5 || r.right > corner.right + 0.5) out.push(`${id}: label wider than corner`);
      }
    }
    return out;
  });
  expect(problems).toEqual([]);
});


test('all unavailable suits use the same inactive ink on opaque card paper', async ({ page }) => {
  await page.goto('/deck');
  await expect(page.locator('.legality-samples .card')).toHaveCount(48);
  const cards = await page.locator('.legality-samples .card').evaluateAll(els => els.map(e => {
    const style = getComputedStyle(e);
    const rank = e.querySelector('.index-rank')!;
    const suit = e.querySelector('.index-suit')!;
    return { unavailable: e.classList.contains('unplayable'), color: style.color, rank: getComputedStyle(rank).color, suit: getComputedStyle(suit).color, opacity: style.opacity, background: style.backgroundColor };
  }));
  const unavailable = cards.filter(c => c.unavailable);
  expect(unavailable).toHaveLength(24);
  expect(new Set(unavailable.map(c => c.color)).size).toBe(1);
  for (let i = 0; i < cards.length; i += 2) {
    expect(cards[i + 1].color).not.toBe(cards[i].color);
    expect(cards[i + 1].rank).toBe(cards[i + 1].color);
    expect(cards[i + 1].suit).toBe(cards[i + 1].color);
    expect(cards[i + 1].opacity).toBe('1');
    expect(cards[i + 1].background).not.toContain('rgba');
  }
});
