import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const kernels=['numeric','yoga','native'] as const;
const fixtures=['mighty','poker','melds','one-card'] as const;
const viewports=[[320,568],[390,844],[568,320],[768,1024],[1024,768],[1440,900]] as const;
// Frozen before measurement; emulator results are not physical-phone receipts.
const manifest={revision:'foundation-comparison-v4',viewports,repetitions:3,warmups:2,
  sourceBoundary:'fresh isolated foundation entry; legacy App styles are not resident',
  budgetDefinition:'each transition family must independently meet p95CPU; aggregate does not establish qualification',
  cpuP95BudgetMs:8,longTaskBudgetMs:50,commitFramesBudget:2,measurementDeadlineMs:500,
  boundaries:'CDP whole-page TaskDuration with LayoutDuration/RecalcStyleDuration/ScriptDuration; manually bracketed phase CPU is attribution only. Resize-only and semantic-only samples; endpoints precede geometry assertions and no locator/actionability work runs in timing window. Waiting and WASM import reported separately',
  excluded:'GPU paint duration, physical mobile hardware, OS-level energy, heap retention qualification'};
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');}
async function open(page:Page,kernel:string,fixture:string){await page.goto(`/preview?foundation=1&kernel=${kernel}&fixture=${fixture}`);await ready(page);}
async function snapshot(page:Page){
  return page.locator('.foundation-surface').evaluate(host=>{
    const errors:string[]=[];
    const nodes=[...host.querySelectorAll<HTMLElement>('[data-foundation-node]')];
    const boxes=nodes.map(element=>{
      const r=element.getBoundingClientRect(),parent=element.parentElement!;
      if(parent.hasAttribute('data-foundation-node')){
        const b=parent.getBoundingClientRect();
        const fanScroll=getComputedStyle(parent).overflowX==='auto'&&element.dataset.foundationArrangement==='fan';
        if(r.top<b.top-.1||r.bottom>b.bottom+.1||!fanScroll&&(r.left<b.left-.1||r.right>b.right+.1))errors.push(`outside:${element.dataset.foundationNode}`);
        if(parent.dataset.foundationArrangement!=='fan'){
          for(const sibling of [...parent.children]){
            if(sibling===element||!sibling.hasAttribute('data-foundation-node'))continue;
            const s=sibling.getBoundingClientRect();
            if(Math.min(r.right,s.right)-Math.max(r.left,s.left)>.1&&Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>.1)errors.push(`overlap:${element.dataset.foundationNode}`);
          }
        }
      }
      return {id:element.dataset.foundationNode!,box:JSON.parse(element.dataset.foundationBox!) as {x:number;y:number;width:number;height:number}};
    });
    const metrics=JSON.parse((host as HTMLElement).dataset.foundationPerformance!);
    if(host.querySelector('[data-foundation-probe],[data-foundation-kernel-probe]'))errors.push('probe-retained');
    if(metrics.resources.probes||metrics.kernelResources?.liveNodes||metrics.kernelResources?.liveConfigs||metrics.kernelResources?.liveProbes)errors.push('resources-retained');
    return {boxes,errors,metrics};
  });
}
test('same semantic documents fit numeric, Yoga and native kernels across retained resize histories',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','one retained page per kernel/fixture');
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const baselines=new Map<string,Awaited<ReturnType<typeof snapshot>>['boxes']>();
  for(const kernel of kernels)for(const fixture of fixtures){
    await page.setViewportSize({width:1440,height:900});await open(page,kernel,fixture);
    await page.getByRole('button',{name:'긴 이름',exact:true}).click();await ready(page);
    await page.getByRole('button',{name:'큰 글자',exact:true}).click();await ready(page);
    await page.getByRole('button',{name:'40장',exact:true}).click();await ready(page);
    for(const [width,height]of [...viewports,[390,844] as const]){
      await page.setViewportSize({width,height});await ready(page);
      await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(e=>e.getBoundingClientRect().width)).toBe(width-24);
      const state=await snapshot(page);expect(state.errors,`${kernel}/${fixture}/${width}`).toEqual([]);
      const key=`${fixture}/${width}`;
      if(kernel==='numeric')baselines.set(key,state.boxes);
      else{
        const reference=baselines.get(key)!;
        expect(state.boxes.map(node=>node.id)).toEqual(reference.map(node=>node.id));
        for(let index=0;index<reference.length;index++)for(const dimension of ['x','y','width','height'] as const)
          expect(Math.abs(state.boxes[index].box[dimension]-reference[index].box[dimension]),`${kernel}/${key}/${reference[index].id}/${dimension}`).toBeLessThan(.6);
      }
    }
    if(fixture==='poker'){
      const choice=page.getByRole('radiogroup',{name:'행동 종류'}).getByRole('radio',{name:'별도 올인',exact:true});
      await choice.scrollIntoViewIfNeeded();await choice.click();await ready(page);
      const submit=page.getByRole('button',{name:'확정 올인 37 · 별도 정확한 행동',exact:true});
      await submit.scrollIntoViewIfNeeded();await submit.click();
      await expect(page.locator('[data-foundation-action]')).toHaveText('{"kind":"poker-all-in","amount":37}');
    }
    if(kernel==='numeric'&&fixture==='poker')await page.screenshot({path:'/tmp/foundation-poker-mobile.png',fullPage:true});
  }
  expect(errors).toEqual([]);
});

type Metrics={measurementCpuMs:number;measurementWaitMs:number;environmentCpuMs:number;publishCpuMs:number;solveCpuMs:number;rounds:number;requests:number;frame:number;loadMs:number;lastCommit:number;lastMetricsAt:number};
test('matched full-pipeline local timing manifest',async({page,browser},info)=>{
  test.skip(info.project.name!=='1440x900-dark'||process.env.FOUNDATION_BENCH!=='1','explicit local timing run');
  test.setTimeout(180_000);
  const run=Number(process.env.FOUNDATION_RUN??'0');
  if(![0,1,2].includes(run))throw new Error('Expected comparison run0,1or2');
  const order=[...kernels.slice(run),...kernels.slice(0,run)];
  const endingResources:Record<string,unknown>={};
  const samples:Record<string,number|string>[]=[];
  const loads:Record<string,unknown>[]=[];
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const cpu=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
  await page.addInitScript(()=>{
    const state={longTasks:[] as {start:number;duration:number}[],frameGaps:[] as {start:number;duration:number}[]};
    (window as unknown as {foundationTrace:typeof state}).foundationTrace=state;
    if(PerformanceObserver.supportedEntryTypes.includes('longtask'))
      new PerformanceObserver(list=>{for(const entry of list.getEntries())state.longTasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask'});
    let previous=performance.now();
    const tick=(now:number)=>{if(now-previous>25)state.frameGaps.push({start:previous,duration:now-previous});previous=now;requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
  });
  for(const kernel of order)for(const fixture of fixtures){
    await page.setViewportSize({width:1440,height:900});await open(page,kernel,fixture);
    loads.push({kernel,fixture,...(await snapshot(page)).metrics,assets:await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>new URL(entry.name).pathname).filter(path=>path.startsWith('/assets/')&&/\.(css|js)$/.test(path)))});
    // Exercise maximum public groups, forty cards, enlarged text and long labels.
    for(const name of ['긴 이름','큰 글자','40장']){await page.getByRole('button',{name,exact:true}).click();await ready(page);}
    for(let iteration=-manifest.warmups;iteration<manifest.repetitions*viewports.length;iteration++){
      const [width,height]=viewports[(iteration+viewports.length)%viewports.length];
      for(const transition of ['resize','semantic'] as const){
      const before=await page.locator('.foundation-surface').evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!)) as Metrics;
      const beforeCpu=await cpu();
      const started=await page.evaluate(()=>performance.now());
      if(transition==='resize')await page.setViewportSize({width,height});
      const observed=await page.evaluate(async({previous,semantic})=>{
        const host=document.querySelector<HTMLElement>('.foundation-surface')!;
        if(semantic){
          const trigger=[...document.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='새 선택지')!;
          trigger.click();
        }
        const deadline=performance.now()+1000;
        await new Promise<void>((resolve,reject)=>{
          const check=()=>{
            if(host.dataset.foundationStatus==='failed'||host.dataset.foundationStatus==='fallback')return reject(new Error('Candidate failed'));
            if(host.dataset.foundationStatus==='ready'&&Number(host.dataset.foundationFrame)!==previous)return resolve();
            if(performance.now()>deadline)return reject(new Error('Publication deadline exceeded'));
            requestAnimationFrame(check);
          };check();
        });
        const now=performance.now();
        // Include the rendering opportunity after publication, before correctness probes.
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        const trace=(window as unknown as {foundationTrace:{longTasks:{start:number;duration:number}[];frameGaps:{start:number;duration:number}[]}}).foundationTrace;
        return {now,nextFrame:performance.now(),trace,after:JSON.parse(host.dataset.foundationPerformance!)};
      },{previous:before.frame,semantic:transition==='semantic'});
      const afterCpu=await cpu();
      const after=observed.after as Metrics;
      if(iteration>=0)samples.push({kernel,fixture,transition,width,height,iteration,
        pageCpuMs:(afterCpu.TaskDuration-beforeCpu.TaskDuration)*1000,
        browserLayoutMs:(afterCpu.LayoutDuration-beforeCpu.LayoutDuration)*1000,
        browserStyleMs:(afterCpu.RecalcStyleDuration-beforeCpu.RecalcStyleDuration)*1000,
        scriptMs:(afterCpu.ScriptDuration-beforeCpu.ScriptDuration)*1000,
        longTasks:observed.trace.longTasks.filter(task=>task.start>=started&&task.start<observed.nextFrame).length,
        worstLongTaskMs:Math.max(0,...observed.trace.longTasks.filter(task=>task.start>=started&&task.start<observed.nextFrame).map(task=>task.duration)),
        missedFrameGaps:observed.trace.frameGaps.filter(frame=>frame.start>=started&&frame.start<observed.nextFrame).length,
        metricsToCommitMs:after.lastMetricsAt>=started?after.lastCommit-after.lastMetricsAt:0,
        instrumentedCpuMs:after.measurementCpuMs-before.measurementCpuMs+after.environmentCpuMs-before.environmentCpuMs+after.publishCpuMs-before.publishCpuMs+after.solveCpuMs-before.solveCpuMs,
        measurementCpuMs:after.measurementCpuMs-before.measurementCpuMs,
        solveCpuMs:after.solveCpuMs-before.solveCpuMs,publishCpuMs:after.publishCpuMs-before.publishCpuMs,
        measurementWaitMs:after.measurementWaitMs-before.measurementWaitMs,
        rounds:after.rounds-before.rounds,requests:after.requests-before.requests,
        interactionToObservedMs:observed.now-started,commitToNextObservedFrameMs:observed.nextFrame-after.lastCommit});
      }
      const final=await snapshot(page);expect(final.errors).toEqual([]);
      endingResources[kernel]={host:final.metrics.resources,kernel:final.metrics.kernelResources??null};
    }
  }
  const summary=Object.fromEntries(kernels.map(kernel=>{
    const values=samples.filter(sample=>sample.kernel===kernel).map(sample=>Number(sample.pageCpuMs)).sort((a,b)=>a-b);
    return [kernel,{samples:values.length,p95CpuMs:values[Math.ceil(values.length*.95)-1],worstCpuMs:values.at(-1),withinCpuBudget:['resize','semantic'].every(transition=>{const subset=samples.filter(sample=>sample.kernel===kernel&&sample.transition===transition).map(sample=>Number(sample.pageCpuMs)).sort((a,b)=>a-b);return subset[Math.ceil(subset.length*.95)-1]<=manifest.cpuP95BudgetMs;}),
      worstLongTaskMs:Math.max(...samples.filter(sample=>sample.kernel===kernel).map(sample=>Number(sample.worstLongTaskMs))),
      worstMetricsToCommitMs:Math.max(...samples.filter(sample=>sample.kernel===kernel).map(sample=>Number(sample.metricsToCommitMs))),
      byTransition:Object.fromEntries(['resize','semantic'].map(transition=>{
        const subset=samples.filter(sample=>sample.kernel===kernel&&sample.transition===transition);
        const percentile=(key:string)=>{const sorted=subset.map(sample=>Number(sample[key])).sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*.95)-1];};
        return [transition,{samples:subset.length,p95PageCpuMs:percentile('pageCpuMs'),withinCpuBudget:percentile('pageCpuMs')<=manifest.cpuP95BudgetMs,p95InstrumentedCpuMs:percentile('instrumentedCpuMs'),p95BrowserLayoutMs:percentile('browserLayoutMs'),p95BrowserStyleMs:percentile('browserStyleMs'),p95SolveMs:percentile('solveCpuMs')}];
      })),
      resources:endingResources[kernel]}];
  }));
  const result={manifest,run,kernelOrder:order,environment:{os:os.type(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,browser:browser.version(),physicalMobile:false},summary,loads,samples};
  writeFileSync('/tmp/foundation-comparison-results.json',JSON.stringify(result,null,2));
  writeFileSync(`/tmp/foundation-comparison-results-${run}.json`,JSON.stringify(result,null,2));
  await cdp.detach();
  console.log(JSON.stringify(summary));
});
