import {expect,test,type Page,type Locator} from '@playwright/test';
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');}
async function bounds(page:Page){return page.locator('.foundation-surface').evaluate(host=>{
 const failures:string[]=[];
 for(const el of host.querySelectorAll<HTMLElement>('[data-foundation-kind="text"]')){
  const box=el.getBoundingClientRect(),text=el.firstChild;
  if(!text)continue;
  // pre-wrap can hang invisible spaces at a line end. Check painted glyphs.
  for(const match of (text.textContent??'').matchAll(/\S+/gu)){
   const range=document.createRange();range.setStart(text,match.index!);range.setEnd(text,match.index!+match[0].length);
   for(const rect of range.getClientRects())if(rect.left<box.left-1||rect.right>box.right+1||rect.top<box.top-1||rect.bottom>box.bottom+1)failures.push(JSON.stringify({text:el.textContent,id:el.dataset.foundationNode,left:rect.left-box.left,right:rect.right-box.right,top:rect.top-box.top,bottom:rect.bottom-box.bottom}));
  }
 }
 return failures;
});}
// Compact tables expose the complete read-only information through the native
// dialog; desktop tables keep it in the measured sidebar.
async function informationScope(page:Page):Promise<Locator>{
 const rail=page.locator('[data-foundation-node="table-sidebar"]');
 if(await rail.count())return rail;
 await page.getByRole('button',{name:'테이블 정보',exact:true}).click();await ready(page);
 const dialog=page.getByRole('dialog',{name:'테이블 정보',exact:true});await expect(dialog).toBeVisible();return dialog;
}
async function closeInformation(page:Page){const dialog=page.getByRole('dialog',{name:'테이블 정보',exact:true});if(await dialog.count()){await dialog.getByRole('button',{name:'닫기',exact:true}).click();await expect(dialog).toHaveCount(0);await ready(page);}}
async function checkInformation(page:Page,scope:Locator){
 await expect(scope.getByRole('img',{name:'스페이드',exact:true})).toHaveCount(1);
 await expect(scope.getByRole('img',{name:'마이티',exact:true})).toHaveCount(1);
 await expect(scope.locator('[data-progress-segment]')).toHaveCount(20);
 const toggle=scope.getByRole('button',{name:/^점수판 (보기|접기)$/});
 if(await toggle.count()){if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');}
 const scoreboard=scope.getByRole('group',{name:'점수판',exact:true});await expect(scoreboard).toHaveCount(1);
 await expect(scoreboard.getByRole('group',{name:/ · 점수 [0-4] · 누적 -?\d+$/})).toHaveCount(5);
 expect(await bounds(page)).toEqual([]);
 // Prove every information label is reachable through its declared native
 // viewport, rather than accepting DOM presence outside a clipping ancestor.
 for(const leaf of await scope.locator('[data-foundation-kind="text"]').all()){
  await leaf.scrollIntoViewIfNeeded();
  expect(await leaf.evaluate(element=>{
   const own=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;
   for(let parent=element.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent),box=parent.getBoundingClientRect();if(css.visibility!=='visible'||css.display==='none'||Number(css.opacity)===0||parent.getAttribute('aria-hidden')==='true')return false;if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,box.left+parent.clientLeft);right=Math.min(right,box.left+parent.clientLeft+parent.clientWidth);}if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,box.top+parent.clientTop);bottom=Math.min(bottom,box.top+parent.clientTop+parent.clientHeight);}}
   const text=element.firstChild;if(!text)return false;
   for(const match of (text.textContent??'').matchAll(/\S/gu)){const range=document.createRange();range.setStart(text,match.index!);range.setEnd(text,match.index!+match[0].length);for(const ink of range.getClientRects())if(ink.left<Math.max(left,own.left)-1||ink.right>Math.min(right,own.right)+1||ink.top<Math.max(top,own.top)-1||ink.bottom>Math.min(bottom,own.bottom)+1)return false;}return true;
  })).toBe(true);
 }
}
test('structured information retains trump, called card and aligned score rows across resize',async({page},info)=>{
 test.skip(info.project.name!=='390x844-light'&&info.project.name!=='1440x900-dark','two theme/viewport paths');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/preview?foundation=1&fixture=information&stage=1');await ready(page);
 await expect(page).toHaveTitle(/.+/);
 for(const [width,height] of [[1440,900],[390,844],[768,1024],[320,568],[1440,900]]){
  await page.setViewportSize({width,height});await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(el=>el.getBoundingClientRect().width)).toBe(width-24);await ready(page);
  await checkInformation(page,await informationScope(page));
  await page.screenshot({path:`/tmp/foundation-information-${width}-${info.project.name}.png`,fullPage:true});
  await closeInformation(page);
 }
 await page.goto('/preview?foundation=1&fixture=information&stage=1&longName=1&textScale=1.5');await ready(page);
 for(const [width,height] of [[320,568],[768,1024],[1440,900]]){await page.setViewportSize({width,height});await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(el=>el.getBoundingClientRect().width)).toBe(width-24);await ready(page);await checkInformation(page,await informationScope(page));await closeInformation(page);}
 await page.screenshot({path:'/tmp/foundation-information-stress.png',fullPage:true});
 await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-action','');expect(errors).toEqual([]);
 await page.goto('/preview?foundation=1&fixture=information&stage=1');await ready(page);
 for(const [width,height] of [[1440,1100],[390,844]]){await page.setViewportSize({width,height});await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(el=>el.getBoundingClientRect().width)).toBe(width-24);await ready(page);await page.screenshot({path:`/tmp/foundation-information-stage-${width}-${info.project.name}.png`});}
});
