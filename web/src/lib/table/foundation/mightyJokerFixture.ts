import {CATALOG} from '../../catalog';
import {presetRules} from '../../games/mighty/catalog';
import {mightyDocument,type MightyCommand} from '../../games/mighty/foundation';
import type {Action,Card,CurrentRoomView,StateMsg,Suit} from '../../games/mighty/types';
import type {TableDocument} from './contracts';

/** Production projection of a bounded QA snapshot. Submissions are recorded by
 * the preview session; no server or authoritative game transition runs here. */
export function mightyJokerDocument({revision=1,longName=false,trump='Diamond'}:{revision?:number;longName?:boolean;trump?:Suit|null}={}):TableDocument<MightyCommand>{
    const rules=presetRules('default');rules.deck='TwoJokers';
    const names=Array.from({length:5},(_,index)=>longName?`아주 긴 참가자 이름 ${index+1} · 조커 검증`:`참가자 ${index+1}`);
    const room:CurrentRoomView={id:'joker-proof',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules,customized:true,
        seats:names.map(name=>({kind:'human',name,connected:true,away:false})),in_hand:true,showing:true,
        table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),
        participant_ids:['p0','p1','p2','p3','p4'],participation:[],scores:[0,0,0,0,0],hands_played:0};
    const hand:Card[]=[{Joker:'Red'},{Normal:['Spade',14]},{Normal:['Heart',7]},{Normal:['Club',10]}];
    const jokerActions:Action[]=[
        {Play:{card:{Joker:'Red'},joker_lead:{Suit:'Spade'},call_joker:false}},
        {Play:{card:{Joker:'Red'},joker_lead:{Suit:'Heart'},call_joker:false}},
        {Play:{card:{Joker:'Red'},joker_lead:{Color:'Red'},call_joker:false}},
    ];
    const ordinaryActions:Action[]=hand.slice(1).map(card=>({Play:{card,joker_lead:null,call_joker:false}}));
    const game:StateMsg={version:7,grace_ms:0,turn:{Seat:0},legal:[...jokerActions,...ordinaryActions],out_of_turn:[],
        policy_actions:{legal:[...jokerActions.slice(0,2),...ordinaryActions],out_of_turn:[]},notes:{unplayable:[],contracts:[]},
        view:{viewer:{Seat:0},rules,first_bidder:0,hand,hand_sizes:Array(5).fill(4),points_taken:[[],[],[],[],[]],bids:[],redealt:null,
            phase:{Play:{declarer:1,contract:{trump,count:17},call:'Alone',friend:null,no_friend:true,trick_no:6,leader:0,lead:null,plays:[],leading:null,called_joker:null,tricks:[],discards:null}}}};
    const document=mightyDocument({room,game,seat:0,viewerId:'p0',viewerName:names[0]},revision);
    if(!document)throw Error('Mighty Joker QA projection unavailable');
    return document;
}
