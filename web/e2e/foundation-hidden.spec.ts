import {expect,test,type Page} from '@playwright/test';
const portal=(page:Page)=>page.locator('[data-foundation-flight]');
const hand=(page:Page)=>page.locator('[data-foundation-kind="card"][data-foundation-zone="hand"]');
const ready=async(page:Page)=>{await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(element=>element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width-24);};
async function open(page:Page){await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1100});await page.goto('/preview?foundation=1&fixture=hidden');await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});await ready(page);}
async function batch(page:Page){await page.getByRole('button',{name:'묶음 나누기',exact:true}).click();await ready(page);await expect(hand(page)).toHaveCount(3);}
async function pause(page:Page){await portal(page).evaluate(element=>{for(const animation of element.getAnimations({subtree:true})){animation.pause();animation.currentTime=0;}});}

test('hidden stock has no identities or faces; a staggered batch flies only backs then reveals at arrival',async({page},info)=>{
  await open(page);let newFontLoads=0;page.on('console',message=>{if(message.text()==='hidden-deal-font-loading')newFontLoads++;});await page.evaluate(()=>document.fonts.addEventListener('loading',()=>console.log('hidden-deal-font-loading')));await expect(hand(page)).toHaveCount(0);
  await expect(page.locator('[data-foundation-zone="stock"][data-foundation-entity]:not([data-foundation-entity=""])')).toHaveCount(0);
  await expect(page.locator('[data-foundation-zone="stock"] svg[data-card-back]')).toHaveCount(1);
  await expect(page.locator('[data-foundation-zone="stock"] svg text')).toHaveCount(0);
  await batch(page);await expect(portal(page)).toHaveCount(1);await pause(page);
  await expect(portal(page).locator('svg[data-flight-presentation="back"]')).toHaveCount(3);
  await expect(portal(page).locator('svg[data-card-back]')).toHaveCount(3);await expect(portal(page).locator('text')).toHaveCount(0);
  const timings=await portal(page).evaluate(element=>element.getAnimations({subtree:true}).map(animation=>({delay:animation.effect!.getTiming().delay,duration:animation.effect!.getTiming().duration,frames:(animation.effect as KeyframeEffect).getKeyframes().length})));
  expect(timings).toEqual([{delay:0,duration:360,frames:2},{delay:70,duration:360,frames:2},{delay:140,duration:360,frames:2}]);
  for(let i=0;i<3;i++)await expect(hand(page).nth(i).locator(':scope > svg')).toHaveCSS('opacity','0');
  await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=180+Number(animation.effect!.getTiming().delay);}));
  await page.screenshot({path:`/tmp/foundation-hidden-flight-${info.project.name}.png`});
  await portal(page).locator(':scope > svg').first().evaluate(element=>element.getAnimations()[0].finish());
  await expect(hand(page).first().locator(':scope > svg')).toHaveCSS('opacity','1');await expect(hand(page).nth(1).locator(':scope > svg')).toHaveCSS('opacity','0');
  await expect(portal(page).locator(':scope > svg')).toHaveCount(2);
  await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.finish()));
  await expect(portal(page)).toHaveCount(0);for(let i=0;i<3;i++)await expect(hand(page).nth(i).locator(':scope > svg')).toHaveCSS('opacity','1');
  await expect(page.locator('[data-foundation-action]')).toHaveText('{"Flow":"batch"}');expect(newFontLoads).toBe(0);
  await page.locator('.foundation-surface').screenshot({path:`/tmp/foundation-hidden-${info.project.name}.png`});
});

test('resize and remount release every delayed animation without replay',async({page})=>{
  await open(page);await batch(page);await pause(page);
  await page.setViewportSize({width:320,height:568});await ready(page);await expect(portal(page)).toHaveCount(0);
  for(let i=0;i<3;i++)await expect(hand(page).nth(i).locator(':scope > svg')).toHaveCSS('opacity','1');
  await page.getByRole('button',{name:'분리',exact:true}).click();await expect(hand(page)).toHaveCount(0);
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();await ready(page);await expect(hand(page)).toHaveCount(3);await expect(portal(page)).toHaveCount(0);
});

test('partial completion followed by revocation removes the whole remaining cohort',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);await batch(page);await pause(page);
  await portal(page).locator(':scope > svg').first().evaluate(element=>element.getAnimations()[0].finish());await expect(portal(page).locator(':scope > svg')).toHaveCount(2);
  await page.getByRole('button',{name:'권한 해제',exact:true}).click();await expect(portal(page)).toHaveCount(0);await expect(hand(page)).toHaveCount(0);
  await expect(page.locator('svg[data-flight-presentation]')).toHaveCount(0);expect(errors).toEqual([]);
});

test('failure starting the second animation rolls back all hidden artwork and handles',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{const original=Element.prototype.animate;let calls=0;Element.prototype.animate=function(...args){if(this.parentElement?.hasAttribute('data-foundation-flight')&&++calls===2)throw new Error('Injected partial batch startup failure');return original.apply(this,args);};});
  await open(page);await batch(page);await expect(portal(page)).toHaveCount(0);
  for(let i=0;i<3;i++)await expect(hand(page).nth(i).locator(':scope > svg')).toHaveCSS('opacity','1');
  await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-flight-status','animation-unavailable');expect(errors).toEqual([]);
});
