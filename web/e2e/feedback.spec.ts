import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false }));
    const actions: unknown[] = [];
    (window as unknown as { previewActions: unknown[] }).previewActions = actions;
    addEventListener('preview-action', e => actions.push((e as CustomEvent).detail));
  });
});

test('a single card is centered on the tray regardless of tool width', async ({ page }) => {
  await page.goto('/preview?state=onecard&room');
  await page.locator('html[data-ready]').waitFor();
  await expect(page.locator('.hand .card')).toHaveCount(1);
  const card = await page.locator('.hand .card').boundingBox();
  const tray = await page.locator('.tray').boundingBox();
  expect(Math.abs(card!.x + card!.width / 2 - tray!.x - tray!.width / 2)).toBeLessThan(1);
});

test('reactions share identity docks; R and arrows send a reaction without opening another layer', async ({ page }) => {
  await page.goto('/preview?state=play&room');
  await page.locator('html[data-ready]').waitFor();
  await page.keyboard.press('r');
  await expect(page.getByRole('menuitem')).toHaveCount(24);
  await expect(page.getByRole('menuitem', { name: '👏', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tray .reaction:visible')).toHaveText('😂');
  await page.keyboard.press('r');
  await page.getByRole('menuitem', { name: '고마워요', exact: true }).click();
  await expect(page.locator('.tray .reaction:visible')).toHaveText('고마워요');
  const undocked = await page.locator('.reaction').evaluateAll(els => els.filter(e => !e.closest('.feedback')).length);
  expect(undocked).toBe(0);
  await page.locator('.settings-btn').click();
  await page.keyboard.press('r');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await page.keyboard.press('h');
  await expect(page.locator('.hint')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('h');
  await expect(page.locator('.hint')).toBeVisible();
});

test('invalid card feedback uses the room toast rail and leaves the hand clear', async ({ page }) => {
  await page.goto('/preview?state=play&room');
  await page.locator('html[data-ready]').waitFor();
  await page.locator('.hand button.unplayable').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.feedback-rail .toast')).toBeVisible();
  await expect(page.locator('.strip .refusal')).toHaveCount(0);
  const toast = await page.locator('.toast').boundingBox();
  const rail = await page.locator('.feedback-rail').boundingBox();
  expect(toast!.y + toast!.height).toBeLessThanOrEqual(rail!.y + rail!.height + 1);
});

test('a newly appearing bid cannot accept a carry-over click', async ({ page }) => {
  await page.clock.install();
  // Freeze before mounting scripted previews; only runFor advances deadlines.
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.goto('/preview?state=bidding&room');
  const bid = page.locator('.bid .primary');
  await bid.waitFor();
  await expect(bid).toBeDisabled();
  const rect = await bid.boundingBox();
  await page.mouse.click(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  expect(await page.evaluate(() => (window as unknown as { previewActions: unknown[] }).previewActions.length)).toBe(0);
  await page.clock.runFor(400);
  await expect(bid).toBeEnabled();
  await bid.click();
  expect(await page.evaluate(() => (window as unknown as { previewActions: unknown[] }).previewActions.length)).toBe(1);
});


test('Deal Miss transitioning into bidding rejects the old gesture', async ({ page }) => {
  await page.clock.install();
  // Freeze before mounting scripted previews; only runFor advances deadlines.
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.goto('/preview?state=misdealtransition&room');
  const miss = page.getByRole('button', { name: '딜미스', exact: true });
  await miss.waitFor();
  const box = await miss.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.clock.runFor(1000);
  await page.mouse.up();
  const bid = page.locator('.bid .primary');
  await expect(bid).toBeDisabled();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  expect(await page.evaluate(() => (window as unknown as { previewActions: unknown[] }).previewActions.length)).toBe(0);
  await page.clock.runFor(400);
  await expect(bid).toBeEnabled();
});

test('short landscape keeps feedback and played cards outside the hand', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'explicit short layout');
  await page.setViewportSize({ width: 568, height: 320 });
  for (const state of ['play', 'feedbackstress', 'bidding', 'exchange', 'contract']) {
    await page.goto(`/preview?state=${state}&room`);
    await page.locator('html[data-ready]').waitFor();
    const overlaps = await page.evaluate(() => {
      const tray = document.querySelector('.tray')!.getBoundingClientRect();
      return [...document.querySelectorAll('.spot .name, .spot .reaction, .slot')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.bottom > tray.top && r.top < tray.bottom && r.right > tray.left && r.left < tray.right;
      }).map(e => e.textContent);
    });
    expect(overlaps).toEqual([]);
  }
});
