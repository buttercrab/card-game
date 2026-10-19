import type {SessionPort} from './contracts';
import type {DisclosureCatalogOffer} from './disclosures';
import type {DisclosureDocument} from './disclosureTypes';
import type {DisclosureIntent,DisclosureView} from './disclosureView';

type ReadPort=NonNullable<SessionPort<unknown>['disclosures']>;
export interface DisclosureControllerSource {readonly offers:readonly DisclosureCatalogOffer[];readonly port:ReadPort;}
/** Bounded viewer navigation only. The canonical session owns every read and
 * retained record; this controller never acquires a command capability. */
export function createDisclosureController({readCurrent}:{readCurrent:()=>DisclosureControllerSource|null}){
 let disposed=false,busy=false,epoch=0,serial=0;
 let pendingPort:ReadPort|undefined;
 let opened:{catalogId:string;title:string;port:ReadPort;leaseId:string;selected?:DisclosureDocument;pending?:import('./disclosureSession').DisclosurePendingRead;sectionId?:string;roundIndex:number;matrixStart:number}|undefined;
 const lease=()=>`disclosure:${++serial}`;
 function retire(){epoch++;opened=undefined;}
 function source(){return readCurrent();}
 function currentOffer(current:DisclosureControllerSource|null,id:string){return current?.offers.find(offer=>offer.id===id);}
 function capture(){const token=epoch,current=source();return !disposed&&epoch===token?current:null;}
 function sameOffer(before:DisclosureControllerSource,offer:DisclosureCatalogOffer):boolean{
  const token=epoch,after=source();return !disposed&&epoch===token&&after?.port===before.port&&JSON.stringify(currentOffer(after,offer.id))===JSON.stringify(offer);
 }
 function reconcile():DisclosureView|undefined{
  const active=opened,token=epoch;if(!active||disposed)return;
  const current=capture();if(!current||current.port!==active.port){if(epoch===token)retire();return;}
  const state=active.port.snapshot();if(disposed||epoch!==token||opened!==active)return;
  if(state.catalogId!==active.catalogId||(!state.page&&!state.selected&&!state.pending)){retire();return;}
  if(state.selected!==active.selected||state.pending!==active.pending){active.pending=state.pending;active.selected=state.selected;active.leaseId=lease();active.sectionId=state.selected?.sections[0]?.id;active.roundIndex=0;active.matrixStart=0;}
  return Object.freeze({leaseId:active.leaseId,catalogId:active.catalogId,title:active.title,...(state.selection?{selection:state.selection}:{}),canReturnToCatalog:!!state.page||!!currentOffer(current,active.catalogId),...(state.page?{page:state.page}:{}),...(state.selected?{selected:state.selected}:{}),...(state.pending?{pending:state.pending}:{}),...(active.sectionId?{sectionId:active.sectionId}:{}),roundIndex:active.roundIndex,matrixStart:active.matrixStart,...(state.error?{error:state.error}:{})});
 }
 function run(action:()=>boolean):boolean{if(disposed||busy)return false;busy=true;try{return action();}catch{return false;}finally{busy=false;}}
 function select(current:DisclosureControllerSource,offer:DisclosureCatalogOffer,entryId:string):boolean{
  const token=epoch,active=opened;if(!active||!sameOffer(current,offer)||epoch!==token)return false;
  const accepted=current.port.select(offer.id,entryId);if(!accepted||disposed||epoch!==token||opened!==active)return false;
  if(!sameOffer(current,offer)||epoch!==token)return false;
  const view=reconcile();return view?.selected?.entryId===entryId||view?.pending?.entryId===entryId;
 }
 function close(){const port=opened?.port??pendingPort;pendingPort=undefined;retire();port?.close();}
 return{
  open(catalogId:string):boolean{return run(()=>{
   const token=epoch,current=capture(),offer=currentOffer(current,catalogId);if(!current||!offer||disposed||epoch!==token)return false;
   // Unknown catalogs never close the viewer or trigger a provider read.
   close();if(disposed||epoch!==token+1)return false;
   const start=epoch;if(!sameOffer(current,offer)||epoch!==start)return false;
   pendingPort=current.port;
   const loaded=current.port.page(catalogId,0);
   if(!loaded||disposed||epoch!==start||!sameOffer(current,offer)||epoch!==start)return false;
   opened={catalogId,title:offer.title,port:current.port,leaseId:lease(),roundIndex:0,matrixStart:0};pendingPort=undefined;
   const view=reconcile();if(!view)return false;
   if(offer.total===1&&view.page?.entries.length===1){select(current,offer,view.page.entries[0].id);return !!reconcile();}
   return true;
  });},
  intent(intent:DisclosureIntent):boolean{return run(()=>{
   let view=reconcile();const active=opened;if(!view||!active||intent.leaseId!==view.leaseId)return false;
   if(intent.kind==='close'){close();return true;}
   if(intent.kind==='back'&&!view.selected&&!view.pending){close();return true;}
   const token=epoch,current=capture(),offer=currentOffer(current,view.catalogId);
   if(epoch!==token||opened!==active)return false;
   view=reconcile();if(!view||view.leaseId!==intent.leaseId||epoch!==token||opened!==active)return false;
   if(intent.kind==='back'){
    if(!active.port.deselect)return false;
    // A detached public detail remains readable even without a current list.
    // Acquire a fresh list before relinquishing that frozen record.
    if(!current||!offer||!sameOffer(current,offer)||epoch!==token||!active.port.page(offer.id,view.page?.page??0)||disposed||epoch!==token||opened!==active||!sameOffer(current,offer)||epoch!==token)return false;
    active.port.deselect();if(disposed||epoch!==token||opened!==active)return false;return !!reconcile();
   }
   if(intent.kind==='catalog-page'){
    if(view.selected||view.pending||!current||!offer||!Number.isSafeInteger(intent.page)||intent.page<0||intent.page>=Math.max(1,Math.ceil(offer.total/12))||!sameOffer(current,offer)||epoch!==token)return false;
    const accepted=active.port.page(offer.id,intent.page);return accepted&&!disposed&&epoch===token&&opened===active&&sameOffer(current,offer)&&epoch===token&&!!reconcile();
   }
   if(intent.kind==='entry'){
    if(view.selected||view.pending||!current||!offer||!view.page?.entries.some(entry=>entry.id===intent.entryId))return false;
    return select(current,offer,intent.entryId);
   }
   if(!('entryId' in intent)||!view.selected||intent.entryId!==view.selected.entryId)return false;
   if(intent.kind==='record-step'){
    if(!current||!offer||!view.page||(intent.direction!==-1&&intent.direction!==1))return false;
    const index=view.page.entries.findIndex(entry=>entry.id===intent.entryId);if(index<0)return false;
    const position=view.page.page*12+index+intent.direction;if(position<0||position>=offer.total)return false;
    let page=view.page;
    if(Math.floor(position/12)!==page.page){
     if(!sameOffer(current,offer)||epoch!==token||!active.port.page(offer.id,Math.floor(position/12))||disposed||epoch!==token||opened!==active||!sameOffer(current,offer)||epoch!==token)return false;
     const refreshed=reconcile();if(!refreshed?.page)return false;page=refreshed.page;
    }
    const entry=page.entries[position%12];return !!entry&&select(current,offer,entry.id);
   }
   const section=view.selected.sections.find(section=>section.id===intent.sectionId);if(!section)return false;
   if(intent.kind==='section'){active.sectionId=section.id;active.roundIndex=0;active.matrixStart=0;return true;}
   if(active.sectionId!==section.id)return false;
   if(intent.kind==='round'&&section.kind==='rounds'&&Number.isSafeInteger(intent.index)&&intent.index>=0&&intent.index<section.rounds.length){active.roundIndex=intent.index;return true;}
   if(intent.kind==='matrix-page'&&section.kind==='matrix'&&Number.isSafeInteger(intent.start)&&intent.start>=0&&intent.start<section.columns.length){active.matrixStart=intent.start;return true;}
   return false;
  });},
  snapshot():DisclosureView|undefined{if(disposed||busy)return;busy=true;try{return reconcile();}catch{retire();return;}finally{busy=false;}},
  close,
  dispose(){if(disposed)return;disposed=true;close();},
 };
}
