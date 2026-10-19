import {createPokerOutcome} from './outcome';
import type {ConnectedGameAdapter} from '../../table/foundation/connected';
import {pokerDocument,pokerViewerMatches,sendPokerCommand,type PokerCommand} from './foundation';
import type {Poker} from './types';
export const pokerConnectedGame:ConnectedGameAdapter<Poker,PokerCommand>={id:'poker',title:'텍사스 홀덤 · 독립 판 플레이 칩',tableLabel:'텍사스 홀덤 테이블',outcome:createPokerOutcome,project:(client,revision,graceReady)=>{const document=pokerDocument(client,revision,graceReady,true);return document?{...document,facts:document.facts.filter(fact=>fact.id!=='poker:result')}:null;},viewerMatches:pokerViewerMatches,submit:sendPokerCommand,
    ruleInformation:room=>[{id:'poker-rules',title:'텍사스 홀덤 규칙',fields:[
        {id:'players',label:'참가자',value:{kind:'number',value:room.rules.players}},
        {id:'chips',label:'시작 칩',value:{kind:'number',value:room.rules.starting_stack}},
        {id:'settlement',label:'칩',value:{kind:'text',text:'매 판 독립적인 플레이 칩'}},
    ]}],
};
