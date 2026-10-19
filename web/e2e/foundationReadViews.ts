import {expect,type Browser,type Page} from '@playwright/test';
import {COMPLETION_STORAGE_KEY} from '../src/lib/games/mighty/completionStore';

/** Run after two actual hands and a score reset: archived hand 2 must remain
 * readable, independently of the current period and game command authority. */
export async function auditMightyReadViews(page:Page,browser:Browser,id:string,commands:()=>{game:number;room:number}){
 const beforeCommands=commands(),beforeRecords=await page.evaluate(key=>localStorage.getItem(key),COMPLETION_STORAGE_KEY);
 await page.evaluate(key=>{
  const scope=window as typeof window&{readViewWrites:number};scope.readViewWrites=0;
  const write=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===key)scope.readViewWrites++;return write.call(this,name,value);};
 },COMPLETION_STORAGE_KEY);
 const ready=()=>expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
 const dialog=()=>page.getByRole('dialog');
 const open=async(name:string)=>{await page.getByRole('button',{name:'메뉴',exact:true}).click();await dialog().getByRole('button',{name,exact:true}).click({timeout:5000});await expect(dialog()).toHaveCount(1);await expect(dialog()).toHaveAttribute('data-foundation-node',/^\["disclosure-dialog",/);await ready();};
 const section=async(name:string)=>{await dialog().getByRole('tab',{name,exact:true}).click();await expect(dialog().getByRole('tabpanel',{name,exact:true})).toBeVisible();await expect(dialog().getByRole('tab',{name,exact:true})).toHaveAttribute('aria-selected','true');await ready();};
 // Both new reads begin while this authenticated public checkpoint is fresh,
 // although live State/Game admission is deliberately withheld.
 await open('내 기록');await expect(dialog()).toHaveAccessibleName('내 기록');
 await expect(dialog().getByRole('tabpanel',{name:'내 기록',exact:true})).toContainText('플레이한 판');
 await section('최근 판');await expect(dialog().getByRole('tabpanel')).toContainText(/승리|패배/);
 await section('업적');await expect(dialog().getByRole('tabpanel')).toContainText('첫 승리');
 await dialog().getByRole('button',{name:'닫기',exact:true}).click();await expect(dialog()).toHaveCount(0);
 await open('지난 판 기록');await expect(dialog()).toContainText('1번째 기록');
 await dialog().getByRole('button',{name:'2판 기록',exact:true}).click();await ready();
 await expect(dialog().getByRole('tabpanel',{name:'라운드별',exact:true})).toBeVisible();
 await expect(dialog().locator('[data-foundation-kind="card"]')).toHaveCount(5);
 await expect(dialog().locator('button[data-foundation-kind="card"]')).toHaveCount(0);
 await dialog().getByRole('button',{name:'다음 라운드',exact:true}).click();await ready();
 await expect(dialog().getByRole('button',{name:'이전 라운드',exact:true})).toBeEnabled();
 await section('전체 라운드');
 await expect(dialog().getByRole('table',{name:'전체 라운드',exact:true})).toBeVisible();
 await expect(dialog().getByRole('rowheader')).toHaveCount(5);
 await expect(dialog().getByRole('rowheader',{name:'나',exact:true})).toBeVisible();
 const columns=await dialog().getByRole('columnheader').count();expect(columns).toBeGreaterThan(1);expect(columns).toBeLessThan(12);
 await dialog().getByRole('button',{name:'다음 열',exact:true}).click();await ready();
 await expect(dialog().getByRole('button',{name:'이전 열',exact:true})).toBeEnabled();
 await page.screenshot({path:'/tmp/foundation-history-phone.png',fullPage:true});
 await dialog().evaluate(element=>{(window as typeof window&{readViewDialog:Element}).readViewDialog=element;});
 await page.setViewportSize({width:768,height:1024});await ready();
 expect(await dialog().evaluate(element=>(window as typeof window&{readViewDialog:Element}).readViewDialog===element)).toBe(true);
 await expect(dialog().getByRole('tabpanel',{name:'전체 라운드',exact:true})).toBeVisible();
 // An unrelated participant publication must retain the frozen public record
 // and native modal, rather than rebinding it to the new Room proxy.
 const observerContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 try{
  await observerContext.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('읽기 검증 관전자'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
  const observer=await observerContext.newPage();await observer.goto(`${new URL(page.url()).origin}/r/${id}?foundation=1`);await expect(observer.getByRole('group',{name:'이번 판 결과',exact:true})).toHaveCount(1);
  await expect(dialog().getByRole('tabpanel',{name:'전체 라운드',exact:true})).toBeVisible();
  expect(await dialog().evaluate(element=>(window as typeof window&{readViewDialog:Element}).readViewDialog===element)).toBe(true);
 }finally{await observerContext.close();}
 await section('점수·교환');await expect(dialog().getByRole('tabpanel')).toContainText('공약');
 await section('가져온 점수 카드');await expect(dialog().getByRole('tabpanel')).toContainText('점수 카드');
 await section('버린 카드');await expect(dialog().getByRole('tabpanel')).toContainText(/공개|버린/);
 await page.screenshot({path:'/tmp/foundation-history-tablet.png',fullPage:true});
 await dialog().getByRole('button',{name:'닫기',exact:true}).click();await expect(dialog()).toHaveCount(0);
 // Presence advanced Room while State remained withheld. The retained public
 // record was readable, but its stale checkpoint must grant no NEW reads.
 await page.getByRole('button',{name:'메뉴',exact:true}).click();
 await expect(dialog().getByRole('button',{name:'내 기록',exact:true})).toHaveCount(0);
 await expect(dialog().getByRole('button',{name:'지난 판 기록',exact:true})).toHaveCount(0);
 await dialog().getByRole('button',{name:'닫기',exact:true}).click();await expect(dialog()).toHaveCount(0);
 expect(commands()).toEqual(beforeCommands);
 expect(await page.evaluate(key=>localStorage.getItem(key),COMPLETION_STORAGE_KEY)).toBe(beforeRecords);
 expect(await page.evaluate(()=>(window as typeof window&{readViewWrites:number}).readViewWrites)).toBe(0);
}
