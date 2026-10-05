import { expect, test, type Page } from '@playwright/test';

// A hand on the real server, as a player plays it: make a table, sit, fill
// the other seats with bots, play a card, reload, and find the seat and
// the hand still there. On the second server of playwright.config.ts, whose
// bots move at once.
const port = Number(process.env.PORT ?? 4317);
test.use({ baseURL: `http://127.0.0.1:${port + 1}` });

const hand = (page: Page) => page.locator('.hand .card');
const playable = (page: Page) => page.locator('.hand .card:not(.unplayable)');

/** Passes every bid and plays the first card it may, until it has played
 * one card more than `before` showed in hand; the bots do the rest. */
async function playACard(page: Page, before: number) {
  const pass = page.getByRole('button', { name: '패스', exact: true });
  await expect(async () => {
    if ((await hand(page).count()) < before) return;
    if (await pass.isEnabled({ timeout: 100 }).catch(() => false)) await pass.click({ timeout: 1000 });
    // The next card in the fan covers all but a card's left edge.
    else if ((await playable(page).count()) > 0) await playable(page).first().click({ position: { x: 8, y: 24 }, timeout: 1000 });
    expect(await hand(page).count()).toBeLessThan(before);
  }).toPass({ timeout: 30_000, intervals: [100] });
}

test('a hand goes on after a reload, in the same seat', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one size is enough');
  test.setTimeout(90_000);
  // Quiet, still, and a single tap plays a card.
  await page.addInitScript(() =>
    localStorage.setItem('mighty.settings', JSON.stringify({ sound: false, music: false, speed: 'off', singleTap: true })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const table = page.url();
  await page.locator('.seat-act', { hasText: '앉기' }).first().click();
  await page.locator('.pop-card input').fill('나');
  await page.locator('.pop-card button[type=submit]').click();
  for (let i = 0; i < 4; i++) {
    await page.locator('.seat-act', { hasText: '+ 봇' }).first().click();
    await expect(page.locator('.seat-act', { hasText: '+ 봇' })).toHaveCount(3 - i);
  }
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(hand(page)).toHaveCount(10);

  await playACard(page, 10);
  const left = await hand(page).count();
  expect(left).toBe(9);

  // Back after a reload: the same seat, by its token, and the same cards
  // (a watcher would see none).
  const cards = await hand(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));
  await page.reload();
  expect(page.url()).toBe(table);
  await expect(hand(page)).toHaveCount(9);
  expect(await hand(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).toEqual(cards);
  await expect(page.locator('.seat .name').filter({ hasText: /^나$/ })).toHaveCount(1);

  // And the hand goes on: the bots play round to this seat again.
  await playACard(page, 9);
  await expect(hand(page)).toHaveCount(8);
});
