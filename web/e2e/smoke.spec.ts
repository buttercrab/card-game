import { expect, test, type Page } from '@playwright/test';

// Every page and every /preview state (TablePreview.svelte), at the four
// sizes and both themes of playwright.config.ts. Each must:
// - not scroll sideways;
// - leave every seat's name and badge uncovered;
// - show every hand card's corner index, and hit that card when tapped there;
// - log no console errors.

const STATES = [
  'bidding',
  'waiting',
  'misdeal',
  'exchange',
  'friend',
  'secret',
  'nofriend',
  'play',
  'watch',
  'late',
  'sweep',
  'done',
  'won',
  'run',
];

const PAGES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'rules-gshs', path: '/rules/gshs' },
  { name: 'about', path: '/about' },
  { name: 'privacy', path: '/privacy' },
  { name: '404', path: '/no-such-page' },
  ...STATES.map((s) => ({ name: `preview-${s}`, path: `/preview?state=${s}` })),
];

/** Known layout bugs, each to be fixed by docs/FIXES.md item 1.8, marked
 * expected-fail so CI stays green. A key is `<test>@<size>` (both themes).
 * When a fix lands the test passes, Playwright fails it as "expected to
 * fail", and the entry comes out. */
const KNOWN: Record<string, string> = {
  // 1.8: during the exchange at 360 px or less, the controls cover the hand.
  'preview-exchange@320x568': 'FIXES.md 1.8: exchange controls cover hand cards at <=360px',
  // 1.8: on short phones the controls and tool buttons sit over the seats.
  'preview-bidding@320x568': 'FIXES.md 1.8: bid buttons cover the side seats on 320x568',
  'preview-misdeal@320x568': 'FIXES.md 1.8: bid buttons cover the side seats on 320x568',
  'preview-friend@320x568': 'FIXES.md 1.8: friend picker covers the side seats on 320x568',
  'preview-bidding@375x667': 'FIXES.md 1.8: tool buttons (hint, reactions) cover a seat name',
  'preview-misdeal@375x667': 'FIXES.md 1.8: tool buttons (hint, reactions) cover a seat name',
  'preview-friend@375x667': 'FIXES.md 1.8: tool buttons (hint, reactions) cover a seat name',
  // 1.8: the replay sheet does not shrink long names, so it scrolls sideways.
  'replay@320x568': 'FIXES.md 1.8: replay sheet scrolls sideways on long names',
  'replay@375x667': 'FIXES.md 1.8: replay sheet scrolls sideways on long names',
  'replay@390x844': 'FIXES.md 1.8: replay sheet scrolls sideways on long names',
};

/** The project's size, as named in playwright.config.ts. */
function sizeOf(project: string): string {
  return project.split('-')[0];
}

async function settle(page: Page, name: string) {
  // The previews swap in their real state after 300 ms (exchange, misdeal,
  // sweep); give that and the deal time to land.
  if (name.startsWith('preview-')) {
    await page.locator('.hand').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(900);
  } else {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => document.fonts.ready);
}

/** Labels at the seats, with whatever covers each one's centre. */
function coveredLabels(page: Page) {
  return page.evaluate(() => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => !c.startsWith('svelte-')).join('.')} "${(el.textContent ?? '').trim().slice(0, 20)}"`;
    // Things drawn over a seat that do not take taps (reaction bubbles, the
    // points that float up) still hide it: count them as covering too.
    const style = document.createElement('style');
    style.textContent = '.seat .name, .seat .team, .seat .reaction, .seat .bubble, .seat .gain, .card { pointer-events: auto !important; }';
    document.head.append(style);
    // The topmost element at a point that is actually drawn: one faded out
    // to nothing (a reaction bubble after its animation) does not cover.
    // The result is a sheet over the table, meant to hide part of it.
    const topVisible = (x: number, y: number) =>
      document.elementsFromPoint(x, y).find((e) => {
        if (e.closest('.result-layer')) return false;
        for (let a: Element | null = e; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.opacity === '0' || cs.visibility === 'hidden') return false;
        }
        return true;
      }) ?? null;
    const out: string[] = [];
    try {
      for (const el of document.querySelectorAll('.seat .name, .seat .team')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
        let x = r.left + r.width / 2;
        let y = r.top + r.height / 2;
        if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          const s = el.getBoundingClientRect();
          x = s.left + s.width / 2;
          y = s.top + s.height / 2;
        }
        const hit = topVisible(x, y);
        if (!hit) out.push(`${describe(el)}: off screen`);
        else if (hit !== el && !el.contains(hit)) out.push(`${describe(el)} under ${describe(hit)}`);
      }
    } finally {
      style.remove();
      scrollTo(0, 0);
    }
    return out;
  });
}

/** Hand cards whose top corner index is hidden or taps something else. */
function hiddenCorners(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const cards = [...document.querySelectorAll('.hand .card')];
    for (const card of cards) {
      const corner = card.querySelector('.corner.top');
      const label = card.getAttribute('aria-label') ?? card.getAttribute('data-card') ?? '?';
      if (!corner) {
        out.push(`${label}: no corner`);
        continue;
      }
      let r = corner.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) {
        corner.scrollIntoView({ block: 'center', behavior: 'instant' });
        r = corner.getBoundingClientRect();
      }
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (r.width === 0 || r.height === 0) out.push(`${label}: corner has no size`);
      else if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) out.push(`${label}: corner off screen`);
      else if (!hit || hit.closest('.card') !== card) {
        const by = hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].filter((c) => !c.startsWith('svelte-')).join('.')}` : 'nothing';
        out.push(`${label}: corner under ${by}`);
      }
    }
    scrollTo(0, 0);
    return out;
  });
}

for (const { name, path } of PAGES) {
  test(name, async ({ page }, info) => {
    const known = KNOWN[`${name}@${sizeOf(info.project.name)}`];
    test.fail(!!known, known);

    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // The not-found page is served with status 404 on purpose.
      if (name === '404' && /status of 404/.test(m.text())) return;
      errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    // Quiet, still: the table's sounds and the deal animation.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mighty.settings', JSON.stringify({ sound: false, music: false, speed: 'off' }));
      } catch {
        // Storage off: the defaults play, which is fine.
      }
    });

    await page.goto(path);
    await settle(page, name);

    const problems: string[] = [];
    if (name.startsWith('preview-')) {
      // The checks below must have something to check.
      expect(await page.locator('.seat .name').count()).toBeGreaterThanOrEqual(5);
      if (!['preview-done', 'preview-won', 'preview-run'].includes(name)) {
        expect(await page.locator('.hand .card').count()).toBeGreaterThanOrEqual(10);
      }
    }
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    if (overflow > 0) problems.push(`scrolls sideways by ${overflow}px`);
    for (const p of await coveredLabels(page)) problems.push(`seat label covered: ${p}`);
    for (const p of await hiddenCorners(page)) problems.push(`hand card: ${p}`);
    for (const e of errors) problems.push(`console error: ${e}`);
    expect(problems).toEqual([]);
  });
}

// The hand's replay, from the result: both tabs fit the screen's width.
test('replay', async ({ page }, info) => {
  const known = KNOWN[`replay@${sizeOf(info.project.name)}`];
  test.fail(!!known, known);
  await page.goto('/preview?state=done');
  await page.getByRole('button', { name: '다시 보기' }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  const problems: string[] = [];
  for (const tab of ['라운드별', '각자 패']) {
    await dialog.getByRole('radio', { name: tab }).click();
    await page.waitForTimeout(100);
    const over = await dialog.evaluate((d) => {
      const out: string[] = [];
      const box = d.getBoundingClientRect();
      if (box.right > innerWidth + 0.5 || box.left < -0.5) out.push(`sheet is ${Math.round(box.width)}px wide`);
      // Anything wider than its box shows as a sideways scroll somewhere.
      for (const el of [d, ...d.querySelectorAll('*')]) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') {
          const name = `${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => !c.startsWith('svelte-')).join('.')}`;
          out.push(`${name} scrolls sideways by ${el.scrollWidth - el.clientWidth}px`);
        }
      }
      return out;
    });
    for (const o of over) problems.push(`${tab}: ${o}`);
  }
  expect(problems).toEqual([]);
});
