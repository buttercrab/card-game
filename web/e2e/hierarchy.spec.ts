import { expect, test } from '@playwright/test';

test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('name', JSON.stringify('나'))); });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
});

test('one visible turn cue identifies both the actor and the current decision', async ({ page }) => {
  for (const [state, action] of [['play', '카드 내기'], ['bidding', '공약 고르기'], ['friend', '프렌드 정하기']]) {
    await page.goto(`/preview?state=${state}&room`);
    await page.locator('html[data-ready]').waitFor();
    const cue = page.locator('.turn-line:visible');
    await expect(cue).toHaveCount(1);
    await expect(cue).toContainText('내 차례');
    await expect(cue).toContainText(action);
  }
});

test('the current winning card uses its outline without a floating label', async ({ page }) => {
  await page.goto('/preview?state=play&room');
  await page.locator('html[data-ready]').waitFor();
  await expect(page.locator('.slot .card.leading')).toHaveCount(1);
  await expect(page.locator('.winner-label')).toHaveCount(0);
});

test('public roles retain production badge styling while private friend status stays private', async ({ page }) => {
  await page.goto('/preview?state=feedbackstress&room');
  await page.locator('html[data-ready]').waitFor();
  const friend = page.locator('.spot[data-seat="1"] .meta .partner');
  const declarer = page.locator('.spot[data-seat="2"] .meta .declarer');
  await expect(friend).toHaveText('프렌드');
  await expect(declarer).toHaveText('주공');
  const color = (e: Element) => getComputedStyle(e).backgroundColor;
  expect(await friend.evaluate(color)).toBe(await declarer.evaluate(color));
  for (const badge of [friend,declarer]) {
    expect(await badge.evaluate(e => {
      const r=e.getBoundingClientRect(),figure=e.closest('.seat')!.querySelector('.stand')!.getBoundingClientRect();
      return r.top<figure.bottom && r.bottom>figure.top;
    })).toBe(true);
    expect(await badge.evaluate(e=>{
      const seat=e.closest('.seat')!, figure=seat.querySelector('.stand')!, meta=seat.querySelector('.meta')!;
      return Math.abs(parseFloat(getComputedStyle(meta).marginTop)+figure.getBoundingClientRect().width*0.14);
    })).toBeLessThan(0.02);
  }
  await page.goto('/preview?state=secret&room');
  await page.locator('html[data-ready]').waitFor();
  await expect(page.locator('.tray .secret:visible')).toHaveText('프렌드');
  await expect(page.locator('.spot .partner')).toHaveCount(0);
});

test('one own identity stays visible in the room and play with a viewport-specific dock', async ({ page }) => {
  for (const state of ['room','play']) {
    await page.goto(`/preview?state=${state}&room`);
    await page.locator('html[data-ready]').waitFor();
    await expect(page.locator('.me-seat:visible .stand')).toHaveCount(1);
    await expect(page.locator('.me-row')).toHaveCount(0);
  }
  await expect(page.locator('.me-seat .name')).toHaveText('재용');
  if (page.viewportSize()!.width >= 1024) {
    const columns=await page.locator('.tray').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').map(Number.parseFloat));
    expect(columns[0]).toBe(170);expect(columns.at(-1)).toBe(170);
  } else {
    const identity=await page.locator('.me-seat .identity').boundingBox();
    expect(identity!.height).toBe(32);
  }
});

test('default seating preserves relative seat order and joins directly on the table', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const order=()=>page.locator('.ring > .spot').evaluateAll(nodes=>nodes.map(e=>({seat:e.getAttribute('data-seat'),place:e.className})));
  const before=await order();
  await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
  await expect(page.locator('.seat-act', { hasText: '봇 추가' })).toHaveCount(4);
  expect(await order()).toEqual(before);
  await expect(page.locator('.me-seat .name')).toHaveText('나');
  await expect(page.locator('.seat-entry')).toHaveCount(0);
  await expect(page.locator('.ring > .spot[data-seat="0"]')).toHaveCount(0);
});

test('portrait tablet retains production full waiting identity and compact playing strip', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'the 730px portrait breakpoint');
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '192.0.2.240' });
  await page.setViewportSize({ width: 730, height: 1012 });
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
  for (let i=0;i<4;i++) await page.locator('.seat-act', { hasText: '봇 추가' }).first().click();
  await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible();
  await expect(page.locator('.stand:visible')).toHaveCount(5);
  await expect(page.locator('.ready-label')).toHaveCount(0);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await expect(page.locator('.stand:visible')).toHaveCount(5);
  await expect(page.locator('.me-seat:visible .name')).toHaveText('나');
});
