import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
const port=Number(process.env.PORT??4317);
test.use({baseURL:`http://127.0.0.1:${port+1}`});
type SettingsProbe={sent:{type?:string}[];sockets:WebSocket[]};
async function ready(page:Page){await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');}
async function setup(page:Page,request:APIRequestContext,unlocked=false){
 await page.addInitScript(({unlocked})=>{
  const state=window as typeof window&{settingsProbe:SettingsProbe};state.settingsProbe={sent:[],sockets:[]};
  const Native=WebSocket;window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);state.settingsProbe.sockets.push(this);}send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string')state.settingsProbe.sent.push(JSON.parse(data));super.send(data);}};
  if(!localStorage.getItem('foundation-settings-seeded')){
   localStorage.setItem('foundation-settings-seeded','true');localStorage.setItem('name',JSON.stringify('설정 확인'));
   localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off',fourColor:true,volume:0.7}));
   localStorage.setItem('mighty.achievements',JSON.stringify(unlocked?{'first-win':1,'declarer-win':1}:{}));
  }
 },{unlocked});
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);
 const {id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await ready(page);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');
 return id as string;
}
const dialog=(page:Page)=>page.getByRole('dialog',{name:'설정',exact:true});
async function open(page:Page){await page.getByRole('button',{name:'설정',exact:true}).click();await expect(dialog(page)).toBeVisible();await ready(page);}
async function preference(page:Page,key:string){return page.evaluate(key=>JSON.parse(localStorage.getItem('mighty.settings')??'{}')[key],key);}
async function sentMutations(page:Page){return page.evaluate(()=>(window as typeof window&{settingsProbe:SettingsProbe}).settingsProbe.sent.filter(message=>message.type==='submit'||message.type==='submit_room'));}
async function setRange(page:Page,value:string){const range=dialog(page).getByRole('slider',{name:'효과음 음량',exact:true});await range.dispatchEvent('pointerdown');await range.evaluate((element,value)=>{(element as HTMLInputElement).value=value;element.dispatchEvent(new Event('change',{bubbles:true}));},value);await ready(page);}

test('local settings own native controls, persistence and stale range fences without room mutations',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one retained phone session');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const id=await setup(page,request);await open(page);
 await expect(dialog(page)).toContainText('이 기기의 화면과 소리에만 적용돼요.');
 expect(await dialog(page).evaluate(element=>element.matches(':modal'))).toBe(true);await expect(page.locator('.sheet')).toHaveCount(0);
 const four=dialog(page).getByRole('switch',{name:'4색 덱',exact:true});await expect(four).toBeChecked();await four.click();await expect(four).not.toBeChecked();await expect(page.locator('html')).toHaveAttribute('data-four-color','false');expect(await preference(page,'fourColor')).toBe(false);
 const audio=dialog(page).getByRole('switch',{name:'효과음',exact:true}),range=dialog(page).getByRole('slider',{name:'효과음 음량',exact:true});
 await expect(range).toBeDisabled();await audio.click();await expect(range).toBeEnabled();await range.focus();await range.press('ArrowRight');await expect(range).toHaveValue('0.8');expect(await preference(page,'volume')).toBe(0.8);
 await range.dispatchEvent('pointerdown');const oldFrame=await page.locator('.live-surface').getAttribute('data-foundation-frame');
 await page.setViewportSize({width:320,height:568});await expect(page.locator('.live-surface')).not.toHaveAttribute('data-foundation-frame',oldFrame!);await ready(page);
 await range.evaluate(element=>{(element as HTMLInputElement).value='0.1';element.dispatchEvent(new Event('change',{bubbles:true}));});await expect(range).toHaveValue('0.8');expect(await preference(page,'volume')).toBe(0.8);
 await setRange(page,'0.4');await expect(range).toHaveValue('0.4');expect(await preference(page,'volume')).toBe(0.4);
 await audio.click();await expect(range).toBeDisabled();await range.evaluate(element=>{(element as HTMLInputElement).value='0.1';element.dispatchEvent(new Event('change',{bubbles:true}));});await expect(range).toHaveValue('0.4');expect(await preference(page,'volume')).toBe(0.4);
 const back=dialog(page).getByRole('combobox',{name:'카드 뒷면',exact:true});await expect(back.locator('option[value="back:02"]')).toBeDisabled();
 await back.evaluate(element=>{(element as HTMLSelectElement).value='back:02';element.dispatchEvent(new Event('change',{bubbles:true}));});await expect(back).toHaveValue('back:01');expect(await preference(page,'cardBack')).toBe('charcoal');
 for(const [width,height] of [[390,844],[320,568]]){
  await page.setViewportSize({width,height});await expect.poll(()=>dialog(page).evaluate(element=>element.getBoundingClientRect().width)).toBe(width-32);await ready(page);const box=await dialog(page).boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);expect(box!.y+box!.height).toBeLessThanOrEqual(height);
  for(const control of await dialog(page).locator('button,select,input').all()){const rect=await control.boundingBox();expect(rect!.width).toBeGreaterThanOrEqual(44);expect(rect!.height).toBeGreaterThanOrEqual(44);}
  await range.scrollIntoViewIfNeeded();await range.focus();await page.keyboard.press('Tab');expect(await dialog(page).evaluate(element=>element.contains(document.activeElement))).toBe(true);
 }
 await page.screenshot({path:'/tmp/foundation-settings-phone.png'});expect(await sentMutations(page)).toEqual([]);
 await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'설정',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'설정',exact:true}).click();await expect(dialog(page)).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:`테이블 ${id}`,exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await page.reload();await ready(page);await open(page);await expect(dialog(page).getByRole('switch',{name:'4색 덱',exact:true})).not.toBeChecked();await expect(dialog(page).getByRole('switch',{name:'효과음',exact:true})).not.toBeChecked();await expect(dialog(page).getByRole('slider',{name:'효과음 음량',exact:true})).toHaveValue('0.4');
 expect(await sentMutations(page)).toEqual([]);expect(errors).toEqual([]);
});

test('earned looks and motion settings change shared paint and survive a reload',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one desktop earned-look session');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,request,true);await open(page);
 const back=dialog(page).getByRole('combobox',{name:'카드 뒷면',exact:true}),tone=dialog(page).getByRole('combobox',{name:'테이블 색',exact:true}),speed=dialog(page).getByRole('combobox',{name:'애니메이션',exact:true});
 await expect(back.locator('option[value="back:02"]')).toBeEnabled();await back.selectOption('back:02');await expect(back).toHaveValue('back:02');await expect(page.locator('html')).toHaveAttribute('data-back','plum');expect(await preference(page,'cardBack')).toBe('plum');
 await tone.selectOption('tone:02');await expect(tone).toHaveValue('tone:02');await expect(page.locator('html')).toHaveAttribute('data-table','celadon');expect(await preference(page,'tableTone')).toBe('celadon');
 await speed.selectOption('motion:02');await expect(speed).toHaveValue('motion:02');expect(await preference(page,'speed')).toBe('fast');await expect(page.locator('html')).toHaveAttribute('data-motion','reduced');
 await page.screenshot({path:'/tmp/foundation-settings-desktop.png'});expect(await sentMutations(page)).toEqual([]);
 await page.reload();await ready(page);await open(page);await expect(back).toHaveValue('back:02');await expect(tone).toHaveValue('tone:02');await expect(speed).toHaveValue('motion:02');await expect(page.locator('html')).toHaveAttribute('data-back','plum');await expect(page.locator('html')).toHaveAttribute('data-table','celadon');expect(await sentMutations(page)).toEqual([]);expect(errors).toEqual([]);
});


test('stored off-step volume remains renderable and disconnected preference edits retain modal focus',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real offline/settings lifecycle');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,request);
 await page.evaluate(()=>{const stored=JSON.parse(localStorage.getItem('mighty.settings')??'{}');localStorage.setItem('mighty.settings',JSON.stringify({...stored,volume:0.35,musicVolume:0.65}));});
 await page.reload();await ready(page);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await open(page);
 await expect(dialog(page).getByRole('slider',{name:'효과음 음량',exact:true})).toHaveValue('0.4');expect(await preference(page,'volume')).toBe(0.4);
 await page.context().setOffline(true);await page.evaluate(()=>(window as typeof window&{settingsProbe:SettingsProbe}).settingsProbe.sockets.forEach(socket=>socket.close()));
 await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','closed');await ready(page);await open(page);
 const four=dialog(page).getByRole('switch',{name:'4색 덱',exact:true});await four.click();await ready(page);
 await expect(dialog(page)).toBeVisible();await expect(four).not.toBeChecked();await expect(four).toBeFocused();expect(await preference(page,'fourColor')).toBe(false);
 await four.click();await ready(page);await expect(four).toBeChecked();await expect(dialog(page)).toBeVisible();await expect(four).toBeFocused();
 await page.screenshot({path:'/tmp/foundation-settings-offline.png'});expect(await sentMutations(page)).toEqual([]);expect(errors).toEqual([]);
 await page.context().setOffline(false);
});

test('pending measurement suppresses native top-layer paint and fences every control before restoring focus',async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one native top-layer suspension lifecycle');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,request);await open(page);
 const four=dialog(page).getByRole('switch',{name:'4색 덱',exact:true});await four.focus();
 const pending=await page.locator('.live-surface').evaluate(host=>new Promise(resolve=>{
  const observer=new MutationObserver(()=>{
   if((host as HTMLElement).dataset.foundationStatus!=='pending')return;
   const content=host.querySelector<HTMLElement>('.foundation-content')!,modal=host.querySelector<HTMLDialogElement>('dialog')!;
   if(content.getAttribute('aria-hidden')!=='true')return;
   const controls=[...host.querySelectorAll<HTMLButtonElement|HTMLSelectElement|HTMLInputElement>('button,select,input')];let entered=false;
   for(const control of controls){control.focus();if(content.contains(document.activeElement))entered=true;control.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
   observer.disconnect();resolve({paint:getComputedStyle(content).opacity,modalPaint:getComputedStyle(modal).opacity,modalInert:modal.inert,aria:content.getAttribute('aria-hidden'),disabled:controls.length>0&&controls.every(control=>control.disabled),entered});
  });
  observer.observe(host,{attributes:true,attributeFilter:['data-foundation-status']});(host as HTMLElement).style.width='343px';
 }));
 expect(pending).toEqual({paint:'0',modalPaint:'0',modalInert:true,aria:'true',disabled:true,entered:false});
 await ready(page);await expect(four).toBeFocused();await expect(four).toBeChecked();expect(await preference(page,'fourColor')).toBe(true);
 expect(await dialog(page).evaluate(element=>({opacity:getComputedStyle(element).opacity,inert:(element as HTMLDialogElement).inert}))).toEqual({opacity:'1',inert:false});
 await four.click();await expect(four).not.toBeChecked();expect(await sentMutations(page)).toEqual([]);expect(errors).toEqual([]);
});
