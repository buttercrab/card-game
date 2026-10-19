import { expect, test, type Page } from '@playwright/test';

type Recorded = Window & { engineDecisionActions: unknown[] };
const actions = (page: Page) => page.evaluate(() => (window as Recorded).engineDecisionActions);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('name', JSON.stringify('엔진 확인'));
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false }));
    (window as Recorded).engineDecisionActions = [];
    addEventListener('preview-action', event => (window as Recorded).engineDecisionActions.push((event as CustomEvent).detail));
  });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
});

async function settle(page: Page) {
  let previous = '', stable = 0;
  for (let frame = 0; frame < 30 && stable < 3; frame++) {
    await page.clock.runFor(16);
    await page.waitForTimeout(20);
    const next = await page.locator('.engine-decision').evaluate(node => JSON.stringify([...node.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect(); return [box.x, box.y, box.width, box.height];
    })));
    stable = next === previous ? stable + 1 : 0; previous = next;
  }
  expect(stable).toBeGreaterThanOrEqual(3);
}
async function open(page: Page, state = 'bidding') {
  await page.goto(`/preview?state=${state}&room`);
  await page.clock.runFor(450);
  await page.locator('.engine-decision').waitFor();
  await settle(page);
}

test('engine radios preserve focus and selection through reverse arrow navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const counts = page.getByRole('radiogroup', { name: '공약 수', exact: true });
  const first = counts.getByRole('radio', { name: '15', exact: true });
  const next = counts.getByRole('radio', { name: '16', exact: true });
  await first.focus();
  for (let repeat = 0; repeat < 2; repeat++) {
    await first.press('ArrowRight');
    await expect(next).toBeFocused(); await expect(next).toHaveAttribute('aria-checked', 'true');
    await next.press('ArrowLeft');
    await expect(first).toBeFocused(); await expect(first).toHaveAttribute('aria-checked', 'true');
  }
  expect(await actions(page)).toEqual([]);
  await page.locator('.engine-decision .actions .primary').click();
  expect(await actions(page)).toEqual([{ Bid: { trump: 'Spade', count: 15 } }]);
  expect(errors).toEqual([]);
});

test('held Space cannot submit after resize or scroll; a fresh gesture still works', async ({ page }) => {
  await open(page);
  const pass = page.getByRole('button', { name: '패스', exact: true });
  await pass.focus(); await page.keyboard.down('Space');
  const before = page.viewportSize()!;
  await page.setViewportSize({ width: before.width === 390 ? 768 : 390, height: 844 });
  await settle(page);
  await page.keyboard.up('Space');
  expect(await actions(page)).toEqual([]);
  await pass.focus(); await page.keyboard.down('Space');
  await page.locator('.engine-decision .picks').evaluate(node => node.dispatchEvent(new Event('scroll')));
  await page.keyboard.up('Space');
  expect(await actions(page)).toEqual([]);
  await pass.press('Space');
  expect(await actions(page)).toEqual(['Pass']);
});

test('offer replacement expires both detached choice and submit targets', async ({ page }) => {
  await open(page, 'bidrevision');
  const sixteen = page.getByRole('radiogroup', { name: '공약 수', exact: true }).getByRole('radio', { name: '16', exact: true });
  await sixteen.click(); await settle(page);
  const oldChoice = await sixteen.elementHandle();
  const oldSubmit = await page.locator('.engine-decision .actions .primary').elementHandle();
  await page.clock.runFor(3000); await settle(page);
  await oldChoice!.evaluate(node => { document.querySelector('.engine-decision .picks')!.append(node); (node as HTMLButtonElement).click(); node.remove(); });
  await oldSubmit!.evaluate(node => { document.querySelector('.engine-decision .actions')!.append(node); (node as HTMLButtonElement).click(); node.remove(); });
  expect(await actions(page)).toEqual([]);
  await expect(page.getByRole('radiogroup', { name: '공약 수', exact: true }).getByRole('radio', { name: '16', exact: true })).toHaveCount(0);
  await page.locator('.engine-decision .actions .primary').click();
  expect(await actions(page)).toEqual([{ Bid: { trump: 'Spade', count: 15 } }]);
});
