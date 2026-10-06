import { expect, test } from '@playwright/test';

const port = Number(process.env.PORT ?? 4317);
test.use({ baseURL: `http://127.0.0.1:${port + 1}`, reducedMotion: 'no-preference' });

test('a fresh deal goes through settings, exchange, results, replay and the next deal', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one real-server lifecycle with normal client motion');
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false, singleTap: false })));
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.locator('.seat-act', { hasText: '앉기' }).first().click();
  await page.locator('.pop-card input').fill('검증');
  await page.locator('.pop-card button[type=submit]').click();
  for (let i = 0; i < 4; i++) await page.locator('.seat-act', { hasText: '+ 봇' }).first().click();

  await page.locator('.settings-btn').click();
  const settings = page.getByRole('dialog', { name: '설정', exact: true });
  await expect(settings.getByRole('radio', { name: '보통', exact: true })).toBeChecked();
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  // Finish the misdeal grace before selecting a contract: a bot may redeal.
  await expect(page.locator('.bid .primary')).toBeEnabled();
  // The highest contract guarantees that the test player owns exchange.
  await page.getByRole('radio', { name: '노기루다', exact: true }).click();
  await page.getByRole('radio', { name: '20', exact: true }).click();
  await expect(page.locator('.bid .primary')).toContainText('20');
  await expect(page.getByRole('radio', { name: '노기루다', exact: true })).toBeChecked();
  await page.locator('.bid .primary').click();
  await expect(page.locator('.hand .card')).toHaveCount(13);
  for (let i = 0; i < 3; i++) await page.locator('.hand button.card:not(.picked):not(.unplayable)').last().press('Enter');
  await page.getByRole('button', { name: '버리기', exact: true }).click();
  await page.getByRole('button', { name: /^프렌드 / }).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);

  for (let left = 10; left > 0; left--) {
    await expect(page.locator('.side .turn-line strong')).toHaveText('내 차례', { timeout: 15_000 });
    const card = page.locator('.hand button.card:not(.unplayable)').first();
    await card.press('Enter');
    await card.press('Enter');
    const choices = page.locator('.variants .chip');
    if (await choices.count()) await choices.first().click();
    await expect(page.locator('.hand .card')).toHaveCount(left - 1);
  }
  await expect(page.getByRole('button', { name: '다시 보기', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '테이블 보기', exact: true }).click();
  await expect(page.locator('.result .body')).toBeHidden();
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  expect(errors).toEqual([]);
  const replay = page.getByRole('dialog', { name: '다시 보기', exact: true });
  await expect(replay).toBeVisible();
  for (let i = 0; i < 9; i++) await replay.getByRole('button', { name: '다음 라운드', exact: true }).click();
  await expect(replay.locator('.stepper')).toContainText('10/10');
  await replay.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '다음 판', exact: true }).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await expect(page.locator('.bid')).toBeVisible();
  await page.reload();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await expect(page.locator('.me-seat .name')).toHaveText('검증');
  expect(errors).toEqual([]);
});
