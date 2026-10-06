import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${100 + info.workerIndex}` });
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
});

test('home exposes create and join before scrolling and remembers a chosen rule', async ({ page }) => {
  await page.goto('/');
  for (const control of [page.getByRole('button', { name: '테이블 만들기', exact: true }), page.getByRole('textbox', { name: '테이블 코드나 링크' })]) {
    const box = await control.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await page.locator('.rule-choice').click();
  await page.getByRole('radio', { name: /^경기과고/ }).click();
  await page.getByRole('button', { name: '이 규칙으로', exact: true }).click();
  await expect(page.locator('.rule-choice')).toContainText('경기과고');
  await page.locator('.rule-choice').click();
  await expect(page.getByRole('radio', { name: /^경기과고/ })).toHaveAttribute('aria-checked', 'true');
});

test('lobby actions share edges and settings is one direct panel', async ({ page }) => {
  await page.goto('/preview?state=room');
  await page.locator('html[data-ready]').waitFor();
  const primary = await page.locator('.centre .go').boundingBox();
  const tools = await page.locator('.centre .tools').boundingBox();
  expect(Math.abs(primary!.x - tools!.x)).toBeLessThan(1);
  expect(Math.abs(primary!.width - tools!.width)).toBeLessThan(1);
  const opener = page.locator('.centre .tool').filter({ hasText: '설정' });
  await opener.click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '테이블 설정', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 화면과 소리', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole('button', { name: '메뉴', exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: /^설정/ }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.settings-btn')).toBeFocused();
});

test('joining a nonzero seat keeps every lobby seat in place', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const positions = () => page.locator('.spot').evaluateAll(spots => spots.map(e => {
    const r = e.getBoundingClientRect(); return { seat: e.getAttribute('data-seat'), x: r.x, y: r.y };
  }));
  const before = await positions();
  await page.getByRole('button', { name: '4번 자리에 앉기', exact: true }).click();
  await page.locator('.pop-card input').fill('나');
  await page.keyboard.press('Enter');
  await expect(page.locator('.seat-act', { hasText: '+ 봇' })).toHaveCount(4);
  await expect(page.locator('.tools-area')).toBeVisible();
  const after = await positions();
  expect(after).toHaveLength(5);
  for (const old of before) {
    const next = after.find(p => p.seat === old.seat)!;
    expect(Math.abs(next.x - old.x)).toBeLessThan(1);
    expect(Math.abs(next.y - old.y)).toBeLessThan(1);
  }
});

for (const state of ['bidding', 'exchange', 'contract', 'friend']) {
  test(`${state} controls leave player names clear`, async ({ page }) => {
    await page.goto(`/preview?state=${state}&room`);
    await page.locator('html[data-ready]').waitFor();
    const covered = await page.evaluate(() => {
      const controls = document.querySelector('.strip .controls')!.getBoundingClientRect();
      return [...document.querySelectorAll('.spot .name')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.left < controls.right && r.right > controls.left && r.top < controls.bottom && r.bottom > controls.top;
      }).map(e => e.textContent);
    });
    expect(covered).toEqual([]);
    const hiddenReactions = await page.evaluate(() => {
      const obstacles = ['.strip .controls', '.status-area', '.hand'].flatMap(s => [...document.querySelectorAll(s)]).map(e => e.getBoundingClientRect());
      return [...document.querySelectorAll('.spot .reaction')].filter(e => {
        const r = e.getBoundingClientRect();
        return obstacles.some(o => o.width > 0 && o.height > 0 && r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
      }).map(e => e.textContent);
    });
    expect(hiddenReactions).toEqual([]);
  });
}
