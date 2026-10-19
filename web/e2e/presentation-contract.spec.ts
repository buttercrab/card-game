import { expect, test, type Page } from '@playwright/test';

const errorsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/preview?contract=1');
  await expect(page.locator('[data-contract-demo]')).toBeVisible();
});

test.afterEach(async ({ page }) => { expect(errorsByPage.get(page)).toEqual([]); });

test('the shared action gallery fits desktop and mobile in both themes', async ({ page }, info) => {
  test.skip(!['390x844-light','390x844-dark','1440x900-light','1440x900-dark'].includes(info.project.name), 'two gallery sizes and themes');
  await expect(page.getByRole('heading',{name:'표현 계약 데모',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'마이티 투영',exact:true})).toContainText('내 차례');
  await expect(page.getByRole('region',{name:'포커 예시',exact:true})).toContainText('팟 150');
  await expect(page.getByRole('region',{name:'마이티 행동',exact:true}).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('region',{name:'포커 행동',exact:true}).getByRole('button')).toHaveCount(3);
  for (const button of await page.getByRole('button').all()) {
    const size = await button.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(40);
    expect(size!.x).toBeGreaterThanOrEqual(0);
    expect(size!.x + size!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Mighty commands and numeric poker actions dispatch their exact typed payloads', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one shared renderer action sequence');
  await page.getByRole('region',{name:'마이티 행동',exact:true}).getByRole('button').click();
  await expect(page.locator('[data-dispatch="mighty"]')).toHaveText('{"Play":{"card":{"Normal":["Spade",14]},"joker_lead":null,"call_joker":false}}');
  const amount = page.getByRole('spinbutton',{name:'레이즈 금액',exact:true});
  await expect(amount).toHaveAttribute('min','100');
  await expect(amount).toHaveAttribute('max','800');
  await expect(amount).toHaveAttribute('step','25');
  await amount.fill('250');
  await page.getByRole('button',{name:'레이즈',exact:true}).click();
  await expect(page.locator('[data-dispatch="poker"]')).toHaveText('{"kind":"raise","amount":250}');
  await expect(page.locator('[data-dispatch-count]')).toHaveAttribute('data-dispatch-count','2');
});

test('blank, out-of-range and unaligned amounts cannot dispatch even through form submission', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one invalid numeric input sequence');
  const amount = page.getByRole('spinbutton',{name:'레이즈 금액',exact:true});
  for (const value of ['', '99', '801', '126']) {
    await amount.fill(value);
    await expect(amount).toHaveAttribute('aria-invalid','true');
    await expect(page.getByRole('button',{name:'레이즈',exact:true})).toBeDisabled();
    await page.locator('form[data-action="raise"]').evaluate(form => (form as HTMLFormElement).requestSubmit());
    await expect(page.locator('[data-dispatch-count]')).toHaveAttribute('data-dispatch-count','0');
  }
});

test('disabled offers explain why and observers receive no actions or private cards', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one disabled and observer state sequence');
  await page.getByRole('button',{name:'레이즈 잠금',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'레이즈 금액',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'레이즈',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'레이즈',exact:true})).toHaveCSS('box-shadow','none');
  await expect(page.getByRole('region',{name:'포커 행동',exact:true})).toContainText('이번 차례에는 레이즈할 수 없어요.');
  await page.locator('form[data-action="raise"]').evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(page.locator('[data-dispatch-count]')).toHaveAttribute('data-dispatch-count','0');
  await page.getByRole('button',{name:'관전 모드',exact:true}).click();
  for (const label of ['마이티 행동','포커 행동']) {
    const panel = page.getByRole('region',{name:label,exact:true});
    await expect(panel.getByRole('button')).toHaveCount(0);
    await expect(panel.getByRole('spinbutton')).toHaveCount(0);
  }
  await expect(page.locator('[data-game="mighty"] [data-card]')).toHaveCount(0);
  await expect(page.locator('[data-game="poker"] [data-face="down"]')).toHaveCount(4);
});

test('a revised offer resets the dirty amount and rejects the prior gesture and target', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one stale offer boundary');
  const amount = page.getByRole('spinbutton',{name:'레이즈 금액',exact:true});
  await amount.fill('475');
  const old = await page.getByRole('button',{name:'레이즈',exact:true}).elementHandle();
  const rect = await old!.boundingBox();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.mouse.down();
  await page.getByRole('button',{name:'선택지 갱신',exact:true}).evaluate(button => (button as HTMLButtonElement).click());
  await expect(amount).toHaveValue('200');
  await expect(amount).toHaveAttribute('min','200');
  await expect(amount).toHaveAttribute('max','500');
  await page.mouse.up();
  await old!.evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('[data-dispatch-count]')).toHaveAttribute('data-dispatch-count','0');
  await page.getByRole('button',{name:'레이즈',exact:true}).click();
  await expect(page.locator('[data-dispatch="poker"]')).toHaveText('{"kind":"raise","amount":200}');
});

for (const toggle of ['레이즈 잠금','선택지 갱신']) {
  test(`numeric targets stay stale after ${toggle} returns to the original offer`, async ({ page }, info) => {
    test.skip(info.project.name !== '390x844-light','one numeric offer roundtrip per condition');
    const amount = page.getByRole('spinbutton',{name:'레이즈 금액',exact:true});
    await amount.fill('250');
    const oldForm = await page.locator('form[data-action="raise"]').elementHandle();
    await page.getByRole('button',{name:toggle,exact:true}).click();
    if (toggle === '레이즈 잠금') await expect(amount).toBeDisabled();
    else await expect(amount).toHaveAttribute('min','200');
    await page.getByRole('button',{name:toggle,exact:true}).click();
    await expect(amount).toBeEnabled();
    await expect(amount).toHaveValue('100');
    // Reattach a retained old target so delegated DOM events are exercised.
    // It must not rewrite the fresh draft or submit even when the offer ID repeats.
    await oldForm!.evaluate(node => {
      const form = node as HTMLFormElement;
      document.body.append(form);
      const input = form.querySelector('input')!;
      input.value = '400';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      form.requestSubmit();
      form.querySelector('button')?.click();
      form.remove();
    });
    await expect(amount).toHaveValue('100');
    await expect(page.locator('[data-dispatch-count]')).toHaveAttribute('data-dispatch-count','0');
    await amount.fill('250');
    await page.getByRole('button',{name:'레이즈',exact:true}).click();
    await expect(page.locator('[data-dispatch-count]')).toHaveAttribute('data-dispatch-count','1');
    await expect(page.locator('[data-dispatch="poker"]')).toHaveText('{"kind":"raise","amount":250}');
  });
}
