import {writeFile} from 'node:fs/promises';
import {expect,test,type Page} from '@playwright/test';
import {foundationBotButton,joinFoundation} from './foundationHelpers';
import {presetRules} from '../src/lib/games/mighty/catalog';
const port=Number(process.env.PORT??4317);
test.use({baseURL:`http://127.0.0.1:${port+1}`,reducedMotion:'no-preference'});
async function move(page:Page){
 const confirmation=page.getByRole('button',{name:/^선택 확정 /});if(await confirmation.isEnabled({timeout:100}).catch(()=>false)){await confirmation.click();return;}
 const pass=page.getByRole('button',{name:'패스',exact:true});if(await pass.isEnabled({timeout:100}).catch(()=>false)){await pass.click();return;}
 const cards=page.locator('.live-surface button[data-foundation-kind="card"][aria-pressed="false"]:enabled');
 if(await cards.count()){await cards.first().click({position:{x:8,y:30}});const submit=page.getByRole('button',{name:/^선택 확정 /});if(await submit.isEnabled({timeout:100}).catch(()=>false))await submit.click();return;}
 const commands=page.locator(`.live-surface button[data-foundation-kind="command"][data-foundation-node^='["command",']:enabled:not([aria-expanded])`).filter({hasNotText:'딜미스'}).filter({hasNotText:'다음 판'}).filter({hasNotText:'준비'});if(await commands.count())await commands.first().click();
}
test('the actual last five public cards collect into the settled board without replay or animation-driven commands',async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'real phone and desktop normal-motion final collection');test.setTimeout(150000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  localStorage.setItem('name',JSON.stringify('마지막 트릭'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,haptics:false,speed:'normal'}));
  const scope=window as typeof window&{finalCollection:{done:boolean;hold:boolean;starts:number;animations:Animation[];sent:unknown[];doneReceipt?:unknown}};
  scope.finalCollection={done:false,hold:true,starts:0,animations:[],sent:[]};const Native=WebSocket;
  window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.type==='state'){const done=message.view?.phase?.Done;if(done){const wanted=new Set((done.tricks?.at(-1)?.plays??[]).map((play:{card:unknown})=>JSON.stringify(play.card)));scope.finalCollection.doneReceipt={version:message.version,frame:document.querySelector<HTMLElement>('.live-surface')?.dataset.foundationFrame,flightCount:document.querySelector('[data-foundation-flight]')?.children.length??0,cards:[...document.querySelectorAll<HTMLElement>('.live-surface [data-foundation-kind="card"][data-foundation-entity]')].filter(element=>wanted.has(element.dataset.foundationEntity)).map(element=>{const box=element.getBoundingClientRect(),art=element.firstElementChild,ancestors=[];for(let node:HTMLElement|null=element;node;node=node.parentElement){const r=node.getBoundingClientRect(),css=getComputedStyle(node);ancestors.push({id:node.dataset.foundationNode??node.tagName,x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:node.clientWidth,clientHeight:node.clientHeight,scrollTop:node.scrollTop,scrollLeft:node.scrollLeft,overflow:css.overflow,transform:css.transform,opacity:css.opacity,aria:node.getAttribute('aria-hidden')});}return{id:element.dataset.foundationEntity,zone:element.dataset.foundationZone,box:{x:box.x,y:box.y,width:box.width,height:box.height},artOpacity:art?getComputedStyle(art).opacity:null,ancestors};})};}scope.finalCollection.done=!!done;}});}send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string'){const message=JSON.parse(data);if(['act','submit','submit_room'].includes(message.type))scope.finalCollection.sent.push(message);}super.send(data);}};
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(scope.finalCollection.hold&&scope.finalCollection.done&&this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight')&&this.dataset.flightToZone==='captured'){scope.finalCollection.starts++;scope.finalCollection.animations.push(animation);animation.pause();animation.currentTime=0;}return animation;};
 });
 const rules=presetRules('default');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});expect(response.ok()).toBe(true);const{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);
 for(let index=0;index<4;index++){await foundationBotButton(page).click();if(index<3)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();
 const result=page.getByRole('group',{name:'이번 판 결과',exact:true});
 const nativeDone=()=>page.evaluate(()=>(window as typeof window&{finalCollection:{done:boolean}}).finalCollection.done);
 await expect.poll(async()=>{if(await nativeDone())return true;await move(page);return nativeDone();},{timeout:100000,intervals:[100]}).toBe(true);
 const portal=page.locator('[data-foundation-flight]'),ghosts=portal.locator(':scope > svg[data-flight-to-zone="captured"]');
 const diagnostic=async()=>page.evaluate(()=>{
  const host=document.querySelector<HTMLElement>('.live-surface')!,scope=(window as typeof window&{finalCollection:{done:boolean;hold:boolean;starts:number;animations:Animation[];sent:unknown[];doneReceipt?:unknown}}).finalCollection;
  const bounds=(element:Element)=>{const box=element.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height};};
  return{done:scope.done,doneReceipt:scope.doneReceipt,starts:scope.starts,animationStates:scope.animations.map(animation=>animation.playState),commands:scope.sent.length,status:host.dataset.foundationStatus,flightStatus:host.dataset.foundationFlightStatus,geometry:host.dataset.foundationFlightGeometry,clear:host.dataset.foundationFlightClear,invalidation:host.dataset.foundationFlightInvalidation,captured:[...host.querySelectorAll<HTMLElement>('[data-foundation-kind="card"][data-foundation-zone="captured"]')].map(element=>({id:element.dataset.foundationEntity,label:element.getAttribute('aria-label'),box:bounds(element)})),overview:[...host.querySelectorAll<HTMLElement>('[data-foundation-node]')].filter(element=>element.dataset.foundationNode?.includes('overview')).map(element=>({id:element.dataset.foundationNode,box:bounds(element),opacity:getComputedStyle(element).opacity,hidden:element.getAttribute('aria-hidden')}))};
 });
 try{
  await expect(ghosts).toHaveCount(5);expect(await portal.evaluate(element=>element.inert)).toBe(true);
  expect(await ghosts.evaluateAll(elements=>elements.every(element=>element.getAnimations().length>0&&element.getAnimations().every(animation=>animation.playState==='paused')))).toBe(true);
  const before=await diagnostic();expect(before.done).toBe(true);expect(before.starts).toBe(5);
  // Terminal continuation is deliberately unavailable until the exact cohort lands.
  await expect(page.getByRole('button',{name:'다음 판',exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('actual-final-collection-held.png'),fullPage:true});
  await portal.evaluate(()=>{const scope=(window as typeof window&{finalCollection:{hold:boolean;animations:Animation[]}}).finalCollection;scope.hold=false;for(const animation of scope.animations)if(animation.playState==='paused')animation.play();});
  await expect(portal).toHaveCount(0);await expect(result).toBeVisible();const after=await diagnostic();expect(after.commands).toBe(before.commands);expect(after.captured).toHaveLength(5);expect(errors).toEqual([]);
  const receiptPath=info.outputPath('actual-final-collection.json');await writeFile(receiptPath,JSON.stringify({before,after,errors},null,2));await info.attach('actual-final-collection',{path:receiptPath,contentType:'application/json'});
  await page.reload();await expect(result).toBeVisible();await expect(portal).toHaveCount(0);const restored=await diagnostic();expect(restored.starts).toBe(0);expect(restored.commands).toBe(0);
 }catch(error){const path=info.outputPath('actual-final-collection-failure.json');await writeFile(path,JSON.stringify({diagnostic:await diagnostic(),errors},null,2));await info.attach('actual-final-collection-failure',{path,contentType:'application/json'});await page.screenshot({path:info.outputPath('actual-final-collection-failure.png'),fullPage:true});throw error;}
});
