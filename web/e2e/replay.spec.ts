import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
});

test('the overview aligns players by trick instead of sorting their suits', async ({page}) => {
  await page.goto('/preview?state=done&room');
  const matrix=page.locator('.ring > .finished-hands');
  await expect(matrix.locator('.columns > span')).toHaveText(['1','2']);
  const declarer=matrix.locator('[data-hand-seat="2"]');
  await expect(declarer.locator('[data-round="1"] .card')).toHaveAttribute('aria-label', /스페이드 A/);
  await expect(declarer.locator('[data-round="2"] .card')).toHaveAttribute('aria-label', /홍 조커/);
  for(const round of [1,2]) {
    await expect(matrix.locator(`[data-round="${round}"][data-winner="true"]`)).toHaveCount(1);
    await expect(declarer.locator(`[data-round="${round}"]`)).toHaveAttribute('data-winner','true');
  }
});

test('replay round controls, tabs, keyboard and closing work', async ({ page }) => {
  await page.goto('/preview?state=done&room');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '더보기', exact: true });
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
  await replay.getByRole('radio', { name: '전체 라운드', exact: true }).click();
  await expect(replay.locator('.hands > li')).toHaveCount(5);
  await replay.getByRole('radio', { name: '점수·교환', exact: true }).click();
  await expect(replay).toContainText('주공이 버린 카드');
  await replay.getByRole('radio', { name: '라운드별', exact: true }).click();
  await expect(replay.locator('.stepper')).toContainText('2/2');
  await page.keyboard.press('Escape');
  await expect(replay).toHaveCount(0);
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await expect(replay.locator('.stepper')).toContainText('1/2');
  await replay.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(replay).toHaveCount(0);
});

test('an open replay retains the finished hand when the live table deals and moves players', async ({ page }) => {
  await page.clock.install();
  // Freeze before mounting scripted previews; only runFor advances deadlines.
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.goto('/preview?state=replayrace&room');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '더보기', exact: true });
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
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '더보기', exact: true });
  await expect(replay).toBeVisible();
  await expect(replay.locator('.stepper')).toContainText('1/2');
});


test('finished hands and details preserve the completed table and seat orientation', async ({ page }) => {
  await page.goto('/preview?state=foldstability&room');
  await page.locator('html[data-ready]').waitFor();
  const scene = () => page.evaluate(() => [...document.querySelectorAll('.spot .seat, .me-seat .seat')].flatMap(e => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return [];
    // Scrolling to a lower result control is distinct from moving a seat.
    return [{ name: e.querySelector('.name')?.textContent, x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, labels: e.querySelector('.meta')?.textContent }];
  }));
  const before = await scene();
  const scores = await page.locator('.score-rows').textContent();
  await expect(page.getByRole('button', { name: '테이블 보기', exact: true })).toHaveCount(0);
  await expect(page.locator('.finished-hands .hands > li')).toHaveCount(5);
  expect(await scene()).toEqual(before);
  expect(await page.locator('.score-rows').textContent()).toBe(scores);
  await expect(page.getByRole('button', { name: '다음 판', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  const replay = page.getByRole('dialog', { name: '더보기', exact: true });
  await expect(replay).toBeVisible();
  await replay.getByRole('button', { name: '닫기', exact: true }).click();
  expect(await scene()).toEqual(before);
  await expect(page.getByRole('button', { name: '결과 다시 보기', exact: true })).toHaveCount(0);
  expect(await scene()).toEqual(before);
  await expect(page.locator('.result .summary')).toBeVisible();
});


test('a recorded hand opens from the menu before the reconnecting live state arrives',async({page})=>{
  await page.goto('/preview?state=recordbeforestate&room');
  await expect(page.locator('.result')).toHaveCount(0);
  await page.getByRole('button',{name:'메뉴',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'이번 판 다시 보기',exact:true}).click();
  const replay=page.getByRole('dialog',{name:'더보기',exact:true});
  await expect(replay).toBeVisible();
  await expect(replay.locator('.stepper')).toContainText('1/2');
  await replay.getByRole('button',{name:'다음 라운드',exact:true}).click();
  await expect(replay.locator('.stepper')).toContainText('2/2');
});
