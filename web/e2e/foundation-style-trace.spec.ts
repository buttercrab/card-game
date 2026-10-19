import {expect,test,type Page,type CDPSession} from '@playwright/test';
import {writeFileSync} from 'node:fs';

// Diagnostic only: trace overhead is not an acceptance timing receipt.
// Paint variants intercept only this synthetic fixture's container setters.
// They do not establish native dialog, privacy revocation, or AT equivalence.
async function settled(page:Page){
  await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
}
async function trace(cdp:CDPSession,page:Page,label:string,width:number,height:number){
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-devtools.timeline.stack',transferMode:'ReturnAsStream'});
  const before=await page.locator('.foundation-surface').evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!));
  await page.evaluate(label=>performance.mark(`foundation-${label}-start`),label);
  await page.setViewportSize({width,height});
  const after=await page.evaluate(async({previous,label})=>{
    const host=document.querySelector<HTMLElement>('.foundation-surface')!;
    await new Promise<void>((resolve,reject)=>{
      const deadline=performance.now()+1000;
      const check=()=>{if(host.dataset.foundationStatus==='ready'&&Number(host.dataset.foundationFrame)!==previous)return resolve();if(performance.now()>deadline)return reject(new Error('Publication deadline exceeded'));requestAnimationFrame(check);};check();
    });
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    performance.mark(`foundation-${label}-end`);
    return JSON.parse(host.dataset.foundationPerformance!);
  },{previous:before.frame,label});
  const done=new Promise<{stream:string}>(resolve=>cdp.once('Tracing.tracingComplete',resolve));
  await cdp.send('Tracing.end');const {stream}=await done;
  let output='';while(true){const chunk=await cdp.send('IO.read',{handle:stream});output+=chunk.data;if(chunk.eof)break;}
  await cdp.send('IO.close',{handle:stream});
  writeFileSync(`/tmp/foundation-style-${process.env.FOUNDATION_TRACE_PAINT??'baseline'}-${label}.json`,output);
  return {label,before,after};
}
test('trace first-width and cached-width style work',async({page},info)=>{
  test.skip(process.env.FOUNDATION_TRACE!=='1'||info.project.name!=='1440x900-dark','explicit diagnostic only');test.setTimeout(90_000);
  const paint=process.env.FOUNDATION_TRACE_PAINT??'baseline';
  if(!['baseline','opacity','no-container-inert','opacity-no-container-inert','promoted'].includes(paint))throw new Error('Unknown diagnostic paint variant');
  if(paint==='opacity'||paint==='opacity-no-container-inert')await page.addInitScript(()=>{
    Object.defineProperty(CSSStyleDeclaration.prototype,'visibility',{configurable:true,get(){return this.getPropertyValue('visibility');},set(value:string){
      if(document.querySelector<HTMLElement>('.foundation-content')?.style===this){this.opacity=value==='hidden'?'0':'1';this.setProperty('visibility','visible');}
      else this.setProperty('visibility',value);
    }});
  });
  if(paint==='no-container-inert'||paint==='opacity-no-container-inert')await page.addInitScript(()=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'inert')!;
    Object.defineProperty(HTMLElement.prototype,'inert',{...descriptor,set(value:boolean){
      descriptor.set!.call(this,this.classList.contains('foundation-content')?false:value);
    }});
  });
  await page.goto('/preview?foundation=1&fixture=melds&kernel=numeric');await settled(page);
  for(const name of ['긴 이름','큰 글자','40장']){await page.getByRole('button',{name,exact:true}).click();await settled(page);}
  if(paint==='promoted')await page.locator('.foundation-content').evaluate(async element=>{(element as HTMLElement).style.willChange='opacity';await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  await page.setViewportSize({width:1024,height:768});await settled(page);
  const cdp=await page.context().newCDPSession(page);
  let layers: {layerId:string;backendNodeId?:number;width:number;height:number;drawsContent:boolean;offsetX:number;offsetY:number}[]=[];
  const layerHistory:unknown[]=[];
  cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers??[];layerHistory.push({time:Date.now(),layers});});
  await cdp.send('LayerTree.enable');
  const cold=await trace(cdp,page,'cold390',390,844);
  await page.setViewportSize({width:1024,height:768});await settled(page);
  const warm=await trace(cdp,page,'warm390',390,844);
  writeFileSync(`/tmp/foundation-style-${paint}-trace-metrics.json`,JSON.stringify({cold,warm},null,2));
  const details=[];
  for(const layer of layers){
    const reasons=await cdp.send('LayerTree.compositingReasons',{layerId:layer.layerId}).catch(()=>null);
    const node=layer.backendNodeId?await cdp.send('DOM.describeNode',{backendNodeId:layer.backendNodeId}).catch(()=>null):null;
    details.push({...layer,reasons,node});
  }
  writeFileSync(`/tmp/foundation-style-${paint}-layers.json`,JSON.stringify({
    limitation:'width*height*4*deviceScaleFactor^2 per drawsContent layer is only an untiled one-buffer RGBA area proxy; clipping, tiling, raster scale, shared resources, multiple buffers and actual GPU allocation are not measured',
    deviceScaleFactor:1,history:layerHistory,final:details,
    untiledRgbaAreaProxyBytes:layers.filter(layer=>layer.drawsContent).reduce((sum,layer)=>sum+layer.width*layer.height*4,0),
  },null,2));
  await cdp.detach();
  if(paint==='no-container-inert'||paint==='opacity-no-container-inert'||paint==='promoted'){
    const action=await page.locator('[data-foundation-action]').textContent();
    const pending=await page.locator('.foundation-surface').evaluate(host=>new Promise(resolve=>{
      const observer=new MutationObserver(()=>{
        if((host as HTMLElement).dataset.foundationStatus!=='pending')return;
        const content=host.querySelector<HTMLElement>('.foundation-content')!;
        if(content.getAttribute('aria-hidden')!=='true')return;
        const controls=[...content.querySelectorAll<HTMLButtonElement|HTMLSelectElement|HTMLInputElement>('button,select,input')];
        let focusEntered=false;
        for(const control of controls){control.focus();if(content.contains(document.activeElement))focusEntered=true;control.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
        const result={allDisabled:controls.length>0&&controls.every(control=>control.disabled),
          aria:content.getAttribute('aria-hidden'),visibility:getComputedStyle(content).visibility,
          opacity:getComputedStyle(content).opacity,inert:content.inert,focusEntered,
          otherFocusable:content.querySelectorAll('a[href],area[href],iframe,object,embed,[contenteditable=true],[tabindex]:not([tabindex="-1"]):not(button):not(select):not(input)').length};
        observer.disconnect();resolve(result);
      });
      observer.observe(host,{attributes:true,attributeFilter:['data-foundation-status']});
      (host as HTMLElement).style.width='281px';
    }));
    expect(pending).toEqual({allDisabled:true,aria:'true',visibility:paint==='no-container-inert'?'hidden':'visible',opacity:paint==='no-container-inert'?'1':'0',inert:false,focusEntered:false,otherFocusable:0});
    await settled(page);await expect(page.locator('[data-foundation-action]')).toHaveText(action??'');
    writeFileSync(`/tmp/foundation-style-${paint}-pending.json`,JSON.stringify(pending,null,2));
  }
});

// Attribution for the maximum supported measured finite-choice workload.
test('trace maximum cold measurement work',async({page},info)=>{
  test.skip(process.env.FOUNDATION_TRACE_STRESS!=='1'||info.project.name!=='1440x900-dark','explicit diagnostic only');
  test.setTimeout(90_000);
  if(process.env.FOUNDATION_TRACE_MUTED==='1')await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false})));
  await page.addInitScript(()=>{
    const tasks:{start:number;duration:number}[]=[];
    (window as typeof window&{stressTasks:typeof tasks}).stressTasks=tasks;
    new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask'});
  });
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink,blink.user_timing,v8,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack',transferMode:'ReturnAsStream'});
  await page.goto('/preview?foundation=1&fixture=large-choice&options=300');await settled(page);
  for(const name of ['긴 이름','큰 글자','40장']){
    await page.evaluate(name=>performance.mark(`stress-${name}-start`),name);
    if(process.env.FOUNDATION_TRACE_DIRECT==='1')await page.getByRole('button',{name,exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
    else await page.getByRole('button',{name,exact:true}).click();
    await settled(page);await page.evaluate(name=>performance.mark(`stress-${name}-end`),name);
  }
  const receipts=await page.evaluate(()=>({tasks:(window as typeof window&{stressTasks:unknown}).stressTasks,metrics:JSON.parse(document.querySelector<HTMLElement>('.foundation-surface')!.dataset.foundationPerformance!)}));
  const done=new Promise<{stream:string}>(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await done;
  let output='';while(true){const chunk=await cdp.send('IO.read',{handle:stream});output+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});
  const {profile}=await cdp.send('Profiler.stop');await cdp.detach();
  const mode=process.env.FOUNDATION_TRACE_DIRECT==='1'?'direct':process.env.FOUNDATION_TRACE_MUTED==='1'?'muted-physical':'physical';
  writeFileSync(`/tmp/foundation-measurement-stress-${mode}-trace.json`,output);
  writeFileSync(`/tmp/foundation-measurement-stress-${mode}-profile.json`,JSON.stringify(profile));
  writeFileSync(`/tmp/foundation-measurement-stress-${mode}-diagnostic.json`,JSON.stringify(receipts,null,2));
});
