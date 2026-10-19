import {figureArtworkMetrics} from './figureArtworkMetrics';
import type {Size} from './contracts';
/** Original responsive participant composition; semantic children are measured
 * before placement. Counts are inert landmarks and have no layout footprint. */
export interface ParticipantIdentityAllocation {
 readonly width:number;readonly arrangement:'adjacent'|'portrait';readonly figureSize:number;readonly figureHeight:number;readonly paintInsetTop:number;readonly coreWidth:number;readonly nameWidth:number;readonly metaWidth:number;readonly textX:number;readonly metaMinimum:number;readonly shortLocal:boolean;
}
/** Full potential clock paint is a persistent artwork minimum, even off turn. */
export function participantFigureMinimumWidth(figureSize:number):number{return Math.ceil(figureArtworkMetrics({width:figureSize,height:figureSize*110/120}).potential.width);}
/** Shared natural width of the actual artwork/name/meta arrangement. The
 * name pill starts outside the figure; only the meta row uses its shoulder. */
export function participantIdentityWidth(input:{arrangement:'adjacent'|'portrait';figureSize:number;nameNatural:number;metaNatural:number}):number{
 const {arrangement,figureSize,nameNatural,metaNatural}=input;
 if(![figureSize,nameNatural,metaNatural].every(value=>Number.isFinite(value)&&value>=0)||figureSize===0)throw new RangeError('Invalid participant identity requirements');
 return arrangement==='adjacent'?Math.max(figureSize+nameNatural,figureSize-4+Math.max(72,metaNatural)):Math.max(participantFigureMinimumWidth(figureSize),nameNatural,metaNatural);
}
export function allocateParticipantIdentity(input:{width:number;arrangement:'adjacent'|'portrait';figureSize:number;nameNatural:number;metaNatural:number;textScale:number;shortLocal?:boolean}):ParticipantIdentityAllocation{
 const {width,arrangement,figureSize,nameNatural,metaNatural,textScale,shortLocal=false}=input;
 if(![width,figureSize,nameNatural,metaNatural,textScale].every(value=>Number.isFinite(value)&&value>=0)||width===0||figureSize===0||textScale===0)throw new RangeError('Invalid participant identity dimensions');
 const textX=arrangement==='adjacent'?figureSize-4:0,coreWidth=arrangement==='adjacent'?Math.min(width,participantIdentityWidth(input)):shortLocal?Math.min(width,84):width;
 return {width,arrangement,figureSize,figureHeight:figureSize*110/120,paintInsetTop:Math.ceil(-figureArtworkMetrics({width:figureSize,height:figureSize*110/120}).potential.y),coreWidth,nameWidth:Math.max(1,coreWidth-(arrangement==='adjacent'?figureSize:0)),metaWidth:Math.max(1,coreWidth-textX),textX,metaMinimum:(shortLocal?16:20)*textScale,shortLocal};
}
export interface ParticipantIdentityComposition {
 readonly height:number;readonly coreHeight:number;readonly figure:{x:number;y:number};readonly meta:{x:number;y:number};readonly name:{x:number;y:number};readonly feedback:{x:number;y:number};
}
export function composeParticipantIdentity(allocation:ParticipantIdentityAllocation,children:{name:Size;meta:Size;feedback:Size}):ParticipantIdentityComposition{
 const {arrangement,figureSize,figureHeight,coreWidth,textX,paintInsetTop}=allocation,{name,feedback}=children,meta={...children.meta,height:Math.max(children.meta.height,allocation.metaMinimum)};
 const adjacent=arrangement==='adjacent',textHeight=meta.height+2+name.height,metaY=paintInsetTop+(adjacent?Math.max(0,(figureHeight-textHeight)/2):allocation.shortLocal?figureSize/2:Math.max(0,figureHeight-figureSize*.14)),nameY=metaY+meta.height+2,coreHeight=Math.max(paintInsetTop+figureHeight,nameY+name.height),feedbackY=coreHeight+4;
 // On the original adjacent phone composition, text uses the figure's lower
 // shoulder; the name pill itself remains outside the artwork bounds.
 return {height:feedbackY+feedback.height,coreHeight,figure:{x:adjacent?0:(coreWidth-figureSize)/2,y:paintInsetTop},meta:{x:adjacent?textX:0,y:metaY},name:{x:adjacent?figureSize+(coreWidth-figureSize-name.width)/2:(coreWidth-name.width)/2,y:nameY},feedback:{x:0,y:feedbackY}};
}
