import { expect, test, type Page } from '@playwright/test';

// The empty/part-filled real table differs from the full preview lobby.
// Keep its hit targets and server-confirmed controls usable at every size.
test.beforeEach(async ({ page }, info) => {
  // The local server trusts its proxy header. Give workers separate test
  // clients so this interaction suite does not exhaust one IP's room quota.
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${info.workerIndex + 1}` });
  await page.addInitScript(() =>
    localStorage.setItem('mighty.settings', JSON.stringify({ sound: false, music: false, speed: 'off' })),
  );
});

async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
}

async function sit(page: Page) {
  await page.locator('.seat-act', { hasText: '앉기' }).first().click();
  await page.locator('.pop-card input').fill('키보드');
  await page.locator('.pop-card button[type=submit]').click();
  await expect(page.locator('.seat-act', { hasText: '+ 봇' })).toHaveCount(4);
}

test('a partly filled table leaves every add-bot control reachable', async ({ page }) => {
  await create(page);
  await sit(page);
  for (let i = 0; i < 4; i++) {
    // No force or offset: its center must really receive the tap.
    await page.locator('.seat-act', { hasText: '+ 봇' }).first().click();
    await expect(page.locator('.seat-act', { hasText: '+ 봇' })).toHaveCount(3 - i);
  }
  await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible();
});

test('keyboard seat entry focuses the name and Escape returns to its opener', async ({ page }) => {
  await create(page);
  const opener = page.locator('.seat-act', { hasText: '앉기' }).first();
  await opener.focus();
  await opener.press('Enter');
  await expect(page.locator('.pop-card input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pop-card')).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Continue without a mouse: reopen, type and submit to take the seat.
  await page.keyboard.press('Enter');
  await expect(page.locator('.pop-card input')).toBeFocused();
  await page.keyboard.type('키보드');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pop-card')).toHaveCount(0);
  await expect(page.locator('.seat-act', { hasText: '+ 봇' })).toHaveCount(4);
});

test('bot level arrows keep focus with the server-confirmed choice', async ({ page }) => {
  await create(page);
  await sit(page);
  await page.locator('.seat-act', { hasText: '+ 봇' }).first().click();
  const opener = page.locator('.spot').filter({ hasNot: page.locator('.seat-acts') }).locator('.seat-tap').first();
  await opener.focus();
  await opener.press('Enter');
  const group = page.getByRole('radiogroup');
  const hard = group.getByRole('radio', { name: '고수', exact: true });
  const easy = group.getByRole('radio', { name: '초보', exact: true });
  const normal = group.getByRole('radio', { name: '보통', exact: true });
  await expect(hard).toHaveAttribute('aria-checked', 'true');
  for (const radio of [hard, easy, normal]) {
    const box = await radio.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  await hard.focus();
  await page.keyboard.press('ArrowRight');
  await expect(easy).toBeFocused();
  await expect(easy).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(normal).toBeFocused();
  await expect(normal).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(easy).toBeFocused();
  await expect(easy).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('Escape');
  await expect(page.locator('.pop-card')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

for (const [width, height] of [[568, 320], [800, 360]]) {
  test(`a landscape table can fill, start and be watched at ${width}x${height}`, async ({ browser, page }, info) => {
    test.skip(info.project.name !== '390x844-light', 'explicit landscape sizes, one theme');
    await page.setViewportSize({ width, height });
    await create(page);
    await sit(page);
    // A separate browser storage context, so this watcher cannot reclaim
    // the player's seat through the token that browser keeps.
    const watcher = await browser.newPage({ viewport: { width, height } });
    await watcher.goto(page.url());

    for (let i = 0; i < 4; i++) {
      await page.locator('.seat-act', { hasText: '+ 봇' }).first().click();
      await expect(page.locator('.seat-act', { hasText: '+ 봇' })).toHaveCount(3 - i);
    }
    for (const button of await page.locator('.centre button').all()) {
      await button.click({ trial: true });
      const box = await button.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    }
    await page.getByRole('button', { name: '시작', exact: true }).click();
    await expect(page.locator('.hand .card')).toHaveCount(10);
    await expect(watcher.locator('.hand .card')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await watcher.close();
  });
}
