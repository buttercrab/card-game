import {expect,test,type Page} from '@playwright/test';
async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(element=>element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width-24);}
test.use({launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']}});
 test('scrolling controls preserves the dock, exact viewport width and held-command cancellation',async({page,isMobile})=>{
    await page.setViewportSize({width:390,height:844});await page.goto('/preview?foundation=1&fixture=arena&stage=1');await ready(page);
    // Simulate a classic scrollbar stylesheet; the adapter's explicit policy
    // must measure and reserve that gutter before publishing its content.
    await page.addStyleTag({content:'*{scrollbar-width:auto}*::-webkit-scrollbar{width:24px;height:24px}'});
    const viewport=page.locator('[data-foundation-node="decisions"]');await expect(viewport).toHaveCount(1);
    await page.setViewportSize({width:391,height:844});await ready(page);
    expect(await viewport.evaluate(element=>element.firstElementChild!.getBoundingClientRect().width-element.clientWidth)).toBe(0);
    if(!isMobile)expect(await viewport.evaluate(element=>element.offsetWidth-element.clientWidth)).toBe(24);
    const dock=page.locator('[data-foundation-node="dock"]');const before=await dock.boundingBox();
    const submit=page.getByRole('button',{name:'공약 ♠ 스페이드 14',exact:true});
    await submit.scrollIntoViewIfNeeded();await submit.focus();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect(await dock.boundingBox()).toEqual(before);await expect(submit).toBeEnabled();
    const range=await viewport.evaluate(element=>({top:element.scrollTop,max:element.scrollHeight-element.clientHeight}));expect(range.max).toBeGreaterThan(0);
    const direction=range.top<range.max/2?1:-1;
    await page.keyboard.down('Space');const box=await viewport.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.wheel(0,direction*120);
    await expect.poll(()=>viewport.evaluate(element=>element.scrollTop)).not.toBe(range.top);
    await page.keyboard.up('Space');await expect(submit).toBeEnabled();expect(await dock.boundingBox()).toEqual(before);
    await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-action','');
});
