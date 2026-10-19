import {captureRetainedPublicTableRecipe} from '../../table/foundation/retainedPublicTableRecipe';
import {publicPaintResources} from '../../table/foundation/paintResources';
import {essentialInputMask} from '../../table/foundation/essentialInput';
import {native as completionNativeFixture} from '../../table/foundation/completionReceiveFixture';
import {captureCompletionReceiveSource,completionReceiveNativeProof,readyCompletionReceiveReservation} from '../../table/foundation/completionReceive';
import {expect,test,vi} from 'vitest';
import type {CommandScope} from '../../generated/protocol';
import type {RoomView,View,RecordedHand,StateMsg,Played} from './types';
import {projectRoomShell} from '../../table/foundation/roomShell';
import {deckCards} from './cards';
import {isPresentationOwnership} from '../../table/foundation/presentationOwnership';
import {resourceTransferPlan} from '../../table/foundation/transferMotion';
import {presetRules} from './catalog';
import {mightyConnectedGame} from './connected';
import {projectMightyOutcome} from './settled';
import {createCardSession} from '../../table/foundation/session';
import {createCardTable} from '../../table/foundation/runtime';
import {typography} from '../../table/foundation/planner';
import {completionFrameInputProof,isPublicCompletionView} from '../../table/foundation/publicCompletion';
import {planTrickResolution} from '../../table/foundation/trickResolution';
import type {Environment,SurfaceCallbacks,PresentationFrame} from '../../table/foundation/contracts';
function fixture(){
 const rules=presetRules('default'),contract={trump:'Heart' as const,count:17};
 const view:View={viewer:'Spectator',rules,first_bidder:0,hand:[],hand_sizes:[0,0,0,0,0],points_taken:[[],[],[],[],[]],bids:[],redealt:null,phase:{Done:{declarer:1,friend:2,contract,call:'FirstTrick',team_points:18,payoffs:[-2,3,3,-2,-2],value:{contract,team_points:18,made:true,steps:[],value:8},tricks:[{lead:{Suit:'Spade'},winner:1,plays:[{seat:1,card:{Normal:['Spade',14]},powered:true},{seat:2,card:{Normal:['Spade',10]},powered:false}]}],discards:[]}}};
 const saved:RecordedHand={number:3,names:['Old Alice','Old Bob','Old Carol','Old Dan','Old Eve'],participant_ids:['alice','bob','carol','dan','eve'],payoffs:[-2,3,3,-2,-2],rules,view};
 const room:RoomView={id:'room',game:'mighty',protocol:'test',session_id:2,settings:{preset:'default'},rules,customized:false,seats:saved.names.map(name=>({kind:'human',name,connected:true,away:false})),in_hand:false,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:[false,false,false,false,false],participant_ids:[...saved.participant_ids],participation:[],scores:[0,0,0,0,0],hands_played:3,history:[],hands:[],current_hand:saved};
 const scope:CommandScope={domain:'room',room_id:'room',room_epoch:'e'.repeat(32),session_id:2,hand:3,version:10,actor_id:'alice',seat:0};
 const client={roomScope:scope,room,game:null,seat:0,viewerId:'alice',viewerName:'Old Alice'};
 const project=()=>{const document=mightyConnectedGame.project(client,1,true)!;return {document,result:projectMightyOutcome({client,document,roomScope:scope})!};};
 return {room,scope,client,project};
}

const control={fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1};
const environment:Environment={width:1280,height:800,textScale:1,fontFamily:'sans',fontRevision:'pipeline',revision:'pipeline',controls:{command:control,choice:control}};
function pipeline(kind:'own'|'peer'|'observer',localWinner=false,localFourth=false){
 const f=fixture(),record=f.room.current_hand!,doneView=record.view as View;
 if(typeof doneView.phase!=='object'||!('Done'in doneView.phase))throw Error('Done fixture');
 const seats=localFourth?[1,2,3,0,4]:kind==='own'?[1,2,3,4,0]:[0,1,2,3,4],plays=seats.map((seat):Played=>({seat,card:{Normal:['Spade',localWinner&&seat===0?14:seat+2]},powered:false})),incoming=plays.at(-1)!;
 doneView.phase.Done.tricks=[{lead:{Suit:'Spade'},winner:localWinner?0:1,plays}];record.session_id=2;
 const observer=kind==='observer',beforeRoom:RoomView={...f.room,in_hand:true,hands_played:2,current_hand:undefined};
 const beforeView:View={...doneView,viewer:observer?'Spectator':{Seat:0},hand:kind==='own'?[incoming.card]:[],hand_sizes:Array.from({length:5},(_,seat)=>seat===incoming.seat?1:0),phase:{Play:{declarer:1,contract:doneView.phase.Done.contract,call:'FirstTrick',friend:2,no_friend:false,trick_no:10,leader:seats[0],lead:{Suit:'Spade'},plays:plays.slice(0,-1),leading:1,called_joker:null,tricks:[],discards:null}}};
 const game:StateMsg={version:9,grace_ms:0,turn:{Seat:incoming.seat},legal:kind==='own'?[{Play:{card:incoming.card,joker_lead:null,call_joker:false}}]:[],out_of_turn:[],notes:{unplayable:[],contracts:[]},view:beforeView};
 const beforeClient={...f.client,room:beforeRoom,game,seat:observer?null:0,viewerId:observer?'watcher':'alice'},before=mightyConnectedGame.project(beforeClient,1,true)!;
 const currentGame:StateMsg={...game,version:10,turn:'Over',legal:[],view:{...doneView,viewer:observer?'Spectator':{Seat:0}}};
 const client={...f.client,game:currentGame,seat:observer?null:0,viewerId:observer?'watcher':'alice'},raw=mightyConnectedGame.project(client,2,true,before.context.generation)!,outcome=projectMightyOutcome({client,document:raw,roomScope:f.scope})!;
 if(!outcome)throw Error('Outcome projection');const next={...raw,outcome:outcome.outcome,information:[...(raw.information??[]),outcome.information],collections:outcome.collections??raw.collections,reveals:outcome.reveals??raw.reveals};return {before,next,incoming,client,beforeClient};
}
function mount(before:ReturnType<typeof pipeline>['before'],connected=true,receive=false,env=environment){
 const session=createCardSession({transport:vi.fn()});session.receive(before,{connected});let callbacks!:SurfaceCallbacks;const published:PresentationFrame[]=[],failures:string[]=[],receipts:{current:PresentationFrame;previous:PresentationFrame|null}[]=[];let nativeFrame:PresentationFrame|null=null,nativeDom:ReturnType<typeof completionNativeFixture>|undefined,clears=0;const table=createCardTable({session});
 table.attach({identity:{},environment:()=>env,listen(value){callbacks=value;return()=>{};},measure(requests,reply){reply(requests.map(r=>{const natural=[...r.text].length*7*r.environment.textScale,width=r.width??natural;return {key:r.key,size:{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(r.role,r.environment).lineHeight}};}));return()=>{};},captureCompletionReceiveSource(frameId,participantId){return receive&&nativeFrame?.id===frameId&&nativeDom?captureCompletionReceiveSource(nativeFrame,participantId,nativeDom.host,nativeDom.elements,nativeDom.content):null;},publish(value){if(receive)nativeDom=completionNativeFixture(value);receipts.push({current:value,previous:nativeFrame});nativeFrame=value;published.push(value);},disarm:()=>{},invalidate:()=>{},fallback:reason=>{failures.push(reason);throw Error(reason);},clear:()=>{nativeFrame=null;clears++;}});return {session,table,get callbacks(){return callbacks;},published,receipts,failures,get clears(){return clears;},get nativeDom(){return nativeDom;}};
}
test.each(['own','peer','observer'] as const)('actual Mighty %s last-card producer→canonical→runtime→default planner→public capture pipeline',async kind=>{
 const {before,next}=pipeline(kind),host=mount(before);await vi.waitFor(()=>expect(host.table.inspect().frame).not.toBeNull());const old=host.table.inspect().frame!;
 expect(old.nodes.filter(n=>n.kind==='card'&&n.zoneId==='trick')).toHaveLength(4);expect(old.nodes.some(n=>n.zoneId==='captured'||n.stockCount!==undefined)).toBe(false);
 host.session.receive(next);await vi.waitFor(()=>expect(host.table.inspect().frame?.publicCompletion).toBeDefined());const current=host.table.inspect().frame!,completion=current.publicCompletion!;
 expect(isPublicCompletionView(completion)).toBe(true);expect(host.session.snapshot().document!.hand).toEqual([]);expect(current.nodes.filter(n=>n.trickSlot)).toHaveLength(5);expect(current.nodes.some(n=>n.actionId||n.cardId||n.inspectCardId||n.id==='outcome'||n.zoneId==='captured'||n.stockCount!==undefined)).toBe(false);
 expect(current.paintResources?.status).toBe('available');if(current.paintResources?.status!=='available')throw Error('Canonical resource plane');expect(current.paintResources.collections.find(zone=>zone.id==='captured')?.cards).toHaveLength(5);expect(current.paintResources.collections.find(zone=>zone.id==='stock')).toMatchObject({availability:'next-deal',hiddenCount:53,cards:[]});const plan=planTrickResolution(old,current);expect(plan).not.toBeNull();expect(plan!.cards).toHaveLength(5);expect(plan!.incoming).toBe(kind==='own'?'hand':'peer');expect(plan!.cards.map(c=>c.entityId).sort()).toEqual([...completion.entityIds].sort());expect(new Set(plan!.items.map(i=>i.slotId)).size).toBe(5);
 expect(host.callbacks.completionFence!(current.id,completion.event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,completion.event)).toBe(true);expect(host.callbacks.publicCompletionEnd!(current.id,completion.event,'completed')).toBe(true);await vi.waitFor(()=>expect(host.table.inspect().frame?.outcomeLaneId).toBe('outcome'));expect(host.table.inspect().frame?.publicCompletion).toBeUndefined();expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});

test.each(['wrong-count','missing-reveal','different-old-face'] as const)('actual pipeline refuses unproven terminal capture: %s',async defect=>{
 const original=pipeline('peer');let {before,next}=original;
 if(defect==='wrong-count')before={...before,opponents:before.opponents!.map(person=>person.id==='eve'?{...person,handCount:2}:person)};
 if(defect==='missing-reveal')next={...next,reveals:[]};
 if(defect==='different-old-face')before={...before,collections:before.collections!.map(zone=>zone.id==='trick'?{...zone,cards:zone.cards.map((card,index)=>index?card:{...card,visual:{kind:'standard',suit:'Heart',rank:2}})}:zone)};
 const host=mount(before);await vi.waitFor(()=>expect(host.table.inspect().frame).not.toBeNull());const outgoing=host.table.inspect().frame!;host.session.receive(next);await vi.waitFor(()=>expect(host.table.inspect().frame?.settled).toBe(true));
 const current=host.table.inspect().frame!;expect(current.publicCompletion).toBeUndefined();expect(current.outcomeLaneId).toBe('outcome');expect(planTrickResolution(outgoing,current)).toBeNull();expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});

function freshDealPipeline(){
 const terminal=pipeline('own'),client=terminal.client,rules=client.room.rules,hand=deckCards(rules).slice(0,10);
 const game:StateMsg={version:11,grace_ms:0,turn:{Seat:0},legal:['Pass'],out_of_turn:[],notes:{unplayable:[],contracts:[]},view:{viewer:{Seat:0},rules,first_bidder:0,hand,hand_sizes:Array(5).fill(10),points_taken:Array.from({length:5},()=>[]),bids:[],redealt:null,phase:{Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}}}};
 const nextClient={...client,room:{...client.room,in_hand:true,showing:true,current_hand:null},game,seat:0,viewerId:'alice',roomScope:{...client.roomScope,hand:4,version:11}},bidding=mightyConnectedGame.project(nextClient,3,true,terminal.next.context.generation)!;
 const nextOnly=mightyConnectedGame.project({...nextClient,room:{...nextClient.room,showing:false},game:null},3,true,terminal.next.context.generation)!;
 return {done:terminal.next,bidding,nextOnly};
}
test('actual Mighty Done→Bidding preserves native previous owned frame and admits all50 resource-only backs',async()=>{
 const {done,bidding}=freshDealPipeline(),host=mount(done);await vi.waitFor(()=>expect(host.table.inspect().frame?.outcomeLaneId).toBe('outcome'));const old=host.published.at(-1)!,clears=host.clears;
 expect(old.nodes.some(node=>node.stockCount!==undefined||node.zoneId==='captured')).toBe(false);expect(old.paintResources?.status).toBe('available');
 host.session.receive(bidding);await vi.waitFor(()=>expect(host.table.inspect().frame?.context.generation).toBe(bidding.context.generation));const current=host.published.at(-1)!,receipt=host.receipts.find(value=>value.current===current)!;
 expect(bidding.context.generation).not.toBe(done.context.generation);expect(host.clears).toBe(clears);expect(receipt.previous).toBe(old);
 const transfers=resourceTransferPlan(receipt.previous,current);expect(transfers).toHaveLength(50);expect(transfers.every(item=>item.presentation==='back'&&item.origin==='current'&&item.source.kind==='public-stock'&&item.source.count===3&&item.artifactSource?.kind==='public-stock'&&item.artifactSource.availability==='next-deal'&&item.artifactSource.count===53)).toBe(true);
 expect(transfers.filter(item=>item.destination.kind==='own-hand')).toHaveLength(10);expect(transfers.filter(item=>item.destination.kind==='recipient')).toHaveLength(40);expect(new Set(transfers.map(item=>item.entityId)).size).toBe(50);expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});
test.each(['next-only','no-hint','old-hand','audience','roster','stock-count','unavailable-resource','unproven-stock-role'] as const)('actual fresh-deal handoff refuses %s without retaining the old native frame',async defect=>{
 const values=freshDealPipeline();let done=values.done,next=values.bidding;
 if(defect==='next-only')next=values.nextOnly;
 if(defect==='no-hint')next={...next,deals:[]};
 if(defect==='old-hand')done={...done,hand:values.bidding.hand.slice(0,1)};
 if(defect==='audience')next={...next,context:{...next.context,audience:'another-viewer'}};
 if(defect==='roster')next={...next,scoreboard:next.scoreboard?{...next.scoreboard,rows:next.scoreboard.rows.map(row=>row.participantId==='bob'?{...row,participantId:'replacement'}:row)}:undefined,opponents:next.opponents!.map((person,index)=>index?person:{...person,id:'replacement'}),deals:next.deals!.map(hint=>({...hint,recipients:hint.recipients!.map((peer,index)=>index?peer:{...peer,participantId:'replacement'})}))};
 if(defect==='unavailable-resource')done={...done,collections:[...done.collections!,...Array.from({length:4097},(_,index)=>({id:`extra-${index}`,label:'Unselected',cards:[]}))]};
 if(defect==='unproven-stock-role')done={...done,collections:done.collections!.map(collection=>collection.id==='stock'?{...collection,availability:'current'}:collection)};
 if(defect==='stock-count')done={...done,collections:done.collections!.map(collection=>collection.id==='stock'?{...collection,hiddenCount:52}:collection)};
 const host=mount(done);await vi.waitFor(()=>expect(host.table.inspect().frame?.outcomeLaneId).toBe('outcome'));const old=host.published.at(-1)!,clears=host.clears;host.session.receive(next);await vi.waitFor(()=>expect(host.table.inspect().frame?.context.generation).toBe(next.context.generation));const current=host.published.at(-1)!,receipt=host.receipts.find(value=>value.current===current)!;
 expect(host.clears).toBeGreaterThan(clears);expect(receipt.previous).toBeNull();expect(resourceTransferPlan(receipt.previous,current)).toEqual([]);expect(host.session.snapshot().operations).toHaveLength(0);expect(old.context.generation).not.toBe(current.context.generation);host.table.dispose();host.session.dispose();
});

test('reconnection cannot reuse a revoked Done presentation as a fresh-deal native predecessor',async()=>{
 const {done,bidding}=freshDealPipeline(),host=mount(done);await vi.waitFor(()=>expect(host.table.inspect().frame?.outcomeLaneId).toBe('outcome'));const owned=host.session.snapshot().presentationOwnership;expect(isPresentationOwnership(owned,host.session)).toBe(true);host.session.setConnected(false);expect(isPresentationOwnership(owned,host.session)).toBe(false);expect(host.session.snapshot().presentationOwnership).toBeUndefined();const clears=host.clears;
 host.session.receive(bidding,{connected:true});await vi.waitFor(()=>expect(host.table.inspect().frame?.context.generation).toBe(bidding.context.generation));const current=host.published.at(-1)!,receipt=host.receipts.find(value=>value.current===current)!;
 expect(host.clears).toBeGreaterThan(clears);expect(receipt.previous).toBeNull();expect(resourceTransferPlan(receipt.previous,current)).toEqual([]);host.table.dispose();host.session.dispose();
});

test.each([{oldReady:false,nextReady:true},{oldReady:true,nextReady:false},{oldReady:false,nextReady:false}])('command-readiness preserves authenticated public origin ownership: %j',async({oldReady,nextReady})=>{
 const {done,bidding}=freshDealPipeline(),host=mount(done,oldReady);await vi.waitFor(()=>expect(host.table.inspect().frame?.outcomeLaneId).toBe('outcome'));
 const ownership=host.session.snapshot().presentationOwnership,old=host.published.at(-1)!,clears=host.clears;expect(host.session.snapshot().connected).toBe(oldReady);expect(isPresentationOwnership(ownership,host.session)).toBe(true);
 host.session.receive(bidding,{connected:nextReady});await vi.waitFor(()=>expect(host.table.inspect().frame?.context.generation).toBe(bidding.context.generation));expect(host.session.snapshot().connected).toBe(nextReady);expect(host.session.snapshot().presentationOwnership).toBe(ownership);expect(isPresentationOwnership(ownership,host.session)).toBe(true);
 const current=host.published.at(-1)!,receipt=host.receipts.find(value=>value.current===current)!;expect(host.clears).toBe(clears);expect(receipt.previous).toBe(old);expect(resourceTransferPlan(receipt.previous,current)).toHaveLength(50);expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});

function restoredTerminalPipeline(kind:'own'|'peer'|'observer'){
 const live=pipeline(kind),client={...live.client,game:null},raw=mightyConnectedGame.project(client,2,true,live.before.context.generation)!,outcome=projectMightyOutcome({client,document:raw,roomScope:client.roomScope})!;
 if(!outcome)throw Error('Public current-record outcome');const restored={...raw,outcome:outcome.outcome,information:[...(raw.information??[]),outcome.information],collections:outcome.collections??raw.collections,reveals:outcome.reveals??raw.reveals};return {...live,restored};
}
test.each(['own','peer','observer'] as const)('room-first %s terminal completes through pending readiness and audience State renewal',async kind=>{
 const {before,restored,next:audienceDone}=restoredTerminalPipeline(kind),host=mount(before,false),old=host.published.at(-1)!,ownership=host.session.snapshot().presentationOwnership;
 expect(isPresentationOwnership(ownership,host.session)).toBe(true);host.session.receive(restored,{connected:false});await vi.waitFor(()=>expect(host.table.inspect().frame?.publicCompletion).toBeDefined());let current=host.published.at(-1)!,event=current.publicCompletion!.event;
 expect(host.session.snapshot().connected).toBe(false);expect(host.session.snapshot().presentationOwnership).toBe(ownership);expect(current.nodes.filter(node=>node.trickSlot)).toHaveLength(5);expect(current.nodes.some(node=>node.actionId||node.cardId||node.inspectCardId||node.id==='outcome'||node.stockCount!==undefined||node.zoneId==='captured')).toBe(false);
 const plan=planTrickResolution(old,current);expect(plan).not.toBeNull();expect(plan!.cards).toHaveLength(5);expect(plan!.incoming).toBe(kind==='own'?'hand':'peer');expect(plan!.cards.every(card=>!card.entityId.includes('mighty-history'))).toBe(true);expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event)).toBe(true);
 const oldId=current.id;host.session.receive({...audienceDone,context:{...audienceDone.context,revision:'audience-Done'}},{connected:false});await vi.waitFor(()=>expect(host.table.inspect().frame?.id).not.toBe(oldId));current=host.published.at(-1)!;expect(current.publicCompletion?.event).toBe(event);expect(host.callbacks.publicCompletionEnd!(oldId,event,'completed')).toBe(false);expect(host.session.snapshot().document!.hand).toEqual([]);expect(host.session.snapshot().connected).toBe(false);
 expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event)).toBe(true);expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(true);await vi.waitFor(()=>expect(host.table.inspect().frame?.outcomeLaneId).toBe('outcome'));expect(host.table.inspect().frame!.nodes.filter(node=>node.actionId).every(node=>node.enabled!==true)).toBe(true);expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});
test.each(['disconnect','revoke','environment','detach'] as const)('pending-readiness terminal ownership still rejects %s',async loss=>{
 const {before,restored}=restoredTerminalPipeline('peer'),host=mount(before);host.session.receive(restored,{connected:false});await vi.waitFor(()=>expect(host.table.inspect().frame?.publicCompletion).toBeDefined());const current=host.published.at(-1)!,event=current.publicCompletion!.event,ownership=host.session.snapshot().presentationOwnership;
 expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event)).toBe(true);
 if(loss==='disconnect')host.session.setConnected(false);
 else if(loss==='revoke')host.session.revoke();
 else if(loss==='environment')host.callbacks.environment({...environment,width:1279,revision:'changed'});
 else host.table.detach();
 expect(isPublicCompletionView(current.publicCompletion)).toBe(false);expect(host.callbacks.completionReady!(current.id,event)).toBe(false);expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(false);if(loss==='disconnect'||loss==='revoke')expect(isPresentationOwnership(ownership,host.session)).toBe(false);expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});

test('canonical room modal retires pending-readiness public completion before stale native receipts',async()=>{
 const {before,restored,client}=restoredTerminalPipeline('peer'),shell=projectRoomShell({roomCode:client.room.id,client:{room:client.room,status:'open',seat:0,viewerId:'alice'},document:before}),host=mount({...before,shell});
 host.session.receive({...restored,shell},{connected:false});await vi.waitFor(()=>expect(host.table.inspect().frame?.publicCompletion).toBeDefined());const current=host.published.at(-1)!,event=current.publicCompletion!.event,opener=current.nodes.find(node=>node.shellIntent?.kind==='open-page'&&node.shellIntent.page==='menu')!;expect(opener).toBeDefined();expect(completionFrameInputProof(current,host.session.snapshot().document!)).toBe(true);
 const contextual=current.nodes.filter(node=>node.shellIntent?.kind==='open-page'&&node.shellIntent.page==='people'||node.shellIntent?.kind==='request-effect'&&node.shellIntent.effect==='share-room');expect(contextual).toHaveLength(2);for(const node of contextual)expect(node.label).not.toBe(shell.header.actions.find(action=>action.id===node.shellActionId)!.label);
 for(const patch of [{shellActionId:'unknown'},{shellIntent:{kind:'command' as const,actionId:'next'}},{shellIntent:{kind:'open-form' as const,formId:'f'}},{actionId:'next'},{localIntent:'toggle-information' as const},{formActionId:'next'},{cardId:'private'},{label:''},{kind:'choice' as const}])expect(completionFrameInputProof({...current,nodes:current.nodes.map(node=>node.id===opener.id?{...node,...patch}:node)},host.session.snapshot().document!),JSON.stringify(patch)).toBe(false);
 expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event)).toBe(true);
 host.callbacks.intent({kind:'activate',provenance:'direct',frameId:current.id,nodeId:opener.id});expect(host.table.inspect().frame?.modalId).toBeDefined();expect(isPublicCompletionView(current.publicCompletion)).toBe(false);expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(false);expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});
test('cold restored public Done never manufactures a prior completion or dispatches continuation while blocked',()=>{
 const {restored}=restoredTerminalPipeline('observer'),host=mount(restored,false),current=host.published.at(-1)!;expect(current.publicCompletion).toBeUndefined();expect(current.outcomeLaneId).toBe('outcome');expect(current.nodes.filter(node=>node.actionId).every(node=>node.enabled!==true)).toBe(true);expect(host.session.snapshot().operations).toHaveLength(0);host.table.dispose();host.session.dispose();
});
test('actual Mighty local-winner final card retains only native receive allocation until exact Ready/End',async()=>{
 const {before,next}=pipeline('own',true),host=mount(before,true,true);
 try{
  await vi.waitFor(()=>expect(host.published.length).toBeGreaterThan(0));const outgoing=host.published.at(-1)!;host.session.receive(next,{connected:false});await vi.waitFor(()=>expect(host.published.at(-1)?.completionReceiveReservation).toBeDefined());const current=host.published.at(-1)!,event=current.publicCompletion!.event,dom=host.nativeDom!;
  expect(next.collections!.find(z=>z.purpose==='captured')?.collectedBy).toBe(next.participant.id);expect(current.publicCompletion!.recipe.localReceive?.participantId).toBe(next.participant.id);expect(current.nodes.some(n=>n.id==='hand'||n.id==='hand-fan'||n.cardId||n.entityId||n.id==='outcome')).toBe(false);expect(current.nodes.filter(n=>n.trickSlot)).toHaveLength(5);expect(planTrickResolution(outgoing,current)?.cards).toHaveLength(5);expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event)).toBe(false);const proof=completionReceiveNativeProof(current,dom.host,dom.elements,dom.content)!;expect(proof).not.toBeNull();expect(readyCompletionReceiveReservation(current)).toBeNull();expect(host.callbacks.completionReady!(current.id,event,proof)).toBe(true);expect(readyCompletionReceiveReservation(current)).toBe(current.completionReceiveReservation);expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(true);expect(readyCompletionReceiveReservation(current)).toBeNull();await vi.waitFor(()=>expect(host.published.at(-1)?.outcomeLaneId).toBe('outcome'));expect(host.published.at(-1)?.completionReceiveReservation).toBeUndefined();expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();vi.unstubAllGlobals();}
});
test('production local fourth→empty active four-card table→peer fifth retains a CURRENT local-winner receive region',async()=>{
 const f=pipeline('peer',true,true),v=f.beforeClient.game.view,play=v.phase;if(typeof play!=='object'||!('Play'in play))throw Error('Play fixture');const own=play.Play.plays.find(p=>p.seat===0)!.card,localView:View={...v,hand:[own],hand_sizes:v.hand_sizes.map((n,i)=>i===0?1:n),phase:{Play:{...play.Play,plays:play.Play.plays.slice(0,3)}}},localGame:StateMsg={...f.beforeClient.game,version:8,turn:{Seat:0},legal:[{Play:{card:own,joker_lead:null,call_joker:false}}],view:localView},localDoc=mightyConnectedGame.project({...f.beforeClient,game:localGame},0,true,f.before.context.generation)!,host=mount(localDoc,true,true);
 try{
  await vi.waitFor(()=>expect(host.published.at(-1)?.nodes.filter(n=>n.zoneId==='hand'&&n.entityId)).toHaveLength(1));host.session.receive(f.before);await vi.waitFor(()=>expect(host.published.at(-1)?.context.revision).toBe(f.before.context.revision));const empty=host.published.at(-1)!;expect(empty.nodes.find(n=>n.ownHandAnchor)?.ownHandAnchor?.count).toBe(0);expect(empty.nodes.filter(n=>n.zoneId==='trick'&&n.entityId)).toHaveLength(4);expect(empty.nodes.some(n=>n.id==='hand-fan')).toBe(false);expect(empty.nodes.some(n=>n.id==='hand-empty'||n.parent==='hand')).toBe(false);expect(empty.nodes.find(n=>n.id==='hand')!.box.height).toBeGreaterThanOrEqual(124);
  const index=new Map(empty.nodes.map(n=>[n.id,n]));const world=(id:string)=>{let n=index.get(id)!;const b={...n.box};while(n.parent){n=index.get(n.parent)!;b.x+=n.box.x;b.y+=n.box.y;}return b;};const geometry={dock:world('dock'),identity:world('identity'),hand:world('hand')};
  host.session.receive(f.next);await vi.waitFor(()=>expect(host.published.at(-1)?.publicCompletion).toBeDefined());const current=host.published.at(-1)!;expect(current.publicCompletion!.recipe.localReceive,JSON.stringify(geometry)).toBeDefined();expect(current.completionReceiveReservation).toBeDefined();expect(current.publicCompletion!.recipe.localReceive!.bounds.height).toBeGreaterThanOrEqual(geometry.hand.height);expect(empty.ownDockReceiveAllocation?.bounds.height).toBe(Math.max(geometry.identity.height,geometry.hand.height));expect(current.nodes.some(n=>n.id==='hand'||n.id==='hand-empty'||n.id==='hand-fan'||n.zoneId==='hand')).toBe(false);const dom=host.nativeDom!,event=current.publicCompletion!.event;expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event)).toBe(false);const proof=completionReceiveNativeProof(current,dom.host,dom.elements,dom.content)!;expect(proof).not.toBeNull();expect(host.callbacks.completionReady!(current.id,event,proof)).toBe(true);expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(true);expect(readyCompletionReceiveReservation(current)).toBeNull();await vi.waitFor(()=>expect(host.published.at(-1)?.outcomeLaneId).toBe('outcome'));expect(host.published.at(-1)?.ownDockReceiveAllocation).toBeUndefined();expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();vi.unstubAllGlobals();}
});
test('source22 four-card→arrival sparse-chrome regression preserves original parents and held public rail throughout completion',async()=>{
 const f=pipeline('peer',true,true),before={...f.before,shell:projectRoomShell({roomCode:f.beforeClient.room.id,client:{...f.beforeClient,status:'open'},document:f.before})},nextBase={...f.next,participant:{...f.next.participant,name:'현재'}},next={...nextBase,shell:projectRoomShell({roomCode:f.client.room.id,client:{...f.client,status:'open'},document:nextBase})},host=mount(before,true,true);
 try{
  await vi.waitFor(()=>expect(host.published.length).toBeGreaterThan(0));const old=host.published.at(-1)!,world=(frame:PresentationFrame,id:string)=>{let node=frame.nodes.find(n=>n.id===id)!;const b={...node.box};while(node.parent){node=frame.nodes.find(n=>n.id===node.parent)!;b.x+=node.box.x;b.y+=node.box.y;}return b;};for(const id of ['room-shell','table-body','active-table-content','table-sidebar','dock'])expect(old.nodes.find(n=>n.id===id)).toBeDefined();expect(old.nodes.filter(n=>n.zoneId==='trick'&&n.entityId)).toHaveLength(4);
  host.session.receive(next,{connected:false});await vi.waitFor(()=>expect(host.published.at(-1)?.publicCompletion).toBeDefined());const current=host.published.at(-1)!,event=current.publicCompletion!.event;for(const region of current.publicCompletion!.recipe.containers!){const node=current.nodes.find(n=>n.id===region.id)!;expect(node.parent,region.id).toBe(old.nodes.find(n=>n.id===region.id)!.parent);expect(world(current,node.id),node.id).toEqual(world(old,node.id));}
  expect(current.nodes.find(n=>n.id==='identity')?.parent).toBe('dock');expect(current.nodes.find(n=>n.id==='dock')?.decoration).toBe('tray');expect(current.nodes.find(n=>n.id==='identity-name')?.label).toBe('현재');const scoreId=JSON.stringify(['scoreboard',next.scoreboard!.id]);expect(current.nodes.find(n=>n.id===scoreId)).toBeDefined();for(const row of next.scoreboard!.rows){const id=JSON.stringify([scoreId,'row',row.participantId]);expect(current.nodes.some(n=>n.id.startsWith(id.slice(0,-1)))).toBe(true);}expect(current.nodes.some(n=>n.label==='상황판')).toBe(true);expect(current.nodes.some(n=>n.label==='판 종료')).toBe(false);expect(next.facts.some(fact=>fact.id==='result')).toBe(false);expect(current.nodes.some(n=>n.id==='outcome'||n.actionId||n.cardId||n.fieldId||n.localIntent||n.id==='hand'||n.id==='hand-fan')).toBe(false);expect(completionFrameInputProof(current,next)).toBe(true);
  const dom=host.nativeDom!,proof=completionReceiveNativeProof(current,dom.host,dom.elements,dom.content)!;expect(proof).not.toBeNull();expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event,proof)).toBe(true);expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(true);await vi.waitFor(()=>expect(host.published.at(-1)?.outcomeLaneId).toBe('outcome'));expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();vi.unstubAllGlobals();}
});
test('actual Mighty short header keeps held fields owner and suppresses transient summary until settlement',async()=>{
 const f=pipeline('peer'),env={...environment,width:1000,height:500},before={...f.before,shell:projectRoomShell({roomCode:f.beforeClient.room.id,client:{...f.beforeClient,status:'open'},document:f.before})},next={...f.next,shell:projectRoomShell({roomCode:f.client.room.id,client:{...f.client,status:'open'},document:f.next})},host=mount(before,true,false,env);
 try{
  await vi.waitFor(()=>expect(host.published.length).toBeGreaterThan(0));const old=host.published.at(-1)!,summary=before.information!.find(panel=>panel.id===before.statusPresentation!.informationId)!.summary!.text;host.session.receive(next);await vi.waitFor(()=>expect(host.published.at(-1)?.publicCompletion).toBeDefined());const current=host.published.at(-1)!,recipe=current.publicCompletion!.recipe;expect(recipe.headerStatus).toBe('fields');expect(recipe.statuses?.some(status=>status.section==='context')).toBe(true);expect(current.nodes.filter(n=>n.label==='판 종료')).toHaveLength(0);expect(current.nodes.some(n=>n.label===summary)).toBe(false);expect(current.nodes.find(n=>n.id==='room-shell')?.box).toEqual(old.nodes.find(n=>n.id==='room-shell')?.box);expect(current.nodes.find(n=>n.id==='table-active-status-fields')?.parent).toBe(old.nodes.find(n=>n.id==='table-active-status-fields')?.parent);expect(current.nodes.some(n=>n.id==='outcome'||n.cardId||n.actionId||n.fieldId||n.localIntent)).toBe(false);expect(completionFrameInputProof(current,next)).toBe(true);expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();}
});

function temporalPipeline(name='New Alice'){
 const f=pipeline('peer'),oldRoom={...f.beforeClient.room,scores:[-144,91,37,63,-47]},beforeBase=mightyConnectedGame.project({...f.beforeClient,room:oldRoom},1,true)!,before={...beforeBase,shell:projectRoomShell({roomCode:oldRoom.id,client:{...f.beforeClient,room:oldRoom,status:'open'},document:beforeBase})};
 const room={...f.client.room,scores:[-146,94,40,61,-49],watching:1,seats:f.client.room.seats.map((person,index)=>index===0&&person.kind!=='empty'?{...person,name}:person)},client={...f.client,room,viewerName:name},raw=mightyConnectedGame.project(client,2,true,before.context.generation)!,result=projectMightyOutcome({client,document:raw,roomScope:client.roomScope})!,nextBase={...raw,outcome:result.outcome,information:[...(raw.information??[]),result.information],collections:result.collections??raw.collections,reveals:result.reveals??raw.reveals},next={...nextBase,shell:projectRoomShell({roomCode:room.id,client:{...client,status:'open'},document:nextBase})};
 return {before,next};
}
test('actual producer pending and Ready hold public HUD values while canonical Done and current identity stay latest until End',async()=>{
 const {before,next}=temporalPipeline(),host=mount(before);
 const scoreLabels=(frame:PresentationFrame)=>before.scoreboard!.rows.flatMap(row=>before.scoreboard!.columns.map(col=>frame.nodes.find(n=>n.id===JSON.stringify([JSON.stringify([JSON.stringify(['scoreboard',before.scoreboard!.id]),'row',row.participantId]),col.id]))!.label));
 try{
  const old=host.published.at(-1)!,labels=scoreLabels(old);expect(next.scoreboard!.rows.map(row=>row.values)).not.toEqual(before.scoreboard!.rows.map(row=>row.values));host.session.receive(next,{connected:false});await vi.waitFor(()=>expect(host.published.at(-1)?.publicCompletion,JSON.stringify({state:host.table.inspect(),failures:host.failures})).toBeDefined());const current=host.published.at(-1)!,event=current.publicCompletion!.event;
  expect(host.session.snapshot().document!.scoreboard).toEqual(next.scoreboard);expect(host.session.snapshot().document!.outcome).toEqual(next.outcome);expect(current.nodes.find(n=>n.id==='identity-name')?.label).toBe('New Alice');expect(completionFrameInputProof(current,host.session.snapshot().document!)).toBe(true);expect(current.nodes.some(n=>n.actionId||n.cardId||n.fieldId||n.id==='outcome')).toBe(false);
  expect.soft(scoreLabels(current),'held source scores before collection').toEqual(labels);
  const progress=old.nodes.find(node=>node.kind==='progress')!;expect(progress).toBeDefined();expect(current.nodes.find(node=>node.id===progress.id)?.progressPaint).toEqual(progress.progressPaint);
  const summaryId=JSON.stringify([JSON.stringify(['information',before.information![0].id]),'summary']),summary=current.nodes.find(node=>node.id===summaryId)!;expect(summary.box).toEqual(old.nodes.find(node=>node.id===summaryId)!.box);expect(current.nodes.filter(node=>node.parent===summaryId)).toHaveLength(0);expect(current.nodes.some(node=>node.label===before.information![0].summary?.text)).toBe(false);
  expect(Object.hasOwn(current,'publicGameplayRead')).toBe(false);expect(current.paintResources).toEqual(publicPaintResources(next));
  const hud=next.information!.filter(panel=>panel.id!==next.outcome!.informationId);expect(hud).toHaveLength(1);expect.soft(current.nodes.some(n=>n.label===hud[0].summary?.text),'no premature Done phase').toBe(false);
  expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event)).toBe(true);expect.soft(scoreLabels(host.published.at(-1)!),'Ready is not settlement').toEqual(labels);
  expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(true);await vi.waitFor(()=>expect(host.published.at(-1)?.outcomeLaneId).toBe('outcome'));expect(scoreLabels(host.published.at(-1)!)).toEqual(next.scoreboard!.rows.flatMap(row=>row.values.map(String)));expect(host.published.at(-1)!.nodes.find(node=>node.id===progress.id)?.progressPaint).not.toEqual(progress.progressPaint);expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();}
});

test('current longer rename refuses outgoing completion geometry and renders latest safe static identity without claiming arrival',async()=>{
 const {before,next}=temporalPipeline('Current Alice'),host=mount(before);
 try{
  const outgoing=host.published.at(-1)!;expect(outgoing.nodes.find(node=>node.id==='identity')!.box.width).toBe(93);
  host.session.receive(next,{connected:false});await vi.waitFor(()=>expect(host.table.inspect().completionOutcome).toBe('unfulfilled'));const current=host.published.at(-1)!;
  expect(host.table.inspect().status).toBe('ready');expect(host.failures).toEqual([]);expect(host.published.some(value=>value.publicCompletion)).toBe(false);expect(current.publicCompletion).toBeUndefined();expect(current.outcomeLaneId).toBe('outcome');expect(current.nodes.find(node=>node.id==='identity-name')?.label).toBe('Current Alice');expect(current.context).toEqual(host.session.snapshot().document!.context);expect(host.session.snapshot().operations).toHaveLength(0);expect(host.table.inspect().completionOutcome).not.toBe('completed');
 }finally{host.table.dispose();host.session.dispose();}
});

function sceneSkeleton(frame:PresentationFrame,opponents:readonly {id:string}[]){
 const ids=['room-shell','table-sidebar','arena','dock',...opponents.map(person=>JSON.stringify([JSON.stringify(['opponent',person.id]),'identity']))];
 return ids.map(id=>{let node=frame.nodes.find(node=>node.id===id);expect(node,id).toBeDefined();const box={...node!.box};while(node!.parent){node=frame.nodes.find(parent=>parent.id===node!.parent)!;box.x+=node.box.x;box.y+=node.box.y;}return {id,box};});
}
test.each([800,900])('real public scene is history-independent across collection End, cold Done and resize at1280×%i',async height=>{
 const {before,next}=temporalPipeline(),env={...environment,height},host=mount(before,true,false,env),cold=mount(next,true,false,env);
 try{
  const old=host.published.at(-1)!,skeleton=sceneSkeleton(old,before.opponents!);for(const {id,box} of skeleton){expect(box.y,id).toBeGreaterThanOrEqual(0);expect(box.y+box.height,id).toBeLessThanOrEqual(height);}
  host.session.receive(next);await vi.waitFor(()=>expect(host.published.at(-1)?.publicCompletion).toBeDefined());const pending=host.published.at(-1)!,event=pending.publicCompletion!.event;
  expect(sceneSkeleton(pending,before.opponents!)).toEqual(skeleton);expect(host.callbacks.completionFence!(pending.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(pending.id,event)).toBe(true);expect(sceneSkeleton(host.published.at(-1)!,before.opponents!)).toEqual(skeleton);
  expect(host.callbacks.publicCompletionEnd!(pending.id,event,'completed')).toBe(true);await vi.waitFor(()=>expect(host.published.at(-1)?.outcomeLaneId).toBe('outcome'));
  expect(sceneSkeleton(host.published.at(-1)!,before.opponents!)).toEqual(skeleton);expect(sceneSkeleton(cold.published.at(-1)!,before.opponents!)).toEqual(skeleton);
  const resized={...env,height:height+40,revision:'resized'},fresh=mount(next,true,false,resized);try{host.callbacks.environment(resized);await vi.waitFor(()=>expect(host.table.inspect().frame?.environment.height).toBe(resized.height));expect(sceneSkeleton(host.published.at(-1)!,before.opponents!)).toEqual(sceneSkeleton(fresh.published.at(-1)!,before.opponents!));}finally{fresh.table.dispose();fresh.session.dispose();}
  expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();cold.table.dispose();cold.session.dispose();}
});

test('native activation at1280×720 keeps every critical allocation physical through terminal settlement',async()=>{
 const f=pipeline('peer',true,true),interaction={cardActivation:'repeat' as const},beforeBase={...f.before,interaction},nextBase={...f.next,interaction},before={...beforeBase,shell:projectRoomShell({roomCode:f.beforeClient.room.id,client:{...f.beforeClient,status:'open'},document:beforeBase})},next={...nextBase,shell:projectRoomShell({roomCode:f.client.room.id,client:{...f.client,status:'open'},document:nextBase})},env={...environment,height:720,scrollbarWidth:15,scrollbarHeight:15},host=mount(before,true,true,env),cold=mount(next,true,false,env);
 try{
  const old=host.published.at(-1)!,skeleton=sceneSkeleton(old,before.opponents!);for(const {id,box} of skeleton){expect(box.y,id).toBeGreaterThanOrEqual(0);expect(box.y+box.height,id).toBeLessThanOrEqual(env.height);}
  const dockBounds=skeleton.find(region=>region.id==='dock')!.box,dockDelta=env.height-dockBounds.y-dockBounds.height+.01;expect(captureRetainedPublicTableRecipe({...old,nodes:old.nodes.map(node=>node.id==='dock'?{...node,box:{...node.box,y:node.box.y+dockDelta}}:node)},'trick')).toBeNull();
  expect(old.nodes.filter(n=>n.zoneId==='trick'&&n.entityId)).toHaveLength(4);expect(old.nodes.find(n=>n.id==='decisions')).toBeUndefined();expect(old.ownDockReceiveAllocation,JSON.stringify(old.nodes.filter(n=>['dock','hand','identity','own-hand-count-anchor'].includes(n.id)))).toBeDefined();
  host.session.receive(next);await vi.waitFor(()=>expect(host.published.at(-1)?.publicCompletion).toBeDefined());const current=host.published.at(-1)!,event=current.publicCompletion!.event,dom=host.nativeDom!;expect(current.nodes.filter(n=>n.trickSlot)).toHaveLength(5);expect(sceneSkeleton(current,before.opponents!)).toEqual(skeleton);expect(planTrickResolution(old,current)?.cards).toHaveLength(5);expect(current.publicCompletion!.recipe.localReceive).toBeDefined();expect(current.completionReceiveReservation).toBeDefined();const proof=completionReceiveNativeProof(current,dom.host,dom.elements,dom.content)!;expect(proof).not.toBeNull();expect(host.callbacks.completionFence!(current.id,event,true)).toBe(true);expect(host.callbacks.completionReady!(current.id,event,proof)).toBe(true);expect(host.callbacks.publicCompletionEnd!(current.id,event,'completed')).toBe(true);await vi.waitFor(()=>expect(host.published.at(-1)?.outcomeLaneId).toBe('outcome'));expect(sceneSkeleton(host.published.at(-1)!,before.opponents!)).toEqual(skeleton);expect(sceneSkeleton(cold.published.at(-1)!,before.opponents!)).toEqual(skeleton);const resized={...env,height:800,revision:'native-resized'},fresh=mount(next,true,false,resized);try{host.callbacks.environment(resized);await vi.waitFor(()=>expect(host.published.at(-1)?.environment.height).toBe(resized.height));expect(sceneSkeleton(host.published.at(-1)!,before.opponents!)).toEqual(sceneSkeleton(fresh.published.at(-1)!,before.opponents!));}finally{fresh.table.dispose();fresh.session.dispose();}expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();cold.table.dispose();cold.session.dispose();vi.unstubAllGlobals();}
});

test('actual Done→next deal keeps the regular public scene while canonical hand and resources renew',async()=>{
 const {done,bidding}=freshDealPipeline(),host=mount(done);
 try{
  const previous=host.published.at(-1)!,ids=['table-sidebar','arena','dock',...done.opponents!.map(person=>JSON.stringify([JSON.stringify(['opponent',person.id]),'identity']))];
  const boxes=(frame:PresentationFrame)=>ids.map(id=>{let node=frame.nodes.find(node=>node.id===id)!;expect(node,id).toBeDefined();const box={...node.box};while(node.parent){node=frame.nodes.find(parent=>parent.id===node.parent)!;box.x+=node.box.x;box.y+=node.box.y;}return {id,box};});
  const old=boxes(previous);host.session.receive(bidding);await vi.waitFor(()=>expect(host.table.inspect().frame?.context?.generation).toBe(bidding.context.generation));const next=host.published.at(-1)!;
  expect(boxes(next)).toEqual(old);expect(next.nodes.filter(node=>node.kind==='card'&&node.zoneId==='hand')).toHaveLength(10);expect(next.paintResources).toEqual(publicPaintResources(bidding));expect(host.session.snapshot().operations).toHaveLength(0);
 }finally{host.table.dispose();host.session.dispose();}
});


test('actual settled scene gives Next a separate closed essential owner without arena or dock ancestry',()=>{
 const {next}=pipeline('peer'),host=mount(next);try{const frame=host.published.at(-1)!,mask=essentialInputMask(frame);expect(mask?.kind).toBe('lane');expect(mask?.laneId).toBe('outcome');for(const actionId of next.outcome!.continuationActionIds){const command=frame.nodes.find(node=>node.actionId===actionId)!;expect(command).toBeDefined();expect(mask?.inputIds).toContain(command.id);let node=command;while(node.parent){expect(['arena','dock','identity']).not.toContain(node.parent);node=frame.nodes.find(parent=>parent.id===node.parent)!;}}expect(host.session.snapshot().operations).toHaveLength(0);}finally{host.table.dispose();host.session.dispose();}
});
