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
  expect(durations).toContain(220);
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


test('normal winner feedback remains readable and reaches collection credit within 1500ms', async ({page},info) => {
  test.skip(info.project.name !== '390x844-light','one actual normal-motion collection timeline');
  await page.addInitScript(() => {
    const timing={winnerAt:0,creditAt:0,cardsAtWinner:0,winnerAtCredit:false};
    (window as unknown as {trickTiming:typeof timing}).trickTiming=timing;
    const observer=new MutationObserver(() => {
      const winner=document.querySelector('.slot .won');
      if(winner && !timing.winnerAt) {timing.winnerAt=performance.now();timing.cardsAtWinner=document.querySelectorAll('.slot').length;}
      const feedback=document.querySelector('.spot[data-seat="2"] .feedback');
      if(feedback?.textContent?.includes('+2점') && !timing.creditAt) {timing.creditAt=performance.now();timing.winnerAtCredit=!!winner;}
    });
    observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
  });
  await page.goto('/preview?state=sweep&room');
  await expect(page.locator('.spot[data-seat="2"] .feedback').getByText('+2점',{exact:true})).toBeVisible();
  const timing=await page.evaluate(() => (window as unknown as {trickTiming:{winnerAt:number;creditAt:number;cardsAtWinner:number;winnerAtCredit:boolean}}).trickTiming);
  expect(timing.winnerAt).toBeGreaterThan(0);
  expect(timing.cardsAtWinner).toBe(5);
  expect(timing.winnerAtCredit).toBe(false);
  const elapsed=timing.creditAt-timing.winnerAt;
  await test.info().attach('normal-collection-timing',{body:JSON.stringify({...timing,elapsed}),contentType:'application/json'});
  expect(elapsed).toBeGreaterThan(500);
  expect(elapsed).toBeLessThanOrEqual(1500);
  await expect(page.locator('.slot .won')).toHaveCount(0);
});
