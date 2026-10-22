import {CATALOG} from '../../catalog';
import type {GameTypes,RoomViewOf} from '../../room/types';
import {informationDocument} from './informationFixture';
import {projectRoomShell} from './roomShell';
import type {TableDocument} from './contracts';
import type {ProofAction} from './fixtures';
export type ShellProofAction=ProofAction|'leave';
/** Pure, public five-seat room for shell/layout/input qualification. */
export function shellDocument({revision=1,longName=false,sparse=false}: {revision?:number;longName?:boolean;sparse?:boolean}={}):TableDocument<ShellProofAction>{
 const base=informationDocument({revision,longName,sparse}),people=[base.participant,...base.opponents!];
 const room:RoomViewOf<GameTypes>={id:'proof',game:'mighty',protocol:CATALOG.protocol,settings:{},rules:{},customized:false,seats:people.map((person,index)=>index?{kind:'bot',name:person.name,level:'normal'}:{kind:'human',name:person.name,connected:true,away:false}),participant_ids:people.map(person=>person.id),ready:people.map(()=>true),participation:[{id:'watcher',name:'관전자',order:1,seat:null,target_id:null,offered_by:null}],in_hand:true,showing:true,table:{turn_secs:30,shuffle:false,shuffle_next:false},clock:null,watching:2,observers:[{id:'watcher',name:longName?'관전자 · 아주 긴 이름과 참여 상태를 확인해요':'관전자',requested:true}],scores:people.map(()=>0),hands_played:0,history:[],hands:[]};
 const document:TableDocument<ShellProofAction>={...base,decision:{...base.decision,commands:[...base.decision.commands,'shell:leave']},offer:{...base.offer,actions:[...base.offer.actions,{id:'shell:leave',kind:'command',label:'테이블 나가기',intent:'danger',enabled:true,action:'leave'}]}};
 const shell=projectRoomShell({roomCode:room.id,client:{room,status:'open',seat:0,viewerId:'local'},document,ruleInformation:[{id:'rules',title:'마이티 · 이 테이블의 규칙',fields:[{id:'players',label:'인원',value:{kind:'number',value:5}},{id:'cards',label:'시작 패',value:{kind:'number',value:10}},{id:'bid',label:'최소 공약',value:{kind:'number',value:14}}]}]});
 return {...document,shell:{...shell,leaveActionId:'shell:leave'}};
}

/** Synthetic public caption gutter case. This checks measured captions,
 * not server gameplay or the approved composition of a complete Mighty hand. */
export function persistentCaptionDocument({revision = 1, longName = false, badges = false, notice = false} = {}) {
    const source = shellDocument({revision, longName});
    const status = {value: {kind: 'text' as const, text: '프렌드'}, tone: 'plain' as const, ...(badges ? {badges: [{text: '12점', tone: 'plain' as const}]} : {})};
    return {...source, stage: 'active' as const, outcome: undefined,
        ...(notice ? {shell: {...source.shell!, notices: [...source.shell!.notices, {id: 'reconnecting', text: '잠깐 다시 연결하는 중…', tone: 'plain' as const}]}} : {}),
        participant: {...source.participant, status},
        opponents: source.opponents!.map(person => ({...person, status}))};
}
