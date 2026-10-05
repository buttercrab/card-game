import { expect, test, type Page } from '@playwright/test';

// Behaviour that once broke (docs/REFACTOR.md, Phase 0), at one size.
test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith('390x844'), 'one size is enough');
});

/** Quiet, and at the given animation speed. */
async function speed(page: Page, value: 'normal' | 'off') {
  await page.addInitScript((speed) => {
    try {
      localStorage.setItem('mighty.settings', JSON.stringify({ sound: false, music: false, speed }));
    } catch {
      // Storage off: the defaults play.
    }
  }, value);
}

/** How much of the turn ring has emptied, 0 to 1. */
function ringEmptied(page: Page) {
  return page.locator('.turn-ring .left').evaluate((el) => {
    const c = 2 * Math.PI * 46;
    return parseFloat(getComputedStyle(el).strokeDashoffset) / c;
  });
}

/** How much of the first bid's hold bar has filled, 0 to 1. */
function holdFilled(page: Page) {
  return page.locator('.bid .primary .hold').evaluate((el) => {
    const m = /scaleX\(([\d.e-]+)\)/.exec((el as HTMLElement).style.transform);
    return m ? Number(m[1]) : NaN;
  });
}

// Timers tell the time whatever the motion settings: a CSS animation
// drew them, which reduced motion cut to 1 ms and 끄기 turned off.
test.describe('timers under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  for (const value of ['normal', 'off'] as const) {
    test(`the turn ring empties with the clock (speed ${value})`, async ({ page }) => {
      await speed(page, value);
      // Seat 3's turn, 13 of 20 seconds left when the page loads.
      await page.goto('/preview?state=timer');
      await page.locator('.turn-ring .left').waitFor();
      const first = await ringEmptied(page);
      expect(first).toBeGreaterThan(0.3);
      expect(first).toBeLessThan(0.6);
      await page.waitForTimeout(1000);
      const second = await ringEmptied(page);
      // About 1 s of 20 more: 0.05.
      expect(second - first).toBeGreaterThan(0.03);
      expect(second - first).toBeLessThan(0.15);
    });

    test(`the first bid's hold bar fills with the wait (speed ${value})`, async ({ page }) => {
      await speed(page, value);
      // The first bid held back 2 s after the deal.
      await page.goto('/preview?state=grace');
      const button = page.locator('.bid .primary');
      // Attached: the bar starts at no width at all.
      await page.locator('.bid .primary .hold').waitFor({ state: 'attached' });
      await expect(button).toBeDisabled();
      const first = await holdFilled(page);
      await page.waitForTimeout(400);
      const second = await holdFilled(page);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBeGreaterThan(first);
      expect(second).toBeLessThan(1);
      await expect(button).toBeEnabled({ timeout: 3000 });
      await expect(page.locator('.bid .primary .hold')).toHaveCount(0);
    });
  }
});

// Leaving a table while its link is down: the seat is forgotten and the
// client stops, so it never comes back to reclaim the seat.
test('leaving while reconnecting does not take the seat back', async ({ page }) => {
  test.setTimeout(40_000);
  await speed(page, 'off');
  let down = false;
  let attempts = 0;
  const open: { close: () => Promise<void> }[] = [];
  await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
    attempts++;
    if (down) {
      // The server is away (a deploy): the socket drops at once.
      void ws.close();
      return;
    }
    ws.connectToServer();
    open.push(ws);
  });

  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  await page.locator('.seat-act', { hasText: '앉기' }).first().click();
  await page.locator('.pop-card input').fill('나');
  await page.locator('.pop-card button[type=submit]').click();
  await expect(page.locator('.seat-act', { hasText: '+ 봇' }).first()).toBeVisible();
  expect(await page.evaluate((id) => localStorage.getItem(`room:${id}`), id)).toContain('token');

  // The link drops, and stays down for a reconnect or two.
  down = true;
  for (const ws of open.splice(0)) await ws.close();
  await expect(page.getByText('잠깐 다시 연결하는 중…')).toBeVisible();
  await expect.poll(() => attempts, { timeout: 5000 }).toBeGreaterThanOrEqual(2);

  await page.locator('.menu-btn').click();
  await page.locator('dialog .leave').click();
  await page.waitForURL((url) => url.pathname === '/');
  expect(await page.evaluate((id) => localStorage.getItem(`room:${id}`), id)).toBeNull();

  // The server is back: nothing of the old table reconnects.
  down = false;
  const after = attempts;
  await page.waitForTimeout(9000);
  expect(attempts).toBe(after);
  expect(await page.evaluate((id) => localStorage.getItem(`room:${id}`), id)).toBeNull();
});

// A table plays by the preset's rules as they were when it was made; the
// rulebook at the table shows those, not the preset as it reads today.
test("the table's rulebook shows the rules the table pinned", async ({ page }) => {
  await speed(page, 'off');
  const today = await (await page.request.get('/api/presets/default')).json();
  const min = today.bidding.min as number;
  // The preset changes after the table was made (a deploy between).
  await page.route(/\/api\/presets\/[a-z]+$/, async (route) => {
    const rules = await (await route.fetch()).json();
    rules.bidding.min = min + 2;
    await route.fulfill({ json: rules });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.locator('.rules-chip').first().click();
  const book = page.locator('dialog[open] .book');
  await expect(book.locator('.facts')).toContainText(`공약 ${min}–`);
  await expect(book.locator('h1 .changed')).toHaveCount(0);
  // Nothing changed at this table: the chip names the preset alone.
  await expect(page.locator('.rules-chip').first()).not.toContainText('바꾼');
});
