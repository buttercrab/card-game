import {expect,test,type Page} from '@playwright/test';
import {foundationBotButton, joinFoundation } from './foundationHelpers';
import {presetRules} from '../src/lib/games/mighty/catalog';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`,reducedMotion:'no-preference'});
const hand=(page:Page)=>page.locator('.live-surface [data-foundation-kind="card"][data-foundation-zone="hand"]');
async function act(page:Page){
 const pass=page.getByRole('button',{name:'패스',exact:true});if(await pass.isEnabled({timeout:100}).catch(()=>false)){await pass.click({timeout:1000});return;}
 const cards=page.locator('.live-surface button[data-foundation-kind="card"][aria-pressed]:enabled');
 if(await cards.count()){await cards.first().click({position:{x:8,y:30},timeout:1000});const submit=page.getByRole('button',{name:/^선택 확정 /});if(await submit.isEnabled({timeout:100}).catch(()=>false))await submit.click({timeout:1000});return;}
 const commands=page.locator(`.live-surface button[data-foundation-kind="command"][data-foundation-node^='["command",']:enabled:not([aria-expanded])`).filter({hasNotText:'딜미스'}).filter({hasNotText:'다음 판'}).filter({hasNotText:'준비'});if(await commands.count())await commands.first().click({timeout:1000});
}
test('completed public trick resets into a fresh back-only fifty-card deal without identity reuse or reload replay',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one real two-hand motion lifecycle');test.setTimeout(120000);await page.setViewportSize({width:1440,height:1200});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  localStorage.setItem('name',JSON.stringify('다음 판 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'normal'}));
  const scope=window as typeof window&{holdNextDeal:boolean;nextDealStarts:number;transferDiagnostics:string[];transferGeometry:string[];transferInvalidations:string[];transferClears:string[]};scope.holdNextDeal=false;scope.nextDealStarts=0;scope.transferDiagnostics=[];scope.transferGeometry=[];scope.transferInvalidations=[];scope.transferClears=[];
  new MutationObserver(records=>{if(scope.holdNextDeal)for(const record of records){if(record.attributeName==='data-foundation-flight-clear'){const value=(record.target as HTMLElement).dataset.foundationFlightClear;if(value){scope.transferClears.push(value);if(scope.transferClears.length>8)scope.transferClears.shift();}}else if(record.attributeName==='data-foundation-flight-invalidation'){const value=(record.target as HTMLElement).dataset.foundationFlightInvalidation;if(value){scope.transferInvalidations.push(value);if(scope.transferInvalidations.length>8)scope.transferInvalidations.shift();}}else if(record.attributeName==='data-foundation-flight-geometry'){const value=(record.target as HTMLElement).dataset.foundationFlightGeometry;if(value){scope.transferGeometry.push(value);if(scope.transferGeometry.length>8)scope.transferGeometry.shift();}}else{scope.transferDiagnostics.push(record.oldValue??'unset');if(scope.transferDiagnostics.length>40)scope.transferDiagnostics.shift();}}}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-foundation-flight-status','data-foundation-flight-geometry','data-foundation-flight-invalidation','data-foundation-flight-clear'],attributeOldValue:true});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise<void>((_resolve,reject)=>{(window as typeof window&{rejectDealClipboard?:()=>void}).rejectDealClipboard=()=>reject(new Error('controlled clipboard failure'));})}});
  const animate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(scope.holdNextDeal&&this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight')){scope.nextDealStarts++;animation.pause();animation.currentTime=0;}return animation;};
 });
 // This checks one next-hand cohort; autonomous bot Misdeal has its own
 // held-redeal tests and would legitimately contribute another fifty starts.
 const rules=presetRules('default');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});const {id}=await response.json();await page.goto(`/r/${id}?foundation=1`);
 await joinFoundation(page);for(let i=0;i<4;i++){await foundationBotButton(page).click();if(i<3)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();await expect(hand(page)).toHaveCount(10);
 const next=page.getByRole('button',{name:'다음 판',exact:true});await expect(async()=>{if(await next.isEnabled({timeout:100}).catch(()=>false))return;await act(page);await expect(next).toBeEnabled({timeout:200});}).toPass({timeout:90000,intervals:[100]});
 await expect(hand(page)).toHaveCount(0);const nextDeck=page.getByRole('group',{name:'다음 판 덱 · 53장',exact:true});await expect(nextDeck).toBeVisible();await expect(nextDeck.locator('[data-foundation-zone="stock"][data-foundation-kind="card"] > svg[data-card-back]')).toBeVisible();
 const overview=page.locator('.live-surface').getByRole('table');await expect(overview).toHaveCount(1);await expect(overview.locator('[data-foundation-kind="card"][data-foundation-entity=""][data-foundation-zone=""]')).toHaveCount(50);
 const publicCards=page.locator('.live-surface [data-foundation-zone="captured"][data-foundation-kind="card"]');await expect(publicCards).toHaveCount(5);
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));const scope=window as typeof window&{holdNextDeal:boolean;nextDealHeights:number[]};scope.holdNextDeal=true;scope.nextDealHeights=[];new ResizeObserver(entries=>scope.nextDealHeights.push(entries[0].contentRect.height)).observe(document.querySelector('.live-surface')!);});
 await next.click();await expect(hand(page)).toHaveCount(10);
 const portal=page.locator('[data-foundation-flight]');await expect(portal.locator(':scope > svg'),JSON.stringify(await page.locator('.live-surface').evaluate(element=>({status:(element as HTMLElement).dataset.foundationFlightStatus,geometry:(element as HTMLElement).dataset.foundationFlightGeometry})))).toHaveCount(50);
 // A compatible host notice must preserve the running cohort, not snap a
 // deal merely because a shell-only revision completed its measurement.
 await portal.locator(':scope > svg').evaluateAll(elements=>{(window as typeof window&{originalDealArt?:Element[]}).originalDealArt=elements;});
 await page.evaluate(()=>{const button=[...document.querySelectorAll<HTMLButtonElement>('.live-surface button')].find(button=>button.getAttribute('aria-label')?.includes('초대하기'));if(!button)throw Error('missing invite');button.click();const reject=(window as typeof window&{rejectDealClipboard?:()=>void}).rejectDealClipboard;if(!reject)throw Error('missing clipboard operation');reject();});
 await expect(page.getByText('링크를 복사하지 못했어요.',{exact:true})).toBeVisible();
 await expect(portal.locator(':scope > svg')).toHaveCount(50);
 expect(await portal.locator(':scope > svg').evaluateAll(elements=>elements.every((element,index)=>element===(window as typeof window&{originalDealArt:Element[]}).originalDealArt[index]))).toBe(true);
 expect(await page.evaluate(()=>(window as typeof window&{nextDealStarts:number}).nextDealStarts)).toBe(50);
 expect(await portal.evaluate(element=>element.getAnimations({subtree:true}).every(animation=>animation.playState==='paused'))).toBe(true);
 await expect(portal.locator('svg[data-card-back]')).toHaveCount(50);await expect(portal.locator('text')).toHaveCount(0);await expect(publicCards).toHaveCount(0);
 expect(await portal.evaluate(element=>element.inert)).toBe(true);
 const heights=await page.evaluate(()=>(window as typeof window&{nextDealHeights:number[]}).nextDealHeights);expect(Math.max(...heights)-Math.min(...heights)).toBeLessThan(1);
 expect(await portal.locator(':scope > svg').evaluateAll(elements=>elements.every(element=>(element as SVGSVGElement).dataset.flightFromZone==='stock'&&(element as SVGSVGElement).dataset.flightPresentation==='back'))).toBe(true);
 await portal.evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=650;}));await page.screenshot({path:'/tmp/foundation-next-hand-motion.png',fullPage:true});
 // Synthetic native-scroll boundary fixture: a healthy rail need not
 // overflow at this viewport. Clamp only its native height, preserving its
 // position/width and every canonical card endpoint, then scroll real content.
 const rail=page.locator('.live-surface [data-foundation-node="table-sidebar"]');
 const endpointGeometry=()=>[...document.querySelectorAll<HTMLElement>('.live-surface [data-foundation-kind="card"]')].filter(element=>element.dataset.foundationEntity||element.dataset.foundationRecipient||element.dataset.foundationZone==='stock').map(element=>{const r=element.getBoundingClientRect();return{id:element.dataset.foundationNode,x:r.x,y:r.y,width:r.width,height:r.height};});
 const beforeRail=await page.evaluate(endpointGeometry);expect(beforeRail.length).toBeGreaterThanOrEqual(15);
 const priorMaxHeight=await rail.evaluate(element=>{
  const previous={value:element.style.getPropertyValue('max-height'),priority:element.style.getPropertyPriority('max-height')};
  if(!['auto','scroll'].includes(getComputedStyle(element).overflowY))throw Error('Rail lacks native vertical scrolling');
  const content=element.scrollHeight;if(content<=100)throw Error('Rail lacks meaningful content for native scroll fixture');
  element.style.maxHeight=content>124?'120px':'96px';return previous;
 });
 expect(await page.evaluate(endpointGeometry)).toEqual(beforeRail);
 await expect(portal.locator(':scope > svg')).toHaveCount(50);
 await expect.poll(()=>rail.evaluate(element=>element.scrollHeight-element.clientHeight)).toBeGreaterThan(4);
 const previousScroll=await rail.evaluate(element=>element.scrollTop),requestedScroll=previousScroll>0?0:4;
 await rail.evaluate((element,value)=>{element.scrollTop=value;},requestedScroll);
 await expect.poll(()=>rail.evaluate(element=>element.scrollTop)).toBe(requestedScroll);
 expect(await page.evaluate(endpointGeometry)).toEqual(beforeRail);
 await expect(portal.locator(':scope > svg')).toHaveCount(50);
 expect(await portal.locator(':scope > svg').evaluateAll(elements=>elements.every((element,index)=>element===(window as typeof window&{originalDealArt:Element[]}).originalDealArt[index]))).toBe(true);
 expect(await portal.evaluate(element=>element.getAnimations({subtree:true}).every(animation=>animation.playState==='paused'))).toBe(true);
 await rail.evaluate((element,previous)=>{if(previous.value)element.style.setProperty('max-height',previous.value,previous.priority);else element.style.removeProperty('max-height');},priorMaxHeight);
 // Host-only allocation changes must clear the old clipped portal before
 // blocked measurement can publish new geometry (no window resize event).
 await page.evaluate(async()=>{const resource=await new FontFace('Foundation next deal resize','local("Arial")').load(),host=document.querySelector<HTMLElement>('.live-surface')!,load=document.fonts.load.bind(document.fonts),waiters:(()=>void)[]=[];document.fonts.load=((...args:Parameters<FontFaceSet['load']>)=>new Promise<FontFace[]>((resolve,reject)=>waiters.push(()=>{void load(...args).then(resolve,reject);}))) as FontFaceSet['load'];(window as typeof window&{finishDealHostResize?:()=>void}).finishDealHostResize=()=>{document.fonts.load=load;waiters.splice(0).forEach(release=>release());};document.fonts.add(resource);document.fonts.dispatchEvent(new FontFaceSetLoadEvent('loadingdone',{fontfaces:[resource]}));host.style.width='1420px';});
 await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','pending');await expect(portal).toHaveCount(0);
 await page.evaluate(()=>(window as typeof window&{finishDealHostResize:()=>void}).finishDealHostResize());await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');await expect(hand(page)).toHaveCount(10);
 await page.evaluate(()=>{document.querySelector<HTMLElement>('.live-surface')!.style.width='';});await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
 await page.setViewportSize({width:1420,height:1200});await expect(portal).toHaveCount(0);await expect(hand(page)).toHaveCount(10);
 await page.reload();await expect(hand(page)).toHaveCount(10);await expect(portal).toHaveCount(0);expect(errors).toEqual([]);
});

test.afterEach(async({page},info)=>{
 if(info.status===info.expectedStatus)return;
 const receipt=await page.evaluate(()=>{const scope=window as typeof window&{nextDealStarts:number;transferDiagnostics:string[];transferGeometry:string[];transferInvalidations:string[];transferClears:string[]};
 const geometry=scope.transferGeometry.map(value=>JSON.parse(value)),blocks=geometry.flatMap(item=>item.blockers??[]).slice(-8);
 const controls=blocks.map(block=>{let best:{distance:number;id:string|undefined;label:string|null;kind:string|undefined;box:object}|null=null;for(const element of document.querySelectorAll<HTMLElement>('[data-foundation-node]')){const r=element.getBoundingClientRect(),distance=Math.abs(r.x-6-block.x)+Math.abs(r.y-6-block.y)+Math.abs(r.width+12-block.width)+Math.abs(r.height+12-block.height);if(!best||distance<best.distance)best={distance,id:element.dataset.foundationNode,label:element.getAttribute('aria-label'),kind:element.dataset.foundationKind,box:{x:r.x,y:r.y,width:r.width,height:r.height}};}return best;});
 return{starts:scope.nextDealStarts,statuses:scope.transferDiagnostics,geometry,invalidations:scope.transferInvalidations.map(value=>JSON.parse(value)),clears:scope.transferClears.map(value=>JSON.parse(value)),controls};});
 console.log('next-deal motion diagnostics',JSON.stringify(receipt));await info.attach('measured-flight-obstruction',{body:JSON.stringify(receipt,null,2),contentType:'application/json'});await page.screenshot({path:`/tmp/motion-obstruction-failure-${info.repeatEachIndex}.png`,fullPage:true});
});
