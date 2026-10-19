import {bubbleTypography} from './participantPolicy';
import {measureInlineCaption,type InlineCaptionAtom,type InlineCaptionPart,type InlineCaptionPlan} from './inlineCaption';
import type {Size} from './contracts';
/** Original Bubble announcement typography: text and SuitText share one measured recipe.
 * The preserved Bubble paints bids at weight700 too; its current numeric
 * legacy bid recipe carries600, so it cannot supply that typography authority. */
export function participantCaptionRecipe(textScale:number){
 if(!Number.isFinite(textScale)||textScale<=0)throw Error('Invalid participant caption scale');
 const source=bubbleTypography('bid',false,false,false),fontSize=source.fontSize*textScale;
 return Object.freeze({fontSize,lineHeight:fontSize*source.lineHeight,fontWeight:700,minHeight:source.minHeight*textScale,paddingX:6,paddingY:1,border:1});
}
export interface ParticipantCaptionPlan extends Size {readonly content:InlineCaptionPlan;readonly insetX:number;readonly insetY:number;}
/** Wrap only typed atoms/native text; no parsing or Cartesian captions. */
export function measureParticipantCaption(atoms:readonly InlineCaptionAtom[],width:number,textScale:number,read:(text:string,width:number|null)=>Size):ParticipantCaptionPlan{
 const recipe=participantCaptionRecipe(textScale),insetX=recipe.paddingX+recipe.border,insetY=recipe.paddingY+recipe.border,available=width-insetX*2;
 if(!Number.isFinite(width)||available<=0)throw Error('Participant caption cannot fit');
 const natural=measureInlineCaption(atoms,{mode:'inline',fontSize:recipe.fontSize,textScale,text:text=>read(text,null)}),space=read(' ',null).width,parts:InlineCaptionPart[]=[];
 let x=0,y=0,lineHeight=0,extent=0;
 for(const atom of atoms){
  const part=measureInlineCaption([atom],{mode:'inline',fontSize:recipe.fontSize,textScale,text:text=>read(text,available)});
  if(part.width>available)throw Error('Participant caption artwork cannot fit');
  if(x&&x+space+part.width>available){y+=lineHeight;x=0;lineHeight=0;}
  if(x)x+=space;
  parts.push(...part.parts.map(value=>Object.freeze({...value,x:value.x+x,y:value.y+y})));x+=part.width;extent=Math.max(extent,x);lineHeight=Math.max(lineHeight,part.height);
 }
 const content=Object.freeze({width:Math.min(available,Math.max(extent,Math.min(natural.width,available))),height:y+lineHeight,parts:Object.freeze(parts)}),height=Math.max(recipe.minHeight,content.height+insetY*2);
 return Object.freeze({width:Math.min(width,content.width+insetX*2),height,content,insetX,insetY:(height-content.height)/2});
}
