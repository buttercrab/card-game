import {expect,test} from '@playwright/test';
test('foundation capacity entry keeps native refusal explicit and never opens or retries a game socket',async({page},info)=>{
 test.skip(info.project.name!=='390x844-light','one metadata boundary');
 const id='capacity',key=`card.commands.v1:${id}`,records=JSON.stringify([{operation_id:'1:pending',sequence:1,expected:{domain:'game',room_id:id,room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'}}]);
 await page.addInitScript(({key,records})=>sessionStorage.setItem(key,records),{key,records});
 let requests=0,sockets=0;page.on('websocket',()=>sockets++);
 await page.route(`**/api/rooms/${id}`,route=>{requests++;return route.fulfill({status:507,json:{code:'resource_capacity',reason:{code:'capacity',resource:'session',limit:4194304}}});});
 await page.goto(`/r/${id}?foundation=1`);await expect(page.getByRole('status')).toContainText('지원 범위를 넘어 다시 열 수 없어요');await expect(page.getByRole('button',{name:'다시 확인',exact:true})).toBeVisible();
 expect(sockets).toBe(0);expect(requests).toBe(1);expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(records);
 await page.getByRole('button',{name:'다시 확인',exact:true}).click();await expect(page.getByRole('status')).toContainText('지원 범위를 넘어 다시 열 수 없어요');expect(requests).toBe(2);expect(sockets).toBe(0);
 await page.route(`**/api/rooms/${id}`,route=>route.fulfill({status:507,json:{code:'resource_capacity',reason:{code:'capacity'}}}));await page.reload();await expect(page.getByRole('status')).toHaveText('테이블 정보를 불러오지 못했어요.');await expect(page.getByRole('button',{name:'다시 확인',exact:true})).toHaveCount(0);
});
test('foundation entry rejects missing and unsupported rooms before opening a game socket',async({page},info)=>{
 test.skip(info.project.name!=='390x844-light','one metadata boundary');
 let sockets=0;page.on('websocket',()=>sockets++);
 await page.route('**/api/rooms/unknown',route=>route.fulfill({status:404,body:''}));
 await page.goto('/r/unknown?foundation=1');await expect(page.getByRole('status')).toHaveText('테이블을 찾을 수 없어요.');
 await page.route('**/api/rooms/unknown',route=>route.fulfill({status:200,json:{id:'unknown',game:'unsupported'}}));
 await page.reload();await expect(page.getByRole('status')).toHaveText('이 게임을 표시할 수 없어요.');expect(sockets).toBe(0);
});
test('legacy root displays native capacity before it has a Room packet',async({page},info)=>{
 test.skip(info.project.name!=='390x844-light','one compatibility boundary');
 await page.route('**/api/rooms/capacity',route=>route.fulfill({status:507,json:{code:'resource_capacity',reason:{code:'unreservable_legacy'}}}));
 await page.goto('/r/capacity');await expect(page.getByRole('status').filter({hasText:'지원 범위를 넘어 다시 열 수 없어요'})).toBeVisible();await expect(page.getByRole('button',{name:'다시 확인',exact:true})).toBeVisible();
 await expect(page.getByText('연결하는 중…',{exact:true})).toHaveCount(0);
});
