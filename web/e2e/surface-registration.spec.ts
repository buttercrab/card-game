import { expect, test } from '@playwright/test';

test('live primitive registration survives metadata and renderer changes and releases modal roots',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-light','one lifecycle regression, not another viewport matrix');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('mighty.settings',JSON.stringify({speed:'off',sound:false,music:false})));
  await page.goto('/preview?state=exchange&room&renderer=dom');
  const card=page.locator('.hand button.card:not(.unplayable)').last();
  await expect(card).toHaveAttribute('data-surface-kind','card');
  const id=await card.getAttribute('data-surface-id');
  const roots=await page.locator('[data-surface-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-surface-id')));
  expect(new Set(roots).size).toBe(roots.length);
  for(const mode of ['dom','canvas','dom','canvas']) {
    await page.locator('[data-renderer]').evaluateAll((nodes,value)=>nodes.forEach(node=>node.setAttribute('data-renderer',value)),mode);
    if(mode==='canvas') await expect.poll(()=>page.locator('[data-live-canvas]').count()).toBeGreaterThan(0);
    else await expect(page.locator('[data-live-canvas]')).toHaveCount(0);
    await card.click();
    await expect(card).toHaveClass(/picked/);
    await expect(card).toHaveAttribute('data-surface-id',id!);
    await card.click();
    await expect(card).not.toHaveClass(/picked/);
    await expect(card).toHaveAttribute('data-surface-id',id!);
    expect(await page.locator('[data-surface-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-surface-id')))).toEqual(roots);
    expect(errors).toEqual([]);
  }
  await page.goto('/preview?state=friend&room&renderer=canvas');
  await page.getByRole('button',{name:'다른 카드…',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'프렌드 카드 선택',exact:true});
  await expect(picker.locator('[data-surface-kind="card"]').first()).toBeAttached();
  const removed=await picker.locator('[data-surface-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-surface-id')));
  await picker.getByRole('button',{name:'취소',exact:true}).click();
  await expect(picker).toHaveCount(0);
  expect(await page.locator('[data-surface-id]').evaluateAll((nodes,ids)=>nodes.some(node=>ids.includes(node.getAttribute('data-surface-id'))),removed)).toBe(false);
  await expect.poll(()=>page.locator('[data-live-canvas]').evaluateAll((nodes,ids)=>nodes.some(node=>ids.includes(node.getAttribute('data-live-canvas'))),removed)).toBe(false);
  expect(errors).toEqual([]);
});
