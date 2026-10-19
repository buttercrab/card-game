<script lang="ts" generics="G extends GameTypes, A">
  import {selectCurrentRoom,freezePublication,type CurrentRoomViewOf} from '../../room/currentRoom';
  import type {StateMsgOf} from '../../room/types';
  import {DELIVERY_NOTICES} from '../../room/delivery';
  import {capacityAllows,CAPACITY_NOTICE} from '../../room/capacity';
  import {createPublicHistoryCapture} from './publicHistoryCapture';
  import {guardDisclosurePublication} from './disclosurePublication';
  import {nativeDisclosureReadCurrent,nativeDisclosureRetainedCurrent,type NativeDisclosureState} from './disclosureNative';
  import type {ConnectedDisclosureOwner} from './connectedDisclosures';
  import type {DisclosureContext,DisclosureSelectionReceipt,DisclosureRefresh} from './disclosures';
  import {settings} from '../../settings.svelte';
  import {sameAssistanceScope,type AssistanceOperation,type AssistanceAuthority} from './assistance';
  import {createBrowserFeedbackSink} from './feedbackSink';
  import type {FeedbackProjection} from './feedback';
  import {createHostFormContinuations} from './hostFormContinuations';
  import {TABLE_FORM_POLICY} from './tableForms';
  import {copyFormData,type FormStatus,type FormSubmission} from './forms';
  import type {ConnectedFormProjection} from './connected';
  import {NAME_POLICY} from './nameForms';
  import {REPORT_POLICY,sendReport} from './reportForms';
  import {onMount,untrack} from 'svelte';
  import {CATALOG} from '../../catalog';
  import {RoomClient} from '../../room/client.svelte';
  import type {GameTypes,RoomActionOf} from '../../room/types';
  import type {ConnectedGameAdapter,ConnectedCompletionOwner,ConnectedCompletionView} from './connected';
  import {createConnectedCommandClient,submitConnectedOnce} from './connected';
  import {connectedDocument,publicConnectedDocument,withConnectedDisclosures,HOST_LEAVE_ACTION,type HostCommand} from './connectedDocument';
  import type {RoomShellNotice} from './roomShell';
  import {acceptPreferenceValue,type PreferenceChange} from './roomShell';
  import {projectLocalPreferences,applyLocalPreference,localCardActivation,localTextScale} from './localPreferences';
  import type {ViewContext} from './contracts';
  import {sameContext,sameScope} from './session';
  import {createCardSession,createCardTable} from './index';
  import {createDomSurface} from './domSurface';
  let {adapter:givenAdapter,id:givenId=location.pathname.split('/')[2]}:{adapter:ConnectedGameAdapter<G,A>;id?:string}=$props();
  const adapter=untrack(()=>givenAdapter),id=untrack(()=>givenId);
  const client=new RoomClient<G>(id,{feedback:'external'});
  type Command=HostCommand<A,G['settings']>;
  let host:HTMLDivElement;
  let mounted=$state(false),graceReady=$state(true),journalFull=$state(false),hostNotice=$state<RoomShellNotice|null>(null),revision=0;
  let table:ReturnType<typeof createCardTable<Command>>;
  let domSurface:ReturnType<typeof createDomSurface>|null=null;
  // A device preference changes the shared environment, never game geometry.
  $effect(()=>{const scale=localTextScale();if(mounted)domSurface?.setTextScale(scale);});
  let staleRoom:typeof client.room=null,staleGame:typeof client.game=null,needsFresh=true;
  let lastSignature='',lastPublicSignature='',lastActor='',publishedActor='',navigating=false;
  let actorBaseline:typeof client.game=null;
  let pendingLeave:{id:string;actor:string;room:string}|null=null;
  const pendingRoomCommands=new Map<string,{actor:string;room:string;label:string}>();
  let roomCapture:{source:typeof client.room;value:CurrentRoomViewOf<G>|null}|null=null;
  let stateCapture:{source:typeof client.game;value:typeof client.game}|null=null;
  // Native Room/State packets replace their objects; keep only the latest owned
  // current snapshot. Archives never enter presentation or command snapshots.
  function ownedRoom(room:NonNullable<typeof client.room>):CurrentRoomViewOf<G>;
  function ownedRoom(room?:typeof client.room):CurrentRoomViewOf<G>|null;
  function ownedRoom(room=client.room):CurrentRoomViewOf<G>|null {
    if(roomCapture?.source!==room)roomCapture={source:room,value:freezePublication($state.snapshot(selectCurrentRoom(room))) as CurrentRoomViewOf<G>|null};
    return roomCapture!.value;
  }
  function ownedState(state=client.game):typeof client.game {
    if(stateCapture?.source!==state)stateCapture={source:state,value:freezePublication($state.snapshot(state))};
    return stateCapture!.value;
  }
  const sourceTokens=new WeakMap<object,number>();let sourceSequence=0;
  function sourceToken(value:object|null):number {if(!value)return 0;let token=sourceTokens.get(value);if(token===undefined){token=++sourceSequence;sourceTokens.set(value,token);}return token;}
  const commandView=()=>createConnectedCommandClient<G>({status:client.status,room:ownedRoom(),game:ownedState(),seat:client.seat,viewerId:client.viewerId,viewerName:client.viewerName});
  const hostContinuations=createHostFormContinuations();
  let disclosureOwner:ConnectedDisclosureOwner<G>|null=null;
  try{disclosureOwner=adapter.createDisclosureOwner?.()??null;}catch{/* Optional readers cannot break gameplay. */}
  const publicHistoryCapture=createPublicHistoryCapture();
  let disclosurePublication:{nativeSource:object;room:typeof client.room;state:typeof client.game;window:typeof client.roomCommandWindow;connection:string;actor:string;seat:number|null;context:DisclosureContext}|null=null;
  function retireDisclosures(){disclosurePublication=null;publicHistoryCapture.clear();try{disclosureOwner?.revoke();}catch{}}
  let selectionPublicationQueued=false,latestSelection:DisclosureSelectionReceipt|null=null;
  function queueDisclosurePublication(){
    if(selectionPublicationQueued)return;selectionPublicationQueued=true;
    queueMicrotask(()=>{
      selectionPublicationQueued=false;
      if(!mounted||navigating||client.status!=='open')return;
      const selected=session.disclosures.snapshot().selection;
      if(selected?.id!==latestSelection?.id||selected&&(!disclosurePublication||!nativeDisclosureReadCurrent(disclosurePublication.context,nativeDisclosureState())))return;
      lastSignature='';lastPublicSignature='';publishConnected();
    });
  }
  function disclosureSelectionChanged(selection:DisclosureSelectionReceipt|null){
    latestSelection=selection;
    try{disclosureOwner?.selectionChanged?.(selection);}catch{retireDisclosures();return;}
    queueDisclosurePublication();
  }
  function nativeDisclosureState():NativeDisclosureState{
    const publication=disclosurePublication,window=client.roomCommandWindow;
    return {open:mounted&&!navigating&&client.status==='open'&&client.room?.game===adapter.id,readable:client.publicationReady||client.roomPublicationReady,
      sourceCurrent:!!publication&&publication.nativeSource===client.publicSessionSource&&publication.room===client.room&&publication.state===client.game&&publication.window===window&&publication.connection===client.ephemeralConnectionEpoch,
      roomId:client.room?.id??null,roomEpoch:window?.scope.room_epoch??null,actorId:client.viewerId,connectionEpoch:client.ephemeralConnectionEpoch,seat:client.seat,
      published:publication?{actorId:publication.actor,seat:publication.seat,audience:publication.context.audience}:null};
  }
  function revokePrivateView(){
    const prior=disclosurePublication,window=client.roomCommandWindow;
    const sameNativeReader=!!prior&&mounted&&!navigating&&client.status==='open'&&client.room?.game===adapter.id&&prior.actor===client.viewerId&&prior.connection===client.ephemeralConnectionEpoch&&prior.context.roomId===client.room.id&&prior.context.roomEpoch===window?.scope.room_epoch&&window.scope.actor_id===client.viewerId&&window.scope.room_id===client.room.id;
    // Retention concerns only an already-owned public read island. The session
    // always redacts the private scene, forms and command payloads first.
    if(sameNativeReader)session.revokeGameView();else session.revoke();
  }
  function disclose(document:ReturnType<typeof connectedDocument<G,A>>):ReturnType<typeof connectedDocument<G,A>>|null{
    const owner=disclosureOwner,nativeSource=client.publicSessionSource,room=client.room,state=client.game,window=client.roomCommandWindow,actor=client.viewerId,seat=client.seat,connection=client.ephemeralConnectionEpoch;
    if(!owner||!nativeSource||!mounted||navigating||client.status!=='open'||!room||room.game!==adapter.id||!window||!actor||window.scope.actor_id!==actor||window.scope.seat!==seat||window.scope.room_id!==room.id||window.scope.session_id!==room.session_id||!client.publicationReady&&!client.roomPublicationReady){disclosurePublication=null;return document;}
    const context:DisclosureContext={roomId:room.id,roomEpoch:window.scope.room_epoch,actorId:actor,connectionEpoch:connection,audience:document.context.audience};
    const current=()=>nativeSource===client.publicSessionSource&&room===client.room&&state===client.game&&window===client.roomCommandWindow&&actor===client.viewerId&&seat===client.seat&&connection===client.ephemeralConnectionEpoch&&mounted&&!navigating&&client.status==='open';
    return guardDisclosurePublication({current,revoke(){retireDisclosures();session.revoke();lastSignature='';},unavailable(){retireDisclosures();return document;},project(){
      const history=publicHistoryCapture.capture({nativeSource,roomId:room.id,roomEpoch:window.scope.room_epoch,sessionId:window.scope.session_id,handsPlayed:room.hands_played,records:room.records,archives:room.archives,history:room.history,hands:room.hands});
      const projection=owner.project({client:{room:ownedRoom(room),seat,viewerId:actor,viewerName:client.viewerName},roomScope:$state.snapshot(window.scope),context:document.context,sourceRevision:history.revision,connectionEpoch:connection,publicHistory:history.history});
      const result=withConnectedDisclosures(document,projection,context);
      disclosurePublication={nativeSource,room,state,window,connection,actor,seat,context};return result;
    }});
  }
  let completionOwner:ConnectedCompletionOwner<G>|null=null;
  try{completionOwner=adapter.createCompletionOwner?.()??null;}catch{/* Optional device bookkeeping cannot break the table. */}
  let completionSnapshot:{lifetime:string;sessionSource:object|null;hand:number;sessionId:number;view:ConnectedCompletionView}|null=null;
  let completionLifetime='',completionDisposed=false,completionNotice:RoomShellNotice|null=null,completionNoticeSequence=0,lastCompletionNotice='';
  function retireCompletion(){if(completionLifetime){completionLifetime='';try{completionOwner?.revoke();}catch{}}completionNotice=null;lastCompletionNotice='';completionSnapshot=null;}
  function disposeCompletion(){if(completionDisposed)return;completionDisposed=true;retireCompletion();try{completionOwner?.dispose();}catch{}completionOwner=null;}
  function observeCompletion():ConnectedCompletionView|null{
    const room=client.room,window=client.roomCommandWindow,actor=client.viewerId;
    const lifetime=mounted&&!navigating&&client.status==='open'&&room&&room.game===adapter.id&&window&&actor&&window.scope.actor_id===actor&&window.scope.seat===client.seat&&window.scope.room_id===room.id?
      JSON.stringify([client.ephemeralConnectionEpoch,window.scope.room_epoch,room.id,actor,client.seat]):'';
    if(lifetime!==completionLifetime){retireCompletion();completionLifetime=lifetime;}
    if(!lifetime||!completionOwner||!room||!window||!actor)return null;
    if(!room.showing||room.in_hand)completionNotice=null;
    // Presence/readiness can advance Room without changing the public Session.
    // A coherent live State may retain an already confirmed same-hand view;
    // it must never start a new write from an older public checkpoint.
    if(!client.roomPublicationReady)return client.publicationReady&&!room.in_hand&&room.showing&&room.current_hand&&completionSnapshot?.lifetime===lifetime&&
      completionSnapshot.sessionSource===client.publicSessionSource&&completionSnapshot.hand===window.scope.hand&&completionSnapshot.sessionId===window.scope.session_id?completionSnapshot.view:null;
    const capturedConnection=client.ephemeralConnectionEpoch,capturedSeat=client.seat,capturedScope=JSON.stringify(window.scope);
    const current=()=>mounted&&!navigating&&!completionDisposed&&completionLifetime===lifetime&&client.status==='open'&&client.roomPublicationReady&&
      client.ephemeralConnectionEpoch===capturedConnection&&client.viewerId===actor&&client.seat===capturedSeat&&client.room===room&&
      !!client.roomCommandWindow&&JSON.stringify(client.roomCommandWindow.scope)===capturedScope;
    try{
      if(!current())return null;
      const result=copyFormData(completionOwner.observe({room:ownedRoom(room),roomScope:$state.snapshot(window.scope),actorId:actor,seat:capturedSeat,keepsRecord:client.keepsRecord,at:Date.now()},current));
      if(!current()||!result)return null;
      if(Object.keys(result).some(key=>!['id','status','earnedTitles','message'].includes(key))||typeof result.id!=='string'||!result.id||result.id.length>2048||!['stored','duplicate','failed','unsupported','conflict','uncertain'].includes(result.status)||!Array.isArray(result.earnedTitles)||result.earnedTitles.length>12||result.earnedTitles.some(title=>typeof title!=='string'||!title.trim()||title.length>100)||result.message!==undefined&&(typeof result.message!=='string'||result.message.length>500)||result.status!=='stored'&&result.earnedTitles.length)throw Error('Invalid completion acknowledgment');
      const noticeKey=JSON.stringify([result.id,result.status,result.message??'']);
      if(result.message&&noticeKey!==lastCompletionNotice){lastCompletionNotice=noticeKey;completionNotice={id:`completion:${++completionNoticeSequence}`,text:result.message,tone:'danger'};}
      if(result.status==='stored'||result.status==='duplicate')completionNotice=null;
      completionSnapshot={lifetime,sessionSource:client.publicSessionSource,hand:window.scope.hand,sessionId:window.scope.session_id,view:result};
      return result;
    }catch{return null;}
  }
  let feedbackCapture:{key:string;stateKey:string;state:StateMsgOf<G>|null;participantIds:readonly (string|null)[];roomScope:NonNullable<import('./connected').ConnectedProjectionClient<G>['roomScope']>;projection:FeedbackProjection|null}|null=null;
  function invokeAssistance(operation:AssistanceOperation):boolean {
    const current=session.snapshot(),doc=current.document,snapshot=doc?.assistance,state=client.game,room=client.room,window=client.roomCommandWindow;
    if(!mounted||navigating||!current.connected||!doc||!snapshot||!room||!window||client.status!=='open'||!client.publicationReady||!client.viewerId)return false;
    const ownHandAuthorized=room.showing&&client.seat!==null&&!!state&&adapter.viewerMatches(state,client.seat);
    const authority:AssistanceAuthority={scope:{context:doc.context,roomId:room.id,roomEpoch:window.scope.room_epoch,connectionEpoch:client.ephemeralConnectionEpoch,actorId:client.viewerId,seat:client.seat,gameVersion:state&&room.showing?state.version:null},connected:true,ownHandAuthorized,activeTurn:ownHandAuthorized&&room.in_hand&&graceReady&&typeof state!.turn==='object'&&state!.turn.Seat===client.seat};
    if(!sameAssistanceScope(operation.scope,authority.scope))return false;
    if(operation.kind==='request-advice'){if(!authority.activeTurn||!snapshot.projection.tools.some(tool=>tool.kind==='request-advice'&&tool.enabled))return false;client.askHint();return true;}
    const tool=snapshot.projection.tools.find(tool=>tool.kind==='send-reaction'&&tool.enabled);if(tool?.kind!=='send-reaction'||!tool.options.some(option=>option.id===operation.optionId&&option.text===operation.text))return false;client.react(operation.text);return true;
  }
  let localAuthorityEpoch=0,localAuthorities:Record<string,Record<string,unknown>>={};
  function retireLocalAuthorities(){localAuthorityEpoch++;localAuthorities={};hostContinuations.clear();localFormCapture=null;}
  let localFormCapture:{key:string;value:unknown}|null=null;
  function gameForms():ConnectedFormProjection<G,A>|undefined{
    const room=client.room,scope=client.roomCommandWindow?.scope,viewerId=client.viewerId;
    if(!adapter.projectForms||client.status!=='open'||!client.publicationReady||!room||!scope||!viewerId)return;
    const key=JSON.stringify([viewerId,client.seat]);
    try{
      if(localFormCapture?.key!==key)localFormCapture={key,value:copyFormData(adapter.readLocalFormState?.()??null)};
      return adapter.projectForms({room:ownedRoom(room),scope:$state.snapshot(scope),viewerId,seat:client.seat,localState:localFormCapture.value,localAuthorities:copyFormData(localAuthorities)});
    }catch{return {offers:[],settingsActions:[],diagnostics:[{id:'game-forms',text:'이 기기의 규칙 목록을 읽지 못해 편집기를 열 수 없어요. 테이블은 계속 이용할 수 있어요.',tone:'danger'}]};}
  }
  function runLocalForm(submission:FormSubmission){
    const handler=adapter.hostFormOperations?.find(operation=>operation.id===submission.operationId);
    if(!handler||!submission.operationId){session.resolveForm(submission.id,'rejected');return;}
    const epoch=localAuthorityEpoch;let continuationOpen=true;
    const currentOwner=()=>{
      const current=session.snapshot(),form=current.document?.forms?.find(form=>form.id===submission.formId&&form.instanceId===submission.offerInstanceId&&form.policyId===submission.policyId);
      const action=form?.actions?.find(action=>action.id===submission.actionId);
      const selection=submission.access?.kind==='disclosure-selection'?session.disclosures.snapshot().selection:null;
      const admission=submission.access?.kind==='disclosure-selection'?!!selection&&selection.id===submission.access.selectionId&&!!disclosurePublication&&nativeDisclosureReadCurrent(disclosurePublication.context,nativeDisclosureState()):client.publicationReady&&current.connected;
      return session.isCurrentFormSubmission(submission)&&mounted&&!navigating&&epoch===localAuthorityEpoch&&client.status==='open'&&admission&&
        current.document?.context.session===submission.context.session&&current.document.context.audience===submission.context.audience&&
        client.viewerId===submission.binding.actorId&&client.seat===submission.binding.seat&&client.room?.id===submission.binding.roomId&&
        form?.enabled===true&&action?.target.kind==='host'&&action.target.operationId===submission.operationId;
    };
    // Continuation evidence belongs only to this admitted fixed host operation.
    // It never replaces the captured draft model or renews a room command.
    try{void Promise.resolve(handler.submit(copyFormData(submission),{isCurrent:()=>continuationOpen&&currentOwner(),resolve:token=>continuationOpen&&currentOwner()&&session.snapshot().formOperations?.some(operation=>operation.id===submission.id&&operation.status==='sending')?(submission.access?.kind==='disclosure-selection'?disclosureOwner?.resolveFormAuthority?.(submission.access.selectionId,token)??null:hostContinuations.resolve(submission,token)):null})).then(raw=>{
      continuationOpen=false;const result=copyFormData(raw),operation=session.snapshot().formOperations?.find(operation=>operation.id===submission.id&&operation.instanceId===submission.instanceId&&operation.actionId===submission.actionId);
      const eligible=operation?.status==='sending'&&currentOwner();
      let refresh:DisclosureRefresh|null=null;
      if(eligible&&result.status==='stored'&&submission.access?.kind==='disclosure-selection'){try{refresh=disclosureOwner?.operationCommitted?.(copyFormData(submission))??null;}catch{/* A stored write must not be retried if refresh fails. */}}
      if(!session.resolveForm(submission.id,result.status,result.message,refresh??undefined)||!eligible||!currentOwner()||result.status!=='stored')return;
      if(refresh){queueDisclosurePublication();return;}
      if(result.authority===undefined||!submission.formId||!submission.actionId)return;
      localAuthorities={...localAuthorities,[submission.formId]:{...localAuthorities[submission.formId],[submission.actionId]:hostContinuations.issue(submission,result.authority.data,result.authority.metadata)}};
      lastSignature='';publishConnected();
    }).catch(()=>{continuationOpen=false;session.resolveForm(submission.id,'failed');});}
    catch{continuationOpen=false;session.resolveForm(submission.id,'failed');}
  }
  const reportRequests=new Set<AbortController>();
  const session=createCardSession<Command>({disclosurePolicies:disclosureOwner?.policies??[],disclosureSelectionChanged,disclosureCurrent:context=>nativeDisclosureReadCurrent(context,nativeDisclosureState()),disclosureRetainedCurrent:scope=>nativeDisclosureRetainedCurrent(scope,nativeDisclosureState()),formPolicies:[REPORT_POLICY,NAME_POLICY,TABLE_FORM_POLICY,...(adapter.formPolicies??[])],formTransport(submission){
    const current=session.snapshot().document;
    if(!mounted||navigating||!current||current.context.session!==submission.context.session||current.context.audience!==submission.context.audience||client.viewerId!==submission.binding.actorId||client.room?.id!==submission.binding.roomId||client.seat!==submission.binding.seat){session.resolveForm(submission.id,'rejected');return;}
    if(submission.operationId){runLocalForm(submission);return;}
    if(submission.policyId!==REPORT_POLICY.id){session.resolveForm(submission.id,'rejected');return;}
    const controller=new AbortController();reportRequests.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
    void sendReport(submission,(url,init)=>fetch(url,{...init,signal:controller.signal}),{ua:navigator.userAgent,screen:`${innerWidth}x${innerHeight}@${devicePixelRatio}`,path:location.pathname,standalone:matchMedia('(display-mode: standalone)').matches}).then(status=>session.resolveForm(submission.id,status)).finally(()=>{clearTimeout(timer);reportRequests.delete(controller);});
  },batchTransport(submission){
    const current=session.snapshot().document,commandClient=commandView(),window=client.game?.command;
    if(!mounted||navigating||!current||!sameContext(current.context,submission.context)||client.status!=='open'||!client.publicationReady||!adapter.prepareBatch||submission.actions.some(command=>command.kind!=='adapter')){session.resolve(submission.id,'rejected');return;}
    let actions:readonly G['action'][]|null=null;
    try{actions=adapter.prepareBatch(commandClient,submission.actions.map(command=>{if(command.kind!=='adapter')throw Error('Mixed batch authority');return command.candidate;}));}catch{/* Translation cannot establish native admission. */}
    const accepted=!!actions&&actions.length===submission.actions.length&&!!window&&client.game?.command===window&&session.snapshot().document===current&&client.status==='open'&&client.publicationReady&&client.commands.submitBatch(submission.id,window.scope,actions);
    if(!accepted)session.resolve(submission.id,'rejected');
  },transport(submission){
    const commandClient=commandView(),command=submission.action;
    const accepted=submitConnectedOnce((submitGame,submitRoom)=>{
      if(command.kind==='adapter')return adapter.submit(commandClient,command.candidate,submitGame,submitRoom);
      const current=session.snapshot().document;
      if(client.status!=='open'||!client.publicationReady||!current||!sameScope(current.context,submission.context)||
        command.expected.room_id!==id||command.expected.actor_id!==client.viewerId||command.expected.seat!==client.seat)return false;
      return submitRoom(command.action);
    },(action:G['action'])=>{
      const window=client.game?.command;
      return !!window&&client.commands.submit(submission.id,window.scope,action);
    },(action:RoomActionOf<G['settings']>)=>{
      const window=client.roomCommandWindow;
      const sent=!!window&&client.commands.submitRoom(submission.id,command.kind==='room'?command.expected:window.scope,action,command.kind==='room'&&submission.formInstanceId&&(action.type==='join'||action.type==='rename')?'adopt-name':undefined);
      if(sent&&command.kind==='room'&&client.viewerId)pendingRoomCommands.set(submission.id,{actor:client.viewerId,room:id,label:session.snapshot().document?.offer.actions.find(binding=>binding.id===submission.actionId)?.label??session.snapshot().document?.forms?.find(form=>form.target?.kind==='command'&&form.target.actionId===submission.actionId)?.submitLabel??'요청'});
      if(sent&&command.kind==='room'&&action.type==='leave'&&submission.actionId===HOST_LEAVE_ACTION&&client.viewerId)pendingLeave={id:submission.id,actor:client.viewerId,room:id};
      return sent;
    });
    if(!accepted){
      session.resolve(submission.id,'rejected');
      if(command.kind==='room'&&command.action.type==='leave'&&submission.actionId===HOST_LEAVE_ACTION)hostNotice={id:'leave',text:'현재 테이블 상태에서 나가기 요청을 보내지 못했어요. 다시 확인해주세요.',tone:'danger'};
    }
  }});
  function navigateHome(){
    if(navigating)return;navigating=true;
    disposeCompletion();roomCapture=null;stateCapture=null;client.close();table.dispose();session.dispose();
    location.replace('/');
  }
  function invokeEffect(effect:'share-room'|'leave-room',context:ViewContext){
    const current=session.snapshot().document;
    if(!mounted||navigating||!current||!sameContext(current.context,context)||publishedActor!==JSON.stringify([client.viewerId,client.seat]))return;
    if(effect==='leave-room'){
      if(client.seat===null){client.forgetSeatCredential();navigateHome();}
      return;
    }
    if(client.room?.id!==id)return;
    const url=new URL(location.href);url.searchParams.set('foundation','1');
    // Invoke privileged browser APIs synchronously while native user activation remains.
    if(navigator.share&&matchMedia('(pointer: coarse)').matches){
      void navigator.share({title:adapter.tableLabel,text:`테이블 ${id}`,url:url.href}).then(()=>{
        if(mounted&&session.snapshot().document&&sameContext(session.snapshot().document!.context,context))hostNotice={id:'invite',text:'보냈어요',tone:'plain'};
      }).catch(()=>{});
    }else if(navigator.clipboard){
      void navigator.clipboard.writeText(url.href).then(()=>{
        if(mounted&&session.snapshot().document&&sameContext(session.snapshot().document!.context,context))hostNotice={id:'invite',text:'복사했어요',tone:'plain'};
      }).catch(()=>{const latest=session.snapshot().document;if(mounted&&latest&&sameContext(latest.context,context))hostNotice={id:'invite',text:'링크를 복사하지 못했어요.',tone:'danger'};});
    }else hostNotice={id:'invite',text:'이 브라우저에서는 링크를 복사할 수 없어요.',tone:'danger'};
  }
  function changePreference(change:PreferenceChange,context:ViewContext){
    const current=session.snapshot().document;
    if(!mounted||navigating||!current||!sameContext(current.context,context)||publishedActor!==JSON.stringify([client.viewerId,client.seat]))return;
    const field=current.shell?.pages.find(page=>page.id==='settings')?.preferences?.find(field=>field.id===change.fieldId);
    if(field&&acceptPreferenceValue(field,change.value))applyLocalPreference(change);
  }
  function metadata(notice:RoomShellNotice|null=null,publicOnly=false){return {roomCode:id,client:publicOnly?createConnectedCommandClient<G>({status:client.status,room:ownedRoom(),game:null,seat:client.seat,viewerId:client.viewerId,viewerName:client.viewerName}):commandView(),roomWindow:publicOnly?null:$state.snapshot(client.roomCommandWindow),
    recovery:$state.snapshot(client.commandRecovery),preferences:projectLocalPreferences(),botLevels:CATALOG.bot_levels,journalFull,reportMax:CATALOG.report_max,nameMax:CATALOG.name_max,...(!publicOnly?{gameForms:gameForms()}:{}),notice:notice??completionNotice??(client.deliveryIssue?{id:`delivery:${client.deliveryIssue}`,text:DELIVERY_NOTICES[client.deliveryIssue],tone:'danger' as const}:null)??hostNotice??(!capacityAllows(client.room,'can_start')||!capacityAllows(client.room,'can_archive')||client.room?.in_hand&&!capacityAllows(client.room,'can_play')?{id:'room-capacity',text:CAPACITY_NOTICE,tone:'danger' as const}:null)??(client.toasts.current?{id:`toast:${client.toasts.current.id}`,text:client.toasts.current.text,tone:client.toasts.current.kind==='error'?'danger' as const:'plain' as const}:undefined)};}
  function publishPublic(notice?:RoomShellNotice){
    const details=metadata(notice??hostNotice,true),signature=JSON.stringify([{...details,client:undefined},sourceToken(client.room),client.status,client.seat,client.viewerId,client.viewerName]);
    if(signature===lastPublicSignature&&session.snapshot().document?.context.session===`room-shell:${id}`)return;
    const previous=session.snapshot().document;
    // Replacing one compatible public shell must preserve local disclosures.
    // Private or other-audience documents still revoke before public projection.
    if(previous&&(previous.context.session!==`room-shell:${id}`||previous.context.audience!==`public:${client.viewerId??'anonymous'}`||previous.context.generation!=='public'))revokePrivateView();
    lastPublicSignature=signature;
    publishedActor=JSON.stringify([client.viewerId,client.seat]);session.receive(publicConnectedDocument(details,++revision),{connected:false});
  }
  $effect(()=>{
    const state=client.game;
    graceReady=!state||state.grace_ms<=0;
    if(state&&state.grace_ms>0){const timer=setTimeout(()=>{graceReady=true;},state.grace_ms);return()=>clearTimeout(timer);}
  });
  function publishConnected(){
    if(!mounted||navigating)return;
    const status=client.status,room=client.room,state=client.game,seat=client.seat,viewer=client.viewerId,ready=graceReady;
    if(roomCapture?.source!==room)roomCapture=null;if(stateCapture?.source!==state)stateCapture=null;
    const capturedWindow=client.roomCommandWindow,capturedConnection=client.ephemeralConnectionEpoch,capturedSessionSource=client.publicSessionSource;
    const nativeCurrent=()=>mounted&&!navigating&&status===client.status&&room===client.room&&state===client.game&&seat===client.seat&&viewer===client.viewerId&&capturedWindow===client.roomCommandWindow&&capturedConnection===client.ephemeralConnectionEpoch&&capturedSessionSource===client.publicSessionSource;
    const completion=observeCompletion();
    // Optional storage/host callbacks can reenter native publication. Never
    // pair the pre-callback room/audience with post-callback metadata.
    if(!nativeCurrent()){retireDisclosures();session.revoke();feedbackCapture=null;lastSignature='';return;}
    if(status!=='open'){
      retireDisclosures();
      retireLocalAuthorities();feedbackCapture=null;
      staleRoom=room;staleGame=state;needsFresh=true;lastSignature='';session.setConnected(false);publishPublic();return;
    }
    if(room&&room.game!==adapter.id){retireDisclosures();lastSignature='';publishPublic({id:'wrong-game',text:'이 테이블의 게임과 화면이 일치하지 않아요.',tone:'danger'});return;}
    const settledPublic=!!room?.showing&&!room.in_hand&&!!room.current_hand&&client.roomPublicationReady&&!client.publicationReady;
    const newConnection=needsFresh;
    if(needsFresh){if(!room||room===staleRoom||(room.showing&&state===staleGame&&!settledPublic)){publishPublic();return;}needsFresh=false;}
    const actor=JSON.stringify([viewer,seat]);
    for(const [operation,origin] of pendingRoomCommands)if(origin.actor!==viewer)pendingRoomCommands.delete(operation);
    if(actor!==lastActor){
      retireLocalAuthorities();feedbackCapture=null;actorBaseline=!lastActor||newConnection?null:state;lastActor=actor;
      // Same-actor reseating still scrubs the private game immediately. Only
      // an already-owned public read island may survive its fixed native guard.
      revokePrivateView();lastSignature='';
    }
    if(room?.showing&&!state&&!settledPublic){
      const prior=session.snapshot().document;
      if(prior&&!prior.hand.length&&!prior.collections?.some(zone=>zone.cards.length))session.awaitState();
      else publishPublic();
      return;
    }
    if(room?.showing&&state===actorBaseline&&!settledPublic){publishPublic();return;}
    if(room?.showing&&!settledPublic&&(!state||!adapter.viewerMatches(state,seat))){lastSignature='';publishPublic();return;}
    if(!client.publicationReady&&!settledPublic){session.awaitState();lastSignature='';if(!session.snapshot().document)publishPublic();return;}
    const transportReady=!settledPublic&&client.commandRecovery.ready,details=metadata();
    const signature=JSON.stringify([sourceToken(room),sourceToken(state),seat,viewer,client.viewerName,ready,transportReady,settledPublic,completion,{...details,client:undefined},client.nativeHint,client.nativeReactions,client.ephemeralConnectionEpoch,client.clock,settings.hints,settings.tips]);
    if(signature===lastSignature)return;lastSignature=signature;lastPublicSignature='';
    const roomEpoch=client.roomCommandWindow!.scope.room_epoch,connectionEpoch=client.ephemeralConnectionEpoch;
    const feedbackKey=JSON.stringify([roomEpoch,connectionEpoch,viewer,seat,client.roomCommandWindow!.scope.session_id]),stateKey=JSON.stringify([room?.showing?state?.version??null:null]);
    if(settledPublic)feedbackCapture=null;
    const priorCapture=feedbackCapture?.key===feedbackKey?feedbackCapture:null;
    const projectionClient=Object.freeze({roomScope:freezePublication($state.snapshot(client.roomCommandWindow!.scope)),room:ownedRoom(room),game:settledPublic?null:ownedState(state),seat,viewerId:viewer,viewerName:client.viewerName});
    const projectionHistory=Object.freeze({previous:priorCapture?.state??null,previousParticipantIds:priorCapture?.participantIds??null,previousRoomScope:priorCapture?.roomScope??null,baseline:!priorCapture,roomEpoch,connectionEpoch});
    let source=adapter.project(projectionClient,++revision,ready,session.snapshot().document?.context.generation,projectionHistory);
    if(!source){publishPublic();return;}
    const outcome=client.roomCommandWindow&&adapter.outcome?.({document:source,client:projectionClient,roomScope:$state.snapshot(client.roomCommandWindow.scope),earnedTitles:completion?.earnedTitles});
    if(outcome)source={...source,outcome:outcome.outcome,information:[...(source.information??[]),outcome.information],...(outcome.collections?{collections:outcome.collections}:{}),...(outcome.reveals?{reveals:outcome.reveals}:{})};
    const commandClient=settledPublic?createConnectedCommandClient<G>({...commandView(),game:null}):commandView();
    const assistance=settledPublic?undefined:adapter.assistance?.({document:source,client:commandClient,roomEpoch,connectionEpoch,publicationReady:client.publicationReady,graceReady:ready,preferences:{hints:settings.hints,tips:settings.tips},nativeHint:$state.snapshot(client.nativeHint),nativeReactions:$state.snapshot(client.nativeReactions)})??undefined;
    let feedbackProjection=feedbackCapture?.projection??null;
    if(!settledPublic&&(!feedbackCapture||feedbackCapture.key!==feedbackKey||feedbackCapture.stateKey!==stateKey)){
      feedbackProjection=adapter.feedback?.({document:source,client:commandClient,previous:feedbackCapture?.key===feedbackKey?feedbackCapture.state:null,previousParticipantIds:feedbackCapture?.key===feedbackKey?feedbackCapture.participantIds:null,roomEpoch,connectionEpoch,clock:$state.snapshot(client.clock),baseline:feedbackCapture?.key!==feedbackKey})??null;
      feedbackCapture={key:feedbackKey,stateKey,state:ownedState(state),participantIds:Object.freeze([...(room?.participant_ids??[])]),roomScope:projectionClient.roomScope,projection:feedbackProjection};
    }else if(feedbackProjection){const currentFeedback=adapter.feedback?.({document:source,client:commandClient,previous:ownedState(state),previousParticipantIds:[...(room?.participant_ids??[])],roomEpoch,connectionEpoch,clock:$state.snapshot(client.clock),baseline:true});if(currentFeedback)feedbackProjection={...currentFeedback,events:feedbackProjection.events};}
    if(feedbackProjection){
      const reactions=(assistance?.projection.reactions??[]).map(record=>({id:`reaction:${record.eventId}`,kind:'reaction' as const,participantId:record.participantId,milestone:{kind:'visible' as const}}));
      const toast=client.toasts.current,error=toast?.kind==='error'?[{id:`error:${connectionEpoch}:${toast.id}`,kind:'error' as const,milestone:{kind:'visible' as const}}]:[];
      feedbackProjection={...feedbackProjection,events:[...feedbackProjection.events,...reactions,...error]};
    }
    const ruleInformation=room?adapter.ruleInformation?.(ownedRoom(room))??[]:[];
    const publication=disclose(connectedDocument({...source,...(assistance?{assistance}:{}),...(feedbackProjection?{feedback:feedbackProjection}:{}),interaction:localCardActivation()},{...details,client:commandClient,ruleInformation}));
    if(!publication)return;
    // All optional projection/read callbacks are inside this same native
    // publication fence, including adapters without disclosure policies.
    if(!nativeCurrent()){retireDisclosures();session.revoke();feedbackCapture=null;lastSignature='';return;}
    publishedActor=JSON.stringify([client.viewerId,client.seat]);session.receive(publication,{connected:transportReady});
  }
  $effect(publishConnected);
  function formClosed(context:ViewContext){
    const current=session.snapshot().document;
    if(!mounted||navigating||!current||!sameContext(current.context,context))return;
    retireLocalAuthorities();localFormCapture=null;lastSignature='';publishConnected();
  }
  onMount(()=>{
    const stopReceipts=client.commands.onResolution((operation,status)=>{
      session.resolve(operation,status);
      const origin=pendingRoomCommands.get(operation);pendingRoomCommands.delete(operation);
      if(origin&&origin.actor===client.viewerId&&origin.room===client.room?.id&&status!=='accepted')hostNotice={id:'room-operation',text:`${origin.label} 요청을 ${status==='rejected'?'처리하지 못했어요.':'확인할 수 없어요.'} 최신 테이블 상태를 확인해주세요.`,tone:'danger'};
      const leave=pendingLeave;
      if(!leave||leave.id!==operation)return;
      pendingLeave=null;
      if(client.viewerId!==leave.actor||client.room?.id!==leave.room)return;
      if(status==='accepted'){client.forgetSeatCredential();navigateHome();}
      else hostNotice={id:'leave',text:status==='rejected'?'테이블을 나가지 못했어요. 다시 확인해주세요.':'나가기 요청의 처리 결과를 확인할 수 없어요. 테이블에 머무릅니다.',tone:'danger'};
    });
    const stop=session.subscribe(snapshot=>{journalFull=snapshot.admissionBlocked==='journal-full';});
    table=createCardTable({session,assistance:{invoke:invokeAssistance},feedback:createBrowserFeedbackSink(),effects:{invoke:invokeEffect,changePreference,formClosed}});domSurface=createDomSurface(host);domSurface.setTextScale(localTextScale());table.attach(domSurface);mounted=true;
    // RoomClient's WebSocket bootstrap already sends the saved observer name.
    const roomUrl=location.href,mark=()=>({...history.state,foundationRoom:id});
    if(history.state?.foundationRoom!==id)history.pushState(mark(),'',roomUrl);
    let restoring=false;
    const onpop=()=>{
      if(navigating||restoring||!mounted)return;
      const outside=location.href!==roomUrl;
      history.pushState(mark(),'',roomUrl);table.back();
      if(outside){restoring=true;dispatchEvent(new PopStateEvent('popstate'));restoring=false;}
    };
    addEventListener('popstate',onpop);
    return()=>{mounted=false;retireDisclosures();try{disclosureOwner?.dispose();}catch{}disclosureOwner=null;disposeCompletion();roomCapture=null;stateCapture=null;retireLocalAuthorities();for(const controller of reportRequests)controller.abort();reportRequests.clear();removeEventListener('popstate',onpop);stop();stopReceipts();table.dispose();domSurface=null;session.dispose();client.close();};
  });
</script>
<main class="connected-foundation">
  <div class="live-surface" aria-label={adapter.tableLabel} bind:this={host}></div>
</main>
<style>
  .connected-foundation{position:fixed;inset:0;background:var(--table);color:var(--ink)}
  .live-surface{position:absolute;inset:0;overflow:auto;overscroll-behavior:contain}
</style>
