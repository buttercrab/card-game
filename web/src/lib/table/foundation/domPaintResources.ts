import {flushSync} from 'svelte';
import {mountPaintArtwork} from './artwork.svelte';
import type {ArtworkPaint} from './artworkPaint';
import type {PresentationFrame} from './contracts';
import type {FramePaintCard,FramePaintCollection} from './paintResources';
import {cloneTransferArtwork} from './cloneArtwork';
import {isRecycleAdmission,type RecycleAdmission} from './recycle';
import {resourceRecycledDealPlan} from './transferMotion';
export interface PublicPaintCohort {readonly collectionId:string;readonly entityIds:readonly string[];}
export interface PublicPaintLease {readonly entityIds:readonly string[];art(entityId:string,frame:PresentationFrame):SVGSVGElement|null;renew(frame:PresentationFrame):boolean;release():void;}
const scope=(frame:PresentationFrame)=>JSON.stringify([frame.context.session,frame.context.audience,frame.context.generation]);
const signature=(collection:FramePaintCollection,cards:readonly FramePaintCard[])=>JSON.stringify([collection.id,collection.purpose,collection.availability,collection.collectedBy,cards.map(card=>[card.entityId,card.ownerId,card.visual,card.emphasis])]);
/** One surface owns at most one bounded public art cohort. No private hand,
 * scene geometry, AX node, input or persistent hidden SVG is retained. */
export function createDomPaintResources(options:{current():PresentationFrame|null;mount?:(target:HTMLElement,paint:ArtworkPaint)=>{destroy():void};flush?:()=>void}){
 let epoch=0,disposed=false,active:PublicPaintLease|null=null;let neutralTemplate:SVGSVGElement|null=null;
 function cohort(frame:PresentationFrame,request:PublicPaintCohort){
  const resources=frame.paintResources;if(resources?.status!=='available'||!request.entityIds.length||request.entityIds.length>8||new Set(request.entityIds).size!==request.entityIds.length)return null;
  const collection=resources.collections.find(value=>value.id===request.collectionId&&value.availability==='current'&&value.purpose==='captured');if(!collection||collection.cards.length!==request.entityIds.length)return null;
  const cards=request.entityIds.map(id=>collection.cards.find(card=>card.entityId===id));if(cards.some(card=>!card||!['standard','joker'].includes(card.visual.kind)||!card.ownerId||!frame.rosterIds?.includes(card.ownerId))||new Set(cards.map(card=>card!.ownerId)).size!==cards.length)return null;
  return {collection,cards:cards as readonly FramePaintCard[]};
 }
 function render(paint:ArtworkPaint,token:number):SVGSVGElement|null{
  const scratch=document.createElement('div');let owner:{destroy():void}|undefined;
  try{owner=(options.mount??mountPaintArtwork)(scratch,paint);(options.flush??flushSync)();if(disposed||epoch!==token)return null;const svg=scratch.firstElementChild;if(!(svg instanceof SVGSVGElement))return null;return cloneTransferArtwork(svg);}catch{return null;}finally{try{owner?.destroy();}catch{/* Drain scratch even if native teardown fails. */}try{scratch.remove();}catch{}}
 }
 /** Borrowed detached paint only: no scope, count or authority is cached.
  * Every caller validates its current grant before reaching this function;
  * native consumers clone this template before mounting their transient art. */
 function neutralArt(frame:PresentationFrame):SVGSVGElement|null{
  if(neutralTemplate)return neutralTemplate;
  const token=epoch,art=render(Object.freeze({kind:'card',visual:Object.freeze({kind:'back'}),full:false}),token);
  if(!art||disposed||epoch!==token||options.current()!==frame){art?.remove();return null;}neutralTemplate=art;return art;
 }
 return {
  acquire(frame:PresentationFrame,request:PublicPaintCohort):PublicPaintLease|null{
   if(disposed||options.current()!==frame)return null;const selected=cohort(frame,request);if(!selected)return null;active?.release();const token=++epoch,basis=scope(frame),meaning=signature(selected.collection,selected.cards),art=new Map<string,SVGSVGElement>();let current=frame,released=false;
   const valid=(next:PresentationFrame)=>{if(released||disposed||epoch!==token||options.current()!==next||scope(next)!==basis)return false;const fresh=cohort(next,request);return !!fresh&&signature(fresh.collection,fresh.cards)===meaning;};
   const lease:PublicPaintLease=Object.freeze({entityIds:Object.freeze([...request.entityIds]),art(id:string,next:PresentationFrame){if(next!==current||!valid(next))return null;const card=selected.cards.find(card=>card.entityId===id);if(!card)return null;let svg=art.get(id);if(!svg){svg=render(Object.freeze({kind:'card',visual:card.visual,emphasis:card.emphasis,full:false}),token)??undefined;if(!svg||!valid(next)){svg?.remove();return null;}art.set(id,svg);}return svg;},renew(next:PresentationFrame){if(!valid(next))return false;current=next;return true;},release(){if(released)return;released=true;if(epoch===token)epoch++;for(const svg of art.values())svg.remove();art.clear();if(active===lease)active=null;}});active=lease;return lease;
  },
  neutral(frame:PresentationFrame,collectionId:string,availability:'current'|'next-deal'):SVGSVGElement|null{
   if(disposed||options.current()!==frame||frame.paintResources?.status!=='available')return null;const stock=frame.paintResources.collections.find(value=>value.id===collectionId&&value.availability===availability&&value.purpose==='stock'&&value.hiddenCount!==undefined&&value.hiddenCount>0&&!value.cards.length);if(!stock)return null;
   return neutralArt(frame);
  },
  /** A branded complete recycle admission may have dealt the stock down to zero.
   * The neutral art expresses only its conserved anonymous inventory. */
  recycle(frame:PresentationFrame,proof:RecycleAdmission):SVGSVGElement|null{
   if(disposed||options.current()!==frame||!isRecycleAdmission(proof)||frame.recycleAdmission!==proof||!resourceRecycledDealPlan(proof,frame).length)return null;
   return neutralArt(frame);
  },
  clear(){active?.release();epoch++;neutralTemplate?.remove();neutralTemplate=null;},dispose(){if(disposed)return;disposed=true;active?.release();epoch++;neutralTemplate?.remove();neutralTemplate=null;},resources:()=>Object.freeze({cohorts:Number(!!active),neutrals:Number(!!neutralTemplate)}),
 };
}
