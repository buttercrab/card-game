import type {DisclosureCatalogOffer,SyncDisclosureReadPolicy,DisclosureScope} from '../../table/foundation/disclosures';
import type {DisclosureDocument} from '../../table/foundation/disclosureTypes';
import type {DeviceRead} from './completionStore';
import {createMightyDeviceDisclosure} from './deviceDisclosure';
export const MIGHTY_DEVICE_CATALOG_ID='mighty:device';
export const MIGHTY_DEVICE_READ_POLICY_ID='mighty:device:v1';
export const MIGHTY_DEVICE_ENTRY_ID='mighty:device-records';
/** Explicit read-only host operation. It carries no deletion, game or transport capability. */
export interface MightyDeviceReadCapture {readonly scope:DisclosureScope;readonly revision:string;readRecords(entryId:string):DeviceRead;}
export function mightyDeviceCatalogOffer(capture:MightyDeviceReadCapture):DisclosureCatalogOffer {
 return {id:MIGHTY_DEVICE_CATALOG_ID,policyId:MIGHTY_DEVICE_READ_POLICY_ID,revision:capture.revision,title:'내 기록',total:1,pageSize:12,scope:capture.scope};
}
export function createMightyDeviceReadPolicy(read:()=>MightyDeviceReadCapture|null):SyncDisclosureReadPolicy {
 let admitted:DisclosureCatalogOffer|null=null;
 let pageSequence=0,pageEntry:string|null=null,selected:{entryId:string;document:DisclosureDocument}|null=null;
 function current(offer:DisclosureCatalogOffer){
  const capture=read(),a=capture?.scope,b=offer.scope;
  if(!capture||!a||a.visibility!=='audience'||b.visibility!=='audience'||offer.id!==MIGHTY_DEVICE_CATALOG_ID||offer.policyId!==MIGHTY_DEVICE_READ_POLICY_ID||offer.revision!==capture.revision||a.roomId!==b.roomId||a.roomEpoch!==b.roomEpoch||a.actorId!==b.actorId||a.connectionEpoch!==b.connectionEpoch||a.audience!==b.audience)throw Error('Retired device-record read');
  return capture;
 }
 return {id:MIGHTY_DEVICE_READ_POLICY_ID,
  page(offer,page){admitted=null;pageEntry=null;selected=null;current(offer);if(page!==0||offer.total!==1||pageSequence>=Number.MAX_SAFE_INTEGER)throw Error('Invalid device-record page');admitted=offer;pageEntry=`${MIGHTY_DEVICE_ENTRY_ID}:${++pageSequence}`;return {catalogId:offer.id,revision:offer.revision,page:0,total:1,pageSize:12,entries:[{id:pageEntry,title:'내 기록',description:'이 기기의 플레이 기록과 업적'}]};},
  select(offer,entryId){
   const capture=current(offer),pageOffer=admitted;if(!pageOffer||pageOffer.revision!==offer.revision||entryId!==pageEntry)throw Error('Unadmitted device-record selection');current(pageOffer);
   if(selected?.entryId===entryId)return selected.document;
   let result:DeviceRead;try{result=capture.readRecords(entryId);}catch{result={status:'failed',message:'이 기기의 기록을 읽지 못했어요.'};}
   const document=createMightyDeviceDisclosure({entryId,read:result});current(offer);
   if(admitted!==pageOffer||pageEntry!==entryId)throw Error('Retired device-record read');
   selected={entryId,document};return document;
  },
 };
}
