import {expect,test,type Page} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false}));
    (window as unknown as {decisionActions:unknown[]}).decisionActions=[];
    window.addEventListener('preview-action',event=>{(window as unknown as {decisionActions:unknown[]}).decisionActions.push((event as CustomEvent).detail);});
  });
});
const actions=(page:Page)=>page.evaluate(()=>(window as unknown as {decisionActions:unknown[]}).decisionActions);
const bounds=(page:Page)=>page.locator('.table,.felt-area,.strip-area,.tray-area,.controls').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {class:node.className,x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};}));

// data-ready covers the application state; the renderer then settles its
// measured numeric tree. Compare reserved regions after that explicit gate.
async function settleGeometry(page:Page){
  await page.evaluate(async()=>{
    await document.fonts.ready;
    // Native dialog entrance animations use the browser timeline. Finish
    // them before asserting exact 44px targets and stationary card boxes.
    const dialog=document.querySelector('[role="dialog"]');
    if(dialog)await Promise.all(dialog.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
    for(let frame=0;frame<12;frame++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  });
}

test('the full friend picker is a bounded sheet that never grows the table or acts on selection',async({page},info)=>{
  await page.goto('/preview?state=friend&room');
  await page.locator('html[data-ready]').waitFor();
  await settleGeometry(page);
  const before=await bounds(page);
  const primary=page.locator('.controls .actions .primary');
  const originalLabel=await primary.innerText();
  const opener=page.getByRole('button',{name:'다른 카드…',exact:true});
  await opener.click();
  await settleGeometry(page);
  const picker=page.getByRole('dialog',{name:'프렌드 카드 선택',exact:true});
  await expect(picker).toBeVisible();
  expect(await bounds(page)).toEqual(before);
  await expect(picker.locator('.grid button.card')).toHaveCount(54);
  const sheet=await picker.boundingBox();
  expect(sheet!.height).toBeLessThanOrEqual(info.project.use.viewport!.height-16);
  expect(sheet!.y).toBeGreaterThanOrEqual(0);
  await picker.locator('.own-head + .grid button.card').first().click();
  await expect(picker.locator('.own-warning')).toContainText('혼자 플레이');
  expect(await actions(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(primary).toHaveText(originalLabel);
  expect(await bounds(page)).toEqual(before);
  await opener.click();
  await settleGeometry(page);
  const alternate=picker.locator('.grid button.card').first();
  const unselected=await alternate.boundingBox();
  expect(unselected!.width).toBeGreaterThanOrEqual(44);
  await alternate.click();
  expect(await alternate.boundingBox()).toEqual(unselected);
  expect(await actions(page)).toEqual([]);
  await picker.getByRole('button',{name:'취소',exact:true}).click();
  await expect(opener).toBeFocused();
  expect(await bounds(page)).toEqual(before);
  await opener.click();
  await settleGeometry(page);
  await picker.locator('.grid button.card').first().click();
  await picker.locator('.sheet-foot .primary').click();
  await expect(picker).toHaveCount(0);
  await expect.poll(()=>actions(page)).toHaveLength(1);
  expect(await actions(page)).toEqual([expect.objectContaining({CallFriend:expect.anything()})]);
  expect(await bounds(page)).toEqual(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('desktop contract changes and confirmation fit the decision band with animation gutters',async({page},info)=>{
  test.skip(!info.project.name.startsWith('1440'),'one desktop contract layout per theme');
  await page.goto('/preview?state=contract&room');
  await page.locator('html[data-ready]').waitFor();
  await settleGeometry(page);
  const controls=page.locator('.controls');
  expect((await controls.boundingBox())!.height).toBeLessThanOrEqual(160);
  await expect(page.locator('.table-frame')).toHaveAttribute('data-frame-controls-scroll','false');
  const before=await bounds(page);
  await page.getByRole('radiogroup',{name:'공약 올리기',exact:true}).getByRole('radio').first().click();
  await settleGeometry(page);
  await expect(page.locator('.desktop-confirm')).toBeVisible();
  expect(await actions(page)).toEqual([]);
  expect((await controls.boundingBox())!.height).toBeLessThanOrEqual(160);
  expect(await bounds(page)).toEqual(before);
  await page.locator('.desktop-confirm').click();
  await expect.poll(()=>actions(page)).toHaveLength(1);
  expect(await actions(page)).toEqual([expect.objectContaining({Raise:expect.anything()})]);
  await page.getByRole('radiogroup',{name:'기루다 변경',exact:true}).getByRole('radio',{name:/하트/}).click();
  await page.getByRole('radiogroup',{name:'바꿀 공약',exact:true}).getByRole('radio').first().click();
  await settleGeometry(page);
  expect((await controls.boundingBox())!.height).toBeLessThanOrEqual(160);
  expect(await actions(page)).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
