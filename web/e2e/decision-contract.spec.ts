import { expect, test, type Page } from '@playwright/test';

type PreviewWindow = Window & { decisionContractActions: unknown[] };
const actions = (page: Page) => page.evaluate(() => (window as PreviewWindow).decisionContractActions);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('name', JSON.stringify('나'));
    localStorage.setItem('mighty.settings', JSON.stringify({speed:'off',sound:false,music:false}));
    (window as PreviewWindow).decisionContractActions = [];
    addEventListener('preview-action', event => (window as PreviewWindow).decisionContractActions.push((event as CustomEvent).detail));
  });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
});

async function open(page: Page, state: string) {
  await page.goto(`/preview?state=${state}&room`);
  // The numeric renderer measures leaves on animation frames. The paused
  // test clock must advance before a newly mounted region can be visible.
  await page.clock.runFor(450);
  await page.locator('.controls').waitFor();
  await settleControls(page);
}

async function settleControls(page:Page){
  let previous='',stable=0;
  for(let step=0;step<16&&stable<3;step++){
    await page.clock.runFor(16);
    await page.waitForTimeout(20);
    const snapshot=await page.locator('.controls').evaluate(controls=>JSON.stringify([controls,...controls.querySelectorAll('[data-engine-layout],button')].map(element=>{
      const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    })));
    stable=snapshot===previous?stable+1:0;previous=snapshot;
  }
  expect(stable,'paused-clock decisions must settle before native input').toBeGreaterThanOrEqual(3);
}

async function settleDialog(page:Page){
  await page.evaluate(async()=>{
    const dialog=document.querySelector('[role="dialog"]');
    if(dialog)await Promise.all(dialog.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
  });
  // Fake rAF advances without a native paint between virtual frames. Let
  // ResizeObserver deliver each layer before comparing the numeric tree.
  let previous='',stable=0;
  for(let step=0;step<16&&stable<3;step++){
    await page.clock.runFor(16);
    await page.waitForTimeout(20);
    const snapshot=await page.getByRole('dialog').evaluate(dialog=>JSON.stringify([...dialog.querySelectorAll('.grid,.grid button.card,.sheet-foot,.own-head')].map(element=>{
      const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    })));
    stable=snapshot===previous?stable+1:0;previous=snapshot;
  }
  expect(stable,'paused-clock picker geometry must settle before native input').toBeGreaterThanOrEqual(3);
}

test('a friend-picker revision closes the draft and rejects its previous confirmation', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one actual projected offer revision');
  await open(page, 'friendrevision');
  const opener = page.getByRole('button',{name:'다른 카드…',exact:true});
  await opener.click();
  await settleDialog(page);
  const picker = page.getByRole('dialog',{name:'프렌드 카드 선택',exact:true});
  await picker.locator('.grid button.card').first().click();
  await settleDialog(page);
  const old = await picker.locator('.sheet-foot .primary').elementHandle();
  await expect(picker.locator('.sheet-foot .primary')).toBeEnabled();
  const rect = await old!.boundingBox();
  await page.mouse.move(rect!.x + rect!.width/2, rect!.y + rect!.height/2);
  await page.mouse.down();
  await page.clock.runFor(2600);
  await expect(picker).toHaveCount(0);
  await page.mouse.up();
  await old!.evaluate(button => { document.querySelector('.controls')!.append(button); (button as HTMLButtonElement).click(); button.remove(); });
  expect(await actions(page)).toEqual([]);
  await expect(opener).toBeFocused();
  await opener.click();
  await settleDialog(page);
  await expect(picker.getByRole('button',{name:'흑 조커',exact:true})).toHaveCount(0);
  await picker.locator('.grid button.card').first().click();
  await settleDialog(page);
  await picker.locator('.sheet-foot .primary').click();
  await expect.poll(() => actions(page)).toHaveLength(1);
  expect(await actions(page)).not.toContainEqual({CallFriend:{Card:{Joker:'Black'}}});
});

test('contract chips select without sending; a revised offer invalidates an old raise confirmation', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-light', 'one exact command selection and revision');
  await open(page, 'contractrevision');
  const raises = page.getByRole('radiogroup',{name:'공약 올리기',exact:true});
  await raises.getByRole('radio',{name:/16/}).first().click();
  await settleControls(page);
  expect(await actions(page)).toEqual([]);
  const confirm = page.locator('.desktop-confirm .command-button');
  await expect(confirm).toBeEnabled();
  const old = await confirm.elementHandle();
  const rect = await old!.boundingBox();
  await page.mouse.move(rect!.x + rect!.width/2, rect!.y + rect!.height/2);
  await page.mouse.down();
  await page.clock.runFor(2600);
  await expect(page.locator('.desktop-confirm')).toHaveCount(0);
  await page.mouse.up();
  await old!.evaluate(button => { document.querySelector('.controls')!.append(button); (button as HTMLButtonElement).click(); button.remove(); });
  expect(await actions(page)).toEqual([]);
  await settleControls(page);
  await raises.getByRole('radio',{name:/17/}).first().click();
  await settleControls(page);
  expect(await actions(page)).toEqual([]);
  await page.locator('.desktop-confirm .command-button').click();
  await expect.poll(() => actions(page)).toEqual([{Raise:{trump:'Spade',count:17}}]);
  await page.getByRole('radiogroup',{name:'기루다 변경',exact:true}).getByRole('radio',{name:/하트/}).click();
  expect(await actions(page)).toHaveLength(1);
});

test('discard batches lose prior membership on revision and only send newly offered cards', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one batch boundary through real hand controls');
  await open(page, 'discardrevision');
  const total = Number((await page.locator('.discard .count').innerText()).split('/')[1]);
  for (let i=0;i<total;i++) await page.locator('.hand button.card:not(.picked):not(.unplayable)').first().press('Enter');
  const discard = page.getByRole('button',{name:'버리기',exact:true});
  await expect(discard).toBeEnabled();
  const old = await discard.elementHandle();
  const rect = await old!.boundingBox();
  await page.mouse.move(rect!.x + rect!.width/2, rect!.y + rect!.height/2);
  await page.mouse.down();
  await page.clock.runFor(2600);
  await page.mouse.up();
  await old!.evaluate(button => { document.querySelector('.controls')!.append(button); (button as HTMLButtonElement).click(); button.remove(); });
  await expect(discard).toBeDisabled();
  await expect(page.locator('.hand .picked')).toHaveCount(0);
  expect(await actions(page)).toEqual([]);
  for (let i=0;i<total;i++) await page.locator('.hand button.card:not(.picked):not(.unplayable)').first().press('Enter');
  await discard.click();
  await expect.poll(() => actions(page)).toHaveLength(total);
  expect(await actions(page)).not.toContainEqual({Discard:{Joker:'Red'}});
});

test('friend own-card disclosure and stationary selection remain in the bounded sheet', async ({ page }) => {
  await open(page, 'friend');
  const opener = page.getByRole('button',{name:'다른 카드…',exact:true});
  await opener.click();
  await settleDialog(page);
  const picker = page.getByRole('dialog',{name:'프렌드 카드 선택',exact:true});
  const card = picker.locator('.own-head + .grid button.card').first();
  await card.scrollIntoViewIfNeeded();
  await settleDialog(page);
  const before = await card.boundingBox();
  await card.click();
  await settleDialog(page);
  await expect(card).toHaveAttribute('aria-pressed','true');
  expect(await card.boundingBox()).toEqual(before);
  await expect(picker.locator('.own-warning')).toContainText('혼자 플레이');
  await expect(picker.locator('.sheet-foot .primary')).toContainText('내 카드');
  expect(await actions(page)).toEqual([]);
  await picker.getByRole('button',{name:'취소',exact:true}).click();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('returning to the same bid value cannot revive its prior command target', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one command target ABA boundary');
  await open(page, 'bidding');
  const counts = page.getByRole('radiogroup',{name:'공약 수',exact:true});
  await counts.getByRole('radio',{name:'16',exact:true}).click();
  await page.clock.runFor(160);
  const old = await page.locator('.bid .actions .primary').elementHandle();
  await counts.getByRole('radio',{name:'17',exact:true}).click();
  await page.clock.runFor(160);
  await counts.getByRole('radio',{name:'16',exact:true}).click();
  await page.clock.runFor(160);
  await old!.evaluate(button => { document.querySelector('.bid .actions')!.append(button); (button as HTMLButtonElement).click(); button.remove(); });
  expect(await actions(page)).toEqual([]);
  await page.locator('.bid .actions .primary').click();
  await expect.poll(() => actions(page)).toEqual([{Bid:{trump:'Spade',count:16}}]);
});

test('the 400ms entry guard protects all commands while deal grace only holds bids', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one exact entry and server grace timeline');
  await page.goto('/preview?state=grace&room');
  await page.clock.runFor(192);
  await page.locator('.bid').waitFor();
  const pass = page.getByRole('button',{name:'패스',exact:true});
  const bid = page.locator('.bid .actions .primary');
  await expect(pass).toBeDisabled();
  await expect(bid).toBeDisabled();
  await page.clock.runFor(207);
  await expect(pass).toBeDisabled();
  await expect(bid).toBeDisabled();
  await page.clock.runFor(2);
  await expect(pass).toBeEnabled();
  await expect(bid).toBeDisabled();
  await pass.click();
  expect(await actions(page)).toEqual(['Pass']);
  // The preview records commands without evolving its offered state; this
  // lets the same initial bid demonstrate the server's separate 2000ms hold.
  await page.clock.runFor(1598);
  await expect(bid).toBeDisabled();
  await page.clock.runFor(2);
  await expect(bid).toBeEnabled();
});
