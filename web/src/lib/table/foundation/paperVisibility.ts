import type {Rect} from './contracts';
import {paperEndpoints,paperRect,PAPER_ASPECT} from './paperEndpoints';
import {flightPath} from './transferMotion';
interface Point {readonly x:number;readonly y:number;}
interface Plane {readonly a:number;readonly b:number;readonly c:number;readonly strict?:boolean;}
interface LiftedPlane extends Plane {readonly u:number;}
export type PaperVisibilityResult={readonly kind:'ready';readonly candidates:readonly Rect[];readonly work:number}|{readonly kind:'refused';readonly reason:'invalid'|'obstacle-budget'|'region-budget'|'work-budget'|'blocked'|'numeric';readonly work:number};
const MAX_OBSTACLES=32,MAX_CELLS=128,MAX_WORK=128*64;
const rectValid=(r:Rect)=>[r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].every(Number.isFinite)&&r.width>0&&r.height>0&&r.x+r.width>r.x&&r.y+r.height>r.y;
const inside=(a:Rect,b:Rect)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const unique=(points:readonly Point[])=>points.filter((p,i)=>points.findIndex(other=>other.x===p.x&&other.y===p.y)===i);
/** Find endpoint visibility inside a CURRENT owned landmark for known opposite
 * rectangles. This is geometry only, not a new semantic or native authority. */
export function visiblePaperEndpoints(landmark:Rect,reference:Rect,clip:Rect,guards:readonly Rect[],opposites:readonly Rect[],minimumScale=.4,maximumScale=1.6,maximumWork=MAX_WORK):PaperVisibilityResult{
 let work=0;const tick=()=>{if(work===maximumWork)throw 'work-budget';work++;};const refusal=(reason:Extract<PaperVisibilityResult,{kind:'refused'}>['reason']):PaperVisibilityResult=>({kind:'refused',reason,work});
 if(!Number.isSafeInteger(maximumWork)||maximumWork<0||maximumWork>MAX_WORK)return refusal('invalid');if(maximumWork===0)return refusal('work-budget');
 if(!rectValid(landmark)||!rectValid(reference)||!rectValid(clip)||!opposites.length||opposites.length>8||opposites.some(r=>!rectValid(r))||guards.some(r=>!rectValid(r))||!Number.isFinite(minimumScale)||!Number.isFinite(maximumScale)||minimumScale<=0||maximumScale<minimumScale)return refusal('invalid');
 const clear=(r:Rect)=>opposites.every(other=>{tick();return !!flightPath(other,r,clip,guards);});
 // Preserve already-fitting centered artwork and its size before solving any
 // new placements. The unchanged final path proof always owns admission.
 try{const preferred=paperEndpoints(landmark,reference,clip,guards,minimumScale,maximumScale).filter(clear);if(preferred.length)return {kind:'ready',candidates:preferred,work};}catch{return refusal('work-budget');}
 if(!inside(clip,landmark)||opposites.some(r=>!inside(clip,r)))return refusal('invalid');
 const width=paperRect(reference).width*minimumScale,height=width/PAPER_ASPECT;if(!Number.isFinite(width)||!Number.isFinite(height)||width>landmark.width||height>landmark.height)return refusal('blocked');
 const relevant=guards.filter(obstacle=>opposites.some(other=>intersects(obstacle,{x:Math.min(other.x,landmark.x),y:Math.min(other.y,landmark.y),width:Math.max(other.x+other.width,landmark.x+landmark.width)-Math.min(other.x,landmark.x),height:Math.max(other.y+other.height,landmark.y+landmark.height)-Math.min(other.y,landmark.y)})));
 const obstacles=relevant.filter((r,i)=>relevant.findIndex(other=>r.x===other.x&&r.y===other.y&&r.width===other.width&&r.height===other.height)===i);if(obstacles.length>MAX_OBSTACLES)return refusal('obstacle-budget');
 let cells:readonly Point[][]=[unique([{x:landmark.x,y:landmark.y},{x:landmark.x+landmark.width-width,y:landmark.y},{x:landmark.x+landmark.width-width,y:landmark.y+landmark.height-height},{x:landmark.x,y:landmark.y+landmark.height-height}])];
 function cut(poly:readonly Point[],plane:Plane):Point[]{
  if(!poly.length)return [];const out:Point[]=[];let previous=poly.at(-1)!;let before=plane.a*previous.x+plane.b*previous.y-plane.c;
  if(!Number.isFinite(before))throw 'numeric';
  for(const point of poly){tick();const after=plane.a*point.x+plane.b*point.y-plane.c;if(!Number.isFinite(after))throw 'numeric';
   if((before<=0)!==(after<=0)){const t=before/(before-after),p={x:previous.x+(point.x-previous.x)*t,y:previous.y+(point.y-previous.y)*t};if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw 'numeric';out.push(p);}
   if(after<=0)out.push(point);previous=point;before=after;
  }
  const result=unique(out);if(result.length>MAX_CELLS)throw 'region-budget';return result;
 }
 function shadow(source:Rect,obstacle:Rect):readonly Plane[]|null{
  // Collision at t>0 is these affine edge inequalities with u=1/t>=1.
  // Fourier–Motzkin elimination projects ONE variable, producing a convex
  // forbidden endpoint shadow. Strict zero contradictions mean no shadow.
  const lifted:LiftedPlane[]=[
   {a:-1,b:0,u:obstacle.x-source.x-source.width,c:-source.x-source.width+width,strict:true},
   {a:1,b:0,u:source.x-obstacle.x-obstacle.width,c:source.x,strict:true},
   {a:0,b:-1,u:obstacle.y-source.y-source.height,c:-source.y-source.height+height,strict:true},
   {a:0,b:1,u:source.y-obstacle.y-obstacle.height,c:source.y,strict:true},
   {a:0,b:0,u:-1,c:-1},
  ];
  const upper=lifted.filter(p=>p.u>0),lower=lifted.filter(p=>p.u<0),planes:Plane[]=lifted.filter(p=>p.u===0);
  for(const p of upper)for(const n of lower){tick();planes.push({a:p.u*n.a-n.u*p.a,b:p.u*n.b-n.u*p.b,c:p.u*n.c-n.u*p.c,strict:p.strict||n.strict});}
  for(const p of planes){if(![p.a,p.b,p.c].every(Number.isFinite))throw 'numeric';if(p.a===0&&p.b===0&&(p.c<0||p.c===0&&p.strict))return null;}
  return planes.filter(p=>p.a!==0||p.b!==0);
 }
 try{
  for(const source of opposites)for(const obstacle of obstacles){const planes=shadow(source,obstacle);if(planes===null)continue;const next:Point[][]=[],seen=new Set<string>();const append=(poly:Point[])=>{if(!poly.length)return;const signature=JSON.stringify([...poly].sort((a,b)=>a.x-b.x||a.y-b.y));if(seen.has(signature))return;seen.add(signature);next.push(poly);if(next.length>MAX_CELLS)throw 'region-budget';};
   for(const cell of cells){let remainder:readonly Point[]=cell;for(const plane of planes){if(!remainder.length)break;const outside=cut(remainder,{a:-plane.a,b:-plane.b,c:-plane.c});append(outside);remainder=cut(remainder,plane);}}
   cells=next;if(!cells.length)return refusal('blocked');
  }
  const candidates:Rect[]=[];
  for(const cell of cells){const center={x:cell.reduce((sum,p)=>sum+p.x,0)/cell.length,y:cell.reduce((sum,p)=>sum+p.y,0)/cell.length};
   for(const point of unique([center,...cell])){tick();const r={x:point.x,y:point.y,width,height};if(inside(landmark,r)&&inside(clip,r)&&clear(r)){if(!candidates.some(other=>other.x===r.x&&other.y===r.y))candidates.push(Object.freeze(r));break;}}
  }
  if(!candidates.length)return refusal('blocked');candidates.sort((a,b)=>Math.hypot(a.x+a.width/2-landmark.x-landmark.width/2,a.y+a.height/2-landmark.y-landmark.height/2)-Math.hypot(b.x+b.width/2-landmark.x-landmark.width/2,b.y+b.height/2-landmark.y-landmark.height/2)||a.x-b.x||a.y-b.y);return {kind:'ready',candidates:Object.freeze(candidates),work};
 }catch(reason){return refusal(reason==='work-budget'||reason==='region-budget'?reason:'numeric');}
}
