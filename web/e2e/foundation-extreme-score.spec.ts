import {expect,test} from '@playwright/test';
test('safe extreme scores and localized long totals remain readable at engine200%',async({page},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'two theme/emulation paths');test.setTimeout(45000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/preview?foundation=1&fixture=information-extreme&textScale=2');const surface=page.locator('.foundation-surface');await expect(surface).toHaveAttribute('data-foundation-status','ready');
 for(const [width,height]of [[390,844],[768,1024],[1440,900]]){
  await page.setViewportSize({width,height});await expect.poll(()=>surface.locator('[data-foundation-node=table]').evaluate(element=>element.getBoundingClientRect().width)).toBe(width-24);await expect(surface).toHaveAttribute('data-foundation-status','ready');
  if(!await page.getByRole('dialog',{name:'테이블 정보',exact:true}).count())await page.getByRole('button',{name:'테이블 정보',exact:true}).click();
  const toggle=page.getByRole('button',{name:/^점수판 (보기|접기)$/});if(await toggle.count()&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  const scores=page.getByRole('group',{name:'점수판',exact:true});await expect(scores).toHaveCount(1);await expect(scores).toContainText(String(Number.MAX_SAFE_INTEGER));await expect(scores).toContainText(String(-Number.MAX_SAFE_INTEGER));
  const outcome=await page.getByRole('dialog',{name:'테이블 정보',exact:true}).evaluate(host=>{
   const errors:string[]=[];let raw=0,localized=0;
   for(const element of host.querySelectorAll<HTMLElement>('[data-foundation-kind="text"]')){
    const value=element.textContent??'';if(!value.includes('9007199254740991')&&!value.includes('9,007,199,254,740,991'))continue;
    if(value.includes('9007199254740991'))raw++;if(value.includes('9,007,199,254,740,991'))localized++;
    const own=element.getBoundingClientRect(),css=getComputedStyle(element);if(parseFloat(css.fontSize)!==32)errors.push(`shrunk font ${css.fontSize}`);
    const text=element.firstChild;if(!text)continue;for(let index=0;index<text.textContent!.length;index++){const range=document.createRange();range.setStart(text,index);range.setEnd(text,index+1);for(const rect of range.getClientRects())if(rect.width&&((rect.left<own.left-1)||(rect.right>own.right+1)||(rect.top<own.top-1)||(rect.bottom>own.bottom+1)))errors.push(`glyph overflow ${value}`);}
   }return{errors,raw,localized};
  });expect(outcome.errors).toEqual([]);expect(outcome.raw).toBeGreaterThan(0);expect(outcome.localized).toBe(2);await scores.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`extreme-200-${width}.png`)});
 }
 expect(errors).toEqual([]);
});
