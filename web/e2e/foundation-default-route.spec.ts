import {expect,test,type Page} from '@playwright/test';
import {joinFoundation} from './foundationHelpers';
async function isolated(page:Page){
 await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
 const queries=await page.evaluate(()=>{
  const values:string[]=[];const visit=(sheet:CSSStyleSheet|CSSGroupingRule)=>{for(const rule of sheet.cssRules){if(rule instanceof CSSMediaRule&&/width|height|orientation|aspect-ratio/.test(rule.conditionText))values.push(rule.conditionText);if('cssRules'in rule)visit(rule as CSSGroupingRule);}};
  for(const sheet of document.styleSheets)visit(sheet);return values;
 });expect(queries).toEqual([]);await expect(page.locator('.tray-area')).toHaveCount(0);
}
for(const game of ['mighty','poker'])test(`ordinary ${game} links boot the isolated engine without an opt-in`,async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real default-root route per game');
 const response=await request.post(`/api/games/${game}/rooms`,{data:{preset:game==='mighty'?'default':'holdem'}});expect(response.ok()).toBe(true);const{id}=await response.json();
 await page.goto(`/r/${id}`);await isolated(page);
 if(game==='mighty'){
  await joinFoundation(page,{name:'기본 엔진'});await page.goto(`/r/${id}?foundation=0`);await expect(page.locator('.seat .name').filter({hasText:'기본 엔진'})).toHaveCount(1);await expect(page.locator('.live-surface')).toHaveCount(0);
  await page.goto(`/r/${id}`);await isolated(page);
 }
});
test('Home create, code join and back navigation cross the document root boundary',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real Home root lifecycle');test.setTimeout(45000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');await expect(page.getByRole('button',{name:'테이블 만들기',exact:true})).toBeEnabled();let origin=await page.evaluate(()=>performance.timeOrigin);
 await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();await expect(page).toHaveURL(/\/r\/[a-z0-9]+$/);await isolated(page);expect(await page.evaluate(()=>performance.timeOrigin)).not.toBe(origin);
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});const{id}=await response.json();await page.goto('/');origin=await page.evaluate(()=>performance.timeOrigin);await page.getByRole('textbox',{name:'테이블 코드나 링크',exact:true}).fill(id);await page.getByRole('button',{name:'들어가기',exact:true}).click();await isolated(page);expect(await page.evaluate(()=>performance.timeOrigin)).not.toBe(origin);await expect(page).toHaveURL(new RegExp(`/r/${id}$`));
 await page.goto('/');origin=await page.evaluate(()=>performance.timeOrigin);await page.evaluate(id=>{history.pushState(null,'',`/r/${id}`);history.pushState(null,'','/about');},id);await page.goBack();await isolated(page);expect(await page.evaluate(()=>performance.timeOrigin)).not.toBe(origin);expect(errors).toEqual([]);
});
