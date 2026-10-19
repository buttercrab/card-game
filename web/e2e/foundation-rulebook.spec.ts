import {expect,test,type Page} from '@playwright/test';
import {joinFoundation} from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`});
const endpoint='/api/games/mighty/rules/examples';
async function install(page:Page,textScale=1){await page.addInitScript(textScale=>{
 localStorage.setItem('name',JSON.stringify('규칙 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off',textScale}));
 const scope=window as typeof window&{bookProbe:{sent:any[];room:any}};scope.bookProbe={sent:[],room:null};const Native=WebSocket;
 window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.type==='room')scope.bookProbe.room=message;});}send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string')scope.bookProbe.sent.push(JSON.parse(data));super.send(data);}};
},textScale);}
const ready=(page:Page)=>expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
const book=(page:Page)=>page.getByRole('dialog',{name:'마이티 규칙',exact:true});
async function open(page:Page){await ready(page);await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'규칙 보기',exact:true}).click();await expect(book(page)).toBeVisible();}
const submissions=(page:Page)=>page.evaluate(()=>(window as typeof window&{bookProbe:{sent:any[]}}).bookProbe.sent.filter(message=>['submit','submit_room','act'].includes(message.type)).length);
for(const behavior of ['native','cancel-and-retry'] as const)test(`connected full rulebook ${behavior} retains explanations and exact read-only server examples`,async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'real phone and desktop rules reader');test.setTimeout(45000);
 const errors:string[]=[],bodies:unknown[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith(endpoint))bodies.push(request.postDataJSON());});
 const textScale=behavior==='native'?2:1;await install(page,textScale);const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);const {id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);const before=await submissions(page);
 let release=()=>{};
 try{
  if(behavior==='cancel-and-retry'){
   let count=0;const held=new Promise<void>(resolve=>{release=resolve;});
   await page.route(`**${endpoint}`,async route=>{count++;if(count===1){await held;try{await route.continue();}catch{/* Expected after native fetch abort. */}}else if(count===2)await route.fulfill({status:503,body:'unavailable'});else await route.continue();});
   await open(page);await expect(book(page)).toContainText('기록을 불러오는 중이에요');
   const failed=page.waitForEvent('requestfailed',{predicate:request=>request.url().endsWith(endpoint)});
   await book(page).getByRole('button',{name:'닫기',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);release();await failed;
   await open(page);await expect(book(page).getByRole('tab')).toHaveCount(8);
   await book(page).getByRole('tab',{name:'서버 계산 예시',exact:true}).click();await expect(book(page).getByRole('tabpanel')).toContainText('아직 읽지 못했어요');
   await book(page).getByRole('tab',{name:'공약',exact:true}).click();await expect(book(page).getByRole('tabpanel')).toContainText('기루다');
   await book(page).getByRole('button',{name:'닫기',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await open(page);await expect(book(page).getByRole('tab')).toHaveCount(8);await expect(book(page).getByRole('tab',{name:'목표·카드 나누기',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(book(page).getByRole('tabpanel')).toContainText('여당');
  const art=book(page).locator('[data-foundation-kind="card"]');expect(await art.count()).toBeGreaterThan(0);expect(await art.evaluateAll(nodes=>nodes.every(node=>node.tagName!=='BUTTON'&&!node.getAttribute('data-foundation-entity')&&!node.getAttribute('data-foundation-activation')))).toBe(true);
  for(const label of ['딜미스','공약','키티·프렌드','카드의 힘','카드 내기·조커콜·라운드 제한','점수 계산','서버 계산 예시']){await book(page).getByRole('tab',{name:label,exact:true}).click();await ready(page);await expect(book(page).getByRole('tabpanel',{name:label,exact:true})).toBeVisible();}
  await expect(book(page).getByRole('tabpanel')).toContainText('한 몫');
  const expected=await page.evaluate(()=>(window as typeof window&{bookProbe:{room:any}}).bookProbe.room.rules);expect(bodies).toHaveLength(behavior==='native'?1:3);for(const body of bodies)expect(body).toEqual(expected);
  const count=bodies.length;await page.setViewportSize({width:768,height:1024});await ready(page);await expect(book(page).getByRole('tab',{name:'서버 계산 예시',exact:true})).toHaveAttribute('aria-selected','true');expect(bodies).toHaveLength(count);
  await page.screenshot({path:info.outputPath('rulebook-server-examples.png'),fullPage:true});await book(page).getByRole('button',{name:'닫기',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await submissions(page)).toBe(before);expect(errors).toEqual([]);
  await info.attach('read-only-rulebook',{body:JSON.stringify({profile:info.project.name,behavior,textScale,requests:bodies.length,exactRules:true,noGameOrRoomMutation:true,errors}),contentType:'application/json'});
 }finally{release();}
});
