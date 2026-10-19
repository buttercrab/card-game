import {expect,test,vi} from 'vitest';
import {CATALOG} from '../../catalog';
import {presetRules} from '../../games/mighty/catalog';
import {mightyDocument,type MightyCommand} from '../../games/mighty/foundation';
import type {Card,Mighty,RoomView,StateMsg} from '../../games/mighty/types';
import type {CommandWindow} from '../../generated/protocol';
import {connectedDocument,HOST_LEAVE_ACTION,type HostCommand} from './connectedDocument';
import {decisionCommandIds} from './presentationCohort';
import {nativeCardPresentation} from './nativeCardPresentation';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {typography,validateLayout} from './planner';
import type {Environment,PresentationFrame,SurfaceCallbacks,SurfacePort} from './contracts';

function publication(active:boolean,count=5,revision=1,long=false){
 const rules=presetRules('default'),ids=['p0','p1','p2','p3','p4'];
 const room:RoomView={id:'stable',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules,customized:false,seats:ids.map((_,i)=>({kind:'human',name:long?'같은 길이의 긴 참가자 이름':`참가자 ${i}`,connected:true,away:false})),participant_ids:ids,ready:ids.map(()=>true),participation:[{id:'watcher',name:'대기자',seat:null,order:1,target_id:null,offered_by:null}],in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:1,observers:[{id:'watcher',name:'대기자',requested:true}],scores:ids.map(()=>0),hands_played:0,history:[],hands:[]};
 const hand:Card[]=Array.from({length:count},(_,i)=>({Normal:['Spade',i+2]}));
 const legal:StateMsg['legal']=active?hand.map(card=>({Play:{card,joker_lead:null,call_joker:false}})):[];
 const game:StateMsg={version:revision,room_version:revision,turn:{Seat:active?0:1},grace_ms:0,legal,out_of_turn:[],policy_actions:{legal,out_of_turn:[]},notes:{unplayable:[],contracts:[]},view:{viewer:{Seat:0},rules,first_bidder:0,hand,hand_sizes:[count,5,5,5,5],points_taken:ids.map(()=>[]),bids:[],redealt:null,phase:{Play:{declarer:1,contract:{trump:'Heart',count:17},call:'Alone',friend:null,no_friend:true,trick_no:4,leader:1,lead:null,plays:[],leading:null,called_joker:null,tricks:[],discards:null}}}};
 const client={status:'open' as const,room,game,seat:0,viewerId:'p0',viewerName:long?'같은 길이의 긴 참가자 이름':'참가자 0'};
 const roomWindow:CommandWindow={scope:{domain:'room',room_id:room.id,room_epoch:'a'.repeat(32),actor_id:'p0',seat:0,session_id:0,hand:0,version:revision},next_sequence:1};
 const raw=mightyDocument(client,revision,true,undefined,true)!;expect(raw).not.toBeNull();
 return connectedDocument<Mighty,MightyCommand>({...raw,interaction:{cardActivation:'repeat'}},{roomCode:room.id,client,roomWindow});
}
const environment=(width:number,height:number,textScale:number,gutter:number):Environment=>({width,height,textScale,revision:'stable',fontRevision:'stable',fontFamily:'sans-serif',scrollbarWidth:gutter,scrollbarHeight:gutter,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}});
function harness(env:Environment){
 const send=vi.fn(),session=createCardSession<HostCommand<MightyCommand,Mighty['settings']>>({transport:send});let callbacks:SurfaceCallbacks|undefined;
 const surface:SurfacePort={identity:{},environment:()=>env,listen(value){callbacks=value;return()=>{};},measure(requests,reply){reply(requests.map(r=>{const natural=[...r.text].length*8*env.textScale,width=r.width??natural;return {key:r.key,size:{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(r.role,env).lineHeight}};}));return()=>{};},publish(){},disarm(){},invalidate(){},fallback:vi.fn(),clear(){}};
 const table=createCardTable({session});table.attach(surface);
 return {session,table,send,callbacks:()=>callbacks!,receive(active:boolean,count:number,revision:number,long=false){session.receive(publication(active,count,revision,long));expect(table.inspect().status,JSON.stringify(table.inspect())).toBe('ready');const frame=table.inspect().frame!;expect(validateLayout(frame)).toEqual([]);return frame;},close(){table.dispose();session.dispose();}};
}
function absolute(frame:PresentationFrame,id:string){let node=frame.nodes.find(node=>node.id===id)!;expect(node,id).toBeDefined();const box={...node.box};while(node.parent){node=frame.nodes.find(parent=>parent.id===node.parent)!;box.x+=node.box.x;box.y+=node.box.y;}return box;}
function stable(frame:PresentationFrame){return frame.nodes.filter(node=>['arena','regular-arena','active-arena-region','native-play-instruction','dock','hand','identity',...['p1','p2','p3','p4'].flatMap(id=>[JSON.stringify(['opponent',id]),JSON.stringify([JSON.stringify(['opponent',id]),'identity'])])].includes(node.id)||node.kind==='figure'||!!node.ownHandAnchor||node.recipientId!==undefined||node.trickSlot!==undefined).map(node=>({id:node.id,kind:node.kind,box:absolute(frame,node.id)}));}

test('real connected passive Play classifies authenticated host commands without mistaking them for game controls',()=>{
 const doc=publication(false);expect(doc.decision.kind).toBe('commands');expect(doc.decision.commands).toContain(HOST_LEAVE_ACTION);expect(doc.decision.commands.length).toBeGreaterThan(1);expect(decisionCommandIds(doc)).toEqual([]);
 expect(nativeCardPresentation(doc,false,[])?.caption).toBeNull();expect(nativeCardPresentation(doc,false,[])?.captions).toEqual(nativeCardPresentation(publication(true),true,[])?.captions);
 for(const id of ['game-command','host:leave-lookalike']){const first=doc.offer.actions[0];if(first.kind!=='command')throw Error('command fixture');const foreign={...doc,decision:{...doc.decision,commands:[...doc.decision.commands,id]},offer:{...doc.offer,actions:[...doc.offer.actions,{...first,id,label:'테이블 나가기',enabled:false}]}};const session=createCardSession({transport:()=>{}});try{session.receive(foreign);expect(decisionCommandIds(session.snapshot().document!)).toContain(id);expect(nativeCardPresentation(session.snapshot().document!,false,[])).toBeUndefined();}finally{session.dispose();}}
});

test.each([[390,844,1,0],[390,844,2,15],[1280,720,1,15],[1280,800,1,0],[1280,800,1.5,15],[1440,900,2,15]])('actual host/session/runtime/planner keeps passive-first Play geometry at%s×%s scale%s gutter%s',(width,height,scale,gutter)=>{
 const h=harness(environment(width,height,scale,gutter));try{
  const first=h.receive(false,5,1),initial=stable(first);expect(first.nodes.some(node=>node.id==='native-play-caption')).toBe(false);expect(first.decisionLaneId).toBeUndefined();
  for(const [active,revision] of [[true,2],[false,3],[true,4]] as const){const frame=h.receive(active,5,revision);expect(stable(frame)).toEqual(initial);expect(!!frame.nodes.find(node=>node.id==='native-play-caption')).toBe(active);expect(frame.decisionLaneId).toBeUndefined();if(active){const card=frame.nodes.find(node=>node.cardId)!;expect(card.enabled).toBe(true);h.callbacks().intent({kind:'begin',frameId:frame.id,nodeId:card.id});h.callbacks().intent({kind:'activate',frameId:frame.id,nodeId:card.id});expect(h.session.snapshot().operations).toHaveLength(0);expect(stable(h.table.inspect().frame!)).toEqual(initial);}}
  expect(h.send).not.toHaveBeenCalled();
 }finally{h.close();}
});

test('real connected passive cohort keeps recipe refusal for observer, absent selection and wrong cardinality',()=>{
 const doc=publication(false);
 expect(nativeCardPresentation({...doc,participant:{...doc.participant,role:'observer'}},false,[])).toBeUndefined();expect(nativeCardPresentation({...doc,presentation:undefined},false,[])).toBeUndefined();expect(nativeCardPresentation({...doc,interaction:undefined},false,[])).toBeUndefined();
 const selection=doc.presentation!.selection!;expect(nativeCardPresentation({...doc,presentation:{...doc.presentation!,selection:{...selection,mode:'many' as never}}},false,[])).toBeUndefined();
});

test.each([[1280,800,1,15],[390,844,2,15]])('shrinking own hand does not resize peer bodies or public slots at%s×%s scale%s',(width,height,scale,gutter)=>{
 const h=harness(environment(width,height,scale,gutter));try{let revision=1;const frames=[10,5,4,1,0].map(count=>h.receive(false,count,revision++));
 const peers=(frame:PresentationFrame)=>frame.nodes.filter(node=>node.kind==='figure'&&node.ownerId!=='p0'||['p1','p2','p3','p4'].some(id=>node.id===JSON.stringify(['opponent',id])||node.id===JSON.stringify([JSON.stringify(['opponent',id]),'identity']))||node.recipientId!==undefined||node.trickSlot).map(node=>({id:node.id,box:absolute(frame,node.id)}));
 
 for(const frame of frames){expect(peers(frame),JSON.stringify(frames.map(f=>({count:f.nodes.filter(n=>n.kind==='card'&&n.zoneId==='hand').length,arena:f.nodes.find(n=>n.id==='active-arena-region')?.box,dock:f.nodes.find(n=>n.id==='dock')?.box})))).toEqual(peers(frames[0]));expect(absolute(frame,'native-play-instruction')).toEqual(absolute(frames[0],'native-play-instruction'));}
 expect(frames.map(frame=>frame.nodes.filter(node=>node.zoneId==='hand'&&node.kind==='card').length)).toEqual([10,5,4,1,0]);
 }finally{h.close();}
});

test('long participant names keep passive/active measured geometry without relying on a prior active layout',()=>{
 const h=harness(environment(1280,800,2,15));try{const first=h.receive(false,5,1,true),active=h.receive(true,5,2,true);expect(stable(active)).toEqual(stable(first));expect(first.nodes.some(node=>node.id==='native-play-caption')).toBe(false);}finally{h.close();}
});
