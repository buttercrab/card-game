import type {ClusterPrimitive} from './controlClusterLayout';
type Size={readonly width:number;readonly height:number};
/** Source CSS --ease-settle y(t) maximum (dy/dt=0), independent of frame sampling. */
export const SETTLE_PROGRESS_PEAK=(()=>{const a=1.56,b=1;const A=3*a-3*b+1,B=-6*a+3*b,C=3*a;const roots=[(-2*B+Math.sqrt(4*B*B-12*A*C))/(6*A),(-2*B-Math.sqrt(4*B*B-12*A*C))/(6*A)];return Math.max(1,...roots.filter(t=>t>0&&t<1).map(t=>3*a*(1-t)**2*t+3*b*(1-t)*t*t+t**3));})();
/** Private metric owner for current native chip/button CSS. Does not certify
 * native clipping. Foundation currently has no original .strip .chips entrance
 * ancestry, so restoring that animation needs its own shared renderer proof. */
export function controlClusterPaintMetrics(kind:'choice'|'command',maximum:Size,native:{paddingX:number;paddingY:number;minHeight?:number}):ClusterPrimitive {
 const pulse=kind==='choice'?1+.08*SETTLE_PROGRESS_PEAK:1;
 const release=1+.03*(SETTLE_PROGRESS_PEAK-1),scale=pulse*release;
 const pressedMove=(kind==='choice'?2:3)*SETTLE_PROGRESS_PEAK*pulse;
 const horizontal=Math.ceil(maximum.width*(scale-1)/2+5*scale);
 const vertical=Math.ceil(maximum.height*(scale-1)/2+5*scale);
 return Object.freeze({paddingX:native.paddingX,paddingY:native.paddingY,nativeMinimum:native.minHeight??(kind==='choice'?40:44),
  hit:Object.freeze(kind==='choice'?{left:2,right:2,top:4,bottom:4}:{left:0,right:0,top:0,bottom:0}),
  paint:Object.freeze({left:horizontal,right:horizontal,top:vertical,bottom:Math.ceil(Math.max(vertical,maximum.height*(scale-1)/2+Math.max(5,3)*scale+pressedMove))})});
}
