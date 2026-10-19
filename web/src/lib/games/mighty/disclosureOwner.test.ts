import {expect,test} from 'vitest';
import {createMightyDisclosureOwner} from './disclosureOwner';
import {completionFixture} from './testSupport/completionFixture';
import type {ConnectedDisclosureContext} from '../../table/foundation/connectedDisclosures';
import type {Mighty} from './types';
import {createDisclosureReader,type DisclosureReadSource} from '../../table/foundation/disclosureSession';
import {createDisclosureController} from '../../table/foundation/disclosureController';
import {ownDisclosureOffer,ownDisclosurePage,ownDisclosureDocument} from '../../table/foundation/disclosures';
function context():ConnectedDisclosureContext<Mighty>{const f=completionFixture();return {client:{room:f.room,seat:f.seat,viewerId:f.actorId,viewerName:'Bob'},roomScope:f.scope!,context:{session:'mighty:room:2',audience:'bob:0',generation:'2',revision:'1'},sourceRevision:'history:1',connectionEpoch:'connection',publicHistory:{current:{sessionId:2,records:[f.room!.current_hand!]},archives:[]}};}
test('room owner exposes only the exact current replay, without history or device sources',()=>{
 const owner=createMightyDisclosureOwner(),input=context();let visits=0;
 Object.defineProperty(input,'publicHistory',{get(){visits++;throw Error('archive source must stay unread');},enumerable:true});Object.defineProperty(input.client,'game',{get(){visits++;throw Error('private game read');},enumerable:true});
 const projected=owner.project(input);expect(visits).toBe(0);expect(projected.offers).toHaveLength(1);const offer=ownDisclosureOffer(projected.offers[0]);expect(offer).toMatchObject({id:'mighty:current-hand',title:'이번 판 다시 보기',total:1,pageSize:12});
 expect(projected.menuItems).toEqual([{id:'mighty:current-hand-replay',label:'이번 판 다시 보기',catalogId:offer.id}]);expect(projected.outcomeDetailsCatalogId).toBe(offer.id);expect(projected.forms).toBeUndefined();expect(projected.formActions).toBeUndefined();expect(owner.policies).toHaveLength(1);
 expect(JSON.stringify(projected)).not.toMatch(/지난 판|내 기록|Old Alice|Normal|records/);
 const policy=owner.policies[0],page=ownDisclosurePage(policy.page(offer,0),offer,0),doc=ownDisclosureDocument(policy.select(offer,page.entries[0].id));expect(page.entries).toHaveLength(1);expect(page.entries[0].group).toBeUndefined();expect(doc.title).toBe('이번 판 다시 보기');expect(doc.roster[1].name).toBe('Old Bob');
});
test('new hand removes replay entry and denies stale new reads while selected public value stays frozen',()=>{
 const owner=createMightyDisclosureOwner(),input=context(),offer=owner.project(input).offers[0],policy=owner.policies[0],page=policy.page(offer,0),doc=ownDisclosureDocument(policy.select(offer,page.entries[0].id));
 input.client.room!.in_hand=true;expect(owner.project(input)).toEqual({offers:[],menuItems:[]});expect(()=>policy.page(offer,0)).toThrow();expect(()=>policy.select(offer,page.entries[0].id)).toThrow();expect(doc.roster[1].name).toBe('Old Bob');
 owner.revoke();expect(()=>policy.page(offer,0)).toThrow();owner.dispose();input.client.room!.in_hand=false;expect(owner.project(input)).toEqual({offers:[],menuItems:[]});
});
test('wrong native actor, game, session or seat retires current read',()=>{
 for(const kind of ['actor','game','session','seat']as const){const owner=createMightyDisclosureOwner(),input=context(),offer=owner.project(input).offers[0],policy=owner.policies[0];
  if(kind==='actor')input.roomScope.actor_id='foreign';if(kind==='game')input.client.room!.game='poker';if(kind==='session')input.roomScope.session_id=3;if(kind==='seat')input.roomScope.seat=1;
  expect(owner.project(input)).toEqual({offers:[],menuItems:[]});expect(()=>policy.page(offer,0)).toThrow();}
});
test('score reset preserves stamped prior-origin replay without comparing native hand counter',()=>{
 const owner=createMightyDisclosureOwner(),input=context();input.roomScope.session_id=3;input.client.room!.session_id=3;input.roomScope.hand=0;
 const offer=owner.project(input).offers[0],policy=owner.policies[0],page=policy.page(offer,0),doc=ownDisclosureDocument(policy.select(offer,page.entries[0].id));expect(doc.roster[1].name).toBe('Old Bob');expect(page.entries[0].id).toContain('2,3');
});
test('missing, accessor, future or malformed producer origin never becomes guessed current replay',()=>{
 for(const kind of ['missing','accessor','future','number']as const){const owner=createMightyDisclosureOwner(),input=context(),record=input.client.room!.current_hand!;let reads=0;
  if(kind==='missing')delete record.session_id;if(kind==='accessor')Object.defineProperty(record,'session_id',{get(){reads++;throw Error();},enumerable:true});if(kind==='future')record.session_id=3;if(kind==='number')record.number=0;
  expect(owner.project(input)).toEqual({offers:[],menuItems:[]});expect(reads).toBe(0);}
});
test('replacement live names and old archive rows cannot relabel or retarget current replay',()=>{
 const owner=createMightyDisclosureOwner(),input=context();Object.defineProperty(input.publicHistory.current,'records',{value:[{...input.client.room!.current_hand!,number:999,names:Array(5).fill('Archive name')}],enumerable:true});
 input.client.room!.participant_ids=Array(5).fill('replacement');const offer=owner.project(input).offers[0],policy=owner.policies[0],page=policy.page(offer,0),doc=ownDisclosureDocument(policy.select(offer,page.entries[0].id));expect(doc.roster.map(person=>person.name)).toContain('Old Bob');expect(JSON.stringify(doc)).not.toContain('Archive name');
});

test('open singleton keeps only frozen public replay through next hand/new Done and Close republishes latest',()=>{
 const owner=createMightyDisclosureOwner();let input=context();const readContext={roomId:'room',roomEpoch:'epoch',actorId:'bob',connectionEpoch:'connection',audience:'bob:0'};
 let projection=owner.project(input),source:DisclosureReadSource={offers:projection.offers,context:readContext,epoch:1,readable:true};
 const publish=()=>{projection=owner.project(input);source={...source,offers:projection.offers,epoch:Number(source.epoch)+1};};
 const reader=createDisclosureReader({readCurrent:()=>source,policies:owner.policies,isRetainedCurrent:()=>true,onSelectionChanged(receipt){owner.selectionChanged!(receipt);publish();}});
 const port={page:reader.page,select:reader.select,snapshot:reader.snapshot,deselect:reader.deselect,close:reader.revoke},controller=createDisclosureController({readCurrent:()=>({offers:projection.offers,port})});
 expect(controller.open(projection.offers[0].id)).toBe(true);const opened=controller.snapshot()!,frozen=opened.selected!;expect(frozen.roster[1].name).toBe('Old Bob');expect(opened.page?.entries).toHaveLength(1);
 input.client.room!.in_hand=true;publish();expect(projection.menuItems).toEqual([]);expect(projection.outcomeDetailsCatalogId).toBeUndefined();expect(controller.snapshot()?.selected).toBe(frozen);expect(JSON.stringify(projection)).not.toMatch(/Old Bob|Normal|record|source/);expect(()=>owner.policies[0].page(projection.offers[0],0)).toThrow();
 const oldOffer=projection.offers[0],newRecord={...completionFixture().room!.current_hand!,number:4,names:['New Alice','New Bob','New Carol','New Dan','New Eve']};input.client.room!.current_hand=newRecord;input.client.room!.in_hand=false;input={...input,sourceRevision:'current:4'};publish();expect(projection.offers).toEqual([oldOffer]);expect(projection.menuItems).toEqual([]);expect(controller.snapshot()?.selected).toBe(frozen);expect(frozen.roster[1].name).toBe('Old Bob');expect(()=>owner.policies[0].page(oldOffer,0)).toThrow();
 controller.close();expect(projection.menuItems).toHaveLength(1);expect(projection.offers[0].revision).not.toBe(oldOffer.revision);expect(controller.open(projection.offers[0].id)).toBe(true);expect(controller.snapshot()?.selected?.roster[1].name).toBe('New Bob');controller.close();reader.dispose();owner.dispose();
});
test('selected metadata is cleared on audience change or explicit owner revocation',()=>{
 const owner=createMightyDisclosureOwner();let input=context();const offer=owner.project(input).offers[0],page=owner.policies[0].page(offer,0);owner.policies[0].select(offer,page.entries[0].id);
 owner.selectionChanged!({id:'selected',catalogId:offer.id,revision:offer.revision,entryId:page.entries[0].id,scope:offer.scope});input.client.room!.in_hand=true;expect(owner.project(input).offers).toEqual([offer]);
 input={...input,context:{...input.context,audience:'bob:spectator'}};expect(owner.project(input)).toEqual({offers:[],menuItems:[]});expect(()=>owner.policies[0].page(offer,0)).toThrow();owner.revoke();expect(owner.project(input)).toEqual({offers:[],menuItems:[]});
});
