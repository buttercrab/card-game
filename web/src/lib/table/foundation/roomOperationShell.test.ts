import {expect,test} from 'vitest';
import {CATALOG} from '../../catalog';
import type {GameTypes,RoomViewOf} from '../../room/types';
import type {TableDocument} from './contracts';
import type {FormOffer} from './forms';
import {withRoomOperations} from './roomOperationShell';
import {projectRoomOperations,type RoomOperationSubject} from './roomOperations';
import {projectRoomShell,validateRoomShell,waitingSeatActions,type RoomShell,type RoomShellAction} from './roomShell';
function fixture(){
 const room:RoomViewOf<GameTypes>={id:'setup',game:'generic',protocol:CATALOG.protocol,settings:{},rules:{},customized:false,in_hand:false,showing:false,seats:[{kind:'human',name:'재용',connected:true,away:false},{kind:'empty'},{kind:'bot',name:'보리',level:'normal'}],participant_ids:['me','','bot'],ready:[],watching:0,observers:[],participation:[],table:{turn_secs:30,shuffle:false,shuffle_next:false},clock:null,scores:[],hands_played:0,history:[],hands:[]};
 const client={room,status:'open' as const,seat:0,viewerId:'me',viewerName:'재용',game:null},base=projectRoomShell({roomCode:room.id,client}),operations=projectRoomOperations({room,status:'open',seat:0,viewerId:'me',botLevels:[{id:'normal',label:'보통'},{id:'hard',label:'고수'}]});
 const form:FormOffer<string>={id:'join',instanceId:'join:seat1',schemaVersion:'1',policyId:'name',baseVersion:'1',editBinding:'join:1',title:'참여하기',submitLabel:'앉기',enabled:true,binding:{},target:{kind:'host',operationId:'unused-test'},fields:[{id:'name',kind:'text',label:'이름',initial:'재용',required:true,maxCodePoints:20,maxCodeUnits:40}]};
 const subject:RoomOperationSubject={kind:'seat',seat:1};const join:RoomShellAction={id:'opaque-join',purpose:'operation',label:'참여하기',enabled:true,intent:{kind:'open-form',formId:form.id}};
 function document(shell:RoomShell):TableDocument<string>{return{context:{session:'setup',audience:'me:0',generation:'waiting',revision:'1'},participant:{id:'me',name:'재용',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'waiting',commands:operations.map(operation=>operation.id)},offer:{id:'waiting',actions:operations.map(operation=>({id:operation.id,kind:'command',label:operation.label,intent:'secondary',enabled:true,action:operation.id}))},forms:[form],shell};}
 return{room,base,operations,subject,join,form,document};
}
test('vacant setup references the first semantic bot command; occupied peers reference exact management inspectors',()=>{
 const f=fixture(),shell=withRoomOperations(f.base,f.room,f.operations,[{subject:f.subject,actions:[f.join]}]);validateRoomShell(shell,f.document(shell));
 const bot=f.operations.find(operation=>operation.purpose==='add-bot')!;expect(bot.action).toMatchObject({type:'add_bot',seat:1,level:'normal'});expect(shell.seats![1].setupActionId).toBe(bot.id);
 const exact=shell.management!.flatMap(group=>group.actions).find(action=>action.id===bot.id)!;expect(waitingSeatActions(shell)).toContain(exact);
 const peer=shell.seats![2];expect(peer.setupActionId).toBe(peer.actions[0].id);expect(peer.actions[0].intent).toEqual({kind:'inspect-subject',subject:{kind:'seat',seat:2,participantId:'bot'}});
});
test('vacant setup prefers additional canonical named-join form when no add-bot operation exists',()=>{
 const f=fixture(),shell=withRoomOperations(f.base,f.room,[],[{subject:f.subject,actions:[f.join]}]);validateRoomShell(shell,f.document(shell));expect(shell.seats![1].setupActionId).toBe(f.join.id);expect(waitingSeatActions(shell)).toEqual([f.join]);
});
test('seat management is the fallback when a vacant group offers other operations but no bot or join',()=>{
 const f=fixture(),operations=f.operations.filter(operation=>operation.purpose==='move-seat'),shell=withRoomOperations(f.base,f.room,operations);validateRoomShell(shell,f.document(shell));expect(shell.seats![1].setupActionId).toBe(shell.seats![1].actions[0].id);expect(waitingSeatActions(shell).every(action=>action.intent.kind==='inspect-subject')).toBe(true);
});
test('unknown, outsider-seat and identity-mismatched setup refs fail canonical validation',()=>{
 const f=fixture(),base=withRoomOperations(f.base,f.room,f.operations),seat=base.seats![1],foreign=base.seats![2].actions[0];
 const validate=(replacement:typeof seat,shell=base)=>()=>validateRoomShell({...shell,seats:shell.seats!.map(item=>item.seat===seat.seat?replacement:item)},f.document(shell));
 expect(validate({...seat,setupActionId:'unknown'})).toThrow();expect(validate({...seat,setupActionId:foreign.id})).toThrow();
 const wrong:RoomShellAction={id:'wrong-identity',purpose:'manage',label:'관리',enabled:true,intent:{kind:'inspect-subject',subject:{kind:'seat',seat:1,participantId:'intruder'}}};expect(validate({...seat,actions:[wrong],setupActionId:wrong.id})).toThrow();
 const roomAction=base.management!.find(group=>group.subject.kind==='room')!.actions[0];expect(validate({...seat,setupActionId:roomAction.id})).toThrow();
});
test('a valid form ref in another seat group cannot become setup authority for this seat',()=>{
 const f=fixture(),shell=withRoomOperations(f.base,f.room,f.operations,[{subject:{kind:'seat',seat:2,participantId:'bot'},actions:[f.join]}]);const bad={...shell,seats:shell.seats!.map(seat=>seat.seat===1?{...seat,setupActionId:f.join.id}:seat)};expect(()=>validateRoomShell(bad,f.document(bad))).toThrow();
});
test('helper preserves exact disabled descriptor and deduplicates referenced IDs without copying authority',()=>{
 const f=fixture(),shell=withRoomOperations(f.base,f.room,[],[{subject:f.subject,actions:[{...f.join,enabled:false}]}]);validateRoomShell(shell,f.document(shell));const referenced=shell.management![0].actions[0];expect(waitingSeatActions(shell)).toEqual([referenced]);expect(waitingSeatActions(shell)[0]).toBe(referenced);expect(waitingSeatActions(shell)[0].enabled).toBe(false);
 // The pure helper is a reference collector; ingress separately rejects foreign ownership.
 expect(waitingSeatActions({...shell,seats:[shell.seats![1],shell.seats![1]]})).toEqual([referenced]);
});
test('setup presentation uses a short semantic label without changing canonical rich command copy',()=>{
 const f=fixture(),shell=withRoomOperations(f.base,f.room,f.operations,[{subject:f.subject,actions:[f.join]}]),seat=shell.seats![1];validateRoomShell(shell,f.document(shell));expect(seat.setupLabel).toBe('봇 추가');const command=waitingSeatActions(shell).find(action=>action.id===seat.setupActionId)!;expect(command.label).toContain('보통');expect(command.label).toContain('봇');expect(command.label).not.toBe(seat.setupLabel);expect(command).toBe(shell.management!.flatMap(group=>group.actions).find(action=>action.id===seat.setupActionId));expect(shell.seats![2].setupLabel).toBe('관리');
 const joinShell=withRoomOperations(f.base,f.room,[],[{subject:f.subject,actions:[f.join]}]);expect(joinShell.seats![1].setupLabel).toBe(f.join.label);
});
test('setup label requires its known canonical ref and bounded plain nonblank text',()=>{
 const f=fixture(),shell=withRoomOperations(f.base,f.room,f.operations),seat=shell.seats![1];
 for(const replacement of [{...seat,setupActionId:undefined,setupLabel:'봇 추가'},{...seat,setupLabel:''},{...seat,setupLabel:'x'.repeat(129)},{...seat,setupLabel:()=>{}}]){
  const bad={...shell,seats:shell.seats!.map(item=>item.seat===1?replacement:item)} as RoomShell;expect(()=>validateRoomShell(bad,f.document(bad))).toThrow();
 }
});
