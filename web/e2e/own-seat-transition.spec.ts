import { expect, test } from '@playwright/test';

test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('name', JSON.stringify('나'))); });

test.use({ reducedMotion: 'no-preference' });

test('our waiting identity slides from center to the card-side dock while opponents stay fixed', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one desktop path with full motion');
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${info.workerIndex + 140}` });
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false })));
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await expect(page.locator('.table')).toBeVisible();
  await expect(page.locator('.seat-entry')).toHaveCount(0);
  await page.getByRole('button', { name: '다른 자리', exact: true }).click();
  await page.getByRole('button', { name: '4번 자리에 앉기', exact: true }).click();
  await page.getByRole('button', { name: '이 자리에서 참여', exact: true }).click();
  await expect(page.locator('.seat-entry')).toHaveCount(0);
  for (let i = 0; i < 4; i++) await page.locator('.seat-act', { hasText: '봇 추가' }).first().click();
  // Finish the fill-seat acknowledgement, including the last bot's entrance.
  await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible();
  await page.waitForTimeout(450);
  const opponents = () => page.locator('.ring > .spot').evaluateAll(nodes => nodes.map(e => ({seat:e.getAttribute('data-seat'),place:e.className})));
  const before=await opponents();
  const own=page.locator('.me-seat .seat');
  const waiting=await own.boundingBox();
  const tray=await page.locator('.tray').boundingBox();
  expect(Math.abs(waiting!.x+waiting!.width/2-(tray!.x+tray!.width/2))).toBeLessThan(2);
  // The engine reserves the side columns; no CSS grid chooses them.
  const slot=await page.locator('.hand-slot').boundingBox();
  expect(slot!.x-tray!.x).toBe(192);
  expect(tray!.x+tray!.width-slot!.x-slot!.width).toBe(192);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  // Observe the real animation, not only its final geometry. No cards
  // appear until our identity reaches its playing dock.
  await expect.poll(() => own.evaluate(e => e.getAnimations().some(a => a.id === 'own-seat-transition' && a.playState === 'running'))).toBe(true);
  await expect(page.locator('.hand .card')).toHaveCount(0);
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await expect(page.locator('.hand-slot')).toBeVisible();
  expect(await page.locator('.me-seat').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0s');
  const playing=await own.boundingBox();
  expect(playing!.x+playing!.width).toBeLessThanOrEqual(tray!.x+180);
  expect(await opponents()).toEqual(before);
  expect(errors).toEqual([]);
});

test('readiness becoming Start rejects the tail of the old click even with motion off', async ({ page, browser }, info) => {
  test.skip(info.project.name !== '390x844-dark', 'one live room with a controlled input clock');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  // The paused clock also stops the engine's measurement/publication frames.
  // Publish the room before trying to interact with its seat controls.
  await page.clock.runFor(450);
  await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
  await page.clock.runFor(450);
  const other = await browser.newPage();
  await other.addInitScript(() => {localStorage.setItem('name',JSON.stringify('두번째'));localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false}));});
  await other.goto(page.url());
  await other.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();
  const confirm = other.getByRole('button',{name:'이 자리에서 참여',exact:true});
  if(await confirm.isVisible()) await confirm.click();
  for (let i=0;i<3;i++) {
    await page.locator('.seat-act', { hasText: '봇 추가' }).first().click();
    await expect(page.locator('.seat-act', { hasText: '봇 추가' })).toHaveCount(2-i);
    await page.clock.runFor(32);
  }
  await other.getByRole('button',{name:'준비하기',exact:true}).click();
  await expect(page.locator('.spot .ready-label')).toHaveCount(0);
  await page.getByRole('button',{name:'준비하기',exact:true}).click();
  const start = page.getByRole('button', { name: '시작', exact: true });
  await expect(start).toBeDisabled();
  await start.evaluate(e => (e as HTMLButtonElement).click());
  await expect(page.locator('.hand .card')).toHaveCount(0);
  await page.clock.runFor(399);
  await expect(start).toBeDisabled();
  await page.clock.runFor(1);
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await other.close();
});

for (const interrupt of ['resize', 'reduced-motion'] as const) {
  test(`an active own-seat move settles safely after ${interrupt}`, async ({ page }, info) => {
    test.skip(info.project.name !== '1440x900-dark', 'desktop full-motion interruption');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false })));
    await page.goto('/');
    await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
    await page.waitForURL(/\/r\/[a-z0-9]+$/);
    await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
    for (let i = 0; i < 4; i++) await page.locator('.seat-act', { hasText: '봇 추가' }).first().click();
    const own = page.locator('.me-seat .seat');
    await page.getByRole('button', { name: '시작', exact: true }).click();
    await expect.poll(() => own.evaluate(e => e.getAnimations().some(a => a.id === 'own-seat-transition' && a.playState === 'running'))).toBe(true);
    if (interrupt === 'resize') await page.setViewportSize({ width: 824, height: 1034 });
    else await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => own.evaluate(e => e.getAnimations().some(a => a.id === 'own-seat-transition' && a.playState === 'running'))).toBe(false);
    await expect(page.locator('.hand .card')).toHaveCount(10);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    const box = await own.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(errors).toEqual([]);
  });
}
