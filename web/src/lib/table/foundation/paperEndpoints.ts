import type {Rect} from './contracts';
/** Shared artwork uses viewBox 100×140. Landmark boxes are never paper boxes. */
export const PAPER_ASPECT=5/7;
const valid=(r:Rect)=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
const inside=(a:Rect,b:Rect)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width+1e-7&&b.y+b.height<=a.y+a.height+1e-7;
const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export function paperRect(bounds:Rect,maximumWidth=Infinity):Rect {
 const width=Math.min(bounds.width,bounds.height*PAPER_ASPECT,maximumWidth),height=width/PAPER_ASPECT;
 return {x:bounds.x+(bounds.width-width)/2,y:bounds.y+(bounds.height-height)/2,width,height};
}
/** Bounded candidate geometry only; callers separately prove native identity and straight paths. */
export function paperEndpoints(landmark:Rect,reference:Rect,clip:Rect,protectedRects:readonly Rect[],minimumScale=.4,maximumScale=1.6):readonly Rect[]{
 if(!valid(landmark)||!valid(reference)||!valid(clip)||!inside(clip,landmark)||!Number.isFinite(minimumScale)||!Number.isFinite(maximumScale)||minimumScale<=0||maximumScale<minimumScale||protectedRects.some(r=>!valid(r)))return [];
 const obstacles=protectedRects.filter(r=>overlaps(r,landmark));if(obstacles.length>32)return [];
 let free:Rect[]=[landmark];
 for(const obstacle of obstacles){const next:Rect[]=[];for(const r of free){if(!overlaps(r,obstacle)){next.push(r);continue;}const right=r.x+r.width,bottom=r.y+r.height;
  if(obstacle.x>r.x)next.push({...r,width:Math.min(right,obstacle.x)-r.x});if(obstacle.x+obstacle.width<right)next.push({...r,x:Math.max(r.x,obstacle.x+obstacle.width),width:right-Math.max(r.x,obstacle.x+obstacle.width)});
  if(obstacle.y>r.y)next.push({...r,height:Math.min(bottom,obstacle.y)-r.y});if(obstacle.y+obstacle.height<bottom)next.push({...r,y:Math.max(r.y,obstacle.y+obstacle.height),height:bottom-Math.max(r.y,obstacle.y+obstacle.height)});
 }
 const unique=next.filter((r,i)=>valid(r)&&next.findIndex(other=>JSON.stringify(other)===JSON.stringify(r))===i);free=unique.filter((r,i)=>!unique.some((other,j)=>i!==j&&inside(other,r)));if(free.length>128)return [];
 }
 const basis=paperRect(reference),minimum=basis.width*minimumScale,maximum=basis.width*maximumScale;
 return free.map(r=>paperRect(r,maximum)).filter(r=>r.width+1e-7>=minimum).sort((a,b)=>b.width*b.height-a.width*a.height||Math.hypot(a.x+a.width/2-landmark.x-landmark.width/2,a.y+a.height/2-landmark.y-landmark.height/2)-Math.hypot(b.x+b.width/2-landmark.x-landmark.width/2,b.y+b.height/2-landmark.y-landmark.height/2)||a.x-b.x||a.y-b.y);
}
export function paperTransform(from:Rect,to:Rect):string{return `translate(${from.x-to.x}px,${from.y-to.y}px) scale(${from.width/to.width})`;}
