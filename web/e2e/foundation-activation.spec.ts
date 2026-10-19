import {expect,test,type Page} from '@playwright/test';
const ready=async(page:Page)=>{await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');};
const hand=(page:Page)=>page.locator('[data-foundation-zone="hand"]');
const deal=(page:Page)=>page.getByRole('button',{name:'한 장 나누기',exact:true});
const nativeClick=async(page:Page)=>{await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));await deal(page).evaluate(element=>(element as HTMLButtonElement).click());await ready(page);};
async function open(page:Page){await page.goto('/preview?foundation=1&fixture=flow');await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});await ready(page);}
test('direct native click proxy admits successive fresh offers exactly once each',async({page})=>{
 await open(page);await nativeClick(page);await expect(hand(page)).toHaveCount(1);
 await nativeClick(page);await expect(hand(page)).toHaveCount(2);
 // Two same-task clicks still share one canonical offer/admission.
 await deal(page).evaluate(element=>{(element as HTMLButtonElement).click();(element as HTMLButtonElement).click();});await ready(page);await expect(hand(page)).toHaveCount(3);
});
test('held Enter repeats cannot rebind to the next command offer',async({page})=>{
 await open(page);await deal(page).scrollIntoViewIfNeeded();await deal(page).focus();await page.keyboard.down('Enter');await ready(page);await expect(hand(page)).toHaveCount(1);
 await deal(page).focus();await page.keyboard.down('Enter');await page.keyboard.down('Enter');await expect(hand(page)).toHaveCount(1);
 await page.keyboard.up('Enter');await nativeClick(page);await expect(hand(page)).toHaveCount(2);
});
test('Space release and pointer release retain old frames across offer replacement',async({page})=>{
 await open(page);await deal(page).scrollIntoViewIfNeeded();await deal(page).focus();await page.keyboard.down('Space');
 await page.getByRole('button',{name:'새 선택지',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await ready(page);
 await deal(page).focus();await page.keyboard.up('Space');await expect(hand(page)).toHaveCount(0);
 await nativeClick(page);await expect(hand(page)).toHaveCount(1);
 const button=deal(page);await button.scrollIntoViewIfNeeded();const box=(await button.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.getByRole('button',{name:'새 선택지',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await ready(page);await page.mouse.up();await expect(hand(page)).toHaveCount(1);
 await nativeClick(page);await expect(hand(page)).toHaveCount(2);
});
test('cancelled and blurred physical input cannot turn into direct clicks, then release restores AT',async({page})=>{
 await open(page);await deal(page).scrollIntoViewIfNeeded();await deal(page).focus();await page.keyboard.down('Space');
 await page.locator('.foundation-surface').evaluate(host=>host.dispatchEvent(new Event('scroll')));
 await page.keyboard.up('Space');await expect(hand(page)).toHaveCount(0);await nativeClick(page);await expect(hand(page)).toHaveCount(1);
 await deal(page).focus();await page.keyboard.down('Space');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space');await expect(hand(page)).toHaveCount(1);await nativeClick(page);await expect(hand(page)).toHaveCount(2);
});
test('direct synthetic clicks cannot activate modal underlay',async({page})=>{
 await page.goto('/preview?foundation=1&fixture=shell');await ready(page);await page.getByRole('button',{name:'메뉴',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await ready(page);
 await expect(page.getByRole('dialog')).toBeVisible();await page.locator('.foundation-surface button').filter({hasText:'패스'}).evaluateAll(elements=>elements.forEach(element=>(element as HTMLButtonElement).click()));await expect(page.locator('[data-foundation-action]')).toHaveText('');
});

test('lost release on window blur permits AT while a later stale keyup stays fenced',async({page})=>{
 await open(page);await deal(page).scrollIntoViewIfNeeded();await deal(page).focus();await page.keyboard.down('Space');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await nativeClick(page);await expect(hand(page)).toHaveCount(1);
 await deal(page).focus();await page.keyboard.up('Space');await expect(hand(page)).toHaveCount(1);await nativeClick(page);await expect(hand(page)).toHaveCount(2);
});

test('unmatched Space release cannot activate a replacement after remount or revoke',async({page})=>{
 await open(page);await deal(page).scrollIntoViewIfNeeded();await deal(page).focus();await page.keyboard.down('Space');
 await page.getByRole('button',{name:'분리',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await page.getByRole('button',{name:'다시 연결',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await ready(page);
 await deal(page).focus();await page.keyboard.up('Space');await expect(hand(page)).toHaveCount(0);await nativeClick(page);await expect(hand(page)).toHaveCount(1);
 await deal(page).focus();await page.keyboard.down('Space');await page.getByRole('button',{name:'권한 해제',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await page.getByRole('button',{name:'새 선택지',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await ready(page);
 await deal(page).focus();await page.keyboard.up('Space');await expect(hand(page)).toHaveCount(1);await nativeClick(page);await expect(hand(page)).toHaveCount(2);
});
