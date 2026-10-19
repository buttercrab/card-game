import {expect,test} from '@playwright/test';

test('shared artwork keeps native geometry and retained identity through selection and resize',async({page},info)=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/preview?foundation=1&fixture=play');
    const surface=page.locator('.foundation-surface');await expect(surface).toHaveAttribute('data-foundation-status','ready');
    const card=page.locator('button[data-foundation-kind="card"]').first();
    const artwork=await card.locator(':scope > svg[data-foundation-art="shared"]').elementHandle();
    for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
        await page.setViewportSize({width,height});
        await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(element=>element.getBoundingClientRect().width)).toBe(width-24);
        const geometry=await card.evaluate(element=>{
            const outer=element.getBoundingClientRect(),art=element.firstElementChild!.getBoundingClientRect();
            return {dx:art.x-outer.x,dy:art.y-outer.y,dw:art.width-outer.width,dh:art.height-outer.height,font:getComputedStyle(element.querySelector('text')!).fontFamily,weight:getComputedStyle(element.querySelector('text')!).fontWeight};
        });
        expect(geometry).toMatchObject({dx:0,dy:0,dw:0,dh:0,weight:'800'});expect(geometry.font).toContain('Wanted Sans');
        expect(await artwork!.evaluate(element=>element.isConnected)).toBe(true);
    }
    await card.scrollIntoViewIfNeeded();await card.click({position:{x:12,y:30}});await expect(card).toHaveAttribute('aria-pressed','true');
    expect(await artwork!.evaluate(element=>element.isConnected)).toBe(true);
    await page.screenshot({path:`/tmp/foundation-artwork-${info.project.name}.png`,fullPage:true});
    await page.getByRole('button',{name:'권한 해제',exact:true}).click();
    await expect(surface.locator('[data-foundation-art]')).toHaveCount(0);expect(errors).toEqual([]);
});

test('indigo flight copies own their SVG definitions after stock source removal',async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({cardBack:'indigo'})));
    await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1100});
    await page.goto('/preview?foundation=1&fixture=hidden');
    await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
    await page.getByRole('button',{name:'묶음 나누기',exact:true}).click();
    const portal=page.locator('[data-foundation-flight]');await expect(portal).toHaveCount(1);
    await portal.evaluate(element=>element.getAnimations({subtree:true}).forEach(animation=>animation.pause()));
    const proof=await portal.evaluate(element=>{
        const allIds=Array.from(document.querySelectorAll('[id]')).map(node=>node.id);
        return Array.from(element.children).map(art=>({
            defs:art.querySelectorAll('clipPath').length,
            refs:Array.from(art.querySelectorAll('[clip-path]')).every(node=>{
                const id=node.getAttribute('clip-path')!.slice(5,-1);
                return Array.from(art.querySelectorAll('[id]')).some(def=>def.id===id)&&allIds.filter(value=>value===id).length===1;
            }),
        }));
    });
    expect(proof).toHaveLength(3);for(const art of proof){expect(art.defs).toBeGreaterThan(0);expect(art.refs).toBe(true);}
    await page.getByRole('button',{name:'권한 해제',exact:true}).click();await expect(portal).toHaveCount(0);
});
