import {calculateFrameLayout} from './frameLayout';
import {resultHudPolicy} from './hudLayout';
export function resultSurfacePolicy(width:number,height:number,dock=false){
 const short=width>height&&height<=520;const narrow=width<600;
 return{...resultHudPolicy(width,height),paddingX:short?8:12,paddingY:short||narrow?8:12,inlineGap:8,noteGap:6,maxHeight:dock?Math.max(0,calculateFrameLayout({viewport:{width,height},region:{width:0,height:0}}).dockHeight-48):undefined};
}
export function turnSurfacePolicy(compact:boolean){return{minHeight:compact?0:30,paddingX:compact?0:8,paddingY:compact?0:4,rowHeight:compact?0:18};}
