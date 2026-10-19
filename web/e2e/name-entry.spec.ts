import { expect, test } from '@playwright/test';

test('name entry is visible at the table and the typed name seats immediately', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({'X-Forwarded-For':`192.0.2.${info.workerIndex + 170}`});
  await page.goto('/');
  await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const name = page.locator('.observer-entry').getByLabel('내 이름');
  await expect(name).toBeVisible();
  const bounds = await name.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await name.fill('수연');
  // The join gesture saves the name first; no separate save click is needed.
  await page.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();
  await expect(page.locator('.me-seat .name')).toHaveText('수연');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.reload();
  await expect(page.locator('.me-seat .name')).toHaveText('수연');
});

test('a seated player edits their name in settings and keeps the same seat after reload', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({'X-Forwarded-For':`192.0.2.${info.workerIndex + 180}`});
  await page.addInitScript(() => localStorage.setItem('name', JSON.stringify('수연')));
  await page.goto('/');
  await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();
  await expect(page.locator('.me-seat .name')).toHaveText('수연');
  await page.locator('.settings-btn').click();
  const form = page.locator('.my-name');
  await form.getByLabel('내 이름').fill('재용');
  await form.getByRole('button',{name:'저장',exact:true}).click();
  await expect(form.getByRole('button',{name:'저장',exact:true})).toBeDisabled();
  await page.reload();
  await expect(page.locator('.me-seat .name')).toHaveText('재용');
  await expect(page.locator('.seat-act',{hasText:'봇 추가'})).toHaveCount(4);
});
