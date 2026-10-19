import type {PresentationFrame,Rect} from './contracts';
import {contains,flightPath} from './transferMotion';
import {paperEndpoints} from './paperEndpoints';
import {visiblePaperEndpoints} from './paperVisibility';
export interface NeutralStockOrigin {readonly frameId:number;readonly regionId:string;readonly element:HTMLElement;readonly bounds:Rect;readonly clip:Rect;readonly paper:Rect;readonly pathEndpoints:readonly Rect[];readonly scope:string;readonly environment:string;}
export interface NeutralStockPaper {readonly landmark:Rect;readonly reference:Rect;readonly minimumScale:number;readonly maximumScale:number;}
export interface NeutralStockPath {readonly endpoints:readonly Rect[];readonly protectedRects:readonly Rect[];readonly paper?:NeutralStockPaper;}
export type NeutralStockRefusal='region-absent'|'region-stamp'|'region-detached'|'region-space'|'region-unsupported'|'endpoint-shape'|'origin-obstacle-budget'|'origin-candidates-empty'|'path-budget'|'path-geometry'|'path-obstructed';
export type NeutralStockResult={readonly ok:true;readonly origin:NeutralStockOrigin;readonly work:number;readonly groups:number;readonly visibilitySolves:number}|{readonly ok:false;readonly reason:NeutralStockRefusal;readonly diagnostic:Readonly<{region?:Rect;clip?:Rect;obstacles?:number;candidates?:number;paths?:number;checks?:number;groups?:number;visibilitySolves?:number;visibilityReason?:string;pathIndex?:number;from?:Rect;to?:Rect;blockers?:readonly Rect[]}>};
// Bound joint search by the existing128 paper /64 transfer capacities.
// Exhaustion is an explicit refusal, never a widened geometry tolerance.
const MAX_PATH_CHECKS=128*64;
const box=(r:DOMRect):Rect=>({x:r.left,y:r.top,width:r.width,height:r.height});
const copy=(r:Rect):Rect=>Object.freeze({x:r.x,y:r.y,width:r.width,height:r.height});
const intersect=(a:Rect,b:Rect):Rect=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),width:Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),height:Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)});
const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const valid=(r:Rect)=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const scope=(frame:PresentationFrame)=>JSON.stringify([frame.context.session,frame.context.audience,frame.context.generation]);
type Region={regionId:string;element:HTMLElement;bounds:Rect;clip:Rect;visible:Rect};
function region(host:HTMLElement,frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>):{ok:true;region:Region}|{ok:false;reason:NeutralStockRefusal}{
 try{
  const node=frame.nodes.find(node=>node.id==='arena'),element=node&&elements.get(node.id);if(!node||node.kind!=='group'||!element)return {ok:false,reason:'region-absent'};
  if(element.dataset.foundationFrame!==String(frame.id)||element.dataset.foundationNode!==node.id)return {ok:false,reason:'region-stamp'};
  if(!host.contains(element))return {ok:false,reason:'region-detached'};
  const bounds=box(element.getBoundingClientRect());let clip=intersect(box(host.getBoundingClientRect()),{x:0,y:0,width:innerWidth,height:innerHeight});
  for(let parent:Element|null=element;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse'||css.transform!=='none'||css.perspective!=='none'||css.scale!=='none'||css.rotate!=='none'||css.translate!=='none'||css.zoom!=='1'&&css.zoom!=='normal')return {ok:false,reason:'region-unsupported'};if(/auto|scroll|hidden|clip/.test(`${css.overflowX} ${css.overflowY}`)){const r=parent.getBoundingClientRect();clip=intersect(clip,{x:r.left+parent.clientLeft,y:r.top+parent.clientTop,width:parent.clientWidth,height:parent.clientHeight});}}
  const visible=intersect(bounds,clip);if(!valid(bounds)||!valid(clip)||!valid(visible))return {ok:false,reason:'region-space'};return {ok:true,region:{regionId:node.id,element,bounds,clip,visible}};
 }catch{return {ok:false,reason:'region-unsupported'};}
}
/** Geometry only. Semantic stock/count ownership is proved separately. Endpoint
 * alternatives are selected jointly with ONE neutral origin; no ink guard is
 * removed and no native endpoint is moved outside its admitted paper candidates. */
export function inspectNeutralStockOrigin(host:HTMLElement,frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>,protectedRects:readonly Rect[],endpoints:readonly Rect[],paths?:readonly NeutralStockPath[]):NeutralStockResult{
 const native=region(host,frame,elements);if(!native.ok)return {...native,diagnostic:Object.freeze({})};const current=native.region;
 if(!endpoints.length||endpoints.length>64||endpoints.some(r=>!valid(r))||paths&&(paths.length!==endpoints.length||paths.some(path=>!path.endpoints.length||path.endpoints.length>128||path.endpoints.some(r=>!valid(r))||path.paper&&(!valid(path.paper.landmark)||!valid(path.paper.reference)||!Number.isFinite(path.paper.minimumScale)||!Number.isFinite(path.paper.maximumScale)||path.paper.minimumScale<=0||path.paper.maximumScale<path.paper.minimumScale))))return {ok:false,reason:'endpoint-shape',diagnostic:Object.freeze({})};
 const widths=frame.nodes.filter(node=>node.trickSlot&&node.box.width>0).map(node=>node.box.width),width=widths.length?Math.min(...widths):64,reference={x:0,y:0,width,height:width*1.4};
 const obstacles=protectedRects.filter(r=>overlaps(r,current.visible)).length,base={region:copy(current.visible),clip:copy(current.clip),obstacles};if(obstacles>32)return {ok:false,reason:'origin-obstacle-budget',diagnostic:Object.freeze(base)};
 const papers=paperEndpoints(current.visible,reference,current.clip,protectedRects,1,1);if(!papers.length)return {ok:false,reason:'origin-candidates-empty',diagnostic:Object.freeze({...base,candidates:0})};
 const legs:readonly NeutralStockPath[]=paths??endpoints.map(endpoint=>({endpoints:[endpoint],protectedRects}));
 // Search-equivalent legs share geometry only; each actual native owner is
 // independently revalidated by the caller before mount and on every renewal.
 const groups:{path:NeutralStockPath;indices:number[]}[]=[],keys=new Map<string,number>();
 for(const [index,path]of legs.entries()){const key=JSON.stringify([path.endpoints.map(r=>[r.x,r.y,r.width,r.height]),path.paper?[path.paper.landmark.x,path.paper.landmark.y,path.paper.landmark.width,path.paper.landmark.height,path.paper.reference.x,path.paper.reference.y,path.paper.reference.width,path.paper.reference.height,path.paper.minimumScale,path.paper.maximumScale]:null,[...path.protectedRects].map(r=>[r.x,r.y,r.width,r.height])]),known=keys.get(key);if(known===undefined){keys.set(key,groups.length);groups.push({path,indices:[index]});}else groups[known].indices.push(index);}
 let checks=0,visibilitySolves=0,last:{pathIndex:number;from:Rect;to:Rect;blockers:readonly Rect[]}|undefined;
 const stats=()=>({...base,candidates:papers.length,paths:legs.length,groups:groups.length,checks,visibilitySolves});
 const spend=()=>{if(checks===MAX_PATH_CHECKS)return false;checks++;return true;};
 for(const paper of papers){const selected:Rect[]=new Array(legs.length);let accepted=true;
  for(const {path,indices}of groups){let found:Rect|undefined;
   for(const endpoint of path.endpoints){if(!spend())return {ok:false,reason:'path-budget',diagnostic:Object.freeze(stats())};if(flightPath(paper,endpoint,current.clip,path.protectedRects)){found=endpoint;break;}}
   if(!found&&path.paper){if(!spend())return {ok:false,reason:'path-budget',diagnostic:Object.freeze(stats())};visibilitySolves++;const shape=path.paper,result=visiblePaperEndpoints(shape.landmark,shape.reference,current.clip,path.protectedRects,[paper],shape.minimumScale,shape.maximumScale,MAX_PATH_CHECKS-checks);checks+=result.work;
    if(result.kind==='ready')found=result.candidates[0];else if(result.reason!=='blocked')return {ok:false,reason:result.reason==='invalid'||result.reason==='numeric'?'path-geometry':'path-budget',diagnostic:Object.freeze({...stats(),pathIndex:indices[0],visibilityReason:result.reason})};
   }
   if(found){if(!spend())return {ok:false,reason:'path-budget',diagnostic:Object.freeze(stats())};if(!flightPath(paper,found,current.clip,path.protectedRects))found=undefined;}
   if(!found){const to=path.endpoints[0];last={pathIndex:indices[0],from:copy(paper),to:copy(to),blockers:Object.freeze(path.protectedRects.filter(rect=>!flightPath(paper,to,current.clip,[rect])).slice(0,4).map(copy))};accepted=false;break;}
   for(const index of indices)selected[index]=copy(found);
  }
  if(accepted)return {ok:true,origin:Object.freeze({...current,frameId:frame.id,paper:copy(paper),pathEndpoints:Object.freeze(selected),scope:scope(frame),environment:JSON.stringify(frame.environment)}),work:checks,groups:groups.length,visibilitySolves};
 }
 return {ok:false,reason:'path-obstructed',diagnostic:Object.freeze({...stats(),...last})};
}
export function neutralStockOrigin(...args:Parameters<typeof inspectNeutralStockOrigin>):NeutralStockOrigin|null{const result=inspectNeutralStockOrigin(...args);return result.ok?result.origin:null;}
export function currentNeutralStockOrigin(proof:NeutralStockOrigin,host:HTMLElement,frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>):boolean{
 const native=region(host,frame,elements);return native.ok&&proof.scope===scope(frame)&&proof.environment===JSON.stringify(frame.environment)&&native.region.element===proof.element&&same(native.region.bounds,proof.bounds)&&same(native.region.clip,proof.clip)&&contains(native.region.visible,proof.paper);
}
