import {calculateReadableHandLayout,HAND_SELECTION_PADDING} from '../handLayout';
import {SELECTION_LIFT} from './selectionMotion';
import type {CandidateLayout,Environment,PlannedNode,Rect} from './contracts';
export type HandGeometryEnvironment=Pick<Environment,'width'|'height'|'scrollbarHeight'>;
const sameBox=(a:Rect,b:Rect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const closed=(node:PlannedNode,keys:readonly string[])=>Object.keys(node).every(key=>keys.includes(key)||(node as unknown as Record<string,unknown>)[key]===undefined);
const groupKeys=['id','parent','kind','label','arrangement','box'];
const cardKeys=['id','parent','kind','label','box','entityId','ownerId','zoneId','visual','emphasis','cardId','inspectCardId','checked','enabled','unavailable','hinted','decisionGroupId','hasPopup','popupExpanded','accessibleDescription'];
function handVisual(value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
 const fields=Object.getOwnPropertyDescriptors(value),kind=fields.kind?.value,keys=kind==='standard'?['kind','suit','rank']:kind==='joker'?['kind','color']:kind==='back'?['kind']:[];
 if(!keys.length||Reflect.ownKeys(fields).length!==keys.length||keys.some(key=>!fields[key]||!('value'in fields[key])||!fields[key].enumerable))return false;
 return kind==='standard'?['Spade','Heart','Diamond','Club'].includes(fields.suit.value)&&typeof fields.rank.value==='number'&&Number.isFinite(fields.rank.value):kind==='joker'?['Black','Red'].includes(fields.color.value):kind==='back';
}
/** This recognizes hand paint geometry, not a newly public card-face proof.
 * No marker grants a smaller corner. Recognize the complete actual own-hand
 * hierarchy only after recomputing its canonical layout for the real viewport
 * and allocated width. Native action, clipping and glyph guards remain separate. */
export function canonicalOwnHandFanSteps(layout:CandidateLayout,environment:HandGeometryEnvironment|undefined):ReadonlyMap<string,number>{
 const unavailable=new Map<string,number>();try{
  if(!environment||![environment.width,environment.height].every(value=>Number.isFinite(value)&&value>0)||!Number.isFinite(environment.scrollbarHeight??0)||(environment.scrollbarHeight??0)<0)return unavailable;
  const nodes=new Map(layout.nodes.map(node=>[node.id,node]));if(nodes.size!==layout.nodes.length)return unavailable;
  const hand=nodes.get('hand'),fan=nodes.get('hand-fan');if(!hand||!fan||hand.kind!=='group'||hand.semanticRole!=='group'||hand.arrangement!=='ordinary'||!closed(hand,[...groupKeys,'semanticRole','scroll','scrollAxis'])||hand.box.width<=0||hand.label!=='내 카드'&&hand.label!=='내 카드 · 가로 스크롤'||fan.parent!=='hand'||fan.kind!=='group'||fan.label!==''||!closed(fan,groupKeys))return unavailable;
  if(layout.nodes.filter(node=>node.parent==='hand').length!==1)return unavailable;
  const two=fan.arrangement==='ordinary',rowNodes=two?layout.nodes.filter(node=>node.parent===fan.id):[fan];
  if(two&&(rowNodes.length!==2||rowNodes.some((node,index)=>node.id!==JSON.stringify(['hand','row',String(index)])||node.kind!=='group'||node.arrangement!=='fan'||node.label!==''||!closed(node,groupKeys))))return unavailable;
  if(!two&&fan.arrangement!=='fan')return unavailable;
  const cards=rowNodes.flatMap(row=>layout.nodes.filter(node=>node.parent===row.id));if(!cards.length||new Set(cards.map(node=>node.entityId)).size!==cards.length)return unavailable;
  const anchors=layout.nodes.filter(node=>node.ownHandAnchor!==undefined);if(anchors.length!==1||anchors[0].ownHandAnchor!.count!==cards.length)return unavailable;
  const owner=anchors[0].ownHandAnchor!.participantId;
  if(cards.some(node=>node.kind!=='card'||!node.entityId||node.id!==JSON.stringify(['hand','card',node.entityId])||node.zoneId!=='hand'||node.ownerId!==undefined&&node.ownerId!==owner||!closed(node,cardKeys)||!handVisual(node.visual)||node.cardId!==undefined&&node.cardId!==node.entityId||node.inspectCardId!==undefined&&node.inspectCardId!==node.entityId||!!node.cardId&&!!node.inspectCardId||node.checked===true&&!node.cardId||node.enabled!==undefined&&!node.cardId&&!node.inspectCardId))return unavailable;
  const interactive=cards.some(node=>node.cardId!==undefined);
  for(const selection of interactive?[true]:[false,true]){
   const lift=selection?SELECTION_LIFT:0,padding=selection?HAND_SELECTION_PADDING:0,plan=calculateReadableHandLayout({regionWidth:hand.box.width,viewportWidth:environment.width,viewportHeight:environment.height,selectionLift:lift,padding,scrollbarHeight:environment.scrollbarHeight??0,count:cards.length});
   if(plan.rows.length!==rowNodes.length||hand.box.height!==plan.height||hand.scroll!==plan.scroll||hand.scrollAxis!==(plan.scroll?'x':undefined)||hand.label!==(plan.scroll?'내 카드 · 가로 스크롤':'내 카드')||!sameBox(fan.box,{x:0,y:0,width:plan.contentWidth,height:plan.bodyHeight}))continue;
   if(two&&rowNodes.some((row,index)=>!sameBox(row.box,{x:plan.rows[index].x,y:plan.rows[index].y,width:plan.rows[index].width,height:plan.rows[index].height})))continue;
   let match=true;
   for(let index=0;index<cards.length;index++){
    const card=cards[index],expected=plan.cards[index],row=plan.rows[expected.row],parent=two?rowNodes[expected.row]:fan;
    if(card.parent!==parent.id||!sameBox(card.box,{x:expected.x-(two?row.x:0),y:expected.y-(two?row.y:0)-(card.checked===true?lift:0),width:expected.width,height:expected.height})){match=false;break;}
   }
   if(match)return new Map(rowNodes.map(row=>[row.id,plan.minimumStep]));
  }
  return unavailable;
 }catch{return unavailable;}
}
