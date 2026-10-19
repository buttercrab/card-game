import {CATALOG} from '../../../catalog';
import {presetRules} from '../catalog';
import type {Action,Card,ContractChange,CurrentRoomView,StateMsg} from '../types';
/** Native-schema mixed Exchange packet. Result notes are explicit authoritative
 * inputs, not recalculated by the frontend adapter. Live protocol qualification
 * remains a separate root-owned gate. */
export function exchangeCompositionFixture(viewer:'actor'|'peer'|'observer'='actor',max=20,raiseOnExchange=true){
 const rules=structuredClone(presetRules('default'));rules.bidding.max=max;rules.bidding.raise_on_exchange=raiseOnExchange;
 const hand:Card[]=Array.from({length:13},(_,i)=>({Normal:['Spade',i+2]}));
 const notes:ContractChange[]=[{action:{ChangeTrump:'Heart'},contract:{trump:'Heart',count:16}},{action:{Raise:{trump:'Spade',count:15}},contract:{trump:'Spade',count:15}},{action:{Raise:{trump:'Heart',count:17}},contract:{trump:'Heart',count:17}}];
 if(max===255){
  // Supplied least-change results are test data; expansion adds only Raise
  // actions whose result contract is the exact action itself. No UI/adapter
  // computes a cost or legality rule from these notes.
  notes.splice(0,notes.length,...(['Heart','Diamond','Club',null] as const).map(trump=>({action:{ChangeTrump:trump},contract:{trump,count:16}})),...(['Spade','Heart','Diamond','Club',null] as const).flatMap(trump=>Array.from({length:255-(trump==='Spade'?14:16)},(_,i)=>{const contract={trump,count:i+(trump==='Spade'?15:17)};return {action:{Raise:contract},contract};})));
 }
 if(!raiseOnExchange)notes.splice(0,notes.length,...notes.filter(note=>typeof note.action==='object'&&'ChangeTrump'in note.action));
 const actions:Action[]=[{Discard:hand[2]},...notes.map(note=>note.action),{Discard:hand[0]},...hand.slice(1,2).map(Discard=>({Discard})),...hand.slice(3).map(Discard=>({Discard}))];
 const room:CurrentRoomView={id:'mixed-exchange',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules,customized:true,seats:Array.from({length:5},(_,i)=>({kind:'human',name:`참가자 ${i}`,connected:true,away:false})),participant_ids:Array.from({length:5},(_,i)=>`p${i}`),ready:Array(5).fill(true),participation:[],in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:1,observers:[{id:'watcher',name:'관전자',requested:false}],scores:Array(5).fill(0),hands_played:0};
 const seat=viewer==='actor'?0:viewer==='peer'?1:null,legal=viewer==='actor'?actions:[],contracts=viewer==='actor'?notes:[];
 const state:StateMsg={version:20,room_version:20,turn:{Seat:0},grace_ms:0,legal,out_of_turn:[],policy_actions:{legal,out_of_turn:[]},notes:{unplayable:[],contracts},view:{viewer:seat===null?'Spectator':{Seat:seat},rules,first_bidder:0,hand:viewer==='actor'?hand:viewer==='peer'?hand.slice(0,10):[],hand_sizes:[13,10,10,10,10],points_taken:Array.from({length:5},()=>[]),bids:[],redealt:null,phase:{Exchange:{declarer:0,contract:{trump:'Spade',count:14},trump_changed:false,discards:viewer==='actor'?[]:null}}}};
 return {room,game:state,seat,viewerId:seat===null?'watcher':`p${seat}`,viewerName:seat===null?'관전자':`참가자 ${seat}`,status:'open' as const};
}
