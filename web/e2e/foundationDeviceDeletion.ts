import {expect,type Page} from '@playwright/test';
import {COMPLETION_STORAGE_KEY} from '../src/lib/games/mighty/completionStore';
export async function openDeviceRecords(page:Page){
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'내 기록',exact:true}).click();
 const viewer=page.getByRole('dialog',{name:'내 기록',exact:true});await expect(viewer).toBeVisible();await expect(viewer.getByRole('button',{name:'플레이 기록 삭제',exact:true})).toBeEnabled();return viewer;
}
export async function openDeviceDeletion(page:Page){
 await page.getByRole('dialog',{name:'내 기록',exact:true}).getByRole('button',{name:'플레이 기록 삭제',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'이 기기의 플레이 기록을 삭제할까요?',exact:true});await expect(confirmation).toBeVisible();await expect(confirmation.locator('input,select,textarea')).toHaveCount(0);return confirmation;
}
/** Actual result checkpoint, with all live State held by the lifecycle driver.
 * Deletion must remain local and dedup must survive a second held reload. */
export async function auditMightyDeviceDeletion(page:Page,commands:()=>unknown){
 await page.evaluate(()=>sessionStorage.setItem('foundation.audit.hold-state','1'));await page.reload();
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{heldFoundationStates:number}).heldFoundationStates)).toBeGreaterThan(0);
 await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeDisabled();
 const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY);expect(before.hands.length).toBeGreaterThan(0);const commandBaseline=commands();
 await openDeviceRecords(page);let confirmation=await openDeviceDeletion(page);await confirmation.getByRole('button',{name:'취소',exact:true}).click();await expect(page.getByRole('dialog',{name:'내 기록',exact:true})).toBeVisible();
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY)).toEqual(before);
 confirmation=await openDeviceDeletion(page);await confirmation.getByRole('button',{name:'기록 삭제',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
 const viewer=page.getByRole('dialog',{name:'내 기록',exact:true});await expect(viewer).toBeVisible();await expect(viewer.getByText('아직 끝낸 판이 없어요. 한 판 하고 오세요!',{exact:true})).toBeVisible();
 const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY);expect(after.hands).toEqual([]);expect(after.completed).toEqual(before.completed);expect(after.unlocked).toEqual(before.unlocked);expect(commands()).toEqual(commandBaseline);
 await viewer.getByRole('button',{name:'닫기',exact:true}).click();await page.reload();await expect(page.getByRole('group',{name:'이번 판 결과',exact:true})).toBeVisible();
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY)).toEqual(after);
 await openDeviceRecords(page);await expect(page.getByRole('dialog',{name:'내 기록',exact:true}).getByText('아직 끝낸 판이 없어요. 한 판 하고 오세요!',{exact:true})).toBeVisible();expect(commands()).toEqual(commandBaseline);
 await page.getByRole('dialog',{name:'내 기록',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();await page.evaluate(()=>(window as typeof window&{releaseFoundationStates:()=>void}).releaseFoundationStates());await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeEnabled();
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COMPLETION_STORAGE_KEY)).toEqual(after);
}
