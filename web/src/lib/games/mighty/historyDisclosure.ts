import {cloneAssistanceData} from '../../table/foundation/assistance';
import type {InformationPanel,InformationValue} from '../../table/foundation/contracts';
import type {DisclosureCard,DisclosureCardRef,DisclosureDocument,DisclosurePlay,DisclosureSection} from '../../table/foundation/disclosureTypes';
import {projectMightyHistory,type MightyHistoryInput} from './history';

export interface MightyHistoryDisclosureInput {readonly entryId:string;readonly source:MightyHistoryInput;}
const text=(value:string):InformationValue=>({kind:'text',text:value});
/** Raw selected PUBLIC record only. A forged available projection grants no
 * privacy authority. Runtime/catalog policy owns selection and local navigation. */
export function createMightyHistoryDisclosure(input:MightyHistoryDisclosureInput):DisclosureDocument {
 // Select descriptors rather than cloning a host/provider object. The strict
 // history boundary owns ONLY the selected raw record and rejects its accessors.
 const entry=Object.getOwnPropertyDescriptor(input,'entryId');
 const selected=Object.getOwnPropertyDescriptor(input,'source');
 if(!entry||!('value'in entry)||typeof entry.value!=='string'||entry.value.length>2048||!entry.value.trim())throw Error('Invalid historical disclosure identity');
 const owned={entryId:entry.value as string};
 const replay=projectMightyHistory(selected&&'value'in selected?selected.value:undefined as unknown as MightyHistoryInput);
 if(replay.status==='unavailable')return cloneAssistanceData({entryId:owned.entryId,title:replay.title,roster:[],cards:[],sections:[{id:'unavailable',title:'기록 안내',kind:'content',information:[{id:'unavailable',title:'재생할 수 없는 기록',summary:{text:'기록을 열 수 없어요',tone:'muted'},fields:[{id:'reason',label:'안내',value:text(replay.message)}]}]}]});
 const people=new Map(replay.roster.map(person=>[person.id,`person:${person.seat}`]));
 const roster=replay.roster.map(person=>({id:people.get(person.id)!,name:person.name,badges:[{text:{declarer:'주공',friend:'프렌드',defense:'야당'}[person.team],tone:person.team==='declarer'?'gold' as const:'plain' as const}]}));
 const cards:DisclosureCard[]=[],cardIds=new Map<string,string>(),playRefs=new Map<string,DisclosureCardRef>();
 function addCard(card:DisclosureCard,localId:string):string{
  const prior=cardIds.get(card.id);if(prior)return prior;
  cardIds.set(card.id,localId);cards.push({id:localId,label:card.label,visual:card.visual,...(card.emphasis?{emphasis:card.emphasis}:{})});return localId;
 }
 const rounds=replay.rounds.map((round,index)=>({id:`round:${index}`,title:round.label,lead:text(round.leadLabel),summary:`${replay.roster.find(person=>person.id===round.winnerId)!.name} · 점수 카드 ${round.points}장`,plays:round.plays.map((play,order):DisclosurePlay=>{
  const ref:DisclosureCardRef={cardId:addCard(play.card,`played:${index}:${order}`),...(!play.powered?{annotations:[{text:'효력 없음',tone:'muted' as const}]}:{}),winner:play.winner,leader:play.leader,...(play.jokerLead?{lead:text(play.jokerLead.label)}:{})};playRefs.set(play.id,ref);return {personId:people.get(play.participantId)!,...ref};
 })}));
 const matrix:DisclosureSection={kind:'matrix',id:'matrix',title:'전체 라운드',columns:rounds.map((round,index)=>({id:round.id,label:round.title,shortLabel:String(index+1)})),rows:replay.matrix.rows.map(row=>({personId:people.get(row.participantId)!,cells:row.cells.map(cell=>cell.kind==='blank'?null:playRefs.get(cell.play.id)!)}))};
 const summary:InformationPanel={id:'summary',title:'점수·교환',summary:{text:replay.details.run?'런':replay.details.made?'여당 승리':'야당 승리',tone:replay.details.run?'gold':'plain'},primary:{label:'여당 획득',value:{kind:'number',value:replay.details.teamPoints}},fields:[{id:'contract',label:'공약',value:text(replay.details.contractLabel)},...replay.roster.map(person=>({id:`payoff:${person.seat}`,label:person.name,value:text(`${person.payoff>0?'+':''}${person.payoff}점`)}))]};
 const scoring:InformationPanel[]=[];
 for(let offset=0;offset<replay.details.scoring.length;offset+=12)scoring.push({id:`score:${offset/12}`,title:offset?'점수 계산 계속':'점수 계산',fields:replay.details.scoring.slice(offset,offset+12).map((line,index)=>({id:`line:${offset+index}`,label:`${offset+index+1}단계`,value:text(line)}))});
 const sections:DisclosureSection[]=[{kind:'rounds',id:'rounds',title:'라운드별',rounds},matrix,{kind:'content',id:'details',title:'점수·교환',information:[summary,...scoring]}];
 sections.push({kind:'content',id:'points',title:'가져온 점수 카드',cardGroups:replay.details.points.map((group,index)=>({id:`points:${index}`,label:replay.roster.find(person=>person.id===group.participantId)!.name,personId:people.get(group.participantId)!,description:`점수 카드 ${group.cards.length}장`,cardIds:group.cards.map(card=>cardIds.get(card.id)!)}))});
 const discards=replay.details.discards;
 if(discards.kind==='hidden')sections.push({kind:'content',id:'exchange',title:'버린 카드',information:[{id:'hidden-discards',title:'버린 카드',fields:[{id:'privacy',label:'공개 범위',value:text(discards.explanation)}]}]});
 else sections.push({kind:'content',id:'exchange',title:'버린 카드',cardGroups:[{id:'discards',label:'주공이 버린 카드',...(!discards.cards.length?{description:'공개된 버린 카드가 없어요.'}:{}),cardIds:discards.cards.map((card,index)=>addCard(card,`discard:${index}`))}]});
 // Short local references keep the working set independent of long room/player
 // identities. No historical face participates in live scene movement or input.
 return cloneAssistanceData({entryId:owned.entryId,title:replay.title,roster,cards,sections});
}
