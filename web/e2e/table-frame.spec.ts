import { expect, test } from '@playwright/test';
import { bidMaximum } from './drive-deal';
import { mkdir } from 'node:fs/promises';

const port = Number(process.env.PORT ?? 4317);
test.use({ baseURL: `http://127.0.0.1:${port + 1}`, reducedMotion: 'no-preference' });

test('one physical table survives shuffled start, bidding, exchange and card play', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem('name', JSON.stringify('위치 검증'));
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false }));
  });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${info.workerIndex + 190}` });
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
  for (let i = 0; i < 4; i++) await page.locator('.seat-act', { hasText: '봇 추가' }).first().click();
  await page.evaluate(() => document.fonts.ready);
  const geometry = () => page.locator('.ring > .spot .stand').evaluateAll(nodes => nodes.map(e => {
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const before = await geometry();
  const captures = process.env.UX_CAPTURE_DIR;
  const capture = async (state: string) => {
    if (!captures) return;
    await mkdir(captures, { recursive: true });
    await page.screenshot({ path: `${captures}/${info.project.name}-${state}.png`, fullPage: true });
  };
  await capture('waiting');
  const stable = async () => {
    const next = await geometry(); expect(next).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(next[i][key] - before[i][key]), `opponent ${i} ${key}`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    const overlap = await page.evaluate(() => {
      const panel = document.querySelector('.strip .controls'); if (!panel) return false;
      const a = panel.getBoundingClientRect();
      return [...document.querySelectorAll('.ring > .spot .identity')].some(e => {
        const b = e.getBoundingClientRect();
        return Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
      });
    });
    expect(overlap,'decision controls must clear player identities').toBe(false);
  };
  await page.getByRole('button', { name: /^섞기/ }).click();
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await page.waitForTimeout(1000);
  await stable();
  await capture('bidding');
  await bidMaximum(page);
  await expect(page.locator('.hand .card')).toHaveCount(13);
  await stable();
  await capture('exchange');
  for (let i = 0; i < 3; i++) await page.locator('.hand button.card:not(.picked):not(.unplayable)').last().press('Enter');
  await page.getByRole('button', { name: '버리기', exact: true }).click();
  await page.getByRole('button', { name: /^프렌드 / }).click();
  await expect(page.locator('.hand button.card:not(.unplayable)').first()).toBeEnabled();
  await stable();
  await capture('playing');
  await expect(page.locator('.seat .ready-label')).toHaveCount(0);
  // Sample the rendered figures through a real trick, including collection
  // and the next turn. Layout stability alone must not hide seat-wide wiggles.
  await page.evaluate(() => {
    const frames: {x:number;y:number;width:number;height:number}[][] = [];
    (window as unknown as {anchorFrames: typeof frames}).anchorFrames = frames;
    const until = performance.now() + 3000;
    const sample = () => {
      frames.push([...document.querySelectorAll('.ring > .spot .stand')].map(e => {
        const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};
      }));
      if (performance.now() < until) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const card = page.locator('.hand button.card:not(.unplayable)').first();
  await card.press('Enter'); await card.press('Enter');
  const variants = page.locator('.variants .chip');
  if (await variants.count()) await variants.first().click();
  await expect(page.locator('.hand .card')).toHaveCount(9);
  await page.waitForTimeout(3100);
  const frames = await page.evaluate(() => (window as unknown as {anchorFrames: {x:number;y:number;width:number;height:number}[][]}).anchorFrames);
  expect(frames.length).toBeGreaterThan(10);
  for (const frame of frames) for (let i=0;i<before.length;i++) for (const key of ['x','y','width','height'] as const)
    expect(Math.abs(frame[i][key]-before[i][key]), `moving figure ${i} ${key}`).toBeLessThanOrEqual(1);
});
