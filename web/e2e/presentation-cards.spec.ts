import { expect, test, type Page } from '@playwright/test';
import { BACK_COLOR } from '../src/lib/tokens';
import type { CardBack } from '../src/lib/looks';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', error => list.push(error.message));
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('mighty.settings') ?? '{}');
    localStorage.setItem('mighty.settings', JSON.stringify({...saved,speed:'off',sound:false,music:false}));
  });
  await page.goto('/preview?contract=1');
  await expect(page.locator('[data-contract-demo]')).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test('normalized cards show shared court, pip and back artwork with accessible labels', async ({ page }, info) => {
  test.skip(!['390x844-light','390x844-dark','1440x900-light','1440x900-dark'].includes(info.project.name), 'shared faces in both themes at desktop and mobile');
  for (const viewport of [page.viewportSize()!,{width:320,height:568}]) {
    await page.setViewportSize(viewport);
    const poker = page.locator('[data-game="poker"]');
    await expect(poker.locator('.card')).toHaveCount(7);
    const queen = poker.getByRole('img',{name:'♣ Q',exact:true});
    const jack = poker.getByRole('img',{name:'♦ J',exact:true});
    const king = poker.getByRole('img',{name:'♥ K',exact:true});
    for (const court of [queen,jack,king]) {
      await expect(court).toBeVisible();
      await expect(court.locator('.art svg')).toHaveCount(1);
      await expect(court.locator('.art svg')).toBeVisible();
    }
    const seven = poker.getByRole('img',{name:'♠ 7',exact:true});
    await expect(seven.locator('.pip')).toHaveCount(7);
    await expect(seven.locator('.pip svg')).toHaveCount(7);
    await expect(seven.locator('.pips')).toBeVisible();
    await expect(poker.getByRole('img',{name:'♠ A',exact:true}).locator('.ace svg')).toHaveCount(1);
    const backs = poker.locator('.card.back');
    await expect(backs).toHaveCount(2);
    for (const back of await backs.all()) {
      await expect(back).toHaveAttribute('aria-label','비공개 카드');
      await expect(back.locator('svg.card-back')).toBeVisible();
      await expect(back.locator('.index-rank,.index-suit,.pip,.art')).toHaveCount(0);
      await expect(back).not.toHaveAttribute('data-rank',/.+/);
      await expect(back).not.toHaveAttribute('data-suit',/.+/);
    }
    const allCards = await page.locator('.contract-demo .card').all();
    for (const card of allCards) {
      const rect = await card.boundingBox();
      expect(rect!.width).toBeGreaterThan(0);
      expect(rect!.height).toBeGreaterThan(0);
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('existing card-back settings apply to generic hidden cards and SVG clips are unique', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one settings persistence and SVG identity sequence');
  for (const back of Object.keys(BACK_COLOR) as CardBack[]) {
    await page.evaluate(value => {
      const saved = JSON.parse(localStorage.getItem('mighty.settings') ?? '{}');
      localStorage.setItem('mighty.settings',JSON.stringify({...saved,cardBack:value}));
    }, back);
    await page.reload();
    const backs = page.locator('[data-game="poker"] .card.back');
    await expect(backs).toHaveCount(2);
    for (const card of await backs.all()) await expect(card.locator('svg.card-back > rect').first()).toHaveAttribute('fill',BACK_COLOR[back]);
    if (back === 'indigo') {
      const clips = await page.locator('svg clipPath[id]').evaluateAll(nodes => nodes.map(n => n.id));
      expect(clips.length).toBeGreaterThanOrEqual(2);
      expect(new Set(clips).size).toBe(clips.length);
      const invalid = await page.locator('[clip-path]').evaluateAll(nodes => nodes.filter(n => {
        const id = n.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1];
        return !id || document.getElementById(id)?.closest('svg') !== n.closest('svg');
      }).map(n => n.getAttribute('clip-path')));
      expect(invalid).toEqual([]);
    }
  }
});

test('observer cards retain backs and expose no private ranks, suits or actions', async ({ page }, info) => {
  test.skip(info.project.name !== '390x844-light', 'one observer boundary');
  await page.getByRole('button',{name:'관전 모드',exact:true}).click();
  const poker = page.locator('[data-game="poker"]');
  await expect(poker.locator('.card.back')).toHaveCount(4);
  await expect(poker.locator('.card:not(.back)')).toHaveCount(3);
  await expect(poker.getByRole('img',{name:'♠ A',exact:true})).toHaveCount(0);
  await expect(poker.getByRole('img',{name:'♥ K',exact:true})).toHaveCount(0);
  await expect(poker.locator('.back .index-rank,.back .index-suit,.back .pip,.back .art')).toHaveCount(0);
  for (const label of ['마이티 행동','포커 행동']) await expect(page.getByRole('region',{name:label,exact:true}).getByRole('button')).toHaveCount(0);
  await expect(page.locator('[data-game="mighty"] .card')).toHaveCount(0);
});
