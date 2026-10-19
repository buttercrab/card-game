import {expect,test} from 'vitest';
import {DISCLOSURE_LIMITS,disclosureScopeCurrent,ownDisclosureData,ownDisclosureDocument,ownDisclosureOffer,ownDisclosurePage,ownDisclosureSelectionReceipt,ownDisclosureRefresh,ownDisclosureFormActions,type DisclosureFormAction,type DisclosureCatalogOffer} from './disclosures';
import type {FormOffer} from './forms';
import type {DisclosureDocument,DisclosureSection} from './disclosureTypes';
import {createMightyHistoryDisclosure} from '../../games/mighty/historyDisclosure';
import {createMightyDeviceDisclosure} from '../../games/mighty/deviceDisclosure';
import {completionFixture} from '../../games/mighty/testSupport/completionFixture';
const context={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'connection',audience:'alice:0'};
const offer=():DisclosureCatalogOffer=>({id:'history',policyId:'history:v1',revision:'r1',title:'지난 판',total:13,pageSize:12,scope:{...context,visibility:'audience'}});
function document():DisclosureDocument{return{entryId:'row0',title:'지난 판',roster:[{id:'p0',name:'Alice'},{id:'p1',name:'Bob'}],cards:[{id:'ace',label:'♠A',visual:{kind:'standard',suit:'Spade',rank:14}}],sections:[{id:'summary',title:'요약',kind:'content',information:[{id:'score',title:'결과',fields:[{id:'winner',label:'승리',value:{kind:'participant',participantId:'p1'}}]}],cardGroups:[{id:'captured',label:'가져온 카드',personId:'p1',cardIds:['ace']}]},{id:'rounds',title:'라운드',kind:'rounds',rounds:[{id:'r0',title:'1라운드',plays:[{personId:'p0',cardId:'ace',winner:true}]}]},{id:'matrix',title:'전체 라운드',kind:'matrix',columns:[{id:'r0',label:'1'}],rows:[{personId:'p0',cells:[{cardId:'ace'}]},{personId:'p1',cells:[null]}]}]};}
test('catalog pages bind exact opaque row identities, revision, total and bounded cursor',()=>{
 const source=offer(),owned=ownDisclosureOffer(source);expect(Object.isFrozen(owned.scope)).toBe(true);
 const first={catalogId:'history',revision:'r1',page:0,total:13,pageSize:12 as const,entries:Array.from({length:12},(_,index)=>({id:`row${index}`,title:'같은 의미의 판'}))};expect(ownDisclosurePage(first,source,0).entries).toHaveLength(12);
 const last={...first,page:1,entries:[{id:'row12',title:'같은 의미의 판'}]};expect(ownDisclosurePage(last,source,1).entries[0].id).toBe('row12');
 for(const invalid of [{...last,revision:'r2'},{...last,total:14},{...last,entries:[]},{...first,entries:first.entries.map(entry=>({...entry,id:'duplicate'}))}])expect(()=>ownDisclosurePage(invalid,source,invalid.page)).toThrow();
 for(const index of [-1,1.5,2,Number.MAX_SAFE_INTEGER])expect(()=>ownDisclosurePage(last,source,index)).toThrow();
 const empty={...source,total:0};expect(ownDisclosurePage({...last,page:0,total:0,entries:[]},empty,0).entries).toEqual([]);
});
test('public scope ignores scene generations while audience scope requires the exact audience',()=>{
 const publicScope={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'connection',visibility:'public' as const};expect(disclosureScopeCurrent(publicScope,{...context,audience:'alice:new-scene'})).toBe(true);expect(disclosureScopeCurrent(offer().scope,{...context,audience:'alice:new-scene'})).toBe(false);
 for(const changed of [{roomId:'other'},{roomEpoch:'new'},{actorId:'bob'},{connectionEpoch:'new'}])expect(disclosureScopeCurrent(publicScope,{...context,...changed})).toBe(false);
 expect(()=>ownDisclosureOffer({...offer(),scope:{...publicScope,audience:'forbidden'}})).toThrow();
});
test('selected snapshots freeze local registries and resolve participant information only against that local roster',()=>{
 const source=document(),owned=ownDisclosureDocument(source,'row0');expect(owned).toEqual(source);expect(Object.isFrozen(owned.sections[0])).toBe(true);expect(Object.isFrozen(owned.cards[0].visual)).toBe(true);
 const content=owned.sections[0];if(content.kind!=='content')throw Error('content');expect(content.information![0].fields[0].value).toEqual({kind:'participant',participantId:'p1'});
 expect(()=>ownDisclosureDocument({...source,roster:source.roster.slice(0,1)})).toThrow();expect(()=>ownDisclosureDocument(source,'different-entry')).toThrow();
});
test('unknown references, mixed live authority, extra capabilities and duplicate registries fail closed',()=>{
 const source=document();const candidates:unknown[]=[{...source,cards:[{...source.cards[0],ownerId:'live-actor'}]},{...source,cards:[{...source.cards[0],entityId:'live-card'}]},{...source,actions:[]},{...source,cards:[...source.cards,...source.cards]},{...source,sections:[...source.sections,...source.sections]},
 {...source,sections:[{id:'bad',title:'bad',kind:'rounds',rounds:[{id:'r',title:'r',plays:[{personId:'stranger',cardId:'ace'}]}]}]},
 {...source,sections:[{id:'bad',title:'bad',kind:'content',cardGroups:[{id:'bad',label:'bad',cardIds:['unknown']}]}]},
 {...source,sections:[{id:'bad',title:'bad',kind:'matrix',columns:[{id:'r',label:'r'}],rows:[{personId:'p0',cells:[]}]}]}];
 for(const candidate of candidates)expect(()=>ownDisclosureDocument(candidate as DisclosureDocument)).toThrow();
 const card=source.cards[0],visual={...card.visual,onclick:()=>{}};expect(()=>ownDisclosureDocument({...source,cards:[{...card,visual}]})).toThrow();
});
test('getters are never evaluated and sparse, exotic, cyclic, deep and oversized wire data is refused',()=>{
 let reads=0;const getter=Object.defineProperty({...document()},'entryId',{get(){reads++;return 'row0';},enumerable:true});expect(()=>ownDisclosureDocument(getter)).toThrow();expect(reads).toBe(0);
 for(const candidate of [new Date(),new Array(3),{callback:()=>{}},{text:'한'.repeat(50000)}])expect(()=>ownDisclosureData(candidate)).toThrow();
 const cyclic:{self?:unknown}={};cyclic.self=cyclic;expect(()=>ownDisclosureData(cyclic)).toThrow();let deep:unknown=null;for(let index=0;index<26;index++)deep={child:deep};expect(()=>ownDisclosureData(deep)).toThrow();
});
test('public Mighty history and local device projections pass the same generic selected-document boundary',()=>{
 const f=completionFixture(),history=createMightyHistoryDisclosure({entryId:'history:duplicate-row-0',source:{identity:{roomId:'room',roomEpoch:'epoch',sessionId:2,handNumber:3},record:f.room!.current_hand!}});expect(ownDisclosureDocument(history).sections.some(section=>section.kind==='matrix')).toBe(true);
 const device=createMightyDeviceDisclosure({entryId:'device',read:{status:'ready',records:{version:1,completed:[],hands:[],unlocked:{}}}});expect(ownDisclosureDocument(device).sections).toHaveLength(3);
});
function maximumDocument():DisclosureDocument{
 const roster=Array.from({length:8},(_,index)=>({id:`p${index}`,name:`${index}${'이'.repeat(127)}`})),cards=Array.from({length:104},(_,index)=>({id:`c${index}`,label:`카드 ${index}`,visual:{kind:'standard' as const,suit:'Spade' as const,rank:2+index%13}}));
 const ref=(round:number,person:number)=>({cardId:`c${(round*8+person)%104}`,winner:person===0,leader:person===1,lead:{kind:'number' as const,value:1}});
 const sections:DisclosureSection[]=[{kind:'rounds',id:'rounds',title:'라운드별',rounds:Array.from({length:54},(_,round)=>({id:`r${round}`,title:`${round+1}라운드`,lead:{kind:'text',text:'♠'},plays:roster.map((person,index)=>({personId:person.id,...ref(round,index)}))}))},
 {kind:'matrix',id:'matrix',title:'전체 라운드',columns:Array.from({length:54},(_,index)=>({id:`r${index}`,label:String(index+1)})),rows:roster.map((person,index)=>({personId:person.id,cells:Array.from({length:54},(_,round)=>ref(round,index))}))},
 {kind:'content',id:'details',title:'결과',information:Array.from({length:4},(_,panel)=>({id:`panel${panel}`,title:'결과',fields:Array.from({length:12},(_,field)=>({id:`f${field}`,label:'점수',value:{kind:'inline',values:[{kind:'text',text:'점수'},{kind:'number',value:field},{kind:'participant',participantId:'p0'},{kind:'text',text:'확인'}]}}))}))},
 {kind:'content',id:'points',title:'점수 카드',cardGroups:roster.map((person,index)=>({id:`group${index}`,label:person.name,personId:person.id,cardIds:cards.slice(index*13,index*13+13).map(card=>card.id)}))},
 {kind:'content',id:'discards',title:'교환',cardGroups:[{id:'discard',label:'버린 카드',cardIds:[]}]},...Array.from({length:3},(_,index)=>({kind:'content' as const,id:`extra${index}`,title:'안내',information:[]}))];return{entryId:'maximum',title:'최대 구성',roster,cards,sections};
}
test('dense 8×54 model, 104 card library and full information fit explicit 128 KiB/node budgets',()=>{
 const source=maximumDocument(),bytes=new TextEncoder().encode(JSON.stringify(source)).length;const nodes=(value:unknown):number=>1+(value&&typeof value==='object'?Object.values(value).reduce<number>((sum,child)=>sum+nodes(child),0):0);const nodeCount=nodes(source);
 expect({bytes,nodes:nodeCount}).toEqual({bytes:110332,nodes:8871});
 expect(nodeCount).toBeGreaterThan(8192);expect(bytes).toBeLessThanOrEqual(DISCLOSURE_LIMITS.bytes);expect(ownDisclosureDocument(source).cards).toHaveLength(104);
});
test('array length and object key ceilings reject before amplified descriptor work',()=>{
 let arrayKeys=0,arrayDescriptors=0;const oversized=new Proxy(new Array(513),{ownKeys(target){arrayKeys++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){arrayDescriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});
 expect(()=>ownDisclosureData(oversized)).toThrow();expect(arrayDescriptors).toBe(1);expect(arrayKeys).toBe(0);
 let objectKeys=0,objectDescriptors=0;const record=new Proxy(Object.fromEntries(Array.from({length:1000},(_,index)=>[`field${index}`,index])),{ownKeys(target){objectKeys++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){objectDescriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});
 expect(()=>ownDisclosureData(record)).toThrow();expect(objectKeys).toBe(1);expect(objectDescriptors).toBe(0);
});
test('symbol and invalid array-key shapes are rejected before fetching member descriptors',()=>{
 let objectDescriptors=0;const record=new Proxy({visible:1,[Symbol('private')]:2},{getOwnPropertyDescriptor(target,key){objectDescriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});expect(()=>ownDisclosureData(record)).toThrow();expect(objectDescriptors).toBe(0);
 const array=[1];Object.defineProperty(array,'private-cache',{value:2,enumerable:true});let descriptors=0;const extra=new Proxy(array,{getOwnPropertyDescriptor(target,key){descriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});expect(()=>ownDisclosureData(extra)).toThrow();expect(descriptors).toBe(1);
});
test('admitted arrays enumerate keys once and read only bounded indexes before copying captured values',()=>{
 let keys=0,length=0,indexes=0;const values=Array.from({length:512},(_,index)=>index),proxy=new Proxy(values,{ownKeys(target){keys++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){if(key==='length')length++;else indexes++;return Reflect.getOwnPropertyDescriptor(target,key);}});
 const owned=ownDisclosureData(proxy);expect(owned).toEqual(values);expect(Object.isFrozen(owned)).toBe(true);expect({keys,length,indexes}).toEqual({keys:1,length:1,indexes:512});
});
test('selection receipts and refresh intents own exact inert bounded identities',()=>{
 const receipt={id:'engine-selection-1',catalogId:'history',revision:'r1',entryId:'row0',scope:offer().scope};const owned=ownDisclosureSelectionReceipt(receipt);expect(owned).not.toBe(receipt);expect(Object.isFrozen(owned.scope)).toBe(true);
 expect(ownDisclosureRefresh({selectionId:owned.id,catalogId:'history',revision:'r2'})).toEqual({selectionId:owned.id,catalogId:'history',revision:'r2'});
 for(const bad of [{...receipt,submit:()=>{}},{...receipt,id:''},{...receipt,scope:{...receipt.scope,owner:'live'}}])expect(()=>ownDisclosureSelectionReceipt(bad as never)).toThrow();
 expect(()=>ownDisclosureRefresh({selectionId:owned.id,catalogId:'history',revision:'r2',command:'delete'} as never)).toThrow();let reads=0;expect(()=>ownDisclosureSelectionReceipt(Object.defineProperty({...receipt},'entryId',{get(){reads++;return'row0';},enumerable:true}))).toThrow();expect(reads).toBe(0);
});
test('disclosure form references require exact current catalog and host-only form instances with bounded fanout',()=>{
 const form:FormOffer={id:'delete',instanceId:'delete:r1',schemaVersion:'1',policyId:'delete:v1',baseVersion:'r1',editBinding:'alice:r1',title:'기록 지우기',submitLabel:'지우기',enabled:true,binding:{actorId:'alice'},target:{kind:'host',operationId:'mighty:delete-stats'},fields:[{id:'confirm',label:'확인',kind:'toggle',initial:false,required:true}]};
 const link:DisclosureFormAction={id:'delete-link',label:'기록 지우기',intent:'danger',selectionId:'selection1',catalogId:'history',catalogRevision:'r1',entryId:'row0',formId:form.id,formInstanceId:form.instanceId};
 const owned=ownDisclosureFormActions([link],[offer()],[form]);expect(owned).toEqual([link]);expect(Object.isFrozen(owned[0])).toBe(true);
 for(const bad of [{...link,catalogRevision:'r2'},{...link,formInstanceId:'replacement'},{...link,selectionId:''},{...link,callback:'delete'},{...link,intent:'invented'}])expect(()=>ownDisclosureFormActions([bad] as never,[offer()],[form])).toThrow();
 expect(()=>ownDisclosureFormActions([link,link],[offer()],[form])).toThrow();expect(()=>ownDisclosureFormActions(Array.from({length:5},(_,index)=>({...link,id:`link${index}`})),[offer()],[form])).toThrow();
 expect(()=>ownDisclosureFormActions([link],[offer()],[{...form,target:{kind:'command',actionId:'game',template:{}}}])).toThrow();
 expect(()=>ownDisclosureFormActions([link],[offer()],[{...form,actions:[{id:'delete',label:'지우기',target:{kind:'host',operationId:'mighty:delete-stats'}},{id:'game',label:'다음 판',target:{kind:'command',actionId:'game',template:{}}}]}])).toThrow();
 const all=Array.from({length:33},(_,index)=>({...link,id:`link${index}`,selectionId:`selection${index}`}));expect(()=>ownDisclosureFormActions(all,[offer()],[form])).toThrow();
});

test('matrix short labels are owned bounded presentation text while full semantic labels remain intact',()=>{
 const source=document(),section=source.sections.find(section=>section.kind==='matrix') as Extract<DisclosureSection,{kind:'matrix'}>,column=section.columns[0] as {id:string;label:string;shortLabel?:string};column.label='첫 번째 라운드';column.shortLabel='1';
 const owned=ownDisclosureDocument(source);column.shortLabel='changed';const matrix=owned.sections.find(section=>section.kind==='matrix') as Extract<DisclosureSection,{kind:'matrix'}>;expect(matrix.columns[0]).toEqual({id:'r0',label:'첫 번째 라운드',shortLabel:'1'});expect(Object.isFrozen(matrix.columns[0])).toBe(true);
 for(const shortLabel of ['', ' ', 'x'.repeat(33), 1]){column.shortLabel=shortLabel as string;expect(()=>ownDisclosureDocument(source)).toThrow();}
 let reads=0;Object.defineProperty(column,'shortLabel',{get(){reads++;return '1';},enumerable:true});expect(()=>ownDisclosureDocument(source)).toThrow();expect(reads).toBe(0);
});

test('explicit card annotations are bounded semantic data, never raw rule flags',()=>{
 const source=maximumDocument(),matrix=source.sections.find(s=>s.kind==='matrix');if(matrix?.kind!=='matrix')throw Error();
 const ref=matrix.rows[0].cells[0] as unknown as Record<string,unknown>;
 ref.annotations=[{text:'효력 없음',tone:'muted'}];expect(()=>ownDisclosureDocument(source)).not.toThrow();
 for(const invalid of [[{text:'',tone:'muted'}],[{text:'효력 없음',tone:'invented'}],Array(9).fill({text:'효력 없음',tone:'muted'})]){ref.annotations=invalid;expect(()=>ownDisclosureDocument(source)).toThrow();}
 delete ref.annotations;ref.powered=true;expect(()=>ownDisclosureDocument(source)).toThrow();
});
