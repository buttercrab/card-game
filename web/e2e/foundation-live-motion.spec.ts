import {expect,test,type Page} from '@playwright/test';
import {foundationBotButton, joinFoundation } from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`,reducedMotion:'no-preference'});
async function act(page:Page){
    const pass=page.getByRole('button',{name:'패스',exact:true});if(await pass.isEnabled({timeout:100}).catch(()=>false)){await pass.click({timeout:1000});return;}
    const cards=page.locator('.live-surface button[data-foundation-kind="card"][aria-pressed]:enabled');
    if(await cards.count()){await cards.first().click({position:{x:8,y:30},timeout:1000});const submit=page.getByRole('button',{name:/^선택 확정 /});if(await submit.isEnabled({timeout:100}).catch(()=>false))await submit.click({timeout:1000});return;}
    const commands=page.locator(`.live-surface button[data-foundation-kind="command"][data-foundation-node^='["command",']:enabled:not([aria-expanded])`).filter({hasNotText:'딜미스'}).filter({hasNotText:'다음 판'}).filter({hasNotText:'준비'});if(await commands.count())await commands.first().click({timeout:1000});
}
test('real server snapshots drive own play, anonymous opponent reveals and public trick collection',async({page,request},info)=>{
    test.skip(info.project.name!=='1440x900-dark','one full-motion real-server trace');test.setTimeout(120000);await page.setViewportSize({width:1440,height:1100});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
        localStorage.setItem('name',JSON.stringify('모션 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'normal'}));
        const sockets:WebSocket[]=[];const Native=WebSocket;window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);sockets.push(this);}};
        (window as typeof window&{motionSockets:WebSocket[]}).motionSockets=sockets;
        const descriptor=Object.getOwnPropertyDescriptor(Native.prototype,'onmessage')!;
        let hold=false,captured=false;const queued:(()=>void)[]=[];
        const scene=window as typeof window&{trickHeld:boolean;releaseTrick:()=>void};scene.trickHeld=false;scene.releaseTrick=()=>{hold=false;queued.splice(0).forEach(run=>run());};
        Object.defineProperty(window.WebSocket.prototype,'onmessage',{set(handler:(event:MessageEvent)=>void){descriptor.set!.call(this,(event:MessageEvent)=>{
            const message=JSON.parse(event.data);
            if(hold&&message.type==='state'){queued.push(()=>handler.call(this,event));return;}
            if(!captured&&message.type==='state'&&message.view?.phase?.Play?.plays.length>=3){captured=true;hold=true;scene.trickHeld=true;}
            handler.call(this,event);
        });},get(){return descriptor.get!.call(this);}});

        const scope=window as typeof window&{flights:{from:string;to:string;presentation:string;frames:number;inert:boolean;privateFace:boolean}[]};scope.flights=[];
        const animate=Element.prototype.animate;Element.prototype.animate=function(...args){
            const animation=animate.apply(this,args);
            if(this instanceof SVGSVGElement&&this.parentElement?.hasAttribute('data-foundation-flight')){
                scope.flights.push({from:this.dataset.flightFromZone!,to:this.dataset.flightToZone!,presentation:this.dataset.flightPresentation!,frames:(animation.effect as KeyframeEffect).getKeyframes().length,inert:this.parentElement.inert,privateFace:this.dataset.flightPresentation==='back'&&!!this.querySelector('text')});
            }return animation;
        };
    });
    const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);const {id}=await response.json();
    await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);
    for(let i=0;i<4;i++){await foundationBotButton(page).click();if(i<3)await expect(foundationBotButton(page)).toBeEnabled();}
    await page.getByRole('button',{name:'시작',exact:true}).click();

    await expect(async()=>{
        if(!await page.evaluate(()=>(window as typeof window&{trickHeld:boolean}).trickHeld))await act(page);
        expect(await page.evaluate(()=>(window as typeof window&{trickHeld:boolean}).trickHeld)).toBe(true);
    }).toPass({timeout:45000,intervals:[100]});
    const current=page.locator('.live-surface [data-foundation-zone="trick"][data-foundation-kind="card"]');
    await expect.poll(()=>current.count()).toBeGreaterThanOrEqual(3);
    const errorsInTrick=await current.evaluateAll(elements=>elements.flatMap(element=>{
        const node=element as HTMLElement,r=element.getBoundingClientRect(),parent=element.parentElement!,p=parent.getBoundingClientRect();
        const failures:string[]=[];
        if(!node.dataset.foundationOwner||parent.dataset.foundationArrangement!=='ordinary')failures.push('missing-public-provenance');
        if(r.left<p.left-.5||r.right>p.right+.5||r.top<p.top-.5||r.bottom>p.bottom+.5)failures.push('escaped-trick');
        for(const sibling of elements){if(sibling===element)continue;const b=sibling.getBoundingClientRect();if(Math.min(r.right,b.right)-Math.max(r.left,b.left)>.5&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>.5)failures.push('overlap');}
        const source=[...document.querySelectorAll<HTMLElement>('[data-foundation-recipient]')].find(source=>source.dataset.foundationRecipient===node.dataset.foundationOwner);
        if(source){const s=source.getBoundingClientRect(),middle=p.left+p.width/2;if((s.left+s.width/2-middle)*(r.left+r.width/2-middle)<-1)failures.push('wrong-seat-side');}
        return failures;
    }));expect(errorsInTrick).toEqual([]);
    await page.locator('[data-foundation-flight]').evaluateAll(overlays=>overlays.forEach(overlay=>overlay.getAnimations({subtree:true}).forEach(animation=>animation.finish())));
    await expect(current.locator(':scope > svg')).toHaveCount(await current.count());
    for(const art of await current.locator(':scope > svg').all())await expect(art).toHaveCSS('opacity','1');
    await page.screenshot({path:'/tmp/foundation-trick-player-positions.png',fullPage:true});
    await page.evaluate(()=>(window as typeof window&{releaseTrick:()=>void}).releaseTrick());
    await expect(async()=>{
        await act(page);
        const trace=await page.evaluate(()=>(window as typeof window&{flights:{from:string;to:string;presentation:string}[]}).flights);
        expect(trace.some(item=>item.from==='hand'&&(item.to==='trick'||item.to==='captured'))).toBe(true);
        expect(trace.some(item=>item.from==='anonymous-hand'&&item.presentation==='back')).toBe(true);
        expect(trace.filter(item=>item.from==='trick'&&item.to==='captured').length).toBeGreaterThanOrEqual(2);
    }).toPass({timeout:90000,intervals:[100]});
    const trace=await page.evaluate(()=>(window as typeof window&{flights:{frames:number;inert:boolean;privateFace:boolean}[]}).flights);
    expect(trace.length).toBeGreaterThan(3);expect(trace.every(item=>item.frames===2&&item.inert&&!item.privateFace)).toBe(true);
    await page.screenshot({path:'/tmp/foundation-live-motion.png',fullPage:true});expect(errors).toEqual([]);
    await expect(page.locator('.live-surface button[data-foundation-kind="card"][aria-pressed]:enabled').first()).toBeEnabled();
    const count=await page.evaluate(()=>(window as typeof window&{flights:unknown[]}).flights.length);
    await page.evaluate(()=>(window as typeof window&{motionSockets:WebSocket[]}).motionSockets.at(-1)!.close());
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','closed');await expect(page.locator('[data-foundation-flight]')).toHaveCount(0);
    await expect(page.locator('.live-surface [data-foundation-zone="hand"]')).toHaveCount(0);
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await expect(page.locator('.live-surface [data-foundation-zone="hand"]')).not.toHaveCount(0);
    expect(await page.evaluate(()=>(window as typeof window&{flights:unknown[]}).flights.length)).toBe(count);
    // An allocation change must release every active or staggered transfer.
    await page.setViewportSize({width:390,height:844});await expect(page.locator('[data-foundation-flight]')).toHaveCount(0);
});
