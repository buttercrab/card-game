import {publicPaintResources} from './paintResources';
import {motionFixtureResources} from './motionResourceTestFixture';
import {recycledDealCandidates} from './transferMotion';
import {expect,test,vi} from 'vitest';
import {createDomRecycle} from './domRecycle';
import {admitRecycle,isRecycleAdmission} from './recycle';
import type {PlannedNode,PresentationFrame,TableDocument} from './contracts';
const node=(id:string,extra:Partial<PlannedNode>={}):PlannedNode=>({id,parent:null,kind:'group',label:id,box:{x:0,y:0,width:50,height:70},...extra});
function fixture(stock=3){
 let previous={id:1,context:{session:'table',audience:'alice',generation:'old',revision:'1'},rosterIds:['alice','bob'],nodes:[node('stock',{kind:'card',zoneId:'stock',stockCount:stock,visual:{kind:'back'}}),node('own',{kind:'card',ownHandAnchor:{participantId:'alice',count:1},visual:{kind:'back'}}),node('old-card',{kind:'card',zoneId:'hand',entityId:'old-entity',visual:{kind:'standard',suit:'Spade',rank:2}}),node('peer',{kind:'card',recipientId:'bob',recipientCount:1,visual:{kind:'back'}})]} as unknown as PresentationFrame;
 const next:TableDocument<string>={context:{...previous.context,generation:'new',revision:'2'},participant:{id:'alice',name:'Alice',markers:[]},opponents:[{id:'bob',name:'Bob',handCount:1}],hand:[{id:'new-entity',label:'New face',visual:{kind:'standard',suit:'Heart',rank:3}}],facts:[],collections:[{id:'stock',kind:'deck',purpose:'stock',label:'Stock',cards:[],hiddenCount:stock}],decision:{id:'idle',kind:'commands',commands:[]},offer:{id:'idle',actions:[]},deals:[{id:'redeal',source:'stock',cardIds:[],handCount:1,recipients:[{participantId:'bob',count:1}]}],recycle:{id:'recycle',source:'stock',previousGeneration:'old',totalCount:stock+2}};
 previous={...previous,paintResources:publicPaintResources(next)};
 const proof=admitRecycle(previous,next,0,publicPaintResources(next));expect(isRecycleAdmission(proof)).toBe(true);if(!proof)throw Error('Count proof fixture must be admitted');
 let frame={id:2,context:next.context,rosterIds:previous.rosterIds,recycleAdmission:proof!,deals:next.deals,nodes:[node('stock',{kind:'card',zoneId:'stock',stockCount:stock,visual:{kind:'back'},recycleAnchor:{totalCount:stock+2,captionId:'caption'}}),node('caption',{kind:'text',label:'3장',recycleCaption:'5장'}),node('own',{kind:'card',ownHandAnchor:{participantId:'alice',count:1},visual:{kind:'back'}}),node('new-card',{kind:'card',zoneId:'hand',entityId:'new-entity',visual:next.hand[0].visual}),node('peer',{kind:'card',recipientId:'bob',recipientCount:1,visual:{kind:'back'}})]} as unknown as PresentationFrame;
 frame={...frame,paintResources:publicPaintResources(next)};
 const conceal=vi.fn(()=>true),onReady=vi.fn(),onCancel=vi.fn(),onIdle=vi.fn(),host={getBoundingClientRect:vi.fn(()=>{throw Error('Native geometry must not be reached');})} as unknown as HTMLElement;
 const helper=createDomRecycle({host,conceal,onReady,onCancel,onIdle,current:()=>frame,ready:()=>true});return{frame,next,proof,helper,conceal,onReady,onCancel,onIdle,host};
}

test('copied, serialized and missing count proofs cannot create a neutral origin or conceal private cards',()=>{
 const f=fixture();for(const proof of [undefined,{...f.proof},JSON.parse(JSON.stringify(f.proof))])expect(f.helper.start({...f.frame,recycleAdmission:proof},new Map())).toBe(false);expect(f.helper.count()).toBe(0);expect(f.conceal).not.toHaveBeenCalled();expect(f.onReady).not.toHaveBeenCalled();f.helper.clear();f.helper.finish();expect(f.onIdle).not.toHaveBeenCalled();
});
test('a branded count proof cannot be rebound to a modal, foreign context, roster or invented stock anchor',()=>{
 const f=fixture();for(const changed of [
 {...f.frame,modalId:'modal'},
 {...f.frame,context:{...f.frame.context,audience:'other'}},
 {...f.frame,context:{...f.frame.context,generation:'old'}},
 {...f.frame,rosterIds:['bob','alice']},
 {...f.frame,nodes:f.frame.nodes.filter(node=>node.id!=='stock')},
 {...f.frame,nodes:f.frame.nodes.map(node=>node.id==='stock'?{...node,recycleAnchor:{totalCount:53,captionId:'caption'}}:node)},
 {...f.frame,nodes:f.frame.nodes.map(node=>node.id==='stock'?{...node,stockCount:53}:node)},
 {...f.frame,nodes:[...f.frame.nodes,f.frame.nodes[0]]},
 ])expect(f.helper.start(changed,new Map())).toBe(false);
 expect(f.conceal).not.toHaveBeenCalled();expect(f.onReady).not.toHaveBeenCalled();expect(f.host.getBoundingClientRect).not.toHaveBeenCalled();
});

test('recycled deal uses only branded count evidence and newly authorized destinations',()=>{
 const f=fixture(),items=recycledDealCandidates(f.proof,f.frame);
 expect(items).toHaveLength(2);expect(items.map(item=>item.presentation)).toEqual(['back','back']);expect(items[0].destination.entityId).toBe('new-entity');expect(items[0].source.stockCount).toBe(3);expect(items[0].countedLanding?.ownHandAnchor?.count).toBe(1);
 expect(recycledDealCandidates({...f.proof},f.frame)).toEqual([]);
 for(const changed of [{...f.frame,modalId:'modal'},{...f.frame,rosterIds:['bob','alice']},{...f.frame,nodes:f.frame.nodes.map(node=>node.id==='stock'?{...node,stockCount:53}:node)},{...f.frame,nodes:f.frame.nodes.map(node=>node.id==='peer'?{...node,recipientCount:2}:node)}])expect(recycledDealCandidates(f.proof,changed)).toEqual([]);
});

test('a failed or skipped recollection is consumed before a later publication can replay it',()=>{
 const f=fixture();let reads=0;const candidate={...f.frame};Object.defineProperty(candidate,'nodes',{get(){reads++;return f.frame.nodes;}});
 expect(f.helper.start(candidate,new Map())).toBe(false);const attemptedReads=reads;expect(attemptedReads).toBeGreaterThan(0);
 expect(f.helper.start(candidate,new Map())).toBe(false);expect(reads).toBe(attemptedReads);
 const skipped=fixture();skipped.helper.skip(skipped.frame);expect(skipped.helper.start(skipped.frame,new Map())).toBe(false);expect(skipped.conceal).not.toHaveBeenCalled();
});


test.each([3,0])('resource-only recycle %s stock preserves count proof without hidden deck/caption DOM',async stock=>{
 const f=fixture(stock);vi.useFakeTimers();let current:PresentationFrame={...f.frame,nodes:f.frame.nodes.filter(node=>node.zoneId!=='stock'&&node.id!=='caption')};const art={} as SVGSVGElement,conceal=vi.fn((_frame:number,_ids:readonly string[],_owner:string)=>true),onReady=vi.fn(),onCancel=vi.fn(),helper=createDomRecycle({host:f.host,current:()=>current,ready:()=>true,paint:{recycle:vi.fn(()=>art)},conceal,onReady,onCancel,onIdle:vi.fn()});
 expect(helper.start(current,new Map())).toBe(true);expect(helper.count()).toBe(1);expect(conceal.mock.calls[0]?.[0]).toBe(current.id);await Promise.resolve();expect(onReady).toHaveBeenCalledTimes(1);const origin=onReady.mock.calls[0][0];expect(origin.kind).toBe('resource');expect('box'in origin).toBe(false);expect('sourceNodeId'in origin).toBe(false);expect(helper.current(origin,current)).toBe(true);expect(f.host.getBoundingClientRect).not.toHaveBeenCalled();helper.finish();expect(conceal.mock.calls.at(-1)?.[1]).toEqual([]);expect(onCancel).not.toHaveBeenCalled();expect(helper.start(current,new Map())).toBe(false);vi.useRealTimers();
});
test.each(['revoke','foreign','expiry'] as const)('resource-only recycle %s cannot issue a late ready or retain face concealment',async mode=>{
 const f=fixture();vi.useFakeTimers();let current:PresentationFrame={...f.frame,nodes:f.frame.nodes.filter(node=>node.zoneId!=='stock'&&node.id!=='caption')};const conceal=vi.fn((_frame:number,_ids:readonly string[],_owner:string)=>true),onReady=vi.fn(),onCancel=vi.fn(),helper=createDomRecycle({host:f.host,current:()=>current,ready:()=>true,paint:{recycle:()=>({} as SVGSVGElement)},conceal,onReady,onCancel,onIdle:vi.fn()});expect(helper.start(current,new Map())).toBe(true);
 if(mode==='revoke')helper.clear();else if(mode==='foreign')current={...current,context:{...current.context,audience:'other'}};else {await Promise.resolve();await vi.advanceTimersByTimeAsync(3500);}await Promise.resolve();expect(helper.count()).toBe(0);expect(conceal.mock.calls.at(-1)?.[1]).toEqual([]);expect(onCancel).toHaveBeenCalledTimes(1);if(mode!=='expiry')expect(onReady).not.toHaveBeenCalled();vi.useRealTimers();
});
