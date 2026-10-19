import type {DisclosureCatalogOffer,DisclosureScope,SyncDisclosureReadPolicy} from '../../table/foundation/disclosures';
import {createMightyHistoryDisclosure} from './historyDisclosure';
import type {MightyHistoryInput} from './history';
export const MIGHTY_CURRENT_HAND_CATALOG_ID='mighty:current-hand';
export const MIGHTY_CURRENT_HAND_READ_POLICY_ID='mighty:current-hand:v1';
export interface MightyCurrentHandReadCapture {readonly scope:DisclosureScope;readonly revision:string;readonly entryId:string;readonly source:MightyHistoryInput;}
const sameScope=(a:DisclosureScope,b:DisclosureScope)=>a.visibility==='public'&&b.visibility==='public'&&a.roomId===b.roomId&&a.roomEpoch===b.roomEpoch&&a.actorId===b.actorId&&a.connectionEpoch===b.connectionEpoch;
/** One current hand, never an archive/session index. The generic reader opens
 * singleton offers directly and owns already-selected frozen public content. */
export function mightyCurrentHandCatalogOffer(capture:MightyCurrentHandReadCapture):DisclosureCatalogOffer{return {id:MIGHTY_CURRENT_HAND_CATALOG_ID,policyId:MIGHTY_CURRENT_HAND_READ_POLICY_ID,revision:capture.revision,title:'이번 판 다시 보기',total:1,pageSize:12,scope:capture.scope};}
export function createMightyCurrentHandReadPolicy(read:()=>MightyCurrentHandReadCapture|null):SyncDisclosureReadPolicy{
 let admitted:{revision:string;entryId:string;scope:DisclosureScope}|null=null;
 function current(offer:DisclosureCatalogOffer){const capture=read();if(!capture||offer.id!==MIGHTY_CURRENT_HAND_CATALOG_ID||offer.policyId!==MIGHTY_CURRENT_HAND_READ_POLICY_ID||offer.revision!==capture.revision||offer.total!==1||offer.pageSize!==12||!sameScope(offer.scope,capture.scope))throw Error('Retired current hand replay');return capture;}
 return {id:MIGHTY_CURRENT_HAND_READ_POLICY_ID,
  page(offer,page){admitted=null;const capture=current(offer);if(page!==0)throw Error('Current hand replay has no other page');admitted={revision:capture.revision,entryId:capture.entryId,scope:capture.scope};return {catalogId:offer.id,revision:offer.revision,page:0,total:1,pageSize:12,entries:[{id:capture.entryId,title:'이번 판 다시 보기'}]};},
  select(offer,entryId){const capture=current(offer);if(!admitted||admitted.revision!==capture.revision||admitted.entryId!==entryId||entryId!==capture.entryId||!sameScope(admitted.scope,capture.scope))throw Error('Unadmitted current hand replay');return {...createMightyHistoryDisclosure({entryId,source:capture.source}),title:'이번 판 다시 보기'};},
 };
}
