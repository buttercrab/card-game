import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {foundationBotButton,joinFoundation} from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`,reducedMotion:'no-preference'});
for(const [width,height] of [[768,1024],[390,844],[390,1700]] as const)for(const pickupDisposition of (width===390&&height===844?['arrive','resize-cancel']:['arrive']))test(`narrow ${width}×${height} card stage keeps a complete straight fifty-card deal ahead of its control footer · ${pickupDisposition}`,async({page,request},info)=>{
 test.skip(info.project.name!==(width===390&&height===844?'390x844-light':'1440x900-dark'),'one real Chromium narrow allocation trace');test.setTimeout(60000);await page.setViewportSize({width,height});
 await page.addInitScript(()=>{
  const records:unknown[]=[];const record=(value:unknown)=>{records.push({at:Date.now(),value});if(records.length>256)records.shift();};(window as typeof window&{narrowFlightLog:unknown[]}).narrowFlightLog=records;
  new MutationObserver(changes=>{for(const change of changes){const host=change.target;if(!(host instanceof HTMLElement)||!host.classList.contains('live-surface'))continue;record({attribute:change.attributeName,oldValue:change.oldValue,value:host.getAttribute(change.attributeName!),viewport:{width:innerWidth,height:innerHeight},status:host.dataset.foundationStatus});}}).observe(document,{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['data-foundation-flight-status','data-foundation-flight-clear','data-foundation-flight-invalidation','data-foundation-flight-geometry','data-foundation-status']});
  document.fonts?.addEventListener('loadingdone',()=>record({fontsLoaded:[...document.fonts].filter(face=>face.status==='loaded').map(face=>({family:face.family,weight:face.weight,range:face.unicodeRange}))}));
  localStorage.setItem('name',JSON.stringify('좁은 배분 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'normal'}));
  let hold=true;const queued:(()=>void)[]=[],Native=WebSocket,descriptor=Object.getOwnPropertyDescriptor(Native.prototype,'onmessage')!;class Delayed extends Native{}
  Object.defineProperty(Delayed.prototype,'onmessage',{set(handler:(event:MessageEvent)=>void){descriptor.set!.call(this,(event:MessageEvent)=>{if(hold&&JSON.parse(event.data).type==='state')queued.push(()=>handler.call(this,event));else handler.call(this,event);});},get(){return descriptor.get!.call(this);}});window.WebSocket=Delayed;
  (window as typeof window&{releaseNarrow:()=>void}).releaseNarrow=()=>{hold=false;queued.splice(0).forEach(run=>run());};
  const animate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight')){animation.pause();animation.currentTime=0;}return animation;};
 });
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}}),{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);
 for(let i=0;i<4;i++){await foundationBotButton(page).click();if(i<3)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();await page.evaluate(()=>(window as typeof window&{releaseNarrow:()=>void}).releaseNarrow());
 const host=page.locator('.live-surface'),portal=page.locator('[data-foundation-flight]');
 await expect(host.locator('[data-foundation-kind="card"][data-foundation-zone="hand"]')).toHaveCount(10);
 const geometry=await host.evaluate(element=>({panels:['room-header','arena','dock','identity','table-footer','table'].map(id=>{const n=element.querySelector<HTMLElement>(`[data-foundation-node="${id}"]`),r=n?.getBoundingClientRect();return{id,box:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};}),status:(element as HTMLElement).dataset.foundationFlightStatus,flight:(element as HTMLElement).dataset.foundationFlightGeometry,targets:[...element.querySelectorAll<HTMLElement>('[data-foundation-kind="card"]')].filter(node=>node.dataset.foundationZone==='hand'||node.dataset.foundationRecipient||node.dataset.foundationZone==='stock').map(node=>{const r=node.getBoundingClientRect();return{zone:node.dataset.foundationZone??'anonymous',count:node.dataset.foundationRecipientCount??node.dataset.foundationStockCount,box:{x:r.x,y:r.y,width:r.width,height:r.height},visible:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};})}));
 try{await expect(portal.locator(':scope > svg'),JSON.stringify(geometry)).toHaveCount(50);}finally{const path=info.outputPath('initial-flight-lifecycle.json');await writeFile(path,JSON.stringify({geometry,events:await page.evaluate(()=>(window as typeof window&{narrowFlightLog:unknown[]}).narrowFlightLog),prepareTrace:await host.evaluate(element=>(element as HTMLElement&{__foundationPrepareTrace?:unknown[]}).__foundationPrepareTrace)},null,2));await info.attach('initial-flight-lifecycle',{path,contentType:'application/json'});}
 await expect(portal.locator('svg[data-card-back]')).toHaveCount(50);await expect(portal.locator('text')).toHaveCount(0);
 await portal.evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.finish()));await expect(portal).toHaveCount(0);
 await expect(host).toHaveAttribute('data-foundation-status','ready');await expect(page.getByRole('button',{name:/^공약 /})).toBeEnabled();
 const bounds=await host.evaluate(element=>{
  const dock=element.querySelector<HTMLElement>('[data-foundation-node="dock"]')!,footer=element.querySelector<HTMLElement>('[data-foundation-node="table-footer"]')!;
  const d=dock.getBoundingClientRect(),f=footer?.getBoundingClientRect();return{dockBottom:d.bottom,footerTop:f?.top};
 });expect(bounds.footerTop).toBeGreaterThanOrEqual(bounds.dockBottom);
 const layoutReceipt=await host.evaluate(element=>[...element.querySelectorAll<HTMLElement>('select,button')].filter(node=>node.tagName==='SELECT'||node.getAttribute('aria-label')?.startsWith('공약 ')||node.getAttribute('aria-label')==='패스').map(node=>{const ancestors=[];for(let current:HTMLElement|null=node;current&&ancestors.length<14;current=current.parentElement){const r=current.getBoundingClientRect(),css=getComputedStyle(current);ancestors.push({id:current.dataset.foundationNode??current.tagName,box:{x:r.x,y:r.y,width:r.width,height:r.height},scrollTop:current.scrollTop,scrollHeight:current.scrollHeight,clientHeight:current.clientHeight,fontSize:css.fontSize,lineHeight:css.lineHeight,overflowY:css.overflowY});}return{label:node.getAttribute('aria-label'),ancestors};}));
 await info.attach('actual-narrow-control-allocation',{body:JSON.stringify(layoutReceipt,null,2),contentType:'application/json'});console.log('narrow measured footer',width,height,JSON.stringify(layoutReceipt.map(({label,ancestors})=>({label,control:ancestors[0],footer:ancestors.find(node=>node.id==='table-footer'),root:ancestors.find(node=>node.id==='table')}))));
 await page.screenshot({path:`/tmp/foundation-narrow-default-${width}x${height}.png`,fullPage:true});
 await expect(page.getByRole('button',{name:/^공약 /})).toBeInViewport({ratio:1});
 await expect(page.getByRole('button',{name:'패스',exact:true})).toBeInViewport({ratio:1});
 const fields=host.getByRole('combobox');await expect(fields).toHaveCount(2);for(const field of await fields.all())await expect(field).toBeInViewport({ratio:1});
 await page.screenshot({path:`/tmp/foundation-narrow-deal-${width}x${height}.png`,fullPage:true});
 if(width===390&&height===844){
  const prior=await host.locator('[data-foundation-zone="hand"][data-foundation-kind="card"]').evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.foundationEntity));
  await host.evaluate(element=>{const scope=window as typeof window&{kittyStatuses:string[]};scope.kittyStatuses=[];new MutationObserver(records=>{for(const record of records)scope.kittyStatuses.push(record.oldValue??'');}).observe(element,{attributes:true,attributeFilter:['data-foundation-flight-status'],attributeOldValue:true});});
  await fields.nth(0).selectOption({label:'노기루다'});await fields.nth(1).selectOption({label:'20'});
  await page.getByRole('button',{name:'공약 노기루다 20',exact:true}).click();
  await expect(host.locator('[data-foundation-kind="card"][data-foundation-zone="hand"]')).toHaveCount(13);
  const hidden=await host.locator('[data-foundation-zone="hand"][data-foundation-kind="card"]').evaluateAll((elements,known)=>elements.filter(element=>!known.includes((element as HTMLElement).dataset.foundationEntity)).filter(element=>{const r=element.firstElementChild!.getBoundingClientRect();for(let parent=element.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)){const p=parent.getBoundingClientRect();if(r.left<p.left+parent.clientLeft||r.right>p.left+parent.clientLeft+parent.clientWidth||r.top<p.top+parent.clientTop||r.bottom>p.top+parent.clientTop+parent.clientHeight)return true;}}return r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight;}).length,prior);
  await expect(portal.locator(':scope > svg'),await host.getAttribute('data-foundation-flight-status')??'unknown').toHaveCount(3);
  await expect(portal.locator('svg[data-card-back]')).toHaveCount(3);await expect(portal.locator('text')).toHaveCount(0);
  if(hidden){
   await expect(portal.locator('[data-flight-landing="count-anchor"]')).toHaveCount(3);
   const concealed=host.locator('[data-foundation-concealed="true"]');await expect(concealed).toHaveCount(3);
   for(const target of await concealed.all()){await expect(target).toBeDisabled();await expect(target).toHaveAttribute('aria-hidden','true');}
   const before=await host.locator('[aria-pressed="true"]').count();
   await concealed.evaluateAll(elements=>elements.forEach(element=>(element as HTMLButtonElement).click()));
   expect(await host.locator('[aria-pressed="true"]').count()).toBe(before);
   await expect(host.locator('[data-foundation-node="own-hand-count-anchor"]')).not.toHaveAttribute('aria-hidden','true');
   await page.screenshot({path:'/tmp/foundation-counted-pickup-390x844.png',fullPage:true});
  }
  if(pickupDisposition==='resize-cancel'){
   await portal.evaluate(element=>{(window as typeof window&{oldCountedAnimations:Animation[]}).oldCountedAnimations=element.getAnimations({subtree:true});});
   await page.setViewportSize({width:391,height:844});await expect(portal).toHaveCount(0);await expect(host).toHaveAttribute('data-foundation-status','ready');
   await expect(host.locator('button[aria-pressed]:enabled')).toHaveCount(13);
   await page.evaluate(()=>{for(const animation of (window as typeof window&{oldCountedAnimations:Animation[]}).oldCountedAnimations){try{animation.finish();}catch{}}});
   await expect(portal).toHaveCount(0);await expect(host.locator('button[aria-pressed]:enabled')).toHaveCount(13);
  }else await portal.evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.finish()));
  await expect(portal).toHaveCount(0);
  await expect(host.locator('[data-foundation-concealed="true"]')).toHaveCount(0);
  console.log('phone kitty visibility',JSON.stringify({hiddenTargets:hidden,disposition:hidden?`three-counted-landings:${pickupDisposition}`:`three-exact-landings:${pickupDisposition}`}));
  await info.attach('phone-kitty-visibility',{body:JSON.stringify({hiddenTargets:hidden,disposition:hidden?`three-counted-landings:${pickupDisposition}`:`three-exact-landings:${pickupDisposition}`}),contentType:'application/json'});
 }
 await page.setViewportSize({width:390,height:844});await expect(portal).toHaveCount(0);await expect(host).toHaveAttribute('data-foundation-status','ready');
 const action=width===390&&height===844?host.locator('button[aria-pressed]:enabled').first():page.getByRole('button',{name:'패스',exact:true});await action.scrollIntoViewIfNeeded();await expect(action).toBeVisible();await expect(action).toBeEnabled();
});

test.afterEach(async({page},info)=>{if(info.status!==info.expectedStatus)await page.screenshot({path:`/tmp/foundation-narrow-failure-${info.project.name}.png`,fullPage:true});});
