import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {joinFoundation} from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`});
test('read-only native tabs keep visible selection and modal ownership through uncached font measurement and resize',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light'&&info.project.name!=='1440x900-dark','two native modality/theme paths');test.setTimeout(30000);
 await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('읽기 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}}),{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'내 기록',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'내 기록',exact:true}),host=page.locator('.live-surface');await expect(dialog).toBeVisible();await expect(host).toHaveAttribute('data-foundation-status','ready');
 const overview=dialog.getByRole('tab',{name:'내 기록',exact:true}),recent=dialog.getByRole('tab',{name:'최근 판',exact:true});
 await expect(overview).toHaveAttribute('aria-selected','true');
 const colors=await dialog.evaluate(element=>{const tabs=[...element.querySelectorAll<HTMLElement>('[role="tab"]')];return tabs.map(tab=>({selected:tab.getAttribute('aria-selected')==='true',background:getComputedStyle(tab).backgroundColor,color:getComputedStyle(tab).color}));});
 const selected=colors.find(tab=>tab.selected)!,unselected=colors.find(tab=>!tab.selected)!;expect(selected.background).not.toBe('rgba(0, 0, 0, 0)');expect(selected.background).not.toBe(unselected.background);expect(selected.color).not.toBe(unselected.color);
 await page.screenshot({path:`/tmp/foundation-disclosure-tabs-${info.project.name}.png`,fullPage:true});
 await overview.focus();
 // A new loaded face changes the real metric namespace even when both desktop
 // widths use identical cached modal measurements. Notification alone does not.
 // FontFace.load bypasses the FontFaceSet.load gate installed below.
 await dialog.evaluate(async element=>{const resource=await new FontFace('Foundation pending modal 1','local("Arial")').load();const scope=window as typeof window&{nativeReadDialog:Element;releaseReadFonts:()=>void};scope.nativeReadDialog=element;const load=document.fonts.load.bind(document.fonts);const waiting:(()=>void)[]=[];document.fonts.load=((...args:Parameters<FontFaceSet['load']>)=>new Promise<FontFace[]>(resolve=>waiting.push(()=>{void load(...args).then(resolve);}))) as FontFaceSet['load'];scope.releaseReadFonts=()=>{document.fonts.load=load;waiting.splice(0).forEach(release=>release());};document.fonts.add(resource);document.fonts.dispatchEvent(new FontFaceSetLoadEvent('loadingdone',{fontfaces:[resource]}));});
 await page.setViewportSize(info.project.name==='390x844-light'?{width:768,height:1024}:{width:1000,height:800});
 await expect(host).toHaveAttribute('data-foundation-status','pending');expect(await dialog.evaluate(element=>element===(window as typeof window&{nativeReadDialog:Element}).nativeReadDialog&&element.matches(':modal'))).toBe(true);
 expect(await dialog.locator('button').evaluateAll(elements=>elements.every(element=>(element as HTMLButtonElement).disabled))).toBe(true);
 const viewport=dialog.getByRole('group',{name:'기록 내용',exact:true});await expect(viewport).toBeFocused();
 await page.keyboard.press('Tab');const focusAfter=await dialog.evaluate(element=>({inside:element===document.activeElement||element.contains(document.activeElement),documentHasFocus:document.hasFocus(),modal:element.matches(':modal')}));
 // Chromium may move Tab into browser chrome (BODY + !hasFocus), just as a
 // standalone native dialog does. It must never focus document underlay.
 expect(focusAfter.inside||!focusAfter.documentHasFocus,JSON.stringify(focusAfter)).toBe(true);expect(focusAfter.modal).toBe(true);
 expect(await page.evaluate(()=>{const probe=document.createElement('button');probe.textContent='Background focus probe';document.body.append(probe);probe.focus();const blocked=document.activeElement!==probe;probe.remove();return blocked;})).toBe(true);
 if(!focusAfter.inside){await page.keyboard.press('Shift+Tab');await expect(viewport).toBeFocused();}
 await page.evaluate(()=>(window as typeof window&{releaseReadFonts:()=>void}).releaseReadFonts());await expect(host).toHaveAttribute('data-foundation-status','ready');
 // A held Space must never select its old tab after disable/re-enable. Track
 // actual selection transitions: environment reconciliation may publish frames
 // without activating anything, so a frame counter is diagnostic metadata only.
 await dialog.evaluate(element=>{
  const tabs=[...element.querySelectorAll<HTMLButtonElement>('[role="tab"]')],overview=tabs[0],recent=tabs[1],host=element.closest('.live-surface')!;
  const transitions:{tab:string;oldValue:string|null;currentValue:string|null}[]=[],beforeFrame=host.getAttribute('data-foundation-frame');
  const observer=new MutationObserver(records=>{for(const record of records)if(record.target===overview||record.target===recent)transitions.push({tab:record.target===overview?'overview':'recent',oldValue:record.oldValue,currentValue:(record.target as Element).getAttribute('aria-selected')});});
  observer.observe(element,{subtree:true,attributes:true,attributeFilter:['aria-selected'],attributeOldValue:true});
  (window as typeof window&{finishReadTabTrace:()=>unknown}).finishReadTabTrace=()=>{observer.disconnect();return{beforeFrame,afterFrame:host.getAttribute('data-foundation-frame'),sameTabs:element.querySelectorAll('[role="tab"]')[0]===overview&&element.querySelectorAll('[role="tab"]')[1]===recent,transitions};};
 });
 await recent.focus();await page.keyboard.down(' ');
 await page.evaluate(async()=>{const resource=await new FontFace('Foundation pending modal 2','local("Arial")').load();const scope=window as typeof window&{releaseReadFonts:()=>void};const load=document.fonts.load.bind(document.fonts),waiting:(()=>void)[]=[];document.fonts.load=((...args:Parameters<FontFaceSet['load']>)=>new Promise<FontFace[]>(resolve=>waiting.push(()=>{void load(...args).then(resolve);}))) as FontFaceSet['load'];scope.releaseReadFonts=()=>{document.fonts.load=load;waiting.splice(0).forEach(release=>release());};document.fonts.add(resource);document.fonts.dispatchEvent(new FontFaceSetLoadEvent('loadingdone',{fontfaces:[resource]}));});
 await page.setViewportSize(info.project.name==='390x844-light'?{width:640,height:960}:{width:900,height:800});await expect(host).toHaveAttribute('data-foundation-status','pending');
 await page.evaluate(()=>(window as typeof window&{releaseReadFonts:()=>void}).releaseReadFonts());await expect(host).toHaveAttribute('data-foundation-status','ready');await page.keyboard.up(' ');await expect(host).toHaveAttribute('data-foundation-status','ready');
 await expect(overview).toBeVisible();await expect(overview).toBeEnabled();await expect(recent).toBeVisible();await expect(recent).toBeEnabled();
 await expect(overview).toHaveAttribute('aria-selected','true');await expect(recent).toHaveAttribute('aria-selected','false');expect(await dialog.evaluate(element=>element===(window as typeof window&{nativeReadDialog:Element}).nativeReadDialog&&element.matches(':modal'))).toBe(true);
 const trace=await page.evaluate(()=>(window as typeof window&{finishReadTabTrace:()=>{beforeFrame:string|null;afterFrame:string|null;sameTabs:boolean;transitions:{tab:string;oldValue:string|null;currentValue:string|null}[]}}).finishReadTabTrace());
 const tracePath=info.outputPath('held-space-tab-selection.json');await writeFile(tracePath,JSON.stringify(trace,null,2));await info.attach('held-space-tab-selection',{path:tracePath,contentType:'application/json'});
 expect(trace.sameTabs,JSON.stringify(trace)).toBe(true);expect(trace.transitions.filter(change=>change.tab==='recent'?(change.oldValue==='true'||change.currentValue==='true'):(change.oldValue==='false'||change.currentValue==='false')),JSON.stringify(trace)).toEqual([]);
 await overview.focus();await page.keyboard.press('ArrowRight');await expect(recent).toHaveAttribute('aria-selected','true');await expect(recent).toBeFocused();await expect(dialog.getByRole('tabpanel',{name:'최근 판',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
});
