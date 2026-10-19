import type {DecisionSpec,ChoiceOption} from '../../table/decisionModel';
import type {ActionOffer,CommandSpec} from '../../table/presentation';
import {friendCallLabel,mightyCard,sameCard,sealOf,SUITS} from './cards';
import type {Action,Card,Contract,FriendCall,Rules} from './types';
type FriendCommand=CommandSpec<Action>&{readonly action:{CallFriend:FriendCall}};
/** Game meaning only: featured calls and public card artwork. No draft or layout. */
export function friendDecision(offer:ActionOffer<Action>,hand:readonly Card[],rules:Rules,contract:Contract,seatName:(seat:number)=>string):DecisionSpec {
 const calls=offer.actions.filter((spec):spec is FriendCommand=>spec.kind==='command'&&typeof spec.action==='object'&&'CallFriend'in spec.action);
 if(!calls.length)return {kind:'commands',id:'mighty-friend',commands:offer.actions.filter(spec=>spec.kind==='command').map(spec=>spec.id)};
 const mighty=mightyCard(contract.trump),twoJokers=rules.deck==='TwoJokers';
 const isMine=(card:Card)=>hand.some(held=>sameCard(card,held));
 const order=(call:FriendCall)=>typeof call==='object'&&'Card'in call?'Joker'in call.Card?(call.Card.Joker==='Black'?0:1):10+SUITS.indexOf(call.Card.Normal[0])*20+14-call.Card.Normal[1]:1000;
 const featured:string[]=[];
 const feature=(call:FriendCall)=>{const spec=calls.find(spec=>JSON.stringify(spec.action.CallFriend)===JSON.stringify(call));if(spec&&!featured.includes(spec.id)&&!(typeof call==='object'&&'Card'in call&&isMine(call.Card)))featured.push(spec.id);};
 feature({Card:mighty});feature({Card:{Joker:'Black'}});feature({Card:{Joker:'Red'}});
 if(contract.trump){feature({Card:{Normal:[contract.trump,14]}});feature({Card:{Normal:[contract.trump,13]}});}
 feature('FirstTrick');feature('Alone');
 const sorted=[...calls].sort((a,b)=>order(a.action.CallFriend)-order(b.action.CallFriend));
 const options:ChoiceOption[]=sorted.map(spec=>{
  const call=spec.action.CallFriend,card=typeof call==='object'&&'Card'in call?call.Card:null;
  let label=friendCallLabel(call,seatName,twoJokers);
  if(card&&sameCard(card,mighty))label='마이티';
  else if(card&&'Normal'in card&&card.Normal[0]===contract.trump&&[13,14].includes(card.Normal[1]))label=`기루다 ${card.Normal[1]===14?'A':'K'}`;
  const seal=card?sealOf(card,rules,contract.trump):null;
  return {id:spec.id,label,enabled:spec.enabled,...(card?{visual:'Normal'in card?{kind:'standard' as const,suit:card.Normal[0],rank:card.Normal[1]}:{kind:'joker' as const,color:card.Joker},...(seal?{emphasis:seal==='mighty'?'special' as const:seal}:{})}:{}),...(card&&isMine(card)?{description:'내 카드를 프렌드로 부르면 혼자 플레이해요.'}:{})};
 });
 const grouped=(own:boolean)=>sorted.filter(spec=>{const call=spec.action.CallFriend;return typeof call==='object'&&'Card'in call&&isMine(call.Card)===own;}).map(spec=>spec.id);
 const groups=[{id:'cards',label:'카드',optionIds:grouped(false)},{id:'held',label:'내 카드',optionIds:grouped(true)},{id:'other',label:'다른 부르기',optionIds:sorted.filter(spec=>{const call=spec.action.CallFriend;return !(typeof call==='object'&&'Card'in call);}).map(spec=>spec.id)}].filter(group=>group.optionIds.length);
 const ids=new Set(calls.map(spec=>spec.id));
 return {kind:'finite-choice',id:'mighty-friend',commands:offer.actions.filter(spec=>!ids.has(spec.id)&&spec.kind==='command').map(spec=>spec.id),fields:[{id:'friend',label:'프렌드',options,catalogue:{title:'프렌드 카드 선택',openLabel:'다른 카드…',featuredIds:featured,groups}}],variants:calls.map(spec=>({tuple:{friend:spec.id},actionId:spec.id})),initialValues:{friend:featured[0]??options[0].id},reconciliation:'preserve-compatible',submit:{unavailable:'disabled'}};
}
