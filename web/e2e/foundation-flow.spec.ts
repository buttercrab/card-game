import { expect,test,type Page } from '@playwright/test';
const zone=(page:Page,id:string)=>page.locator(`[data-foundation-kind="card"][data-foundation-zone="${id}"]`);
const portal=(page:Page)=>page.locator('[data-foundation-flight]');
const ready=async(page:Page)=>{await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(element=>element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width-24);};
async function open(page:Page){await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/preview?foundation=1&fixture=flow');await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});await ready(page);}
async function deal(page:Page,count:number){await page.getByRole('button',{name:'한 장 나누기',exact:true}).click();await ready(page);await expect(zone(page,'hand')).toHaveCount(count);}
async function play(page:Page){await zone(page,'hand').first().press('Space');await ready(page);await page.getByRole('button',{name:'선택 확정 카드 내기',exact:true}).click();await ready(page);await expect(zone(page,'play')).toHaveCount(1);}
async function sample(page:Page,time:number){return portal(page).evaluate((element,time)=>{const svg=element.firstElementChild!;for(const animation of svg.getAnimations()){animation.pause();animation.currentTime=time;}const art=svg.getBoundingClientRect(),clip=element.getBoundingClientRect();return{x:art.left,y:art.top,left:art.left-clip.left,right:clip.right-art.right,top:art.top-clip.top,bottom:clip.bottom-art.bottom,pointer:getComputedStyle(element).pointerEvents,inert:(element as HTMLElement).inert,hidden:element.getAttribute('aria-hidden')};},time);}

test('explicit deal-select-play-collect conserves cards without advancing on animation completion',async({page},info)=>{
  await page.setViewportSize({width:1440,height:1100});await open(page);
  await deal(page,1);await expect(portal(page)).toHaveCount(1);
  expect(await portal(page).evaluate(element=>(element.firstElementChild!.getAnimations()[0].effect as KeyframeEffect).getKeyframes().length)).toBe(2);
  for(const time of [0,60,120,180,270,359]){const pose=await sample(page,time);for(const side of ['left','right','top','bottom'] as const)expect(pose[side]).toBeGreaterThanOrEqual(-.5);expect(pose.pointer).toBe('none');expect(pose.inert).toBe(true);expect(pose.hidden).toBe('true');}
  await expect(zone(page,'hand').first().locator(':scope > svg')).toHaveCSS('opacity','0');
  await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.finish()));
  await expect(portal(page)).toHaveCount(0);await expect(zone(page,'hand')).toHaveCount(1);await expect(zone(page,'hand').first().locator(':scope > svg')).toHaveCSS('opacity','1');
  await deal(page,2);await deal(page,3);await expect(zone(page,'stock')).toHaveCount(0);
  for(let count=1;count<=3;count++){
    await play(page);if(count===1){await expect(portal(page)).toHaveCount(1);
      const start=await sample(page,0),end=await sample(page,359);
      expect(Math.abs(start.x-end.x)+Math.abs(start.y-end.y)).toBeGreaterThan(50);
      const destination=await zone(page,'play').locator(':scope > svg').boundingBox();expect(end.x).toBeCloseTo(destination!.x,0);expect(end.y).toBeCloseTo(destination!.y,0);
      await sample(page,180);await page.screenshot({path:`/tmp/foundation-flow-${info.project.name}.png`});}

    await page.getByRole('button',{name:'트릭 모으기',exact:true}).click();await ready(page);await expect(zone(page,'captured')).toHaveCount(count);await expect(zone(page,'play')).toHaveCount(0);await expect(portal(page)).toHaveCount(1);await sample(page,180);
    const conserved=await page.locator('[data-foundation-kind="card"][data-foundation-entity]:not([data-foundation-entity=""])').evaluateAll(elements=>elements.map(element=>({id:(element as HTMLElement).dataset.foundationEntity,zone:(element as HTMLElement).dataset.foundationZone})));
    expect(conserved).toHaveLength(3);expect(conserved.map(card=>card.id).sort()).toEqual(['card-0','card-1','card-2']);expect(conserved.every(card=>['stock','hand','play','captured'].includes(card.zone??''))).toBe(true);
  }
  await page.getByRole('button',{name:'다시 시작',exact:true}).click();await ready(page);await expect(zone(page,'stock')).toHaveCount(3);await expect(zone(page,'captured')).toHaveCount(0);await expect(portal(page)).toHaveCount(0);
});

test('flight interruption restores native artwork and removes transient content',async({page})=>{
  await page.setViewportSize({width:1440,height:1100});await open(page);await deal(page,1);await expect(portal(page)).toHaveCount(1);await sample(page,90);
  await page.setViewportSize({width:1024,height:900});await ready(page);await expect(portal(page)).toHaveCount(0);await expect(zone(page,'hand').first().locator(':scope > svg')).toHaveCSS('opacity','1');
  await deal(page,2);await expect(portal(page)).toHaveCount(1);await sample(page,90);await page.emulateMedia({reducedMotion:'reduce'});await expect(portal(page)).toHaveCount(0);await expect(zone(page,'hand').last().locator(':scope > svg')).toHaveCSS('opacity','1');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'다시 시작',exact:true}).click();await ready(page);await deal(page,1);await expect(portal(page)).toHaveCount(1);await sample(page,90);
  await page.getByRole('button',{name:'분리',exact:true}).click();await expect(portal(page)).toHaveCount(0);
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();await ready(page);await expect(portal(page)).toHaveCount(0);
  await deal(page,2);await sample(page,90);await page.getByRole('button',{name:'권한 해제',exact:true}).click();await expect(portal(page)).toHaveCount(0);await expect(page.locator('[data-foundation-kind="card"]')).toHaveCount(0);
});

test('phone flow rejects an observed clipped source and resumes with admitted flights',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{const animate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight')){animation.pause();animation.currentTime=0;}return animation;};});
  await page.setViewportSize({width:320,height:568});await open(page);
  const source=zone(page,'stock').first();
  await expect(source).toHaveAttribute('data-foundation-entity','card-0');
  const clipped=await source.evaluate(element=>{
    const wrapper=document.createElement('div');wrapper.dataset.flowSourceClip='true';
    Object.assign(wrapper.style,{position:'absolute',left:'0',top:'0',width:'1px',height:'1px',overflow:'hidden',pointerEvents:'none'});
    element.parentElement!.insertBefore(wrapper,element);wrapper.append(element);
    const art=element.querySelector('svg')!.getBoundingClientRect(),clip=wrapper.getBoundingClientRect();
    return{width:wrapper.clientWidth,height:wrapper.clientHeight,overflow:getComputedStyle(wrapper).overflow,clipped:art.left<clip.left||art.top<clip.top||art.right>clip.right||art.bottom>clip.bottom};
  });
  expect(clipped).toEqual({width:1,height:1,overflow:'hidden',clipped:true});
  await deal(page,1);await expect(portal(page)).toHaveCount(0);
  await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-flight-status','source-clipped-or-transformed');
  await expect(zone(page,'hand').first()).toBeVisible();
  await expect(zone(page,'hand').first().locator(':scope > svg')).toHaveCSS('opacity','1');
  await page.locator('[data-flow-source-clip]').evaluateAll(elements=>elements.forEach(wrapper=>{while(wrapper.firstChild)wrapper.parentElement!.insertBefore(wrapper.firstChild,wrapper);wrapper.remove();}));
  const output=page.locator('output[data-foundation-action]');
  for(let count=2;count<=3;count++){
    await deal(page,count);const action=await output.textContent();
    // Adaptive phone geometry may admit a real flight; completion cannot submit
    // another command or change the canonical hand cardinality.
    if(await portal(page).count()){await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.finish()));await expect(portal(page)).toHaveCount(0);}
    await expect(output).toHaveText(action!);await expect(zone(page,'hand')).toHaveCount(count);
    for(const card of await zone(page,'hand').all())await expect(card.locator(':scope > svg')).toHaveCSS('opacity','1');
  }
  await play(page);await page.getByRole('button',{name:'트릭 모으기',exact:true}).click();await ready(page);await expect(zone(page,'captured')).toHaveCount(1);
  await page.setViewportSize({width:1440,height:1100});await ready(page);await play(page);await expect(portal(page)).toHaveCount(1);await sample(page,90);
  const action=await output.textContent(),target=zone(page,'play');
  const movement=await target.evaluate(async element=>{
    const parent=element.parentElement!,art=element.querySelector('svg')!,previous=parent.style.cssText,before=art.getBoundingClientRect().top;
    Object.assign(parent.style,{height:'40px',overflowY:'scroll'});
    await new Promise<void>(resolve=>{parent.addEventListener('scroll',()=>resolve(),{once:true});parent.scrollTop=4;});
    const result={before,after:art.getBoundingClientRect().top,scrollTop:parent.scrollTop};parent.style.cssText=previous;parent.scrollTop=0;return result;
  });
  expect(movement.scrollTop).toBe(4);expect(movement.after).toBeLessThan(movement.before);
  await expect(portal(page)).toHaveCount(0);await expect(target.locator(':scope > svg')).toHaveCSS('opacity','1');
  await expect(output).toHaveText(action!);await expect(zone(page,'play')).toHaveCount(1);await expect(zone(page,'hand')).toHaveCount(1);await expect(zone(page,'captured')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('animation startup failure rolls back the portal and keeps final state usable',async({page})=>{
  await page.addInitScript(()=>{SVGSVGElement.prototype.animate=function(){throw new Error('Injected animation startup failure');};});
  await page.setViewportSize({width:1440,height:1100});await open(page);await deal(page,1);
  await expect(portal(page)).toHaveCount(0);await expect(zone(page,'hand').first().locator(':scope > svg')).toHaveCSS('opacity','1');
  await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-flight-status','animation-unavailable');
  await deal(page,2);await expect(portal(page)).toHaveCount(0);
});
