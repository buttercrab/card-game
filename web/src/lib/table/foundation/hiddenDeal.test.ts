import {expect,test} from 'vitest';
import {transferCandidates} from './transferMotion';
import {initialFlow,advanceFlow,flowDocument} from './flowFixture';
import {createCardSession} from './session';
import type {PlannedNode,PresentationFrame} from './contracts';
const pile=(count:number):PlannedNode=>({id:'pile',parent:null,kind:count?'card':'group',label:'Stock',stockCount:count,zoneId:'stock',...(count?{visual:{kind:'back' as const}}:{}),box:{x:0,y:0,width:64,height:90}});
const hand=(id:string):PlannedNode=>({id,entityId:id,zoneId:'hand',parent:null,kind:'card',label:id,visual:{kind:'standard',rank:14,suit:'Spade'},box:{x:100,y:100,width:88,height:124}});
const frame=(revision:string,nodes:readonly PlannedNode[],stockCount=revision==='1'?3:0):PresentationFrame=>({id:1,context:{session:'s',audience:'a',generation:'g',revision},environment:{revision:'e'} as PresentationFrame['environment'],offerId:revision,paintResources:{status:'available',collections:[{id:'stock',purpose:'stock',availability:'current',hiddenCount:stockCount,cards:[]}]},nodes,width:500,height:500,recipe:'stacked'});
const before=()=>frame('1',[pile(3)]);
const after=():PresentationFrame=>({...frame('2',[pile(0),hand('a'),hand('b'),hand('c')]),deals:[{id:'deal',source:'stock',cardIds:['a','b','c']}]});
test('explicit reconciled batch matches only newly disclosed hand entities and flies anonymous backs',()=>{
    const batch=transferCandidates(before(),after());expect(batch.map(item=>[item.entityId,item.presentation,item.source.kind,item.source.stockCount,item.origin,item.artifactSource?.visual?.kind])).toEqual(['a','b','c'].map(id=>[id,'back','group',0,'current','back']));
    expect(transferCandidates(null,after())).toEqual([]);
    expect(transferCandidates(before(),{...after(),deals:undefined})).toEqual([]);
    expect(transferCandidates({...before(),deals:after().deals},after())).toEqual([]);
    expect(transferCandidates({...before(),context:{...before().context,audience:'other'}},after())).toEqual([]);
});
test('missing, duplicate, extra, known and count-mismatched destinations snap without inference',()=>{
    const next=after();
    for(const invalid of [
        {...next,nodes:[pile(1),...next.nodes.slice(1)]},
        {...next,nodes:[...next.nodes,hand('extra')]},
        {...next,nodes:[...next.nodes,hand('a')]},
        {...next,nodes:next.nodes.slice(0,3)},
        {...next,deals:[{id:'deal',source:'wrong',cardIds:['a','b','c']}]},
        {...next,deals:[{id:'deal',source:'stock',cardIds:['a','a','c']}]},
    ])expect(transferCandidates(before(),invalid)).toEqual([]);
    expect(transferCandidates({...before(),nodes:[...before().nodes,hand('a')]},next)).toEqual([]);
});
test('reconciled deal admission is bounded to sixty-four entities',()=>{
    for(const count of [8,50,64,65]){
        const ids=Array.from({length:count},(_,index)=>`c${index}`);
        const next={...frame('2',[pile(0),...ids.map(hand)]),deals:[{id:'batch',source:'stock',cardIds:ids}]};
        expect(transferCandidates(frame('1',[pile(count)],count),next)).toHaveLength(count<=64?count:0);
    }
});
test('count-only fixture never projects stock identities and conserves an explicit three-card batch',()=>{
    const state=initialFlow(),doc=flowDocument(state,1,true);
    expect(doc.collections![0].cards).toEqual([]);expect(doc.collections![0].hiddenCount).toBe(3);
    expect(JSON.stringify(doc)).not.toContain('card-');
    const dealt=advanceFlow(state,{Flow:'batch'}),next=flowDocument(dealt,2,true);
    expect(next.hand.map(card=>card.id)).toEqual(state.stock.map(card=>card.id));
    expect(next.collections![0].hiddenCount).toBe(0);expect(next.deals![0].cardIds).toEqual(next.hand.map(card=>card.id));
});
test('session owns immutable hints and rejects invalid hidden stock before replacement',()=>{
    const session=createCardSession({transport:()=>{}}),doc=flowDocument(advanceFlow(initialFlow(),{Flow:'batch'}),2,true);
    session.receive(doc);
    (doc.deals![0].cardIds as string[]).push('tampered');
    expect(session.snapshot().document!.deals![0].cardIds).toHaveLength(3);
    expect(Object.isFrozen(session.snapshot().document!.deals![0].cardIds)).toBe(true);
    const current=session.snapshot().document;
    const initial=flowDocument(initialFlow(),1,true);
    for(const hiddenCount of [-1,NaN,1.5,10001])expect(()=>session.receive({...initial,collections:[{...initial.collections![0],hiddenCount}]})).toThrow();
    expect(()=>session.receive({...initial,collections:[{...initial.collections![0],cards:initialFlow().stock}]})).toThrow();
    expect(session.snapshot().document).toBe(current);session.dispose();
});

test('count-only initial distribution discovers only newly authorized local cards and interleaves peers',()=>{
    const peer=(count:number)=>({id:'peer',parent:null,kind:count?'card' as const:'group' as const,label:count?'Other':'',...(!count?{inert:true}:{}),recipientId:'peer',recipientCount:count,...(count?{visual:{kind:'back' as const}}:{}),box:{x:0,y:0,width:32,height:45}});
    const old=frame('1',[pile(7),peer(0)],7),next={...frame('2',[pile(1),peer(3),hand('a'),hand('b'),hand('c')],1),deals:[{id:'distribution',source:'stock',cardIds:[],handCount:3,recipients:[{participantId:'peer',count:3}]}]};
    const result=transferCandidates(old,next);expect(result).toHaveLength(6);expect(result.map(item=>item.destination.recipientId??item.entityId)).toEqual(['a','peer','b','peer','c','peer']);expect(result.every(item=>item.presentation==='back')).toBe(true);
    for(const handCount of [-1,1.5,2,4,65])expect(transferCandidates(old,{...next,deals:[{...next.deals[0],handCount}]})).toEqual([]);
    expect(transferCandidates(old,{...next,deals:[{...next.deals[0],cardIds:['a']}]})).toEqual([]);
    const kittyOld=frame('2',[pile(3),hand('old')],3),kittyNext={...frame('3',[pile(0),hand('old'),hand('new-1'),hand('new-2'),hand('new-3')]),deals:[{id:'kitty',source:'stock',cardIds:[],handCount:3}]};
    expect(transferCandidates(kittyOld,kittyNext).map(item=>item.entityId)).toEqual(['new-1','new-2','new-3']);
    expect(transferCandidates({...kittyOld,nodes:[...kittyOld.nodes,hand('new-1')]},kittyNext)).toEqual([]);
});

test('later generations deal only from a back and never reuse public history identities',()=>{
 const own=(count:number):PlannedNode=>({id:'own-count',parent:null,kind:'group',inert:true,label:'',ownHandAnchor:{participantId:'me',count},box:{x:400,y:400,width:48,height:48}}),peer:PlannedNode={id:'peer-count',parent:null,kind:'group',inert:true,label:'',recipientId:'peer',recipientCount:0,box:{x:400,y:100,width:48,height:48}};
 const history={...hand('a'),zoneId:'last',collectionPurpose:'captured' as const};
 const old={...frame('1',[pile(3),history,own(0),peer]),rosterIds:['me','peer'],paintResources:{status:'available' as const,collections:[{id:'stock',purpose:'stock' as const,availability:'current' as const,hiddenCount:3,cards:[]},{id:'last',purpose:'captured' as const,availability:'current' as const,cards:[{entityId:'a',visual:{kind:'standard' as const,suit:'Spade' as const,rank:14}}]}]},context:{...frame('1',[]).context,generation:'old'}};
 const next={...after(),rosterIds:['me','peer'],nodes:[...after().nodes,own(3),peer],context:{...after().context,generation:'next'}};
 const result=transferCandidates(old,next);expect(result).toHaveLength(3);expect(result.every(item=>item.presentation==='back'&&item.source.id==='pile')).toBe(true);
 expect(result.map(item=>item.entityId)).toEqual(['a','b','c']);
 expect(transferCandidates({...old,nodes:[pile(3),hand('a'),own(1),peer]},next)).toEqual([]);
 expect(transferCandidates({...old,context:{...old.context,audience:'other'}},next)).toEqual([]);
 expect(transferCandidates({...old,nodes:old.nodes.map(node=>node.id==='pile'?{...node,stockCount:2}:node)},next)).toEqual([]);
});
