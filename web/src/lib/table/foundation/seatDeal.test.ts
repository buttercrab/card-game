import {expect,test} from 'vitest';
import {initialSeatDeal,advanceSeatDeal,seatDealDocument} from './seatDealFixture';
import {createCardSession} from './session';
import {transferCandidates} from './transferMotion';
import type {PlannedNode,PresentationFrame} from './contracts';
function frame(revision:string,count:number):PresentationFrame{
    const pile:PlannedNode={id:'stock',kind:'card',parent:null,label:'Stock',zoneId:'stock',stockCount:15-count*5,visual:{kind:'back'},box:{x:0,y:0,width:64,height:90}};
    return {id:1,context:{session:'s',audience:'p0',generation:'g',revision},environment:{revision:'e'} as PresentationFrame['environment'],offerId:revision,paintResources:{status:'available',collections:[{id:'stock',purpose:'stock',availability:'current',hiddenCount:15-count*5,cards:[]}]},width:1000,height:1000,recipe:'stacked',nodes:[pile,
        ...Array.from({length:4},(_,i):PlannedNode=>({id:`recipient-${i}`,kind:count?'card':'group',parent:null,label:count?`P${i}`:'',...(!count?{inert:true}:{}),recipientId:`p${i+1}`,recipientCount:count,...(count?{visual:{kind:'back' as const}}:{}),box:{x:100+i*100,y:100,width:32,height:45}})),
        ...(count?[{id:'local-card',entityId:'local',kind:'card' as const,parent:null,label:'Own card',zoneId:'hand',visual:{kind:'standard' as const,rank:14,suit:'Spade' as const},box:{x:500,y:500,width:88,height:124}}]:[])]};
}
const hint={id:'round1',source:'stock',cardIds:['local'],recipients:Array.from({length:4},(_,i)=>({participantId:`p${i+1}`,count:1}))};
test('all five viewer projections disclose exactly one hand and only opponent counts',()=>{
    let state=initialSeatDeal();const original=state.stock.map(card=>card.id);
    for(let round=1;round<=3;round++){
        state=advanceSeatDeal(state,{SeatDeal:'round'});
        expect(state.stock.length+state.hands.reduce((sum,hand)=>sum+hand.length,0)).toBe(15);
        for(let viewer=0;viewer<5;viewer++){
            const doc=seatDealDocument(state,round+1,viewer),serialized=JSON.stringify(doc);
            expect(doc.hand).toEqual(state.hands[viewer]);expect(doc.opponents).toHaveLength(4);
            expect(doc.opponents!.map(item=>item.handCount)).toEqual([round,round,round,round]);
            for(let other=0;other<5;other++)if(other!==viewer)for(const card of state.hands[other])expect(serialized).not.toContain(`"${card.id}"`);
            expect(doc.deals![0].cardIds).toEqual([state.hands[viewer][round-1].id]);
            expect(doc.deals![0].recipients!.map(item=>item.participantId)).toEqual(doc.opponents!.map(item=>item.id));
            expect(doc.context.audience).toBe(doc.participant.id);
        }
    }
    expect(new Set(state.hands.flat().map(card=>card.id))).toEqual(new Set(original));
    expect(()=>advanceSeatDeal(state,{SeatDeal:'round'})).toThrow();
    expect(advanceSeatDeal(state,{SeatDeal:'reset'}).generation).toBe(2);
});
test('one stock delta admits local face destination plus four anonymous recipient flights',()=>{
    const result=transferCandidates(frame('1',0),{...frame('2',1),deals:[hint]});
    expect(result).toHaveLength(5);expect(result.map(item=>item.presentation)).toEqual(Array(5).fill('back'));
    expect(result[0].entityId).toBe('local');
    expect(new Set(result.map(item=>item.entityId)).size).toBe(5);
    for(const item of result.slice(1)){expect(item.destination.visual?.kind).toBe('back');expect(JSON.parse(item.entityId)[0]).toBe('anonymous-deal');}
});
test('undeclared, duplicate, missing or mismatched recipient deltas reject the whole batch',()=>{
    const next={...frame('2',1),deals:[hint]};
    for(const invalid of [
        {...next,deals:[{...hint,recipients:hint.recipients.slice(1)}]},
        {...next,deals:[{...hint,recipients:[...hint.recipients.slice(0,3),hint.recipients[0]]}]},
        {...next,nodes:next.nodes.map(node=>node.recipientId==='p4'?{...node,recipientCount:2}:node)},
        {...next,nodes:next.nodes.filter(node=>node.recipientId!=='p4')},
        {...next,nodes:[...next.nodes,next.nodes[1]]},
    ])expect(transferCandidates(frame('1',0),invalid)).toEqual([]);
});
test('canonical participants contain only whitelisted count data and reject unknown recipient hints',()=>{
    const session=createCardSession({transport:()=>{}}),state=advanceSeatDeal(initialSeatDeal(),{SeatDeal:'round'}),doc=seatDealDocument(state,2);
    const raw={...doc,opponents:doc.opponents!.map(item=>({...item,accidentalPrivateHand:state.hands[1]}))};session.receive(raw);
    expect(session.snapshot().document!.opponents![0]).toEqual(doc.opponents![0]);
    expect(Object.isFrozen(session.snapshot().document!.opponents![0])).toBe(true);
    const current=session.snapshot().document;
    expect(()=>session.receive({...doc,opponents:[doc.opponents![0],doc.opponents![0]]})).toThrow();
    expect(()=>session.receive({...doc,deals:[{...doc.deals![0],recipients:[{participantId:'unknown',count:4}]}]})).toThrow();
    expect(session.snapshot().document).toBe(current);session.dispose();
});

test('a count-only recipient tick needs no local identity and cannot remove an existing local card',()=>{
    const previous=frame('1',0);
    const next={...frame('2',0),paintResources:{status:'available' as const,collections:[{id:'stock',purpose:'stock' as const,availability:'current' as const,hiddenCount:14,cards:[]}]},nodes:frame('2',0).nodes.map(node=>node.stockCount!==undefined?{...node,stockCount:14}:node.recipientId==='p1'?{...node,kind:'card' as const,recipientCount:1,visual:{kind:'back' as const}}:node),deals:[{id:'peer-tick',source:'stock',cardIds:[],recipients:[{participantId:'p1',count:1}]}]};
    const result=transferCandidates(previous,next);expect(result).toHaveLength(1);expect(result[0].destination.recipientId).toBe('p1');
    const oldLocal=frame('2',1).nodes.find(node=>node.entityId)!;
    expect(transferCandidates({...previous,nodes:[...previous.nodes,oldLocal]},next)).toEqual([]);
});
