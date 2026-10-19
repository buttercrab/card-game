import {expect,test,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const profiles=['1440x900-dark','390x844-light','320x568-light'];

async function noCanvas(page:Page){await expect(page.locator('[data-live-canvas],[data-canvas-paint-boundary],[data-canvas-surface-manager]')).toHaveCount(0);}
async function noScroll(page:Page){const overflow=await page.evaluate(()=>({x:document.documentElement.scrollWidth-innerWidth,y:document.documentElement.scrollHeight-innerHeight}));expect(overflow.x).toBeLessThanOrEqual(1);expect(overflow.y).toBeLessThanOrEqual(1);}
/** Read rendered numeric bounds, then independently measure the DOM projection. No layout-engine import/formula. */
async function handProjection(page:Page){
  await expect.poll(()=>page.locator('.hand [data-coordinate-id]').evaluateAll(nodes=>nodes.every(node=>node.getAnimations({subtree:true}).every(animation=>animation.playState!=='running'&&!animation.pending)))).toBe(true);
  const receipt=await page.locator('.hand [data-coordinate-id]').evaluateAll(nodes=>nodes.map(node=>{
    const element=node as HTMLElement,parent=element.offsetParent as HTMLElement,box=element.getBoundingClientRect(),origin=parent.getBoundingClientRect(),card=element.querySelector('.card')!.getBoundingClientRect();
    const nativeCard=element.querySelector('.card')!,css=getComputedStyle(nativeCard),translate=css.translate.split(' '),used=(value:string,size:number)=>value.endsWith('%')?parseFloat(value)*size/100:parseFloat(value)||0;
    const nativeOffset={x:used(translate[0]??'0',box.width),y:used(translate[1]??'0',box.height)};
    const numeric={x:parseFloat(element.style.left),y:parseFloat(element.style.top),width:parseFloat(element.style.width),height:parseFloat(element.style.height)};
    return{id:element.dataset.coordinateId,numeric,nativeOffset,node:{x:box.x,y:box.y,width:box.width,height:box.height},card:{x:card.x,y:card.y,width:card.width,height:card.height},projected:{x:origin.x+parent.clientLeft+numeric.x-parent.scrollLeft,y:origin.y+parent.clientTop+numeric.y-parent.scrollTop}};
  }));
  expect(receipt.length).toBeGreaterThan(0);expect(new Set(receipt.map(node=>node.id)).size).toBe(receipt.length);
  for(const node of receipt){for(const key of ['x','y']as const)expect(Math.abs(node.node[key]-node.projected[key]),`${node.id} numeric ${key} vs independent native DOM`).toBeLessThanOrEqual(.75);for(const key of ['x','y','width','height']as const)expect(Math.abs(node.card[key]-node.node[key]-(key==='x'||key==='y'?node.nativeOffset[key]:0)),`${node.id} visible card ${key} vs numeric node and native decoration`).toBeLessThanOrEqual(.75);for(const key of ['width','height']as const)expect(Math.abs(node.node[key]-node.numeric[key])).toBeLessThanOrEqual(.75);}
  return receipt;
}

test('production DOM coordinate nodes match visible hand cards across phases and representative viewports',async({page},info)=>{
  test.skip(!profiles.includes(info.project.name),'representative production desktop/phone/narrow scenes');
  await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false,singleTap:false})));
  for(const state of ['play','exchange']){
    await page.goto(`/preview?state=${state}`);await page.locator('html[data-ready]').waitFor();await page.evaluate(()=>document.fonts.ready);await noCanvas(page);const receipt=await handProjection(page);await mkdir(info.outputPath(),{recursive:true});await writeFile(info.outputPath(`numeric-${state}.json`),JSON.stringify(receipt,null,2));await noScroll(page);
  }
});

test('native keyboard raises and picks cards under numeric DOM positioning',async({page},info)=>{
  test.skip(!profiles.includes(info.project.name),'desktop/phone/narrow input ownership');
  await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false,singleTap:false})));
  await page.goto('/preview?state=play');await page.locator('html[data-ready]').waitFor();await noCanvas(page);
  const playable=page.locator('.hand button.card:not(.unplayable)').first();await expect(playable).toBeEnabled();const before=await playable.boundingBox();await playable.press('Enter');await expect(playable).toHaveClass(/raised/);await expect.poll(async()=>(await playable.boundingBox())!.y).toBeLessThan(before!.y-5);await expect(playable).toBeFocused();
  await page.goto('/preview?state=exchange');await page.locator('html[data-ready]').waitFor();const pick=page.locator('.hand button.card:not(.unplayable)').first();await expect(pick).toBeEnabled();const unpicked=await pick.boundingBox();await pick.press('Enter');await expect(pick).toHaveClass(/picked/);await expect.poll(async()=>(await pick.boundingBox())!.y).toBeLessThan(unpicked!.y-5);await pick.press('Enter');await expect(pick).not.toHaveClass(/picked/);await noScroll(page);await noCanvas(page);
});

test('retained card nodes settle after interrupted responsive layout moves',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','full native-motion interruption');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'normal',sound:false,music:false})));
  await page.goto('/preview?state=play');await page.locator('html[data-ready]').waitFor();await page.evaluate(()=>document.fonts.ready);await handProjection(page);
  await page.evaluate(()=>{(window as any).__coordinateCards=[...document.querySelectorAll('.hand [data-coordinate-id]')].map(node=>({node,id:node.getAttribute('data-coordinate-id'),card:node.querySelector('.card')}));});
  await page.setViewportSize({width:800,height:600});await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await handProjection(page);
  expect(await page.evaluate(()=>((window as any).__coordinateCards as {node:Element;id:string;card:Element}[]).every(({node,id,card})=>node.isConnected&&node.getAttribute('data-coordinate-id')===id&&card.isSameNode(node.querySelector('.card'))))).toBe(true);await noScroll(page);await noCanvas(page);
});

test('an ordinary DOM room preserves one local identity through ten tricks and recentering',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','ordinary backend full-motion acceptance');test.setTimeout(180_000);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.setExtraHTTPHeaders({'X-Forwarded-For':`192.0.2.${info.workerIndex+180}`});
  await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('DOM 실전'));localStorage.setItem('mighty.settings',JSON.stringify({speed:'normal',sound:false,music:false,singleTap:false}));});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();await page.waitForURL(/\/r\/[a-z0-9]+$/);await page.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();
  for(let i=0;i<4;i++)await page.locator('.seat-act',{hasText:'봇 추가'}).first().click();
  await page.evaluate(()=>{const seat=document.querySelector('.me-seat .seat')!;(window as any).__ordinaryIdentity=[seat,seat.querySelector('.identity'),seat.querySelector('.stand svg.figure'),seat.querySelector('.meta')];});
  const retained=async()=>{expect(await page.evaluate(()=>{const seat=document.querySelector('.me-seat .seat')!,current=[seat,seat.querySelector('.identity'),seat.querySelector('.stand svg.figure'),seat.querySelector('.meta')];return((window as any).__ordinaryIdentity as Element[]).every((old,i)=>old.isConnected&&old.isSameNode(current[i]));})).toBe(true);await noCanvas(page);await noScroll(page);};
  const own=page.locator('.me-seat .seat');const centered=async()=>{await expect(page.locator('.tray')).toHaveClass(/centered/);await expect.poll(async()=>{const s=(await own.boundingBox())!,t=(await page.locator('.tray').boundingBox())!;return Math.abs(s.x+s.width/2-t.x-t.width/2);}).toBeLessThanOrEqual(2);};
  await retained();await centered();await page.getByRole('button',{name:'시작',exact:true}).click();await expect(page.locator('.hand .card')).toHaveCount(10);await retained();
  const {bidMaximum}=await import('./drive-deal');await bidMaximum(page);
  for(let i=0;i<3;i++)await page.locator('.hand button.card:not(.picked):not(.unplayable)').last().press('Enter');await page.getByRole('button',{name:'버리기',exact:true}).click();await page.getByRole('button',{name:/^프렌드 /}).click();
  for(let left=10;left>0;left--){const card=page.locator('.hand button.card:not(.unplayable)').first();await expect(card).toBeEnabled({timeout:20_000});await card.press('Enter');await expect(card).toHaveClass(/raised/);await card.press('Enter');const variants=page.locator('.variants .chip');if(await variants.count())await variants.first().click();await expect(page.locator('.hand .card')).toHaveCount(left-1);}
  await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeEnabled({timeout:20_000});await expect(page.locator('.finished-hands .card')).toHaveCount(50);await retained();await centered();
  await page.getByRole('button',{name:'더보기',exact:true}).click();const replay=page.getByRole('dialog',{name:'더보기',exact:true});await expect(replay).toBeVisible();for(let i=0;i<9;i++)await replay.getByRole('button',{name:'다음 라운드',exact:true}).click();await expect(replay.locator('.stepper')).toContainText('10/10');await replay.getByRole('button',{name:'현재 테이블로 돌아가기',exact:true}).click();await retained();
  await page.getByRole('button',{name:'다음 판',exact:true}).click();await expect(page.locator('.hand .card')).toHaveCount(10);await expect(page.locator('.result')).toHaveCount(0);await retained();expect(errors).toEqual([]);
});

test('two rapid genuine seat swaps retain participants and retarget the animated parent without a jump',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','actual room seat retarget with controlled original motion times');test.setTimeout(60_000);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('연속 자리'));localStorage.setItem('mighty.settings',JSON.stringify({speed:'normal',sound:false,music:false}));});
  await page.addInitScript(() => {
    const Original=window.WebSocket;
    class ObservedSocket extends Original {
      constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>{
        try {const message=JSON.parse(String(event.data)),people=(window as any).__rapidParticipants as {node:HTMLElement;name:string}[]|undefined;if(message.type!=='seats_moved'||!people)return;
          ((window as any).__rapidMessages??=[]).push({time:performance.now(),message,people:people.map(({node,name})=>({name,box:node.getBoundingClientRect().toJSON(),animations:node.getAnimations().map(animation=>({id:animation.id,state:animation.playState,currentTime:animation.currentTime,startTime:animation.startTime,frames:(animation.effect as KeyframeEffect)?.getKeyframes(),timing:animation.effect?.getTiming()}))}))});
        }catch{}
      });}
    }
    window.WebSocket=ObservedSocket;
  });
  await page.goto('/');await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();await page.waitForURL(/\/r\/[a-z0-9]+$/);await page.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();for(let i=0;i<4;i++)await page.locator('.seat-act',{hasText:'봇 추가'}).first().click();
  await expect(page.locator('.ring > .spot svg.figure')).toHaveCount(4);
  await page.evaluate(()=>{(window as any).__rapidMessages=[];(window as any).__rapidParticipants=[...document.querySelectorAll('.ring > .spot .seat-box')].map(node=>({node,seat:node.querySelector('.seat'),figure:node.querySelector('svg.figure'),name:node.querySelector('.name')?.textContent}));});
  const taps=page.locator('.ring > .spot .seat-tap');await taps.nth(0).click();await page.getByRole('button',{name:'자리 바꾸기',exact:true}).click();await taps.nth(1).click();
  await expect.poll(()=>page.locator('.ring > .spot .seat-box').evaluateAll(nodes=>nodes.some(node=>node.getAnimations().some(a=>a.id==='seat-slide'&&a.playState==='running')))).toBe(true);
  const before=await page.evaluate(()=>{const people=(window as any).__rapidParticipants as {node:HTMLElement;name:string}[];for(const{node}of people)for(const animation of node.getAnimations())if(animation.id==='seat-slide'){animation.pause();animation.currentTime=100;}return people.map(({node,name})=>({name,box:node.getBoundingClientRect().toJSON()}));});
  // Native DOM handlers dispatch the real room command promptly. Each
  // target is freshly queried after its actual Svelte menu renders.
  await page.evaluate(async()=>{
    const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    (document.querySelectorAll('.ring > .spot .seat-tap')[1] as HTMLButtonElement).click();await frame();
    const swap=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='자리 바꾸기');if(!swap||swap.disabled)throw Error('No live enabled swap command');swap.click();await frame();
    (document.querySelectorAll('.ring > .spot .seat-tap')[2] as HTMLButtonElement).click();
  });
  await expect.poll(()=>page.evaluate(()=>((window as any).__rapidMessages??[]).length)).toBe(2);
  await expect.poll(()=>page.locator('.ring > .spot .seat-box').evaluateAll(nodes=>nodes.some(node=>node.getAnimations().some(a=>a.id==='seat-slide'&&a.playState==='running')))).toBe(true);
  const after=await page.evaluate(()=>{const people=(window as any).__rapidParticipants as {node:HTMLElement;seat:Element;figure:Element;name:string}[];for(const{node}of people)for(const animation of node.getAnimations())if(animation.id==='seat-slide'){animation.pause();animation.currentTime=0;}return people.map(({node,seat,figure,name})=>({name,box:node.getBoundingClientRect().toJSON(),retained:node.isConnected&&seat.isSameNode(node.querySelector('.seat'))&&figure.isSameNode(node.querySelector('svg.figure'))&&node.querySelector('.name')?.textContent===name}));});
  const messages=await page.evaluate(()=>(window as any).__rapidMessages as {time:number;people:{name:string;box:typeof before[number]['box'];animations:{id:string;state:string;currentTime:number}[]}[]}[]);
  await mkdir(info.outputPath(),{recursive:true});await writeFile(info.outputPath('rapid-seat-retarget.json'),JSON.stringify({manualFirstPause:before,messages,after},null,2));
  expect(messages[1].time-messages[0].time,'actual server move messages must arrive before the460ms first motion completes').toBeLessThan(460);
  expect(messages[1].people.some(person=>person.animations.some(animation=>animation.id==='seat-slide'&&animation.state==='paused'&&animation.currentTime===100))).toBe(true);
  for(const old of messages[1].people){const current=after.find(person=>person.name===old.name)!;expect(current.retained).toBe(true);for(const key of ['x','y','width','height']as const)expect(Math.abs(old.box[key]-current.box[key]),`${old.name} exact server-boundary retarget ${key}`).toBeLessThanOrEqual(.75);}
  await page.evaluate(()=>{for(const animation of document.getAnimations())if(animation.id==='seat-slide')animation.play();});await noScroll(page);await noCanvas(page);
});
