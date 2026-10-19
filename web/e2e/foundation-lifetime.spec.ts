import {expect,test,type Page} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const manifest={id:'foundation-lifetime-v1',warmups:8,cycles:40,viewports:[[390,844],[1440,900],[768,1024],[320,568]],boundary:'post-GC retained browser DOM counters and declared surface resources after identical closed-menu state; Chromium emulation, not physical-device heap qualification'};
async function ready(page:Page){
 await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');
 await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(el=>el.getBoundingClientRect().width)).toBe(page.viewportSize()!.width-24);
 await expect.poll(async()=>({status:await page.locator('.foundation-surface').getAttribute('data-foundation-status'),probes:(await resources(page)).probes})).toEqual({status:'ready',probes:0});
}
async function resources(page:Page){return page.locator('.foundation-surface').evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!).resources as {listeners:number;probes:number;animations:number;artworks:number});}
test('modal resize remount and revocation reclaim their resources through repeated lifetimes',async({page,browser},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one deterministic Chromium resource workload');test.setTimeout(120000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/preview?foundation=1&fixture=shell');await ready(page);await page.evaluate(()=>document.fonts.ready);
 const cdp=await page.context().newCDPSession(page);
 async function counters(){
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage');return cdp.send('Memory.getDOMCounters');
 }
 async function cycle(iteration:number){
  const [width,height]=manifest.viewports[iteration%manifest.viewports.length];await page.setViewportSize({width,height});await ready(page);
  await page.getByRole('button',{name:'메뉴',exact:true}).click();await expect(page.locator('dialog:modal')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button',{name:'함께 있는 사람',exact:true}).click();await expect(page.getByRole('dialog',{name:'함께 있는 사람',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'테이블 proof',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('dialog')).toHaveCount(0);await ready(page);
  if(iteration%4===0){
   await page.getByRole('button',{name:'분리',exact:true}).click();await expect(page.locator('[data-foundation-node]')).toHaveCount(0);
   const detached=await resources(page);expect(detached).toEqual({listeners:0,probes:0,animations:0,artworks:0});
   await page.getByRole('button',{name:'다시 연결',exact:true}).click();await ready(page);
  }
 }
 for(let i=0;i<manifest.warmups;i++)await cycle(i);
 await page.setViewportSize({width:1440,height:900});await ready(page);
 const initial={surface:await resources(page),dom:await counters()};
 for(let i=0;i<manifest.cycles;i++)await cycle(i);
 await page.setViewportSize({width:1440,height:900});await ready(page);
 const final={surface:await resources(page),dom:await counters()};
 writeFileSync('/tmp/foundation-lifetime-results.json',JSON.stringify({manifest,browser:browser.version(),initial,final,errors},null,2));
 expect(final.surface).toEqual(initial.surface);expect(final.surface.probes).toBe(0);expect(final.surface.animations).toBe(0);
 expect(final.dom.documents).toBe(initial.dom.documents);expect(final.dom.nodes).toBeLessThanOrEqual(initial.dom.nodes+4);expect(final.dom.jsEventListeners).toBeLessThanOrEqual(initial.dom.jsEventListeners+4);
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await expect(page.locator('dialog:modal')).toHaveCount(1);
 await page.getByRole('button',{name:'권한 해제',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('[data-foundation-node]')).toHaveCount(0);
 expect(await resources(page)).toMatchObject({probes:0,animations:0,artworks:0});expect(errors).toEqual([]);
 await page.screenshot({path:'/tmp/foundation-lifetime-revoked.png'});
 writeFileSync('/tmp/foundation-lifetime-results.json',JSON.stringify({manifest,browser:browser.version(),initial,final,errors},null,2));await cdp.detach();
});

for(const failure of ['observe','register'] as const)test(`surface listener lease rolls back ${failure} setup failure`,async({page})=>{
 await page.addInitScript(failure=>{
  const state={injected:false,active:new Set<EventListenerOrEventListenerObject>()};(window as any).environmentSetup=state;
  const observe=ResizeObserver.prototype.observe;ResizeObserver.prototype.observe=function(target,options){if(failure==='observe'&&target instanceof HTMLElement&&target.classList.contains('foundation-surface')&&!state.injected){state.injected=true;throw Error('Injected environment observe failure');}return observe.call(this,target,options);};
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){const owned=this instanceof HTMLElement&&this.classList.contains('foundation-surface');if(owned&&failure==='register'&&type==='click'&&!state.injected){state.injected=true;throw Error('Injected environment registration failure');}const result=add.call(this,type,listener,options);if(owned&&listener)state.active.add(listener);return result;};
  EventTarget.prototype.removeEventListener=function(type,listener,options){if(this instanceof HTMLElement&&this.classList.contains('foundation-surface')&&listener)state.active.delete(listener);return remove.call(this,type,listener,options);};
 },failure);
 await page.goto('/preview?foundation=1&fixture=mighty');await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','failed');await expect(page.locator('[data-foundation-probe]')).toHaveCount(0);expect(await page.evaluate(()=>({injected:(window as any).environmentSetup.injected,active:(window as any).environmentSetup.active.size}))).toEqual({injected:true,active:0});
});
test('retired environment callbacks cannot sample or notify a replacement listener lease',async({page},info)=>{
 await page.addInitScript(()=>{
  const state={resize:null as ResizeObserverCallback|null,font:null as EventListenerOrEventListenerObject|null};(window as any).environmentCallbacks=state;
  const Native=ResizeObserver;window.ResizeObserver=class extends Native{callback:ResizeObserverCallback;constructor(callback:ResizeObserverCallback){super(callback);this.callback=callback;}observe(target:Element,options?:ResizeObserverOptions){if(target instanceof HTMLElement&&target.classList.contains('foundation-surface'))state.resize=this.callback;return super.observe(target,options);}};
  const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,listener,options){if(this===document.fonts&&type==='loadingdone')state.font=listener;return add.call(this,type,listener,options);};
 });
 await page.goto('/preview?foundation=1&fixture=mighty');const host=page.locator('.foundation-surface');await expect(host).toHaveAttribute('data-foundation-status','ready');await page.evaluate(()=>{(window as any).retiredEnvironmentCallbacks={...(window as any).environmentCallbacks};});
 const invoke=()=>page.evaluate(()=>{const h=document.querySelector<HTMLElement>('.foundation-surface')!,state=(window as any).retiredEnvironmentCallbacks,before={frame:h.dataset.foundationFrame,probes:[...h.querySelectorAll('[data-foundation-probe]')]};let created=0,sampled=0;const computed=getComputedStyle;window.getComputedStyle=(...args)=>{sampled++;return computed(...args);};const create=document.createElement;document.createElement=function(...args:any[]){created++;return (create as any).apply(this,args);} as typeof create;try{state.resize([],null);if(typeof state.font==='function')state.font(new Event('loadingdone'));else state.font.handleEvent(new Event('loadingdone'));}finally{document.createElement=create;window.getComputedStyle=computed;}return{created,sampled,sameFrame:before.frame===h.dataset.foundationFrame,sameProbes:before.probes.every((n,i)=>h.querySelectorAll('[data-foundation-probe]')[i]===n),probeCount:h.querySelectorAll('[data-foundation-probe]').length};});
 await page.getByRole('button',{name:'분리',exact:true}).click();const detached=await invoke();expect(detached).toEqual({created:0,sampled:0,sameFrame:true,sameProbes:true,probeCount:0});await page.getByRole('button',{name:'다시 연결',exact:true}).click();await expect(host).toHaveAttribute('data-foundation-status','ready');const reattached=await invoke();expect(reattached).toEqual({created:0,sampled:0,sameFrame:true,sameProbes:true,probeCount:0});const {writeFileSync}=await import('node:fs');writeFileSync(info.outputPath('retired-environment-callbacks.json'),JSON.stringify({detached,reattached}));
});
