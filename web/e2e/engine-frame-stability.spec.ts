import { expect, test } from '@playwright/test';

test('nested sidebar geometry reaches its destination before a visible frame', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one desktop convergence trace');
  await page.addInitScript(() => {
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false }));
    const trace: { width: number; boxes: number[][] }[] = [];
    (window as any).__layoutTrace = trace;
    const sample = () => requestAnimationFrame(() => setTimeout(() => {
      if (document.querySelector('html[data-ready]') && document.fonts.status === 'loaded') {
        const elements = ['.side .board', '.side .scores', '.me-seat .identity'].map(selector => document.querySelector(selector));
        if (elements.every(element => element?.checkVisibility({ checkVisibilityCSS: true }))) {
          trace.push({ width: innerWidth, boxes: elements.map(element => {
            const box = element!.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height].map(value => Math.round(value * 100) / 100);
          }) });
        }
      }
      sample();
    }, 0));
    sample();
  });
  await page.goto('/preview?state=play&room');
  await expect(page.locator('.side .scores')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const assertStable = async (width: number) => {
    const frames = await page.evaluate(width => (window as any).__layoutTrace.filter((frame: { width: number }) => frame.width === width), width);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(new Set(frames.map((frame: { boxes: number[][] }) => JSON.stringify(frame.boxes))).size, JSON.stringify(frames)).toBe(1);
  };
  await assertStable(1440);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.side')).toBeHidden();
  await page.waitForTimeout(100);
  await page.evaluate(() => { (window as any).__layoutTrace.length = 0; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.side .scores')).toBeVisible();
  await page.waitForTimeout(400);
  await assertStable(1440);
});
