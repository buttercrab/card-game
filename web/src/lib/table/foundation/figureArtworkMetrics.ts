import type {PlannedNode,Rect,Size} from './contracts';
import {countdownTypography} from './countdownTypography';
/** Original PlayerFigure and TurnRing geometry, shared by paint and admission.
 * Layout allocations stay unchanged. SVG body mapping is uniform/top-aligned. */
export const FIGURE_BODY=Object.freeze({width:120,height:110,viewBox:'0 0 120 110'});
const diameter=120*1.28;
export const FIGURE_CLOCK=Object.freeze({x:60-diameter/2,y:55-diameter*.54,width:diameter,height:diameter,viewBox:'0 0 100 100',center:50,radius:46,stroke:4});
export function figureClockText(scale:number){const prior=countdownTypography(scale);return Object.freeze({...prior,y:FIGURE_BODY.height-(120-prior.y)});}
const union=(a:Rect,b:Rect):Rect=>{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};};
export function figureArtworkMetrics(allocation:Size){
 if(![allocation.width,allocation.height].every(value=>Number.isFinite(value)&&value>0))throw Error('Invalid figure artwork allocation');
 const scale=Math.min(allocation.width/FIGURE_BODY.width,allocation.height/FIGURE_BODY.height),x=(allocation.width-FIGURE_BODY.width*scale)/2;
 const body={x,y:0,width:FIGURE_BODY.width*scale,height:FIGURE_BODY.height*scale};
 const clockViewport={x:x+FIGURE_CLOCK.x*scale,y:FIGURE_CLOCK.y*scale,width:FIGURE_CLOCK.width*scale,height:FIGURE_CLOCK.height*scale};
 const radius=(FIGURE_CLOCK.radius+FIGURE_CLOCK.stroke/2)/100*clockViewport.width;
 const clock={x:clockViewport.x+clockViewport.width/2-radius,y:clockViewport.y+clockViewport.height/2-radius,width:radius*2,height:radius*2};
 return Object.freeze({scale,body:Object.freeze(body),clockViewport:Object.freeze(clockViewport),clock:Object.freeze(clock),potential:Object.freeze(union({x:0,y:0,width:allocation.width,height:allocation.height},clock))});
}
/** Preserve the allocation's existing conservative guard; add all clock ink and
 * measured native numeral paint, never erase an old protected footprint. */
export function figurePaintBounds(allocation:Rect,clock:boolean,glyphs:readonly Rect[]=[]):Rect{
 const metrics=figureArtworkMetrics(allocation),paint=clock?{x:allocation.x+metrics.potential.x,y:allocation.y+metrics.potential.y,width:metrics.potential.width,height:metrics.potential.height}:{...allocation};
 return glyphs.reduce(union,paint);
}
/** Static potential clock reservations are checked even before a turn starts.
 * Root flow may reveal content; nested clips may not cut off participant paint. */
export function figurePaintAdmission(nodes:readonly PlannedNode[],width:number,height:number):readonly string[]{
 const index=new Map(nodes.map(node=>[node.id,node])),errors:string[]=[];
 const world=(node:PlannedNode):Rect|null=>{let x=node.box.x,y=node.box.y,parent=node.parent;const seen=new Set([node.id]);while(parent){if(seen.has(parent))return null;seen.add(parent);const owner=index.get(parent);if(!owner)return null;x+=owner.box.x;y+=owner.box.y;parent=owner.parent;}return {x,y,width:node.box.width,height:node.box.height};};
 const inside=(paint:Rect,clip:Rect)=>paint.x>=clip.x&&paint.y>=clip.y&&paint.x+paint.width<=clip.x+clip.width&&paint.y+paint.height<=clip.y+clip.height;
 for(const node of nodes){if(node.kind!=='figure'||!node.ownerId)continue;const bounds=world(node);if(!bounds)continue;const paint=figurePaintBounds(bounds,true);if(!inside(paint,{x:0,y:0,width,height})){errors.push(`Figure clock paint escapes table: ${node.id}`);continue;}let parent=node.parent;while(parent){const owner=index.get(parent);if(!owner)break;if(owner.scroll&&owner.parent!==null){const clip=world(owner);if(clip&&!inside(paint,{...clip,width:clip.width-(owner.scrollAxis==='y'?owner.scrollbarGutter??0:0)})){errors.push(`Figure clock paint escapes clip: ${node.id}`);break;}}parent=owner.parent;}}
 return errors;
}
