import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import {foundationBotButton, joinFoundation } from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`});
interface Probe{holdLeave:boolean;swallowLeave:boolean;held:unknown[];sent:any[];receipts:any[];socket:WebSocket|null;share:{url:string;active:boolean}[];}
async function room(page:Page,request:APIRequestContext){
 await page.addInitScript(()=>{
  const state=window as typeof window&{shellProbe:Probe};state.shellProbe={holdLeave:false,swallowLeave:false,held:[],sent:[],receipts:[],socket:null,share:[]};
  const Native=WebSocket;window.WebSocket=class extends Native{
   constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);state.shellProbe.socket=this;this.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.type==='operation_receipt'){state.shellProbe.receipts.push(value);if(state.shellProbe.holdLeave&&state.shellProbe.sent.some(sent=>sent.type==='submit_room'&&sent.action?.type==='leave'&&sent.operation_id===value.operation_id)){state.shellProbe.held.push(value);event.stopImmediatePropagation();}}});}
   send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string'){const value=JSON.parse(data);state.shellProbe.sent.push(value);if(value.type==='submit_room'&&value.action?.type==='leave'&&state.shellProbe.swallowLeave){state.shellProbe.swallowLeave=false;return;}}super.send(data);}
  };
  Object.defineProperty(navigator,'share',{value:undefined,configurable:true});Object.defineProperty(navigator,'clipboard',{value:{writeText(url:string){state.shellProbe.share.push({url,active:navigator.userActivation.isActive});return Promise.resolve();}},configurable:true});
  localStorage.setItem('name',JSON.stringify('메뉴 확인'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));
 });
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default'}});expect(response.ok()).toBe(true);const {id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');await joinFoundation(page);await expect(foundationBotButton(page)).toBeEnabled();return id as string;
}
test('real room shares synchronously, owns back navigation and exits only after the correlated leave receipt',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real accepted leave');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const id=await room(page,request);
 await page.locator('[data-live-room]').click();await expect.poll(()=>page.evaluate(()=>(window as typeof window&{shellProbe:Probe}).shellProbe.share.length)).toBe(1);
 expect(await page.evaluate(()=>(window as typeof window&{shellProbe:Probe}).shellProbe.share[0])).toEqual({url:new URL(`/r/${id}?foundation=1`,page.url()).href,active:true});
 await page.evaluate(()=>history.back());await expect(page.getByRole('dialog',{name:`테이블 ${id}`,exact:true})).toBeVisible();
 await page.evaluate(()=>history.back());await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(new RegExp(`/r/${id}\\?foundation=1$`));
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'함께 있는 사람',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('메뉴 확인');await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.evaluate(()=>{(window as typeof window&{shellProbe:Probe}).shellProbe.holdLeave=true;});
 await page.getByRole('dialog').getByRole('button',{name:'테이블 나가기',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{shellProbe:Probe}).shellProbe.held.length)).toBeGreaterThan(0);await expect(page).toHaveURL(new RegExp(`/r/${id}\\?foundation=1$`));
 const before=await page.evaluate(id=>({credential:localStorage.getItem(`room:${id}`),sent:(window as typeof window&{shellProbe:Probe}).shellProbe.sent.filter(value=>value.type==='submit_room'&&value.action?.type==='leave').length}),id);expect(before.sent).toBe(1); // The authoritative unseated packet may already revoke the obsolete seat token.
 await page.evaluate(()=>{const probe=(window as typeof window&{shellProbe:Probe}).shellProbe;probe.holdLeave=false;probe.socket!.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(probe.held[0])}));});
 await expect(page).toHaveURL(new URL('/',page.url()).href);expect(await page.evaluate(id=>localStorage.getItem(`room:${id}`),id)).toBeNull();expect(errors).toEqual([]);
});
test('never-arrived leave is cancelled without clearing credentials or navigating',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real cancelled leave');const id=await room(page,request);await page.evaluate(()=>{(window as typeof window&{shellProbe:Probe}).shellProbe.swallowLeave=true;});
 await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'테이블 나가기',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{shellProbe:Probe}).shellProbe.receipts.some(receipt=>receipt.outcome.reason==='cancelled'))).toBe(true);
 await expect(page.getByRole('dialog')).toContainText('테이블을 나가지 못했어요');await expect(page).toHaveURL(new RegExp(`/r/${id}\\?foundation=1$`));expect(await page.evaluate(id=>localStorage.getItem(`room:${id}`),id)).not.toBeNull();
});
