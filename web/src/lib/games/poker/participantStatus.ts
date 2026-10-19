import type {InformationPanel,ParticipantStatus,StatusPresentation} from '../../table/foundation/contracts';
import type {PokerView} from '../../generated/protocol';
import type {StateMsg} from './types';
const data=(object:unknown,key:string):unknown=>{if(!object||typeof object!=='object')return undefined;const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;};
const integer=(value:unknown,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
function list(value:unknown,max:number):readonly unknown[]|null{if(!Array.isArray(value))return null;const length=data(value,'length');if(!integer(length,max))return null;const output:unknown[]=[];for(let index=0;index<length;index++){const entry=Object.getOwnPropertyDescriptor(value,String(index));if(!entry||!('value'in entry))return null;output.push(entry.value);}return output;}
/** Native PokerView has public folded/all_in flags, but no last-action log.
 * Never infer a check/call/raise from stack or bet deltas. */
export function projectPokerParticipantStatus(state:StateMsg|null,seat:number):ParticipantStatus|undefined{
 const view=data(state,'view');if(data(view,'over')!==false||!['preflop','flop','turn','river'].some(street=>data(view,'street')===street)||!integer(seat,5))return undefined;
 const players=list(data(view,'players'),6);if(!players||players.length<3)return undefined;
 const seats=players.map(player=>data(player,'seat'));if(seats.some(value=>!integer(value,players.length-1))||new Set(seats).size!==players.length)return undefined;
 const player=players.find(player=>data(player,'seat')===seat);if(!player||typeof data(player,'folded')!=='boolean'||typeof data(player,'all_in')!=='boolean')return undefined;
 if(data(player,'folded'))return Object.freeze({value:Object.freeze({kind:'text',text:'폴드'}),tone:'muted',muted:true});
 if(data(player,'all_in'))return Object.freeze({value:Object.freeze({kind:'text',text:'올인'}),tone:'accent'});
 return undefined;
}
/** Poker's existing public pot/turn/street/bet meaning, without Mighty labels. */
export function projectPokerStatusPresentation(information:readonly InformationPanel[],view:PokerView|null):StatusPresentation|undefined{
 if(data(view,'over')!==false||!['preflop','flop','turn','river'].some(street=>data(view,'street')===street))return undefined;
 const panels=list(information,4),matches=panels?.filter(panel=>data(panel,'id')==='poker:status');if(matches?.length!==1)return undefined;
 const panel=matches[0],fields=list(data(panel,'fields'),12);if(!fields)return undefined;
 const fieldIds=['street','current-bet'].filter(id=>fields.filter(field=>data(field,'id')===id).length===1);
 const primary=!!data(panel,'primary'),summary=!!data(panel,'summary');if(!fieldIds.length&&!primary&&!summary)return undefined;
 return Object.freeze({informationId:'poker:status',fieldIds:Object.freeze(fieldIds),...(primary?{primary:true}:{}),...(summary?{summary:true}:{})});
}
