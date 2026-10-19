import { expect, test, type Page } from '@playwright/test';
import { bidMaximum } from './drive-deal';

const port = Number(process.env.PORT ?? 4317);
test.use({ baseURL: `http://127.0.0.1:${port + 1}` });

type Room = {
  type: string;
  in_hand: boolean;
  table: { shuffle: boolean; shuffle_next: boolean };
  seats: { name?: string }[];
};

async function finishHand(page: Page) {
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await bidMaximum(page);
  for (let i = 0; i < 3; i++) await page.locator('.hand button.card:not(.picked):not(.unplayable)').last().press('Enter');
  await page.getByRole('button', { name: '버리기', exact: true }).click();
  await page.getByRole('button', { name: /^프렌드 / }).click();
  for (let left = 10; left > 0; left--) {
    await expect(page.locator('.side .turn-line strong')).toHaveText('내 차례', { timeout: 15_000 });
    const card = page.locator('.hand button.card:not(.unplayable)').first();
    await card.press('Enter');
    await card.press('Enter');
    const choices = page.locator('.variants .chip');
    if (await choices.count()) await choices.first().click();
    await expect(page.locator('.hand .card')).toHaveCount(left - 1);
  }
  await expect(page.getByRole('button', { name: '더보기', exact: true })).toBeVisible({ timeout: 15_000 });
}

test('one 섞기 toggle persists across consecutive hands and can be turned off', async ({ page, browser }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one real-server continuity check');
  test.setTimeout(180_000);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${info.workerIndex + 80}` });
  await page.addInitScript(() => {
    localStorage.setItem('name', JSON.stringify('연속 섞기'));
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false, singleTap: false }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기', exact: true }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.getByRole('button', { name: '빈자리에 앉기', exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await page.locator('.seat-act', { hasText: '봇 추가' }).first().click();
    await expect(page.locator('.seat-act', { hasText: '봇 추가' })).toHaveCount(3 - i);
  }

  const watcher = await browser.newPage();
  let room: Room | undefined;
  let shuffles = 0;
  watcher.on('websocket', socket => socket.on('framereceived', event => {
    const message = JSON.parse(String(event.payload));
    if (message.type === 'room') room = message;
    if (message.type === 'seats_moved' && message.how === 'shuffle') shuffles++;
  }));
  await watcher.goto(page.url());
  await expect.poll(() => room?.seats.length).toBe(5);
  const names = () => room!.seats.map(seat => seat.name);
  const original = names();
  const shuffle = page.getByRole('button', { name: /^섞기/ });
  await shuffle.click();
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
  await expect(watcher.locator('.participation-area').getByText('매 판 시작할 때 자리를 섞어요', { exact: true })).toBeVisible();
  expect(names()).toEqual(original);

  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect.poll(() => shuffles).toBe(1);
  await expect.poll(() => room?.in_hand).toBe(true);
  const first = names();
  first.forEach((name, seat) => expect(name).not.toBe(original[seat]));
  expect([...first].sort()).toEqual([...original].sort());
  expect(room!.table).toMatchObject({ shuffle: true, shuffle_next: false });
  await finishHand(page);

  await page.locator('.settings-btn').click();
  const settings = page.getByRole('dialog', { name: '설정', exact: true });
  await expect(settings.getByRole('switch', { name: '매 판 자리 섞기' })).toBeChecked();
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '다음 판', exact: true }).click();
  await expect.poll(() => shuffles).toBe(2);
  await expect.poll(() => room?.in_hand).toBe(true);
  const second = names();
  second.forEach((name, seat) => expect(name).not.toBe(first[seat]));
  expect([...second].sort()).toEqual([...original].sort());
  expect(room!.table.shuffle).toBe(true);
  await finishHand(page);

  await page.locator('.settings-btn').click();
  await settings.getByRole('switch', { name: '매 판 자리 섞기' }).click();
  await expect(settings.getByRole('switch', { name: '매 판 자리 섞기' })).not.toBeChecked();
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  await expect.poll(() => room?.table.shuffle).toBe(false);
  await page.getByRole('button', { name: '다음 판', exact: true }).click();
  await expect.poll(() => room?.in_hand).toBe(true);
  expect(shuffles).toBe(2);
  expect(names()).toEqual(second);
  await expect(page.locator('.hand .card')).toHaveCount(10);
  await watcher.close();
});
