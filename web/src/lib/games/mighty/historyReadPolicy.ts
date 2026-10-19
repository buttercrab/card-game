import type {DisclosureCatalogOffer,DisclosureCatalogPage,SyncDisclosureReadPolicy,DisclosureScope} from '../../table/foundation/disclosures';
import type {DisclosureDocument} from '../../table/foundation/disclosureTypes';
import {createMightyHistoryCatalog,resolveMightyHistorySource,type MightyHistoryCatalogInput,type MightyHistorySelection} from './historyCatalog';
import {createMightyHistoryDisclosure} from './historyDisclosure';
export const MIGHTY_HISTORY_CATALOG_ID='mighty:history';
export const MIGHTY_HISTORY_READ_POLICY_ID='mighty:history:v1';
export interface MightyHistoryReadCapture {readonly scope:DisclosureScope;readonly source:MightyHistoryCatalogInput;}
const pageSource=(source:MightyHistoryCatalogInput,page:number):MightyHistoryCatalogInput=>({identity:source.identity,current:source.current,...(source.archives!==undefined?{archives:source.archives}:{}),page});
const sameScope=(a:DisclosureScope,b:DisclosureScope)=>a.roomId===b.roomId&&a.roomEpoch===b.roomEpoch&&a.actorId===b.actorId&&a.connectionEpoch===b.connectionEpoch&&a.visibility==='public'&&b.visibility==='public';
const unavailable=(entryId:string,message:string):DisclosureDocument=>({entryId,title:'기록 안내',roster:[],cards:[],sections:[{kind:'content',id:'unavailable',title:'기록 안내',information:[{id:'unavailable',title:'기록 안내',fields:[{id:'reason',label:'안내',value:{kind:'text',text:message}}]}]}]});
/** Header-only offer. Failure remains a readable explanatory entry. */
export function mightyHistoryCatalogOffer(capture:MightyHistoryReadCapture):DisclosureCatalogOffer {
 const catalog=createMightyHistoryCatalog(pageSource(capture.source,0));
 return {id:MIGHTY_HISTORY_CATALOG_ID,policyId:MIGHTY_HISTORY_READ_POLICY_ID,revision:capture.source.identity.revision,title:'지난 판 기록',total:catalog.status==='ready'?catalog.totalEntries:1,pageSize:12,scope:capture.scope};
}
/** Fixed host read policy. The callback supplies only the latest public history
 * source; no native client, transport, private game or storage is accepted.
 * At most one metadata page is retained. Selected raw records are transient and
 * immediately cross the strict spectator builder, never retained by this port. */
export function createMightyHistoryReadPolicy(read:()=>MightyHistoryReadCapture|null):SyncDisclosureReadPolicy {
 let admitted:{revision:string;scope:DisclosureScope;entries:Map<string,MightyHistorySelection>;unavailable?:{id:string;message:string}}|null=null;
 function current(offer:DisclosureCatalogOffer):MightyHistoryReadCapture {
  const capture=read();
  if(!capture||offer.id!==MIGHTY_HISTORY_CATALOG_ID||offer.policyId!==MIGHTY_HISTORY_READ_POLICY_ID||offer.revision!==capture.source.identity.revision||!sameScope(offer.scope,capture.scope)||capture.source.identity.roomId!==capture.scope.roomId||capture.source.identity.roomEpoch!==capture.scope.roomEpoch||capture.source.identity.actorId!==capture.scope.actorId)throw Error('Retired public history read');
  return capture;
 }
 return {id:MIGHTY_HISTORY_READ_POLICY_ID,
  page(offer,page):DisclosureCatalogPage {
   admitted=null;const capture=current(offer),catalog=createMightyHistoryCatalog(pageSource(capture.source,page));
   if(catalog.status!=='ready'){
    if(page!==0||offer.total!==1)throw Error('Changed public history catalog');
    const id='mighty:history-unavailable';admitted={revision:offer.revision,scope:offer.scope,entries:new Map(),unavailable:{id,message:catalog.message}};
    return {catalogId:offer.id,revision:offer.revision,page:0,total:1,pageSize:12,entries:[{id,title:'기록을 읽을 수 없어요',description:catalog.message}]};
   }
   if(catalog.page!==page||catalog.totalEntries!==offer.total)throw Error('Changed public history catalog');
   admitted={revision:offer.revision,scope:offer.scope,entries:new Map(catalog.entries.map(entry=>[entry.id,entry.selection]))};
   return {catalogId:offer.id,revision:offer.revision,page,total:catalog.totalEntries,pageSize:12,entries:catalog.entries.map(entry=>{
    const names=entry.names.join(' · '),session=catalog.sessions.find(session=>session.sessionId===entry.sessionId)!;
    return {id:entry.id,title:entry.title,...(names?{description:names.length>500?`${names.slice(0,499)}…`:names}:{}),group:{id:session.id,title:session.title}};
   })};
  },
  select(offer,entryId):DisclosureDocument {
   const capture=current(offer),page=admitted;
   if(!page||page.revision!==offer.revision||!sameScope(page.scope,offer.scope))throw Error('Unadmitted public history selection');
   if(page.unavailable?.id===entryId)return unavailable(entryId,page.unavailable.message);
   const selection=page.entries.get(entryId);if(!selection)throw Error('Unadmitted public history row');
   const selected=resolveMightyHistorySource(capture.source,selection);
   return selected.status==='selected'?createMightyHistoryDisclosure({entryId:selected.entryId,source:selected.source}):unavailable(entryId,selected.message);
  },
 };
}
