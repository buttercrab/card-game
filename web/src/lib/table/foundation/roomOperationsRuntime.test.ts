import {expect,test,vi} from 'vitest';
import {CATALOG} from '../../catalog';
import type {GameTypes,RoomViewOf} from '../../room/types';
import type {CommandWindow} from '../../generated/protocol';
import type {Environment,PlannedNode,SurfaceCallbacks,SurfacePort} from './contracts';
import {proofDocument,type ProofAction} from './fixtures';
import {connectedDocument,publicConnectedDocument,type HostCommand} from './connectedDocument';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {shellCommandActionIds} from './roomShell';
const env:Environment={width:390,height:844,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
function metadata(seat:number|null=0,viewer='local'){
 const room:RoomViewOf<GameTypes>={id:'operations',game:'generic',protocol:CATALOG.protocol,settings:{},rules:{},customized:false,in_hand:false,showing:false,
  seats:[{kind:'human',name:'재용',connected:true,away:false},{kind:'bot',name:'호두',level:'easy'},{kind:'empty'},{kind:'human',name:'보리',connected:false,away:false}],
  participant_ids:['local','bot','empty','offline'],ready:[true,true,false,false],watching:1,observers:[{id:'watcher',name:'모과',requested:false}],participation:[],
  table:{turn_secs:30,shuffle:false,shuffle_next:false},clock:null,scores:[0,0,0,0],hands_played:0,history:[],hands:[]};
 const roomWindow:CommandWindow={scope:{domain:'room',room_id:room.id,room_epoch:'a'.repeat(32),session_id:1,hand:0,version:7,actor_id:viewer,seat},next_sequence:1};
 return {roomCode:room.id,client:{status:'open' as const,room,game:null,seat,viewerId:viewer,viewerName:viewer},roomWindow,botLevels:CATALOG.bot_levels};
}
function document(details=metadata(),revision=1){
 const base=proofDocument({revision});
 // Room operations use the connected, scoped host boundary. The observer's
 // game publication is inert; relabeling active proof bids would grant gameplay.
 const view=details.client.seat===null?{...base,participant:{id:details.client.viewerId,name:details.client.viewerName,markers:[],role:'observer' as const},hand:[],facts:[],decision:{kind:'commands' as const,id:'observer-game',commands:[]},offer:{id:`observer-game:${revision}`,actions:[]}}:base;
 return connectedDocument({...view,context:{...view.context,audience:details.client.viewerId}},details);
}
function fixture(details=metadata()){
 const send=vi.fn(),invoke=vi.fn(),session=createCardSession<HostCommand<ProofAction,unknown>>({transport:send});session.receive(document(details));let callbacks:SurfaceCallbacks;
 const surface:SurfacePort={identity:{},environment:()=>env,listen(value){callbacks=value;return()=>{};},measure(requests,reply){reply(requests.map(request=>{const natural=[...request.text].length*8,width=request.width??natural;return {key:request.key,size:{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*24}};}));return()=>{};},publish:()=>{},invalidate:()=>{},disarm:()=>{},clear:()=>{},fallback:vi.fn()};
 const table=createCardTable({session,effects:{invoke}});table.attach(surface);
 const activate=(node:PlannedNode)=>{const frameId=table.inspect().frame!.id;callbacks.intent({kind:'begin',frameId,nodeId:node.id});callbacks.intent({kind:'activate',frameId,nodeId:node.id});};
 const find=(predicate:(node:PlannedNode)=>boolean)=>{const node=table.inspect().frame?.nodes.find(predicate);if(!node)throw new Error('Missing node '+table.inspect().status);return node;};
 const openPeople=()=>activate(find(node=>node.shellActionId==='room-shell:people'));
 const inspect=(kind:'room'|'person'|'seat',id?:number|string)=>activate(find(node=>{const intent=node.shellIntent;if(intent?.kind!=='inspect-subject'||intent.subject.kind!==kind)return false;return kind==='seat'?intent.subject.kind==='seat'&&intent.subject.seat===id:kind==='person'?intent.subject.kind==='person'&&intent.subject.participantId===id:true;}));
 const operation=(type:string,seat?:number)=>{const action=session.snapshot().document!.offer.actions.find(binding=>binding.kind==='command'&&binding.id!=='host:leave'&&binding.action.kind==='room'&&binding.action.action.type===type&&(seat===undefined||'seat'in binding.action.action&&binding.action.action.seat===seat));if(!action)throw new Error('Missing action '+type);return find(node=>node.shellIntent?.kind==='command'&&node.shellIntent.actionId===action.id);};
 return {details,send,invoke,session,table,find,activate,openPeople,inspect,operation,get callbacks(){return callbacks;},dispose(){table.dispose();session.dispose();}};
}
test('subject operations stay out of the game strip and submit one exact canonical command',async()=>{
 const f=fixture(),canonical=f.session.snapshot().document!,ids=shellCommandActionIds(canonical.shell!);
 expect(f.table.inspect().frame!.nodes.some(node=>node.actionId&&ids.includes(node.actionId))).toBe(false);
 f.openPeople();f.inspect('seat',1);expect(f.table.inspect().shellSubject).toEqual({kind:'seat',seat:1,participantId:'bot'});
 const remove=f.operation('remove_bot',1);f.activate(remove);await Promise.resolve();
 expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action).toMatchObject({kind:'room',action:{type:'remove_bot',seat:1},expected:f.details.roomWindow.scope});
 f.activate(remove);await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.invoke).not.toHaveBeenCalled();f.dispose();
});
test('destructive confirmation cancels without sending and admission uses the current scoped command once',async()=>{
 const f=fixture();f.openPeople();f.inspect('seat',3);const clear=f.operation('clear_seat',3);f.activate(clear);
 expect(f.table.inspect().commandConfirmation).toBe(true);expect(f.table.inspect().frame!.nodes.find(node=>node.id==='room-dialog')!.label).toContain('보리');
 const previous=f.table.inspect().frame!,confirm=f.find(node=>node.shellActionId==='room-shell:confirm-command');
 expect(Object.isFrozen(confirm.shellIntent)).toBe(true);f.table.back();expect(f.table.inspect().commandConfirmation).toBe(false);
 f.callbacks.intent({kind:'activate',frameId:previous.id,nodeId:confirm.id});await Promise.resolve();expect(f.send).not.toHaveBeenCalled();
 f.activate(f.operation('clear_seat',3));f.activate(f.find(node=>node.shellActionId==='room-shell:confirm-command'));await Promise.resolve();
 expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action.action).toEqual({type:'clear_seat',seat:3});f.dispose();
});
test('frontend-only document revision retains compatible confirmation but stale held input remains rejected',async()=>{
 const f=fixture();f.openPeople();f.inspect('room');f.activate(f.operation('reset_scores'));
 const before=f.table.inspect().frame!,confirm=f.find(node=>node.shellActionId==='room-shell:confirm-command');
 f.session.receive(document(f.details,2));expect(f.table.inspect().commandConfirmation).toBe(true);
 f.callbacks.intent({kind:'activate',frameId:before.id,nodeId:confirm.id});await Promise.resolve();expect(f.send).not.toHaveBeenCalled();
 f.activate(f.find(node=>node.shellActionId==='room-shell:confirm-command'));await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);f.dispose();
});
test('server room scope change invalidates confirmation even if the semantic operation ID remains stable',async()=>{
 const f=fixture();f.openPeople();f.inspect('room');const reset=f.operation('reset_scores');f.activate(reset);
 const before=f.table.inspect().frame!,confirm=f.find(node=>node.shellActionId==='room-shell:confirm-command');
 f.details.roomWindow.scope.version++;f.session.receive(document(f.details,2));expect(f.table.inspect().commandConfirmation).toBe(false);expect(f.table.inspect().shellConfirmation).toBe(false);
 f.callbacks.intent({kind:'activate',frameId:before.id,nodeId:confirm.id});await Promise.resolve();expect(f.send).not.toHaveBeenCalled();
 f.activate(f.operation('reset_scores'));f.activate(f.find(node=>node.shellActionId==='room-shell:confirm-command'));await Promise.resolve();
 expect(f.send.mock.calls[0][0].action.expected.version).toBe(8);f.dispose();
});
test('replacement participant cannot inherit an open destructive confirmation or detail target',async()=>{
 const f=fixture();f.openPeople();f.inspect('seat',3);f.activate(f.operation('clear_seat',3));
 const previous=f.table.inspect().frame!,confirm=f.find(node=>node.shellActionId==='room-shell:confirm-command');
 f.details.client.room.participant_ids![3]='replacement';f.details.client.room.seats[3]={kind:'human',name:'새 참가자',connected:true,away:false};f.details.roomWindow.scope.version++;
 f.session.receive(document(f.details,2));expect(f.table.inspect().commandConfirmation).toBe(false);expect(f.table.inspect().shellPage).toBe('people');
 f.callbacks.intent({kind:'activate',frameId:previous.id,nodeId:confirm.id});await Promise.resolve();expect(f.send).not.toHaveBeenCalled();
 expect(f.table.inspect().frame!.nodes.some(node=>node.label.includes('보리님을'))).toBe(false);
 expect(f.table.inspect().shellHistoryDepth).toBeLessThanOrEqual(1);f.dispose();
});
test('actor revocation and no-window public shell cannot execute retained management controls',async()=>{
 const f=fixture();f.openPeople();f.inspect('room');f.activate(f.operation('reset_scores'));const old=f.table.inspect().frame!,confirm=f.find(node=>node.shellActionId==='room-shell:confirm-command');
 f.session.revoke();f.session.receive(publicConnectedDocument({...f.details,roomWindow:null,client:{...f.details.client,status:'closed'}},2),{connected:false});
 f.callbacks.intent({kind:'activate',frameId:old.id,nodeId:confirm.id});await Promise.resolve();expect(f.send).not.toHaveBeenCalled();expect(f.table.inspect().commandConfirmation).toBe(false);f.dispose();
});
test('observer request, cancel and reservation acceptance use scoped room commands without fabricated joins',async()=>{
 const details=metadata(null,'watcher'),f=fixture(details);f.openPeople();f.inspect('person','watcher');f.activate(f.operation('request_seat'));
 await Promise.resolve();expect(f.send.mock.calls[0][0].action.action).toEqual({type:'request_seat',requested:true,seat:null});
 f.session.resolve(f.session.snapshot().operations[0].id,'accepted');details.client.room.participation=[{id:'watcher',name:'모과',order:1,seat:1,target_id:'bot',offered_by:null}];details.roomWindow.scope.version++;
 f.session.receive(document(details,2));f.activate(f.operation('accept_seat',1));await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(2);expect(f.send.mock.calls[1][0].action.action).toEqual({type:'accept_seat',seat:1,target_id:'bot'});f.dispose();
 const cancelled=fixture({...metadata(null,'watcher'),client:{...details.client,room:{...details.client.room,participation:[{id:'watcher',name:'모과',order:1,seat:null,target_id:null,offered_by:null}]}}});
 cancelled.openPeople();cancelled.inspect('person','watcher');cancelled.activate(cancelled.operation('request_seat'));await Promise.resolve();expect(cancelled.send.mock.calls[0][0].action.action).toEqual({type:'request_seat',requested:false,seat:null});cancelled.dispose();
});
test('stand uses a room leave command without invoking navigation; explicit references are required',async()=>{
 const f=fixture();f.openPeople();f.inspect('seat',0);const stand=f.operation('leave');
 f.activate(stand);await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action.action).toEqual({type:'leave'});expect(f.send.mock.calls[0][0].actionId).not.toBe('host:leave');expect(f.invoke).not.toHaveBeenCalled();f.dispose();
 const current=document();const action=current.shell!.management![0].actions[0];
 const invalid={...current,shell:{...current.shell!,management:[{...current.shell!.management![0],actions:[{...action,intent:{kind:'command' as const,actionId:'unknown-action'}}]}]}};
 const session=createCardSession({transport:()=>{}});expect(()=>session.receive(invalid)).toThrow(/room shell/);session.dispose();
});
test('read-only scroll focus survives publication, respects modal ownership and never activates',async()=>{
 const f=fixture();f.session.receive(document(f.details,2),{connected:false});
 const before=f.table.inspect().frame!,scroll=before.nodes.find(node=>node.kind==='group'&&node.scroll)!;expect(scroll).toBeDefined();
 f.callbacks.intent({kind:'focus',frameId:before.id,nodeId:scroll.id});expect(f.table.inspect().focusId).toBe(scroll.id);
 f.session.receive(document(f.details,3),{connected:false});expect(f.table.inspect().frame!.focusId).toBe(scroll.id);
 f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:scroll.id});await Promise.resolve();expect(f.send).not.toHaveBeenCalled();
 f.openPeople();const modal=f.table.inspect().frame!,initial=modal.focusId;
 f.callbacks.intent({kind:'focus',frameId:modal.id,nodeId:scroll.id});expect(f.table.inspect().focusId).toBe(initial);
 const viewport=modal.nodes.find(node=>node.id==='room-dialog-scroll')!;f.callbacks.intent({kind:'focus',frameId:modal.id,nodeId:viewport.id});
 expect(f.table.inspect().focusId).toBe(viewport.id);f.session.receive(document(f.details,4),{connected:false});expect(f.table.inspect().frame!.focusId).toBe(viewport.id);f.dispose();
});
