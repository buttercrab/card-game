import { expect, test } from '@playwright/test';

test('normal resize retargets each card from its last resting box to the final box', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one normal-motion resize trace');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false }));
    (window as any).__retargets = [];
    (window as any).__recordRetargets = false;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (typeof options === 'object' && options?.id === 'scene-node' && this.closest('.hand') && (window as any).__recordRetargets) {
        const element = this as HTMLElement;
        const first = (frames as Keyframe[])[0];
        const matrix = new DOMMatrix(first.transform as string);
        (window as any).__retargets.push({ id: element.dataset.coordinateId,
          after: { x: parseFloat(element.style.left), y: parseFloat(element.style.top), width: parseFloat(element.style.width), height: parseFloat(element.style.height) },
          translation: { x: matrix.m41, y: matrix.m42 }, scale: { x: matrix.m11, y: matrix.m22 } });
      }
      return animate.call(this, frames, options);
    };
  });
  await page.goto('/preview?state=play&room');
  await expect(page.locator('html')).toHaveAttribute('data-ready', '');
  await expect(page.locator('.hand [data-coordinate-id]')).toHaveCount(10);
  const resting = async () => {
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.id === 'scene-node' && animation.playState === 'running').length)).toBe(0);
    return page.locator('.hand [data-coordinate-id]').evaluateAll(elements => elements.map(element => {
      const e = element as HTMLElement;
      return { id: e.dataset.coordinateId, x: parseFloat(e.style.left), y: parseFloat(e.style.top), width: parseFloat(e.style.width), height: parseFloat(e.style.height) };
    }));
  };
  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    const before = await resting();
    await page.evaluate(() => { (window as any).__retargets = []; (window as any).__recordRetargets = true; });
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => (window as any).__retargets.length)).toBe(10);
    const records = await page.evaluate(() => (window as any).__retargets as { id: string; after: { x: number; y: number; width: number; height: number }; translation: { x: number; y: number }; scale: { x: number; y: number } }[]);
    for (const record of records) {
      const old = before.find(box => box.id === record.id)!;
      // The animation's initial matrix must preserve the previous resting
      // centre and size, rather than any unpainted intermediate layout box.
      expect(record.after.x + record.after.width / 2 + record.translation.x).toBeCloseTo(old.x + old.width / 2, 1);
      expect(record.after.y + record.after.height / 2 + record.translation.y).toBeCloseTo(old.y + old.height / 2, 1);
      expect(record.after.width * record.scale.x).toBeCloseTo(old.width, 1);
      expect(record.after.height * record.scale.y).toBeCloseTo(old.height, 1);
    }
  }
});
