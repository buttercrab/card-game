import {proofDocument} from './fixtures';
import type {TableCard,TableDocument} from './contracts';
export type SeatDealAction={SeatDeal:'round'|'reset'};
export interface SeatDealState {readonly stock:readonly TableCard[];readonly hands:readonly (readonly TableCard[])[];readonly generation:number;readonly round:number;}
const names=['재용','보리','호두','단추','모과'];
/** Synthetic authoritative state; never spread into a viewer document. */
export function initialSeatDeal(generation=1):SeatDealState{return {stock:proofDocument({cards:15}).hand.map((card,index)=>({...card,id:`deal-card-${index}`})),hands:Array.from({length:5},()=>[]),generation,round:0};}
export function advanceSeatDeal(state:SeatDealState,action:SeatDealAction):SeatDealState{
    if(action.SeatDeal==='reset')return initialSeatDeal(state.generation+1);
    if(state.stock.length<5)throw new Error('Deal is complete');
    return {stock:state.stock.slice(5),hands:state.hands.map((hand,index)=>[...hand,state.stock[index]]),generation:state.generation,round:state.round+1};
}
export function seatDealDocument(state:SeatDealState,revision:number,viewer=0):TableDocument<SeatDealAction>{
    if(!Number.isInteger(viewer)||viewer<0||viewer>=5)throw new Error('Invalid viewer');
    const others=Array.from({length:4},(_,index)=>(viewer+index+1)%5);
    const opponents=others.map(index=>({id:`player-${index}`,name:names[index],handCount:state.hands[index].length}));
    const actions=[{id:'reset',label:'다시 시작',kind:'command' as const,intent:'secondary' as const,enabled:true,action:{SeatDeal:'reset'} as SeatDealAction},...(state.stock.length?[{id:'round',label:'한 바퀴 배분',kind:'command' as const,intent:'primary' as const,enabled:true,action:{SeatDeal:'round'} as SeatDealAction}]:[])];
    return {
        context:{session:'five-seat-proof',audience:`player-${viewer}`,generation:String(state.generation),revision:String(revision)},
        participant:{id:`player-${viewer}`,name:names[viewer],markers:[]},
        hand:state.hands[viewer],opponents,
        collections:[{id:'stock',label:'덱',purpose:'stock',hiddenCount:state.stock.length,cards:[]}],
        facts:[{id:'deal',label:'5인 배분',value:`${state.round}/3 바퀴 · 합성 서버 상태`,subject:'table',essential:true}],
        offer:{id:`seat-deal:${state.generation}:${revision}:${viewer}`,actions},
        decision:{id:'five-seat-deal',kind:'commands',commands:actions.map(action=>action.id)},
        ...(state.round?{deals:[{id:`round:${state.generation}:${state.round}`,source:'stock',cardIds:[state.hands[viewer][state.round-1].id],recipients:opponents.map(person=>({participantId:person.id,count:1}))}]}:{}),
    };
}
