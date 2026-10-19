import { expect, test, type Page } from '@playwright/test';

async function anchors(page: Page) {
  return page.locator('.ring > .spot').evaluateAll(spots => spots.map(spot => {
    const rect = spot.querySelector('.stand')!.getBoundingClientRect();
    return { seat: spot.getAttribute('data-seat'), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
}

function expectStable(before: Awaited<ReturnType<typeof anchors>>, after: Awaited<ReturnType<typeof anchors>>) {
  expect(after.map(s => s.seat)).toEqual(before.map(s => s.seat));
  for (let i = 0; i < before.length; i++) {
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(before[i][key] - after[i][key])).toBeLessThanOrEqual(1);
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('name', JSON.stringify('나'));
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false }));
  });
});

test('opponent anchors stay fixed when the live turn reaches the human', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.goto('/preview?state=arrival&room');
  await expect(page.locator('.ring > .spot')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  // The test clock pauses RAF too. Flush initial measured layout before the
  // baseline pose; the scripted turn remains 1000ms away.
  let previous: Awaited<ReturnType<typeof anchors>> | null=null;
  let stableFrames=0;
  for (let frames = 0; frames < 16 && stableFrames<2; frames++) {
    await page.clock.runFor(16);
    const next=await anchors(page);
    stableFrames=previous&&JSON.stringify(previous)===JSON.stringify(next)?stableFrames+1:0;
    previous=next;
  }
  expect(stableFrames).toBe(2);
  await expect(page.locator('.felt')).toBeVisible();
  const before = await anchors(page);
  await page.clock.runFor(1200);
  await expect(page.locator('.hand button.card:not(.unplayable)').first()).toBeEnabled();
  expectStable(before, await anchors(page));
});

test('decision and between-hand flags do not relocate opponents or change their scale', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one focused set of compact and desktop geometries');
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 568, height: 320 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/preview?state=play&room');
    await page.locator('html[data-ready]').waitFor();
    const before = await anchors(page);
    // Exercise the geometry flags in isolation from Table sizing and server
    // state, so a turn cannot silently switch to a different anchor system.
    for (const flag of ['controls-out', 'between']) {
      await page.locator('.ring').evaluate((ring, cls) => ring.classList.add(cls), flag);
      expectStable(before, await anchors(page));
      await page.locator('.ring').evaluate((ring, cls) => ring.classList.remove(cls), flag);
      expectStable(before, await anchors(page));
    }
    await expect(page.locator('.seat .ready-label')).toHaveCount(0);
  }
});
