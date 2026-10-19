import { expect, test } from '@playwright/test';

test('local identity remains readable with a text-sized name tag through resizing', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one retained table per phase');
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
  for (const state of ['room', 'bidding', 'play']) {
    await page.goto(`/preview?state=${state}&room`);
    await page.locator('html[data-ready]').waitFor();
    for (const [width, height] of [[390,844], [768,1024], [898,700], [900,900], [1440,900], [320,568], [568,320]]) {
      await page.setViewportSize({ width, height });
      const identity = page.locator('.me-seat .identity');
      await expect(identity).toBeVisible();
      const landscape = width > height && height <= 520;
      const minimum = state === 'room' ? (width >= 1024 ? 72 : 64) : landscape ? 40 : width >= 1024 ? 72 : width >= 600 ? 64 : 56;
      // setViewportSize can return before the browser's next pre-paint callback.
      await expect.poll(() => identity.locator('.stand').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(minimum);
      await expect.poll(async () => identity.evaluate(element => {
        const rect = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
        const figure = rect('.stand'), tag = rect('.name-row'), text = rect('.name');
        return Math.abs(tag.width - text.width - 16);
      })).toBeLessThanOrEqual(1);
      const geometry = await identity.evaluate(element => {
        const rect = (selector: string) => {
          const box = element.querySelector(selector)!.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        return { figure: rect('.stand'), tag: rect('.name-row'), text: rect('.name') };
      });
      expect(geometry.figure.width).toBeGreaterThanOrEqual(minimum);
      expect(geometry.text.x).toBeGreaterThanOrEqual(geometry.tag.x + 7);
      expect(geometry.text.right).toBeLessThanOrEqual(geometry.tag.right - 7);
      // A numeric seat box can be taller than its figure (feedback lives in
      // the same box). Its top anchor must not center that excess over the rim.
      if (state !== 'room') await expect.poll(() => identity.evaluate(element => {
        const stand = element.querySelector('.stand')!.getBoundingClientRect();
        const tray = element.closest('.tray')!.getBoundingClientRect();
        return stand.top - tray.top;
      })).toBeGreaterThanOrEqual(3);
      if (state === 'room') {
        expect(geometry.tag.y).toBeGreaterThanOrEqual(geometry.figure.bottom);
        expect(Math.abs(geometry.tag.x + geometry.tag.width / 2 - geometry.figure.x - geometry.figure.width / 2)).toBeLessThanOrEqual(1);
      }
    }
  }
});

test('local figure and turn halo stay inside the tray through live resize frames', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one retained table through affected widths');
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
  await page.goto('/preview?state=bidding&room');
  await page.locator('html[data-ready]').waitFor();
  for (const [width,height] of [[898,700],[768,1024],[390,844],[900,900],[1440,900],[898,700]]) {
    await page.setViewportSize({width,height});
    const clearances = await page.locator('.me-seat .stand').evaluate(async element => {
      const samples:number[]=[];
      for(let frame=0;frame<8;frame++) {
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        const stand=element.getBoundingClientRect(),tray=element.closest('.tray')!.getBoundingClientRect();
        const halo=getComputedStyle(element,'::before');
        samples.push(Math.min(stand.top,stand.top+parseFloat(halo.top))-tray.top);
      }
      return samples;
    });
    expect(Math.min(...clearances), `character/halo clearance at ${width}x${height}`).toBeGreaterThanOrEqual(3);
  }
});
