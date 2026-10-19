import {expect,test} from '@playwright/test';

for(const seated of [false,true]) test(`retained ${seated?'bot-add':'seat-selection'} controls recover their natural size after repeated resize`,async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','one real room per participation state');
  await page.setExtraHTTPHeaders({'X-Forwarded-For':`192.0.2.${180+info.workerIndex}`});
  await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('크기 확인'));localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false}));});
  await page.goto('/');await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();
  if(seated)await page.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();
  const controls=page.locator('.spot .seat-actions button');
  await expect(controls).toHaveCount(4);
  for(const button of await controls.all())await expect(button).toBeVisible();
  // Compare actual rendered bounds, not the layout solver's own output.
  const snapshot=()=>controls.evaluateAll(buttons=>buttons.map(e=>{const b=e.getBoundingClientRect();return{text:e.textContent,x:b.x,y:b.y,width:b.width,height:b.height};}));
  await expect.poll(async()=>(await snapshot()).every(b=>b.height===44)).toBe(true);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.table')).toHaveAttribute('data-frame-mode','sidebar');
  let previous='',stable=0;
  for(let frames=0;frames<20&&(frames<4||stable<3);frames++){
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
    const next=JSON.stringify(await snapshot());stable=next===previous?stable+1:0;previous=next;
  }
  expect(stable).toBeGreaterThanOrEqual(3);
  const reference=await snapshot();const retained=await controls.elementHandles();
  for(const [width,height]of [[320,568],[768,1024],[390,844],[1440,900],[568,320],[1440,900]]){
    await page.setViewportSize({width,height});
    if(width===1440)await expect.poll(snapshot).toEqual(reference);
    else await expect.poll(async()=>{const boxes=await snapshot();return boxes.every(b=>b.width>=44&&b.height>=44&&b.x>=-1&&b.x+b.width<=width+1&&b.y>=-1&&b.y+b.height<=height+1);}).toBe(true);
    for(const handle of retained)expect(await handle.evaluate(e=>e.isConnected)).toBe(true);
  }
  const alignment=await controls.evaluateAll(buttons=>buttons.map(e=>{const b=e.getBoundingClientRect(),avatar=e.closest('.seat')!.querySelector('.stand')!.getBoundingClientRect();return Math.abs(b.x+b.width/2-avatar.x-avatar.width/2);}));
  expect(alignment.every(delta=>delta<=1)).toBe(true);
  const targets=await controls.evaluateAll(buttons=>buttons.map(e=>{const b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return hit===e||!!hit&&e.contains(hit);}));
  expect(targets.every(Boolean)).toBe(true);
  expect(await page.locator('[data-engine-intrinsic-probe]').count()).toBe(0);
  if(seated){
    const add=page.getByRole('button',{name:'2번 자리에 봇 앉히기',exact:true});await add.focus();await add.press('Enter');
    await expect(page.locator('.spot[data-seat="1"] .seat')).not.toHaveClass(/empty/);
  } else {
    const seat=page.getByRole('button',{name:'2번 자리에 앉기',exact:true});await seat.focus();await seat.press('Enter');
    await expect(page.getByRole('button',{name:'이 자리에서 참여',exact:true})).toBeVisible();
  }
});
