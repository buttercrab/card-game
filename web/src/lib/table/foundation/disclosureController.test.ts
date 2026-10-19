import {expect,test,vi} from 'vitest';
import {createDisclosureController,type DisclosureControllerSource} from './disclosureController';
import {createDisclosureReader,type DisclosureReadSource} from './disclosureSession';
import type {DisclosureCatalogOffer,DisclosureReadPolicy} from './disclosures';
import type {DisclosureDocument} from './disclosureTypes';
const context={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'socket',audience:'alice:0'};
function fixture(total=25,onChange?:()=>void){
 const offer:DisclosureCatalogOffer={id:'records',policyId:'records:v1',revision:'r1',title:'기록',total,pageSize:12,scope:{...context,visibility:'public'}};
 // Public scopes do not carry a private audience.
 delete (offer.scope as {audience?:string}).audience;
 let source:DisclosureReadSource|null={offers:[offer],context,epoch:1,readable:true},native=true;
 const document=(entryId:string):DisclosureDocument=>({entryId,title:'완료한 판',roster:[],cards:[],sections:[{kind:'content',id:'summary',title:'요약'},{kind:'rounds',id:'rounds',title:'라운드',rounds:[{id:'r7',title:'7',plays:[]},{id:'r9',title:'9',plays:[]}]},{kind:'matrix',id:'matrix',title:'행렬',columns:Array.from({length:10},(_,index)=>({id:`column${index+4}`,label:String(index+4)})),rows:[]}]});
 const page=vi.fn<DisclosureReadPolicy['page']>((current,index)=>({catalogId:current.id,revision:current.revision,page:index,total:current.total,pageSize:12,entries:Array.from({length:Math.min(12,total-index*12)},(_,offset)=>({id:`entry${index*12+offset}`,title:'판'}))}));
 const select=vi.fn<DisclosureReadPolicy['select']>((_,id)=>document(id));
 const reader=createDisclosureReader({readCurrent:()=>source,policies:[{id:offer.policyId,page,select}],isRetainedCurrent:()=>native,onChange});
 const port={page:reader.page,select:reader.select,snapshot:reader.snapshot,deselect:reader.deselect,close:vi.fn(reader.revoke)};
 let projection:DisclosureControllerSource|null={offers:source.offers,port};
 let currentHook:(()=>void)|undefined;
 const controller=createDisclosureController({readCurrent:()=>{currentHook?.();return projection;}});
 return{controller,reader,page,select,port,offer,get source():DisclosureReadSource{return source!;},set source(value:DisclosureReadSource|null){source=value;projection={offers:value?.offers??[],port};},set native(value:boolean){native=value;},set currentHook(value:(()=>void)|undefined){currentHook=value;},set projection(value:DisclosureControllerSource|null){projection=value;}};
}
function choose(f:ReturnType<typeof fixture>,id='entry0'){const view=f.controller.snapshot()!;expect(f.controller.intent({kind:'entry',leaseId:view.leaseId,entryId:id})).toBe(true);return f.controller.snapshot()!;}
test('only offered catalogs open, with one bounded first page and no guessed entry read',()=>{
 const f=fixture();expect(f.controller.open('unknown')).toBe(false);expect(f.page).not.toHaveBeenCalled();expect(f.controller.open('records')).toBe(true);
 const view=f.controller.snapshot()!;expect(view.page?.entries).toHaveLength(12);expect(f.controller.intent({kind:'entry',leaseId:view.leaseId,entryId:'entry12'})).toBe(false);expect(f.select).not.toHaveBeenCalled();expect(Object.isFrozen(view)).toBe(true);
});
test('a sole current metadata row automatically selects, while an empty catalog stays a list',()=>{
 const single=fixture(1);expect(single.controller.open('records')).toBe(true);expect(single.controller.snapshot()?.selected?.entryId).toBe('entry0');expect(single.select).toHaveBeenCalledTimes(1);
 const empty=fixture(0);expect(empty.controller.open('records')).toBe(true);expect(empty.controller.snapshot()?.page?.entries).toEqual([]);expect(empty.select).not.toHaveBeenCalled();
});
test('catalog cursors reject unbounded values, and old leases cannot select after close and reopen',()=>{
 const f=fixture();f.controller.open('records');const old=f.controller.snapshot()!;
 for(const page of [-1,3,1.5,Infinity])expect(f.controller.intent({kind:'catalog-page',leaseId:old.leaseId,page})).toBe(false);
 expect(f.page).toHaveBeenCalledTimes(1);expect(f.controller.intent({kind:'catalog-page',leaseId:old.leaseId,page:1})).toBe(true);expect(f.controller.snapshot()?.leaseId).toBe(old.leaseId);
 f.controller.close();f.controller.open('records');expect(f.controller.intent({kind:'entry',leaseId:old.leaseId,entryId:'entry0'})).toBe(false);expect(f.select).not.toHaveBeenCalled();
});
test('selected identity retires the list lease, and section/round/offset navigation preserves viewer lease',()=>{
 const f=fixture();f.controller.open('records');const list=f.controller.snapshot()!,view=choose(f);expect(view.leaseId).not.toBe(list.leaseId);
 expect(f.controller.intent({kind:'entry',leaseId:list.leaseId,entryId:'entry1'})).toBe(false);
 const base={leaseId:view.leaseId,entryId:'entry0'};
 expect(f.controller.intent({...base,kind:'round',sectionId:'rounds',index:1})).toBe(false);
 expect(f.controller.intent({...base,kind:'section',sectionId:'rounds'})).toBe(true);
 expect(f.controller.intent({...base,kind:'round',sectionId:'rounds',index:1})).toBe(true);
 expect(f.controller.intent({...base,kind:'round',sectionId:'rounds',index:9})).toBe(false);
 expect(f.controller.intent({...base,kind:'section',sectionId:'matrix'})).toBe(true);
 expect(f.controller.intent({...base,kind:'matrix-page',sectionId:'matrix',start:7})).toBe(true);
 expect(f.controller.snapshot()).toMatchObject({leaseId:view.leaseId,sectionId:'matrix',matrixStart:7,roundIndex:0});
 expect(f.controller.intent({...base,kind:'matrix-page',sectionId:'matrix',start:10})).toBe(false);
 expect(f.controller.intent({...base,kind:'section',sectionId:'foreign'})).toBe(false);
 expect(f.controller.intent({...base,entryId:'entry1',kind:'section',sectionId:'summary'})).toBe(false);
});
test('record steps load only adjacent metadata at a page boundary and select the exact opaque row',()=>{
 const f=fixture();f.controller.open('records');let view=choose(f,'entry11');expect(f.controller.intent({kind:'record-step',leaseId:view.leaseId,entryId:'entry11',direction:1})).toBe(true);
 const previousLease=view.leaseId;view=f.controller.snapshot()!;expect(view.selected?.entryId).toBe('entry12');expect(f.page.mock.calls.map(call=>call[1])).toEqual([0,1]);expect(view.leaseId).not.toBe(previousLease);
 expect(f.controller.intent({kind:'record-step',leaseId:view.leaseId,entryId:'entry11',direction:1})).toBe(false);
 expect(f.controller.intent({kind:'record-step',leaseId:view.leaseId,entryId:'entry12',direction:-1})).toBe(true);expect(f.controller.snapshot()?.selected?.entryId).toBe('entry11');expect(f.page.mock.calls.map(call=>call[1])).toEqual([0,1,0]);
});
test('Back deselects to the current page, then closes the catalog and clears its reader',()=>{
 const f=fixture();f.controller.open('records');const detail=choose(f);expect(f.controller.intent({kind:'back',leaseId:detail.leaseId})).toBe(true);
 const list=f.controller.snapshot()!;expect(list.selected).toBeUndefined();expect(list.page).toBeDefined();expect(list.leaseId).not.toBe(detail.leaseId);
 expect(f.controller.intent({kind:'back',leaseId:list.leaseId})).toBe(true);expect(f.controller.snapshot()).toBeUndefined();expect(f.reader.snapshot()).toEqual({});
});
test('a public detached selected record survives a neutral shell; Back cannot discard it without a fresh list',()=>{
 const f=fixture();f.controller.open('records');const before=choose(f);f.source=null;expect(f.reader.retainPublic()).toBe(true);
 const retained=f.controller.snapshot()!;expect(retained.selected).toBe(before.selected);expect(retained.page).toBeUndefined();expect(retained.leaseId).toBe(before.leaseId);
 expect(f.controller.intent({kind:'back',leaseId:retained.leaseId})).toBe(false);expect(f.controller.snapshot()?.selected).toBe(before.selected);expect(f.page).toHaveBeenCalledTimes(1);
 f.source={offers:[{...f.offer,revision:'r2'}],context:{...context,audience:'alice:reseated'},epoch:2,readable:true};
 expect(f.controller.intent({kind:'back',leaseId:retained.leaseId})).toBe(true);expect(f.controller.snapshot()?.selected).toBeUndefined();expect(f.controller.snapshot()?.page?.revision).toBe('r2');
});
test('native identity loss or ordinary catalog removal closes the local viewer immediately',()=>{
 for(const mode of ['native','removed']){const f=fixture();f.controller.open('records');const view=choose(f);if(mode==='native')f.native=false;else f.source={...f.source,offers:[],epoch:2};
 expect(f.controller.snapshot()).toBeUndefined();expect(f.controller.intent({kind:'section',leaseId:view.leaseId,entryId:'entry0',sectionId:'summary'})).toBe(false);}
});
test('same-count replacement retires old page navigation but retains the frozen public detail',()=>{
 const f=fixture();f.controller.open('records');const view=choose(f);f.source={...f.source,offers:[{...f.offer,revision:'r2'}],epoch:2};
 expect(f.controller.snapshot()?.selected).toBe(view.selected);expect(f.controller.snapshot()?.page).toBeUndefined();
 expect(f.controller.intent({kind:'record-step',leaseId:view.leaseId,entryId:'entry0',direction:1})).toBe(false);expect(f.select).toHaveBeenCalledTimes(1);
});
test('provider reentry close or dispose cannot resurrect an opened list or detail',()=>{
 for(const operation of ['page','select'] as const)for(const terminal of ['close','dispose'] as const){const f=fixture();if(operation==='select')f.controller.open('records');
 const fn=operation==='page'?f.page:f.select,original=fn.getMockImplementation()!;fn.mockImplementation(((...args:unknown[])=>{f.controller[terminal]();return (original as (...args:unknown[])=>unknown)(...args);}) as never);
 if(operation==='page')expect(f.controller.open('records')).toBe(false);else{const view=f.controller.snapshot()!;expect(f.controller.intent({kind:'entry',leaseId:view.leaseId,entryId:'entry0'})).toBe(false);}
 expect(f.controller.snapshot()).toBeUndefined();expect(f.reader.snapshot()).toEqual({});}
});
test('source callback reentry cannot commit navigation or recursively read',()=>{
 const f=fixture();f.controller.open('records');const view=choose(f);let once=true;f.currentHook=()=>{expect(f.controller.snapshot()).toBeUndefined();if(once){once=false;f.controller.close();}};
 expect(f.controller.intent({kind:'section',leaseId:view.leaseId,entryId:'entry0',sectionId:'rounds'})).toBe(false);expect(f.controller.snapshot()).toBeUndefined();
});
test('native retention changing during the intent source read cannot accept stale detail navigation',()=>{
 const f=fixture();f.controller.open('records');const view=choose(f);let reads=0;f.currentHook=()=>{if(++reads===2)f.native=false;};
 expect(f.controller.intent({kind:'section',leaseId:view.leaseId,entryId:'entry0',sectionId:'rounds'})).toBe(false);expect(f.controller.snapshot()).toBeUndefined();
});
test('a replaced read port cannot inherit an earlier viewer lease or receive close from it',()=>{
 const f=fixture();f.controller.open('records');const view=choose(f);const replacement={...f.port,close:vi.fn()};f.projection={offers:[f.offer],port:replacement};
 expect(f.controller.snapshot()).toBeUndefined();expect(f.controller.intent({kind:'close',leaseId:view.leaseId})).toBe(false);expect(replacement.close).not.toHaveBeenCalled();
});
test('read callback errors are contained and terminal disposal never reopens',()=>{
 const f=fixture();f.page.mockImplementation(()=>{throw Error('provider failure');});expect(f.controller.open('records')).toBe(false);expect(f.controller.snapshot()).toBeUndefined();f.controller.dispose();expect(f.controller.open('records')).toBe(false);expect(f.reader.snapshot()).toEqual({});
});

test('a singleton selection failure still opens its valid bounded list with a readable error',()=>{
 const f=fixture(1);f.select.mockImplementation(()=>{throw Error('unavailable record');});expect(f.controller.open('records')).toBe(true);expect(f.controller.snapshot()?.page?.entries).toHaveLength(1);expect(f.controller.snapshot()?.selected).toBeUndefined();expect(f.controller.snapshot()?.error).toBeDefined();
});

test('pending async selection has a fresh modal lease, hides the old record, and Back and Close cancel safely',async()=>{
 const f=fixture();f.controller.open('records');const list=f.controller.snapshot()!;let resolve!:(value:DisclosureDocument)=>void;
 f.select.mockImplementation(()=>new Promise(done=>{resolve=done;}));expect(f.controller.intent({kind:'entry',leaseId:list.leaseId,entryId:'entry0'})).toBe(true);
 const pending=f.controller.snapshot()!;expect(pending.leaseId).not.toBe(list.leaseId);expect(pending.pending?.entryId).toBe('entry0');expect(pending.selected).toBeUndefined();
 expect(f.controller.intent({kind:'entry',leaseId:pending.leaseId,entryId:'entry1'})).toBe(false);
 expect(f.controller.intent({kind:'back',leaseId:pending.leaseId})).toBe(true);expect(f.select.mock.calls[0][2]!.signal.aborted).toBe(true);expect(f.controller.snapshot()?.pending).toBeUndefined();
 resolve({entryId:'entry0',title:'late',roster:[],cards:[],sections:[{kind:'content',id:'summary',title:'summary'}]});for(let index=0;index<8;index++)await Promise.resolve();expect(f.controller.snapshot()?.selected).toBeUndefined();
 const reopened=f.controller.snapshot()!;expect(f.controller.intent({kind:'entry',leaseId:reopened.leaseId,entryId:'entry1'})).toBe(true);const second=f.controller.snapshot()!;expect(f.controller.intent({kind:'close',leaseId:second.leaseId})).toBe(true);expect(f.controller.snapshot()).toBeUndefined();f.reader.dispose();
});

test('sync provider failure publishes its shared failed dialog through the async observer even when entry admission returns false',async()=>{
 let painted:ReturnType<ReturnType<typeof fixture>['controller']['snapshot']>,notifications=0;
 const f=fixture(25,()=>{notifications++;painted=f.controller.snapshot();});f.controller.open('records');const list=f.controller.snapshot()!;
 f.select.mockImplementation(()=>{throw Error('private');});expect(f.controller.intent({kind:'entry',leaseId:list.leaseId,entryId:'entry0'})).toBe(false);
 for(let index=0;index<8;index++)await Promise.resolve();expect(notifications).toBe(1);expect(painted!.pending?.status).toBe('failed');expect(painted!.leaseId).not.toBe(list.leaseId);expect(painted!.error).not.toContain('private');
 expect(f.controller.intent({kind:'back',leaseId:painted!.leaseId})).toBe(true);expect(f.controller.snapshot()?.pending).toBeUndefined();f.reader.dispose();
});
