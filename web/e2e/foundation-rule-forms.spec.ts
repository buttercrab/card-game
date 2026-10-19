import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import {joinFoundation} from './foundationHelpers';
interface Probe { sent:any[]; sockets:WebSocket[]; }
const ready=(page:Page)=>expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
async function installProbe(page:Page){
 await page.addInitScript(()=>{
  localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));
  localStorage.setItem('name',JSON.stringify('규칙 확인'));
  const state=window as typeof window&{ruleProbe:Probe};state.ruleProbe={sent:[],sockets:[]};const Native=WebSocket;
  window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);state.ruleProbe.sockets.push(this);}send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string')state.ruleProbe.sent.push(JSON.parse(data));super.send(data);}};
 });
}
async function setup(page:Page,request:APIRequestContext){
 await installProbe(page);
 // These tests create many real rooms quickly; only explicit rate-limit refusal
 // is retryable fixture allocation. Never retry an uncertain or successful POST.
 let response:Awaited<ReturnType<APIRequestContext['post']>>;
 await expect.poll(async()=>{response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});return response.status();},{timeout:8000,intervals:[1000]}).not.toBe(429);
 expect(response!.ok(),`room creation: ${response!.status()} ${await response!.text()}`).toBe(true);
 const {id}=await response!.json();await page.goto(`/r/${id}?foundation=1`);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await ready(page);await joinFoundation(page);return id as string;
}
async function open(page:Page,label:string){
 const settings=page.getByRole('dialog',{name:'설정',exact:true});if(!await settings.isVisible())await page.getByRole('button',{name:'설정',exact:true}).click();await settings.getByRole('button',{name:label,exact:true}).click();
 const modal=page.getByRole('dialog',{name:label,exact:true});await expect(modal).toBeVisible();await ready(page);return modal;
}
const sent=(page:Page,type:string)=>page.evaluate(type=>(window as typeof window&{ruleProbe:Probe}).ruleProbe.sent.filter(message=>message.type==='submit_room'&&message.action?.type===type),type);
const ruleDialog=(page:Page)=>page.getByRole('dialog',{name:'마이티 규칙 바꾸기',exact:true});
const sectionButton=(page:Page,label:string)=>ruleDialog(page).locator('button[data-foundation-node^=\'["form-section",\']').and(ruleDialog(page).getByRole('button',{name:label,exact:true}));
async function section(page:Page,label:string){await sectionButton(page,label).click();await ready(page);}


test('complete connected rules retain raw drafts, save locally, and apply one scoped authoritative command',async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'phone and desktop full rules');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const id=await setup(page,request),modal=await open(page,'마이티 규칙 바꾸기');
 await expect(modal.locator('[data-foundation-node^=\'["form-summary",\']')).toHaveCount(0);
 for(const label of ['시작 규칙','덱과 딜미스','공약','키티와 프렌드','카드의 힘','점수','이 기기에 저장'])await expect(sectionButton(page,label)).toBeVisible();
 await section(page,'덱과 딜미스');const threshold=modal.getByRole('textbox',{name:'딜미스 기준',exact:true});const initial=await threshold.inputValue();await threshold.fill('-');await expect(threshold).toHaveValue('-');await expect(threshold).toHaveAttribute('aria-invalid','true');await expect(modal.getByRole('button',{name:'테이블에 적용',exact:true})).toBeDisabled();
 // A section change retires the native sublease while retaining the runtime draft.
 const oldEditor=await threshold.elementHandle();const oldLease=await threshold.getAttribute('data-foundation-field-lease');
 await section(page,'공약');expect(await oldEditor!.evaluate(element=>({connected:element.isConnected,value:(element as HTMLInputElement).value,initial:(element as HTMLInputElement).defaultValue}))).toEqual({connected:false,value:'',initial:''});
 await oldEditor!.evaluate(element=>{(element as HTMLInputElement).value='127';element.dispatchEvent(new InputEvent('input',{bubbles:true,data:'127'}));});
 await section(page,'덱과 딜미스');await expect(threshold).not.toHaveAttribute('data-foundation-field-lease',oldLease!);await expect(threshold).toHaveValue('-');await threshold.fill(initial);await expect(threshold).toHaveAttribute('aria-invalid','false');
 await section(page,'이 기기에 저장');const name=modal.getByRole('textbox',{name:'이 기기에 저장할 이름',exact:true});await name.fill('검증한 모임 규칙');await modal.locator('button[data-foundation-node^=\'["form-action",\']').and(modal.getByRole('button',{name:'이 기기에 저장',exact:true})).click();await expect(modal).toContainText('이 기기에 저장했어요.');
 expect(await sent(page,'set_settings')).toHaveLength(0);await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mighty.rules.custom')??'[]')[0]?.name)).toBe('검증한 모임 규칙');
 const savedId=await page.evaluate(()=>JSON.parse(localStorage.getItem('mighty.rules.custom')!)[0].id);
 await modal.getByRole('button',{name:'다시 쓰기',exact:true}).click();await ready(page);await section(page,'이 기기에 저장');await name.fill('이름 바꾼 모임 규칙');
 await section(page,'공약');const minimum=modal.getByRole('textbox',{name:'최소 공약',exact:true});await expect(minimum).toBeVisible();const before=Number(await minimum.inputValue());await minimum.fill(String(before+1));
 await modal.locator('button[data-foundation-node^=\'["form-action",\']').and(modal.getByRole('button',{name:'이 기기에 저장',exact:true})).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mighty.rules.custom')??'[]')[0]?.rules.bidding.min)).toBe(before+1);expect(await page.evaluate(()=>{const sets=JSON.parse(localStorage.getItem('mighty.rules.custom')!);return {count:sets.length,id:sets[0].id,name:sets[0].name};})).toEqual({count:1,id:savedId,name:'이름 바꾼 모임 규칙'});expect(await sent(page,'set_settings')).toHaveLength(0);
 await expect(modal.getByRole('button',{name:'테이블에 적용',exact:true})).toBeEnabled();await modal.getByRole('button',{name:'테이블에 적용',exact:true}).click();
 await expect.poll(async()=>(await sent(page,'set_settings')).length).toBe(1);const [command]=await sent(page,'set_settings');expect(command.expected).toMatchObject({domain:'room',room_id:id,seat:0});expect(command.action.settings.rules.bidding.min).toBe(before+1);expect(JSON.stringify(command)).not.toContain('검증한 모임 규칙');await expect(modal).toContainText('테이블에 적용 · 적용했어요.');await expect(modal).not.toContainText('내용이 바뀌었어요');await ready(page);
 await modal.getByRole('button',{name:'닫기',exact:true}).click();await expect(modal).toHaveCount(0);
 await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'마이티 규칙 바꾸기',exact:true}).click();await expect(modal).toBeVisible();await section(page,'공약');await expect(minimum).toHaveValue(String(before+1));
 await page.screenshot({path:`/tmp/foundation-rule-forms-${info.project.name}.png`});expect(errors).toEqual([]);
});

test('table controls use the same native form and send exactly one complete scoped table edit',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one authoritative table form');
 const id=await setup(page,request),modal=await open(page,'테이블 설정');const turn=modal.getByRole('combobox',{name:'턴 시간',exact:true});expect(await turn.locator('option').count()).toBe(4);
 const choices=await turn.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value));const choice=choices.find(value=>value!=='turn:0')!;await turn.selectOption(choice);const shuffle=modal.getByRole('switch',{name:'매 판 자리 섞기',exact:true});await shuffle.click();await modal.getByRole('button',{name:'적용하기',exact:true}).click();
 await expect.poll(async()=>(await sent(page,'set_table')).length).toBe(1);const [command]=await sent(page,'set_table');expect(command.expected).toMatchObject({domain:'room',room_id:id,seat:0});expect(command.action).toEqual({type:'set_table',turn_secs:Number(choice.slice(5)),shuffle:true,shuffle_next:null});await ready(page);
});

test('rule sections keep controls aligned at narrow, tablet, desktop and enlarged CSS controls',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one resizing native editor');test.setTimeout(60_000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,request);const modal=await open(page,'마이티 규칙 바꾸기');
 // Root CSS enlargement exercises shared control styles; full engine textScale=2
 // is separately covered by planner tests, not claimed by this browser case.
 for(const [width,height,scale] of [[320,568,1],[768,1024,1],[1440,900,1],[320,568,2]]){
  await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale*100}%`,scale);await page.setViewportSize({width,height});await ready(page);
  for(const label of ['시작 규칙','덱과 딜미스','공약','키티와 프렌드','카드의 힘','점수','이 기기에 저장']){
   await section(page,label);
   const geometry=await modal.evaluate(element=>{
    const bounds=element.getBoundingClientRect(),controls=[...element.querySelectorAll<HTMLElement>('button,input,select,textarea')].map(control=>({label:control.getAttribute('aria-label'),box:control.getBoundingClientRect()}));
    const outside=controls.filter(({box})=>box.x<bounds.x-1||box.right>bounds.right+1||box.width<43||box.height<43).map(({label})=>label);
    const overlaps:string[]=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left)>1&&Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.top,b.box.top)>1)overlaps.push(`${a.label}/${b.label}`);}
    return {outside,overlaps,x:bounds.x,y:bounds.y,right:bounds.right,bottom:bounds.bottom};
   });
   expect(geometry.outside,`${width}px ${scale}x ${label}`).toEqual([]);expect(geometry.overlaps,`${width}px ${scale}x ${label}`).toEqual([]);expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.y).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(width);expect(geometry.bottom).toBeLessThanOrEqual(height);
  }
  await page.screenshot({path:`/tmp/foundation-rule-sections-${width}-${scale}x.png`});
 }
 expect(await sent(page,'set_settings')).toEqual([]);expect(errors).toEqual([]);
});

test('an error summary navigates to the final card override and focuses its current native sublease',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one complete54-row navigation proof');
 await setup(page,request);const modal=await open(page,'마이티 규칙 바꾸기');await section(page,'덱과 딜미스');
 const enabled=modal.locator('button[role=switch][data-foundation-field=c53e]');await enabled.click();const input=modal.locator('input[data-foundation-field=c53v]');await input.fill('-');await expect(input).toHaveAttribute('aria-invalid','true');
 await section(page,'공약');const summary=modal.locator('button[data-foundation-node^=\'["form-summary",\']').filter({hasText:/홍조커.*정수를 입력/}).first();await summary.click();await ready(page);
 await expect(input).toHaveValue('-');await expect(input).toBeFocused();const box=await input.boundingBox(),bounds=await modal.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(bounds!.y);expect(box!.y+box!.height).toBeLessThanOrEqual(bounds!.y+bounds!.height);
 expect(await sent(page,'set_settings')).toEqual([]);
});

test('denied device storage reports failure and preserves the draft without a room mutation',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real native local-save failure');
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key:string,value:string){if(key==='mighty.rules.custom')throw new DOMException('quota','QuotaExceededError');return original.call(this,key,value);};});
 await setup(page,request);const modal=await open(page,'마이티 규칙 바꾸기');await section(page,'이 기기에 저장');const name=modal.getByRole('textbox',{name:'이 기기에 저장할 이름',exact:true});await name.fill('남겨 둔 입력');
 await modal.locator('button[data-foundation-node^=\'["form-action",\']').and(modal.getByRole('button',{name:'이 기기에 저장',exact:true})).click();await expect(modal).toContainText('이 기기에 저장하지 못했어요.');await expect(name).toHaveValue('남겨 둔 입력');
 expect(await page.evaluate(()=>localStorage.getItem('mighty.rules.custom'))).toBeNull();expect(await sent(page,'set_settings')).toEqual([]);await expect(modal.getByRole('button',{name:'테이블에 적용',exact:true})).toBeEnabled();
});

test('foreign shared settings keep Apply revoked while explicit local Save remains independent',async({page,request,browser},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one two-actor conflict lifecycle');
 const id=await setup(page,request),modal=await open(page,'마이티 규칙 바꾸기');await section(page,'공약');const minimum=modal.getByRole('textbox',{name:'최소 공약',exact:true});const before=Number(await minimum.inputValue());await minimum.fill(String(before+1));
 const context=await browser.newContext({baseURL:new URL(page.url()).origin});
 try{
  const peer=await context.newPage();await installProbe(peer);await peer.goto(`/r/${id}?foundation=1`);await expect(peer.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await joinFoundation(peer);const other=await open(peer,'마이티 규칙 바꾸기');await section(peer,'공약');await other.getByRole('textbox',{name:'최소 공약',exact:true}).fill(String(before+2));await other.getByRole('button',{name:'테이블에 적용',exact:true}).click();await expect(other).toContainText('테이블에 적용 · 적용했어요.');await expect(other).not.toContainText('내용이 바뀌었어요');
  await expect(modal).toContainText('내용이 바뀌었어요');const apply=modal.getByRole('button',{name:'테이블에 적용',exact:true});await expect(apply).toBeDisabled();await section(page,'이 기기에 저장');const name=modal.getByRole('textbox',{name:'이 기기에 저장할 이름',exact:true});await name.fill('충돌 중 저장');await name.press('Enter');expect(await page.evaluate(()=>localStorage.getItem('mighty.rules.custom'))).toBeNull();expect(await sent(page,'set_settings')).toEqual([]);
  const save=modal.locator('button[data-foundation-node^=\'["form-action",\']').and(modal.getByRole('button',{name:'이 기기에 저장',exact:true}));await expect(save).toBeEnabled();await save.click();await expect(modal).toContainText('이 기기에 저장했어요.');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mighty.rules.custom')!)[0].rules.bidding.min)).toBe(before+1);await expect(apply).toBeDisabled();await expect(modal).toContainText('내용이 바뀌었어요');expect(await sent(page,'set_settings')).toEqual([]);
 }finally{await context.close();}
});

test('same-actor reconnect opens a fresh saved catalog after the old native editor is revoked',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one stored-catalog reconnect lifecycle');
 await setup(page,request);const modal=await open(page,'마이티 규칙 바꾸기');await section(page,'이 기기에 저장');await modal.getByRole('textbox',{name:'이 기기에 저장할 이름',exact:true}).fill('재접속 규칙');
 const save=()=>modal.locator('button[data-foundation-node^=\'["form-action",\']').and(modal.getByRole('button',{name:'이 기기에 저장',exact:true}));await save().click();await expect(modal).toContainText('이 기기에 저장했어요.');
 await page.context().setOffline(true);await page.evaluate(()=>(window as typeof window&{ruleProbe:Probe}).ruleProbe.sockets.forEach(socket=>socket.close()));await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','closed');await expect(modal).toHaveCount(0);
 await page.context().setOffline(false);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await ready(page);await open(page,'마이티 규칙 바꾸기');await expect(modal.locator('select[data-foundation-field=start] option')).toHaveCount(10);
 await section(page,'이 기기에 저장');await modal.getByRole('textbox',{name:'이 기기에 저장할 이름',exact:true}).fill('재접속 규칙');await save().click();await expect(modal).toContainText('이 기기에 저장했어요.');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mighty.rules.custom')!))).toHaveLength(1);expect(await sent(page,'set_settings')).toEqual([]);
});
