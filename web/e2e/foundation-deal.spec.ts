import {writeFile} from 'node:fs/promises';
import {expect,test,type Page} from '@playwright/test';
import {presetRules} from '../src/lib/games/mighty/catalog';
import {foundationBotButton, joinFoundation } from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`,reducedMotion:'no-preference'});
const hand=(page:Page)=>page.locator('.live-surface [data-foundation-zone="hand"][data-foundation-kind="card"]');
const portal=(page:Page)=>page.locator('[data-foundation-flight]');
const release=(page:Page)=>page.evaluate(()=>(window as typeof window&{releaseStates:()=>void}).releaseStates());
async function finish(page:Page){await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.finish()));await expect(portal(page)).toHaveCount(0);}

test('observed initial deal and declarer kitty pickup conserve counts, keep backs and never replay on reload',async({page,request,browser},info)=>{
    test.skip(info.project.name!=='1440x900-dark','one real distribution with a delayed first state');test.setTimeout(60000);await page.setViewportSize({width:1440,height:1200});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let scopedStarts=0,legacyStarts=0;page.on('websocket',socket=>socket.on('framesent',frame=>{const message=JSON.parse(String(frame.payload));if(message.type==='submit_room'&&message.action?.type==='start')scopedStarts++;if(message.type==='start')legacyStarts++;}));
    await page.addInitScript(()=>{
        localStorage.setItem('name',JSON.stringify('배분 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'normal'}));
        let hold=true;const queued:(()=>void)[]=[];const Native=WebSocket,descriptor=Object.getOwnPropertyDescriptor(Native.prototype,'onmessage')!;
        class Delayed extends Native{}
        Object.defineProperty(Delayed.prototype,'onmessage',{set(handler:(event:MessageEvent)=>void){descriptor.set!.call(this,(event:MessageEvent)=>{if(hold&&JSON.parse(event.data).type==='state')queued.push(()=>handler.call(this,event));else handler.call(this,event);});},get(){return descriptor.get!.call(this);}});
        window.WebSocket=Delayed;(window as typeof window&{releaseStates:()=>void}).releaseStates=()=>{hold=false;queued.splice(0).forEach(run=>run());};
        const animate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight')){animation.pause();animation.currentTime=0;}return animation;};
    });
    const rules=presetRules('default');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;
    const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});const {id}=await response.json();await page.goto(`/r/${id}?foundation=1`);
    await joinFoundation(page);for(let i=0;i<4;i++){await foundationBotButton(page).click();if(i<3)await expect(foundationBotButton(page)).toBeEnabled();}
    await page.evaluate(()=>{const states:string[]=[];(window as typeof window&{dealStatuses:string[]}).dealStatuses=states;const host=document.querySelector('.live-surface')!;new MutationObserver(()=>states.push((host as HTMLElement).dataset.foundationFlightStatus??'')).observe(host,{attributes:true,attributeFilter:['data-foundation-flight-status']});});
    const start=page.getByRole('button',{name:'시작',exact:true});await start.click();await expect(start).toBeDisabled();await expect(hand(page)).toHaveCount(0);
    await start.evaluate(element=>element.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(scopedStarts).toBe(1);expect(legacyStarts).toBe(0);
    await release(page);await expect(hand(page)).toHaveCount(10);await expect(portal(page).locator(':scope > svg'),JSON.stringify(await page.evaluate(()=>(window as typeof window&{dealStatuses:string[]}).dealStatuses))).toHaveCount(50);
    await expect(portal(page).locator('svg[data-card-back]')).toHaveCount(50);await expect(portal(page).locator('text')).toHaveCount(0);
    const timing=await portal(page).evaluate(element=>element.getAnimations({subtree:true}).map(animation=>({delay:animation.effect!.getTiming().delay,duration:animation.effect!.getTiming().duration})));
    expect(timing).toEqual(Array.from({length:50},(_,index)=>({delay:index*20,duration:360})));
    await portal(page).locator(':scope > svg').nth(1).evaluate(element=>element.getAnimations()[0].finish());
    const peers=page.locator('.live-surface [data-foundation-recipient]:not([data-foundation-recipient=""]) > svg');await expect(peers).toHaveCount(4);for(const peer of await peers.all())await expect(peer).toHaveCSS('opacity','0');
    await finish(page);for(const peer of await peers.all())await expect(peer).toHaveCSS('opacity','1');
    await page.reload();await release(page);await expect(hand(page)).toHaveCount(10);await expect(portal(page)).toHaveCount(0);
    const trump=page.getByRole('combobox',{name:'기루다',exact:true});if(await trump.count()){await expect(trump).toBeEnabled();await trump.selectOption('no-trump');}else{const nt=page.getByRole('radio',{name:'노기루다',exact:true});await expect(nt).toBeEnabled();await nt.click();}
    const count=page.getByRole('combobox',{name:'공약 수',exact:true});if(await count.count())await count.selectOption('20');else await page.getByRole('radio',{name:'20',exact:true}).click();await page.getByRole('button',{name:'공약 노기루다 20',exact:true}).click();
    await expect(hand(page)).toHaveCount(13);await expect(portal(page).locator(':scope > svg'),await page.locator('.live-surface').getAttribute('data-foundation-flight-status')??'unknown').toHaveCount(3);await expect(portal(page).locator('text')).toHaveCount(0);
    await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=180+Number(animation.effect!.getTiming().delay);}));
    await page.screenshot({path:'/tmp/foundation-kitty-motion.png',fullPage:true});await finish(page);
    await page.reload();await release(page);await expect(hand(page)).toHaveCount(13);await expect(portal(page)).toHaveCount(0);
    const observerContext=await browser.newContext({viewport:{width:1440,height:1200},reducedMotion:'no-preference'});
    await observerContext.addInitScript(()=>{
        localStorage.setItem('name',JSON.stringify('관전 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'normal'}));
        const animate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight')){animation.pause();animation.currentTime=0;}return animation;};
    });
    const observer=await observerContext.newPage();await observer.goto(`http://127.0.0.1:${port+1}/r/${id}?foundation=1`);const emptyStock=observer.locator('.live-surface [data-foundation-zone="stock"][data-foundation-kind="group"]');await expect(emptyStock).toHaveCount(1);await expect(emptyStock.locator('svg')).toHaveCount(0);await expect(observer.getByText('키티 · 0장',{exact:true})).toBeVisible();await expect(hand(observer)).toHaveCount(0);await observer.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
    for(const count of [12,11,10]){
        await hand(page).nth(Math.floor((count+1)/2)).click({position:{x:8,y:30}});await page.getByRole('button',{name:/^선택 확정 .* 버리기$/}).click();await expect(hand(page)).toHaveCount(count);
        const evidence=await page.locator('.live-surface').evaluate(host=>{const data=(host as HTMLElement).dataset;return{frame:data.foundationFrame,status:data.foundationFlightStatus,geometry:data.foundationFlightGeometry,clear:data.foundationFlightClear,invalidation:data.foundationFlightInvalidation};});await writeFile(info.outputPath(`stock-return-${count}.json`),JSON.stringify(evidence,null,2));
        await expect(portal(page).locator('svg[data-flight-to-zone="stock"]'),JSON.stringify(evidence)).toHaveCount(1);
        await expect(portal(page).locator('svg[data-flight-presentation="face"]')).toHaveCount(1);
        const retained=await hand(page).evaluateAll(cards=>cards.map(card=>{const art=card.firstElementChild;let painted=art instanceof SVGSVGElement;for(let element:Element|null=art;element;element=element.parentElement){const css=getComputedStyle(element);if(css.display==='none'||css.visibility!=='visible'||Number(css.opacity)===0)painted=false;}return{painted,button:card instanceof HTMLButtonElement,disabled:card instanceof HTMLButtonElement&&card.disabled};}));expect(retained).toHaveLength(count);expect(retained.every(card=>card.painted),'retained hand stays painted during the held stock return').toBe(true);if(count>10){expect(retained.every(card=>card.button&&card.disabled),'remaining discard inputs stay disabled until return settlement').toBe(true);}

        await expect(portal(observer).locator('svg[data-flight-to-zone="stock"]'),await observer.locator('.live-surface').getAttribute('data-foundation-flight-status')??'unknown').toHaveCount(1);
        await expect(portal(observer).locator('svg[data-card-back]')).toHaveCount(1);await expect(portal(observer).locator('text')).toHaveCount(0);await finish(observer);
        if(count===12){await page.setViewportSize({width:1420,height:1200});await expect(portal(page)).toHaveCount(0);await expect(page.locator('.live-surface [data-foundation-zone="stock"] > svg')).toHaveCSS('opacity','1');}
        else {if(count===11){await portal(page).evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=180;}));await page.screenshot({path:'/tmp/foundation-discard-return.png',fullPage:true});}await finish(page);}
    }
    await observerContext.close();
    await page.reload();await release(page);await expect(hand(page)).toHaveCount(10);await expect(portal(page)).toHaveCount(0);expect(errors).toEqual([]);
});
