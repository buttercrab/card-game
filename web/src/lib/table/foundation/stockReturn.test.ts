import {expect,test} from 'vitest';
import {transferCandidates,requiresEssentialTransfer} from './transferMotion';
import {createCardSession} from './session';
import {flowDocument,initialFlow} from './flowFixture';
import type {PlannedNode,PresentationFrame} from './contracts';
const box={x:0,y:0,width:64,height:90};
const pile=(count:number):PlannedNode=>({id:'stock',zoneId:'stock',stockCount:count,kind:count?'card':'group',parent:null,label:'Stock',box,...(count?{visual:{kind:'back' as const}}:{})});
const card=(id:string):PlannedNode=>({id,entityId:id,zoneId:'hand',kind:'card',parent:null,label:id,box,visual:{kind:'standard',rank:2,suit:'Spade'}});
const peer=(count:number):PlannedNode=>({id:'peer',recipientId:'p',recipientCount:count,kind:count?'card':'group',parent:null,label:'Peer',box,...(count?{visual:{kind:'back' as const}}:{})});
const frame=(revision:string,nodes:readonly PlannedNode[],count=revision==='1'?0:1):PresentationFrame=>({id:1,context:{session:'s',audience:'a',generation:'g',revision},environment:{revision:'e'} as PresentationFrame['environment'],offerId:revision,paintResources:{status:'available',collections:[{id:'stock',purpose:'stock',availability:'current',hiddenCount:count,cards:[]}]},nodes,width:500,height:500,recipe:'stacked'});
const old=()=>frame('1',[pile(0),card('retained'),card('removed'),peer(13)]);
const next=():PresentationFrame=>({...frame('2',[pile(1),card('retained'),peer(13)]),stockReturn:{destination:'stock',source:{kind:'hand'}}});
test('local return discovers only removed authorized cards; reload and unchanged snapshots do not replay',()=>{
 const result=transferCandidates(old(),next());expect(result.map(item=>[item.entityId,item.presentation,item.destination.stockCount])).toEqual([['removed','face',1]]);
 expect(transferCandidates(null,next())).toEqual([]);expect(transferCandidates(next(),{...next(),context:{...next().context,revision:'3'}})).toEqual([]);
});
test('peer return reconciles count loss without hidden IDs or faces',()=>{
 const before=frame('1',[pile(1),card('retained'),peer(12)],1),after:PresentationFrame={...frame('2',[pile(3),card('retained'),peer(10)],3),stockReturn:{destination:'stock',source:{kind:'participant',id:'p'}}};
 const result=transferCandidates(before,after);expect(result).toHaveLength(2);expect(result.every(item=>item.presentation==='back'&&item.source.visual?.kind==='back')).toBe(true);
 const fontBefore={...before,environment:{...before.environment,fontRevision:'1'}},fontAfter={...after,environment:{...after.environment,revision:'new',fontRevision:'2'}};
 expect(transferCandidates(fontBefore,fontAfter)).toHaveLength(2);expect(transferCandidates(fontBefore,{...fontAfter,environment:{...fontAfter.environment,width:600}})).toEqual([]);
 expect(transferCandidates(before,{...after,stockReturn:{destination:'stock',source:{kind:'participant',id:'unknown'}}})).toEqual([]);
});
test('mismatched conservation, public changes, scope, environment and oversized returns snap',()=>{
 for(const invalid of [
 {...next(),nodes:[pile(2),card('retained'),peer(13)]},
 {...next(),nodes:[...next().nodes,card('new')]},
 {...next(),nodes:[pile(1),card('retained'),peer(12)]},
 {...next(),nodes:[pile(1),{...card('retained'),zoneId:'trick'},peer(13)]},
 {...next(),context:{...next().context,audience:'other'}},
 {...next(),environment:{revision:'other'} as PresentationFrame['environment']},
 {...next(),deals:[{id:'mixed',source:'stock',cardIds:['new']}]},
 ])expect(transferCandidates(old(),invalid)).toEqual([]);
 expect(transferCandidates(frame('1',[pile(0),...Array.from({length:9},(_,i)=>card(String(i)))]),{...frame('2',[pile(9)],9),stockReturn:{destination:'stock',source:{kind:'hand'}}})).toEqual([]);
});
test('session validates return sources and owns whitelisted immutable semantics',()=>{
 const session=createCardSession({transport:()=>{}}),doc=flowDocument(initialFlow(),1,true);
 session.receive({...doc,stockReturn:{destination:'stock',source:{kind:'hand'}}});
 expect(Object.isFrozen(session.snapshot().document!.stockReturn!.source)).toBe(true);
 for(const hint of [{destination:'wrong',source:{kind:'hand' as const}},{destination:'stock',source:{kind:'participant' as const,id:'missing'}}])expect(()=>session.receive({...doc,stockReturn:hint})).toThrow('Invalid hidden stock return');
 session.dispose();
});

test('persistent peer return hint cannot relax the font gate for unrelated public face motion',()=>{
 const before={...frame('1',[pile(3),card('a'),peer(10)],3),environment:{revision:'old',fontRevision:'1'} as PresentationFrame['environment']};
 const after={...frame('2',[pile(3),{...card('a'),zoneId:'trick'},peer(10)],3),environment:{revision:'new',fontRevision:'2'} as PresentationFrame['environment'],stockReturn:{destination:'stock',source:{kind:'participant' as const,id:'p'}}};
 expect(transferCandidates(before,after)).toEqual([]);
});

test('essential return suspension requires actual conserved targets, never a persisted hint or unrelated Play',()=>{
 expect(requiresEssentialTransfer(old(),next())).toBe(true);
 expect(requiresEssentialTransfer(null,next())).toBe(false);
 expect(requiresEssentialTransfer(next(),{...next(),context:{...next().context,revision:'3'}})).toBe(false);
 expect(requiresEssentialTransfer(old(),{...next(),paintResources:{status:'available',collections:[{id:'stock',purpose:'stock',availability:'current',hiddenCount:2,cards:[]}]},nodes:[pile(2),card('retained'),peer(13)]})).toBe(false);
 expect(requiresEssentialTransfer(old(),{...next(),context:{...next().context,audience:'other'}})).toBe(false);
 const unrelated={...frame('3',[pile(1),{...card('retained'),zoneId:'trick'},peer(13)]),paintResources:{status:'available' as const,collections:[{id:'stock',purpose:'stock' as const,availability:'current' as const,hiddenCount:1,cards:[]},{id:'trick',purpose:'play' as const,availability:'current' as const,cards:[{entityId:'retained',visual:{kind:'standard' as const,suit:'Spade' as const,rank:2}}]}]},stockReturn:next().stockReturn};
 expect(transferCandidates(next(),unrelated)).toHaveLength(1);expect(requiresEssentialTransfer(next(),unrelated)).toBe(false);
 const observerBefore=frame('1',[pile(0),peer(13)]),observerAfter={...frame('2',[pile(3),peer(10)],3),stockReturn:{destination:'stock',source:{kind:'participant' as const,id:'p'}}};
 expect(requiresEssentialTransfer(observerBefore,observerAfter)).toBe(true);expect(transferCandidates(observerBefore,observerAfter).every(item=>item.presentation==='back'&&item.source.entityId===undefined)).toBe(true);
});
test('terminal collection suspension remains first-publication only and excludes unrelated destinations',()=>{
 const before={...frame('1',[card('last')]),paintResources:{status:'available' as const,collections:[]}},after={...frame('2',[{...card('last'),zoneId:'captured',collectionPurpose:'captured' as const}]),paintResources:{status:'available' as const,collections:[{id:'captured',purpose:'captured' as const,availability:'current' as const,cards:[{entityId:'last',visual:{kind:'standard' as const,suit:'Spade' as const,rank:2}}]}]},settled:true,outcomeLaneId:'outcome' as const};
 expect(requiresEssentialTransfer(before,after)).toBe(true);expect(requiresEssentialTransfer(null,after)).toBe(false);
 expect(requiresEssentialTransfer({...before,settled:true},after)).toBe(false);
 expect(requiresEssentialTransfer(before,{...after,paintResources:{status:'available',collections:[{id:'trick',purpose:'play',availability:'current',cards:[{entityId:'last',visual:{kind:'standard',suit:'Spade',rank:2}}]}]},nodes:[{...card('last'),zoneId:'trick',collectionPurpose:'play'}]})).toBe(false);
});
