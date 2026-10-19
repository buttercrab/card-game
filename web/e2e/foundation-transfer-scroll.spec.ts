import {expect,test} from '@playwright/test';

test('native scrolling of a card ancestor revokes the whole paused cohort immediately',async({page},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one measured native-scroll regression');
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1200});
 await page.goto('/preview?foundation=1&fixture=seats');
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
 const host=page.locator('.foundation-surface');await expect(host).toHaveAttribute('data-foundation-status','ready');
 await page.getByRole('button',{name:'한 바퀴 배분',exact:true}).click();
 const portal=page.locator('[data-foundation-flight]');await expect(portal.locator(':scope > svg')).toHaveCount(5);
 await portal.evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=0;}));
 const card=page.locator('[data-foundation-kind="card"][data-foundation-zone="hand"]');
 const movement=await card.evaluate(async element=>{
  const parent=element.parentElement!,art=element.firstElementChild!,before=art.getBoundingClientRect().top;
  // Perturb a real native card ancestor, without changing canonical authority.
  // The adapter must reject the resulting endpoint/clip change on scroll.
  Object.assign(parent.style,{height:'40px',overflowY:'scroll'});
  await new Promise<void>(resolve=>{parent.addEventListener('scroll',()=>resolve(),{once:true});parent.scrollTop=4;});
  return{before,after:art.getBoundingClientRect().top,scrollTop:parent.scrollTop};
 });
 expect(movement.scrollTop).toBe(4);expect(movement.after).toBeLessThan(movement.before);
 await expect(portal).toHaveCount(0);await expect(card.locator(':scope > svg')).toHaveCSS('opacity','1');
 const receipt=JSON.parse(await host.getAttribute('data-foundation-flight-clear')??'{}');expect(receipt.reason).toBe('scroll');
});
