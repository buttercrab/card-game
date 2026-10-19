import {expect,test,type Page} from '@playwright/test';
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');}
test('large finite choices use one native control without losing exact options or stale-frame fences',async({page},info)=>{
 test.skip(info.project.name!=='390x844-light'&&info.project.name!=='1440x900-dark','two responsive/theme paths');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/preview?foundation=1&fixture=large-choice');await ready(page);
 const select=page.getByRole('combobox',{name:'금액',exact:true});await expect(select.locator('option')).toHaveCount(197);await expect(page.getByRole('radio')).toHaveCount(0);
 await select.selectOption('197');await expect(select).toHaveValue('197');await expect(page.getByRole('button',{name:'확정 금액 197',exact:true})).toBeEnabled();await expect(page.locator('[data-foundation-action]')).toHaveText('');
 await select.selectOption('100');await expect(select).toHaveValue('100');await ready(page);
 // Keep native keyboard behavior; committing arrow navigation differs by browser/platform.
 await select.evaluate(el=>{el.addEventListener('keydown',event=>queueMicrotask(()=>el.setAttribute('data-key-prevented',String(event.defaultPrevented))),{once:true});});await select.focus();await select.press('ArrowDown');await expect(select).toHaveAttribute('data-key-prevented','false');await ready(page);const keyboardValue=await select.inputValue();
 // Simulate a native popup retaining an old selection through a canonical update.
 await select.dispatchEvent('pointerdown');await page.getByRole('button',{name:'새 선택지',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());await ready(page);
 await select.evaluate(el=>{el.value='137';el.dispatchEvent(new Event('change',{bubbles:true}));});await expect(select).toHaveValue(keyboardValue);
 await page.getByRole('button',{name:'제한된 선택지',exact:true}).click();await ready(page);
 const current=await select.inputValue();await expect(select.locator('option[value="1"]')).toBeDisabled();
 await select.evaluate(el=>{el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));});await expect(select).toHaveValue(current);
 await select.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await select.dispatchEvent('pointerdown');
 await page.setViewportSize({width:320,height:568});await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(el=>el.getBoundingClientRect().width)).toBe(296);await ready(page);
 await select.evaluate(el=>{el.value='196';el.dispatchEvent(new Event('change',{bubbles:true}));});await expect(select).toHaveValue(current);
 await select.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await select.dispatchEvent('pointerdown');await select.selectOption('196');await expect(select).toHaveValue('196');
 for(const [width,height] of [[320,568],[768,1024],[1440,900]]){
  await page.setViewportSize({width,height});await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(el=>el.getBoundingClientRect().width)).toBe(width-24);await ready(page);
  const box=await select.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);await expect(select.locator('option')).toHaveCount(197);
 }
 await page.getByRole('button',{name:'긴 이름',exact:true}).click();await page.getByRole('button',{name:'큰 글자',exact:true}).click();await ready(page);
 await select.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await select.dispatchEvent('pointerdown');await select.selectOption('196');await expect(select).toHaveValue('196');await expect(page.getByRole('button',{name:'확정 금액 196',exact:true})).toBeEnabled();
 await page.screenshot({path:`/tmp/foundation-native-choice-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'확정 금액 196',exact:true}).click();await expect(page.locator('[data-foundation-action]')).toHaveText('{"amount":196}');
 await page.getByRole('button',{name:'권한 해제',exact:true}).click();await expect(select).toHaveCount(0);expect(errors).toEqual([]);
 await page.goto('/preview?foundation=1&fixture=large-choice&stage=1');await page.setViewportSize({width:390,height:844});await ready(page);await select.scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/foundation-native-choice-phone-${info.project.name}.png`});
});
