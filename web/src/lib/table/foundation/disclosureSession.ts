import {disclosureScopeCurrent,sameDisclosureScope,ownDisclosureData,ownDisclosureDocument,ownDisclosureOffer,ownDisclosurePage,ownDisclosureSelectionReceipt,type DisclosureCatalogOffer,type DisclosureCatalogPage,type DisclosureContext,type DisclosureReadPolicy,type DisclosureScope,type DisclosureSelectionReceipt} from './disclosures';
import type {DisclosureDocument} from './disclosureTypes';
export interface DisclosureReadSource {readonly offers:readonly DisclosureCatalogOffer[];readonly context:DisclosureContext;readonly epoch:string|number;readonly readable:boolean;}
export interface DisclosureReaderSnapshot {readonly selection?:DisclosureSelectionReceipt;readonly catalogId?:string;readonly page?:DisclosureCatalogPage;readonly selected?:DisclosureDocument;readonly pending?:DisclosurePendingRead;readonly error?:string;}
export interface DisclosurePendingRead {readonly catalogId:string;readonly entryId:string;readonly status:'loading'|'failed';}
let nextSelectionReceipt=0;
/** Read ownership helper for the canonical session. It receives no connection,
 * submission port, mutable game state or independent authorization source. */
export function createDisclosureReader({readCurrent,policies,isCurrent,isRetainedCurrent,onSelectionChanged,onChange}:{readCurrent:()=>DisclosureReadSource|null;policies:readonly DisclosureReadPolicy[];isCurrent?:(context:DisclosureContext)=>boolean;isRetainedCurrent?:(scope:DisclosureScope)=>boolean;onSelectionChanged?:(receipt:DisclosureSelectionReceipt|null)=>void;onChange?:()=>void}){
 if(policies.length>8||new Set(policies.map(policy=>policy.id)).size!==policies.length||policies.some(policy=>!policy.id.trim()||policy.id.length>2048))throw Error('Invalid disclosure read policies');
 const registry=new Map(policies.map(policy=>[policy.id,policy]));
 let disposed=false,busy=false,reading=false,retaining=false,detached=false,notifying=false,epoch=0,operationEpoch=0,state:DisclosureReaderSnapshot=Object.freeze({}),grant:DisclosureCatalogOffer|null=null;
 let lastNotified:DisclosureSelectionReceipt|null=null,selectionAudience:string|null=null;
 const retireSelection=()=>{selectionAudience=null;if(state.selection){const {selection:retired,...rest}=state;state=Object.freeze(rest);}};
 // A retired asynchronous invocation still owns this slot until its raw result settles.
 let checkingPending=false;
 let outstanding:{controller:AbortController;active:boolean;sourceEpoch:string|number;context:DisclosureContext}|null=null;
 const cancelAttempt=()=>{const attempt=outstanding;if(attempt){attempt.active=false;attempt.controller.abort();}};
 const clear=()=>{selectionAudience=null;state=Object.freeze({});grant=null;detached=false;cancelAttempt();};
 let notificationQueued=false;
 function changed(){if(notificationQueued||disposed)return;notificationQueued=true;queueMicrotask(()=>{notificationQueued=false;if(!disposed){flush();try{onChange?.();}catch{/* Observation cannot grant read authority. */}}});}

 function source():DisclosureReadSource|null{
  if(reading)throw Error('Reentrant disclosure source');reading=true;try{
  const raw=readCurrent();if(!raw)return null;const value=ownDisclosureData(raw);
  if(typeof value.readable!=='boolean'||!Array.isArray(value.offers)||value.offers.length>8||new Set(value.offers.map(offer=>offer.id)).size!==value.offers.length||!(typeof value.epoch==='string'&&!!value.epoch&&value.epoch.length<=2048||typeof value.epoch==='number'&&Number.isSafeInteger(value.epoch)&&value.epoch>=0))throw Error('Invalid disclosure source');
  const context=value.context;if(!context||[context.roomId,context.roomEpoch,context.actorId,context.connectionEpoch,context.audience].some(value=>typeof value!=='string'||!value||value.length>2048))throw Error('Invalid disclosure context');
  return Object.freeze({...value,offers:Object.freeze(value.offers.map(ownDisclosureOffer))});
  }finally{reading=false;}
 }
 function reconcileSelection(current:DisclosureReadSource|null){
  const receipt=state.selection;if(!receipt)return;
  const offered=current?.offers.find(offer=>offer.id===receipt.catalogId&&offer.policyId===grant?.policyId);
  if(!current||!current.readable||current.context.audience!==selectionAudience||!offered||offered.revision!==receipt.revision||!sameDisclosureScope(offered.scope,receipt.scope)||!disclosureScopeCurrent(receipt.scope,current.context))retireSelection();
 }
 function flush(){
  if(notifying||!onSelectionChanged)return;notifying=true;
  try{for(let pass=0;pass<8;pass++){
   const receipt=state.selection??null;if(receipt===lastNotified)break;lastNotified=receipt;
   try{onSelectionChanged(receipt);}catch{/* Host notification failure grants no new authority. */}
   if(!disposed)try{reconcile(source());}catch{epoch++;clear();}
  }}finally{notifying=false;}
 }
 function retainedCurrent(observed?:{source?:DisclosureReadSource|null}):boolean{
  if(!grant)return !disposed;if(retaining)return false;
  const offered=grant,token=epoch;let allowed=false;retaining=true;
  try{
   allowed=!isRetainedCurrent||isRetainedCurrent(offered.scope)===true;
   if(allowed&&isRetainedCurrent&&!disposed&&epoch===token&&grant===offered){
    // A fixed native check can synchronously publish another canonical source.
    // Reconcile that source without recursively invoking the same host guard.
    const latest=source();if(observed)observed.source=latest;const current=latest?.offers.find(candidate=>candidate.id===offered.id&&candidate.policyId===offered.policyId);
    allowed=latest?!!current&&disclosureScopeCurrent(offered.scope,latest.context)&&sameDisclosureScope(current.scope,offered.scope):detached&&offered.scope.visibility==='public'&&!!state.selected;
    if(allowed&&latest)detached=false;
    if(allowed)reconcileSelection(latest);
    if(allowed&&current&&state.page&&(state.page.revision!==current.revision||state.page.total!==current.total)){const {page:retiredPage,...retained}=state;state=Object.freeze(retained);}
   }
  }catch{allowed=false;/* A failed native grant check retires its private snapshot. */}
  finally{retaining=false;}
  if(disposed||epoch!==token||grant!==offered)return false;
  if(!allowed){epoch++;clear();return false;}return true;
 }
 function reconcile(current:DisclosureReadSource|null):boolean{
  if(state.pending&&grant){
   const attempt=outstanding,token=epoch,offered=current?.offers.find(offer=>offer.id===grant!.id&&offer.policyId===grant!.policyId);
   let allowed=!!current?.readable&&!!offered&&JSON.stringify(offered)===JSON.stringify(grant)&&disclosureScopeCurrent(grant.scope,current.context);
   if(allowed&&attempt?.active)allowed=current!.epoch===attempt.sourceEpoch&&JSON.stringify(current!.context)===JSON.stringify(attempt.context);
   if(allowed&&isCurrent){checkingPending=true;try{allowed=isCurrent(current!.context)===true;}catch{allowed=false;}finally{checkingPending=false;}}
   if(disposed||epoch!==token)return false;
   if(!allowed){epoch++;clear();return false;}
  }
  if(!grant)return true;const observed:{source?:DisclosureReadSource|null}={};if(!retainedCurrent(observed))return false;
  if(observed.source!==undefined)current=observed.source;
  if(!current&&detached&&grant.scope.visibility==='public'&&state.selected){retireSelection();return true;}
  const offered=current?.offers.find(offer=>offer.id===grant!.id&&offer.policyId===grant!.policyId);
  if(!current||!offered||!disclosureScopeCurrent(grant.scope,current.context)||!sameDisclosureScope(offered.scope,grant.scope)){clear();return false;}
  reconcileSelection(current);
  if(state.page&&(state.page.revision!==offered.revision||state.page.total!==offered.total)){const {page:retiredPage,...retained}=state;state=Object.freeze(retained);}
  return true;
 }
 function capture(catalogId:string){const current=source();if(!reconcile(current))return null;const offer=current?.offers.find(offer=>offer.id===catalogId);if(!current||!current.readable||!offer||!registry.has(offer.policyId)||!disclosureScopeCurrent(offer.scope,current.context))return null;return{current,offer,policy:registry.get(offer.policyId)!,epoch:operationEpoch};}
 function stillCurrent(captured:NonNullable<ReturnType<typeof capture>>):boolean{
  if(disposed||epoch!==captured.epoch)return false;
  const latest=source();if(!reconcile(latest))return false;const offer=latest?.offers.find(offer=>offer.id===captured.offer.id);
  return !disposed&&epoch===captured.epoch&&!!latest&&latest.readable&&latest.epoch===captured.current.epoch&&JSON.stringify(latest.context)===JSON.stringify(captured.current.context)&&!!offer&&JSON.stringify(offer)===JSON.stringify(captured.offer)&&disclosureScopeCurrent(offer.scope,latest.context);
 }
 function hostCurrent(captured:NonNullable<ReturnType<typeof capture>>):boolean{
  if(disposed||epoch!==captured.epoch)return false;
  return (!isCurrent||isCurrent(captured.current.context)===true)&&!disposed&&epoch===captured.epoch;
 }
 function run(read:()=>boolean):boolean{if(disposed||busy||retaining||notifying)return false;busy=true;operationEpoch=epoch;try{return read();}catch{if(!disposed&&epoch===operationEpoch)try{reconcile(source());state=Object.freeze({...state,error:'기록을 읽지 못했어요. 다시 열어주세요.'});}catch{clear();}return false;}finally{busy=false;flush();}}
 return{
  page(catalogId:string,page:number):boolean{return run(()=>{
   let captured=capture(catalogId);if(!captured||!Number.isSafeInteger(page)||page<0||page>=Math.max(1,Math.ceil(captured.offer.total/12)))return false;
   if(state.pending){epoch++;operationEpoch=epoch;const {pending:retiredPending,error:retiredError,...rest}=state;state=Object.freeze(rest);cancelAttempt();captured=capture(catalogId);if(!captured)return false;}
   if(!hostCurrent(captured)||!stillCurrent(captured))return false;
   const value=ownDisclosurePage(captured.policy.page(captured.offer,page),captured.offer,page);if(!hostCurrent(captured)||!stillCurrent(captured))return false;
   const prior=state.catalogId===catalogId?state.selected:undefined,selection=state.selection;grant=captured.offer;state=Object.freeze({catalogId,page:value,...(prior?{selected:prior}:{}),...(prior&&selection?{selection}:{})});return true;
  });},
  select(catalogId:string,entryId:string):boolean{return run(()=>{
   if(outstanding)return false;
   const captured=capture(catalogId),page=state.page;if(!captured||state.catalogId!==catalogId||!page||page.revision!==captured.offer.revision||!page.entries.some(entry=>entry.id===entryId))return false;
   if(!hostCurrent(captured)||!stillCurrent(captured))return false;
   // Retire the previous document and receipt before any provider or abort reentry.
   const attempt={controller:new AbortController(),active:true,sourceEpoch:captured.current.epoch,context:captured.current.context};outstanding=attempt;
   const pending=Object.freeze({catalogId,entryId,status:'loading' as const});grant=captured.offer;selectionAudience=null;state=Object.freeze({catalogId,page,pending});
   const current=()=>attempt.active&&outstanding===attempt&&hostCurrent(captured)&&stillCurrent(captured)&&attempt.active&&outstanding===attempt;
   const fail=()=>{if(current()){state=Object.freeze({catalogId,page,pending:Object.freeze({catalogId,entryId,status:'failed' as const}),error:'기록을 읽지 못했어요. 다시 열어주세요.'});return true;}return false;};
   const commit=(raw:unknown)=>{
    if(!current())return false;
    const value=ownDisclosureDocument(raw as DisclosureDocument,entryId);if(!current())return false;
    const selection=ownDisclosureSelectionReceipt({id:`disclosure-selection:${++nextSelectionReceipt}`,catalogId,revision:captured.offer.revision,entryId,scope:captured.offer.scope});
    if(!current())return false;
    selectionAudience=captured.current.context.audience;state=Object.freeze({catalogId,page,selected:value,selection});return true;
   };
   let async=false;
   try{
    const raw=captured.policy.select(captured.offer,entryId,{signal:attempt.controller.signal});
    // Promise assimilation handles hostile thenables, but the slot is installed first.
    if(raw!==null&&(typeof raw==='object'||typeof raw==='function')&&typeof (raw as {then?:unknown}).then==='function'){
     async=true;
     let completionChanged=false;
     const settle=(finish:()=>void)=>{const before=state;try{finish();}finally{completionChanged=completionChanged||state!==before;}};
     Promise.resolve(raw).then(value=>settle(()=>{try{commit(value);}catch{try{fail();}catch{/* Stale source. */}}}),()=>settle(()=>{try{fail();}catch{/* Stale source. */}})).finally(()=>{
      if(state.pending===pending){const {pending:retiredPending,...rest}=state;state=Object.freeze(rest);completionChanged=true;}
      if(outstanding===attempt)outstanding=null;attempt.active=false;if(completionChanged)changed();
     });
     return attempt.active&&!disposed&&epoch===captured.epoch;
    }
    return commit(raw);
   }catch{try{fail();}catch{/* A failed guard never publishes provider details. */}return false;}
   finally{if(!async){if(outstanding===attempt)outstanding=null;if(attempt.active&&state.pending?.status==='failed')changed();attempt.active=false;}}
  });},
  snapshot():DisclosureReaderSnapshot{if(retaining||notifying||checkingPending)return Object.freeze({});if(!disposed&&retainedCurrent()&&!busy)try{reconcile(source());}catch{clear();}flush();return state;},
  selectionCurrent(selectionId:string):boolean{if(disposed||busy||notifying||retaining||reading)return false;const receipt=state.selection;if(!receipt||receipt.id!==selectionId||!isCurrent)return false;const accepted=run(()=>{const captured=capture(receipt.catalogId);return !!captured&&state.selection===receipt&&captured.offer.revision===receipt.revision&&hostCurrent(captured)&&stillCurrent(captured)&&state.selection===receipt&&hostCurrent(captured)&&stillCurrent(captured)&&state.selection===receipt;});if(!accepted&&state.selection===receipt){retireSelection();flush();}return accepted&&state.selection===receipt;},
  retainPublic():boolean{try{
   if(disposed||busy||retaining||notifying||!isRetainedCurrent||!grant||grant.scope.visibility!=='public'||!state.selected){epoch++;clear();return false;}
   const offered=grant,selected=state.selected,start=epoch;let prior:DisclosureReadSource|null;
   try{prior=source();}catch{epoch++;clear();return false;}
   if(disposed||epoch!==start||grant!==offered)return false;
   if(prior!==null){epoch++;clear();return false;}
   const token=++epoch;detached=true;selectionAudience=null;state=Object.freeze({catalogId:offered.id,selected});const observed:{source?:DisclosureReadSource|null}={};
   if(!retainedCurrent(observed))return false;
   if(disposed||epoch!==token||grant!==offered)return false;
   if(observed.source!==null){epoch++;clear();return false;}
   return true;
  }finally{flush();}},
  deselect(){epoch++;selectionAudience=null;const {selected:retiredSelected,selection:retiredReceipt,pending:retiredPending,error:retiredError,...retained}=state;state=Object.freeze(retained);cancelAttempt();flush();},
  revoke(){const had=!!grant||Object.keys(state).length>0;epoch++;clear();flush();return had;},
  dispose(){if(disposed)return;disposed=true;epoch++;clear();flush();},
 };
}
