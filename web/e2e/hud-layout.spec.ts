import { expect, test } from '@playwright/test';

for (const view of [
  { project: '320x568-light', width: 320, height: 568 },
  { project: '390x844-light', width: 390, height: 844 },
  { project: '390x844-light', width: 568, height: 320 },
  { project: '1440x900-dark', width: 1440, height: 900 },
]) test(`result content is contained from its first visible measured frame at${view.width}`, async ({ page }, info) => {
  test.skip(info.project.name !== view.project, 'one applicable profile per physical layout');
  await page.setViewportSize({width:view.width,height:view.height});
  await page.addInitScript(() => {
    localStorage.setItem('mighty.settings', JSON.stringify({speed:'off',sound:false,music:false}));
    const frames: { visible: boolean; contained: boolean }[] = [];
    (window as any).__resultFrames = frames;
    function sample() {
      requestAnimationFrame(() => setTimeout(() => {
        const panel = document.querySelector('.result'), layer = panel?.closest('.result-layer');
        if (panel && layer) {
          const visible = getComputedStyle(panel).visibility === 'visible';
          const box = panel.getBoundingClientRect(), frame = layer.getBoundingClientRect();
          const inside = (a: DOMRect, b: DOMRect) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
          const contained = inside(box,frame) && [...panel.querySelectorAll('.summary h2,.summary p,.summary strong,.footer button')].every(element => inside(element.getBoundingClientRect(),box));
          frames.push({visible,contained});
        }
        if (frames.length < 30) sample();
      }, 0));
    }
    sample();
  });
  await page.goto('/preview?state=done&room');
  await expect(page.locator('.result')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__resultFrames.filter((frame: {visible:boolean}) => frame.visible).length)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => (window as any).__resultFrames.filter((frame: {visible:boolean;contained:boolean}) => frame.visible && !frame.contained))).toEqual([]);
  await expect(page.locator('.result button.primary')).toHaveCount(1);
});
