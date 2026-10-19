import type {PresentationFrame,Rect} from './contracts';
import {participantHandoff,currentParticipantHandoff,participantIdentityStructure,type ParticipantHandoff} from './participantHandoff';
import {readyCompletionReceiveReservation,completionReceiveNativeProof,currentCompletionReceiveNativeProof,type CompletionReceiveNativeProof} from './completionReceive';
import type {PublicCompletionGrant} from './publicCompletion';
interface Witness {readonly element:HTMLElement;readonly parent:HTMLElement|null;readonly bounds:Rect;}
interface CompletionHandoff {
 readonly kind:'completion-own-hand';readonly participantId:string;readonly anchorId:string;readonly figureId:string;readonly regionId:'table-underlay';readonly bounds:Rect;readonly regionBounds:Rect;
 readonly native:CompletionReceiveNativeProof;readonly event:PublicCompletionGrant;readonly scope:string;readonly environment:string;readonly witnesses:readonly Witness[];readonly viewport:Rect;
}
export type NativeParticipantHandoff=ParticipantHandoff|CompletionHandoff;
export interface NativeParticipantPapers {readonly bounds:Rect;readonly regionBounds:Rect;readonly handoff:NativeParticipantHandoff;readonly candidates:readonly Rect[];}
const terminalProofs=new WeakSet<CompletionHandoff>();
const rect=(e:HTMLElement):Rect=>{const r=e.getBoundingClientRect();return Object.freeze({x:r.left,y:r.top,width:r.width,height:r.height});};
const equal=(a:Rect,b:Rect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const scope=(frame:PresentationFrame)=>JSON.stringify([frame.context.session,frame.context.audience,frame.context.generation,frame.rosterIds]);
/** Ordinary visible regions and a current branded terminal reservation are
 * distinct proof variants. Neither creates a hidden hand/paint node. */
export function nativeParticipantHandoff(frame:PresentationFrame,id:string,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,content:HTMLElement|null):NativeParticipantHandoff|null {
 try{
  const identity=participantIdentityStructure(frame,id);if(!identity)return null;
  // A completion-local participant must use its current ready reservation;
  // an injected ordinary hand cannot bypass the zero-input terminal contract.
  if(!frame.publicCompletion||!identity.local){const ordinary=participantHandoff(frame,id,host,elements,content);if(ordinary)return ordinary;}
  const reservation=readyCompletionReceiveReservation(frame);
  if(!identity?.local||identity.anchor.ownHandAnchor?.count!==0||!reservation||reservation.participantId!==identity.participantId||!frame.publicCompletion)return null;
  const native=completionReceiveNativeProof(frame,host,elements,content);if(!native||native.reservation!==reservation||!currentCompletionReceiveNativeProof(native,frame,host,elements,true)||readyCompletionReceiveReservation(frame)!==reservation)return null;
  const figure=elements.get(identity.figure.id);if(!figure||elements.get('table')?.parentElement!==content)return null;
  const witnesses:Witness[]=[],seen=new Set<HTMLElement>();
  for(const id of ['table','table-underlay',identity.identity.id,identity.core.id,identity.anchor.id,identity.figure.id]){const element=elements.get(id);if(!element)return null;for(let current:HTMLElement|null=element;current;current=current.parentElement){if(!seen.has(current)){seen.add(current);witnesses.push(Object.freeze({element:current,parent:current.parentElement,bounds:rect(current)}));}}}
  const result:CompletionHandoff=Object.freeze({kind:'completion-own-hand',participantId:identity.participantId,anchorId:identity.anchor.id,figureId:identity.figure.id,regionId:'table-underlay',bounds:rect(figure),regionBounds:native.regionBounds,native,event:frame.publicCompletion.event,scope:scope(frame),environment:JSON.stringify(frame.environment),witnesses:Object.freeze(witnesses),viewport:Object.freeze({x:0,y:0,width:innerWidth,height:innerHeight})});
  if(readyCompletionReceiveReservation(frame)!==reservation||!currentCompletionReceiveNativeProof(native,frame,host,elements,true))return null;terminalProofs.add(result);return result;
 }catch{return null;}
}
/** A newer publication needs its OWN ready reservation/native mapping. The old
 * basis only constrains compatible continuation and never supplies readiness. */
export function currentNativeParticipantHandoff(proof:NativeParticipantHandoff,frame:PresentationFrame,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,content:HTMLElement|null):boolean {
 if(proof.kind!=='completion-own-hand')return currentParticipantHandoff(proof,frame,host,elements,content);
 if(!terminalProofs.has(proof))return false;
 const current=nativeParticipantHandoff(frame,proof.anchorId,host,elements,content);return !!current&&current.kind==='completion-own-hand'&&current.event===proof.event&&current.participantId===proof.participantId&&current.scope===proof.scope&&current.environment===proof.environment&&equal(current.bounds,proof.bounds)&&equal(current.regionBounds,proof.regionBounds)&&equal(current.viewport,proof.viewport)&&current.witnesses.length===proof.witnesses.length&&current.witnesses.every((w,i)=>{const prior=proof.witnesses[i];return w.element===prior.element&&w.parent===prior.parent&&equal(w.bounds,prior.bounds);});
}
