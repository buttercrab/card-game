import {expect,test,vi} from 'vitest';
import {createDisclosureReader,type DisclosureReadSource} from './disclosureSession';
import type {DisclosureCatalogOffer,DisclosureReadPolicy} from './disclosures';
import type {DisclosureDocument} from './disclosureTypes';
const context={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'connection',audience:'alice:0'};
const offer=(visibility:'public'|'audience'='public'):DisclosureCatalogOffer=>({id:'history',policyId:'history:v1',revision:'r1',title:'지난 판',total:13,pageSize:12,scope:{roomId:context.roomId,roomEpoch:context.roomEpoch,actorId:context.actorId,connectionEpoch:context.connectionEpoch,visibility,...(visibility==='audience'?{audience:context.audience}:{})}});
const selected=(entryId:string,title='완료된 판'):DisclosureDocument=>({entryId,title,roster:[],cards:[],sections:[{id:'summary',kind:'content',title:'안내',information:[]}]});
function fixture(visibility:'public'|'audience'='public',isCurrent?:(context:import('./disclosures').DisclosureContext)=>boolean,isRetainedCurrent?:(scope:import('./disclosures').DisclosureScope)=>boolean,onSelectionChanged?:(receipt:import('./disclosures').DisclosureSelectionReceipt|null)=>void){
 let current:DisclosureReadSource|null={offers:[offer(visibility)],context:{...context},epoch:1,readable:true};
 const page=vi.fn<DisclosureReadPolicy['page']>((offered,index)=>({catalogId:offered.id,revision:offered.revision,page:index,total:offered.total,pageSize:12,entries:Array.from({length:Math.min(12,offered.total-index*12)},(_,offset)=>({id:`row${index*12+offset}`,title:'같은 의미의 기록'}))}));
 const select=vi.fn<DisclosureReadPolicy['select']>((_offer,id)=>selected(id));
 const reader=createDisclosureReader({readCurrent:()=>current,policies:[{id:'history:v1',page,select}],isCurrent,isRetainedCurrent,onSelectionChanged});
 return{reader,page,select,get current():DisclosureReadSource{return current!;},set current(value:DisclosureReadSource|null){current=value;}};
}
test('page ownership and known-entry selection use only the current catalog page and opaque IDs',()=>{
 const f=fixture();expect(f.reader.select('history','row0')).toBe(false);expect(f.select).not.toHaveBeenCalled();expect(f.reader.page('history',0)).toBe(true);expect(Object.isFrozen(f.page.mock.calls[0][0].scope)).toBe(true);
 expect(f.reader.select('history','row12')).toBe(false);expect(f.reader.select('history','row0')).toBe(true);expect(f.select).toHaveBeenCalledTimes(1);expect(f.reader.snapshot().selected?.entryId).toBe('row0');expect(Object.isFrozen(f.reader.snapshot().selected!.sections)).toBe(true);
 for(const cursor of [-1,2,1.5,Number.MAX_SAFE_INTEGER])expect(f.reader.page('history',cursor)).toBe(false);expect(f.page).toHaveBeenCalledTimes(1);f.reader.dispose();
});
test('same-count catalog replacement clears old page authority while retaining an owned public selection',()=>{
 const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');const prior=f.reader.snapshot().selected;
 f.current={...f.current,epoch:2,offers:[{...offer(),revision:'r2'}]};expect(f.reader.snapshot().page).toBeUndefined();expect(f.reader.snapshot().selected).toBe(prior);expect(f.reader.select('history','row0')).toBe(false);expect(f.select).toHaveBeenCalledTimes(1);
 expect(f.reader.page('history',0)).toBe(true);expect(f.page.mock.calls[1][0].revision).toBe('r2');expect(f.reader.select('history','row0')).toBe(true);expect(f.select.mock.calls[1][0].revision).toBe('r2');f.reader.dispose();
});
test('owned public records survive scene/session changes but actor, connection, epoch or catalog removal clears them',()=>{
 for(const mutation of ['actor','connection','epoch','remove']){const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');const prior=f.reader.snapshot().selected;
 const changedContext={...context,audience:'alice:new-scene',session:'session-2',generation:'generation-2'};f.current={...f.current,epoch:2,context:changedContext,offers:[{...offer(),revision:'r2'}]};expect(f.reader.snapshot().selected).toBe(prior);
 if(mutation==='remove')f.current={...f.current,epoch:3,offers:[]};else f.current={...f.current,epoch:3,context:{...f.current.context,...(mutation==='actor'?{actorId:'bob'}:mutation==='connection'?{connectionEpoch:'new'}:{roomEpoch:'new'})}};
 expect(f.reader.snapshot()).toEqual({});f.reader.dispose();}
});
test('audience-private selected records retire on exact audience replacement',()=>{
 const f=fixture('audience');f.reader.page('history',0);f.reader.select('history','row0');f.current={...f.current,epoch:2,context:{...context,audience:'alice:watch'}};expect(f.reader.snapshot()).toEqual({});expect(f.reader.page('history',0)).toBe(false);f.reader.dispose();
});
test('a read cannot commit after same-count revision or source epoch changes during its callback',()=>{
 for(const kind of ['revision','epoch']){const f=fixture();const original=f.page.getMockImplementation()!;f.page.mockImplementation((offered,index)=>{f.current={...f.current,epoch:2,offers:[{...offer(),revision:kind==='revision'?'r2':'r1'}]};return original(offered,index);});expect(f.reader.page('history',0)).toBe(false);expect(f.reader.snapshot().page).toBeUndefined();f.reader.dispose();}
});
test('policy reentry cannot recursively read; revoke or dispose during a selected read cannot resurrect data',()=>{
 for(const terminal of ['revoke','dispose']){const f=fixture();f.reader.page('history',0);f.select.mockImplementation((_offer,id)=>{expect(f.reader.page('history',0)).toBe(false);expect(f.reader.select('history',id)).toBe(false);if(terminal==='revoke')f.reader.revoke();else f.reader.dispose();return selected(id);});expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot()).toEqual({});expect(f.select).toHaveBeenCalledTimes(1);f.reader.dispose();}
});
test('throwing or asynchronous read callbacks fail locally without becoming an empty success or a command',()=>{
 const f=fixture();f.page.mockImplementation(()=>{throw Error('private provider detail');});expect(()=>f.reader.page('history',0)).not.toThrow();expect(f.reader.snapshot().page).toBeUndefined();expect(f.reader.snapshot().error).toBe('기록을 읽지 못했어요. 다시 열어주세요.');
 f.page.mockImplementation(()=>Promise.resolve({}) as never);expect(f.reader.page('history',0)).toBe(false);expect(f.reader.snapshot().selected).toBeUndefined();f.reader.dispose();
});
test('wrong selected entry, hidden accessors and extra capabilities cannot enter owned snapshots',()=>{
 const f=fixture();f.reader.page('history',0);f.select.mockImplementation(()=>selected('different-row'));expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot().selected).toBeUndefined();let reads=0;
 f.select.mockImplementation((_offer,id)=>Object.defineProperty(selected(id),'cards',{get(){reads++;return[];},enumerable:true}));expect(f.reader.select('history','row0')).toBe(false);expect(reads).toBe(0);
 f.select.mockImplementation((_offer,id)=>({...selected(id),submit:()=>{}}));expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot().selected).toBeUndefined();f.reader.dispose();
});
test('post-read source callback revocation is rechecked after ownership before any commit',()=>{
 let current:DisclosureReadSource={offers:[offer()],context,epoch:1,readable:true},reads=0;let reader:ReturnType<typeof createDisclosureReader>;const policy:DisclosureReadPolicy={id:'history:v1',page(offered){return{catalogId:offered.id,revision:offered.revision,page:0,total:13,pageSize:12,entries:Array.from({length:12},(_,index)=>({id:`row${index}`,title:'기록'}))};},select:(_offer,id)=>selected(id)};
 reader=createDisclosureReader({readCurrent:()=>{if(++reads===3)reader.revoke();return current;},policies:[policy]});expect(reader.page('history',0)).toBe(false);expect(reads).toBeGreaterThanOrEqual(3);expect(reader.snapshot()).toEqual({});reader.dispose();
});
test('missing source, explicit revoke and disposal discard every retained private payload',()=>{
 const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');f.current=null;expect(f.reader.snapshot()).toEqual({});f.current={offers:[offer()],context,epoch:2,readable:true};f.reader.page('history',0);f.reader.select('history','row0');f.reader.revoke();expect(f.reader.snapshot()).toEqual({});f.reader.dispose();expect(f.reader.page('history',0)).toBe(false);expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot()).toEqual({});
});

test('temporary unreadability rejects new reads without revoking the same public selected grant',()=>{
 const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');const prior=f.reader.snapshot().selected;f.current={...f.current,epoch:2,readable:false};
 expect(f.reader.snapshot().selected).toBe(prior);expect(f.reader.page('history',0)).toBe(false);expect(f.reader.select('history','row1')).toBe(false);expect(f.page).toHaveBeenCalledTimes(1);expect(f.select).toHaveBeenCalledTimes(1);
 f.current={...f.current,epoch:3,readable:true};expect(f.reader.page('history',0)).toBe(true);expect(f.reader.select('history','row1')).toBe(true);f.reader.dispose();
});
test('post-read readability loss cannot commit a newly returned private document',()=>{
 const f=fixture('audience');f.reader.page('history',0);f.select.mockImplementation((_offer,id)=>{f.current={...f.current,readable:false};return selected(id);});
 expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot().selected).toBeUndefined();f.reader.dispose();
});

test('equivalent scope object ordering cannot revoke an owned public record',()=>{
 const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');const previous=f.reader.snapshot().selected;
 f.current={...f.current,epoch:2,offers:[{...offer(),revision:'r2',scope:{visibility:'public',connectionEpoch:'connection',actorId:'alice',roomEpoch:'epoch',roomId:'room'}}]};
 expect(f.reader.snapshot().selected).toBe(previous);f.reader.dispose();
});

test('native freshness loss inside page or selected policy cannot commit against an unchanged canonical document',()=>{
 for(const operation of ['page','select']){let nativeCurrent=true;const guard=vi.fn(()=>nativeCurrent),f=fixture('public',guard);
  if(operation==='page'){const original=f.page.getMockImplementation()!;f.page.mockImplementation((offer,index)=>{nativeCurrent=false;return original(offer,index);});expect(f.reader.page('history',0)).toBe(false);expect(f.reader.snapshot().page).toBeUndefined();}
  else{f.reader.page('history',0);f.select.mockImplementation((_offer,id)=>{nativeCurrent=false;return selected(id);});expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot().selected).toBeUndefined();}
  expect(guard.mock.results.at(-1)?.value).toBe(false);f.reader.dispose();
 }
});
test('only synchronous literal true admits host freshness and malformed output never reaches a policy',()=>{
 for(const output of [false,undefined,null,1,'true',new Boolean(true),Promise.resolve(true)]){const f=fixture('public',()=>output as boolean);expect(f.reader.page('history',0)).toBe(false);expect(f.page).not.toHaveBeenCalled();expect(f.reader.snapshot().page).toBeUndefined();f.reader.dispose();}
 const f=fixture('public',()=>{throw Error('native unavailable');});expect(()=>f.reader.page('history',0)).not.toThrow();expect(f.page).not.toHaveBeenCalled();f.reader.dispose();
});
test('host guard reentrant revoke/dispose after a selected read cannot resurrect its returned payload',()=>{
 for(const terminal of ['revoke','dispose'] as const){let armed=false,phase=0,f:ReturnType<typeof fixture>;const guard=vi.fn(()=>{if(armed&&++phase===2)f.reader[terminal]();return true;});f=fixture('public',guard);f.reader.page('history',0);armed=true;expect(f.reader.select('history','row0')).toBe(false);expect(f.select).toHaveBeenCalledTimes(1);expect(f.reader.snapshot()).toEqual({});f.reader.dispose();}
});
test('canonical state is rechecked after a native guard changes catalog authority before or after the policy',()=>{
 for(const phase of [1,2]){let calls=0,f:ReturnType<typeof fixture>;f=fixture('public',()=>{if(++calls===phase)f.current={...f.current,epoch:2,offers:[{...offer(),revision:'r2'}]};return true;});expect(f.reader.page('history',0)).toBe(false);expect(f.page).toHaveBeenCalledTimes(phase===1?0:1);expect(f.reader.snapshot().page).toBeUndefined();f.reader.dispose();}
});
test('native guard receives frozen context and recursive read attempts remain bounded',()=>{
 let f:ReturnType<typeof fixture>;const guard=vi.fn((context:import('./disclosures').DisclosureContext)=>{expect(Object.isFrozen(context)).toBe(true);expect(f.reader.page('history',0)).toBe(false);return true;});f=fixture('public',guard);expect(f.reader.page('history',0)).toBe(true);expect(guard).toHaveBeenCalledTimes(2);expect(f.page).toHaveBeenCalledTimes(1);f.reader.dispose();
});
test('malformed or throwing post-read native guard rejects even a successfully decoded page',()=>{
 for(const output of [false,undefined,1,'true',Promise.resolve(true),'throws']){let calls=0;const f=fixture('public',()=>{if(++calls===1)return true;if(output==='throws')throw Error('native changed');return output as boolean;});expect(f.reader.page('history',0)).toBe(false);expect(f.page).toHaveBeenCalledTimes(1);expect(f.reader.snapshot().page).toBeUndefined();f.reader.dispose();}
});

test('native identity retention fences scrub selected data before canonical publication catches up',()=>{
 for(const field of ['actorId','roomEpoch','connectionEpoch'] as const){const native={...context};const f=fixture('public',()=>true,scope=>scope.actorId===native.actorId&&scope.roomEpoch===native.roomEpoch&&scope.connectionEpoch===native.connectionEpoch&&scope.roomId===native.roomId);f.reader.page('history',0);f.reader.select('history','row0');expect(f.reader.snapshot().selected).toBeDefined();
  native[field]='replacement';expect(f.current.context).toEqual(context);expect(f.reader.snapshot()).toEqual({});expect(f.page).toHaveBeenCalledTimes(1);expect(f.select).toHaveBeenCalledTimes(1);f.reader.dispose();}
});
test('benign source freshness loss preserves an already owned public selection under its independent native grant',()=>{
 let sourceFresh=true;const retained=vi.fn(()=>true),f=fixture('public',()=>sourceFresh,retained);f.reader.page('history',0);f.reader.select('history','row0');const selected=f.reader.snapshot().selected;
 sourceFresh=false;f.current={...f.current,epoch:2,readable:false,offers:[{...offer(),revision:'new-hand'}],context:{...context,audience:'alice:new-hand'}};expect(f.reader.snapshot().selected).toBe(selected);expect(f.reader.page('history',0)).toBe(false);expect(f.reader.select('history','row1')).toBe(false);expect(retained).toHaveBeenCalled();f.reader.dispose();
});
test('private retained snapshots require exact native audience while public snapshots do not',()=>{
 for(const visibility of ['public','audience'] as const){let nativeAudience=context.audience;const f=fixture(visibility,()=>true,scope=>scope.visibility==='public'||scope.audience===nativeAudience);f.reader.page('history',0);f.reader.select('history','row0');const prior=f.reader.snapshot().selected;nativeAudience='alice:watch';const next=f.reader.snapshot();if(visibility==='audience')expect(next).toEqual({});else expect(next.selected).toBe(prior);f.reader.dispose();}
});
test('retention requires synchronous literal true and throwing or malformed checks scrub payloads',()=>{
 for(const output of [false,undefined,null,1,'true',new Boolean(true),Promise.resolve(true),'throws']){let armed=false;const f=fixture('public',()=>true,()=>{if(!armed)return true;if(output==='throws')throw Error('native unavailable');return output as boolean;});f.reader.page('history',0);f.reader.select('history','row0');armed=true;let state:ReturnType<typeof f.reader.snapshot>|undefined;expect(()=>{state=f.reader.snapshot();}).not.toThrow();expect(state).toEqual({});f.reader.dispose();}
});
test('retention guard revoke and disposal cannot resurrect detached selected state',()=>{
 for(const terminal of ['revoke','dispose'] as const){let armed=false,f:ReturnType<typeof fixture>;f=fixture('public',()=>true,()=>{if(armed)f.reader[terminal]();return true;});f.reader.page('history',0);f.reader.select('history','row0');armed=true;expect(f.reader.snapshot()).toEqual({});expect(f.reader.snapshot()).toEqual({});f.reader.dispose();}
});
test('retention guard snapshot/read reentry is bounded and never exposes unvalidated retained payloads',()=>{
 let armed=false,f:ReturnType<typeof fixture>,checks=0;f=fixture('public',()=>true,scope=>{expect(Object.isFrozen(scope)).toBe(true);if(armed){checks++;expect(f.reader.snapshot()).toEqual({});expect(f.reader.page('history',0)).toBe(false);expect(f.reader.select('history','row0')).toBe(false);}return true;});f.reader.page('history',0);f.reader.select('history','row0');armed=true;const snapshot=f.reader.snapshot();expect(snapshot.selected?.entryId).toBe('row0');expect(checks).toBeGreaterThan(0);expect(checks).toBeLessThanOrEqual(2);f.reader.dispose();
});
test('native retention loss during a selected read retires its transaction even with unchanged canonical source',()=>{
 for(const nestedSnapshot of [false,true]){let nativeCurrent=true;const f=fixture('public',()=>true,()=>nativeCurrent);f.reader.page('history',0);f.select.mockImplementation((_offer,id)=>{nativeCurrent=false;if(nestedSnapshot)expect(f.reader.snapshot()).toEqual({});return selected(id);});expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot()).toEqual({});f.reader.dispose();}
});

test('closing selected detail preserves its bounded catalog page but retires an in-flight selection',()=>{
 const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');const page=f.reader.snapshot().page;f.reader.deselect();expect(f.reader.snapshot().selected).toBeUndefined();expect(f.reader.snapshot().page).toBe(page);
 f.select.mockImplementation((_offer,id)=>{f.reader.deselect();return selected(id);});expect(f.reader.select('history','row1')).toBe(false);expect(f.reader.snapshot().selected).toBeUndefined();expect(f.reader.snapshot().page).toBe(page);f.reader.dispose();
});

test('null source never implicitly retains public content; only explicit guarded retainPublic enables the detached lease',()=>{
 const implicit=fixture('public',()=>true,()=>true);implicit.reader.page('history',0);implicit.reader.select('history','row0');implicit.current=null;expect(implicit.reader.snapshot()).toEqual({});implicit.reader.dispose();
 const explicit=fixture('public',()=>true,()=>true);explicit.reader.page('history',0);explicit.reader.select('history','row0');const prior=explicit.reader.snapshot().selected;explicit.current=null;expect(explicit.reader.retainPublic()).toBe(true);expect(explicit.reader.snapshot()).toEqual({catalogId:'history',selected:prior});expect(explicit.reader.page('history',0)).toBe(false);explicit.reader.revoke();expect(explicit.reader.snapshot()).toEqual({});explicit.reader.dispose();
});
test('successful selection mints a unique frozen receipt only after owned commit and replaces directly',()=>{
 const changed=vi.fn();const f=fixture('public',()=>true,()=>true,changed);f.reader.page('history',0);expect(changed).not.toHaveBeenCalled();f.reader.select('history','row0');const first=f.reader.snapshot().selection!;
 expect(first).toMatchObject({catalogId:'history',revision:'r1',entryId:'row0',scope:offer().scope});expect(Object.isFrozen(first.scope)).toBe(true);expect(changed.mock.calls).toEqual([[first]]);expect(f.reader.selectionCurrent(first.id)).toBe(true);expect(f.reader.selectionCurrent('guessed')).toBe(false);
 f.reader.select('history','row1');const second=f.reader.snapshot().selection!;expect(second.id).not.toBe(first.id);expect(changed.mock.calls).toEqual([[first],[second]]);expect(f.reader.selectionCurrent(first.id)).toBe(false);f.reader.deselect();expect(changed.mock.calls).toEqual([[first],[second],[null]]);
});
test('same-revision metadata epochs and page navigation preserve receipt; catalog revision retires only mutation authority',()=>{
 const changed=vi.fn(),f=fixture('public',()=>true,()=>true,changed);f.reader.page('history',0);f.reader.select('history','row0');const before=f.reader.snapshot();f.current={...f.current,epoch:2,offers:[{...offer(),title:'새 제목'}]};
 expect(f.reader.snapshot().selection).toBe(before.selection);expect(f.reader.selectionCurrent(before.selection!.id)).toBe(true);f.reader.page('history',1);expect(f.reader.snapshot().selection).toBe(before.selection);expect(changed).toHaveBeenCalledTimes(1);
 f.current={...f.current,epoch:3,offers:[{...offer(),revision:'r2'}]};expect(f.reader.snapshot().selected).toBe(before.selected);expect(f.reader.snapshot().selection).toBeUndefined();expect(changed).toHaveBeenLastCalledWith(null);expect(f.reader.selectionCurrent(before.selection!.id)).toBe(false);
});
test('explicit public retention keeps only readonly selected content and emits receipt retirement',()=>{
 const changed=vi.fn(),f=fixture('public',()=>true,()=>true,changed);f.reader.page('history',0);f.reader.select('history','row0');const before=f.reader.snapshot();f.current=null;expect(f.reader.retainPublic()).toBe(true);expect(f.reader.snapshot().selected).toBe(before.selected);expect(f.reader.snapshot().selection).toBeUndefined();expect(changed).toHaveBeenLastCalledWith(null);expect(f.reader.selectionCurrent(before.selection!.id)).toBe(false);
 f.current={offers:[offer()],context,epoch:3,readable:true};expect(f.reader.snapshot().selection).toBeUndefined();
});
test('mutation receipt requires a strict new-read native guard, never just retention permission',()=>{
 const absent=fixture('public',undefined,()=>true);absent.reader.page('history',0);absent.reader.select('history','row0');expect(absent.reader.selectionCurrent(absent.reader.snapshot().selection!.id)).toBe(false);
 for(const response of [false,1,Promise.resolve(true)]){let good=true;const f=fixture('public',()=>good?true:response as boolean,()=>true);f.reader.page('history',0);f.reader.select('history','row0');const receipt=f.reader.snapshot().selection!;good=false;expect(f.reader.selectionCurrent(receipt.id)).toBe(false);}
});
test('new-read native guard reentry cannot admit a receipt after revoke, dispose, or source replacement',()=>{
 for(const mode of ['revoke','dispose','revision']){let armed=false;const f=fixture('public',()=>{if(armed){armed=false;if(mode==='revision')f.current={...f.current,epoch:2,offers:[{...offer(),revision:'r2'}]};else f.reader[mode as 'revoke'|'dispose']();}return true;},()=>true);f.reader.page('history',0);f.reader.select('history','row0');const receipt=f.reader.snapshot().selection!;armed=true;expect(f.reader.selectionCurrent(receipt.id)).toBe(false);expect(f.reader.snapshot().selection).toBeUndefined();}
});
test('notification reentry clears committed receipt without resurrection and delivers final null',()=>{
 for(const mode of ['revoke','dispose','revision']){let f:ReturnType<typeof fixture>;const seen:(string|null)[]=[];f=fixture('public',()=>true,()=>true,receipt=>{seen.push(receipt?.id??null);if(receipt){expect(f.reader.selectionCurrent(receipt.id)).toBe(false);if(mode==='revision')f.current={...f.current,epoch:2,offers:[{...offer(),revision:'r2'}]};else f.reader[mode as 'revoke'|'dispose']();}});f.reader.page('history',0);f.reader.select('history','row0');expect(seen).toHaveLength(2);expect(seen[1]).toBeNull();expect(f.reader.snapshot().selection).toBeUndefined();}
});
test('throwing selection notifications do not lose ownership; failed policy reads never mint a receipt',()=>{
 const f=fixture('public',()=>true,()=>true,()=>{throw Error('notification failed');});f.reader.page('history',0);expect(f.reader.select('history','row0')).toBe(true);const receipt=f.reader.snapshot().selection!;expect(f.reader.selectionCurrent(receipt.id)).toBe(true);f.reader.deselect();f.select.mockImplementation(()=>{throw Error('unreadable');});expect(f.reader.select('history','row1')).toBe(false);expect(f.reader.snapshot().selection).toBeUndefined();
});
test('receipt retires on unreadable checkpoint and audience/private scope loss',()=>{
 for(const visibility of ['public','audience'] as const){const changed=vi.fn(),f=fixture(visibility,()=>true,()=>true,changed);f.reader.page('history',0);f.reader.select('history','row0');f.current={...f.current,epoch:2,readable:false};expect(f.reader.snapshot().selection).toBeUndefined();expect(changed).toHaveBeenLastCalledWith(null);}
});
test('public selected content may survive audience reseating but its mutation receipt cannot',()=>{
 const changed=vi.fn(),f=fixture('public',()=>true,()=>true,changed);f.reader.page('history',0);f.reader.select('history','row0');const before=f.reader.snapshot();f.current={...f.current,epoch:2,context:{...context,audience:'alice:1'}};
 expect(f.reader.snapshot().selected).toBe(before.selected);expect(f.reader.snapshot().selection).toBeUndefined();expect(changed).toHaveBeenLastCalledWith(null);expect(f.reader.selectionCurrent(before.selection!.id)).toBe(false);
});
test('each explicit close lifecycle retires a published receipt exactly once',()=>{
 for(const method of ['deselect','revoke','dispose'] as const){const changed=vi.fn(),f=fixture('public',()=>true,()=>true,changed);f.reader.page('history',0);f.reader.select('history','row0');f.reader[method]();f.reader[method]();expect(changed.mock.calls.map(call=>call[0]?.id??null)).toEqual([expect.any(String),null]);expect(f.reader.snapshot().selection).toBeUndefined();}
});

const settleRead=async()=>{for(let index=0;index<8;index++)await Promise.resolve();};
test('async selection commits an owned document and receipt only after the current result settles',async()=>{
 const f=fixture('audience');let resolve!:(value:DisclosureDocument)=>void;f.select.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 f.reader.page('history',0);expect(f.reader.select('history','row0')).toBe(true);
 expect(f.reader.snapshot()).toMatchObject({pending:{catalogId:'history',entryId:'row0',status:'loading'}});expect(f.reader.snapshot().selection).toBeUndefined();
 const signal=f.select.mock.calls[0][2]!.signal;expect(signal.aborted).toBe(false);const raw=selected('row0');resolve(raw);await settleRead();
 expect(f.reader.snapshot().pending).toBeUndefined();expect(f.reader.snapshot().selected).toEqual(raw);expect(f.reader.snapshot().selected).not.toBe(raw);expect(f.reader.snapshot().selection?.entryId).toBe('row0');f.reader.dispose();
});
test('cancel and reopen cannot reuse a raw async invocation slot before actual settlement',async()=>{
 const f=fixture();let resolve!:(value:DisclosureDocument)=>void;f.select.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 f.reader.page('history',0);f.reader.select('history','row0');const signal=f.select.mock.calls[0][2]!.signal;
 let abortSnapshot:unknown;signal.addEventListener('abort',()=>{abortSnapshot=f.reader.snapshot();expect(f.reader.select('history','row1')).toBe(false);});
 f.reader.revoke();expect(signal.aborted).toBe(true);expect(abortSnapshot).toEqual({});f.reader.page('history',0);expect(f.reader.select('history','row1')).toBe(false);expect(f.select).toHaveBeenCalledTimes(1);
 resolve(selected('row0'));await settleRead();expect(f.reader.snapshot().selected).toBeUndefined();f.select.mockImplementation((_,id)=>selected(id));expect(f.reader.select('history','row1')).toBe(true);f.reader.dispose();
});
test('async resolution and rejection after source replacement, revoke or dispose never publish private data',async()=>{
 for(const terminal of ['source','native','revoke','dispose','reject']){
  let native=true;const f=fixture('audience',()=>native);let resolve!:(value:DisclosureDocument)=>void,reject!:(reason:unknown)=>void;
  f.select.mockImplementation(()=>new Promise((done,fail)=>{resolve=done;reject=fail;}));f.reader.page('history',0);f.reader.select('history','row0');
  if(terminal==='source')f.current={...f.current,epoch:2};if(terminal==='native')native=false;if(terminal==='revoke')f.reader.revoke();if(terminal==='dispose')f.reader.dispose();
  if(terminal==='reject')reject(Error('secret remote details'));else resolve(selected('row0'));await settleRead();
  expect(f.reader.snapshot().selected).toBeUndefined();expect(f.reader.snapshot().selection).toBeUndefined();expect(f.reader.snapshot().pending?.status).not.toBe('loading');
  if(terminal==='reject')expect(f.reader.snapshot().error).toBe('기록을 읽지 못했어요. 다시 열어주세요.');f.reader.dispose();
 }
});
test('immediate async results notify once after mutation and notification reentry cannot resurrect revoked data',async()=>{
 let current:DisclosureReadSource={offers:[{...offer(),total:1}],context,epoch:1,readable:true},notifications=0;
 const reader=createDisclosureReader({readCurrent:()=>current,policies:[{id:'history:v1',page:(item)=>({catalogId:item.id,revision:item.revision,page:0,total:1,pageSize:12,entries:[{id:'row0',title:'기록'}]}),select:(_,id)=>Promise.resolve(selected(id))}],onChange:()=>{notifications++;expect(reader.snapshot().selected?.entryId).toBe('row0');reader.revoke();}});
 reader.page('history',0);expect(reader.select('history','row0')).toBe(true);await settleRead();expect(notifications).toBe(1);expect(reader.snapshot()).toEqual({});reader.dispose();
});
test('async failure replaces the previous selected record and never grants an old receipt under the new row',async()=>{
 const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');f.select.mockImplementation(()=>Promise.reject(Error('private error')));expect(f.reader.select('history','row1')).toBe(true);
 expect(f.reader.snapshot().selected).toBeUndefined();expect(f.reader.snapshot().selection).toBeUndefined();await settleRead();expect(f.reader.snapshot().pending).toEqual({catalogId:'history',entryId:'row1',status:'failed'});expect(f.reader.snapshot().error).not.toContain('private error');f.reader.dispose();
});

test('replacement snapshots abort pending work immediately and invalid page commands do not cancel a current read',async()=>{
 const f=fixture('audience');let resolve!:(value:DisclosureDocument)=>void;f.select.mockImplementation(()=>new Promise(done=>{resolve=done;}));f.reader.page('history',0);f.reader.select('history','row0');const signal=f.select.mock.calls[0][2]!.signal;
 expect(f.reader.page('unknown',0)).toBe(false);expect(f.reader.page('history',-1)).toBe(false);expect(signal.aborted).toBe(false);
 f.current={...f.current,epoch:2};expect(f.reader.snapshot()).toEqual({});expect(signal.aborted).toBe(true);resolve(selected('row0'));await settleRead();expect(f.reader.snapshot()).toEqual({});f.reader.dispose();
});
test('thenable reentry and throwing providers cannot bypass the raw invocation bound or recover an old receipt',async()=>{
 const f=fixture();f.reader.page('history',0);f.reader.select('history','row0');let settle!:(value:DisclosureDocument)=>void;
 f.select.mockImplementation(()=>({then(resolve:(value:DisclosureDocument)=>void){expect(f.reader.select('history','row1')).toBe(false);settle=resolve;}} as unknown as Promise<DisclosureDocument>));
 expect(f.reader.select('history','row1')).toBe(true);await Promise.resolve();f.reader.deselect();expect(f.reader.select('history','row0')).toBe(false);settle(selected('row1'));await settleRead();expect(f.reader.snapshot().selected).toBeUndefined();
 f.select.mockImplementation(()=>{throw Error('secret');});expect(f.reader.select('history','row0')).toBe(false);expect(f.reader.snapshot().selection).toBeUndefined();expect(f.reader.snapshot().pending?.status).toBe('failed');f.reader.dispose();
});
