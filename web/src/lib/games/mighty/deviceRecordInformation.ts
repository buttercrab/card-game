import type {InformationPanel,InformationValue} from '../../table/foundation/contracts';
import {ACHIEVEMENTS} from './achievementCatalog';
import type {DeviceRead} from './completionStore';
import type {Role} from './stats';
const roles:readonly [Role,string][]=[['declarer','주공'],['friend','프렌드'],['defense','야당']];
const value=(text:string):InformationValue=>({kind:'text',text});
const rate=(won:number,count:number)=>count?`${Math.round(won/count*100)}%`:'–';
const signed=(n:number)=>`${n>0?'+':''}${n}`;
const contract=(hand:{contract:{trump:'Spade'|'Diamond'|'Heart'|'Club'|null;count:number}}):Extract<InformationValue,{kind:'inline'}>=>({kind:'inline',values:[hand.contract.trump?{kind:'suit',suit:hand.contract.trump,label:{Spade:'스페이드',Diamond:'다이아몬드',Heart:'하트',Club:'클로버'}[hand.contract.trump]}:{kind:'text',text:'노기루다'},{kind:'number',value:hand.contract.count}]});
/** Consumes the validated device owner snapshot. Only twelve recent summaries
 * are projected; the retained ledger and original completion identities never
 * enter presentation. No actions, game commands, card faces or geometry. */
export interface MightyDeviceRecordSection {readonly id:'overview'|'recent'|'achievements';readonly title:string;readonly information:readonly InformationPanel[];}
export function mightyDeviceRecordInformation(read:DeviceRead):readonly MightyDeviceRecordSection[] {
 if(read.status!=='ready')return [{id:'overview',title:'내 기록',information:[{id:'device-records',title:'내 기록',summary:{text:'기록을 읽지 못했어요',tone:'danger'},fields:[{id:'error',label:'안내',value:value(read.message)}]}]}];
 const {hands,unlocked}=read.records,wins=hands.filter(hand=>hand.won).length,total=hands.reduce((sum,hand)=>sum+hand.payoff,0);
 const best=hands.filter(hand=>hand.role==='declarer'&&hand.won).reduce<(typeof hands)[number]|null>((best,hand)=>!best||hand.contract.count>best.contract.count||hand.contract.count===best.contract.count&&hand.contract.trump===null&&best.contract.trump!==null?hand:best,null);
 const summary:InformationPanel={id:'device-records',title:'내 기록',summary:{text:`승률 ${rate(wins,hands.length)}`,tone:'plain'},primary:{label:'플레이한 판',value:{kind:'number',value:hands.length}},fields:[
  {id:'scope',label:'기준',value:value('이 기기에서 플레이한 판만 기록돼요.')},
  {id:'wins',label:'승리',value:{kind:'number',value:wins}},
  {id:'total',label:'누적 점수',value:value(signed(total))},
  ...(!hands.length?[{id:'empty',label:'안내',value:value('아직 끝낸 판이 없어요. 한 판 하고 오세요!')}]:[]),
  ...(best?[{id:'best',label:'주공으로 이긴 가장 큰 공약',value:contract(best)}]:[]),
 ]};
 const rolePanel:InformationPanel={id:'device-roles',title:'역할별 기록',fields:roles.flatMap(([id,title])=>{const mine=hands.filter(hand=>hand.role===id);return [
  {id:`${id}:hands`,label:`${title} · 판`,value:{kind:'number' as const,value:mine.length}},
  {id:`${id}:rate`,label:`${title} · 승률`,value:value(rate(mine.filter(hand=>hand.won).length,mine.length))},
  {id:`${id}:payoff`,label:`${title} · 점수`,value:value(signed(mine.reduce((sum,hand)=>sum+hand.payoff,0)))}
 ];})};
 const recent:InformationPanel={id:'device-recent',title:'최근 판',fields:hands.slice(-12).reverse().map((hand,index)=>({id:`recent:${index}`,label:`${index+1} · ${roles.find(([role])=>role===hand.role)![1]} · ${hand.won?'승리':'패배'}`,value:{kind:'inline',values:[{kind:'text',text:`${signed(hand.payoff)}점`},...contract(hand).values]}}))};
 const awards:InformationPanel={id:'device-achievements',title:'업적',summary:{text:`${ACHIEVEMENTS.filter(item=>Object.hasOwn(unlocked,item.id)).length}/${ACHIEVEMENTS.length}`,tone:'plain'},fields:ACHIEVEMENTS.map(item=>({id:item.id,label:item.title,value:value(`${Object.hasOwn(unlocked,item.id)?'달성':'잠김'} · ${item.how}`)}))};
 return [{id:'overview',title:'내 기록',information:[summary,rolePanel]},{id:'recent',title:'최근 판',information:[recent]},{id:'achievements',title:'업적',information:[awards]}];
}
