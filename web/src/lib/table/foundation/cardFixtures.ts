import type { TableDocument } from './contracts';
import { proofDocument } from './fixtures';
export type CardProofAction = { Play: { cardId: string } } | { DiscardCards: readonly string[] } | 'Pass';
/** Exact local fixtures only: the live server's sequential discard is not made atomic here. */
export function cardDocument(mode: 'play' | 'discard', options: {revision?:number;longName?:boolean;sparse?:boolean}={}): TableDocument<CardProofAction> {
    const base=proofDocument({...options,cards:mode==='play'?10:13});
    const hand=base.hand;
    const sets=mode==='play'
        ? hand.filter((_,index)=>!options.sparse||index%2===0).map(card=>[card.id])
        : hand.flatMap((a,i)=>hand.slice(i+1).flatMap((b,offset)=>hand.slice(i+offset+2).map(c=>[a.id,b.id,c.id])))
            .filter(ids=>!options.sparse||ids.includes(hand[0].id));
    const actions=sets.map((cardIds,index)=>({id:`${mode}:${index}`,label:mode==='play'?'카드 내기':'3장 버리기',intent:'primary' as const,kind:'command' as const,enabled:true,
        action:mode==='play'?{Play:{cardId:cardIds[0]}}:{DiscardCards:cardIds}}));
    return {...base,
        offer:{id:`card-proof:${mode}:${options.revision??1}:${!!options.sparse}`,actions:[...actions,{id:'pass',label:'패스',kind:'command',intent:'secondary',enabled:true,action:'Pass'}]},
        facts:[{id:'fixture',subject:'table',essential:true,label:'구성 검증',value:mode==='play'?'한 장 선택 후 확정 · 합성 행동':'세 장을 선택 후 한 번에 확정 · 실제 서버의 교환 구현 아님'}],
        decision:{kind:'card-selection',id:`cards:${mode}`,commands:['pass'],mode:mode==='play'?'one':'many',variants:sets.map((cardIds,index)=>({cardIds,actionId:actions[index].id})),submit:{prefix:'선택 확정'}},
    };
}
