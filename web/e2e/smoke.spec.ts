import { expect, test, type Page } from '@playwright/test';

// Every page and every /preview state (TablePreview.svelte), at the four
// sizes and both themes of playwright.config.ts. Each must:
// - not scroll sideways;
// - leave every seat's name and badge uncovered;
// - show every hand card's corner index, and hit that card when tapped there;
// - log no console errors.

/** Previews that open a seat's popover: a bot's, another player's (and
 * sending them to watch), your own, an empty seat's, and a watcher's name
 * entry at an empty seat and at a bot's. */
const POPOVERS = ['seatbot', 'seatperson', 'seatkick', 'seatme', 'seatempty', 'seatsit', 'seatsitbot'];

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
  // Between hands (Room.svelte's own bar and menu over the table).
  'timer',
  'lobby',
  'lobbywatch',
  'room',
  'pending',
  'folded',
  ...POPOVERS,
  'swap',
  'menu',
  'leave',
];

/** States with no cards in hand: the result, and the table between hands. */
const NO_HAND = ['done', 'won', 'run', 'lobby', 'lobbywatch', 'room', 'pending', 'folded', ...POPOVERS, 'swap', 'menu'];

const PAGES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'rules-gshs', path: '/rules/gshs' },
  { name: 'about', path: '/about' },
  { name: 'privacy', path: '/privacy' },
  { name: '404', path: '/no-such-page' },
  ...STATES.map((s) => ({ name: `preview-${s}`, path: `/preview?state=${s}` })),
];

/** Known layout bugs, marked expected-fail so CI stays green while one
 * waits for its fix. A key is `<test>@<size>` (both themes). When a fix
 * lands the test passes, Playwright fails it as "expected to fail", and
 * the entry comes out. FIXES.md 1.8's (the exchange at 360px or less,
 * controls and tools over the seats on short phones, the replay's long
 * names) are fixed; none is known now. */
const KNOWN: Record<string, string> = {};

/** The project's size, as named in playwright.config.ts. */
function sizeOf(project: string): string {
  return project.split('-')[0];
}

async function settle(page: Page, name: string) {
  // A preview marks the page once its scripted steps, the deal and any
  // moves have played out (TablePreview.svelte, `ready`).
  if (name.startsWith('preview-')) {
    await page.locator('html[data-ready]').waitFor({ state: 'attached' });
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
    // The result is a sheet over the table, meant to hide part of it; so
    // are a seat's popover (and the tap-away layer under it) and the menu.
    const topVisible = (x: number, y: number) =>
      document.elementsFromPoint(x, y).find((e) => {
        if (e.closest('.result-layer, .pop-card, .scrim, dialog[open]')) return false;
        for (let a: Element | null = e; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.opacity === '0' || cs.visibility === 'hidden') return false;
        }
        return true;
      }) ?? null;
    const out: string[] = [];
    // A sheet open over the table (the menu) is meant to cover all of it.
    if (document.querySelector('dialog[open]')) {
      style.remove();
      return out;
    }
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
        // Between hands each seat is one transparent button over itself.
        else if (hit.matches('.seat-tap') && hit.parentElement?.contains(el)) continue;
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
    // Under an open sheet (the menu) the hand is meant to be covered.
    if (document.querySelector('dialog[open]')) return out;
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
      if (!NO_HAND.includes(name.slice('preview-'.length))) {
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

// The result rises from the table's foot and stops under the top seats:
// they stay in view above it (the side seats it covers whole).
for (const state of ['done', 'won', 'run']) {
  test(`result-clear-${state}`, async ({ page }) => {
    await page.goto(`/preview?state=${state}`);
    await page.locator('html[data-ready]').waitFor({ state: 'attached' });
    const covered = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('.spot.top-left .seat .name, .spot.top-right .seat .name')) {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit?.closest('.result-layer')) out.push(`${(el.textContent ?? '').trim()} under the result`);
      }
      return out;
    });
    expect(covered).toEqual([]);
  });
}

// The table from the home page: the back gesture opens the menu instead of
// leaving, and 나가기 goes home with no table entry left behind.
test('back stays at the table; 나가기 leaves', async ({ page }, info) => {
  test.skip(sizeOf(info.project.name) !== '390x844', 'one size is enough');
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const table = page.url();
  await page.locator('.seat-act', { hasText: '앉기' }).first().click();
  await page.locator('.pop-card input').fill('테스트');
  await page.locator('.pop-card button[type=submit]').click();
  await expect(page.locator('.seat-act', { hasText: '+ 봇' }).first()).toBeVisible();

  await page.goBack();
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect(page.url()).toBe(table);
  // Back again closes the menu, still at the table.
  await page.goBack();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(page.url()).toBe(table);

  await page.locator('.menu-btn').click();
  await page.locator('dialog .leave').click();
  await page.waitForURL((url) => url.pathname === '/');
  expect(await page.evaluate(() => history.state)).toBeNull();
  await expect(page.getByRole('button', { name: '테이블 만들기' })).toBeVisible();
});

/** What of the seat's popover is not wholly on screen (inside `view`, the
 * visible part of the page) or sticks out of the card itself. */
function popoverOverflow(page: Page, view?: { top: number; height: number }) {
  return page.evaluate((view) => {
    const card = document.querySelector('.pop-card');
    if (!card) return ['no popover'];
    const out: string[] = [];
    const top = view?.top ?? 0;
    const bottom = top + (view?.height ?? innerHeight);
    const c = card.getBoundingClientRect();
    const off = (r: DOMRect) => r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < top - 0.5 || r.bottom > bottom + 0.5;
    const fmt = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    if (getComputedStyle(card).visibility !== 'visible') out.push('card is hidden');
    if (off(c)) out.push(`card off screen at ${fmt(c)} in ${innerWidth}x${innerHeight}`);
    // Every control: inside the card, so on screen too (a card too tall
    // scrolls inside, so only its width counts there).
    for (const el of card.querySelectorAll('button, input')) {
      const r = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}"`;
      if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.push(`${name} sticks out of the card: ${fmt(r)} in ${fmt(c)}`);
    }
    return out;
  }, view);
}

// Every seat's popover fits the screen at every size: none of it off the
// edge, and nothing in it wider than the card (on CI's fonts the name field
// once pushed 앉기 off the card and off the screen).
for (const state of POPOVERS) {
  test(`popover-${state}`, async ({ page }) => {
    await page.goto(`/preview?state=${state}`);
    await page.locator('html[data-ready]').waitFor({ state: 'attached' });
    await page.locator('.pop-card').waitFor();
    expect(await popoverOverflow(page)).toEqual([]);
    // Playwright itself can reach every control in it.
    for (const control of await page.locator('.pop-card button:not([disabled]), .pop-card input').all()) {
      await control.click({ trial: true, timeout: 2000 });
    }
  });
}

// A phone's keyboard covers the bottom of the screen while a watcher types
// a name: the popover moves up into what is left, 앉기 still in reach.
test('popover stays above the keyboard', async ({ page }, info) => {
  test.skip(sizeOf(info.project.name) === '1440x900', 'phones only');
  // A stand-in visual viewport the test can shrink, as a keyboard does.
  await page.addInitScript(() => {
    const target = new EventTarget();
    const vv = Object.assign(target, { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
    (window as unknown as { keyboard: (h: number) => void }).keyboard = (h: number) => {
      vv.height = innerHeight - h;
      vv.dispatchEvent(new Event('resize'));
    };
  });
  await page.goto('/preview?state=seatsit');
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
  await page.locator('.pop-card input').waitFor();
  const { height } = page.viewportSize()!;
  const keyboard = Math.round(height * 0.45);
  await page.evaluate((h) => (window as unknown as { keyboard: (h: number) => void }).keyboard(h), keyboard);
  await page.waitForTimeout(100);
  expect(await popoverOverflow(page, { top: 0, height: height - keyboard })).toEqual([]);
  await page.locator('.pop-card input').fill('테스트');
  const submit = await page.locator('.pop-card button[type=submit]').boundingBox();
  expect(submit && submit.y + submit.height).toBeLessThanOrEqual(height - keyboard);
});

// Two tabs at one table: 섞기 marks the next hand for everyone, 시작
// shuffles the seats, and every name (bots' too) moves with its seat.
test('섞기 waits for the next hand and names follow their seats', async ({ browser, page }, info) => {
  test.skip(sizeOf(info.project.name) !== '390x844', 'one size is enough');
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ sound: false, music: false, speed: 'off' })));
  await page.goto('/');
  await page.getByRole('button', { name: '테이블 만들기' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.locator('.seat-act', { hasText: '앉기' }).first().click();
  await page.locator('.pop-card input').fill('나');
  await page.locator('.pop-card button[type=submit]').click();
  for (let i = 0; i < 4; i++) {
    await page.locator('.seat-act', { hasText: '+ 봇' }).first().click();
    await expect(page.locator('.seat-act', { hasText: '+ 봇' })).toHaveCount(3 - i);
  }
  // Everyone at the table, by name, from this tab's seat round.
  const names = () => page.locator('.ring .spot .seat .name').allTextContents();
  const before = await names();
  expect(new Set(before).size).toBe(4);

  const watcher = await browser.newPage();
  await watcher.goto(page.url());
  await page.getByRole('button', { name: /^섞기/ }).click();
  await expect(page.getByRole('button', { name: /섞기 취소/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(watcher.locator('.shuffle-note', { hasText: '다음 판 시작할 때 자리를 섞어요' })).toBeVisible();
  expect(await names()).toEqual(before);
  // Pressed again it is off, and on once more.
  await page.getByRole('button', { name: /섞기 취소/ }).click();
  await expect(watcher.locator('.shuffle-note')).toHaveCount(0);
  await page.getByRole('button', { name: /^섞기/ }).click();
  await expect(page.locator('.shuffle-note', { hasText: '다음 판 시작할 때 자리를 섞어요' })).toBeVisible();

  const watcherNames = await watcher.locator('.ring .spot .seat .name').allTextContents();
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.locator('.shuffle-note')).toHaveCount(0);
  await expect(page.locator('.hand .card').first()).toBeVisible();
  // The same four, bots keeping their names, and the watcher's table agrees.
  const after = await names();
  expect([...after].sort()).toEqual([...before].sort());
  const watcherAfter = await watcher.locator('.ring .spot .seat .name').allTextContents();
  expect([...watcherAfter].sort()).toEqual([...watcherNames].sort());
  expect(watcherAfter).toContain('나');
  await watcher.close();
});
