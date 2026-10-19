import {commandsForPayloads,type ActionOffer} from '../../table/presentation';
import type {FiniteDecisionSpec,DecisionCaptionAtom} from '../../table/decisionModel';
import type {Action,Contract,ContractChange,Suit} from './types';
const suitKey=(suit:Suit|null)=>suit??'no-trump';
const names={Spade:'스페이드',Heart:'하트',Diamond:'다이아몬드',Club:'클로버'} as const;
const trump=(suit:Suit|null):DecisionCaptionAtom=>suit?{kind:'suit',suit,label:names[suit]}:{kind:'text',text:'노기루다'};
const caption=(contract:Contract):readonly DecisionCaptionAtom[]=>[trump(contract.trump),{kind:'number',value:contract.count}];
const valid=(contract:Contract)=>!!contract&&(['Spade','Heart','Diamond','Club',null] as const).includes(contract.trump)&&Number.isInteger(contract.count)&&contract.count>=0&&contract.count<=255;
const suffix=(count:number)=>[0,3,6].includes(count%10)?'으로':'로';
/** Exact server result notes are the sole contract-change vocabulary. No cost,
 * rule reconstruction or action-label parsing enters this adapter. */
export function exchangeContractDecision(offer:ActionOffer<Action>,current:Contract,notes:readonly ContractChange[]):FiniteDecisionSpec|null{
 const offered=offer.actions.filter(action=>action.kind==='command'&&typeof action.action==='object'&&('ChangeTrump'in action.action||'Raise'in action.action));
 if(!offered.length){if(notes.length)throw Error('Foreign exchange contract notes');return null;}
 if(!valid(current)||new Set(offered.map(action=>action.id)).size!==offered.length||notes.length!==offered.length)throw Error('Invalid exchange contract metadata');
 const results=new Map<string,Contract>();
 const bindings=commandsForPayloads({id:offer.id,actions:offered},notes.map(note=>note.action));
 for(const [index,note] of notes.entries()){const binding=bindings[index];if(!binding||results.has(binding.id)||!valid(note.contract)||typeof note.action!=='object'||!('ChangeTrump'in note.action||'Raise'in note.action))throw Error('Invalid exchange contract note');
  if('ChangeTrump'in note.action?note.contract.trump!==note.action.ChangeTrump:note.contract.trump!==note.action.Raise.trump||note.contract.count!==note.action.Raise.count)throw Error('Inconsistent exchange contract result');results.set(binding.id,note.contract);
 }
 const changes=offered.filter(item=>item.kind==='command'&&typeof item.action==='object'&&'ChangeTrump'in item.action),raises=offered.filter(item=>item.kind==='command'&&typeof item.action==='object'&&'Raise'in item.action),filtered=changes.length>0&&raises.length>0;
 const contexts=filtered?{trump:{value:suitKey(current.trump),caption:[trump(current.trump)]}}:undefined;
 const actionOptions=offered.map(item=>{if(item.kind!=='command')throw Error();const result=results.get(item.id)!;return{id:item.id,label:caption(result).map(atom=>atom.kind==='suit'?atom.label:atom.kind==='number'?String(atom.value):atom.text).join(' '),caption:caption(result),enabled:true};});
 const fields=filtered?[{id:'trump',label:'기루다 변경',options:changes.map(item=>{if(item.kind!=='command'||typeof item.action!=='object'||!('ChangeTrump'in item.action))throw Error();const result=results.get(item.id)!;return {id:suitKey(result.trump),label:caption(result).map(atom=>atom.kind==='suit'?atom.label:atom.kind==='number'?String(atom.value):atom.text).join(' '),caption:caption(result),enabled:true};})},{id:'contract',label:'바꿀 공약',options:actionOptions}]:[{id:'contract',label:changes.length?'기루다 변경':'공약 올리기',options:actionOptions}];
 return {kind:'finite-choice',id:'exchange-contract',policy:'staged',presentation:{kind:'choice-strips'},commands:[],fields,...(contexts?{contexts}:{}),initialValues:{},reconciliation:'preserve-compatible',submit:{unavailable:'hidden'},variants:offered.map(item=>{if(item.kind!=='command')throw Error();const result=results.get(item.id)!,change=typeof item.action==='object'&&'ChangeTrump'in item.action,keep=!change&&result.trump===current.trump;
  return {tuple:{...(filtered?{trump:suitKey(result.trump)}:{}),contract:item.id},actionId:item.id,caption:[...(keep?[]:[trump(result.trump)]),{kind:'number',value:result.count},{kind:'text',join:'previous',text:`${suffix(result.count)} ${keep?'올리기':'바꾸기'}`}]};})};
}
