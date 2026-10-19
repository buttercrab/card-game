import {expect,test,type Page} from '@playwright/test';
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(element=>element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width-24);}
async function geometry(page:Page){return page.locator('.foundation-surface').evaluate(host=>{
    const elements=Array.from(host.querySelectorAll<HTMLElement>('[data-foundation-node]'));
    const failures:string[]=[];
    for(const element of elements){
        const parent=element.parentElement!;if(!parent.hasAttribute('data-foundation-node'))continue;
        const a=element.getBoundingClientRect(),p=parent.getBoundingClientRect();
        const fan=element.dataset.foundationArrangement==='fan'&&getComputedStyle(parent).overflowX==='auto';
        const css=getComputedStyle(parent),allocation=JSON.parse(element.dataset.foundationBox??'null');
        // Only an engine-owned, origin-aligned flow group may exceed a
        // measured native scroll viewport. Leaves retain full containment.
        const flow=element.dataset.foundationKind==='group'&&allocation?.x===0&&allocation?.y===0;
        const vertical=flow&&/(auto|scroll)/.test(css.overflowY)&&parent.clientHeight>0;
        const horizontal=flow&&/(auto|scroll)/.test(css.overflowX)&&parent.clientWidth>0;
        if(a.top<p.top-.5||!vertical&&a.bottom>p.bottom+.5||!fan&&!horizontal&&(a.left<p.left-.5||a.right>p.right+.5))failures.push(`escape:${element.dataset.foundationNode}`);
        if(parent.dataset.foundationArrangement==='fan')continue;
        for(const sibling of Array.from(parent.children)){
            if(sibling===element||!sibling.hasAttribute('data-foundation-node'))continue;
            const b=sibling.getBoundingClientRect();
            if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5)failures.push(`overlap:${element.dataset.foundationNode}`);
        }
    }
    const byId=(id:string)=>elements.find(element=>element.dataset.foundationNode===id)!;
    const rect=(id:string)=>{const r=byId(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {failures,facts:elements.some(element=>element.dataset.foundationNode==='facts')?rect('facts'):null,status:elements.some(element=>element.dataset.foundationNode==='active-status-viewport')?rect('active-status-viewport'):null,arena:rect('arena'),panel:rect('decisions'),dock:rect('dock'),figure:rect('identity-figure'),name:rect('identity-name'),viewport:elements.some(element=>element.dataset.foundationNode==='active-arena-viewport')?rect('active-arena-viewport'):elements.some(element=>element.dataset.foundationNode==='table-viewport')?rect('table-viewport'):null,rootScroll:byId('table').scrollHeight>host.clientHeight+.5,scroll:byId('table').scrollHeight>host.clientHeight+.5||elements.some(element=>/(auto|scroll)/.test(getComputedStyle(element).overflowY)&&element.scrollHeight>element.clientHeight)};
});}

test('whole table uses a sidebar only when it fits and preserves readable leaves through resize',async({page},info)=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/preview?foundation=1&fixture=arena&stage=1');await ready(page);
    for(const [width,height] of [[1440,900],[390,844],[768,1024],[320,568],[1440,900]]){
        await page.setViewportSize({width,height});await ready(page);const g=await geometry(page);
        expect(g.failures).toEqual([]);expect(g.figure.width).toBe(72);
        if(width===1440){expect(g.facts!.x).toBeGreaterThanOrEqual(g.arena.right+11.5);expect(g.rootScroll).toBe(false);}
        else {expect(g.status).not.toBeNull();expect(g.arena.y).toBeGreaterThanOrEqual(g.status!.bottom+7.5);}
        expect(g.panel.y).toBeGreaterThanOrEqual((g.viewport?.bottom??g.arena.bottom)+7.5);expect(g.dock.y).toBeGreaterThanOrEqual(g.panel.bottom+7.5);
        if(width<=390){expect(g.name.x).toBeGreaterThanOrEqual(g.figure.right+7.5);expect(Math.abs(g.name.y+g.name.height/2-g.figure.y-g.figure.height/2)).toBeLessThanOrEqual(2);if(g.viewport){const host=await page.locator('.foundation-surface').boundingBox();expect(g.dock.bottom).toBeLessThanOrEqual(host!.y+host!.height+.5);}}
        await page.screenshot({path:`/tmp/foundation-arena-${width}-${info.project.name}.png`});
    }
    const native=page.getByRole('combobox',{name:'공약 수',exact:true});if(await native.count()){await native.selectOption('17');await expect(native).toHaveValue('17');}else{await page.getByRole('radio',{name:'17',exact:true}).click();await expect(page.getByRole('radio',{name:'17',exact:true})).toBeChecked();}
    await expect(page.getByRole('button',{name:'공약 ♠ 스페이드 17',exact:true})).toBeEnabled();expect(errors).toEqual([]);
});

test('large text, long names and forty cards retain explicit scrolling without overlap',async({page})=>{
    await page.goto('/preview?foundation=1&fixture=arena');await ready(page);
    for(const label of ['긴 이름','큰 글자','40장']){await page.getByRole('button',{name:label,exact:true}).click();await ready(page);}
    for(const [width,height] of [[320,568],[768,1024],[1440,900]]){
        await page.setViewportSize({width,height});await ready(page);const g=await geometry(page);expect(g.failures).toEqual([]);expect(g.figure.width).toBe(72);expect(g.scroll).toBe(true);
        await expect(page.locator('[data-foundation-node="hand"]')).toHaveCSS('overflow-x','auto');
    }
});

