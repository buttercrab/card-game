import {expect,test,type Locator,type Page} from '@playwright/test';
import {foundationBotButton,joinFoundation} from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`});
const ready=async(page:Page)=>expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
const settings=(page:Page)=>page.getByRole('dialog',{name:'설정',exact:true});
const font=(locator:Locator)=>locator.evaluate(element=>{const css=getComputedStyle(element);return{font:parseFloat(css.fontSize),line:parseFloat(css.lineHeight)};});
async function nativeMetrics(locator:Locator){return locator.evaluate(element=>{const native=element as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement,css=getComputedStyle(native);return{font:parseFloat(css.fontSize),line:parseFloat(css.lineHeight),computedLine:css.lineHeight,declaredLine:parseFloat(native.style.lineHeight),client:native.clientHeight,scroll:native.scrollHeight,paddingX:parseFloat(css.paddingLeft),paddingY:parseFloat(css.paddingTop),border:parseFloat(css.borderTopWidth),height:native.getBoundingClientRect().height};});}
async function reachable(dialog:Locator){
 // Check actual painted leaves, excluding labels painted inside their own native target.
 const leaves=dialog.locator('button,select,input,textarea,[data-foundation-kind="text"]');
 for(const leaf of await leaves.all()){
  await leaf.scrollIntoViewIfNeeded();
  expect(await leaf.evaluate(element=>{const box=element.getBoundingClientRect(),modal=element.closest('dialog')!.getBoundingClientRect();return box.left>=modal.left-1&&box.right<=modal.right+1&&box.top>=modal.top-1&&box.bottom<=modal.bottom+1;})).toBe(true);
 }
 const result=await dialog.evaluate(element=>{
  const controls=[...element.querySelectorAll<HTMLElement>('button,select,input,textarea')],rects=controls.map(control=>control.getBoundingClientRect());
  // Native scroll content may have a box behind a fixed dialog header while
  // being entirely clipped. Compare painted hit areas, not hidden scroll boxes.
  const painted=controls.map(control=>{const box=control.getBoundingClientRect();let left=box.left,right=box.right,top=box.top,bottom=box.bottom;for(let parent=control.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent),clip=parent.getBoundingClientRect();if(css.overflowX!=='visible'){left=Math.max(left,clip.left+parent.clientLeft);right=Math.min(right,clip.left+parent.clientLeft+parent.clientWidth);}if(css.overflowY!=='visible'){top=Math.max(top,clip.top+parent.clientTop);bottom=Math.min(bottom,clip.top+parent.clientTop+parent.clientHeight);}}return{left,right,top,bottom};});
  return{targets:rects.every(rect=>rect.width>=44&&rect.height>=44),overlaps:painted.flatMap((a,i)=>painted.slice(i+1).flatMap((b,j)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1?[{a:controls[i].dataset.foundationNode,b:controls[i+j+1].dataset.foundationNode,ar:a,br:b}]:[]))};
 });expect(result.targets).toBe(true);expect(result.overlaps).toEqual([]);
}

test('device text size scales real native typography and retains editing through responsive reallocation',async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'phone/light and desktop/dark typography proof');test.setTimeout(90000);
 const errors:string[]=[],mutations:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('websocket',socket=>socket.on('framesent',frame=>{const message=JSON.parse(String(frame.payload));if(['act','submit','submit_room'].includes(message.type))mutations.push(message.type);}));
 await page.addInitScript(()=>{if(!localStorage.getItem('foundation-text-seeded')){localStorage.setItem('foundation-text-seeded','1');localStorage.setItem('name',JSON.stringify('글자 크기 확인'));localStorage.setItem('mighty.settings',JSON.stringify({textScale:1,sound:false,music:false,speed:'off'}));}});
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);const{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);const baselineMutations=mutations.slice();
 const command=foundationBotButton(page);await expect(command).toBeEnabled();const baseline=await font(command);expect(baseline.font).toBe(15);
 await page.getByRole('button',{name:'설정',exact:true}).click();await expect(settings(page)).toBeVisible();
 const scale=settings(page).getByRole('combobox',{name:'글자 크기',exact:true});await expect(scale).toHaveValue('scale:01');await scale.selectOption({label:'200%'});await ready(page);await expect(scale).toHaveValue('scale:04');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mighty.settings')!).textScale)).toBe(2);
 expect(await settings(page).evaluate(element=>element.matches(':modal'))).toBe(true);await expect(page.locator('dialog:modal')).toHaveCount(1);
 expect(await font(settings(page).getByText('4색 덱',{exact:true}))).toMatchObject({font:32,line:48});expect(await font(settings(page).getByText('♦ 주황, ♣ 파랑',{exact:true}))).toMatchObject({font:28,line:40});
 const selectMetrics=await nativeMetrics(scale);expect(selectMetrics).toMatchObject({font:32,declaredLine:48,paddingX:12,paddingY:10,border:1});expect(['normal','48px']).toContain(selectMetrics.computedLine);expect(selectMetrics.client).toBeGreaterThanOrEqual(68);
 for(const [width,height] of [[390,844],[768,1024],[1440,900]]){await page.setViewportSize({width,height});await expect.poll(()=>page.locator('[data-foundation-node=table]').evaluate(element=>element.getBoundingClientRect().width)).toBe(width);await ready(page);await reachable(settings(page));await scale.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`settings-200-${width}.png`)});}
 await page.keyboard.press('Escape');await expect(settings(page)).toHaveCount(0);expect((await font(command)).font).toBe(baseline.font*2);
 // Name input and report textarea use the same native padding/border contract.
 await page.getByRole('button',{name:'설정',exact:true}).click();await settings(page).getByRole('button',{name:'이름 바꾸기',exact:true}).click();const nameDialog=page.getByRole('dialog',{name:'이름 바꾸기',exact:true}),nameInput=nameDialog.getByRole('textbox',{name:'이름',exact:true});
 expect(await nativeMetrics(nameInput)).toMatchObject({font:32,line:48,paddingX:12,paddingY:10,border:1});await page.keyboard.press('Escape');
 if(await settings(page).isVisible())await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'문제 신고',exact:true}).click();const report=page.getByRole('dialog',{name:'문제 신고',exact:true}),editor=report.getByRole('textbox',{name:'문제 설명',exact:true});
 await editor.fill('첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄');const reportMetrics=await nativeMetrics(editor);expect(reportMetrics).toMatchObject({font:32,line:48,paddingX:12,paddingY:10,border:1});expect(reportMetrics.client).toBeGreaterThanOrEqual(4*48+20);expect(reportMetrics.scroll).toBeLessThanOrEqual(reportMetrics.client+1);
 await editor.fill('첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄');expect((await nativeMetrics(editor)).scroll).toBeGreaterThan((await nativeMetrics(editor)).client);
 await editor.fill('native selection survives resize');await editor.focus();const retained=await editor.elementHandle();await editor.evaluate(element=>(element as HTMLTextAreaElement).setSelectionRange(2,8));
 for(const [width,height] of [[390,844],[768,1024],[1440,900]]){await page.setViewportSize({width,height});await expect.poll(()=>page.locator('[data-foundation-node=table]').evaluate(element=>element.getBoundingClientRect().width)).toBe(width);await ready(page);expect(await editor.evaluate((element,prior)=>element===prior,retained)).toBe(true);expect(await editor.evaluate(element=>({start:(element as HTMLTextAreaElement).selectionStart,end:(element as HTMLTextAreaElement).selectionEnd}))).toEqual({start:2,end:8});await reachable(report);await editor.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`report-200-${width}.png`)});}
 await retained!.dispose();await page.keyboard.press('Escape');if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'내 기록',exact:true}).click();const records=page.getByRole('dialog',{name:'내 기록',exact:true});
 for(const tab of await records.getByRole('tab').all()){expect((await font(tab)).font).toBe(30);await tab.click();await ready(page);}await reachable(records);await page.screenshot({path:info.outputPath('device-records-200.png')});await page.keyboard.press('Escape');
 expect(mutations).toEqual(baselineMutations);await page.reload();await ready(page);expect((await font(command)).font).toBe(30);await page.getByRole('button',{name:'설정',exact:true}).click();await expect(scale).toHaveValue('scale:04');expect(await nativeMetrics(scale)).toMatchObject({font:32,declaredLine:48});expect(errors).toEqual([]);
});
