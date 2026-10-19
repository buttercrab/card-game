import { expect,test,type Page } from '@playwright/test';
const cards=(page:Page)=>page.locator('button[data-foundation-kind="card"]');
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');}
async function open(page:Page,fixture:string){await page.goto(`/preview?foundation=1&fixture=${fixture}`);await ready(page);}
async function pick(page:Page,index:number){const card=cards(page).nth(index);await card.scrollIntoViewIfNeeded();await card.click({position:{x:12,y:30}});await ready(page);}

test('single-card draft preserves order and footprint, keyboard focus and exact dispatch',async({page},info)=>{
  await open(page,'play');await expect(cards(page)).toHaveCount(10);
  await expect(page.getByRole('group',{name:'내 카드',exact:true}).getByRole('button')).toHaveCount(10);
  const pending=page.getByRole('button',{name:'선택 확정',exact:true});await expect(pending).toBeDisabled();
  const order=await cards(page).evaluateAll(elements=>elements.map(element=>element.getAttribute('data-foundation-node')));
  const before=await cards(page).first().evaluate(element=>JSON.parse((element as HTMLElement).dataset.foundationBox!));
  const dock=await page.locator('[data-foundation-node="dock"]').evaluate(element=>JSON.parse((element as HTMLElement).dataset.foundationBox!));
  const svg=await cards(page).first().evaluateHandle(element=>element.firstElementChild);
  await pick(page,0);await expect(cards(page).nth(0)).toHaveAttribute('aria-pressed','true');
  const after=await cards(page).first().evaluate(element=>JSON.parse((element as HTMLElement).dataset.foundationBox!));
  expect(before.y-after.y).toBe(14);
  expect(await page.locator('[data-foundation-node="dock"]').evaluate(element=>JSON.parse((element as HTMLElement).dataset.foundationBox!))).toEqual(dock);
  expect(await svg.evaluate(element=>element!.isConnected)).toBe(true);
  await pick(page,1);await expect(cards(page).nth(0)).toHaveAttribute('aria-pressed','false');
  await cards(page).nth(1).focus();await cards(page).nth(1).press('ArrowRight');
  await expect(cards(page).nth(2)).toBeFocused();await expect(cards(page).nth(2)).toHaveAttribute('aria-pressed','false');
  await cards(page).nth(2).press('Space');await ready(page);
  await expect(cards(page).nth(2)).toHaveAttribute('aria-pressed','true');await expect(cards(page).nth(2)).toBeFocused();
  expect(await cards(page).evaluateAll(elements=>elements.map(element=>element.getAttribute('data-foundation-node')))).toEqual(order);
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
  const submit=page.getByRole('button',{name:'선택 확정 카드 내기',exact:true});await submit.scrollIntoViewIfNeeded();await submit.click();
  await expect(page.locator('[data-foundation-action]')).toHaveText('{"Play":{"cardId":"card-2"}}');
  await expect(submit).toBeDisabled();
  await page.getByRole('button',{name:'새 선택지',exact:true}).click();await ready(page);
  await expect(cards(page).nth(2)).toHaveAttribute('aria-pressed','false');await expect(pending).toBeDisabled();
  await page.screenshot({path:`/tmp/foundation-cards-play-${info.project.name}.png`,fullPage:true});
});

test('three-card selection submits one exact unordered set and survives only compatible mounts',async({page})=>{
  await open(page,'discard');await expect(cards(page)).toHaveCount(13);
  for(const index of [5,1,3])await pick(page,index);
  await expect(page.locator('button[data-foundation-kind="card"][aria-pressed="true"]')).toHaveCount(3);
  await expect(cards(page).nth(0)).toBeDisabled();
  const submit=page.getByRole('button',{name:'선택 확정 3장 버리기',exact:true});await expect(submit).toBeEnabled();
  await page.getByRole('button',{name:'분리',exact:true}).click();await page.getByRole('button',{name:'다시 연결',exact:true}).click();await ready(page);
  await expect(page.locator('button[data-foundation-kind="card"][aria-pressed="true"]')).toHaveCount(3);
  await submit.scrollIntoViewIfNeeded();await submit.click();
  await expect(page.locator('[data-foundation-action]')).toHaveText('{"DiscardCards":["card-1","card-3","card-5"]}');
  await page.getByRole('button',{name:'권한 해제',exact:true}).click();await expect(cards(page)).toHaveCount(0);
});

test('selected card paint and native targets fit through resize; held submit expires',async({page})=>{
  await open(page,'discard');for(const index of [0,1,2])await pick(page,index);
  for(const [width,height]of [[320,568],[568,320],[768,1024],[1440,900],[390,844]]){
    await page.setViewportSize({width,height});await ready(page);
    await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(element=>element.getBoundingClientRect().width)).toBe(width-24);
    const failures=await cards(page).evaluateAll(elements=>{
      const failures:string[]=[];
      for(let i=0;i<elements.length;i++){
        const element=elements[i],box=element.getBoundingClientRect(),parent=element.parentElement!.getBoundingClientRect();
        if(box.top<parent.top+3||box.bottom>parent.bottom-3)failures.push('paint-envelope');
        if(i<elements.length-1&&elements[i+1].getBoundingClientRect().left-box.left<43.9)failures.push('small-exposed-target');
      }return failures;
    });expect(failures).toEqual([]);
  }
  const submit=page.getByRole('button',{name:'선택 확정 3장 버리기',exact:true});await submit.scrollIntoViewIfNeeded();await submit.focus();await page.keyboard.down('Space');
  await page.setViewportSize({width:768,height:1024});await ready(page);await page.keyboard.up('Space');
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
  await page.getByRole('button',{name:'새 선택지',exact:true}).click();await ready(page);
  await expect(page.locator('button[data-foundation-kind="card"][aria-pressed="true"]')).toHaveCount(0);
});

test('same-surface switches replace readonly images with real native card controls',async({page})=>{
  await open(page,'mighty');await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button',{name:'카드 내기 검증',exact:true}).click();await ready(page);
  await expect(cards(page)).toHaveCount(10);await pick(page,0);await expect(cards(page).first()).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'3장 선택 검증',exact:true}).click();await ready(page);await expect(cards(page)).toHaveCount(13);
  await expect(page.locator('button[data-foundation-kind="card"][aria-pressed="true"]')).toHaveCount(0);
  await page.getByRole('button',{name:'마이티',exact:true}).click();await ready(page);await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('[data-foundation-node="hand"] [data-foundation-kind="card"][role="img"]')).toHaveCount(10);
});

test('focused first and last selected cards keep the native outline inside both scroll edges',async({page},info)=>{
  await page.setViewportSize({width:320,height:568});await open(page,'play');
  await page.keyboard.press('Tab');
  for(const index of [0,9]){
    await pick(page,index);await page.keyboard.press('Tab');await cards(page).nth(index).focus();
    await cards(page).nth(index).evaluate(element=>element.scrollIntoView({block:'nearest',inline:'nearest'}));
    const ink=await cards(page).nth(index).evaluate(element=>{
      const box=element.getBoundingClientRect(),fan=element.parentElement!,view=fan.parentElement!.getBoundingClientRect();
      const css=getComputedStyle(element),outset=parseFloat(css.outlineWidth)+parseFloat(css.outlineOffset);
      return {outset,left:box.left-outset-view.left,right:view.right-box.right-outset,top:box.top-outset-view.top,bottom:view.bottom-box.bottom-outset};
    });
    expect(ink.outset).toBeGreaterThan(0);for(const side of ['left','right','top','bottom'] as const)expect(ink[side],side).toBeGreaterThanOrEqual(-.5);
  }
  await page.screenshot({path:`/tmp/foundation-cards-focus-${info.project.name}.png`,fullPage:true});
});
