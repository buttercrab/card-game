import type {PlannedNode,PresentationFrame,Rect} from './contracts';
import {emptyCountAnchor,pairedCountFigure} from './transferPolicy';
/** Internal native layout proof. Count/face authority stays in the semantic
 * transfer plan. The figure bounds and the paper region are deliberately
 * separate; neither is a permission to cover participant paint. */
export interface ParticipantHandoff {
 readonly participantId:string;
 readonly kind:'seat-core'|'own-hand';
 readonly anchorId:string;
 readonly figureId:string;
 readonly regionId:string;
 readonly bounds:Rect;
 readonly regionBounds:Rect;
 readonly hostBounds:Rect;
 readonly viewport:Rect;
 readonly content:{readonly element:HTMLElement;readonly parentElement:HTMLElement;readonly bounds:Rect};
 readonly witnesses:readonly {readonly id:string;readonly element:HTMLElement;readonly parentElement:HTMLElement|null;readonly bounds:Rect}[];
 readonly scope:string;
 readonly environment:string;
}
export interface ParticipantPapers {readonly bounds:Rect;readonly regionBounds:Rect;readonly handoff:ParticipantHandoff;readonly candidates:readonly Rect[];}
const rect=(element:HTMLElement):Rect=>{const b=element.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};};
const valid=(r:Rect)=>[r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
const equal=(a:Rect,b:Rect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const inside=(a:Rect,b:Rect)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const copy=(r:Rect):Rect=>Object.freeze({...r});
const scope=(frame:PresentationFrame)=>JSON.stringify([frame.context.session,frame.context.audience,frame.context.generation]);
const key=(...parts:string[])=>JSON.stringify(parts);
export interface ParticipantIdentityStructure {readonly participantId:string;readonly local:boolean;readonly anchor:PlannedNode;readonly figure:PlannedNode;readonly core:PlannedNode;readonly identity:PlannedNode;}
export interface ParticipantHandoffStructure extends ParticipantIdentityStructure {readonly kind:'seat-core'|'own-hand';readonly region:PlannedNode;readonly fan?:PlannedNode;}
/** Exact shared producer recipe, not a generic group/ancestor heuristic. This
 * is exported internally so layout admission can use the same closed shape. */
export function participantIdentityStructure(frame:Pick<PresentationFrame,'nodes'|'rosterIds'>,id:string):ParticipantIdentityStructure|null {
 const {nodes,rosterIds}=frame;if(nodes.length>4096||!rosterIds||rosterIds.length>8||new Set(rosterIds).size!==rosterIds.length)return null;
 const index=new Map(nodes.map(n=>[n.id,n]));if(index.size!==nodes.length)return null;const requested=index.get(id);if(!requested)return null;
 const participantId=emptyCountAnchor(requested)?requested.ownHandAnchor?.participantId??requested.recipientId:requested.kind==='figure'?requested.ownerId:undefined;
 if(!participantId||!rosterIds.includes(participantId))return null;
 const anchors=nodes.filter(n=>emptyCountAnchor(n)&&(n.ownHandAnchor?.participantId??n.recipientId)===participantId);if(anchors.length!==1)return null;
 const anchor=anchors[0],figure=pairedCountFigure(anchor,nodes);if(!figure||requested!==anchor&&requested!==figure||nodes.filter(n=>n.kind==='figure'&&n.ownerId===participantId).length!==1)return null;
 const local=!!anchor.ownHandAnchor,cellId=key('opponent',participantId),identityId=local?'identity':key(cellId,'identity'),coreId=local?'identity-portrait':key(identityId,'portrait'),figureId=local?'identity-figure':key(cellId,'figure'),anchorId=local?'own-hand-count-anchor':key(cellId,'hand'),badgeId=local?'identity-name-badge':key(cellId,'name-badge'),nameId=local?'identity-name':key(cellId,'name'),metaId=key('identity-meta',participantId);
 const identity=index.get(identityId),core=index.get(coreId),badge=index.get(badgeId),name=index.get(nameId),meta=index.get(metaId);
 if(anchor.id!==anchorId||figure.id!==figureId||figure.parent!==coreId||anchor.parent!==coreId||!core||core.kind!=='group'||core.parent!==identityId||!identity||identity.kind!=='group'||!identity.parent||!badge||badge.kind!=='group'||badge.parent!==coreId||!name||name.kind!=='text'||name.parent!==badgeId||name.role!=='participant-name'||!meta||meta.kind!=='group'||meta.parent!==coreId||meta.identityMetaFor!==participantId)return null;
 const direct=new Set([figureId,anchorId,badgeId,metaId]);if(nodes.some(n=>n.parent===coreId&&!direct.has(n.id))||nodes.filter(n=>n.parent===badgeId).length!==1)return null;
 // A larger wrapper cannot masquerade as the tightly composed portrait. The
 // body/name define its height; peer meta and centered body define its width.
 if(core.box.height!==Math.max(figure.box.y+figure.box.height,badge.box.y+badge.box.height)||!local&&(meta.box.width!==core.box.width||figure.box.x!==(core.box.width-figure.box.width)/2||badge.box.x!==(core.box.width-badge.box.width)/2))return null;
 if(!local){const cell=index.get(cellId);if(!cell||cell.kind!=='group'||identity.parent!==cellId||!cell.parent)return null;}
 return {participantId,local,anchor,figure,core,identity};
}
/** Ordinary allocation adds the nonempty current hand recipe to identity. */
export function participantHandoffStructure(frame:Pick<PresentationFrame,'nodes'|'rosterIds'>,id:string):ParticipantHandoffStructure|null {
 const identityProof=participantIdentityStructure(frame,id);if(!identityProof)return null;const {participantId,anchor,figure,core,identity}=identityProof;if(!identityProof.local)return {...identityProof,kind:'seat-core',region:core};
 const nodes=frame.nodes,index=new Map(nodes.map(node=>[node.id,node]));
 const dock=index.get('dock'),hand=index.get('hand'),fan=index.get('hand-fan');if(!dock||dock.kind!=='group'||identity.parent!=='dock'||!hand||hand.kind!=='group'||hand.parent!=='dock'||!fan||fan.kind!=='group'||fan.parent!=='hand'||fan.arrangement!=='fan'||nodes.some(n=>n.parent===hand.id&&n!==fan))return null;
 const descends=(node:PlannedNode)=>{const seen=new Set<string>();while(node.parent){if(seen.has(node.id))return false;seen.add(node.id);if(node.parent===hand.id)return true;const parent=index.get(node.parent);if(!parent)return false;node=parent;}return false;},cards=nodes.filter(n=>n.kind==='card'&&n.zoneId==='hand'&&!!n.entityId);
 if(!cards.length||cards.length!==anchor.ownHandAnchor!.count||cards.some(n=>n.parent!==fan.id||!descends(n)||n.ownerId!==undefined&&n.ownerId!==participantId)||new Set(cards.map(n=>n.entityId)).size!==cards.length||nodes.filter(n=>n.parent===fan.id).length!==cards.length)return null;
 return {...identityProof,kind:'own-hand',region:hand,fan};
}
/** Only existing immediate identity cores and the local existing hand region
 * qualify. Never climb to an ancestor merely because it has more free space. */
export function participantHandoff(frame:PresentationFrame,id:string,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,expectedContent:HTMLElement|null):ParticipantHandoff|null {
 try{
  if(frame.modalId)return null;const structure=participantHandoffStructure(frame,id);if(!structure)return null;
  const {participantId,anchor,figure,core,region,kind}=structure,index=new Map(frame.nodes.map(node=>[node.id,node]));
  const root=index.get('table'),rootElement=elements.get('table'),content=rootElement?.parentElement;if(!root||root.kind!=='group'||root.parent!==null||!rootElement||rootElement.dataset.foundationFrame!==String(frame.id)||rootElement.dataset.foundationNode!=='table'||!content||content!==expectedContent||content.className!=='foundation-content'||content.parentElement!==host||content.isConnected!==true||Array.from(host.children).filter(child=>child.className==='foundation-content').length!==1)return null;
  const contentBounds=rect(content);if(!valid(contentBounds))return null;
  const witnesses:ParticipantHandoff['witnesses'][number][]=[],visited=new Set<string>();
  const native=(node:PlannedNode):HTMLElement=>{
   const element=elements.get(node.id);if(!element||element.isConnected!==true||!host.contains(element)||element.dataset.foundationFrame!==String(frame.id)||element.dataset.foundationNode!==node.id)throw Error('native');
   if(node.parent===null&&node.id!=='table')throw Error('root');const parent=node.parent===null?content:elements.get(node.parent);if(!parent||element.parentElement!==parent)throw Error('parent');
   const bounds=rect(element);if(!valid(bounds))throw Error('bounds');
   if(!visited.has(node.id)){visited.add(node.id);witnesses.push(Object.freeze({id:node.id,element,parentElement:element.parentElement,bounds:copy(bounds)}));}
   return element;
  };
  for(const initial of [anchor,figure,region,...(structure.fan?[structure.fan]:[])]){let node:PlannedNode|undefined=initial;const chain=new Set<string>();while(node){if(chain.has(node.id))return null;chain.add(node.id);native(node);node=node.parent?index.get(node.parent):undefined;}}
  const anchorElement=native(anchor),figureElement=native(figure),regionElement=native(region),bounds=rect(figureElement);let regionBounds=rect(regionElement);
  const intersection=(a:Rect,b:Rect):Rect=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),width:Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),height:Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)});
  if(structure.fan){const b=rect(regionElement);regionBounds=intersection({x:b.x+regionElement.clientLeft,y:b.y+regionElement.clientTop,width:regionElement.clientWidth,height:regionElement.clientHeight},rect(native(structure.fan)));for(let parent:HTMLElement|null=regionElement.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(/auto|scroll|hidden|clip/.test(`${css.overflowX} ${css.overflowY}`)){const p=rect(parent);regionBounds=intersection(regionBounds,{x:p.x+parent.clientLeft,y:p.y+parent.clientTop,width:parent.clientWidth,height:parent.clientHeight});}}}
  if(!equal(rect(anchorElement),bounds)||!inside(rect(native(core)),bounds))return null;
  const viewport={x:0,y:0,width:innerWidth,height:innerHeight},hostBounds=rect(host);if(structure.fan)regionBounds=intersection(intersection(regionBounds,viewport),hostBounds);if(!valid(viewport)||!valid(hostBounds)||!valid(regionBounds)||!inside(viewport,regionBounds)||!inside(hostBounds,regionBounds))return null;
  // Proof the current coordinate space, clips and paint visibility without
  // granting any figure/name/clock exception to the motion guard list.
  for(const initial of [anchorElement,figureElement,regionElement,...(structure.fan?[native(structure.fan)]:[])]){let opacity=1;for(let current:HTMLElement|null=initial;current;current=current.parentElement){const css=getComputedStyle(current),alpha=Number(css.opacity);opacity*=alpha;if(!Number.isFinite(alpha)||!Number.isFinite(opacity)||opacity<=0||css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse'||css.transform!=='none'||css.perspective!=='none'||css.scale!=='none'||css.rotate!=='none'||css.translate!=='none'||css.zoom!=='1'&&css.zoom!=='normal')return null;if(/auto|scroll|hidden|clip/.test(`${css.overflowX} ${css.overflowY}`)){const b=rect(current),clip={x:b.x+current.clientLeft,y:b.y+current.clientTop,width:current.clientWidth,height:current.clientHeight};const target=initial===regionElement||!!structure.fan&&initial===elements.get(structure.fan.id)?regionBounds:rect(initial);if(!inside(clip,target))return null;}}}
  return Object.freeze({participantId,kind,anchorId:anchor.id,figureId:figure.id,regionId:region.id,bounds:copy(bounds),regionBounds:copy(regionBounds),hostBounds:copy(hostBounds),viewport:copy(viewport),content:Object.freeze({element:content,parentElement:host,bounds:copy(contentBounds)}),witnesses:Object.freeze(witnesses),scope:scope(frame),environment:JSON.stringify(frame.environment)});
 }catch{return null;}
}
/** A compatible publication must still own every native element, parent and
 * exact rectangle. Semantic count transitions are checked by the shared plan. */
export function currentParticipantHandoff(proof:ParticipantHandoff,frame:PresentationFrame,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,expectedContent:HTMLElement|null):boolean {
 const current=participantHandoff(frame,proof.anchorId,host,elements,expectedContent);return !!current&&current.scope===proof.scope&&current.environment===proof.environment&&current.participantId===proof.participantId&&current.kind===proof.kind&&current.regionId===proof.regionId&&current.figureId===proof.figureId&&equal(current.bounds,proof.bounds)&&equal(current.regionBounds,proof.regionBounds)&&equal(current.hostBounds,proof.hostBounds)&&equal(current.viewport,proof.viewport)&&current.content.element===proof.content.element&&current.content.parentElement===proof.content.parentElement&&equal(current.content.bounds,proof.content.bounds)&&current.witnesses.length===proof.witnesses.length&&current.witnesses.every((w,i)=>w.id===proof.witnesses[i].id&&w.element===proof.witnesses[i].element&&w.parentElement===proof.witnesses[i].parentElement&&equal(w.bounds,proof.witnesses[i].bounds));
}

/** Shared ordinary receive contract for native admission and completion capture.
 * The caller may retain only its numeric region under a separate current grant. */
export function ownHandReceiveStructure(frame:Pick<PresentationFrame,'nodes'|'rosterIds'>,participantId:string):ParticipantHandoffStructure|null {
 const proof=participantHandoffStructure(frame,'own-hand-count-anchor');return proof?.kind==='own-hand'&&proof.participantId===participantId?proof:null;
}
export function ownHandReceiveAllocation(frame:PresentationFrame,participantId:string,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,expectedContent:HTMLElement|null):ParticipantHandoff|null {
 const proof=participantHandoff(frame,'own-hand-count-anchor',host,elements,expectedContent);return proof?.kind==='own-hand'&&proof.participantId===participantId?proof:null;
}
