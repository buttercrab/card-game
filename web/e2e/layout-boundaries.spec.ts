import {expect,test} from '@playwright/test';

test('phone results keep player identities and reactions clear',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','one phone result-clearance matrix');
  await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false})));
  for(const [width,height] of [[320,568],[375,667],[390,844],[824,1034]]) {
    await page.setViewportSize({width,height});
    await page.goto('/preview?state=done&room');
    await page.locator('html[data-ready]').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const covered=await page.locator('.felt .seat').evaluateAll(nodes=>{
      const result=document.querySelector('.result')!.getBoundingClientRect();
      return nodes.filter(e=>{
        const r=e.getBoundingClientRect();
        return r.left<result.right&&r.right>result.left&&r.top<result.bottom&&r.bottom>result.top;
      }).map(e=>e.querySelector('.name')?.textContent);
    });
    expect(covered,`${width}x${height} result must clear the whole player frame`).toEqual([]);
    const clear=await page.locator('.ring > .finished-hands').evaluate(el=>{
      const hands=el.getBoundingClientRect(),result=document.querySelector('.result')!.getBoundingClientRect();
      return hands.bottom<=result.top+1 || hands.right<=result.left || hands.left>=result.right;
    });
    expect(clear,`${width}x${height} finished hands must clear the result controls`).toBe(true);
  }
});

test('short layouts retain whole header controls and separate adjacent names', async ({page},info) => {
  test.skip(info.project.name !== '1440x900-dark','one focused short-layout boundary matrix');
  await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false})));
  for(const [width,height] of [[320,568],[568,320],[800,400]]) {
    await page.setViewportSize({width,height});
    await page.goto('/preview?state=done&room');
    await page.locator('html[data-ready]').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const clipped=await page.locator('.bar button').evaluateAll(nodes=>nodes.filter(e=>{
      const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.width<44||r.height<44;
    }).map(e=>e.getAttribute('aria-label')??e.textContent));
    expect(clipped).toEqual([]);
    const merged=await page.locator('.felt .name').evaluateAll(nodes=>nodes.flatMap((a,i)=>{
      const x=a.getBoundingClientRect();return nodes.slice(i+1).filter(b=>{
        const y=b.getBoundingClientRect();return x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top;
      }).map(b=>[a.textContent,b.textContent]);
    }));
    expect(merged).toEqual([]);
  }
});

test('the complete production trick remains non-overlapping',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','one normal-motion five-card composition');
  await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'normal',sound:false,music:false})));
  await page.goto('/preview?state=sweep&room');
  await page.locator('.slot .won').waitFor();
  expect(await page.locator('.slot .card').count()).toBe(5);
  const collisions=await page.locator('.slot .card').evaluateAll(nodes=>nodes.flatMap((a,i)=>{
    const x=a.getBoundingClientRect();return nodes.slice(i+1).filter(b=>{
      const y=b.getBoundingClientRect();return x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top;
    }).map(b=>[a.getAttribute('data-card'),b.getAttribute('data-card')]);
  }));
  expect(collisions).toEqual([]);
});

test('production desktop dock keeps cards and commands in their viewport bands',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','one wide-dock viewport matrix');
  await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false})));
  for(const [width,height]of [[1440,900],[1565,1079],[1920,1080],[1024,900]]){
    await page.setViewportSize({width,height});
    await page.goto('/preview?state=room&room');await page.locator('html[data-ready]').waitFor();
    expect(await page.locator('.tray').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ')[0])).toBe('170px');
    for(const state of ['play','watch','bidding','contract']){
      await page.goto(`/preview?state=${state}&room`);await page.locator('html[data-ready]').waitFor();
      const hand=await page.locator('.hand-slot > .hand').boundingBox();
      expect(height-hand!.y-hand!.height).toBeGreaterThanOrEqual(0);
      expect(height-hand!.y-hand!.height).toBeLessThanOrEqual(48);
      await expect(page.locator('.me-seat .stand')).toBeVisible();
      expect(await page.locator('.tray').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ')[0])).toBe('170px');
      const hidden=await page.locator('.strip .controls').evaluateAll(nodes=>nodes.filter(e=>{
        const r=e.getBoundingClientRect();const cards=document.querySelector('.hand-slot > .hand')!.getBoundingClientRect();
        return r.bottom>cards.top||r.top<0;
      }).map(e=>e.className));
      expect(hidden).toEqual([]);
      if(state==='play'||state==='watch'){
        const scene=await page.evaluate(()=>{
          const cards=[...document.querySelectorAll<HTMLElement>('.slot .card')];
          const bottom=Math.max(...cards.map(e=>e.getBoundingClientRect().bottom));
          const note=document.querySelector('.note:not(.lead)')!.getBoundingClientRect();
          return{widths:cards.map(e=>parseFloat(getComputedStyle(e).width)),captionGap:note.top-bottom,captionInside:note.bottom<=document.querySelector('.felt')!.getBoundingClientRect().bottom};
        });
        // Production sizes trick cards from the felt's remaining room,
        // with a lower bound and a viewport-height card ceiling.
        expect(Math.min(...scene.widths)).toBeGreaterThanOrEqual(40);
        expect(Math.max(...scene.widths)).toBeLessThanOrEqual(1.2*Math.min(124,Math.max(88,height*.12))+1);
        expect(scene.captionGap).toBeGreaterThanOrEqual(8);
        // The production note reserves the fifth played-card place even
        // when its card has not appeared yet. It must remain within the felt.
        expect(scene.captionInside).toBe(true);
      }
    }
    await page.goto('/preview?state=done&room');await page.locator('html[data-ready]').waitFor();
    const result=await page.locator('.result').boundingBox();
    expect(result!.y+result!.height).toBeLessThanOrEqual(height);
    expect(await page.locator('.result button').evaluateAll(nodes=>nodes.every(e=>e.getBoundingClientRect().bottom<=innerHeight))).toBe(true);
  }
});
