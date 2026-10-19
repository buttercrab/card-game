import type {ConnectedDisclosureOwner,ConnectedDisclosureContext,ConnectedDisclosureProjection} from '../../table/foundation/connectedDisclosures';
import type {DisclosureCatalogOffer,DisclosureSelectionReceipt,SyncDisclosureReadPolicy} from '../../table/foundation/disclosures';
import {recordedOrigin} from '../../room/recordedOrigin';
import {createMightyCurrentHandReadPolicy,mightyCurrentHandCatalogOffer,type MightyCurrentHandReadCapture} from './currentHandReadPolicy';
import type {Mighty} from './types';
const data=(value:unknown,key:string):unknown=>{if(!value||typeof value!=='object')return undefined;const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;};
/** Room reads expose exactly the completed current hand. Device statistics stay
 * on Home; retained archives are internal and never indexed by this owner. */
export function createMightyDisclosureOwner():Omit<ConnectedDisclosureOwner<Mighty>,'policies'>&{readonly policies:readonly SyncDisclosureReadPolicy[]}{
 let disposed=false,current:MightyCurrentHandReadCapture|null=null,ownership='',offered:DisclosureCatalogOffer|null=null,selectedOffer:DisclosureCatalogOffer|null=null,selected:DisclosureSelectionReceipt|null=null,offeredEntryId='';
 const policies=Object.freeze([createMightyCurrentHandReadPolicy(()=>disposed?null:current)]);
 const revoke=()=>{current=null;ownership='';offered=null;offeredEntryId='';selectedOffer=null;selected=null;};
 const retained=():ConnectedDisclosureProjection=>({offers:selectedOffer?[selectedOffer]:[],menuItems:[]});
 return {policies,
  selectionChanged(receipt){
   if(!receipt){selected=null;selectedOffer=null;return;}
   const offer=selectedOffer??offered,a=receipt.scope,b=offer?.scope;
   if(!offer||!b||receipt.catalogId!==offer.id||receipt.revision!==offer.revision||receipt.entryId!==(selected?.entryId??offeredEntryId)||a.visibility!=='public'||b.visibility!=='public'||a.roomId!==b.roomId||a.roomEpoch!==b.roomEpoch||a.actorId!==b.actorId||a.connectionEpoch!==b.connectionEpoch){selected=null;selectedOffer=null;return;}
   // Only bounded offer/receipt metadata survives an advancing hand. The raw
   // old record is dropped; the generic reader already owns its frozen value.
   selected={id:receipt.id,catalogId:receipt.catalogId,revision:receipt.revision,entryId:receipt.entryId,scope:{...a}};selectedOffer={...offer,scope:{...b}};
  },
  project(input:ConnectedDisclosureContext<Mighty>):ConnectedDisclosureProjection{
   current=null;offered=null;const {client,roomScope:scope,context}=input,room=client.room;
   if(disposed||!room||room.game!=='mighty'||!client.viewerId||scope.domain!=='room'||scope.room_id!==room.id||scope.actor_id!==client.viewerId||scope.seat!==client.seat||scope.session_id!==room.session_id||!input.connectionEpoch||!input.sourceRevision){revoke();return {offers:[],menuItems:[]};}
   const key=JSON.stringify([room.id,scope.room_epoch,client.viewerId,client.seat,context.audience,input.connectionEpoch]);if(ownership!==key){revoke();ownership=key;}
   if(room.in_hand||!room.showing)return retained();
   const record=room.current_hand,origin=recordedOrigin(record,scope.session_id),number=data(record,'number');
   // Missing legacy stamps do not prove the hand's score period. ResetScores
   // retains a known prior origin, which is allowed independently of scope.hand.
   if(origin.status!=='known'||!Number.isSafeInteger(number)||(number as number)<1)return retained();
   const identity={roomId:room.id,roomEpoch:scope.room_epoch,sessionId:origin.sessionId,handNumber:number as number};
   current={scope:{roomId:room.id,roomEpoch:scope.room_epoch,actorId:client.viewerId,connectionEpoch:input.connectionEpoch,visibility:'public'},revision:JSON.stringify([key,input.sourceRevision,origin.sessionId,number]),entryId:JSON.stringify(['mighty-current-hand',room.id,scope.room_epoch,origin.sessionId,number]),source:{identity,record}};
   const offer=mightyCurrentHandCatalogOffer(current);offered=offer;offeredEntryId=current.entryId;
   if(selected&&selectedOffer)return retained();
   return {offers:[offer],menuItems:[{id:'mighty:current-hand-replay',label:'이번 판 다시 보기',catalogId:offer.id}],outcomeDetailsCatalogId:offer.id};
  },revoke,dispose(){disposed=true;revoke();},
 };
}
