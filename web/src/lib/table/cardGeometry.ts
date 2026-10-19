import type { CardSize } from '../cardTypes';
/** Dimensions/interaction displacement; card artwork remains a rendered leaf. */
export function cardGeometry(viewportWidth:number,size:CardSize,width?:number) {
 const desktop=viewportWidth>=1024;
 const defaultWidth=size==='hand'?(desktop?88:60):size==='trick'?(desktop?72:48):size==='mini'?(desktop?56:40):60;
 const w=width??defaultWidth;
 return {width:w,height:w*1.4,raised:-w*.36,picked:viewportWidth<600?-10:-18,unplayable:4,leading:-6,hover:-6};
}

export function handInteractionOffset(lifted:boolean):number {return lifted?-4:0;}
