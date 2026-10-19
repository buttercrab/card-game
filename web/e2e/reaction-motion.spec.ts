import { expect, test } from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

for (const level of ['full', 'reduced', 'off'] as const) {
  test(`reaction entrance respects ${level} motion and repeats without moving its dock`, async ({ page }, info) => {
    test.skip(info.project.name !== '390x844-light', 'one compact motion timeline');
    await page.emulateMedia({ reducedMotion: level === 'reduced' ? 'reduce' : 'no-preference' });
    await page.addInitScript((speed) => {
      localStorage.setItem('name', JSON.stringify('나'));
      localStorage.setItem('mighty.settings', JSON.stringify({ speed, sound: false, music: false }));
    }, level === 'off' ? 'off' : 'normal');
    await page.goto('/preview?state=play&room');
    await expect(page.locator('html')).toHaveAttribute('data-motion', level);
    const dock = page.locator('.tray .me-seat .feedback');
    const before = await dock.boundingBox();
    const identity=page.locator('.tray .me-seat .identity');const name=identity.locator('.name');const avatar=identity.locator('svg.figure');const identityBefore=await identity.boundingBox(),nameBefore=await name.boundingBox(),avatarBefore=await avatar.boundingBox();
    await page.keyboard.press('r');
    await page.keyboard.press('Enter');
    const bubble = dock.locator('[data-reaction-anchor] > [data-kind="reaction"]');
    await expect(bubble).toHaveText('👏');
    const entrance = await bubble.evaluate(el => ({
      name: getComputedStyle(el).animationName,
      frames: el.getAnimations().flatMap(a => (a.effect as KeyframeEffect).getKeyframes()).map(f => f.transform),
    }));
    if (level === 'full') {
      expect(entrance.name).toContain('reaction-in');
      expect(entrance.frames.some(frame => String(frame).includes('scale(0.92)'))).toBe(true);
    } else if (level === 'reduced') {
      expect(entrance.name).toContain('feedback-in');
      expect(entrance.frames.every(f => !f || f === 'none')).toBe(true);
    } else {
      expect(entrance.name).toBe('none');
      expect(entrance.frames).toEqual([]);
    }
    await bubble.evaluate(el => el.setAttribute('data-repeat-probe', 'first'));
    await page.keyboard.press('r');
    await page.keyboard.press('Enter');
    await expect(bubble).not.toHaveAttribute('data-repeat-probe', 'first');
    await expect(bubble).toHaveText('👏');
    expect(await dock.boundingBox()).toEqual(before);expect(await identity.boundingBox()).toEqual(identityBefore);expect(await name.boundingBox()).toEqual(nameBefore);expect(await avatar.boundingBox()).toEqual(avatarBefore);
    const bounds=(await bubble.boundingBox())!,viewport=page.viewportSize()!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);
  });
}

test('a bid stays visible while its reaction floats within a bounded player anchor', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({ speed: 'off', sound: false, music: false })));
  await page.goto('/preview?state=bidding&room');
  await page.locator('html[data-ready]').waitFor();
  const dock = page.locator('.feedback').filter({ has: page.locator('[data-kind="bid"]', { hasText: '15' }) });
  await expect(dock.locator('[data-kind="bid"]')).toContainText('15');
  await expect(dock.locator('[data-kind="reaction"]')).toHaveText('나이스');
  const identity=page.locator('.seat').filter({has:page.locator('[data-kind="bid"]',{hasText:'15'})}).locator('.identity');
  const bid=dock.locator('[data-kind="bid"]');const before=await bid.boundingBox();
  const bubble=dock.locator('[data-reaction-anchor] > [data-kind="reaction"]');await expect(bubble).toBeVisible();
  const box=(await bubble.boundingBox())!;const viewport=page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
  expect(await bid.boundingBox()).toEqual(before);await expect(identity).toBeVisible();

});

for(const view of [{project:'390x844-light',width:390,height:844},{project:'320x568-light',width:320,height:568},{project:'390x844-light',width:568,height:320}])test(`real observer reactions reach the participant in a clear bounded rail at${view.width}x${view.height}`,async({page,browser},info)=>{
  test.skip(info.project.name!==view.project,'actual two-context observer broadcast');test.setTimeout(60_000);await page.setViewportSize({width:view.width,height:view.height});
  await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('반응 받는 사람'));localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false}));});await page.goto('/');await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();await page.waitForURL(/\/r\/[a-z0-9]+$/);await page.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();for(let i=0;i<4;i++)await page.locator('.seat-act',{hasText:'봇 추가'}).first().click();await page.getByRole('button',{name:'시작',exact:true}).click();await expect(page.locator('.hand .card')).toHaveCount(10);
  const observer=await browser.newPage({viewport:{width:view.width,height:view.height}});try{
    await observer.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('관전자'));localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false}));});await observer.goto(page.url());await expect(observer.locator('.hand .card')).toHaveCount(0);await expect(observer.getByRole('button',{name:'다음 판 참여',exact:true})).toBeVisible();
    const poses=()=>page.locator('.me-seat .identity,.me-seat .name,.ring > .spot .identity').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};}));await page.evaluate(()=>document.fonts.ready);const before=await poses();
    for(const text of ['👏','천천히 해요']){if(text!=='👏')await observer.waitForTimeout(750); // Server permits one reaction about every 0.7s.
      await observer.keyboard.press('r');await observer.getByRole('menuitem',{name:text,exact:true}).click();const bubble=page.locator('.observer-feedback [data-kind="reaction"]');await expect(bubble).toHaveText(text);await expect(bubble).toBeVisible();
      const geometry=await bubble.evaluate(element=>{const b=element.getBoundingClientRect(),obstacles=[...document.querySelectorAll('.hand .card,.seat .name,.turn-line')].filter(node=>{const r=node.getBoundingClientRect(),css=getComputedStyle(node);return r.width>0&&r.height>0&&css.display!=='none'&&css.visibility!=='hidden';}).map(node=>{const r=node.getBoundingClientRect();return{class:node.getAttribute('class'),text:node.classList.contains('name')?node.textContent:null,area:Math.max(0,Math.min(b.right,r.right)-Math.max(b.left,r.left))*Math.max(0,Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top))};});return{box:{x:b.x,y:b.y,width:b.width,height:b.height},obstacles};});
      await mkdir(info.outputPath(),{recursive:true});await writeFile(info.outputPath(`observer-reaction-${text==='👏'?'emoji':'phrase'}.json`),JSON.stringify({geometry,before,after:await poses()},null,2));
      expect(geometry.box.x).toBeGreaterThanOrEqual(0);expect(geometry.box.y).toBeGreaterThanOrEqual(0);expect(geometry.box.x+geometry.box.width).toBeLessThanOrEqual(view.width+1);expect(geometry.box.y+geometry.box.height).toBeLessThanOrEqual(view.height+1);for(const obstacle of geometry.obstacles)expect(obstacle.area,`observer bubble overlaps ${obstacle.class} ${obstacle.text??''}`).toBe(0);expect(await poses()).toEqual(before);
    }
  }finally{await observer.close();}
});
