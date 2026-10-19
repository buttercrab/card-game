import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// Run this after other build/browser workers have stopped. This is one bounded
// Chromium CPU/measurement receipt, not device/GPU or native-audio evidence.
for(const maximumTextScale of [1.5,2])test(`native Mighty 1276-action domain measures cold and dispatches exact two-field bids without new probes${maximumTextScale===2?' at 200% text':''}`,async({page,browser},info)=>{
 test.skip(info.project.name!=='1440x900-dark','isolated desktop maximum native bid domain');
 await page.addInitScript(()=>{
  localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false}));
  const probe={timeOriginEpochMs:performance.timeOrigin,setupEpochMs:Date.now(),maxBatch:0,firstProbe:Infinity,longTasks:[] as {start:number;duration:number}[]};
  (window as typeof window&{maxBidProbe:typeof probe}).maxBidProbe=probe;
  new MutationObserver(()=>{for(const element of document.querySelectorAll('[data-foundation-probe]')){probe.maxBatch=Math.max(probe.maxBatch,element.children.length);probe.firstProbe=Math.min(probe.firstProbe,performance.now());}}).observe(document,{subtree:true,childList:true});
  if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{for(const entry of list.getEntries())probe.longTasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask'});
 });
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`/preview?foundation=1&fixture=mighty-bid-max${maximumTextScale===2?'&textScale=2':''}`);const host=page.locator('.foundation-surface');
 await expect(host).toHaveAttribute('data-foundation-status','ready');
 for(const name of maximumTextScale===2?['긴 이름','큰 글자','큰 글자']:['긴 이름','큰 글자']){await page.getByRole('button',{name,exact:true}).click();await expect(host).toHaveAttribute('data-foundation-status','ready');}
 const count=page.getByRole('combobox',{name:'공약 수',exact:true});await expect(count.locator('option')).toHaveCount(255);
 const before=await host.evaluate(element=>JSON.parse((element as HTMLElement).dataset.foundationPerformance!));
 await count.selectOption('255');
 const trump=page.getByRole('combobox',{name:'기루다',exact:true});
 if(await trump.count()){
  await expect(trump.locator('option')).toHaveCount(5);
  await trump.selectOption({label:'노기루다'});
  await expect(trump.locator('option:checked')).toHaveText('노기루다');
 }else{
  const choices=page.getByRole('radiogroup',{name:'기루다',exact:true});await expect(choices.getByRole('radio')).toHaveCount(5);await choices.getByRole('radio',{name:'노기루다',exact:true}).click();
 }
 await expect(host).toHaveAttribute('data-foundation-status','ready');await expect(count).toHaveValue('255');
 const after=await host.evaluate(element=>JSON.parse((element as HTMLElement).dataset.foundationPerformance!));
 expect(after.requests).toBe(before.requests);expect(after.resources.probes).toBe(0);
 await page.getByRole('button',{name:'공약 노기루다 255',exact:true}).click();
 await expect.poll(async()=>JSON.parse(await page.locator('[data-foundation-action]').innerText()).action).toEqual({Bid:{trump:null,count:255}});
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const trace=await page.evaluate(()=>(window as typeof window&{maxBidProbe:{maxBatch:number;firstProbe:number;longTasks:{start:number;duration:number}[]}}).maxBidProbe);
 const path=info.outputPath('maximum-native-mighty-domain.json');
 await writeFile(path,JSON.stringify({finishedAtEpochMs:Date.now(),browser:browser.version(),domain:{actions:1276,trumps:5,counts:255,ownCards:10,players:5},maximumTextScale,boundary:'local isolated desktop Chromium; native audio disabled; production Mighty projection over a supported synthetic authorized State; long-task window begins at first measurement probe, excluding earlier bootstrap/semantic construction',before,after,trace,errors},null,2));
 await info.attach('maximum-native-mighty-domain',{path,contentType:'application/json'});
 expect(trace.maxBatch).toBeGreaterThan(0);expect(trace.maxBatch).toBeLessThanOrEqual(512);expect(trace.longTasks.filter(entry=>entry.start+entry.duration>=trace.firstProbe)).toEqual([]);expect(errors).toEqual([]);
});
