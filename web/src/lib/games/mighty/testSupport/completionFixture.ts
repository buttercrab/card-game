import {presetRules} from '../catalog';
import type {MightyCompletionInput} from '../completion';
import type {RoomView,View,RecordedHand} from '../types';
export function completionFixture():MightyCompletionInput {
 const rules=presetRules('default');rules.reveal_discards=false;const contract={trump:'Heart' as const,count:17};
 const view:View={viewer:'Spectator',rules,first_bidder:0,hand:[],hand_sizes:Array(5).fill(0),points_taken:Array.from({length:5},()=>[]),bids:[],redealt:null,phase:{Done:{declarer:1,friend:2,contract,call:'FirstTrick',team_points:18,payoffs:[-2,3,3,-2,-2],value:{contract,team_points:18,made:true,steps:[],value:3},tricks:[{lead:{Suit:'Spade'},winner:1,plays:[{seat:1,card:{Normal:['Spade',14]},powered:true}]}],discards:[]}}};
 const saved:RecordedHand={session_id:2,number:3,names:['Old Alice','Old Bob','Old Carol','Old Dan','Old Eve'],participant_ids:['alice','bob','carol','dan','eve'],payoffs:[-2,3,3,-2,-2],rules,view};
 const room={id:'room',game:'mighty',in_hand:false,showing:true,current_hand:saved,session_id:2,hands_played:3,participant_ids:['bob','alice','carol','dan','eve']} as RoomView;
 return {room,scope:{domain:'room',room_id:'room',room_epoch:'epoch',session_id:2,hand:7,version:15,actor_id:'bob',seat:0},actorId:'bob',seat:0,keepsRecord:true};
}
