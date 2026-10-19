import {expect,test,type Page,type APIRequestContext} from '@playwright/test';
import {foundationBotButton,joinFoundation} from './foundationHelpers';
interface Probe{sent:any[];held:any[];holdRename:boolean;socket:WebSocket|null;}
async function visit(page:Page,id:string,name='이전 이름'){
 await page.addInitScript(name=>{
  localStorage.setItem('name',JSON.stringify(name));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));
  const scope=window as typeof window&{nameProbe:Probe};scope.nameProbe={sent:[],held:[],holdRename:false,socket:null};const Native=WebSocket;
  window.WebSocket=class extends Native{
   constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);scope.nameProbe.socket=this;this.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.type==='operation_receipt'&&scope.nameProbe.holdRename&&scope.nameProbe.sent.some(value=>value.type==='submit_room'&&value.action?.type==='rename'&&value.operation_id===message.operation_id)){scope.nameProbe.held.push(message);event.stopImmediatePropagation();}});}
   send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string')scope.nameProbe.sent.push(JSON.parse(data));super.send(data);}
  };
 },name);
 await page.goto(`/r/${id}?foundation=1`);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await expect(page.getByRole('button',{name:/함께 있는 사람/}).first()).toBeEnabled();
}
async function create(request:APIRequestContext){const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);return (await response.json()).id as string;}
const submitted=(page:Page,type:string)=>page.evaluate(type=>(window as typeof window&{nameProbe:Probe}).nameProbe.sent.filter(value=>value.type==='submit_room'&&value.action?.type===type).map(value=>({operation:value.operation_id,action:value.action,expected:value.expected})),type);
const preferred=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('name')??'null'));
async function rename(page:Page){await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'이름 바꾸기',exact:true}).click();await expect(page.getByRole('dialog',{name:'이름 바꾸기',exact:true})).toBeVisible();return page.getByRole('textbox',{name:'이름',exact:true});}

test('typed scoped Join adopts exactly the entered name and persists authoritative seat credentials',async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'two named join profiles');const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const id=await create(request);await visit(page,id);
 await page.getByRole('button',{name:/함께 있는 사람/}).first().click();await page.locator('[data-foundation-node=\'["room-seat","0"]\']').getByRole('button',{name:'관리',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'이 자리에 앉기',exact:true}).click();const editor=page.getByRole('textbox',{name:'이름',exact:true});await expect(editor).toHaveValue('이전 이름');await editor.fill('  정한 이름 😀  ');
 expect(await preferred(page)).toBe('이전 이름');expect(await submitted(page,'join')).toHaveLength(0);await page.screenshot({path:`/tmp/foundation-name-join-${info.project.name}.png`});
 await page.getByRole('dialog',{name:'이름을 정하고 앉기',exact:true}).getByRole('button',{name:'앉기',exact:true}).click();await expect(foundationBotButton(page)).toBeEnabled();
 await expect.poll(()=>preferred(page)).toBe('정한 이름 😀');const sent=await submitted(page,'join');expect(sent).toHaveLength(1);expect(sent[0].action).toMatchObject({type:'join',name:'정한 이름 😀',seat:0});expect(sent[0].expected).toMatchObject({domain:'room',room_id:id,seat:null});
 expect(await page.evaluate(id=>JSON.parse(localStorage.getItem(`room:${id}`)??'null')?.name,id)).toBe('정한 이름 😀');await page.reload();await expect(foundationBotButton(page)).toBeEnabled();expect(errors).toEqual([]);
});

test('Rename keeps its editor across unrelated room changes and persists only after its accepted receipt',async({page,request,browser},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one authoritative rename renewal');const id=await create(request);await visit(page,id);await joinFoundation(page);await expect(foundationBotButton(page)).toBeEnabled();const editor=await rename(page);await editor.fill('  새 이름 😀  ');await editor.focus();await editor.evaluate(element=>{element.dataset.retainedName='yes';(element as HTMLInputElement).setSelectionRange(2,5);});
 const frame=await page.locator('.live-surface').getAttribute('data-foundation-frame');const peerContext=await browser.newContext({baseURL:new URL(page.url()).origin});
 try{const peer=await peerContext.newPage();await visit(peer,id,'다른 참가자');await joinFoundation(peer);await expect(foundationBotButton(peer)).toBeEnabled();
  await expect(page.locator('.live-surface')).not.toHaveAttribute('data-foundation-frame',frame!);await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');await expect(editor).toHaveAttribute('data-retained-name','yes');await expect(editor).toHaveValue('  새 이름 😀  ');expect(await editor.evaluate(element=>[(element as HTMLInputElement).selectionStart,(element as HTMLInputElement).selectionEnd])).toEqual([2,5]);
  await page.evaluate(()=>(window as typeof window&{nameProbe:Probe}).nameProbe.holdRename=true);await page.getByRole('dialog',{name:'이름 바꾸기',exact:true}).getByRole('button',{name:'바꾸기',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as typeof window&{nameProbe:Probe}).nameProbe.held.length)).toBe(1);
  expect(await preferred(page)).toBe('이전 이름');const sent=await submitted(page,'rename');expect(sent).toHaveLength(1);expect(sent[0].action).toEqual({type:'rename',name:'새 이름 😀'});
  await page.evaluate(()=>{const probe=(window as typeof window&{nameProbe:Probe}).nameProbe;probe.holdRename=false;probe.socket!.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(probe.held[0])}));});await expect.poll(()=>preferred(page)).toBe('새 이름 😀');await expect(page.locator('.live-surface')).not.toContainText('내용이 바뀌었어요');
  await page.reload();await expect(foundationBotButton(page)).toBeEnabled();const reopened=await rename(page);await expect(reopened).toHaveValue('새 이름 😀');
 }finally{await peerContext.close();}
});

test('an unread accepted Rename recovers across reload without another rename or a persisted name payload',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one payload-free name recovery');
 let renames=0;page.on('websocket',socket=>socket.on('framesent',frame=>{const message=JSON.parse(String(frame.payload));if(message.type==='submit_room'&&message.action?.type==='rename')renames++;}));
 const id=await create(request);await visit(page,id);await joinFoundation(page);const editor=await rename(page);await editor.fill('복구한 이름 😀');await page.evaluate(()=>(window as typeof window&{nameProbe:Probe}).nameProbe.holdRename=true);
 await page.getByRole('dialog',{name:'이름 바꾸기',exact:true}).getByRole('button',{name:'바꾸기',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as typeof window&{nameProbe:Probe}).nameProbe.held.length)).toBeGreaterThan(0);expect(await preferred(page)).toBe('이전 이름');
 const recovery=await page.evaluate(id=>sessionStorage.getItem(`card.commands.v1:${id}`),id);expect(recovery).not.toContain('복구한 이름');expect(JSON.parse(recovery!).map((record:any)=>record.completion)).toContain('adopt-name');
 await page.reload();await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await expect(foundationBotButton(page)).toBeEnabled();await expect.poll(()=>preferred(page)).toBe('복구한 이름 😀');expect(renames).toBe(1);const current=await rename(page);await expect(current).toHaveValue('복구한 이름 😀');
});

test('single-line Enter respects composition, settles final input, and fences a held key across Join',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one native keyboard ordering boundary');
 const id=await create(request);await visit(page,id);const {openFoundationJoin}=await import('./foundationHelpers');await openFoundationJoin(page);const editor=page.getByRole('textbox',{name:'이름',exact:true});await editor.fill('후보 이름');await editor.focus();
 const defaultPrevented=await editor.evaluate(element=>{
  const input=element as HTMLInputElement;input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));const key=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true});input.dispatchEvent(key);
  input.value='완성한 이름';input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'완성한 이름'}));input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'완성한 이름'}));
  input.closest('dialog')!.querySelector<HTMLButtonElement>('button[aria-label="앉기"]')!.click();return key.defaultPrevented;
 });
 expect(defaultPrevented).toBe(false);expect(await submitted(page,'join')).toHaveLength(0);
 await editor.focus();await page.keyboard.down('Enter');await expect(foundationBotButton(page)).toBeEnabled();expect(await submitted(page,'join')).toHaveLength(1);
 const bot=foundationBotButton(page);await bot.focus();await page.keyboard.down('Enter');expect(await submitted(page,'add_bot')).toHaveLength(0);await page.keyboard.up('Enter');await bot.press('Enter');await expect.poll(async()=>(await submitted(page,'add_bot')).length).toBe(1);
});
