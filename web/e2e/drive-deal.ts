import {expect,type Page} from '@playwright/test';

/** Quick bots can request Deal Miss in the first-bid window. A retry requires
 * a provably new hand, so an inert button or unchanged game remains a failure. */
export async function bidMaximum(page:Page) {
  const cards=()=>page.locator('.hand .card').evaluateAll(nodes=>nodes.map(e=>e.getAttribute('data-card')).sort());
  for(let attempt=0;attempt<3;attempt++) {
    // A replacement deal can rotate the first bidder. Wait for the human's
    // turn through the bot bids and the deal-miss reveal animation.
    await expect(page.locator('.bid .primary')).toBeEnabled({timeout:15_000});
    const before=await cards();
    await page.getByRole('radio',{name:'노기루다',exact:true}).click();
    await page.getByRole('radio',{name:'20',exact:true}).click();
    await expect(page.locator('.bid .primary')).toContainText('20');
    await expect(page.getByRole('radio',{name:'노기루다',exact:true})).toBeChecked();
    await page.locator('.bid .primary').click();
    try { await expect(page.locator('.hand .card')).toHaveCount(13); return; }
    catch(error) {
      if(attempt===2) throw error;
      expect(await cards(),'Only a replacement deal permits selecting a bid again').not.toEqual(before);
    }
  }
}
