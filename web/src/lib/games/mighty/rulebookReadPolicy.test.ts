import {afterEach,expect,test,vi} from 'vitest';
import {presetRules} from './catalog';
import {completionFixture} from './testSupport/completionFixture';
import {createMightyRulebookReadOwner,MIGHTY_RULEBOOK_ENTRY} from './rulebookReadPolicy';
import type {ConnectedDisclosureContext} from '../../table/foundation/connectedDisclosures';
import type {Examples,Mighty,Rules} from './types';
const context=():ConnectedDisclosureContext<Mighty>=>{const f=completionFixture();f.room!.rules=presetRules('default');return {client:{room:f.room,seat:f.seat,viewerId:f.actorId,viewerName:'Bob'},roomScope:f.scope!,context:{session:'mighty:room:2',audience:'bob:0',generation:'2',revision:'1'},sourceRevision:'history:1',connectionEpoch:'connection',publicHistory:{current:{sessionId:2,records:[]}}};};
function examples(r:Rules):Examples{
 const count=Math.min(r.bidding.min+1,20),alone=!(r.friend.by_card||r.friend.by_seat||r.friend.first_trick||r.friend.last_trick),contract={trump:'Spade' as const,count};
 const sample=(points:number,unit:number)=>({value:{contract,team_points:points,made:points>=count,value:unit,steps:[]},payoffs:Array.from({length:r.players},(_,index)=>index===0?unit*(r.players-(alone?1:3)):!alone&&index===1?unit:-unit)});
 return {contract,alone,made:sample(Math.min(count+2,20),7),failed:sample(Math.max(count-2,0),-3)};
}
const words=(input:unknown)=>JSON.stringify(input),signal=()=>new AbortController();
afterEach(()=>vi.useRealTimers());
test('projection and paging are inert; private game state and long equality keys never enter offers',()=>{
 const fetcher=vi.fn(),owner=createMightyRulebookReadOwner(fetcher),input=context();Object.defineProperty(input.client,'game',{enumerable:true,get(){throw Error('Private game accessed');}});
 const offered=owner.project(input)!;owner.policy.page(offered,0);expect(fetcher).not.toHaveBeenCalled();expect(words(offered)).not.toMatch(/Normal|rulesKey|scoring|current_hand/);expect(offered.revision.length).toBeLessThan(64);
 expect(owner.project({...input,sourceRevision:'history:next'})).toEqual(offered);owner.dispose();
});
test('explicit read sends exact public rules and publishes server examples with the complete explanation',async()=>{
 const input=context(),fetcher=vi.fn(async()=>Response.json(examples(input.client.room!.rules))),owner=createMightyRulebookReadOwner(fetcher),offer=owner.project(input)!;
 const result=await owner.policy.select(offer,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal});
 expect(fetcher).toHaveBeenCalledOnce();const [url,request]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/api/games/mighty/rules/examples');expect(request.method).toBe('POST');expect(JSON.parse(request.body as string)).toEqual(input.client.room!.rules);expect(request.signal).toBeInstanceOf(AbortSignal);
 expect(result.sections).toHaveLength(8);expect(words(result.sections.at(-1))).toContain('한 몫');expect(words(result)).not.toMatch(/entityId|ownerId|command|callback/);owner.dispose();
});
test('abort retains one request slot until raw settlement',async()=>{
 let complete!:(value:Response)=>void;const input=context(),fetcher=vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;})),owner=createMightyRulebookReadOwner(fetcher),offered=owner.project(input)!,controller=signal();
 const old=owner.policy.select(offered,MIGHTY_RULEBOOK_ENTRY,{signal:controller.signal}) as Promise<unknown>,refusal=expect(old).rejects.toMatchObject({name:'AbortError'});
 controller.abort();owner.revoke();const fresh=owner.project(input)!;await expect(owner.policy.select(fresh,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal})).rejects.toThrow('unavailable');expect(fetcher).toHaveBeenCalledOnce();
 complete(Response.json(examples(input.client.room!.rules)));await refusal;owner.dispose();
});
test('rules replacement rejects an old response and invalidates the original grant',async()=>{
 let complete!:(value:Response)=>void;const input=context(),oldRules=structuredClone(input.client.room!.rules),fetcher=vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;})),owner=createMightyRulebookReadOwner(fetcher),offered=owner.project(input)!;
 const old=owner.policy.select(offered,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal}) as Promise<unknown>,refusal=expect(old).rejects.toMatchObject({name:'AbortError'});
 input.client.room!.rules.bidding.min++;const fresh=owner.project(input)!;expect(fresh.revision).not.toBe(offered.revision);expect(()=>owner.policy.page(offered,0)).toThrow();complete(Response.json(examples(oldRules)));await refusal;owner.dispose();
});
test('stream and declared-length bounds cancel the body and retain truthful explanatory fallback',async()=>{
 for(const declared of [false,true]){let canceled=0;const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(65537));},cancel(){canceled++;}}),fetcher=vi.fn(async()=>new Response(body,{headers:declared?{'content-length':'65537'}:{}})),owner=createMightyRulebookReadOwner(fetcher),offer=owner.project(context())!;
  const doc=await owner.policy.select(offer,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal});expect(words(doc.sections.at(-1))).toContain('아직 읽지 못했어요');expect(doc.sections).toHaveLength(8);expect(canceled).toBe(1);owner.dispose();}
});
test('native abort-settling timeout returns unavailable examples without fabricated scores',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn((_url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))),owner=createMightyRulebookReadOwner(fetcher),offer=owner.project(context())!;
 const read=owner.policy.select(offer,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal}) as Promise<any>;await vi.advanceTimersByTimeAsync(3000);const doc=await read;expect(words(doc.sections.at(-1))).toContain('아직 읽지 못했어요');expect(words(doc.sections.at(-1))).not.toContain('한 몫');owner.dispose();
});
test('malformed response and missing cancellation cannot invent examples or uncancellable fetch',async()=>{
 const fetcher=vi.fn(async()=>Response.json({untrusted:'payload'})),owner=createMightyRulebookReadOwner(fetcher),offer=owner.project(context())!;
 await expect(owner.policy.select(offer,MIGHTY_RULEBOOK_ENTRY)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 const doc=await owner.policy.select(offer,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal});expect(words(doc.sections.at(-1))).toContain('아직 읽지 못했어요');owner.dispose();expect(owner.project(context())).toBeNull();
});
test('timeout never releases an abort-ignoring request or accepts its late examples',async()=>{
 vi.useFakeTimers();let complete!:(value:Response)=>void;
 const input=context(),fetcher=vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;})),owner=createMightyRulebookReadOwner(fetcher),offer=owner.project(input)!;
 const pending=owner.policy.select(offer,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal}) as Promise<any>;
 await vi.advanceTimersByTimeAsync(3000);
 await expect(owner.policy.select(offer,MIGHTY_RULEBOOK_ENTRY,{signal:signal().signal})).rejects.toThrow('unavailable');expect(fetcher).toHaveBeenCalledOnce();
 complete(Response.json(examples(input.client.room!.rules)));
 const result=await pending;expect(words(result.sections.at(-1))).toContain('아직 읽지 못했어요');expect(words(result.sections.at(-1))).not.toContain('한 몫');owner.dispose();
});
