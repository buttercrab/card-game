import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
});

test('replay round controls, tabs, keyboard and closing work', async ({ page }) => {
  await page.goto('/preview?state=done&room');
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '다시 보기', exact: true });
  await expect(replay).toBeVisible();
  await expect(replay.locator('.stepper')).toContainText('1/2');
  await replay.getByRole('button', { name: '다음 라운드', exact: true }).click();
  await expect(replay.locator('.stepper')).toContainText('2/2');
  await expect(replay.getByRole('button', { name: '다음 라운드' })).toBeDisabled();
  await replay.getByRole('button', { name: '이전 라운드' }).click();
  await expect(replay.locator('.stepper')).toContainText('1/2');
  await replay.locator('.sheet-title').click();
  await page.keyboard.press('ArrowRight');
  await expect(replay.locator('.stepper')).toContainText('2/2');
  await replay.getByRole('radio', { name: '각자 패', exact: true }).click();
  await expect(replay.locator('.hands > li')).toHaveCount(6);
  await replay.getByRole('radio', { name: '라운드별', exact: true }).click();
  await expect(replay.locator('.stepper')).toContainText('2/2');
  await page.keyboard.press('Escape');
  await expect(replay).toHaveCount(0);
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  await expect(replay.locator('.stepper')).toContainText('1/2');
  await replay.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(replay).toHaveCount(0);
});

test('an open replay retains the finished hand when the live table deals and moves players', async ({ page }) => {
  await page.clock.install();
  await page.goto('/preview?state=replayrace&room');
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '다시 보기', exact: true });
  await expect(replay).toBeVisible();
  const before = await replay.locator('.plays').innerText();
  await page.clock.runFor(1500);
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await expect(replay).toBeVisible();
  await expect(replay.locator('.plays')).toHaveText(before, { useInnerText: true });
  await replay.getByRole('button', { name: '다음 라운드' }).click();
  await expect(replay.locator('.stepper')).toContainText('2/2');
  await replay.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(replay).toHaveCount(0);
  await expect(page.locator('.menu-btn')).toBeFocused();
  await expect(page.locator('.hand .card')).toHaveCount(10);
});


test('equal completed views with different object identities still open replay', async ({ page }) => {
  await page.goto('/preview?state=replaycopy&room');
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '다시 보기', exact: true });
  await expect(replay).toBeVisible();
  await expect(replay.locator('.stepper')).toContainText('1/2');
});


test('folding results preserves the completed table and seat orientation', async ({ page }) => {
  await page.goto('/preview?state=foldstability&room');
  await page.locator('html[data-ready]').waitFor();
  const scene = () => page.evaluate(() => [...document.querySelectorAll('.spot .seat, .me-seat .seat')].flatMap(e => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return [];
    return [{ name: e.querySelector('.name')?.textContent, x: r.x, y: r.y, width: r.width, height: r.height, labels: e.querySelector('.meta')?.textContent }];
  }));
  const before = await scene();
  const scores = await page.locator('.score-rows').textContent();
  await page.getByRole('button', { name: '테이블 보기', exact: true }).click();
  expect(await scene()).toEqual(before);
  expect(await page.locator('.score-rows').textContent()).toBe(scores);
  await expect(page.getByRole('button', { name: '다음 판', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '다시 보기', exact: true });
  await expect(replay).toBeVisible();
  await replay.getByRole('button', { name: '닫기', exact: true }).click();
  expect(await scene()).toEqual(before);
  await page.getByRole('button', { name: '결과 다시 보기', exact: true }).click();
  expect(await scene()).toEqual(before);
  await expect(page.locator('.result .body')).toBeVisible();
});
