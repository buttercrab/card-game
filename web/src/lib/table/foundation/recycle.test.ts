import {motionFixtureResources} from './motionResourceTestFixture';
import { describe, expect, it } from 'vitest';
import type { Environment, PlannedNode, PresentationFrame, TableDocument } from './contracts';
import {recycledDealCandidates} from './transferMotion';
import {publicPaintResources} from './paintResources';
import { admitRecycle as rawAdmitRecycle, isRecycleAdmission, ownRecycleTransition } from './recycle';
const admitRecycle=(previous:PresentationFrame,next:TableDocument<unknown>,continuity:number)=>rawAdmitRecycle(previous,next,continuity,publicPaintResources(next));
const control={fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1};
const environment:Environment={width:390,height:844,fontFamily:'sans-serif',textScale:1,fontRevision:'1',revision:'1',controls:{command:control,choice:control}};
const box={x:0,y:0,width:64,height:90};
const card=(id:string)=>({id,label:'PRIVATE FACE',visual:{kind:'standard' as const,rank:14,suit:'Spade' as const}});
function fixture(observer=false){
 const peerIds=observer?['p0','p1','p2','p3','p4']:['p1','p2','p3','p4'],own=observer?0:10;
 const nodes:PlannedNode[]=[{id:'root',parent:null,kind:'group',label:'Table',box:{x:0,y:0,width:390,height:844}},{id:'stock',parent:'root',kind:'card',label:'Stock',zoneId:'stock',stockCount:3,visual:{kind:'back'},box},
 ...(!observer?[{id:'anchor',parent:'root',kind:'card' as const,label:'Own count',ownHandAnchor:{participantId:'p0',count:own},visual:{kind:'back' as const},box}]:[]),
 ...Array.from({length:own},(_,index)=>({id:`own-node:${index}`,parent:'root',kind:'card' as const,label:'PRIVATE OLD FACE',entityId:`old:${index}`,ownerId:'p0',zoneId:'hand',visual:{kind:'standard' as const,rank:2+index%13,suit:'Club' as const},box})),
 ...peerIds.map(id=>({id:`recipient:${id}`,parent:'root',kind:'card' as const,label:'Count',recipientId:id,recipientCount:10,visual:{kind:'back' as const},box})),
 ];
 const previous:PresentationFrame={id:7,context:{session:'s',audience:'actor',generation:'old',revision:'1'},rosterIds:observer?peerIds:['p0',...peerIds],environment,offerId:'old-offer',width:390,height:844,recipe:'stacked',nodes,paintResources:motionFixtureResources(nodes,observer?peerIds:['p0',...peerIds])};
 const next:TableDocument<unknown>={context:{session:'s',audience:'actor',generation:'new',revision:'2'},participant:{id:observer?'observer':'p0',name:'Player',role:observer?'observer':'player',markers:[]},hand:Array.from({length:own},(_,index)=>card(`new:${index}`)),opponents:peerIds.map(id=>({id,name:id,handCount:10})),collections:[{id:'stock',label:'Stock',purpose:'stock',cards:[],hiddenCount:3}],deals:[{id:'deal-new',source:'stock',cardIds:[],handCount:own,recipients:peerIds.map(participantId=>({participantId,count:10}))}],recycle:{id:'recycle-new',source:'stock',previousGeneration:'old',totalCount:53},facts:[],decision:{id:'decision',kind:'commands',commands:[]},offer:{id:'new-offer',actions:[]}};
 return {previous,next};
}
const nodes=(frame:PresentationFrame,change:(node:PlannedNode)=>PlannedNode):PresentationFrame=>{const changed=frame.nodes.map(change);return {...frame,nodes:changed,paintResources:motionFixtureResources(changed,frame.rosterIds)};};

describe('pure count-conserved recycle admission',()=>{
 it('issues an immutable privately branded count-only proof for a real stock3/held50 redeal',()=>{
  const {previous,next}=fixture(),proof=admitRecycle(previous,next,4)!;expect(proof).not.toBeNull();expect(proof).toMatchObject({oldFrameId:7,transitionId:'recycle-new',source:'stock',totalCount:53,oldStock:3,newStock:3,dealt:50,localParticipantId:'p0',oldLocalCount:10,newLocalCount:10,continuity:4});
  expect(proof.oldRecipients).toEqual(next.opponents!.map(peer=>({participantId:peer.id,count:peer.handCount})));expect(proof.deal).toEqual({id:'deal-new',source:'stock',handCount:10,recipients:proof.newRecipients});
  expect(isRecycleAdmission(proof)).toBe(true);expect(isRecycleAdmission({...proof})).toBe(false);expect(isRecycleAdmission(JSON.parse(JSON.stringify(proof)))).toBe(false);
  expect(Object.isFrozen(proof)).toBe(true);expect(Object.isFrozen(proof.fromContext)).toBe(true);expect(Object.isFrozen(proof.newRecipients[0])).toBe(true);expect(Object.isFrozen(proof.deal.recipients)).toBe(true);
  const raw=JSON.stringify(proof);expect(raw).not.toContain('PRIVATE');expect(raw).not.toContain('visual');expect(raw).not.toContain('old:');expect(raw).not.toContain('new:');expect(raw).not.toContain('nodes');expect(raw).not.toContain('cardIds');expect(proof.fromContext).not.toBe(previous.context);expect(proof.toContext).not.toBe(next.context);
 });
 it('admits Exchange with zero old stock and thirteen actual local entities without manufacturing a full-stock frame',()=>{
  const f=fixture();f.previous=nodes(f.previous,node=>node.id==='stock'?{...node,kind:'group',stockCount:0,visual:undefined}:node.id==='anchor'?{...node,ownHandAnchor:{participantId:'p0',count:13}}:node);
  f.previous={...f.previous,nodes:[...f.previous.nodes,...Array.from({length:3},(_,i)=>({...f.previous.nodes.find(node=>node.entityId)!,id:`extra-node:${i}`,entityId:`extra:${i}`}))]};
  const proof=admitRecycle(f.previous,f.next,0);expect(proof).toMatchObject({oldStock:0,oldLocalCount:13,newLocalCount:10,newStock:3,dealt:50});
 });
 it('admits public-peer Exchange counts and observers without private-hand anchors',()=>{
  const f=fixture();f.previous=nodes(f.previous,node=>node.id==='stock'?{...node,kind:'group',stockCount:0,visual:undefined}:node.recipientId==='p1'?{...node,recipientCount:13}:node);expect(admitRecycle(f.previous,f.next,1)).toMatchObject({oldLocalCount:10,oldStock:0,oldRecipients:expect.arrayContaining([{participantId:'p1',count:13}])});
  const spectator=fixture(true);expect(admitRecycle(spectator.previous,spectator.next,1)).toMatchObject({localParticipantId:null,oldLocalCount:0,newLocalCount:0,dealt:50});
 });
 it('binds exact context/generation/roster while preserving the current declared dealing order',()=>{
  const f=fixture();f.next={...f.next,deals:[{...f.next.deals![0],recipients:[...f.next.deals![0].recipients!].reverse()}]};expect(admitRecycle(f.previous,f.next,1)?.deal.recipients[0].participantId).toBe('p4');
  for(const changed of [{...f.previous,context:{...f.previous.context,session:'other'}},{...f.previous,context:{...f.previous.context,audience:'other'}},{...f.previous,context:{...f.previous.context,generation:'older'}},{...f.previous,rosterIds:['p0','p2','p1','p3','p4']},{...f.previous,rosterIds:['p0','p1','p1','p3','p4']},{...f.previous,rosterIds:undefined}])expect(admitRecycle(changed,f.next,1)).toBeNull();
  expect(admitRecycle(f.previous,{...f.next,context:{...f.next.context,generation:'old'}},1)).toBeNull();expect(admitRecycle(f.previous,{...f.next,participant:{...f.next.participant,id:'other'}},1)).toBeNull();
 });
 it('supports a104-card partition at the64-transfer boundary and exact zero-count public markers',()=>{
  const f=fixture();const one=f.previous.nodes.find(node=>node.entityId)!;
  f.previous=nodes(f.previous,node=>node.id==='stock'?{...node,stockCount:40}:node.id==='anchor'?{...node,ownHandAnchor:{participantId:'p0',count:16}}:node.recipientId?{...node,recipientCount:16}:node);
  f.previous={...f.previous,rosterIds:['p0','p1','p2','p3'],nodes:[...f.previous.nodes.filter(node=>node.recipientId!=='p4'),...Array.from({length:6},(_,i)=>({...one,id:`more-node:${i}`,entityId:`more:${i}`}))]};
  f.next={...f.next,hand:Array.from({length:16},(_,i)=>card(`new:${i}`)),opponents:f.next.opponents!.slice(0,3).map(peer=>({...peer,handCount:16})),collections:[{...f.next.collections![0],hiddenCount:40}],deals:[{...f.next.deals![0],handCount:16,recipients:['p1','p2','p3'].map(participantId=>({participantId,count:16}))}],recycle:{...f.next.recycle!,totalCount:104}};
  expect(admitRecycle(f.previous,f.next,1)).toMatchObject({totalCount:104,dealt:64,oldLocalCount:16,newLocalCount:16});
  const zero=fixture();zero.previous=nodes(zero.previous,node=>node.id==='stock'?{...node,stockCount:13}:node.recipientId==='p1'?{...node,kind:'group',inert:true,label:'',recipientCount:0,visual:undefined}:node);
  zero.next={...zero.next,opponents:zero.next.opponents!.map(peer=>peer.id==='p1'?{...peer,handCount:0}:peer),collections:[{...zero.next.collections![0],hiddenCount:13}],deals:[{...zero.next.deals![0],recipients:zero.next.deals![0].recipients!.filter(peer=>peer.participantId!=='p1')}]};expect(admitRecycle(zero.previous,zero.next,1)).toMatchObject({dealt:40,oldStock:13,newStock:13});
 });
 it('does not match physical cards across generations',()=>{
  const f=fixture();f.next={...f.next,hand:f.next.hand.map((item,index)=>({...item,id:`old:${index}`}))};expect(admitRecycle(f.previous,f.next,1)).not.toBeNull();
 });
 it('refuses unaccounted stock/held totals and forged own-count anchors',()=>{
  const f=fixture();for(const changed of [nodes(f.previous,node=>node.id==='stock'?{...node,stockCount:4}:node),nodes(f.previous,node=>node.id==='anchor'?{...node,ownHandAnchor:{participantId:'p0',count:9}}:node),{...f.previous,nodes:f.previous.nodes.filter(node=>node.id!=='anchor')},{...f.previous,nodes:f.previous.nodes.filter(node=>node.recipientId!=='p4')},{...f.previous,nodes:[...f.previous.nodes,{...f.previous.nodes.find(node=>node.id==='anchor')!,id:'duplicate-anchor'}]},{...f.previous,nodes:[...f.previous.nodes,{...f.previous.nodes.find(node=>node.recipientId==='p1')!,id:'duplicate-recipient'}]}])expect(admitRecycle(changed,f.next,1)).toBeNull();
  expect(admitRecycle(f.previous,{...f.next,recycle:{...f.next.recycle!,totalCount:52}},1)).toBeNull();expect(admitRecycle(f.previous,{...f.next,hand:f.next.hand.slice(1)},1)).toBeNull();
 });
 it('requires one exact count-only current deal, complete unique recipients and the existing64-transfer cap',()=>{
  const f=fixture(),deal=f.next.deals![0];for(const deals of [[],[deal,deal],[{...deal,source:'foreign'}],[{...deal,cardIds:['private-card']}],[{...deal,handCount:9}],[{...deal,recipients:deal.recipients!.slice(1)}],[{...deal,recipients:deal.recipients!.map((peer,index)=>index?peer:{...peer,count:9})}],[{...deal,recipients:[deal.recipients![0],...deal.recipients!.slice(0,3)]}]])expect(admitRecycle(f.previous,{...f.next,deals},1)).toBeNull();
  const large=fixture();large.previous=nodes(large.previous,node=>node.id==='stock'?{...node,stockCount:54}:node);large.next={...large.next,hand:[...large.next.hand,...Array.from({length:15},(_,i)=>card(`extra:${i}`))],collections:[{...large.next.collections![0],hiddenCount:39}],deals:[{...deal,handCount:25}],recycle:{...large.next.recycle!,totalCount:104}};expect(admitRecycle(large.previous,large.next,1)).toBeNull();
 });
 it('rejects face-entity partitions and changed/duplicate non-source stocks',()=>{
  const f=fixture(),face=f.previous.nodes.find(node=>node.entityId)!;expect(admitRecycle({...f.previous,nodes:[...f.previous.nodes,{...face,id:'played',entityId:'played-card',zoneId:'trick'}]},f.next,1)).toBeNull();expect(admitRecycle(f.previous,{...f.next,collections:[...f.next.collections!,{id:'played',label:'Played',cards:[card('played')]}]},1)).toBeNull();
  const other={id:'other-stock',parent:'root',kind:'card' as const,label:'Other',zoneId:'other',stockCount:2,visual:{kind:'back' as const},box};const previous={...f.previous,nodes:[...f.previous.nodes,other],paintResources:motionFixtureResources([...f.previous.nodes,other],f.previous.rosterIds)},next={...f.next,collections:[...f.next.collections!,{id:'other',label:'Other',purpose:'stock' as const,cards:[],hiddenCount:2}]};expect(admitRecycle(previous,next,1)).not.toBeNull();expect(admitRecycle(previous,{...next,collections:next.collections.map(zone=>zone.id==='other'?{...zone,hiddenCount:3}:zone)},1)).toBeNull();const resources=previous.paintResources!;expect(admitRecycle({...previous,paintResources:resources.status==='available'?{...resources,collections:[...resources.collections,resources.collections.find(c=>c.id==='other')!]}:resources},next,1)).toBeNull();expect(admitRecycle({...previous,nodes:[...previous.nodes,{...other,id:'duplicate-painted-stock'}]},next,1)).not.toBeNull();
 });
 it('fails closed on getters, exotics, sparse arrays, unsafe counts and unusable frame contexts',()=>{
  const f=fixture();let reads=0;const malicious={...f.next};Object.defineProperty(malicious,'recycle',{enumerable:true,get(){reads++;return f.next.recycle;}});expect(admitRecycle(f.previous,malicious,1)).toBeNull();expect(reads).toBe(0);
  const anchor=Object.defineProperty({participantId:'p0'},'count',{enumerable:true,get(){reads++;return 10;}});expect(admitRecycle(nodes(f.previous,node=>node.id==='anchor'?{...node,ownHandAnchor:anchor as never}:node),f.next,1)).toBeNull();expect(reads).toBe(0);
  const paint=Object.defineProperty({},'kind',{enumerable:true,get(){reads++;return 'standard';}});expect(admitRecycle(nodes(f.previous,node=>node.entityId?{...node,visual:paint as never}:node),f.next,1)).toBeNull();expect(reads).toBe(0);
  for(const continuity of [-1,NaN,Infinity,0.5])expect(admitRecycle(f.previous,f.next,continuity)).toBeNull();for(const value of [-1,105,NaN,Infinity,1.5])expect(admitRecycle(nodes(f.previous,node=>node.recipientId==='p1'?{...node,recipientCount:value}:node),f.next,1)).toBeNull();
  expect(admitRecycle({...f.previous,id:0},f.next,1)).toBeNull();expect(admitRecycle({...f.previous,modalId:'dialog'},f.next,1)).toBeNull();expect(admitRecycle({...f.previous,settled:true},f.next,1)).toBeNull();expect(admitRecycle(f.previous,{...f.next,stage:'waiting'},1)).toBeNull();expect(admitRecycle(f.previous,{...f.next,outcome:{} as never},1)).toBeNull();expect(admitRecycle({...f.previous,nodes:Array(2)},f.next,1)).toBeNull();expect(admitRecycle(new Date() as never,f.next,1)).toBeNull();
 });
});


describe('canonical recycle hint ownership',()=>{
 it('owns and freezes its exact four bounded inert fields',()=>{
  const input={id:'r',source:'stock',previousGeneration:'old',totalCount:53},owned=ownRecycleTransition(input);expect(owned).toEqual(input);expect(owned).not.toBe(input);expect(Object.isFrozen(owned)).toBe(true);input.id='changed';input.totalCount=1;expect(owned).toEqual({id:'r',source:'stock',previousGeneration:'old',totalCount:53});
 });
 it('rejects accessors, symbols, constructors, extra/missing keys and every invalid domain',()=>{
  const valid={id:'r',source:'stock',previousGeneration:'old',totalCount:53};let reads=0;
  const accessor={...valid};Object.defineProperty(accessor,'source',{enumerable:true,get(){reads++;return 'stock';}});expect(()=>ownRecycleTransition(accessor)).toThrow();expect(reads).toBe(0);
  for(const input of [null,[],new Date(),new Map(),Object.create(valid),{...valid,constructor:'injected'},{...valid,[Symbol('extra')]:true},{...valid,extra:true},{id:'r',source:'stock',totalCount:53},{...valid,id:''},{...valid,source:'x'.repeat(2049)},...[-1,0,105,NaN,Infinity,1.5,'53'].map(totalCount=>({...valid,totalCount}))])expect(()=>ownRecycleTransition(input)).toThrow();
  class Hint {id='r';source='stock';previousGeneration='old';totalCount=53;}expect(()=>ownRecycleTransition(new Hint())).toThrow();
 });
});

it('recycles current inert identity counts into an exact fresh fifty-card neutral deal',()=>{const f=fixture(),convert=(node:PlannedNode):PlannedNode=>node.ownHandAnchor||node.recipientId?{...node,kind:'group',inert:true,label:'',visual:undefined}:node;f.previous=nodes(f.previous,convert);const proof=admitRecycle(f.previous,f.next,2);expect(proof).not.toBeNull();const fresh:PresentationFrame={...f.previous,id:8,context:f.next.context,recycleAdmission:proof!,deals:f.next.deals,nodes:[...f.previous.nodes.filter(node=>!node.entityId).map(node=>node.id==='stock'?{...node,recycleAnchor:{totalCount:53,captionId:'caption'}}:node),...f.next.hand.map((card,index)=>({id:`fresh:${index}`,kind:'card' as const,parent:'root',label:card.label,zoneId:'hand',ownerId:'p0',entityId:card.id,visual:card.visual,box}))]};const all=recycledDealCandidates(proof!,fresh);expect(all).toHaveLength(50);expect(new Set(all.map(item=>item.entityId)).size).toBe(50);expect(all.filter(item=>item.countedLanding?.kind==='group')).toHaveLength(10);for(const change of [{inert:false},{label:'Fake count'},{cardId:'private'},{ownerId:'p0'}])expect(admitRecycle(nodes(f.previous,node=>node.id==='anchor'?{...node,...change}:node),f.next,2)).toBeNull();expect(admitRecycle(nodes(f.previous,node=>node.id==='anchor'?{...node,ownHandAnchor:{participantId:'foreign',count:10}}:node),f.next,2)).toBeNull();expect(admitRecycle(nodes(f.previous,node=>node.recipientId==='p1'?{...node,recipientCount:9}:node),f.next,2)).toBeNull();expect(recycledDealCandidates(proof!,{...fresh,nodes:fresh.nodes.map(node=>node.recipientId==='p1'?{...node,recipientId:'foreign'}:node)})).toEqual([]);});

it('poisoned previous own and peer count landmarks cannot mint recycle authority',()=>{
 const f=fixture(),fields={formActionId:'run',formNavigation:{leaseId:'x'},formField:{leaseId:'x'},disclosureFormActionId:'delete',feedbackDismissId:'dismiss',publicDisclosureEventId:'event'};
 for(const id of ['anchor','recipient:p1'])for(const [key,value]of Object.entries(fields))expect(admitRecycle(nodes(f.previous,n=>n.id===id?{...n,[key]:value}:n),f.next,1)).toBeNull();
 const zero=fixture(),changed=nodes(zero.previous,n=>n.id==='stock'?{...n,stockCount:13}:n.recipientId==='p1'?{...n,kind:'group',inert:true,label:'',recipientCount:0,visual:undefined}:n);const next={...zero.next,opponents:zero.next.opponents!.map(p=>p.id==='p1'?{...p,handCount:0}:p),collections:[{...zero.next.collections![0],hiddenCount:13}],deals:[{...zero.next.deals![0],recipients:zero.next.deals![0].recipients!.filter(p=>p.participantId!=='p1')}]};
 expect(admitRecycle(changed,next,1)).not.toBeNull();for(const change of [{inert:false},{label:'Painted zero'}])expect(admitRecycle(nodes(changed,n=>n.recipientId==='p1'?{...n,...change}:n),next,1)).toBeNull();
});
