import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { bidMaximum } from './drive-deal';

const port = Number(process.env.PORT ?? 4317);
test.use({ baseURL: `http://127.0.0.1:${port + 1}`, reducedMotion: 'no-preference' });
const captures = process.env.UX_CAPTURE_DIR ?? '/tmp/card-game-ux-captures';

test('one table continues from entry through a completed hand into the next deal', async ({ page }, info) => {
  test.skip(!['1440x900-dark', '390x844-light', '320x568-light'].includes(info.project.name), 'representative full-motion layouts');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${info.workerIndex + 110}` });
  await page.addInitScript(() => {
    localStorage.setItem('name', JSON.stringify('재용'));
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false, singleTap: false }));
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/마이티|Mighty|Maiti/i);
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await expect(page.locator('.observer-entry')).toBeVisible();
  await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
  for (let i = 0; i < 4; i++) await page.locator('.seat-act', { hasText: '봇 추가' }).first().click();
  await page.waitForTimeout(450);
  await mkdir(captures, { recursive: true });
  const capture = (state: string) => page.screenshot({ path: `${captures}/${info.project.name}-${state}.png`, fullPage: true });
  await capture('waiting');
  await page.evaluate(() => {
    const seat=document.querySelector('.me-seat .seat')!;
    (window as any).__continuousIdentity=[seat,seat.querySelector('.identity'),seat.querySelector('.stand svg.figure'),seat.querySelector('.meta')];
  });
  const retainedIdentity = async () => {
    expect(await page.evaluate(() => {
      const seat=document.querySelector('.me-seat .seat')!;
      const current=[seat,seat.querySelector('.identity'),seat.querySelector('.stand svg.figure'),seat.querySelector('.meta')];
      return ((window as any).__continuousIdentity as Element[]).every((old,index)=>old?.isConnected&&old.isSameNode(current[index]));
    })).toBe(true);
    await expect(page.locator('[data-live-canvas],[data-canvas-paint-boundary],[data-canvas-surface-manager]')).toHaveCount(0);
  };
  await retainedIdentity();
  const opponents = () => page.locator('.ring > .spot').evaluateAll(nodes => nodes.map(e => ({ seat: e.getAttribute('data-seat'), place: e.className })));
  let order = await opponents();
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await page.waitForTimeout(1000);
  await capture('playing');
  await retainedIdentity();
  const own = page.locator('.me-seat .seat');
  const playing = await own.boundingBox();
  expect(await opponents()).toEqual(order);
  await bidMaximum(page);
  for (let i = 0; i < 3; i++) await page.locator('.hand button.card:not(.picked):not(.unplayable)').last().press('Enter');
  await page.getByRole('button', { name: '버리기', exact: true }).click();
  await page.getByRole('button', { name: /^프렌드 / }).click();
  for (let left = 10; left > 0; left--) {
    const card = page.locator('.hand button.card:not(.unplayable)').first();
    await expect(card).toBeEnabled({ timeout: 15_000 });
    await card.press('Enter'); await card.press('Enter');
    const variants = page.locator('.variants .chip');
    if (await variants.count()) await variants.first().click();
    await expect(page.locator('.hand .card')).toHaveCount(left - 1);
  }
  await expect(page.getByRole('button', { name: '다음 판', exact: true })).toBeEnabled({ timeout: 15_000 });
  await capture('result');
  await retainedIdentity();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  if (playing) {
    await page.waitForTimeout(450);
    const finished = await own.boundingBox();
    const tray = await page.locator('.tray').boundingBox();
    if (info.project.name === '1440x900-dark') expect(Math.abs(finished!.x + finished!.width/2 - (tray!.x + tray!.width/2))).toBeLessThan(2);
    else expect(Math.abs(finished!.x - playing.x)).toBeLessThan(2);
  }
  expect(await opponents()).toEqual(order);
  if (info.project.name === '1440x900-dark') {
    // Shared score/rule changes must not restart our opening movement.
    await page.getByRole('button', { name: '메뉴', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '점수 초기화', exact: true }).click();
    await page.getByRole('dialog', { name: '누적 점수를 초기화할까요?' }).getByRole('button', { name: '점수 초기화', exact: true }).click();
    await page.locator('.settings-btn').click();
    await page.getByRole('dialog').getByRole('button', { name: '규칙 바꾸기', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '우리 규칙 만들기' });
    await editor.getByRole('button', { name: '다른 규칙에서 시작', exact: true }).click();
    await editor.locator('[role="radio"][aria-checked="false"]').first().click();
    await editor.getByRole('button', { name: '적용', exact: true }).click();
    await page.locator('.spot .seat-tap').first().click();
    await page.getByRole('button', { name: '자리 바꾸기', exact: true }).click();
    await page.locator('.spot .seat-tap').nth(1).click();
    await page.waitForTimeout(550);
    order = await opponents();
    const continuation = page.getByRole('button', { name: /^(시작|다음 판)$/ });
    await expect(continuation).toHaveCount(1);
    await expect(continuation).toBeEnabled();
    await expect(page.locator('.tray')).toHaveClass(/centered/);
    const waitingAgain = await own.boundingBox();
    const trayAgain = await page.locator('.tray').boundingBox();
    expect(Math.abs(waitingAgain!.x+waitingAgain!.width/2-(trayAgain!.x+trayAgain!.width/2))).toBeLessThan(2);
    await continuation.click();
  } else {
  await page.getByRole('button', { name: '다음 판', exact: true }).click();
  }
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await expect(page.locator('.result')).toHaveCount(0);
  await capture('next-hand');
  await retainedIdentity();
  expect(await opponents()).toEqual(order);
  expect(await page.locator('.me-seat').evaluate(e => e.getAnimations({ subtree: true }).some(a => a.id === 'own-seat-transition'))).toBe(false);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a live human table exposes observer reactions and handoff requests in the phone header', async ({ page, browser }, info) => {
  test.skip(!['390x844-light', '320x568-light'].includes(info.project.name), 'phone participation visibility');
  test.setTimeout(60_000);
  const init = async (target: typeof page, name: string) => target.addInitScript(name => {
    localStorage.setItem('name', JSON.stringify(name));
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false }));
  }, name);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${info.workerIndex + 120}` });
  await init(page, '재용');
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
  const contexts = [];
  const players = [];
  try {
    for (const name of ['민수', '호두', '단추', '보리']) {
      const context = await browser.newContext({ viewport: page.viewportSize()! }); contexts.push(context);
      const player = await context.newPage(); await init(player, name); await player.goto(page.url());
      await player.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
      players.push(player);
    }
    for (const player of players) await player.getByRole('button', { name: '준비하기', exact: true }).click();
    await page.getByRole('button', { name: '준비하기', exact: true }).click();
    await page.getByRole('button', { name: '시작', exact: true }).click();
    await expect(page.locator('.hand .card')).toHaveCount(10);
    const context = await browser.newContext({ viewport: page.viewportSize()! }); contexts.push(context);
    const observer = await context.newPage(); await init(observer, '수연'); await observer.goto(page.url());
    await expect(observer.locator('.table')).toBeVisible();
    await observer.keyboard.press('r'); await observer.keyboard.press('Enter');
    const reaction = page.locator('.observer-feedback [data-kind="reaction"]');
    await expect(reaction).toHaveText('👏');
    await expect(page.locator('.observer-feedback')).toContainText('수연');
    await reaction.evaluate(el => el.setAttribute('data-repeat-probe', 'first'));
    // The real server rate-limits reactions; remain within the bubble's
    // lifetime while waiting for another intentional send to be accepted.
    await observer.waitForTimeout(1100);
    await observer.keyboard.press('r'); await observer.keyboard.press('Enter');
    await expect(reaction).not.toHaveAttribute('data-repeat-probe', 'first');
    await observer.getByRole('button', { name: '다음 판 참여', exact: true }).click();
    const request = page.getByRole('button', { name: /관전자.*참여 요청 1건/ });
    await expect(request).toBeInViewport();
    await request.click();
    const people = page.getByRole('dialog');
    await people.getByRole('button', { name: '다음 판 쉬기', exact: true }).click();
    await expect(people.getByRole('button', { name: '자리 양보 취소', exact: true })).toBeVisible();
    await expect(observer.locator('.participation-area')).toContainText('다음 판부터');
    await expect(observer.getByRole('button', { name: '앉아서 다음 판 준비', exact: true })).toHaveCount(0);
    await people.getByRole('button', { name: '자리 양보 취소', exact: true }).click();
    await expect(observer.locator('.participation-area')).toContainText('자리 양보 기다리는 중');
    await expect(page.locator('.hand .card')).toHaveCount(10);
    await people.getByRole('button', { name: '닫기', exact: true }).click();
    await mkdir(captures, { recursive: true });
    await page.screenshot({ path: `${captures}/${info.project.name}-participation.png`, fullPage: true });
  } finally { for (const context of contexts) await context.close(); }
});
