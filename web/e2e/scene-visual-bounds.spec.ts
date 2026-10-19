import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
test.skip(!process.env.DOM_POSE_DEV_ORACLE, 'requires an explicit Vite source-module oracle');

test('numeric pose sampling follows native microstates and interrupted ancestor motion without measuring cards', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { sampleVisualBounds } = await import('/src/lib/table/sceneMotion.ts');
    const frame = document.createElement('div');
    frame.style.cssText = 'position:fixed;left:50px;top:40px;width:600px;height:500px';
    frame.innerHTML = '<div id="pose-hand" style="position:absolute;left:20px;top:200px;width:400px;height:160px;translate:0 -4px"><div id="pose-node" style="position:absolute;left:80px;top:14px;width:80px;height:112px;transform-origin:50% 50%"><div id="pose-spot" style="position:relative;width:80px;height:112px"><button id="pose-card" style="display:block;box-sizing:border-box;width:80px;height:112px;border:0;padding:0;margin:0;transform-origin:50% 50%">Native card input</button></div></div></div>';
    document.body.append(frame);
    const source = frame.querySelector<HTMLElement>('#pose-card')!, node = frame.querySelector<HTMLElement>('#pose-node')!, spot = frame.querySelector<HTMLElement>('#pose-spot')!;
    const base = { x: 100, y: 214, width: 80, height: 112 };
    const nativeBounds = Element.prototype.getBoundingClientRect;
    source.getBoundingClientRect = () => { throw new Error('per-card measurement forbidden'); };
    const errors: number[] = [];
    const check = () => {
      const actual = nativeBounds.call(source), root = nativeBounds.call(frame), numeric = sampleVisualBounds(source, base, frame);
      errors.push(Math.max(Math.abs(numeric.x - (actual.x - root.x)), Math.abs(numeric.y - (actual.y - root.y)), Math.abs(numeric.width - actual.width), Math.abs(numeric.height - actual.height)));
    };
    source.style.translate = '0 -28.8px'; check();
    source.style.translate = '0 -6px'; source.style.rotate = '2deg'; source.style.transform = 'perspective(600px) rotateX(7deg) rotateY(-5deg)'; check();
    spot.style.transform = 'translateY(-28px) scale(.85) rotate(3deg)'; check();
    const animation = node.animate([{ transform: 'translate(-60px,20px) scale(1.2)' }, { transform: 'none' }], { duration: 1000, fill: 'both' });
    animation.pause();
    for (const time of [100, 500, 900]) {
      animation.currentTime = time;
      await new Promise(resolve => requestAnimationFrame(resolve));
      check();
    }
    animation.cancel();
    let clicks = 0; source.onclick = () => clicks++; source.focus(); source.click();
    const inputPreserved = document.activeElement === source && clicks === 1;
    // A larger rotated container has no supplied numeric origin: do not guess.
    frame.querySelector<HTMLElement>('#pose-hand')!.style.rotate = '4deg';
    const unsupported = sampleVisualBounds(source, base, frame);
    frame.remove();
    return { errors, inputPreserved, unsupported, base };
  });
  expect(Math.max(...result.errors), JSON.stringify(result.errors)).toBeLessThanOrEqual(0.75);
  expect(result.inputPreserved).toBe(true);
  expect(result.unsupported).toEqual(result.base);
});

test('canonical Mighty hand and leading cards sample their live native pose from numeric resting nodes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false, singleTap: false })));
  await page.goto('/preview?state=play');
  await page.locator('html[data-ready]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const card = page.locator('.hand button.card:not(.unplayable)').first();
  await card.press('Enter');
  await expect(card).toHaveClass(/raised/);
  const result = await page.evaluate(async () => {
    const { sampleVisualBounds } = await import('/src/lib/table/sceneMotion.ts');
    const native = Element.prototype.getBoundingClientRect;
    const source = document.querySelector<HTMLElement>('.hand button.card.raised')!;
    const node = source.closest<HTMLElement>('[data-coordinate-id]')!, hand = source.closest<HTMLElement>('div.hand')!, frame = source.closest<HTMLElement>('.table')!;
    const base = () => {
      const region = native.call(hand), origin = native.call(frame), shift = getComputedStyle(hand).translate.split(' ').map(value => parseFloat(value) || 0);
      return { x: region.x - origin.x - shift[0] + parseFloat(node.style.left), y: region.y - origin.y - (shift[1] ?? 0) + parseFloat(node.style.top), width: parseFloat(node.style.width), height: parseFloat(node.style.height) };
    };
    const errors: number[] = [];
    source.getBoundingClientRect = () => { throw new Error('sampling must not measure cards'); };
    const check = (element: Element, bounds: { x: number; y: number; width: number; height: number }) => {
      const actual = native.call(element), origin = native.call(frame), numeric = sampleVisualBounds(element, bounds, frame);
      errors.push(Math.max(Math.abs(actual.x - origin.x - numeric.x), Math.abs(actual.y - origin.y - numeric.y), Math.abs(actual.width - numeric.width), Math.abs(actual.height - numeric.height)));
    };
    for (let i = 0; i < 4; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); check(source, base()); }
    const animation = node.animate([{ transform: 'translate(70px,-10px) scale(.92)' }, { transform: 'none' }], { duration: 400, fill: 'both' });
    animation.pause();
    for (const time of [40, 200, 360]) { animation.currentTime = time; await new Promise(resolve => requestAnimationFrame(resolve)); check(source, base()); }
    animation.cancel();
    const leading = document.querySelector<HTMLElement>('.trick .card.leading')!;
    const slot = leading.closest<HTMLElement>('.slot')!, ring = leading.closest<HTMLElement>('.ring')!;
    const region = native.call(ring), origin = native.call(frame);
    const target = { x: region.x - origin.x + parseFloat(slot.style.left), y: region.y - origin.y + parseFloat(slot.style.top), width: parseFloat(slot.style.width), height: parseFloat(slot.style.height) };
    leading.getBoundingClientRect = () => { throw new Error('sampling must not measure cards'); };
    check(leading, target);
    return { errors, handBox: base(), target };
  });
  await mkdir('/tmp/card-game-numeric-pose-oracle', { recursive: true });
  await writeFile(`/tmp/card-game-numeric-pose-oracle/${test.info().project.name}.json`, JSON.stringify(result, null, 2));
  await test.info().attach('canonical-native-pose', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(Math.max(...result.errors), JSON.stringify(result)).toBeLessThanOrEqual(0.75);
});
