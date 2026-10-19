import type {Rect,Size} from './contracts';

/** Existing five-place public-card recipe, shared by admission and paint.
 * The outer side cards overlap the upper cards vertically; their horizontal
 * separation therefore owns the minimum width, including the ordinary gap. */
export function directionalTrickRecipe(inputCard:Size={width:64,height:90},gap=12){
 const card=Object.freeze({width:inputCard.width,height:inputCard.height});
 if(![card.width,card.height,gap].every(value=>Number.isFinite(value)&&value>=0)||card.width===0||card.height===0)throw Error('Invalid directional trick dimensions');
 const minimumWidth=3*(card.width*1.5+gap),height=card.height*2+gap;
 return Object.freeze({card,gap,minimumWidth,height,slots(width:number):readonly Rect[]|null{
  if(!Number.isFinite(width)||width<minimumWidth)return null;
  const sideY=(card.height+gap)/2;
  // Canonical relative order: bottom, right, upper-right, upper-left, left.
  return [{x:(width-card.width)/2,y:card.height+gap},{x:width-card.width,y:sideY},{x:width*2/3-card.width/2,y:0},{x:width/3-card.width/2,y:0},{x:0,y:sideY}].map(point=>({...point,...card}));
 }});
}
export const REGULAR_TRICK=directionalTrickRecipe();
