import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import {foundationBotButton, joinFoundation, openFoundationJoin } from './foundationHelpers';
import {presetRules} from '../src/lib/games/mighty/catalog';
const port=Number(process.env.PORT??4317);
test.use({baseURL:`http://127.0.0.1:${port+1}`});
interface Probe {dropReceipts:boolean;dropSubmit:boolean;dropRoomSubmit:boolean;botCount:number;socket:WebSocket|null;held:string|null;receipts:any[];version:number;attempts:any[];}
async function setup(page:Page,request:APIRequestContext,lobbyOnly=false){
  await page.addInitScript(()=>{
    const scope=window as typeof window&{recoveryProbe:Probe};
    scope.recoveryProbe={dropReceipts:false,dropSubmit:false,dropRoomSubmit:false,botCount:0,socket:null,held:null,receipts:[],version:0,attempts:[]};
    const Native=WebSocket;
    window.WebSocket=class extends Native{
      constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);scope.recoveryProbe.socket=this;
        this.addEventListener('message',event=>{
          const message=JSON.parse(String(event.data)),probe=scope.recoveryProbe;
          if(message.type==='state')probe.version=message.version;
          if(message.type==='room')probe.botCount=message.seats.filter((seat:{kind:string})=>seat.kind==='bot').length;
          if(message.type==='operation_receipt'){
            probe.receipts.push(message);
            if(probe.dropReceipts)event.stopImmediatePropagation();
          }
        });
      }
      send(data:string|ArrayBufferLike|Blob|ArrayBufferView){
        const probe=scope.recoveryProbe;
        if(typeof data==='string'){
          const message=JSON.parse(data);
          if(message.type==='submit'||message.type==='submit_room'){
            probe.attempts.push(message);
            if(message.type==='submit'&&probe.dropSubmit||message.type==='submit_room'&&probe.dropRoomSubmit){probe.dropSubmit=false;probe.dropRoomSubmit=false;probe.held=data;return;}
          }
        }
        super.send(data);
      }
    };
    localStorage.setItem('name',JSON.stringify('복구 확인'));
    localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));
  });
  // Cancellation assertions isolate this operation from independent bot redeals.
  // Every card has value >= -2 here, so -128 cannot misdeal; all-point hands
  // are allowed as well. Ordinary bidding and the real server remain active.
  const rules=presetRules('gshs');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;
  const response=await request.post('/api/games/mighty/rooms',{data:{preset:'gshs',rules}});
  expect(response.ok()).toBe(true);const {id}=await response.json();
  await page.goto(`/r/${id}?foundation=1`);
  if(lobbyOnly)return id as string;
  await joinFoundation(page);
  for(let index=0;index<4;index++)await foundationBotButton(page).click();
  await page.getByRole('button',{name:'시작',exact:true}).click();
  await expect(page.getByRole('button',{name:'패스',exact:true})).toBeEnabled({timeout:30000});
  return id as string;
}
test('an unread game receipt survives reload and resolves without a replacement move',async({page,request},info)=>{
  test.skip(info.project.name!=='390x844-light','one real recovery lifecycle');test.setTimeout(60000);
  const errors:string[]=[],sent:any[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('websocket',socket=>socket.on('framesent',frame=>sent.push(JSON.parse(String(frame.payload)))));
  const id=await setup(page,request);
  await page.evaluate(()=>{(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.dropReceipts=true;});
  await page.getByRole('button',{name:'패스',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'이전 요청의 처리 결과'})).toBeVisible();
  const saved=await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`card.commands.v1:${id}`)!),id);
  expect(saved).toHaveLength(1);expect(Object.keys(saved[0]).sort()).toEqual(['expected','operation_id','sequence']);
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.receipts.some(receipt=>receipt.outcome.status==='accepted'))).toBe(true);
  await page.reload();
  await expect.poll(()=>page.evaluate(id=>JSON.parse(sessionStorage.getItem(`card.commands.v1:${id}`)??'[]').length,id)).toBe(0);
  await expect(page.getByRole('status').filter({hasText:'이전 요청의 처리 결과'})).toHaveCount(0);
  expect(sent.filter(message=>message.type==='submit')).toHaveLength(1);
  expect(sent.some(message=>message.type==='act')).toBe(false);
  expect(sent.some(message=>message.type==='query_operation'&&message.operation_id===saved[0].operation_id)).toBe(true);
  expect(errors).toEqual([]);
});
test('a never-arrived submit is cancelled and its delayed original cannot execute',async({page,request},info)=>{
  test.skip(info.project.name!=='390x844-light','one real cancellation lifecycle');test.setTimeout(60000);
  const id=await setup(page,request);
  const before=await page.evaluate(()=>{const probe=(window as typeof window&{recoveryProbe:Probe}).recoveryProbe;probe.dropSubmit=true;return probe.version;});
  await page.getByRole('button',{name:'패스',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.receipts.some(receipt=>receipt.outcome.reason==='cancelled'))).toBe(true);
  await expect(page.getByRole('button',{name:'패스',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.version)).toBe(before);
  await page.evaluate(()=>{const probe=(window as typeof window&{recoveryProbe:Probe}).recoveryProbe;probe.socket!.send(probe.held!);});
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.receipts.filter(receipt=>receipt.outcome.reason==='cancelled').length)).toBe(2);
  expect(await page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.version)).toBe(before);
  const attempts=await page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.attempts.filter(message=>message.type==='submit'));
  expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);
  expect(await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`card.commands.v1:${id}`)??'[]'),id)).toEqual([]);
});


test('an unread scoped join receipt survives actor seat transition and reload without another join',async({page,request},info)=>{
  test.skip(info.project.name!=='390x844-light','one correlated lobby recovery');test.setTimeout(30000);
  const sent:any[]=[];page.on('websocket',socket=>socket.on('framesent',frame=>sent.push(JSON.parse(String(frame.payload)))));
  const id=await setup(page,request,true);
  const joinDialog=await openFoundationJoin(page);
  await page.evaluate(()=>{(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.dropReceipts=true;});
  await joinDialog.getByRole('button',{name:'앉기',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.receipts.some(receipt=>receipt.outcome.status==='accepted'))).toBe(true);
  const saved=await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`card.commands.v1:${id}`)!),id);
  expect(saved).toHaveLength(1);expect(saved[0].expected.domain).toBe('room');expect(saved[0].expected.seat).toBeNull();
  await page.reload();await expect(foundationBotButton(page)).toBeEnabled();
  await expect.poll(()=>page.evaluate(id=>JSON.parse(sessionStorage.getItem(`card.commands.v1:${id}`)??'[]').length,id)).toBe(0);
  expect(sent.filter(message=>message.type==='submit_room'&&message.action.type==='join')).toHaveLength(1);
  expect(sent.some(message=>message.type==='query_operation'&&message.operation_id===saved[0].operation_id)).toBe(true);
  expect(sent.filter(message=>['add_bot','ready','start'].includes(message.type))).toEqual([]);
});

test('a never-arrived bot addition is cancelled and its delayed original cannot alter the lobby',async({page,request},info)=>{
  test.skip(info.project.name!=='390x844-light','one correlated lobby cancellation');test.setTimeout(30000);
  const id=await setup(page,request,true);
  await joinFoundation(page);
  await expect(foundationBotButton(page)).toBeEnabled();
  await page.evaluate(()=>{(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.dropRoomSubmit=true;});
  await foundationBotButton(page).click();
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.receipts.some(receipt=>receipt.outcome.reason==='cancelled'))).toBe(true);
  expect(await page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.botCount)).toBe(0);
  await page.evaluate(()=>{const probe=(window as typeof window&{recoveryProbe:Probe}).recoveryProbe;probe.socket!.send(probe.held!);});
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.receipts.filter(receipt=>receipt.outcome.reason==='cancelled').length)).toBe(2);
  expect(await page.evaluate(()=>(window as typeof window&{recoveryProbe:Probe}).recoveryProbe.botCount)).toBe(0);
  expect(await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`card.commands.v1:${id}`)??'[]'),id)).toEqual([]);
});
