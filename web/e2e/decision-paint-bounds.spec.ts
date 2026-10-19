import { expect, test } from '@playwright/test';

test('decision rows preserve pulse, focus and shadow space through resizing', async ({ page }, info) => {
  test.skip(info.project.name !== '1440x900-dark', 'one retained table across physical layouts');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'normal', sound: false, music: false })));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/preview?state=bidding&room');
  await page.locator('html[data-ready]').waitFor();
  for (const [width, height] of [[768,1024],[390,844],[320,568],[568,320],[1440,900]]) {
    await page.setViewportSize({ width, height });
    const choices = page.getByRole('radiogroup', { name: '공약 수', exact: true }).getByRole('radio');
    await expect(choices.last()).toBeVisible();
    // Exercise both ends of the scrolling row, including its trailing gutter.
    for (const index of [await choices.count() - 1, 0]) {
      const choice = choices.nth(index);
      await choice.click();
      await expect(choice).toHaveAttribute('aria-checked', 'true');
      const geometry = await choice.evaluate((element, index) => {
        const scroller = element.closest<HTMLElement>('.picks')!;
        scroller.scrollLeft = index === 0 ? 0 : scroller.scrollWidth;
        const animation = element.getAnimations().find(animation => (animation as CSSAnimation).animationName === 'pulse');
        if (!animation) throw new Error('Selection pulse is missing');
        animation.pause(); animation.currentTime = 72;
        const box = element.getBoundingClientRect();
        const clipped: string[] = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (['auto','scroll','hidden','clip'].includes(style.overflowY) && (box.top < clip.top - .5 || box.bottom + 3 > clip.bottom + .5)) clipped.push(`${parent.className}:vertical`);
          if (['auto','scroll','hidden','clip'].includes(style.overflowX) && (box.left < clip.left - .5 || box.right > clip.right + .5)) clipped.push(`${parent.className}:horizontal`);
        }
        return { clipped, scale: getComputedStyle(element).scale };
      }, index);
      expect(geometry.clipped).toEqual([]);
      expect(parseFloat(geometry.scale)).toBeGreaterThan(1);
    }
    if (height > width || width === 1440) {
      const gap = await page.evaluate(() => {
        const controls = document.querySelector('.strip-area .controls')!.getBoundingClientRect();
        const tray = document.querySelector('.tray-area')!.getBoundingClientRect();
        return tray.top - controls.bottom;
      });
      expect(gap).toBeGreaterThanOrEqual(11);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
