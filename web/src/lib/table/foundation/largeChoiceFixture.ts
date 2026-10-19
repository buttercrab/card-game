import {arenaDocument} from './arenaFixture';
import type {TableDocument} from './contracts';
export type LargeChoiceAction={amount:number}|'pass';
/** A complete finite domain with intentionally sparse alternatives for rejection checks. */
export function largeChoiceDocument({revision=1,longName=false,sparse=false,count=197}: {revision?:number;longName?:boolean;sparse?:boolean;count?:number}={}):TableDocument<LargeChoiceAction>{
 const base=arenaDocument({revision,longName});
 const amounts=Array.from({length:count},(_,index)=>String(index+1)),allowed=amounts.filter(amount=>!sparse||Number(amount)%7===0);
 const actions=allowed.map(amount=>({id:`amount:${amount}`,kind:'command' as const,label:`금액 ${amount}`,intent:'primary' as const,enabled:true,action:{amount:Number(amount)}}));
 return {...base,decision:{id:'large-choice',kind:'finite-choice',commands:['pass'],fields:[{id:'amount',label:'금액',options:amounts.map(amount=>({id:amount,label:longName?`${amount} · 여러 언어와 긴 설명을 포함하는 선택지입니다`:amount,enabled:true}))}],variants:allowed.map(amount=>({tuple:{amount},actionId:`amount:${amount}`})),initialValues:{amount:allowed[0]},reconciliation:'preserve-compatible',submit:{unavailable:'disabled',presentationLabel:{prefix:'확정'}}},offer:{id:`large:${revision}`,actions:[...actions,{id:'pass',kind:'command',label:'패스',intent:'secondary',enabled:true,action:'pass'}]}};
}
