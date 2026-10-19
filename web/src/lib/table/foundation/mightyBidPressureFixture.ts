import {CATALOG} from '../../catalog';
import {presetRules} from '../../games/mighty/catalog';
import {mightyDocument,type MightyCommand} from '../../games/mighty/foundation';
import type {Action,CurrentRoomView,StateMsg} from '../../games/mighty/types';
import type {TableDocument} from './contracts';

/** Supported native domain, projected by the production Mighty adapter. This
 * fixture does not replace the authoritative server/gameplay qualification. */
export function mightyBidPressureDocument({revision=1,longName=false}:{revision?:number;longName?:boolean}={}):TableDocument<MightyCommand>{
 const rules=presetRules('default');rules.bidding.min=1;rules.bidding.max=255;
 const names=Array.from({length:5},(_,index)=>longName?`아주 긴 참가자 이름 ${index+1} · 최대 공약 검증`:`참가자 ${index+1}`);
 const room:CurrentRoomView={id:'max-bid',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules,customized:true,
  seats:names.map(name=>({kind:'human',name,connected:true,away:false})),in_hand:true,showing:true,
  table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),
  participant_ids:['p0','p1','p2','p3','p4'],participation:[],scores:[0,0,0,0,0],hands_played:0};
 const actions:Action[]=['Pass',...(['Spade','Diamond','Heart','Club',null] as const).flatMap(trump=>Array.from({length:255},(_,index)=>({Bid:{trump,count:index+1}})))];
 const game:StateMsg={version:7,grace_ms:0,turn:{Seat:0},legal:actions,out_of_turn:[],policy_actions:{legal:actions,out_of_turn:[]},notes:{unplayable:[],contracts:[]},
  view:{viewer:{Seat:0},rules,first_bidder:0,hand:Array.from({length:10},(_,index)=>({Normal:['Spade',index+2]})),hand_sizes:Array(5).fill(10),points_taken:[[],[],[],[],[]],bids:[],redealt:null,
   phase:{Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}}}};
 const document=mightyDocument({room,game,seat:0,viewerId:'p0',viewerName:names[0]},revision);
 if(!document)throw Error('Maximum Mighty bidding projection unavailable');
 return document;
}
