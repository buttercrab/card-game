import { expect, test, type Page } from '@playwright/test';
const card = (page: Page, index = 0) => page.locator('button[data-foundation-kind="card"]').nth(index);
const ready = async (page: Page) => { await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status', 'ready'); await expect.poll(() => page.locator('[data-foundation-node="table"]').evaluate(element => element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width - 24); };
async function open(page: Page) { await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/preview?foundation=1&fixture=play');
    // Initial font publication can correctly expire a held native gesture. This
    // suite samples selection motion only after that separate resource boundary.
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    await ready(page); }
async function toggle(page: Page) {
    // Focus may scroll an offscreen native control. Settle that separately;
    // a scroll during held input must still cancel activation.
    await card(page).scrollIntoViewIfNeeded(); await card(page).focus();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await ready(page); await card(page).press('Space'); await ready(page);
}
async function freeze(page: Page, time: number) {
    return card(page).evaluate((element, time) => {
        const svg = element.firstElementChild!;
        const animations = svg.getAnimations();
        for (const animation of animations) { animation.pause(); animation.currentTime = time; }
        const box = svg.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect();
        const transform = getComputedStyle(svg).transform;
        return { count: animations.length, top: box.top, bottom: box.bottom, parentTop: parent.top, parentBottom: parent.bottom, offset: transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42 };
    }, time);
}
const active = (page: Page) => page.locator('.foundation-surface').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => (animation.effect as KeyframeEffect).target instanceof SVGSVGElement).length);

test('selection motion samples stay within reserved ink bounds without moving layout or sending a command', async ({ page }, info) => {
    await open(page);
    for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 }); await ready(page);
        await expect.poll(() => page.locator('[data-foundation-node="table"]').evaluate(el => el.getBoundingClientRect().width)).toBe(width - 24);
        const dock = await page.locator('[data-foundation-node="dock"]').getAttribute('data-foundation-box');
        await toggle(page);
        const start = await freeze(page, 0); expect(start.count).toBe(1); expect(start.offset).toBeCloseTo(14);
        for (const time of [0, 30, 60, 120, 180, 239]) {
            const pose = await freeze(page, time);
            expect(pose.top).toBeGreaterThanOrEqual(pose.parentTop + 5);
            expect(pose.bottom).toBeLessThanOrEqual(pose.parentBottom - 5);
            expect(pose.offset).toBeGreaterThanOrEqual(0); expect(pose.offset).toBeLessThanOrEqual(14);
            expect(await page.locator('[data-foundation-node="dock"]').getAttribute('data-foundation-box')).toBe(dock);
        }
        if (width === 320) await page.screenshot({ path: `/tmp/foundation-motion-${info.project.name}.png`, fullPage: true });
        await freeze(page, 240);
        await page.locator('[data-foundation-action]').evaluate(el => { if (el.textContent) throw new Error('Motion dispatched an action'); });
        await toggle(page); await freeze(page, 240);
    }
});

test('rapid reversal starts from the displayed pose and active motion is canceled across boundaries', async ({ page }) => {
    await open(page); await toggle(page);
    const before = await freeze(page, 90); expect(before.count).toBe(1);
    await toggle(page);
    const reversed = await freeze(page, 0); expect(reversed.count).toBe(1); expect(reversed.top).toBeCloseTo(before.top, 0);
    await page.setViewportSize({ width: 768, height: 1024 }); await ready(page); await expect.poll(() => active(page)).toBe(0);
    await toggle(page); expect((await freeze(page, 90)).count).toBe(1);
    await page.getByRole('button', { name: '새 선택지', exact: true }).click(); await ready(page); await expect.poll(() => active(page)).toBe(0);
    await toggle(page); await freeze(page, 90);
    await page.getByRole('button', { name: '분리', exact: true }).click(); await expect.poll(() => active(page)).toBe(0);
    await page.getByRole('button', { name: '다시 연결', exact: true }).click(); await ready(page); expect(await active(page)).toBe(0);
    await toggle(page); await freeze(page, 90);
    await page.getByRole('button', { name: '권한 해제', exact: true }).click(); await expect(card(page)).toHaveCount(0); expect(await active(page)).toBe(0);
});

test('reduced-motion changes cancel running movement and subsequent selections snap', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await open(page); await toggle(page); expect((await freeze(page, 90)).count).toBe(1);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect.poll(() => active(page)).toBe(0);
    await toggle(page); expect(await active(page)).toBe(0);
    await expect(card(page)).toHaveAttribute('aria-pressed', 'false'); expect(errors).toEqual([]);
});

for (const speed of ['fast', 'off'] as const) test(`shared ${speed} setting controls selection motion`, async ({ page }) => {
    await page.addInitScript(speed => { localStorage.setItem('mighty.settings', JSON.stringify({ speed })); }, speed);
    await open(page); await toggle(page);
    await expect(card(page)).toHaveAttribute('aria-pressed', 'true');
    if (speed === 'off') expect(await active(page)).toBe(0);
    else {
        const duration = await card(page).evaluate(element => { const animation = element.firstElementChild!.getAnimations()[0]; animation?.pause(); return animation?.effect?.getTiming().duration; });
        expect(duration).toBe(120);
    }
});
