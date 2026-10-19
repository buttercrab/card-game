import {expect,test,type Page} from '@playwright/test';
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');}
test('engine room header and native dialogs own navigation, focus and confirmation across sizes',async({page},info)=>{
 test.skip(info.project.name!=='390x844-light'&&info.project.name!=='1440x900-dark','two viewport/theme paths');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/preview?foundation=1&fixture=shell');await ready(page);
 for(const [width,height] of [[390,844],[1440,900],[768,1024],[320,568]]){
  await page.setViewportSize({width,height});await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(el=>el.getBoundingClientRect().width)).toBe(width-24);await ready(page);
  await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');
  const menu=page.getByRole('button',{name:'메뉴',exact:true});await menu.click();await expect.poll(()=>page.locator('.foundation-surface').evaluate(el=>({status:(el as HTMLElement).dataset.foundationStatus,failure:(el as HTMLElement).dataset.foundationFailure??null}))).toEqual({status:'ready',failure:null});
  const dialog=page.getByRole('dialog',{name:'테이블 proof',exact:true});await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
  const rect=await dialog.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.y).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);expect(rect!.y+rect!.height).toBeLessThanOrEqual(height);
  await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.locator('.foundation-surface button[data-foundation-kind="command"]').filter({hasText:'패스'}).evaluateAll(elements=>elements.forEach(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true}))));await expect(page.locator('[data-foundation-action]')).toHaveText('');
  await dialog.getByRole('button',{name:'함께 있는 사람',exact:true}).click();const people=page.getByRole('dialog',{name:'함께 있는 사람',exact:true});await expect(people).toContainText('참여 대기');await expect(people).toContainText('이름 없이 관전 중 · 1명');
  await people.getByRole('button',{name:'닫기',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'함께 있는 사람',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'규칙 보기',exact:true}).click();const rules=page.getByRole('dialog',{name:'규칙 보기',exact:true});await expect(rules).toContainText('시작 패');await rules.getByRole('button',{name:'닫기',exact:true}).click();
  await dialog.getByRole('button',{name:'누적 점수',exact:true}).click();const scores=page.getByRole('dialog',{name:'누적 점수',exact:true});await expect(scores).toContainText('-100');await scores.getByRole('button',{name:'닫기',exact:true}).click();
  await page.screenshot({path:`/tmp/foundation-shell-${width}-${info.project.name}.png`});
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(menu).toBeFocused();
 }
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'테이블 나가기',exact:true}).click();
 const ask=page.getByRole('alertdialog',{name:'테이블을 나갈까요?',exact:true});await expect(ask).toContainText('봇이 대신');await ask.getByRole('button',{name:'취소',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:'테이블 나가기',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'나가기',exact:true}).click();await expect(page.locator('[data-foundation-action]')).toHaveText('"leave"');expect(errors).toEqual([]);
 await page.locator('button').filter({hasText:'권한 해제'}).evaluate(el=>(el as HTMLButtonElement).click());await expect(page.locator('dialog')).toHaveCount(0);
});
