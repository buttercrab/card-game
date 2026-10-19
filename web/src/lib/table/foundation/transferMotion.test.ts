import {motionFixtureResources} from './motionResourceTestFixture';
import { expect, test } from 'vitest';
import { transferCandidates, safeFlight, flightPath } from './transferMotion';
import { flowDocument, initialFlow, advanceFlow } from './flowFixture';
import type { PresentationFrame, PlannedNode } from './contracts';
const node = (id: string, zoneId: string): PlannedNode => ({ id, kind:'card', entityId:'c',zoneId,parent:null,label:'Ace',visual:{kind:'standard',rank:14,suit:'Spade'},box:{x:0,y:0,width:88,height:124} });
const frame = (revision: string, nodes: readonly PlannedNode[]): PresentationFrame => ({ id:1, context:{session:'s',audience:'a',generation:'g',revision},environment:{revision:'e'} as PresentationFrame['environment'],offerId:revision,width:500,height:500,recipe:'stacked',nodes,paintResources:motionFixtureResources(nodes) });
test('unique already-authorized unchanged faces may transfer between zones in bounded batches',()=>{
    const before=frame('1',[node('old','stock')]),after=frame('2',[node('new','hand')]);
    expect(transferCandidates(before,after)).toHaveLength(1);
    expect(transferCandidates(null,after)).toEqual([]);
    expect(transferCandidates(before,{...after,nodes:[...after.nodes,node('duplicate','elsewhere')]})).toEqual([]);
    expect(transferCandidates({...before,nodes:[...before.nodes,node('duplicate','elsewhere')]},after)).toEqual([]);
    expect(transferCandidates(before,{...after,nodes:[{...after.nodes[0],visual:{kind:'joker',color:'Black'}}]})).toEqual([]);
    expect(transferCandidates(frame('1',[]),after)).toEqual([]);
    expect(transferCandidates(before,frame('2',[node('new','stock')]))).toEqual([]);
    const second={...node('second','play'),entityId:'other'};
    expect(transferCandidates(frame('1',[...before.nodes,{...second,zoneId:'stock'}]),frame('2',[...after.nodes,second]))).toHaveLength(2);
});
test('audience, generation, session and environment replacement never carry a flight',()=>{
    const before=frame('1',[node('old','stock')]),after=frame('2',[node('new','hand')]);
    for(const key of ['audience','generation','session'] as const) expect(transferCandidates(before,{...after,context:{...after.context,[key]:'other'}})).toEqual([]);
    expect(transferCandidates(before,{...after,environment:{...after.environment,revision:'resize'}})).toEqual([]);
    expect(transferCandidates(before,{...after,context:before.context})).toEqual([]);
});
test('continuous swept bounds reject intermediate control crossings, clipping and invalid geometry',()=>{
    const clip={x:0,y:0,width:500,height:500},a={x:0,y:0,width:40,height:40},b={x:400,y:400,width:80,height:80};
    expect(safeFlight(a,b,clip,[])).toBe(true);
    expect(safeFlight(a,b,clip,[{x:210,y:210,width:20,height:20}])).toBe(false);
    // Inside the enclosing AABB, but outside the actual diagonal swept path.
    expect(safeFlight(a,b,clip,[{x:0,y:400,width:50,height:50}])).toBe(true);
    expect(safeFlight(a,{...b,x:450},clip,[])).toBe(false);
    expect(safeFlight(a,b,clip,[{x:NaN,y:0,width:1,height:1}])).toBe(false);
});
test('explicit fixture actions conserve cards through deal, play, collect and reset',()=>{
    let state=initialFlow();let revision=1;
    const ids=state.stock.map(card=>card.id);
    for(let i=0;i<3;i++)state=advanceFlow(state,{Flow:'deal'});
    for(const id of ids){
        const doc=flowDocument(state,revision++);
        expect(doc.offer.actions.some(action=>action.id===`play:${id}`)).toBe(true);
        state=advanceFlow(state,{Play:{cardId:id}});
        expect(()=>advanceFlow(state,{Play:{cardId:id}})).toThrow();
        state=advanceFlow(state,{Flow:'collect'});
        expect([...state.stock,...state.hand,...state.play,...state.captured].map(card=>card.id).sort()).toEqual([...ids].sort());
    }
    expect(state.captured).toHaveLength(3);expect(state.hand).toHaveLength(0);
    const reset=advanceFlow(state,{Flow:'reset'});expect(reset.round).toBe(2);expect(reset.stock).toHaveLength(3);
    expect(()=>advanceFlow(reset,{Flow:'collect'})).toThrow();
    expect(()=>advanceFlow(reset,{Play:{cardId:ids[0]}})).toThrow();
});

test('root routing keeps a straight path and snaps instead of taking a detour',()=>{
    const clip={x:0,y:0,width:500,height:500},a={x:0,y:0,width:40,height:40},b={x:400,y:400,width:40,height:40},obstacle={x:210,y:210,width:20,height:20};
    expect(flightPath(a,b,clip,[])).toEqual([a,b]);
    expect(flightPath(a,b,clip,[obstacle])).toBe(null);
    expect(flightPath(a,b,clip,[{x:100,y:0,width:20,height:500},{x:0,y:100,width:500,height:20}])).toBe(null);
});
