import {expect,test,type Page,type Locator} from '@playwright/test';
import {foundationBotButton, joinFoundation } from './foundationHelpers';
import {ACHIEVEMENTS} from '../src/lib/games/mighty/achievementCatalog';
import {COMPLETION_STORAGE_KEY} from '../src/lib/games/mighty/completionStore';
import {watchMightyCompletion} from './foundationCompletionAudit';
import {auditMightyReadViews} from './foundationReadViews';
import {auditMightyDeviceDeletion} from './foundationDeviceDeletion';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`});
const hand=(page:Page)=>page.locator('.live-surface [data-foundation-kind="card"][data-foundation-zone="hand"]');
const result=(page:Page)=>page.getByRole('group',{name:'이번 판 결과',exact:true});
async function act(page:Page,onFinal?:(target:Locator)=>Promise<void>){
  const pass=page.getByRole('button',{name:'패스',exact:true});
  if(await pass.isEnabled({timeout:100}).catch(()=>false)){await pass.click({timeout:1000});return;}
  const selected=page.locator('.live-surface button[data-foundation-kind="card"][aria-pressed]:enabled');
  if(await selected.count()){
    await selected.first().click({position:{x:8,y:30},timeout:1000});
    const submit=page.getByRole('button',{name:/^선택 확정 /});if(await submit.isEnabled({timeout:100}).catch(()=>false)){if(onFinal&&await hand(page).count()===1)await onFinal(submit);else await submit.click({timeout:1000});}return;
  }
  const commands=page.locator(`.live-surface button[data-foundation-kind="command"][data-foundation-node^='["command",']:enabled:not([aria-expanded])`).filter({hasNotText:'딜미스'}).filter({hasNotText:'다음 판'}).filter({hasNotText:'준비'});
  if(await commands.count()){if(onFinal&&await hand(page).count()===1)await onFinal(commands.first());else await commands.first().click({timeout:1000});}
}

test('real bot table uses only the foundation root, plays through reload and reaches a scored result',async({page,request,browser},info)=>{
  test.skip(info.project.name!=='390x844-light','one real-server lifecycle');test.setTimeout(240000);
  await page.addInitScript(()=>{
    const scope=window as typeof window&{foundationSockets:WebSocket[];heldFoundationStates:number;restoreFlightStarts:number;releaseFoundationStates:()=>void};scope.foundationSockets=[];scope.heldFoundationStates=0;scope.restoreFlightStarts=0;
    const Native=WebSocket;window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);scope.foundationSockets.push(this);}};
    let held=sessionStorage.getItem('foundation.audit.hold-state')==='1';const queued:(()=>void)[]=[],descriptor=Object.getOwnPropertyDescriptor(Native.prototype,'onmessage')!;
    scope.releaseFoundationStates=()=>{held=false;sessionStorage.removeItem('foundation.audit.hold-state');queued.splice(0).forEach(run=>run());};
    Object.defineProperty(window.WebSocket.prototype,'onmessage',{get(){return descriptor.get!.call(this);},set(handler:(event:MessageEvent)=>void){descriptor.set!.call(this,(event:MessageEvent)=>{const message=JSON.parse(event.data);if(held&&message.type==='state'){scope.heldFoundationStates++;queued.push(()=>handler.call(this,event));return;}handler.call(this,event);});}});
    const animate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight'))scope.restoreFlightStarts++;return animation;};
    localStorage.setItem('name',JSON.stringify('나'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:held?'normal':'off'}));
  });
  const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);const {id}=await response.json();
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const auditCompletion=watchMightyCompletion(page);
  const sent:unknown[]=[],roomSent:unknown[]=[];page.on('websocket',socket=>socket.on('framesent',frame=>{const value=JSON.parse(String(frame.payload));if(value.type==='submit'||value.type==='act')sent.push(value.action);if(value.type==='submit_room')roomSent.push(value.action);}));
  await page.goto(`/r/${id}?foundation=1`);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');
  await joinFoundation(page);
  for(let i=0;i<4;i++){await foundationBotButton(page).click();if(i<3)await expect(foundationBotButton(page)).toBeEnabled();}
  await page.getByRole('button',{name:'시작',exact:true}).click();await expect(hand(page)).toHaveCount(10);
  expect(await page.locator('.hand,.table-stage,.room-page').count()).toBe(0);
  await expect(async()=>{if(await hand(page).count()===9)return;await act(page);expect(await hand(page).count()).toBe(9);}).toPass({timeout:45000,intervals:[100]});
  const ids=await hand(page).evaluateAll(elements=>elements.map(element=>element.getAttribute('data-foundation-entity')));const before=sent.length;
  await page.reload();await expect(hand(page)).toHaveCount(9);expect(await hand(page).evaluateAll(elements=>elements.map(element=>element.getAttribute('data-foundation-entity')))).toEqual(ids);expect(sent.length).toBe(before);
  await page.evaluate(()=>{const scope=window as typeof window&{foundationSockets:WebSocket[]};scope.foundationSockets.filter(socket=>socket.readyState===WebSocket.OPEN).at(-1)!.close();});
  await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','closed');await expect(hand(page)).toHaveCount(0);
  await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await expect(hand(page)).toHaveCount(9);expect(sent.length).toBe(before);
  let heldFinal=false,heldRoomBefore:number|null=null;
  const finalGesture=async(target:Locator)=>{
    const before=roomSent.length;heldRoomBefore=before;await target.focus();await page.keyboard.down('Enter');
    try{await expect(result(page)).toHaveCount(1,{timeout:10000});heldFinal=true;}finally{await page.keyboard.up('Enter');}
    expect(roomSent.length).toBe(before);await expect(hand(page)).toHaveCount(0);
  };
  await expect.poll(async()=>{if(await result(page).count())return true;await act(page,finalGesture);return await result(page).count()===1;},{timeout:60000,intervals:[100]}).toBe(true);
  expect(heldFinal).toBe(true);expect(roomSent.length).toBe(heldRoomBefore);
  await expect(hand(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeEnabled();
  await expect(()=>auditCompletion()).toPass({timeout:5000});
  const awardTexts=()=>result(page).locator('[data-foundation-kind="text"][data-foundation-node*="badges"]').allTextContents();
  const audit=auditCompletion(),records=()=>page.evaluate(key=>{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;},COMPLETION_STORAGE_KEY);
  await expect.poll(async()=> (await records())?.hands?.length).toBe(1);
  const saved=await records();expect(saved.hands[0]).toMatchObject(audit.summary);expect(saved.completed).toEqual([audit.key]);expect(Object.keys(saved.unlocked).sort()).toEqual(audit.unlockedIds);
  expect((await awardTexts()).sort()).toEqual([...audit.earnedTitles].sort());
  expect(JSON.stringify(saved)).not.toContain('Normal');expect(JSON.stringify(saved)).not.toContain('discards');expect(JSON.stringify(saved)).not.toContain('tricks');
  await page.screenshot({path:'/tmp/foundation-live-result.png',fullPage:true});
  // Reconnect with all live State packets withheld. Only this connection's
  // exact authenticated public Session/Room checkpoint may paint the result;
  // continuation stays disabled until ordinary game publication is coherent.
  const roomBefore=roomSent.length,gameBefore=sent.length;
  await page.evaluate(()=>sessionStorage.setItem('foundation.audit.hold-state','1'));await page.reload();
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{heldFoundationStates:number}).heldFoundationStates)).toBeGreaterThan(0);
  await expect(result(page),JSON.stringify(auditCompletion.checkpoint())).toHaveCount(1);await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeDisabled();await expect(hand(page)).toHaveCount(0);
  expect(roomSent.length).toBe(roomBefore);expect(sent.length).toBe(gameBefore);
  await page.screenshot({path:'/tmp/foundation-public-result-before-state.png',fullPage:true});
  await page.evaluate(()=>(window as typeof window&{releaseFoundationStates:()=>void}).releaseFoundationStates());
  await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeEnabled();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(await page.evaluate(()=>(window as typeof window&{restoreFlightStarts:number}).restoreFlightStarts)).toBe(0);
  expect((await records()).hands).toHaveLength(1);expect((await records()).completed).toEqual([audit.key]);expect(await awardTexts()).toEqual([]);
  // A second actual hand fails only the atomic device-record item write.
  // Gameplay and authority stay live; benign publication cannot retry it.
  await page.evaluate(key=>{const state=window as typeof window&{completionWriteAttempts:number};state.completionWriteAttempts=0;const write=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===key){state.completionWriteAttempts++;throw new DOMException('controlled quota','QuotaExceededError');}return write.call(this,name,value);};},COMPLETION_STORAGE_KEY);
  await page.getByRole('button',{name:'다음 판',exact:true}).click();await expect(hand(page)).toHaveCount(10);
  await expect.poll(async()=>{if(await result(page).count())return true;await act(page);return await result(page).count()===1;},{timeout:75000,intervals:[100]}).toBe(true);
  await expect(page.getByText('이 기기에 기록을 저장하지 못했어요.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as typeof window&{completionWriteAttempts:number}).completionWriteAttempts)).toBe(1);
  expect((await records()).hands).toHaveLength(1);expect((await records()).completed).toEqual([audit.key]);expect(await awardTexts()).toEqual([]);
  await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('controlled notice'))}});});
  await page.getByRole('button',{name:/초대하기/}).click();await page.setViewportSize({width:375,height:844});await expect(result(page)).toHaveCount(1);
  expect(await page.evaluate(()=>(window as typeof window&{completionWriteAttempts:number}).completionWriteAttempts)).toBe(1);
  const beforeRecovery={game:sent.length,room:roomSent.length};await page.reload();await expect(result(page)).toHaveCount(1);
  await expect.poll(async()=> (await records())?.hands?.length).toBe(2);expect((await records()).completed).toHaveLength(2);expect(sent.length).toBe(beforeRecovery.game);expect(roomSent.length).toBe(beforeRecovery.room);
  const recovered=await records(),newTitles=ACHIEVEMENTS.filter(item=>Object.hasOwn(recovered.unlocked,item.id)&&!Object.hasOwn(saved.unlocked,item.id)).map(item=>item.title);
  expect((await awardTexts()).sort()).toEqual([...newTitles].sort());
  await info.attach('completion-award-presentation',{body:JSON.stringify({first: [...audit.earnedTitles],recovered:[...newTitles],storedHands:recovered.hands.length}),contentType:'application/json'});
  console.log(JSON.stringify({kind:'completion-award-presentation',first:[...audit.earnedTitles],recovered:[...newTitles],storedHands:recovered.hands.length}));
  // An independently authenticated observer sees the public result but does
  // not inherit either participant's device records or awards.
  const observerContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',reducedMotion:'reduce'});
  try{
    await observerContext.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('기록 관전자'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
    const observer=await observerContext.newPage();await observer.goto(`${new URL(page.url()).origin}/r/${id}?foundation=1`);await expect(result(observer)).toHaveCount(1);
    // The compact result preserves the outcome and continuation; historical
    // participation details are read through the same native information view.
    await result(observer).getByRole('button',{name:'테이블 정보',exact:true}).click();
    const observerInformation=observer.getByRole('dialog',{name:'테이블 정보',exact:true});await expect(observerInformation).toBeVisible();
    await expect(observerInformation.getByText('이번 판에 참여하지 않았어요',{exact:true})).toBeVisible();
    await observerInformation.getByRole('button',{name:'닫기',exact:true}).click();await expect(observerInformation).toHaveCount(0);
    expect(await observer.evaluate(key=>localStorage.getItem(key),COMPLETION_STORAGE_KEY)).toBeNull();await expect(hand(observer)).toHaveCount(0);
  }finally{await observerContext.close();}
  expect((await records()).hands).toHaveLength(2);expect((await awardTexts()).sort()).toEqual([...newTitles].sort());
  // Score reset changes the live period while retaining this public result.
  // Its producer-stamped original period must prevent another device record.
  const beforeReset=await records();
  const modal=page.locator('[data-foundation-node="room-dialog"]');
  await page.getByRole('button',{name:/함께 있는 사람/}).first().click();
  await modal.getByRole('button',{name:'관리',exact:true}).last().click();
  await expect(modal).toHaveAccessibleName('테이블 관리');
  await modal.getByRole('button',{name:'점수 초기화',exact:true}).click();
  await expect(modal).toHaveAccessibleName('누적 점수를 초기화할까요?');
  const resetBefore=roomSent.filter((action:any)=>action?.type==='reset_scores').length;
  await modal.getByRole('button',{name:'점수 초기화',exact:true}).click();
  await expect.poll(()=>roomSent.filter((action:any)=>action?.type==='reset_scores').length).toBe(resetBefore+1);
  if(await modal.count())await modal.getByRole('button',{name:'닫기',exact:true}).click();
  await expect(result(page)).toHaveCount(1);expect(await records()).toEqual(beforeReset);
  await page.evaluate(()=>sessionStorage.setItem('foundation.audit.hold-state','1'));await page.reload();
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{heldFoundationStates:number}).heldFoundationStates)).toBeGreaterThan(0);
  await expect(result(page)).toHaveCount(1);
  await expect(page.locator('.live-surface [data-foundation-zone="captured"][data-foundation-kind="card"]')).toHaveCount(5);
  expect(await records()).toEqual(beforeReset);
  // Read-only history/device UI must work from the authenticated public
  // checkpoint while every live State remains withheld and Game is disabled.
  await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeDisabled();
  const flightsBeforeReads=await page.evaluate(()=>(window as typeof window&{restoreFlightStarts:number}).restoreFlightStarts);
  await auditMightyReadViews(page,browser,id,()=>({game:sent.length,room:roomSent.length}));
  expect(await page.evaluate(()=>(window as typeof window&{restoreFlightStarts:number}).restoreFlightStarts)).toBe(flightsBeforeReads);
  // Presence invalidated the public checkpoint. The host may now show only
  // its public shell, so continuation must be absent OR disabled until State.
  await expect(page.getByRole('button',{name:'다음 판',exact:true}).and(page.locator(':enabled'))).toHaveCount(0);
  await page.evaluate(()=>(window as typeof window&{releaseFoundationStates:()=>void}).releaseFoundationStates());
  await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeEnabled();expect(await records()).toEqual(beforeReset);
  await auditMightyDeviceDeletion(page,()=>({game:sent.length,room:roomSent.length}));
  expect(errors).toEqual([]);
});
