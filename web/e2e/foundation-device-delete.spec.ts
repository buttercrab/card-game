import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {joinFoundation} from './foundationHelpers';
import {openDeviceRecords,openDeviceDeletion} from './foundationDeviceDeletion';
import {COMPLETION_STORAGE_KEY,completionKey} from '../src/lib/games/mighty/completionStore';
const record=(n:number)=>({key:completionKey({roomId:'seed',roomEpoch:'epoch',sessionId:1,handNumber:n,actorId:'device'}),at:n,role:'declarer',won:true,payoff:6,contract:{trump:null,count:17},teamPoints:20});
test('device deletion cancels safely, consumes a failed attempt, and requires a fresh singleton read',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real native storage path');test.setTimeout(45000);
 const first=record(1),records={version:1,completed:[first.key],hands:[first],unlocked:{'first-win':1}};
 await page.addInitScript(({key,records})=>{localStorage.setItem(key,JSON.stringify(records));localStorage.setItem('name',JSON.stringify('삭제 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));},{key:COMPLETION_STORAGE_KEY,records});
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}}),{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);
 const mutations:string[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>socket.on('framesent',frame=>{const message=JSON.parse(String(frame.payload));if(['act','submit','submit_room'].includes(message.type))mutations.push(message.type);}));
 await page.evaluate(key=>{const scope=window as typeof window&{deleteQuota:boolean;deleteAttempts:number};scope.deleteQuota=false;scope.deleteAttempts=0;const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===localStorage&&k===key){scope.deleteAttempts++;if(scope.deleteQuota)throw new DOMException('quota','QuotaExceededError');}return set.call(this,k,v);};},COMPLETION_STORAGE_KEY);
 await openDeviceRecords(page);let confirmation=await openDeviceDeletion(page);await confirmation.getByRole('button',{name:'취소',exact:true}).click();expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY)).toEqual(records);
 confirmation=await openDeviceDeletion(page);await page.evaluate(()=>(window as typeof window&{deleteQuota:boolean}).deleteQuota=true);await confirmation.getByRole('button',{name:'기록 삭제',exact:true}).click();await expect(confirmation.getByText('기록 삭제 · 이 기기에 기록을 저장하지 못했어요.',{exact:true})).toBeVisible();await expect(confirmation.getByRole('button',{name:'기록 삭제',exact:true})).toBeDisabled();
 await confirmation.getByRole('button',{name:'기록 삭제',exact:true}).evaluate(button=>(button as HTMLButtonElement).click());expect(await page.evaluate(()=>(window as typeof window&{deleteAttempts:number}).deleteAttempts)).toBe(1);expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY)).toEqual(records);
 await confirmation.getByRole('button',{name:'취소',exact:true}).click();await page.getByRole('dialog',{name:'내 기록',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();await page.evaluate(()=>(window as typeof window&{deleteQuota:boolean}).deleteQuota=false);
 await openDeviceRecords(page);confirmation=await openDeviceDeletion(page);const deleteButton=confirmation.getByRole('button',{name:'기록 삭제',exact:true});await expect(deleteButton).toBeEnabled();
 await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
 await expect.poll(()=>deleteButton.evaluate(button=>{const surface=button.closest<HTMLElement>('.live-surface');return button.isConnected&&surface?.dataset.foundationStatus==='ready'&&button.getAttribute('data-foundation-frame')===surface.dataset.foundationFrame;})).toBe(true);
 // A fresh physical down acquires this exact publication. The forced duplicate
 // native invocations then exercise one owned activation, not a preceding
 // opener's still-retiring default-action capture.
 await deleteButton.evaluate(button=>{button.addEventListener('pointerdown',event=>{(button as HTMLButtonElement&{deleteDownProof?:unknown}).deleteDownProof={trusted:event.isTrusted,frame:button.getAttribute('data-foundation-frame'),node:button.getAttribute('data-foundation-node')};},{once:true});});
 await deleteButton.hover();await page.mouse.down();let activation:unknown;
 try{activation=await deleteButton.evaluate(button=>{
  const control=button as HTMLButtonElement,surface=control.closest<HTMLElement>('.live-surface');
  const state=()=>({connected:control.isConnected,disabled:control.disabled,controlFrame:control.dataset.foundationFrame,surfaceFrame:surface?.dataset.foundationFrame,surfaceStatus:surface?.dataset.foundationStatus,node:control.dataset.foundationNode});
  const events:{trusted:boolean;detail:number;pointerId:number|null}[]=[];
  control.addEventListener('click',event=>events.push({trusted:event.isTrusted,detail:event.detail,pointerId:event instanceof PointerEvent?event.pointerId:null}));
  const before=state(),nativeDown=(control as HTMLButtonElement&{deleteDownProof?:{trusted:boolean;frame:string|null;node:string|null}}).deleteDownProof;control.click();control.click();return {before,after:state(),events,nativeDown,sameFrame:before.controlFrame===before.surfaceFrame&&nativeDown?.frame===before.controlFrame&&nativeDown?.node===before.node};
 });}finally{await page.mouse.up();}
 const viewer=page.getByRole('dialog',{name:'내 기록',exact:true});
 const saveDiagnostic=async(outcome:'passed'|'failed')=>{
  const diagnostic=await page.evaluate(key=>{
   const raw=localStorage.getItem(key),scope=window as typeof window&{deleteAttempts:number};
   const attrs=(element:Element)=>Object.fromEntries([...element.attributes].filter(attribute=>attribute.name.startsWith('data-foundation-')||['aria-hidden','aria-label','inert','open'].includes(attribute.name)).map(attribute=>[attribute.name,attribute.value]));
   return {storageBytes:raw===null?null:new TextEncoder().encode(raw).length,storedRecords:raw===null?null:JSON.parse(raw),deleteAttempts:scope.deleteAttempts,
    surfaces:[...document.querySelectorAll('.live-surface')].map(attrs),
    dialogs:[...document.querySelectorAll('dialog')].map(dialog=>({attributes:attrs(dialog),text:dialog.textContent,buttons:[...dialog.querySelectorAll('button')].map(button=>({text:button.textContent,disabled:button.disabled,attributes:attrs(button)})),inputs:[...dialog.querySelectorAll('input,select,textarea')].map(input=>({tag:input.tagName,disabled:(input as HTMLInputElement).disabled,attributes:attrs(input)}))})),
    masks:[...document.querySelectorAll('.live-surface [inert],.live-surface [aria-hidden="true"],.live-surface [data-foundation-concealed]')].filter(element=>element.getAttribute('data-foundation-node')).map(attrs)};
  },COMPLETION_STORAGE_KEY);
  const diagnosticPath=info.outputPath('device-delete-final-state.json');await writeFile(diagnosticPath,JSON.stringify({outcome,errors,mutations,activation,...diagnostic},null,2));await info.attach('device-delete-final-state',{path:diagnosticPath,contentType:'application/json'});
 };
 try{await expect(viewer).toBeVisible();}catch(error){await saveDiagnostic('failed');throw error;}
 expect(activation).toMatchObject({before:{connected:true,disabled:false,surfaceStatus:'ready'},nativeDown:{trusted:true},sameFrame:true});
 await expect(viewer.getByText('아직 끝낸 판이 없어요. 한 판 하고 오세요!',{exact:true})).toBeVisible();const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY);expect(saved).toEqual({...records,hands:[]});expect(await page.evaluate(()=>(window as typeof window&{deleteAttempts:number}).deleteAttempts)).toBe(2);expect(mutations).toEqual([]);expect(errors).toEqual([]);await saveDiagnostic('passed');
});
