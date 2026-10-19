import { expect, test, type Page } from '@playwright/test';

const positions = (page: Page) => page.locator('.demo-seat').evaluateAll(seats => seats.map(e => {
  const r = e.getBoundingClientRect();
  return { seat:e.getAttribute('data-relative'), x:r.x, y:r.y, width:r.width, height:r.height };
}));

async function settleLayout(page:Page){
  let previous='',stable=0;
  for(let frame=0;frame<24&&stable<3;frame++){
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
    const snapshot=await page.locator('.table-frame,.felt-area,.demo-ring,.demo-seat').evaluateAll(elements=>JSON.stringify(elements.map(element=>{
      const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    })));
    stable=snapshot===previous?stable+1:0;previous=snapshot;
  }
  expect(stable,'engine regions and seat boxes must settle after resize').toBeGreaterThanOrEqual(3);
}

for (const count of [3, 6] as const) {
  test(`${count}-seat generic layout retains anchors across scenes and resize`, async ({ page }, info) => {
    test.skip(info.project.name !== '390x844-light', 'one generic engine set independent of Mighty');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/preview?layout=${count}`);
    for (const viewport of [{width:1440,height:900},{width:768,height:1024},{width:390,height:844},{width:320,height:568}]) {
      await page.setViewportSize(viewport);
      await settleLayout(page);
      await expect(page.locator('[data-layout-demo]')).toHaveAttribute('data-layout-demo', String(count));
      await expect(page.locator('.demo-seat')).toHaveCount(count);
      await expect.poll(() => page.locator('.demo-ring').evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThan(0);
      const before = await positions(page);
      for (const label of ['플레이', '결과', '대기']) {
        await page.getByRole('button',{name:label,exact:true}).click();
        await settleLayout(page);
        expect(await positions(page)).toEqual(before);
        if (label === '플레이') {
          await expect(page.locator('.demo-card')).toHaveCount(count);
          const scene = await page.locator('.scene').boundingBox();
          for (const card of await page.locator('.demo-card').all()) {
            const rect = await card.boundingBox();
            expect(rect!.width).toBeGreaterThan(0);
            expect(rect!.height).toBeGreaterThan(0);
            expect(rect!.x).toBeGreaterThanOrEqual(scene!.x - 1);
            expect(rect!.y).toBeGreaterThanOrEqual(scene!.y - 1);
            expect(rect!.x + rect!.width).toBeLessThanOrEqual(scene!.x + scene!.width + 1);
            expect(rect!.y + rect!.height).toBeLessThanOrEqual(scene!.y + scene!.height + 1);
          }
          const overlaps = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('.demo-card')];
            const seats = [...document.querySelectorAll('.demo-seat')];
            const overlaps = (a: Element, b: Element) => {
              const x=a.getBoundingClientRect(), y=b.getBoundingClientRect();
              return x.left < y.right-1 && x.right > y.left+1 && x.top < y.bottom-1 && x.bottom > y.top+1;
            };
            return { cards:cards.flatMap((a,i) => cards.slice(i+1).filter(b => overlaps(a,b)).map(b => `${a.getAttribute('data-card-seat')}/${b.getAttribute('data-card-seat')}`)), seats:cards.flatMap(a => seats.filter(b => overlaps(a,b)).map(b => `${a.getAttribute('data-card-seat')}/${b.getAttribute('data-relative')}`)) };
          });
          expect(overlaps, `${count} seats at ${viewport.width}x${viewport.height}`).toEqual({cards:[],seats:[]});
        } else {
          await expect(page.locator('.scene-caption')).toBeVisible();
          await expect(page.locator('.scene-caption')).not.toHaveText('');
        }
      }
      const bounds = await page.locator('.scene').boundingBox();
      for (const seat of before) {
        expect(seat.x).toBeGreaterThanOrEqual(bounds!.x - 1);
        expect(seat.y).toBeGreaterThanOrEqual(bounds!.y - 1);
        expect(seat.x + seat.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
        expect(seat.y + seat.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
      }
      for (let i=0;i<before.length;i++) for (let j=i+1;j<before.length;j++) {
        const a=before[i],b=before[j];
        expect(a.x < b.x+b.width-1 && a.x+a.width > b.x+1 && a.y < b.y+b.height-1 && a.y+a.height > b.y+1).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
