import type {ConnectedDisclosureOwner,ConnectedDisclosureContext,ConnectedDisclosureProjection} from '../../../table/foundation/connectedDisclosures';
import type {DisclosureSelectionReceipt,DisclosureRefresh,SyncDisclosureReadPolicy} from '../../../table/foundation/disclosures';
import type {FormSubmission} from '../../../table/foundation/forms';
import {copyFormData} from '../../../table/foundation/forms';
import {createMightyHistoryReadPolicy,mightyHistoryCatalogOffer,type MightyHistoryReadCapture} from '../historyReadPolicy';
import {createMightyDeviceReadPolicy,mightyDeviceCatalogOffer,MIGHTY_DEVICE_CATALOG_ID,type MightyDeviceReadCapture} from '../deviceReadPolicy';
import {readDeviceRecords,captureDeviceStatsDeletion,type DeviceRead,type DeviceStatsDeletion} from '../completionStore';
import {mightyDeviceDeleteForm,MIGHTY_DEVICE_DELETE_FORM,MIGHTY_DEVICE_DELETE_OPERATION,MIGHTY_DEVICE_DELETE_POLICY} from '../deviceDeletion';
import type {Mighty} from '../types';
type ReadyCapture=Extract<DeviceStatsDeletion,{status:'ready'}>;
/** Standalone policy/form utility fixture only. No room producer imports this
 * composition; these tests establish deletion safety, not room UI approval. */
export function createStandaloneMightyRecordToolsFixture(readRecords:()=>DeviceRead=readDeviceRecords,captureRecords:(()=>DeviceStatsDeletion)|undefined=readRecords===readDeviceRecords?captureDeviceStatsDeletion:undefined):Omit<ConnectedDisclosureOwner<Mighty>,'policies'>&{readonly policies:readonly SyncDisclosureReadPolicy[]} {
 let disposed=false,history:MightyHistoryReadCapture|null=null,device:MightyDeviceReadCapture|null=null;
 let identity='',nativeRevision='',epoch:object={},deviceRevision=0,sequence=0,selected:DisclosureSelectionReceipt|null=null,instanceId='';
 const captures=new Map<string,{capture:ReadyCapture;token:string;used:boolean;stored:boolean}>();
 const policies=Object.freeze([createMightyHistoryReadPolicy(()=>disposed?null:history),createMightyDeviceReadPolicy(()=>disposed?null:device)]);
 const next=()=>{if(sequence>=Number.MAX_SAFE_INTEGER)throw Error('Device capture capacity');return ++sequence;};
 function revoke(){epoch={};history=null;device=null;identity='';nativeRevision='';selected=null;instanceId='';captures.clear();}
 function selectionMatches(receipt:DisclosureSelectionReceipt){const a=receipt.scope,b=device?.scope;return !!device&&receipt.catalogId===MIGHTY_DEVICE_CATALOG_ID&&receipt.revision===device.revision&&!!b&&a.visibility==='audience'&&a.roomId===b.roomId&&a.roomEpoch===b.roomEpoch&&a.actorId===b.actorId&&a.connectionEpoch===b.connectionEpoch&&a.audience===b.audience;}
 function read(entryId:string):DeviceRead{
  if(!captureRecords)return readRecords();
  const before=epoch,captured=captureRecords();
  if(disposed||before!==epoch)return {status:'failed',message:'기록 읽기 요청이 만료됐어요.'};
  for(const key of captures.keys())if(key!==selected?.entryId&&key!==entryId)captures.delete(key);
  if(captured.status!=='ready')return captured;
  captures.set(entryId,{capture:captured,token:`mighty-delete:${next()}`,used:false,stored:false});
  return {status:'ready',records:captured.records};
 }
 return {policies,
  selectionChanged(receipt){
   if(disposed||!receipt||!selectionMatches(receipt)){selected=null;instanceId='';captures.clear();return;}
   if(selected?.id!==receipt.id)instanceId=`mighty-delete-form:${next()}`;
   selected=copyFormData(receipt);for(const key of captures.keys())if(key!==receipt.entryId)captures.delete(key);
  },
  resolveFormAuthority(selectionId,token){
   const selection=selected;if(disposed||!selection||selection.id!==selectionId||!selectionMatches(selection))return null;
   const owned=captures.get(selection.entryId);if(!owned||owned.used||owned.token!==token)return null;
   return Object.freeze({commit(isCurrent:()=>boolean){
    if(disposed||selected?.id!==selectionId||!selectionMatches(selection)||captures.get(selection.entryId)!==owned||owned.used)return {status:'conflict' as const,message:'기록 삭제 요청이 만료됐어요.'};
    owned.used=true;const result=owned.capture.commit(isCurrent);owned.stored=result.status==='stored';return result;
   }});
  },
  operationCommitted(submission:FormSubmission):DisclosureRefresh|null{
   if(disposed||!selected||!selectionMatches(selected)||submission.policyId!==MIGHTY_DEVICE_DELETE_POLICY||submission.formId!==MIGHTY_DEVICE_DELETE_FORM||submission.operationId!==MIGHTY_DEVICE_DELETE_OPERATION||submission.actionId!=='delete'||submission.offerInstanceId!==instanceId||submission.access?.selectionId!==selected.id)return null;
   const owned=captures.get(selected.entryId);if(!owned?.used||!owned.stored||submission.binding.captureToken!==owned.token)return null;
   const selectionId=selected.id;owned.stored=false;deviceRevision=next();captures.clear();
   return {selectionId,catalogId:MIGHTY_DEVICE_CATALOG_ID,revision:JSON.stringify([nativeRevision,deviceRevision])};
  },
  project(input:ConnectedDisclosureContext<Mighty>):ConnectedDisclosureProjection {
   const {client,roomScope:scope,context}=input,room=client.room;
   if(disposed||!room||room.game!=='mighty'||!client.viewerId||scope.domain!=='room'||scope.room_id!==room.id||scope.actor_id!==client.viewerId||scope.seat!==client.seat||scope.session_id!==room.session_id||input.publicHistory.current.sessionId!==scope.session_id||!input.connectionEpoch||!input.sourceRevision){revoke();return {offers:[],menuItems:[]};}
   const key=JSON.stringify([room.id,scope.room_epoch,scope.session_id,client.viewerId,client.seat,context.audience,input.connectionEpoch,input.sourceRevision]);
   if(identity!==key){revoke();identity=key;deviceRevision=next();}nativeRevision=input.sourceRevision;
   const publicScope={roomId:room.id,roomEpoch:scope.room_epoch,actorId:client.viewerId,connectionEpoch:input.connectionEpoch,visibility:'public' as const};
   history={scope:publicScope,source:{identity:{roomId:room.id,roomEpoch:scope.room_epoch,actorId:client.viewerId,revision:input.sourceRevision},current:input.publicHistory.current,...(input.publicHistory.archives!==undefined?{archives:input.publicHistory.archives}:{})}};
   device={scope:{...publicScope,visibility:'audience',audience:context.audience},revision:JSON.stringify([input.sourceRevision,deviceRevision]),readRecords:read};
   const offers=[mightyHistoryCatalogOffer(history),mightyDeviceCatalogOffer(device)];
   const owned=selected&&selectionMatches(selected)?captures.get(selected.entryId):undefined;
   const form=selected&&owned?mightyDeviceDeleteForm({selection:selected,instanceId,token:owned.token,seat:client.seat,enabled:!owned.used}):null;
   return {offers,menuItems:offers.map(offer=>({id:`open:${offer.id}`,label:offer.title,catalogId:offer.id})),...(form&&selected?{forms:[form],formActions:[{id:'mighty:device-delete',label:'플레이 기록 삭제',intent:'danger' as const,selectionId:selected.id,catalogId:selected.catalogId,catalogRevision:selected.revision,entryId:selected.entryId,formId:form.id,formInstanceId:form.instanceId}]}:{}),...(!room.in_hand&&room.showing&&room.current_hand&&offers[0].total?{outcomeDetailsCatalogId:offers[0].id}:{})};
  },revoke,dispose(){disposed=true;revoke();},
 };
}
