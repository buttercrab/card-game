import {nativeParticipantHandoff,currentNativeParticipantHandoff,type NativeParticipantHandoff as ParticipantHandoff} from './nativeParticipantHandoff';
import {visiblePaperEndpoints} from './paperVisibility';
import {figurePaintBounds} from './figureArtworkMetrics';
import {createDomResourceTransfers,type ResourcePreparation} from './domResourceTransfers';
import {paperRect,paperEndpoints,paperTransform} from './paperEndpoints';
import type {FeedbackArrival,MotionSettlement} from './feedback';
import type { PresentationFrame, Rect } from './contracts';
import {transferTiming,sameTransferPresentation,transferHitTarget,transferProtectedTarget,transferReadableTarget,emptyCountAnchor,pairedCountFigure} from './transferPolicy';
import { motion } from '../../settings.svelte';
import { contains, flightPath, transferCandidates, recycledDealCandidates, ownCountLanding,resourceTransferPlan,resourceRecycledDealPlan } from './transferMotion';
import type {RecycleOrigin,PaintedRecycleOrigin} from './domRecycle';
import { SELECTION_EASING } from './selectionMotion';
const box = (rect: DOMRect): Rect => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const intersect = (a: Rect, b: Rect): Rect => ({ x: Math.max(a.x,b.x), y: Math.max(a.y,b.y), width: Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x), height: Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y) });
/** Bounded failure receipts contain classifications only, never card/actor IDs. */
function continuationReasons(before:PresentationFrame,next:PresentationFrame):readonly string[]{
 const reasons=new Set<string>(),same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 if(!same([before.context.session,before.context.audience,before.context.generation],[next.context.session,next.context.audience,next.context.generation]))reasons.add('scope');
 if(!same(before.environment,next.environment))reasons.add('environment');
 if(!same([before.deals,before.stockReturn,before.reveals],[next.deals,next.stockReturn,next.reveals]))reasons.add('transition');
 if(before.modalId||next.modalId)reasons.add('modal');
 const previous=new Map(before.nodes.map(node=>[node.id,node])),current=new Map(next.nodes.map(node=>[node.id,node]));
 const oldCards=before.nodes.filter(node=>node.kind==='card'),newCards=next.nodes.filter(node=>node.kind==='card');if(oldCards.length!==newCards.length)reasons.add('card-membership');
 for(const card of oldCards){const after=current.get(card.id);if(!after||after.kind!=='card'){reasons.add('card-membership');continue;}
  if(!same(card.box,after.box))reasons.add('card-box');if(!same(card.visual,after.visual))reasons.add('card-visual');if(!same(card.emphasis,after.emphasis))reasons.add('card-decoration');
  if(!same([card.entityId,card.ownerId,card.zoneId,card.stockCount,card.recipientId,card.recipientCount],[after.entityId,after.ownerId,after.zoneId,after.stockCount,after.recipientId,after.recipientCount]))reasons.add('card-binding');
  let parent=card.parent,other=after.parent;const seen=new Set<string>();while(parent||other){if(parent!==other||!parent||seen.has(parent)){reasons.add('card-ancestry');break;}seen.add(parent);const a=previous.get(parent),b=current.get(parent);if(!a||!b||!same([a.box,a.scroll,a.scrollAxis],[b.box,b.scroll,b.scrollAxis])){reasons.add('card-ancestry');break;}parent=a.parent;other=b.parent;}
 }
 return [...reasons].slice(0,8);
}
export {cloneTransferArtwork} from './cloneArtwork';
import {cloneTransferArtwork} from './cloneArtwork';
let concealSequence=0;
interface Pending { readonly entityId:string; readonly sourceId:string; readonly sourceRecipientId?:string; readonly destinationId: string; readonly sourceFan: string | null; readonly sourceZone: string; readonly destinationZone: string; readonly presentation: 'face' | 'back'; readonly from: Rect|null; readonly sourceLandmark?:Rect; readonly sourceProof?:readonly {id:string;element:HTMLElement}[]; readonly sourcePapers?:readonly Rect[];readonly sourceHandoff?:ParticipantHandoff; readonly currentOriginId?:string; readonly revealed?:true; readonly destinationArtwork?:true; readonly art: SVGSVGElement|null; readonly protectedBefore: readonly Rect[]; readonly protectedBeforeCounted?:readonly Rect[]; readonly countedLandingId?:string; readonly recycleOrigin?:PaintedRecycleOrigin; }
/** Surface-local exactly-once reporting. The coordinator independently checks
 * canonical event/frame scope; card identity alone is never an event key. */
export function createSettlementReporter(report:(value:MotionSettlement)=>void){
    let scope='',latestFrame=0;const consumed=new Set<string>();
    return (frame:PresentationFrame,event:FeedbackArrival,outcome:MotionSettlement['outcome'])=>{
        const next=JSON.stringify([frame.context.session,frame.context.audience,frame.context.generation,frame.feedbackScope?.roomEpoch,frame.feedbackScope?.connectionEpoch]);
        if(next!==scope&&frame.id<latestFrame)return;latestFrame=Math.max(latestFrame,frame.id);
        if(next!==scope){scope=next;consumed.clear();}
        if(consumed.has(event.eventId))return;consumed.add(event.eventId);
        while(consumed.size>256)consumed.delete(consumed.values().next().value!);
        try{report({frameId:frame.id,eventId:event.eventId,entityIds:event.entityIds,outcome});}catch{/* Feedback cannot interrupt publication or cleanup. */}
    };
}
const capturedPublicFace=(input:unknown):boolean=>{
 if(!input||typeof input!=='object'||Object.getOwnPropertySymbols(input).length)return false;const data=Object.getOwnPropertyDescriptors(input);if(Object.values(data).some(field=>!('value'in field)))return false;const kind=data.kind?.value;
 return kind==='standard'&&Object.keys(data).length===3&&!!data.suit&&!!data.rank&&['Spade','Heart','Club','Diamond'].includes(data.suit.value)&&Number.isInteger(data.rank.value)&&data.rank.value>=2&&data.rank.value<=14||kind==='joker'&&Object.keys(data).length===2&&!!data.color&&['Black','Red'].includes(data.color.value);
};
const capturedResourceKeys=new Set(['id','parent','kind','label','accessibleDescription','box','visual','emphasis','entityId','ownerId','zoneId','collectionPurpose','inert','tone','deemphasized']);
const readonlyCapturedResource=(node:import('./contracts').PlannedNode)=>Object.keys(node).every(key=>capturedResourceKeys.has(key)||node[key as keyof typeof node]===undefined);
export interface PublicCapturedCohort {readonly zoneId:string;readonly cards:readonly {readonly id:string;readonly entityId:string;readonly ownerId:string}[];}
export type PublicCapturedRefusal='cohort-shape'|'membership'|'owner'|'front-schema'|'unknown-paint-key'|'native-detached'|'native-parent'|'stamp'|'svg';
export type PublicCapturedArtworkResult={readonly ok:true;readonly resource:{readonly art:SVGSVGElement;readonly element:HTMLElement}}|{readonly ok:false;readonly reason:PublicCapturedRefusal};
/** A root-clipped, noninteractive transient layer. Never advances canonical state. */
export function createDomTransfers(host: HTMLElement,report:(value:MotionSettlement)=>void=()=>{},conceal?:(frameId:number,nodeIds:readonly string[],owner:string)=>boolean,onIdle:()=>void=()=>{},options:{content?:()=>HTMLElement|null;hidden?:(frame:PresentationFrame)=>ReadonlySet<string>;owner?:()=>string|null;concealed?:(nodeId:string)=>boolean;recycleCurrent?:(origin:RecycleOrigin,frame:PresentationFrame)=>boolean;current?:()=>PresentationFrame|null;paint?:{neutral(frame:PresentationFrame,id:string,availability:'current'|'next-deal'):SVGSVGElement|null}}={}) {
    const settle=createSettlementReporter(report);
    interface Item { entityId:string; animation?: Animation; target: SVGSVGElement|HTMLElement; art: SVGSVGElement; destinationId:string; countedLandingId?:string; to:Rect;path:readonly Rect[]; }
    interface Batch { handoffs:readonly ParticipantHandoff[];endpointProofs:readonly {id:string;box:Rect;ids:readonly string[];elements:readonly HTMLElement[]}[];maskOwner?:string;maskFrameId:number;concealed:boolean;fallbackIds:ReadonlySet<string>; arrivals:readonly FeedbackArrival[]; overlay: HTMLElement; items: Set<Item>; suppressed: Map<SVGSVGElement|HTMLElement,number>;frame:PresentationFrame;clip:Rect;exclusions:ReadonlySet<string>;resume:Set<Animation>;elements:ReadonlyMap<string,HTMLElement>;origins:readonly {id:string;art:SVGSVGElement;box:Rect}[];recycleOrigin?:PaintedRecycleOrigin; }
    let active: Batch | null = null,resumePending=false;let resourceTransfers:ReturnType<typeof createDomResourceTransfers>|undefined;
    const restore=(batch:Batch,target:SVGSVGElement|HTMLElement)=>{
        if([...batch.elements].some(([id,element])=>(element.firstElementChild===target||element===target)&&!options.concealed?.(id)))target.style.opacity='';
    };
    const releaseMask=(batch:Batch)=>{if(!batch.concealed||!batch.maskOwner)return;batch.concealed=false;try{conceal?.(batch.maskFrameId,[],batch.maskOwner);}catch{/* Cleanup remains scoped; never resurrect a retired batch. */}};
    const clearVisible = (reason='explicit',target?:EventTarget|null) => {
        resumePending=false;const batch=active;active=null;if(!batch)return;
        host.dataset.foundationFlightClear=JSON.stringify({frame:batch.frame.id,reason,target:target instanceof HTMLElement?{kind:target.dataset.foundationKind??'native',scroll:!!batch.frame.nodes.find(node=>node.id===target.dataset.foundationNode)?.scroll,region:target.dataset.foundationNode==='table-sidebar'?'control-rail':target.dataset.foundationNode==='table'?'root':target.dataset.foundationNode==='table-viewport'?'arena':'other'}:null});
        for(const item of batch.items)item.animation?.cancel();
        for(const target of batch.suppressed.keys())restore(batch,target);
        batch.suppressed.clear();batch.overlay.remove();batch.items.clear();
        releaseMask(batch);
        for(const event of batch.arrivals)settle(batch.frame,event,'revoked');
        queueMicrotask(onIdle);
    };

    const clear=(reason='explicit',target?:EventTarget|null)=>{resourceTransfers?.clear();clearVisible(reason,target);};
    const endpointExclusions=(frame:PresentationFrame,id:string,elements:ReadonlyMap<string,HTMLElement>,expected?:Rect):ReadonlySet<string>=>{
        const anchor=frame.nodes.find(node=>node.id===id),element=elements.get(id),result=new Set<string>();
        if(!anchor||!emptyCountAnchor(anchor)||!element||element.dataset.foundationFrame!==String(frame.id))return result;
        const bounds=box(element.getBoundingClientRect());if(expected&&!same(bounds,expected)||!visible(element,bounds)||destinationVisibility(element,bounds,intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight}))!=='visible')return result;
        result.add(id);
        const figure=pairedCountFigure(anchor,frame.nodes),paint=figure?elements.get(figure.id):undefined;
        if(figure&&paint?.dataset.foundationFrame===String(frame.id)&&same(box(paint.getBoundingClientRect()),bounds))result.add(figure.id);
        return result;
    };
    const decisionRects=new WeakSet<object>(),protectedNodes=new WeakMap<object,string>();
    const hiddenLane=(next:PresentationFrame)=>options.hidden?.(next)??new Set<string>();
    const beforeBoxes=(rects:readonly Rect[],next:PresentationFrame,currentRects:readonly Rect[])=>{
        const painted=new Map<string,Rect[]>(),hidden=hiddenLane(next).size>0;
        for(const rect of currentRects){const id=protectedNodes.get(rect);if(id)painted.set(id,[...(painted.get(id)??[]),rect]);}
        // The old DOM has been patched. Only a still-painted, unchanged native
        // footprint can remain an obstacle; moved/new paint is protectedAfter.
        return rects.filter(rect=>{if(hidden&&decisionRects.has(rect))return false;const id=protectedNodes.get(rect);return !!id&&!!painted.get(id)?.some(current=>rect.x===current.x&&rect.y===current.y&&rect.width===current.width&&rect.height===current.height);});
    };
    const textPaintBounds=(element:HTMLElement):readonly Rect[]=>{
        const fallback=()=>[box(element.getBoundingClientRect())];
        if(typeof document.createRange!=='function')return fallback();
        try{
            const range=document.createRange();range.selectNodeContents(element);
            const rects=range.getClientRects();
            // Keep the bounded, conservative fallback for unsupported or
            // unexpectedly fragmented content rather than dropping any paint.
            if(rects.length>64)return fallback();
            return Array.from(rects).map(box).filter(rect=>rect.width>0&&rect.height>0);
        }catch{return fallback();}
    };
    const unpaintedCountAnchor=(frame:PresentationFrame,node:import('./contracts').PlannedNode,elements:ReadonlyMap<string,HTMLElement>):boolean=>{
        if(!emptyCountAnchor(node)||!pairedCountFigure(node,frame.nodes))return false;
        const element=elements.get(node.id);if(!element||element.firstElementChild||element.textContent||endpointExclusions(frame,node.id,elements).size!==2)return false;
        const css=getComputedStyle(element);return (!css.backgroundImage||css.backgroundImage==='none')&&(!css.backgroundColor||['transparent','rgba(0, 0, 0, 0)'].includes(css.backgroundColor))&&(!css.boxShadow||css.boxShadow==='none')&&[css.borderTopWidth,css.borderRightWidth,css.borderBottomWidth,css.borderLeftWidth].every(value=>!value||value==='0px');
    };
    const participantPaintBounds=(node:import('./contracts').PlannedNode,element:HTMLElement):Rect=>{
        const glyphs=node.clockPaint?Array.from(element.querySelectorAll('[data-clock-seconds]')).filter(glyph=>!!glyph.textContent).map(glyph=>box(glyph.getBoundingClientRect())).filter(rect=>rect.width>0&&rect.height>0):[];
        return figurePaintBounds(box(element.getBoundingClientRect()),!!node.clockPaint,glyphs);
    };
    const protectedBoxes = (frame: PresentationFrame, elements: ReadonlyMap<string,HTMLElement>, except: ReadonlySet<string>, current = frame): Rect[] => {const hidden=hiddenLane(current);return frame.nodes.flatMap(node => {
        if (hidden.has(node.id)||except.has(node.id)&&node.kind!=='figure' || !transferProtectedTarget(node)||unpaintedCountAnchor(frame,node,elements)) return [];
        if (transferHitTarget(node) && !transferReadableTarget(node) && !current.nodes.some(next=>next.id===node.id && next.enabled)) return [];
        const element = elements.get(node.id); if (!element) return [];
        const clips:Rect[]=[{x:0,y:0,width:innerWidth,height:innerHeight}];
        for(let parent=element.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)){const rect=parent.getBoundingClientRect();clips.push({x:rect.left+parent.clientLeft,y:rect.top+parent.clientTop,width:parent.clientWidth,height:parent.clientHeight});}}
        return (node.kind==='text'?textPaintBounds(element):[node.kind==='figure'?participantPaintBounds(node,element):box(element.getBoundingClientRect())]).flatMap(paint=>{
            const bounds=clips.reduce(intersect,paint);if(bounds.width<=0||bounds.height<=0)return [];
            // Native focus/pulse clearance is unchanged. Text starts from the
            // actual line boxes, not unused width in a measured allocation.
            const pulse = node.kind === 'choice' ? Math.max(1,frame.environment.controls.choice.pulse) : 1;
            const dx=6+bounds.width*(pulse-1)/2,dy=6+bounds.height*(pulse-1)/2;
            const result={x:bounds.x-dx,y:bounds.y-dy,width:bounds.width+dx*2,height:bounds.height+dy*2,protectedFrame:frame.id,purpose:node.assistanceIntent?.kind==='toggle-reactions'?'reaction-tool':node.assistanceIntent?.kind==='tool'?'advice-tool':node.kind};protectedNodes.set(result,node.id);
            let ancestor:typeof node|undefined=node;const visited=new Set<string>();while(ancestor&&!visited.has(ancestor.id)){if(ancestor.id===frame.decisionLaneId){decisionRects.add(result);break;}visited.add(ancestor.id);ancestor=frame.nodes.find(parent=>parent.id===ancestor!.parent);}return [result];
        });
    });};
    function visible(element: Element, bounds: Rect): boolean {
        let parent = element.parentElement;
        while (parent) {
            const css = getComputedStyle(parent);
            // Current proof supports translation-free ancestor coordinate spaces.
            if ((css.zoom !== '1' && css.zoom !== 'normal') || css.transform !== 'none' || css.perspective !== 'none' || css.scale !== 'none' || css.rotate !== 'none' || css.translate !== 'none') return false;
            if (/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)) {
                const rect = parent.getBoundingClientRect();
                if (!contains({ x:rect.left+parent.clientLeft,y:rect.top+parent.clientTop,width:parent.clientWidth,height:parent.clientHeight },bounds)) return false;
            }
            parent = parent.parentElement;
        }
        return true;
    }
    function destinationVisibility(element:Element,bounds:Rect,clip:Rect):'visible'|'clipped'|'unsupported'{
        if(![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)return 'unsupported';
        let clipped=!contains(clip,bounds);
        for(let parent=element.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(css.zoom!=='1'&&css.zoom!=='normal'||css.transform!=='none'||css.perspective!=='none'||css.scale!=='none'||css.rotate!=='none'||css.translate!=='none')return 'unsupported';if(/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)){const rect=parent.getBoundingClientRect();if(!contains({x:rect.left+parent.clientLeft,y:rect.top+parent.clientTop,width:parent.clientWidth,height:parent.clientHeight},bounds))clipped=true;}}
        return clipped?'clipped':'visible';
    }
    function currentGeometry(batch:Batch,next:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>):boolean {
        if(batch.recycleOrigin&&options.recycleCurrent?.(batch.recycleOrigin,next)!==true)return false;
        const clip=intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight});
        const near=(a:Rect,b:Rect)=>['x','y','width','height'].every(key=>Math.abs(a[key as keyof Rect]-b[key as keyof Rect])<.1);
        if(!near(clip,batch.clip))return false;
        for(const origin of batch.origins){const element=elements.get(origin.id),bounds=box(origin.art.getBoundingClientRect());if(element?.dataset.foundationFrame!==String(next.id)||element.firstElementChild!==origin.art||!visible(origin.art,bounds)||!near(bounds,origin.box))return false;}
        for(const proof of batch.handoffs)if(!currentNativeParticipantHandoff(proof,next,host,elements,options.content?.()??null))return false;
        for(const proof of batch.endpointProofs)if(!same([...endpointExclusions(next,proof.id,elements,proof.box)],proof.ids)||proof.ids.some((id,index)=>elements.get(id)!==proof.elements[index]))return false;
        const protectedAfter=protectedBoxes(next,elements,batch.exclusions),checked=new Map<SVGSVGElement|HTMLElement,boolean>();
        for(const item of batch.items){
            const element=elements.get(item.destinationId);
            if(!next.nodes.some(node=>node.id===item.destinationId&&(node.kind==='card'||node.kind==='group'&&node.inert===true&&node.recipientId!==undefined)&&(!item.countedLandingId||node.entityId===item.entityId))||element?.dataset.foundationFrame!==String(next.id)||element.firstElementChild!==item.target&&element!==item.target)return false;
            if(item.countedLandingId){if(!next.nodes.some(node=>node.id===item.countedLandingId&&ownCountLanding(node)))return false;}
            else if(!checked.has(item.target)){const bounds=box(item.target.getBoundingClientRect());checked.set(item.target,visible(item.target,bounds)&&(item.target instanceof SVGSVGElement?near(paperRect(bounds),item.to):contains(bounds,item.to)));}
            if(!item.countedLandingId&&!checked.get(item.target)||!flightPath(item.path[0],item.path.at(-1)!,clip,protectedAfter))return false;
        }
        return true;
    }
    const participantPapers=(frame:PresentationFrame,id:string,elements:ReadonlyMap<string,HTMLElement>,reference:Rect,exclusions:ReadonlySet<string>=new Set(),minimum=.4,maximum=1.6,opposites?:readonly Rect[]):{bounds:Rect;regionBounds:Rect;handoff:ParticipantHandoff;candidates:readonly Rect[]}|null=>{
        const handoff=nativeParticipantHandoff(frame,id,host,elements,options.content?.()??null);if(!handoff)return null;
        // Figure, clock, name and status remain painted obstacles even if the
        // semantic count proof's IDs occur in the caller's exclusion set.
        const guards=protectedBoxes(frame,elements,exclusions),clip=intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight});
        const candidates=opposites?visiblePaperEndpoints(handoff.regionBounds,reference,clip,guards,opposites,minimum,maximum):null;
        return {bounds:handoff.bounds,regionBounds:handoff.regionBounds,handoff,candidates:candidates?(candidates.kind==='ready'?candidates.candidates:[]):paperEndpoints(handoff.regionBounds,reference,clip,guards,minimum,maximum)};
    };
    function publicCapturedArtworkResult(frame:PresentationFrame,nodeId:string,elements:ReadonlyMap<string,HTMLElement>,cohort:PublicCapturedCohort):PublicCapturedArtworkResult {
        const refuse=(reason:PublicCapturedRefusal):PublicCapturedArtworkResult=>({ok:false,reason});
        if(!cohort.zoneId||cohort.zoneId==='hand'||cohort.cards.length<2||cohort.cards.length>8||new Set(cohort.cards.map(card=>card.id)).size!==cohort.cards.length||new Set(cohort.cards.map(card=>card.entityId)).size!==cohort.cards.length||new Set(cohort.cards.map(card=>card.ownerId)).size!==cohort.cards.length)return refuse('cohort-shape');
        const cards=frame.nodes.filter(node=>node.kind==='card'&&node.zoneId===cohort.zoneId);
        if(cards.length!==cohort.cards.length)return refuse('membership');
        for(const node of cards){const member=cohort.cards.find(card=>card.id===node.id&&card.entityId===node.entityId);if(!member||node.collectionPurpose!=='captured'||!node.entityId)return refuse('membership');if(node.ownerId!==member.ownerId||!node.ownerId||!frame.rosterIds?.includes(node.ownerId))return refuse('owner');if(!capturedPublicFace(node.visual))return refuse('front-schema');if(!readonlyCapturedResource(node))return refuse('unknown-paint-key');}
        const node=cards.find(node=>node.id===nodeId),element=elements.get(nodeId),art=element?.firstElementChild;
        if(!node)return refuse('membership');if(!element||!element.isConnected||!host.contains(element))return refuse('native-detached');
        if(element.dataset.foundationFrame!==String(frame.id)||element.dataset.foundationNode!==nodeId)return refuse('stamp');
        // Resource availability does not require visible geometry, but it
        // still requires the publisher's exact current attached ancestry.
        // A canonical card can never be a naked root mounted under the host.
        if(!node.parent||frame.nodes.length>4096)return refuse('native-parent');
        const index=new Map(frame.nodes.map(node=>[node.id,node]));if(index.size!==frame.nodes.length)return refuse('native-parent');
        const content=options.content?.()??null;if(!content||content.className!=='foundation-content'||content.parentElement!==host||!content.isConnected||Array.from(host.children).filter(child=>child.className==='foundation-content').length!==1)return refuse('native-parent');
        const seen=new Set<string>();let current:typeof node|undefined=node;
        while(current){
            if(seen.has(current.id))return refuse('native-parent');seen.add(current.id);
            const owned=elements.get(current.id);if(!owned||!owned.isConnected||!host.contains(owned)||owned.dataset.foundationFrame!==String(frame.id)||owned.dataset.foundationNode!==current.id)return refuse('native-parent');
            if(current.parent===null){if(current.id!=='table'||current.kind!=='group'||owned.parentElement!==content)return refuse('native-parent');break;}
            const parent=index.get(current.parent),parentElement=elements.get(current.parent);if(!parent||!parentElement||owned.parentElement!==parentElement)return refuse('native-parent');current=parent;
        }
        if(!(art instanceof SVGSVGElement)||art.parentElement!==element||!art.isConnected||art.hasAttribute('data-card-back'))return refuse('svg');return {ok:true,resource:{art,element}};
    }
    const port={
        /** Internal staging seam: exactly the native guard/clip recipe used by
         * ordinary transfers. The caller supplies only validated endpoint IDs. */
        endpointExclusions,participantPapers,
        handoffCurrent:(proof:ParticipantHandoff,frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>)=>currentNativeParticipantHandoff(proof,frame,host,elements,options.content?.()??null),
        geometry(frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>,exclusions:ReadonlySet<string>=new Set()):{clip:Rect;protectedRects:readonly Rect[]}|null {
            const clip=intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight});
            if(![clip.x,clip.y,clip.width,clip.height].every(Number.isFinite)||clip.width<=0||clip.height<=0)return null;
            for(const node of frame.nodes){if(node.kind!=='figure'||!node.clockPaint)continue;const element=elements.get(node.id);if(!element||element.dataset.foundationFrame!==String(frame.id))return null;const paint=participantPaintBounds(node,element);if(!visible(element,paint)||destinationVisibility(element,paint,clip)!=='visible')return null;}
            return {clip,protectedRects:protectedBoxes(frame,elements,exclusions)};
        },
        bounds(frame:PresentationFrame,nodeId:string,elements:ReadonlyMap<string,HTMLElement>):Rect|null {
            const element=elements.get(nodeId);if(!frame.nodes.some(node=>node.id===nodeId)||element?.dataset.foundationFrame!==String(frame.id))return null;
            const bounds=box(element.getBoundingClientRect()),clip=intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight});
            return bounds.width>0&&bounds.height>0&&visible(element,bounds)&&contains(clip,bounds)?bounds:null;
        },
        /** Public resources are distinct from visible geometry. Intentional
         * essential/staged concealment and overflow never grant private faces. */
        publicCapturedArtworkResult,
        publicCapturedArtwork(frame:PresentationFrame,nodeId:string,elements:ReadonlyMap<string,HTMLElement>,cohort:PublicCapturedCohort):{art:SVGSVGElement;element:HTMLElement}|null {
            const result=publicCapturedArtworkResult(frame,nodeId,elements,cohort);return result.ok?result.resource:null;
        },
        artwork(frame:PresentationFrame,nodeId:string,elements:ReadonlyMap<string,HTMLElement>):{art:SVGSVGElement;box:Rect}|null {
            const node=frame.nodes.find(node=>node.id===nodeId),element=elements.get(nodeId),art=element?.firstElementChild;
            if(node?.kind!=='card'||element?.dataset.foundationFrame!==String(frame.id)||!(art instanceof SVGSVGElement))return null;
            const bounds=box(art.getBoundingClientRect()),clip=intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight});
            return bounds.width>0&&bounds.height>0&&visible(art,bounds)&&contains(clip,bounds)?{art,box:bounds}:null;
        },
        clear,
        cancelRecycle(owner:string){resourceTransfers?.cancelRecycle(owner);if(active?.recycleOrigin?.owner===owner)clear('recycle-revoked');},
        suspend(){resourceTransfers?.suspend();const batch=active;if(!batch)return;for(const item of batch.items)if(item.animation&&item.animation.playState==='running'){batch.resume.add(item.animation);item.animation.pause();}},
        listen() {
            const cancel = (event:Event) => {
                // A sibling native control rail may scroll as focus is restored.
                // Keep no stale geometry: every retained SVG identity, endpoint,
                // clip and current protected straight path is rechecked now.
                const batch=active;
                if(event.type==='scroll'&&(batch&&motion.level==='full'&&currentGeometry(batch,batch.frame,batch.elements)||resourceTransfers?.revalidate()))return;
                clear(event.type,event.target);
            };
            const preference = matchMedia('(prefers-reduced-motion: reduce)');
            const changed = () => { if (motion.level !== 'full' || preference.matches) clear(); };
            const observer = new MutationObserver(changed);
            observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
            window.addEventListener('resize',cancel);
            document.addEventListener('scroll',cancel,true);
            preference.addEventListener('change',changed);
            return () => { observer.disconnect(); window.removeEventListener('resize',cancel); document.removeEventListener('scroll',cancel,true); preference.removeEventListener('change',changed); clear(); };
        },
        prepare(previous: PresentationFrame | null, next: PresentationFrame, elements: ReadonlyMap<string,HTMLElement>): readonly Pending[]|ResourcePreparation {
            const resource=resourceTransfers?.prepare(previous,next,elements,resourceTransferPlan(previous,next));if(resource){clearVisible();return resource;}
            if(active&&motion.level==='full'&&sameTransferPresentation(active.frame,next)){resumePending=true;return [];}
            if(active)host.dataset.foundationFlightInvalidation=JSON.stringify({from:active.frame.id,to:next.id,reasons:continuationReasons(active.frame,next)});
            const candidates = motion.level === 'full' ? transferCandidates(previous,next) : [];
            const recipientLandings=candidates.filter(candidate=>candidate.destination.recipientId!==undefined&&previous?.nodes.some(node=>node.id===candidate.destination.id&&node.recipientId===candidate.destination.recipientId)).map(candidate=>candidate.destination.id);
            const exclusions = new Set([...candidates.map(candidate=>candidate.source.id),...recipientLandings,...candidates.flatMap(candidate=>previous?[...endpointExclusions(previous,candidate.source.id,elements)]:[])]);
            const sourceFans=new Set(candidates.map(candidate=>candidate.source.parent).filter(parent=>previous?.nodes.some(node=>node.id===parent&&node.arrangement==='fan')));
            for(const node of previous?.nodes??[])if(node.kind==='card'&&sourceFans.has(node.parent))exclusions.add(node.id);
            const destinationFans=new Set(candidates.map(candidate=>candidate.destination.parent).filter(parent=>next.nodes.some(node=>node.id===parent&&node.arrangement==='fan')));
            for(const node of previous?.nodes??[])if(node.kind==='card'&&destinationFans.has(node.parent))exclusions.add(node.id);
            delete host.dataset.foundationFlightGeometry;
            host.dataset.foundationFlightStatus = candidates.length ? 'candidate' : previous&&previous.environment.revision!==next.environment.revision?'environment-changed':'no-transfer';
            const protectedBefore=previous&&candidates.some(candidate=>candidate.origin!=='current')?protectedBoxes(previous,elements,exclusions,next):[];
            const countedExclusions=new Set(candidates.flatMap(candidate=>[(candidate.artifactSource??candidate.source).id,...recipientLandings,...(candidate.countedLanding?[candidate.countedLanding.id]:[])]));
            if(previous)for(const candidate of candidates)if(candidate.countedLanding)for(const id of endpointExclusions(previous,candidate.countedLanding.id,elements))countedExclusions.add(id);
            const protectedBeforeCounted=previous&&candidates.some(candidate=>candidate.countedLanding&&candidate.origin!=='current')?protectedBoxes(previous,elements,countedExclusions,next):[];
            const origins=new Map<SVGSVGElement,Rect|null>();
            const pending: Pending[] = [];
            for(const candidate of candidates){
                if(candidate.revealed||candidate.source.kind==='group'&&candidate.source.inert===true&&candidate.source.recipientId!==undefined){
                    const element=elements.get(candidate.source.id),bounds=element?box(element.getBoundingClientRect()):null;
                    const sourceHandoff=previous?nativeParticipantHandoff(previous,candidate.source.id,host,elements,options.content?.()??null):null;
                    if(previous&&(candidate.source.kind!=='group'||!!sourceHandoff)&&element?.dataset.foundationFrame===String(previous.id)&&bounds&&destinationVisibility(element,bounds,{x:0,y:0,width:innerWidth,height:innerHeight})==='visible')pending.push({entityId:candidate.entityId,sourceId:candidate.source.id,sourceRecipientId:candidate.source.recipientId,destinationId:candidate.destination.id,sourceFan:null,sourceZone:'anonymous-hand',destinationZone:candidate.destination.zoneId??'',presentation:candidate.presentation,...(candidate.revealed?{revealed:true as const}:{}),destinationArtwork:true,from:bounds,sourceLandmark:bounds,...(sourceHandoff?{sourceHandoff}:{}),sourceProof:[...endpointExclusions(previous,candidate.source.id,elements,bounds)].map(id=>({id,element:elements.get(id)!})),sourcePapers:participantPapers(previous,candidate.source.id,elements,candidate.destination.box,exclusions)?.candidates??(candidate.source.kind==='card'?[paperRect(bounds)]:[]),art:null,protectedBefore});
                    continue;
                }
                const currentOrigin=candidate.origin==='current',artifactNode=currentOrigin?candidate.artifactSource:candidate.source;
                const artifact=artifactNode?elements.get(artifactNode.id):undefined,source=artifact?.firstElementChild;
                if(currentOrigin){
                    if(!previous||artifactNode?.visual?.kind!=='back'||artifact?.dataset.foundationFrame!==String(previous.id)||!(source instanceof SVGSVGElement)||!source.hasAttribute('data-card-back'))continue;
                    pending.push({entityId:candidate.entityId,sourceId:candidate.source.id,...(candidate.source.recipientId!==undefined?{sourceRecipientId:candidate.source.recipientId}:{}),destinationId:candidate.destination.id,sourceFan:null,sourceZone:candidate.source.zoneId??'',destinationZone:candidate.destination.zoneId??'',presentation:'back',from:null,currentOriginId:candidate.source.id,art:cloneTransferArtwork(source),protectedBefore:[],...(candidate.countedLanding?{countedLandingId:candidate.countedLanding.id,protectedBeforeCounted:[]}:{} )});
                    continue;
                }
                if(source instanceof SVGSVGElement&&!origins.has(source)){const bounds=box(source.getBoundingClientRect());origins.set(source,visible(source,bounds)?bounds:null);}
                const bounds=source instanceof SVGSVGElement?origins.get(source):null;
                if(previous && source instanceof SVGSVGElement && bounds&&artifact?.dataset.foundationFrame===String(previous.id)) pending.push({entityId:candidate.entityId,sourceId:candidate.source.id,...(candidate.source.recipientId!==undefined?{sourceRecipientId:candidate.source.recipientId}:{}),destinationId:candidate.destination.id,sourceFan:sourceFans.has(candidate.source.parent)?candidate.source.parent:null,sourceZone:candidate.source.zoneId??'anonymous-hand',destinationZone:candidate.destination.zoneId??'',presentation:candidate.presentation,from:bounds,...(candidate.source.zoneId==='hand'&&candidate.destination.collectionPurpose==='play'&&candidate.presentation==='face'?{art:null,destinationArtwork:true}:{art:cloneTransferArtwork(source)}),protectedBefore,...(candidate.countedLanding&&source.hasAttribute('data-card-back')&&artifact?.dataset.foundationFrame===String(previous.id)?{countedLandingId:candidate.countedLanding.id,protectedBeforeCounted}:{})});
            }
            clear();
            if(pending.length!==candidates.length){host.dataset.foundationFlightStatus='source-clipped-or-transformed';return [];}
            return pending;
        },
        recycled(origin:RecycleOrigin,next:PresentationFrame):readonly Pending[]|ResourcePreparation{
            if(motion.level!=='full'||options.recycleCurrent?.(origin,next)!==true)return [];
            if(origin.kind==='resource')return resourceTransfers?.recycled(next,resourceRecycledDealPlan(origin.proof,next),origin.art,origin.owner)??[];
            const candidates=recycledDealCandidates(origin.proof,next);
            return candidates.map(candidate=>({entityId:candidate.entityId,sourceId:candidate.source.id,...(candidate.source.recipientId!==undefined?{sourceRecipientId:candidate.source.recipientId}:{}),destinationId:candidate.destination.id,sourceFan:null,sourceZone:origin.proof.source,destinationZone:candidate.destination.zoneId??'',presentation:'back',from:origin.box,art:cloneTransferArtwork(origin.art),protectedBefore:[],currentOriginId:undefined,...(candidate.countedLanding?{countedLandingId:candidate.countedLanding.id}:{}),recycleOrigin:origin}));
        },
        play(pending: readonly Pending[]|ResourcePreparation, next: PresentationFrame, elements: ReadonlyMap<string,HTMLElement>) {
            if(resourceTransfers?.owns(pending)){resourceTransfers.play(pending,next,elements);return;}
            pending=pending as readonly Pending[];
            if(resumePending&&active){
                resumePending=false;const batch=active;
                if(motion.level!=='full'||!sameTransferPresentation(batch.frame,next)||!currentGeometry(batch,next,elements)){host.dataset.foundationFlightInvalidation=JSON.stringify({from:batch.frame.id,to:next.id,reasons:continuationReasons(batch.frame,next).length?continuationReasons(batch.frame,next):['native-target-or-hit-path']});clear();host.dataset.foundationFlightStatus='continuation-changed';return;}
                if(batch.maskOwner&&batch.concealed){batch.maskFrameId=next.id;let accepted=false;try{accepted=conceal?.(next.id,[...batch.fallbackIds],batch.maskOwner)===true;}catch{}if(active!==batch)return;if(!accepted||!currentGeometry(batch,next,elements)){clear('conceal-renewal-refused');return;}}
                batch.frame=next;batch.elements=elements;batch.arrivals=[...batch.arrivals,...(next.feedbackArrivals??[]).filter(event=>!batch.arrivals.some(known=>known.eventId===event.eventId)&&event.entityIds.some(id=>[...batch.items].some(item=>item.entityId===id)))];for(const target of batch.suppressed.keys())target.style.opacity='0';for(const animation of batch.resume)if([...batch.items].some(item=>item.animation===animation))animation.play();batch.resume.clear();host.dataset.foundationFlightStatus='continuing';return;
            }
            if (!pending.length || motion.level !== 'full') return;
            const clip=intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight});
            const destinations=new Map<SVGSVGElement|HTMLElement,{box:Rect;visible:boolean;clipped:boolean}>(),currentOrigins=new Map<string,Rect|null>();
            const targets=new Map<string,SVGSVGElement|HTMLElement>();let needsCounted=false;
            for(const item of pending){
                if(item.sourceHandoff&&!currentNativeParticipantHandoff(item.sourceHandoff,next,host,elements,options.content?.()??null)){host.dataset.foundationFlightStatus='source-replaced-or-moved';return;}
                if(item.sourceProof?.length&&(item.sourceProof.some(proof=>elements.get(proof.id)!==proof.element)||!same([...endpointExclusions(next,item.sourceId,elements,item.sourceLandmark)],item.sourceProof.map(proof=>proof.id)))){host.dataset.foundationFlightStatus='source-replaced-or-moved';return;}
                const node=next.nodes.find(node=>node.id===item.destinationId),element=elements.get(item.destinationId),target=node?.kind==='group'&&node.inert===true&&node.recipientId!==undefined?element:element?.firstElementChild;
                if(!(target instanceof SVGSVGElement)&&!(target instanceof HTMLElement))return;
                if(item.destinationArtwork&&item.sourceZone==='hand'&&element?.dataset.foundationFrame!==String(next.id))return;
                targets.set(item.destinationId,target);
                if(!destinations.has(target)){const bounds=box(target.getBoundingClientRect()),state=destinationVisibility(target,bounds,clip);destinations.set(target,{box:bounds,visible:state==='visible',clipped:state==='clipped'});}
                const state=destinations.get(target)!;
                if(!state.visible){if(!state.clipped||!item.countedLandingId||item.destinationZone!=='hand'||item.presentation!=='back'){host.dataset.foundationFlightStatus='destination-clipped-or-transformed';return;}needsCounted=true;}
            }
            const local=pending.filter(item=>item.destinationZone==='hand');
            const fallbackIds=new Set(needsCounted?local.map(item=>item.destinationId):[]);
            if(needsCounted&&(!conceal||!local.length||local.some(item=>!item.countedLandingId||item.presentation!=='back')||new Set(local.map(item=>item.countedLandingId)).size!==1)){host.dataset.foundationFlightStatus='counted-landing-unavailable';return;}
            // Counted arrival never exempts retained fan controls. Only actual
            // incoming destinations and their neutral source/landing are exempt.
            const sourceMarkers=pending.filter(item=>item.sourceRecipientId!==undefined&&next.nodes.some(node=>node.id===item.sourceId&&node.recipientId===item.sourceRecipientId)).map(item=>item.sourceId);
            const exclusions=new Set([...sourceMarkers,...pending.filter(item=>item.recycleOrigin).map(item=>item.recycleOrigin!.sourceNodeId),...pending.map(item=>item.destinationId),...pending.flatMap(item=>item.currentOriginId?[item.currentOriginId]:[]),...(needsCounted?local.flatMap(item=>item.countedLandingId?[item.countedLandingId]:[]):[])]);
            if(needsCounted)for(const item of local)if(item.countedLandingId)for(const id of endpointExclusions(next,item.countedLandingId,elements))exclusions.add(id);
            const sourceFans=new Set(pending.map(item=>item.sourceFan).filter(Boolean));
            if(!needsCounted){for(const node of next.nodes)if(node.kind==='card'&&sourceFans.has(node.parent)&&next.nodes.some(parent=>parent.id===node.parent&&parent.arrangement==='fan'))exclusions.add(node.id);const destinationFans=new Set(next.nodes.filter(node=>exclusions.has(node.id)).map(node=>node.parent).filter(parent=>next.nodes.some(node=>node.id===parent&&node.arrangement==='fan')));for(const node of next.nodes)if(node.kind==='card'&&destinationFans.has(node.parent))exclusions.add(node.id);}
            for(const item of pending)for(const id of endpointExclusions(next,item.destinationId,elements))exclusions.add(id);
            for(const item of pending)if(item.from&&item.sourceRecipientId!==undefined&&next.nodes.some(node=>node.id===item.sourceId&&node.recipientId===item.sourceRecipientId))for(const id of endpointExclusions(next,item.sourceId,elements,item.sourceLandmark??item.from))exclusions.add(id);
            const protectedAfter=protectedBoxes(next,elements,exclusions);
            const handoffs:ParticipantHandoff[]=[];
            const plans:{item:Pending&{art:SVGSVGElement};target:SVGSVGElement|HTMLElement;to:Rect;path:readonly Rect[];countedLandingId?:string}[]=[];
            const resolveNeutral=(id:string,landing=false):Rect|null=>{
                if(!currentOrigins.has(id)){const node=next.nodes.find(node=>node.id===id),element=elements.get(id),art=element?.firstElementChild;let bounds:Rect|null=null;
                    if(landing&&node&&ownCountLanding(node)&&node.kind==='group'&&element?.dataset.foundationFrame===String(next.id)){const rect=box(element.getBoundingClientRect());if(visible(element,rect)&&destinationVisibility(element,rect,clip)==='visible'&&endpointExclusions(next,id,elements).size===2)bounds=rect;}
                    else if(node?.kind==='card'&&(landing?!!node.ownHandAnchor:node.stockCount!==undefined)&&node.visual?.kind==='back'&&element?.dataset.foundationFrame===String(next.id)&&art instanceof SVGSVGElement&&art.hasAttribute('data-card-back')){const rect=box(art.getBoundingClientRect());if(visible(art,rect)&&contains(clip,rect))bounds=rect;}currentOrigins.set(id,bounds);
                }return currentOrigins.get(id)??null;
            };
            for(const item of pending){
                const target=targets.get(item.destinationId)!,countedLandingId=fallbackIds.has(item.destinationId)?item.countedLandingId:undefined;
                const rawTo=countedLandingId?resolveNeutral(countedLandingId,true):destinations.get(target)!.box;
                let to=rawTo?paperRect(rawTo):null;
                if(!to){host.dataset.foundationFlightStatus='counted-landing-clipped';return;}
                const rawFrom=item.currentOriginId?resolveNeutral(item.currentOriginId):item.from;
                let from=rawFrom?paperRect(rawFrom):null;
                if(!from){host.dataset.foundationFlightStatus='source-clipped-or-transformed';return;}
                const before=needsCounted?item.protectedBeforeCounted??item.protectedBefore:item.protectedBefore;
                const obstacles=[...beforeBoxes(before,next,protectedAfter),...protectedAfter];
                const targetNode=next.nodes.find(node=>node.id===(countedLandingId??item.destinationId));
                if(targetNode&&emptyCountAnchor(targetNode)){const proof=participantPapers(next,targetNode.id,elements,from,exclusions);if(proof)handoffs.push(proof.handoff);const choices=proof?.candidates??[];to=choices.find(candidate=>!!flightPath(from!,candidate,clip,obstacles))??null;}
                if(item.sourcePapers){const known=to?participantPapers(next,item.sourceId,elements,to,exclusions,.4,1.6,[to]):null;if(known)handoffs.push(known.handoff);from=known&&item.sourceLandmark&&same(known.bounds,item.sourceLandmark)?known.candidates.find(candidate=>!!to&&!!flightPath(candidate,to,clip,obstacles))??null:item.sourceHandoff?null:item.sourcePapers.find(candidate=>!!to&&!!flightPath(candidate,to,clip,obstacles))??null;}
                const path=from&&to?flightPath(from,to,clip,obstacles):null;
                if(!path){host.dataset.foundationFlightGeometry=JSON.stringify({origin:item.currentOriginId?'current':'previous',frame:next.id,beforeCount:before.length,from,to,clip,blockers:obstacles.filter(rect=>from&&to&&!flightPath(from,to,clip,[rect])).slice(0,8)});host.dataset.foundationFlightStatus='path-obstructed';return;}
                const art=item.destinationArtwork&&target instanceof SVGSVGElement?cloneTransferArtwork(target):item.art;if(!art){host.dataset.foundationFlightStatus='missing-artwork';return;}
                plans.push({item:{...item,art},target,to:to!,path,...(countedLandingId?{countedLandingId}:{})});
            }
            const timing=transferTiming(plans.length);
            const overlay=document.createElement('div');overlay.dataset.foundationFlight='';overlay.setAttribute('aria-hidden','true');overlay.inert=true;
            Object.assign(overlay.style,{position:'fixed',left:`${clip.x}px`,top:`${clip.y}px`,width:`${clip.width}px`,height:`${clip.height}px`,overflow:'clip',pointerEvents:'none',zIndex:'100',contain:'strict'});
            // Register provisional ownership before appending or starting animations.
            const recycleOrigin=pending[0]?.recycleOrigin;
            const maskIds=recycleOrigin?new Set(local.map(item=>item.destinationId)):fallbackIds;
            const endpointProofs=next.nodes.filter(node=>node.kind==='group'&&node.inert===true&&(node.recipientId!==undefined||!!node.ownHandAnchor)&&exclusions.has(node.id)).flatMap(node=>{const element=elements.get(node.id);return element?[{id:node.id,box:box(element.getBoundingClientRect()),ids:[...endpointExclusions(next,node.id,elements)],elements:[...endpointExclusions(next,node.id,elements)].map(id=>elements.get(id)!)}]:[];});
            const batch:Batch={handoffs:Object.freeze(handoffs),endpointProofs,maskFrameId:next.id,concealed:false,fallbackIds:maskIds,...(recycleOrigin?{...(local.length?{maskOwner:recycleOrigin.owner}:{}),recycleOrigin}:needsCounted?{maskOwner:`counted-flight-${++concealSequence}`}:{ }),arrivals:(next.feedbackArrivals??[]).filter(event=>event.entityIds.some(id=>plans.some(plan=>plan.item.entityId===id))),overlay,items:new Set(),suppressed:new Map(),frame:next,clip,exclusions,resume:new Set(),elements,origins:[...currentOrigins].flatMap(([id,bounds])=>{const art=elements.get(id)?.firstElementChild;return bounds&&art instanceof SVGSVGElement?[{id,art,box:bounds}]:[];})};active=batch;
            // Register all actual target identities before an untrusted mask
            // callback can reenter. No concealment or animation precedes approval.
            const ownedPlans=plans.map(plan=>{const owned:Item={entityId:plan.item.entityId,art:plan.item.art,target:plan.target,destinationId:plan.item.destinationId,to:plan.to,path:plan.path,...(plan.countedLandingId?{countedLandingId:plan.countedLandingId}:{})};batch.items.add(owned);batch.suppressed.set(plan.target,(batch.suppressed.get(plan.target)??0)+1);return {...plan,owned};});
            if(batch.maskOwner){batch.concealed=true;let accepted=false;try{accepted=conceal?.(next.id,[...maskIds],batch.maskOwner)===true;}catch{}if(active!==batch)return;if(!accepted||!currentGeometry(batch,next,elements)){clear('conceal-refused');host.dataset.foundationFlightStatus='counted-landing-unavailable';return;}}
            document.body.append(overlay);host.dataset.foundationFlightStatus='playing';
            try{
                for(const [index,{item,target,to,path,countedLandingId,owned}] of ownedPlans.entries()){
                    if(active!==batch)return;
                    const art=item.art;art.dataset.flightPresentation=item.presentation;art.dataset.flightFromZone=item.sourceZone;art.dataset.flightToZone=item.destinationZone;if(countedLandingId)art.dataset.flightLanding='count-anchor';
                    Object.assign(art.style,{position:'absolute',left:`${to.x-clip.x}px`,top:`${to.y-clip.y}px`,width:`${to.width}px`,height:`${to.height}px`,transformOrigin:'0 0',pointerEvents:'none'});
                    overlay.append(art);target.style.opacity='0';
                    const animation=art.animate(path.map(rect=>({transform:paperTransform(rect,to)})),{duration:timing.duration*motion.speed,delay:index*timing.stagger*motion.speed,fill:'both',easing:SELECTION_EASING});owned.animation=animation;
                    const finish=(outcome:'arrived'|'revoked')=>{
                        if(active!==batch||!batch.items.has(owned))return;
                        if(outcome==='revoked'&&owned.countedLandingId){clear('counted-flight-cancelled');return;}
                        batch.items.delete(owned);art.remove();owned.animation?.cancel();
                        const remaining=(batch.suppressed.get(target)??1)-1;
                        if(!owned.countedLandingId){if(remaining)batch.suppressed.set(target,remaining);else{batch.suppressed.delete(target);restore(batch,target);}}
                        const countedPending=[...batch.items].some(item=>!!item.countedLandingId);
                        const countedFinished=!!owned.countedLandingId&&!countedPending;
                        if(countedFinished){for(const [target] of batch.suppressed)if([...batch.fallbackIds].some(id=>batch.elements.get(id)?.firstElementChild===target)){restore(batch,target);batch.suppressed.delete(target);}}
                        if(!batch.items.size){overlay.remove();active=null;releaseMask(batch);queueMicrotask(onIdle);}
                        if(countedFinished&&!batch.recycleOrigin)releaseMask(batch);
                        for(const event of batch.arrivals){const touches=event.entityIds.includes(owned.entityId)||countedFinished&&event.entityIds.some(id=>local.some(item=>item.entityId===id));const pending=[...batch.items].some(item=>event.entityIds.includes(item.entityId))||countedPending&&event.entityIds.some(id=>local.some(item=>item.entityId===id));if(touches&&(outcome==='revoked'||!pending))settle(batch.frame,event,outcome);}
                    };
                    void animation.finished.then(()=>finish('arrived'),()=>finish('revoked'));
                }
            }catch{clear();host.dataset.foundationFlightStatus='animation-unavailable';}

        },
        /** Called only after the current DOM frame is painted and input-bound.
         * Reduced/off/blocked/no-origin movement still consumes its event once. */
        settleEntities(next:PresentationFrame,entityIds:readonly string[]|ReadonlySet<string>,outcome:MotionSettlement['outcome']){
            const ids=new Set(entityIds);for(const event of next.feedbackArrivals??[])if(event.entityIds.length>0&&event.entityIds.every(id=>ids.has(id)))settle(next,event,outcome);
        },
        settleVisible(next:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>,excludeEntities:ReadonlySet<string>=new Set()){
            for(const event of next.feedbackArrivals??[]){
                if(event.entityIds.some(id=>excludeEntities.has(id)||resourceTransfers?.entities().has(id)))continue;
                if(active?.arrivals.some(arrival=>arrival.eventId===event.eventId))continue;
                const represented=event.entityIds.every(id=>next.nodes.some(node=>node.kind==='card'&&node.entityId===id&&elements.has(node.id)));
                settle(next,event,represented?'snapped':'revoked');
            }
        },
        count: () => (active?.items.size??0)+(resourceTransfers?.count()??0),
    };
    resourceTransfers=createDomResourceTransfers({host,geometry:port,neutral:(frame,id,availability)=>options.paint?.neutral(frame,id,availability)??null,conceal,settle(frame,ids,outcome){port.settleEntities(frame,ids,outcome);},onIdle,...(options.current?{current:options.current}:{})});
    return port;
}
