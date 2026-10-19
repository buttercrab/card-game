import {expect,test} from '@playwright/test';
for(const failure of ['font-rejection','font-throw','geometry-throw'] as const){
 test(`measurement ${failure} reclaims probes and fails without unhandled errors`,async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','one real browser failure boundary');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(failure=>{
   if(failure==='font-rejection')document.fonts.load=()=>Promise.reject(new Error('Injected font rejection'));
   else if(failure==='font-throw')document.fonts.load=()=>{throw new Error('Injected synchronous font failure');};
   else {
    const read=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){if(this.closest('[data-foundation-probe]'))throw new Error('Injected geometry failure');return read.call(this);};
   }
  },failure);
  await page.goto('/preview?foundation=1');await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','fallback');
  await expect(page.locator('[data-foundation-probe]')).toHaveCount(0);await expect(page.locator('[data-foundation-node]')).toHaveCount(0);
  await expect.poll(()=>page.locator('.foundation-surface').evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!).resources)).toMatchObject({probes:0,animations:0,artworks:0});
  expect(errors).toEqual([]);
 });
}

test('cold 300-option long-text engine measurement stays bounded without a long task and caches later drafts',async({page,browser},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one maximum supported fixture measurement workload');
 await page.addInitScript(()=>{
  // Isolate the engine workload from native audio-device construction. The
  // audible first-gesture stall is tracked separately in ENGINE_COMPLETION.md.
  localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false}));
  const state={maxBatch:0,firstProbe:Infinity,longTasks:[] as {start:number;duration:number}[]};
  (window as typeof window&{measurementStress:typeof state}).measurementStress=state;
  new MutationObserver(()=>{
   for(const probe of document.querySelectorAll('[data-foundation-probe]')){state.maxBatch=Math.max(state.maxBatch,probe.children.length);state.firstProbe=Math.min(state.firstProbe,performance.now());}
  }).observe(document,{childList:true,subtree:true});
  if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{for(const task of list.getEntries())state.longTasks.push({start:task.startTime,duration:task.duration});}).observe({type:'longtask'});
 });
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/preview?foundation=1&fixture=large-choice&options=300');const host=page.locator('.foundation-surface');await expect(host).toHaveAttribute('data-foundation-status','ready');
 for(const name of ['긴 이름','큰 글자','40장']){await page.getByRole('button',{name,exact:true}).click();await expect(host).toHaveAttribute('data-foundation-status','ready');}
 const select=page.getByRole('combobox',{name:'금액',exact:true});await expect(select.locator('option')).toHaveCount(300);
 const before=await host.evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!));
 await select.selectOption('300');await expect(select).toHaveValue('300');await expect(host).toHaveAttribute('data-foundation-status','ready');
 const after=await host.evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!));expect(after.requests).toBe(before.requests);expect(after.resources.probes).toBe(0);
 await page.getByRole('button',{name:'확정 금액 300',exact:true}).click();await expect(page.locator('[data-foundation-action]')).toHaveText('{"amount":300}');
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const trace=await page.evaluate(()=>(window as typeof window&{measurementStress:{maxBatch:number;firstProbe:number;longTasks:{start:number;duration:number}[]}}).measurementStress);
 expect(trace.maxBatch).toBeGreaterThan(0);expect(trace.maxBatch).toBeLessThanOrEqual(512);
 const {writeFileSync}=await import('node:fs');writeFileSync('/tmp/foundation-measurement-stress.json',JSON.stringify({browser:browser.version(),boundary:'local Chromium desktop; audio muted; real pointer input; 300 options, long labels, 1.5 text scale, 40 cards; long-task observation begins at first measurement probe',trace,before,after,errors},null,2));
 await page.screenshot({path:'/tmp/foundation-measurement-stress.png',fullPage:true});
 expect(trace.longTasks.filter(task=>task.start+task.duration>=trace.firstProbe)).toEqual([]);expect(errors).toEqual([]);
});

test('canceling a queued full native measurement round closes its ports and cannot revive probes after reattach',async({page},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one actual full-batch cancellation boundary');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false}));
  const NativeChannel=MessageChannel,nativeMessage=Object.getOwnPropertyDescriptor(MessagePort.prototype,'onmessage')!;
  const state={hold:true,probeAdds:0,channels:0,activePairs:0,peakActivePairs:0,pairs:[] as {id:number;close1:number;close2:number;retired:boolean}[],close1:0,close2:0,held:null as null|(()=>void),atHold:null as null|{status:string|null;frame:string|null;nodes:number;probes:number;probeAdds:number;detachEnabled:boolean},afterDetach:null as null|{nodes:number;probes:number;elapsed:number}};
  (window as typeof window&{queuedMeasurement:typeof state}).queuedMeasurement=state;
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element)state.probeAdds+=Number(node.matches('[data-foundation-probe]'))+node.querySelectorAll('[data-foundation-probe]').length;}).observe(document,{subtree:true,childList:true});
  window.MessageChannel=class extends NativeChannel{
   constructor(){
    super();state.channels++;state.activePairs++;state.peakActivePairs=Math.max(state.peakActivePairs,state.activePairs);
    const pair={id:state.channels,close1:0,close2:0,retired:false};state.pairs.push(pair);
    const retire=()=>{if(!pair.retired&&pair.close1>0&&pair.close2>0){pair.retired=true;state.activePairs--;}};
    const firstClose=this.port1.close.bind(this.port1),secondClose=this.port2.close.bind(this.port2);
    this.port1.close=()=>{firstClose();state.close1++;pair.close1++;retire();};this.port2.close=()=>{secondClose();state.close2++;pair.close2++;retire();};
    Object.defineProperty(this.port1,'onmessage',{configurable:true,set(callback:((event:MessageEvent)=>void)|null){
     nativeMessage.set!.call(this,callback?(event:MessageEvent)=>{
      if(!state.hold){callback(event);return;}
      state.held=()=>callback(event);
      const host=document.querySelector<HTMLElement>('.foundation-surface')!,detach=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='분리');
      state.atHold={status:host.getAttribute('data-foundation-status'),frame:host.getAttribute('data-foundation-frame'),nodes:host.querySelectorAll('[data-foundation-node]').length,probes:document.querySelectorAll('[data-foundation-probe]').length,probeAdds:state.probeAdds,detachEnabled:!!detach&&!detach.disabled};
      // Invoke the real native toolbar control in this delivered task: crossing
      // an automation round trip must not consume the unchanged 500ms deadline.
      const started=performance.now();detach?.click();
      state.afterDetach={nodes:host.querySelectorAll('[data-foundation-node]').length,probes:document.querySelectorAll('[data-foundation-probe]').length,elapsed:performance.now()-started};
     }:null);
    }});
   }
  };
 });
 await page.goto('/preview?foundation=1&fixture=mighty-bid-max');
 const host=page.locator('.foundation-surface');await expect(page.getByRole('button',{name:'다시 연결',exact:true})).toBeEnabled();
 const canceled=await page.evaluate(async()=>{const state=(window as typeof window&{queuedMeasurement:any}).queuedMeasurement;state.held();await Promise.resolve();return{atHold:state.atHold,afterDetach:state.afterDetach,channels:state.channels,close1:state.close1,close2:state.close2,activePairs:state.activePairs,peakActivePairs:state.peakActivePairs,pairs:state.pairs,probeAdds:state.probeAdds};});
 // Font/environment revisions may cancel and replace a not-yet-delivered
 // round. Count concurrently live pairs and every individual port retirement,
 // rather than requiring one constructor over the entire attachment lifetime.
 // Cold attach enters runtime measuring before any host publication: unlike
 // suspension of an existing frame, it need not paint a pending DOM marker.
 expect([null,'pending']).toContain(canceled.atHold.status);expect(canceled.atHold).toEqual({status:canceled.atHold.status,frame:null,nodes:0,probes:0,probeAdds:0,detachEnabled:true});expect(canceled.afterDetach.nodes).toBe(0);expect(canceled.afterDetach.probes).toBe(0);expect(canceled.afterDetach.elapsed).toBeLessThan(500);expect(canceled.channels).toBeGreaterThanOrEqual(1);expect(canceled.activePairs).toBe(0);expect(canceled.peakActivePairs).toBe(1);expect(canceled.pairs).toHaveLength(canceled.channels);for(const pair of canceled.pairs)expect(pair).toEqual({id:pair.id,close1:1,close2:1,retired:true});expect(canceled.close1).toBe(canceled.channels);expect(canceled.close2).toBe(canceled.channels);expect(canceled.probeAdds).toBe(0);
 await expect(host.locator('[data-foundation-node]')).toHaveCount(0);await expect(page.locator('[data-foundation-probe]')).toHaveCount(0);
 await page.evaluate(()=>(window as typeof window&{queuedMeasurement:{hold:boolean}}).queuedMeasurement.hold=false);
 await page.getByRole('button',{name:'다시 연결',exact:true}).click();await expect(host).toHaveAttribute('data-foundation-status','ready');
 await expect(page.getByRole('combobox',{name:'공약 수',exact:true}).locator('option')).toHaveCount(255);
 const replay=await host.evaluate(async host=>{const state=(window as typeof window&{queuedMeasurement:any}).queuedMeasurement,before={probeAdds:state.probeAdds,frame:(host as HTMLElement).dataset.foundationFrame,nodes:host.querySelectorAll('[data-foundation-node]').length};state.held();await Promise.resolve();const after={probeAdds:state.probeAdds,frame:(host as HTMLElement).dataset.foundationFrame,nodes:host.querySelectorAll('[data-foundation-node]').length};state.held=null;return{before,after,channels:state.channels,close1:state.close1,close2:state.close2,activePairs:state.activePairs,peakActivePairs:state.peakActivePairs,pairs:state.pairs};});
 expect(replay.after).toEqual(replay.before);expect(replay.activePairs).toBe(0);expect(replay.peakActivePairs).toBe(1);expect(replay.pairs).toHaveLength(replay.channels);for(const pair of replay.pairs)expect(pair).toEqual({id:pair.id,close1:1,close2:1,retired:true});expect(replay.close1).toBe(replay.channels);expect(replay.close2).toBe(replay.channels);await expect(host).toHaveAttribute('data-foundation-status','ready');await expect(page.locator('[data-foundation-probe]')).toHaveCount(0);expect(errors).toEqual([]);
 const {writeFile}=await import('node:fs/promises'),path=info.outputPath('queued-native-measurement-cancel.json');await writeFile(path,JSON.stringify({canceled,replay,errors,boundary:'real native MessageChannel and ports; first full round held before probes; actual workbench detach control; captured original engine callback manually replayed before and after fresh reattach; native geometry/fonts'},null,2));await info.attach('queued-native-measurement-cancel',{path,contentType:'application/json'});
});
