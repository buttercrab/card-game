import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'no-preference' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false, haptics: false })));
});

test('a turn arriving retains normal card travel duration', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one normal-motion timing case');
  await page.clock.install();
  // Freeze before mounting scripted previews; only runFor advances deadlines.
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.goto('/preview?state=arrival&room');
  await expect(page.locator('.slot')).toHaveCount(3);
  await page.clock.runFor(1000);
  const card = page.locator('.slot[data-slot="4"] .card');
  await card.waitFor();
  const durations = await card.evaluate(e => e.getAnimations().map(a => Number(a.effect!.getComputedTiming().duration)));
  expect(durations).toContain(320);
  await expect(page.locator('.tray')).toHaveClass(/mine/);
});

test('collection credit waits for the cards and uses the player feedback slot', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one normal-motion timeline case');
  await page.goto('/preview?state=sweep&room');
  const winningCard = page.locator('.slot[data-slot="2"] .won');
  await winningCard.waitFor();
  const credit = page.locator('.spot[data-seat="2"] .feedback').getByText('+2점', { exact: true });
  await expect(credit).toHaveCount(0);
  await expect(page.locator('.spot .turn')).toHaveCount(0);
  await expect(credit).toBeVisible({ timeout: 6000 });
  await expect(page.locator('.slot .won')).toHaveCount(0);
  await expect(page.locator('.spot[data-seat="2"] .turn')).toBeVisible();
});


test('a reconnect does not announce historical points as a new collection', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one reconnect timeline case');
  await page.clock.install();
  // Freeze before mounting scripted previews; only runFor advances deadlines.
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.goto('/preview?state=resume&room');
  await expect(page.locator('.seat .feedback').getByText(/^\+\d+점$/)).toHaveCount(0);
  await page.clock.runFor(1100);
  expect(await page.locator('.seat .feedback').getByText(/^\+\d+점$/).count()).toBe(0);
});
