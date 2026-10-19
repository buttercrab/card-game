import {writeFile} from 'node:fs/promises';
import {expect,test,type Page,type TestInfo} from '@playwright/test';
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');}
async function card(page:Page,id:string){const button=page.getByRole('button',{name:id.replace(':',' '),exact:true});await button.scrollIntoViewIfNeeded();await button.click({position:{x:12,y:24}});await ready(page);}
async function selected(page:Page){await page.getByRole('button',{name:/^선택 확정/}).click();await ready(page);}
async function nextViewer(page:Page){await page.getByRole('button',{name:'다음 플레이어 시점',exact:true}).click();await ready(page);}
async function declareSuit(page:Page,suit:string){
 const select=page.getByRole('combobox',{name:'선언 무늬',exact:true});
 if(await select.count()){await expect(select).toBeVisible();await select.selectOption(suit);await ready(page);await expect(page.getByRole('combobox',{name:'선언 무늬',exact:true})).toHaveValue(suit);}
 else {await page.getByRole('radiogroup',{name:'선언 무늬',exact:true}).getByRole('radio',{name:suit,exact:true}).click();await ready(page);}
}
async function showWinner(page:Page,winner:string,info:TestInfo){
 // The fixture marks its outcome essential: it must be visible without a disclosure.
 const status=page.locator(`[data-foundation-kind="text"][data-foundation-node='${JSON.stringify(['active-essential-fact','status'])}']`);
 await expect(status).toHaveCount(1);await expect(status).toHaveAttribute('data-foundation-node',JSON.stringify(['active-essential-fact','status']));
 await expect(status).toContainText(winner);await expect(status).toBeVisible();
 const paint=await status.evaluate((element,winner)=>{
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),texts:Text[]=[];let child:Node|null;
  while((child=walker.nextNode()))texts.push(child as Text);
  const content=texts.map(text=>text.data).join(''),start=content.indexOf(winner);
  if(start<0||content.indexOf(winner,start+1)>=0)return {painted:false,visible:false,glyphs:0};
  const endpoint=(offset:number)=>{for(const text of texts){if(offset<=text.length)return {text,offset};offset-=text.length;}throw Error('Missing winner text endpoint');};
  let left=0,top=0,right=innerWidth,bottom=innerHeight,painted=true;
  for(let parent:HTMLElement|null=element as HTMLElement;parent;parent=parent.parentElement){
   const css=getComputedStyle(parent),box=parent.getBoundingClientRect();
   if(css.display==='none'||css.visibility!=='visible'||css.contentVisibility==='hidden'||Number(css.opacity)<=0||parent.hidden||parent.getAttribute('aria-hidden')==='true')painted=false;
   if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,box.left+parent.clientLeft);right=Math.min(right,box.left+parent.clientLeft+parent.clientWidth);}
   if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,box.top+parent.clientTop);bottom=Math.min(bottom,box.top+parent.clientTop+parent.clientHeight);}
  }
  let offset=start;const boxes:DOMRect[]=[];
  for(const point of winner){if(!/\s/u.test(point)){const from=endpoint(offset),to=endpoint(offset+point.length),range=document.createRange();range.setStart(from.text,from.offset);range.setEnd(to.text,to.offset);boxes.push(...[...range.getClientRects()].filter(box=>box.width>0&&box.height>0));}offset+=point.length;}
  return {painted,visible:boxes.length>0&&boxes.every(box=>box.left>=left-.5&&box.top>=top-.5&&box.right<=right+.5&&box.bottom<=bottom+.5),glyphs:boxes.length,clip:{left,top,right,bottom},scroll:{x:scrollX,y:scrollY},rectangles:boxes.map(box=>({left:box.left,top:box.top,right:box.right,bottom:box.bottom})),ancestors:(()=>{const rows=[];for(let node:HTMLElement|null=element as HTMLElement;node;node=node.parentElement){const r=node.getBoundingClientRect(),css=getComputedStyle(node);rows.push({id:node.dataset.foundationNode??node.tagName,y:r.y,height:r.height,scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,overflow:css.overflow});}return rows;})()};
 },winner);
 await writeFile(info.outputPath('essential-winner-paint.json'),JSON.stringify({winner,paint},null,2));await info.attach('essential-winner-paint',{body:JSON.stringify({winner,paint}),contentType:'application/json'});if(!paint.visible)await page.screenshot({path:info.outputPath('essential-winner-clipped.png'),fullPage:true});
 expect(paint.painted,'essential winner must be painted before opening details').toBe(true);expect(paint.glyphs).toBeGreaterThan(0);expect(paint.visible,'every winner glyph must fit the current viewport and all native ancestor clips').toBe(true);
 await expect(page.locator('[data-foundation-zone="hand"]')).toHaveCount(0);
 const opener=page.getByRole('button',{name:'테이블 정보',exact:true});
 if(await opener.count()){await opener.click();await ready(page);const information=page.getByRole('dialog',{name:'테이블 정보',exact:true});await expect(information).toBeVisible();const fact=information.locator('[data-foundation-kind="text"]').filter({hasText:winner});await expect(fact).toHaveCount(1);await expect(fact).toHaveText(`진행: ${winner}`);await expect(fact).toBeVisible();}
}
test('Hulla completes draw meld target discard and empty-hand finish through shared controls',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/preview?foundation=1&fixture=hulla-flow&stage=1');await ready(page);
 await page.getByRole('button',{name:'한 장 받기',exact:true}).click();await ready(page);
 for(const id of ['Club:3','Club:4','Club:5'])await card(page,id);await selected(page);
 await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-action','{"kind":"meld","cardIds":["Club:3","Club:4","Club:5"]}');
 await page.getByRole('button',{name:'Club:6 → meld:1',exact:true}).click();await ready(page);
 await card(page,'Heart:10');await selected(page);
 await page.getByRole('button',{name:'한 장 받기',exact:true}).click();await ready(page);
 await page.getByRole('button',{name:'Heart:8 → public:hearts',exact:true}).click();await ready(page);
 await page.getByRole('button',{name:'Heart:9 → public:hearts',exact:true}).click();await ready(page);
 await showWinner(page,'플레이어 1 승리',info);
 await page.screenshot({path:`/tmp/foundation-hulla-complete-${info.project.name}.png`,fullPage:true});
 const information=page.getByRole('dialog',{name:'테이블 정보',exact:true});if(await information.count()){await information.getByRole('button',{name:'닫기',exact:true}).click();await ready(page);}
 await page.getByRole('button',{name:'다시 시작',exact:true}).click();await ready(page);await page.getByRole('button',{name:'한 장 받기',exact:true}).click();await ready(page);await expect(page.getByRole('button',{name:'Heart 10',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
test('One Card declares suit counters attack draws exact penalty and completes both authorized views',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/preview?foundation=1&fixture=one-card-flow&stage=1');await ready(page);
 await declareSuit(page,'Heart');
 await page.getByRole('button',{name:/^내기 확정/}).click();await ready(page);
 await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-action','{"kind":"play","cardId":"Spade:8","suit":"Heart"}');await nextViewer(page);
 await card(page,'Heart:5');await selected(page);await nextViewer(page);
 await card(page,'Heart:2');await selected(page);await nextViewer(page);
 await card(page,'Diamond:2');await selected(page);await nextViewer(page);
 await page.getByRole('button',{name:'페널티 4장 받기',exact:true}).click();await ready(page);
 await expect(page.locator('[data-foundation-zone="hand"]')).toHaveCount(5);await nextViewer(page);
 await page.getByRole('button',{name:'한 장 받기',exact:true}).click();await ready(page);await nextViewer(page);
 await card(page,'Diamond:5');await selected(page);await nextViewer(page);
 await card(page,'Diamond:9');await selected(page);await nextViewer(page);
 await page.getByRole('button',{name:'한 장 받기',exact:true}).click();await ready(page);await nextViewer(page);
 await card(page,'Spade:9');await selected(page);
 await showWinner(page,'플레이어 2 승리',info);
 await page.screenshot({path:`/tmp/foundation-one-card-complete-${info.project.name}.png`,fullPage:true});expect(errors).toEqual([]);
});
