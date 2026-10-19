import {expect,test,type Page} from '@playwright/test';
import {PEER_FIGURE_SIZE} from '../src/lib/table/foundation/participantPresentation';
const portal=(page:Page)=>page.locator('[data-foundation-flight]');
const hand=(page:Page)=>page.locator('[data-foundation-kind="card"][data-foundation-zone="hand"]');
const recipients=(page:Page)=>page.locator('[data-foundation-recipient]:not([data-foundation-recipient=""])');
const ready=async(page:Page)=>{await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(element=>element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width-24);};
async function open(page:Page,width=1440,height=1200){await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width,height});await page.goto('/preview?foundation=1&fixture=seats');await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});await ready(page);}
async function round(page:Page,count:number){await page.getByRole('button',{name:'한 바퀴 배분',exact:true}).click();await ready(page);await expect(hand(page)).toHaveCount(count);}
async function pause(page:Page){await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=0;}));}
async function finish(page:Page){await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.finish()));await expect(portal(page)).toHaveCount(0);}

test('three five-card rounds use one local face hand and four count-only opponent destinations',async({page},info)=>{
  await open(page);await expect(recipients(page)).toHaveCount(4);await expect(hand(page)).toHaveCount(0);
  await round(page,1);await expect(portal(page).locator(':scope > svg')).toHaveCount(5);await pause(page);
  await expect(portal(page).locator('svg[data-card-back]')).toHaveCount(5);await expect(portal(page).locator('text')).toHaveCount(0);
  expect(await portal(page).evaluate(element=>element.getAnimations({subtree:true}).map(animation=>animation.effect!.getTiming().delay))).toEqual([0,70,140,210,280]);
  expect(await portal(page).evaluate(element=>element.getAnimations({subtree:true}).map(animation=>(animation.effect as KeyframeEffect).getKeyframes().length))).toEqual([2,2,2,2,2]);
  await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.currentTime=100+Number(animation.effect!.getTiming().delay)));
  await page.screenshot({path:`/tmp/foundation-seats-${info.project.name}.png`});await finish(page);
  await expect(hand(page).locator(':scope > svg')).toHaveCSS('opacity','1');await expect(hand(page)).toHaveAttribute('data-foundation-entity','deal-card-0');
  expect(await recipients(page).evaluateAll(elements=>elements.map(element=>element.getAttribute('data-foundation-recipient-count')))).toEqual(['1','1','1','1']);
  await expect(recipients(page).locator('svg[data-card-back]')).toHaveCount(4);await expect(recipients(page).locator('svg text')).toHaveCount(0);
  for(const count of [2,3]){await round(page,count);await expect(portal(page).locator(':scope > svg')).toHaveCount(5);await finish(page);}
  expect(await recipients(page).evaluateAll(elements=>elements.map(element=>element.getAttribute('data-foundation-recipient-count')))).toEqual(['3','3','3','3']);
  await expect(page.getByRole('button',{name:'한 바퀴 배분',exact:true})).toHaveCount(0);
  await expect(page.getByText('덱 · 0장',{exact:true})).toBeVisible();
});

test('viewer replacement during a deal removes old private faces and does not replay flights',async({page})=>{
  await open(page);await round(page,1);await pause(page);
  const old=await hand(page).first().elementHandle();
  await page.getByRole('button',{name:'다음 시점',exact:true}).click();await ready(page);await expect(portal(page)).toHaveCount(0);
  expect(await old!.evaluate(element=>element.isConnected)).toBe(false);
  await expect(hand(page)).toHaveCount(1);await expect(hand(page)).toHaveAttribute('data-foundation-entity','deal-card-1');
  await expect(page.locator('[data-foundation-entity="deal-card-0"]')).toHaveCount(0);
  for(let viewer=2;viewer<5;viewer++){await page.getByRole('button',{name:'다음 시점',exact:true}).click();await ready(page);await expect(hand(page)).toHaveAttribute('data-foundation-entity',`deal-card-${viewer}`);await expect(portal(page)).toHaveCount(0);}
});

test('readable opponent identities remain separated through phone/tablet resize and explicit non-fit',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page,320,568);await round(page,1);await expect(portal(page)).toHaveCount(0);
  for(const [width,height] of [[320,568],[568,320],[768,1024],[1440,1200]]){
    await page.setViewportSize({width,height});await ready(page);
    const failures=await page.locator('[data-foundation-node][role="group"]').evaluateAll((elements,expectedSize)=>{
      const peers=elements.filter(element=>{try{const id=JSON.parse((element as HTMLElement).dataset.foundationNode!);return Array.isArray(id)&&id.length===2&&id[0]==='opponent';}catch{return false;}});
      if(peers.length!==4)return ['missing-peer-identities'];
      return peers.flatMap(element=>{
      // Only canonical peer identity roots, rather than enclosing arena groups.
      const name=element.getAttribute('aria-label');
      if(!name)return ['missing-peer-name'];
      const figure=[...element.querySelectorAll<HTMLElement>('[data-foundation-kind="figure"]')].find(figure=>figure.getAttribute('aria-label')===name);
      const label=[...element.querySelectorAll<HTMLElement>('[data-foundation-kind="text"]')].find(text=>text.textContent===name);
      if(!figure||!label)return ['missing-peer-art-or-label'];
      const a=figure.getBoundingClientRect(),b=label.getBoundingClientRect(),parent=element.getBoundingClientRect(),errors:string[]=[];
      if(Math.abs(a.width-expectedSize)>.1||Math.abs(a.height-expectedSize)>.1||b.top<a.bottom-.5||b.left<parent.left-.5||b.right>parent.right+.5||b.bottom>parent.bottom+.5)errors.push('identity-overlap-or-shrink');
      // Labels must fit their own measured boxes even when the public board is
      // intentionally scrollable; scrolling cannot excuse glyph overflow.
      const text=label.firstChild;if(text)for(const match of (text.textContent??'').matchAll(/\S/gu)){const range=document.createRange();range.setStart(text,match.index!);range.setEnd(text,match.index!+match[0].length);for(const ink of range.getClientRects())if(ink.left<b.left-1||ink.right>b.right+1||ink.top<b.top-1||ink.bottom>b.bottom+1)errors.push('name-glyph-overflow');}
      return errors;
    });},PEER_FIGURE_SIZE);expect(failures).toEqual([]);await expect(recipients(page)).toHaveCount(4);await expect(portal(page)).toHaveCount(0);
  }
  await page.setViewportSize({width:224,height:568});await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','fallback');await expect(hand(page)).toHaveCount(0);
  await page.setViewportSize({width:320,height:568});await ready(page);await expect(hand(page)).toHaveCount(1);expect(errors).toEqual([]);
});
