import {expect,test,type Page,type APIRequestContext} from '@playwright/test';
import {foundationBotButton, joinFoundation } from './foundationHelpers';
async function room(page:Page,request:APIRequestContext){
 await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('신고 확인'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);const {id}=await response.json();
 await page.goto(`/r/${id}?foundation=1`);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');
 await joinFoundation(page);await expect(foundationBotButton(page)).toBeEnabled();return id as string;
}
async function open(page:Page){
 if(!await page.getByRole('button',{name:'문제 신고',exact:true}).isVisible())await page.getByRole('button',{name:'메뉴',exact:true}).click();
 await page.getByRole('button',{name:'문제 신고',exact:true}).click();await expect(page.getByRole('dialog',{name:'문제 신고',exact:true})).toBeVisible();
 return page.getByRole('textbox',{name:'문제 설명',exact:true});
}
test('connected report preserves native editor and composition through uncached font measurement and resize, then sends once',async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'two native editing profiles');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const submissions:unknown[]=[];
 await page.route('**/api/reports',async route=>{submissions.push(route.request().postDataJSON());await route.fulfill({status:204});});
 const id=await room(page,request),editor=await open(page);await editor.fill('abcdef');await editor.focus();
 // Width alone can reuse cached modal metrics. A newly loaded resource must
 // change the font namespace after the gate and pending observer are armed.
 const pending=await page.locator('.live-surface').evaluate(async host=>{
  const resource=await new FontFace('Foundation pending report','local("Arial")').load();
  return new Promise<Record<string,unknown>>(resolve=>{
  const editor=host.querySelector<HTMLTextAreaElement>('textarea')!,modal=editor.closest('dialog')!;editor.setSelectionRange(2,4);editor.dataset.retainedEditor='yes';
  const original=document.fonts.load.bind(document.fonts);let release!:()=>void;const gate=new Promise<void>(done=>release=done);
  document.fonts.load=(...args:Parameters<FontFaceSet['load']>)=>gate.then(()=>original(...args));
  const observer=new MutationObserver(()=>{
   if((host as HTMLElement).dataset.foundationStatus!=='pending')return;observer.disconnect();
   const selection=[editor.selectionStart,editor.selectionEnd];
   editor.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
   editor.setRangeText('한',editor.selectionStart,editor.selectionEnd,'end');
   editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'한',isComposing:true}));
   editor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한'}));
   editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'한'}));
   const controls=[...host.querySelectorAll<HTMLButtonElement>('button')];
   const result={same:host.querySelector('textarea')===editor,focused:document.activeElement===editor,enabled:!editor.disabled,selection,value:editor.value,modalOpen:modal.open,modalInert:modal.inert,allButtonsDisabled:controls.length>0&&controls.every(control=>control.disabled)};
   document.fonts.load=original;release();resolve(result);
  });observer.observe(host,{attributes:true,attributeFilter:['data-foundation-status']});
  document.fonts.add(resource);document.fonts.dispatchEvent(new FontFaceSetLoadEvent('loadingdone',{fontfaces:[resource]}));
  (host as HTMLElement).style.width=`${Math.max(300,Math.floor(host.getBoundingClientRect().width)-50)}px`;
 });});
 expect(pending).toEqual({same:true,focused:true,enabled:true,selection:[2,4],value:'ab한ef',modalOpen:true,modalInert:false,allButtonsDisabled:true});
 await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');await expect(editor).toHaveAttribute('data-retained-editor','yes');await expect(editor).toHaveValue('ab한ef');await expect(editor).toBeFocused();
 const dialog=page.getByRole('dialog',{name:'문제 신고',exact:true});await dialog.getByRole('button',{name:'보내기',exact:true}).click();await expect(dialog).toContainText('접수했어요.');
 expect(submissions).toHaveLength(1);expect(submissions[0]).toMatchObject({text:'ab한ef',room:id,seat:0});await expect(editor).toBeDisabled();
 const retired=await editor.elementHandle();await page.screenshot({path:`/tmp/foundation-report-${info.project.name}.png`});await dialog.getByRole('button',{name:'닫기',exact:true}).click();await expect(editor).toHaveCount(0);expect(await retired!.evaluate(element=>({value:(element as HTMLTextAreaElement).value,defaultValue:(element as HTMLTextAreaElement).defaultValue}))).toEqual({value:'',defaultValue:''});await retired!.dispose();expect(errors).toEqual([]);
});

test('late report result cannot alter a reopened draft and uncertain delivery never retries',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one report delivery lifetime');
 let release!:()=>void;const gate=new Promise<void>(done=>release=done);let calls=0;
 await page.route('**/api/reports',async route=>{calls++;if(calls===1){await gate;await route.fulfill({status:204});}else await route.abort('failed');});
 await room(page,request);let editor=await open(page);await editor.fill('first request');await page.getByRole('dialog',{name:'문제 신고',exact:true}).getByRole('button',{name:'보내기',exact:true}).click();await expect.poll(()=>calls).toBe(1);
 await page.getByRole('dialog',{name:'문제 신고',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();
 editor=await open(page);await editor.fill('new private draft');release();
 await expect(editor).toHaveValue('new private draft');await expect(page.getByRole('dialog',{name:'문제 신고',exact:true})).not.toContainText('접수했어요.');
 await page.getByRole('dialog',{name:'문제 신고',exact:true}).getByRole('button',{name:'보내기',exact:true}).click();await expect(page.getByRole('dialog',{name:'문제 신고',exact:true})).toContainText('처리 결과를 확인할 수 없어요.');
 expect(calls).toBe(2);await expect(page.getByRole('dialog',{name:'문제 신고',exact:true}).getByRole('button',{name:'보내기',exact:true})).toBeDisabled();await expect(editor).toHaveValue('new private draft');
 await page.reload();await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');expect(calls).toBe(2);editor=await open(page);await expect(editor).toHaveValue('');
});

test('native text undo and multiline Enter survive viewport resize',async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'two native text editing profiles');
 let calls=0;await page.route('**/api/reports',async route=>{calls++;await route.fulfill({status:204});});
 await room(page,request);const editor=await open(page);await editor.focus();await editor.pressSequentially('abc');await expect(editor).toHaveValue('abc');
 const before=page.viewportSize()!;await page.setViewportSize({width:before.width-30,height:before.height-20});await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');await expect(editor).toBeFocused();
 // Native browsers may group sequential keystrokes into different undo units.
 // Every pre-resize insertion must remain undoable; do not assume one unit.
 let previous='abc';
 for(let i=0;i<3&&previous;i++){await editor.press('ControlOrMeta+z');await expect.poll(()=>editor.inputValue()).not.toBe(previous);const value=await editor.inputValue();expect(previous.startsWith(value)).toBe(true);previous=value;}
 await expect(editor).toHaveValue('');
 await editor.pressSequentially('line');await editor.press('Enter');await editor.pressSequentially('two');await expect(editor).toHaveValue('line\ntwo');expect(calls).toBe(0);
});

test('another participant starting a real hand preserves the active native report lease',async({page,request,browser},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one cross-client generation transition');
 const id=await room(page,request);
 const peerContext=await browser.newContext({viewport:{width:1024,height:768}});
 try{
  const peer=await peerContext.newPage();await peer.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('시작 담당'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
  await peer.goto(new URL(`/r/${id}?foundation=1`,page.url()).href);await expect(peer.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await joinFoundation(peer);
  for(let i=0;i<3;i++){await foundationBotButton(peer).click();if(i<2)await expect(foundationBotButton(peer)).toBeEnabled();}
  await page.getByRole('button',{name:'준비하기',exact:true}).click();await peer.getByRole('button',{name:'준비하기',exact:true}).click();
  const editor=await open(page);await editor.fill('draft across a new hand');await editor.focus();await editor.evaluate(element=>{element.dataset.retainedEditor='yes';(element as HTMLTextAreaElement).setSelectionRange(3,7);});
  await peer.getByRole('button',{name:'시작',exact:true}).click();await expect(peer.locator('.live-surface [data-foundation-zone="hand"][data-foundation-kind="card"]')).toHaveCount(10);
  await expect(page.locator('.live-surface [data-foundation-zone="hand"][data-foundation-kind="card"]')).toHaveCount(10);await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
  await expect(editor).toHaveAttribute('data-retained-editor','yes');await expect(editor).toHaveValue('draft across a new hand');expect(await editor.evaluate(element=>[(element as HTMLTextAreaElement).selectionStart,(element as HTMLTextAreaElement).selectionEnd])).toEqual([3,7]);await expect(editor).toBeFocused();
 }finally{await peerContext.close();}
});
