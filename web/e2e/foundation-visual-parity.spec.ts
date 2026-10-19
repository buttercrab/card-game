import {foundationBotButton} from './foundationHelpers';
import {expect,test,type Page} from '@playwright/test';

const port=Number(process.env.PORT??4317);
test.use({baseURL:`http://127.0.0.1:${port+1}`});
interface ParityProbe {viewer:{id:string;seat:number|null}|null;room:any;session:{hands_played:number}|null;sent:any[];}
const ready=(page:Page)=>expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
async function state(page:Page){return page.evaluate(()=>{
 const probe=(window as typeof window&{parityProbe:ParityProbe}).parityProbe;
 return{actor:probe.viewer?.id,seat:probe.viewer?.seat,inHand:probe.room?.in_hand,handsPlayed:probe.session?.hands_played,seats:probe.room?.seats?.map((seat:any,index:number)=>({kind:seat.kind,name:seat.name??null,participant:probe.room.participant_ids?.[index]??null}))};
});}
async function capture(page:Page,path:string){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path,fullPage:true,animations:'disabled'});}

for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
 test(`matching waiting table original/candidate at ${width}px and candidate text at 200%`,async({page,request},info)=>{
  test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'one mobile/light and one desktop/dark browser profile');test.setTimeout(60000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   // Re-navigation must preserve the original seat credentials and candidate preference.
   if(!localStorage.getItem('parity-seeded')){localStorage.setItem('parity-seeded','1');localStorage.setItem('name',JSON.stringify('비교 검증'));localStorage.setItem('mighty.settings',JSON.stringify({textScale:1,sound:false,music:false,haptics:false,speed:'off'}));}
   const scope=window as typeof window&{parityProbe:ParityProbe};scope.parityProbe={viewer:null,room:null,session:null,sent:[]};const Native=WebSocket;
   window.WebSocket=class extends Native{
    constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.type==='visitor_welcome')scope.parityProbe.viewer=value;if(value.type==='room')scope.parityProbe.room=value;if(value.type==='session')scope.parityProbe.session={hands_played:value.hands_played};});}
    send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string')scope.parityProbe.sent.push(JSON.parse(data));super.send(data);}
   };
  });
  await page.setViewportSize({width,height});
  const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);const{id}=await response.json();
  await page.goto(`/r/${id}?foundation=0`);await expect(page.getByText('새 버전이 나왔어요.',{exact:true})).toHaveCount(0);const join=page.getByRole('button',{name:'빈자리에 앉기',exact:true});await expect(join).toBeEnabled();await join.click();
  await expect(page.locator('.seat .name').filter({hasText:/^비교 검증$/})).toHaveCount(1);await expect(join).toHaveCount(0);await expect(page.locator('.seat-act').filter({hasText:'봇 추가'}).first()).toBeEnabled();
  await expect.poll(async()=>{const snapshot=await state(page);return snapshot.seat!==null&&snapshot.seat!==undefined;}).toBe(true);
  await expect(page.getByText('새 버전이 나왔어요.',{exact:true})).toHaveCount(0);const original=await state(page);expect(original.actor).toBeTruthy();expect(original.inHand).toBe(false);expect(original.handsPlayed).toBe(0);expect(original.seats.filter((seat:any)=>seat.kind==='human')).toHaveLength(1);expect(original.seats.filter((seat:any)=>seat.kind==='bot')).toHaveLength(0);
  const originalImage=info.outputPath(`original-waiting-${width}.png`);await capture(page,originalImage);

  // Same page, origin, room and stored seat credential; reclaim without another manual join.
  await page.goto(`/r/${id}?foundation=1`);await ready(page);await expect(page.getByText('새 버전이 나왔어요.',{exact:true})).toHaveCount(0);await expect(foundationBotButton(page)).toBeEnabled();await expect(page.getByRole('button',{name:'빈자리에 앉기',exact:true})).toHaveCount(0);
  await expect.poll(()=>state(page)).toEqual(original);
  await expect(page.locator('[data-foundation-node=identity-name]')).toBeVisible();await expect(page.locator('[data-foundation-node=identity-name]')).toHaveText('비교 검증');
  await expect(page.getByRole('group',{name:'게임 대기 테이블',exact:true})).toBeVisible();
  await expect(page.locator('[data-foundation-node=dock]')).toHaveCount(0);await expect(page.getByText('카드 없음',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'봇 추가',exact:true})).toHaveCount(4);
  const stock=page.locator('[data-foundation-kind=card]');await expect(stock).toHaveCount(1);expect(await stock.evaluate(element=>{const box=element.getBoundingClientRect();return{width:box.width,height:box.height};})).toEqual({width:32,height:45});
  const candidateImage=info.outputPath(`candidate-waiting-100-${width}.png`);await capture(page,candidateImage);

  await page.getByRole('button',{name:'설정',exact:true}).click();const settings=page.getByRole('dialog',{name:'설정',exact:true});await expect(settings).toBeVisible();await settings.getByRole('combobox',{name:'글자 크기',exact:true}).selectOption({label:'200%'});await ready(page);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mighty.settings')!).textScale)).toBe(2);await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);await ready(page);
  await expect.poll(()=>state(page)).toEqual(original);
  const candidateLargeImage=info.outputPath(`candidate-waiting-200-${width}.png`);await capture(page,candidateLargeImage);
  const mutations=await page.evaluate(()=>(window as typeof window&{parityProbe:ParityProbe}).parityProbe.sent.filter(message=>['act','submit','submit_room','add_bot','start'].includes(message.type)));
  expect(mutations).toEqual([]);expect(await page.evaluate(()=>(window as typeof window&{parityProbe:ParityProbe}).parityProbe.sent.filter(message=>message.type==='join').every(message=>typeof message.token==='string'&&message.token.length>0))).toBe(true);expect(errors).toEqual([]);
  await info.attach('matching-room-state',{body:JSON.stringify({profile:info.project.name,width,height,room:id,original,candidate:await state(page),candidateTextScale:2,errors,notes:'Original fixed-pixel typography has no equivalent 200% preference. Images require human visual inspection; no pixel-equivalence assertion.'},null,2),contentType:'application/json'});
  for(const [name,path] of [['original-waiting',originalImage],['candidate-waiting-100',candidateImage],['candidate-waiting-200',candidateLargeImage]])await info.attach(`${name}-${width}`,{path,contentType:'image/png'});
 });
}
