import {decisionGroupNodeId} from './decisions';
import type {PlannedNode,PresentationFrame} from './contracts';
export type EssentialInputMask =
 | {readonly kind:'lane';readonly laneId:string;readonly inputIds:readonly string[];readonly laneNodeIds:readonly string[]}
 | {readonly kind:'native-cards';readonly laneId?:undefined;readonly inputIds:readonly string[];readonly laneNodeIds:readonly string[]};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=2048;
const hostKeys:readonly (keyof PlannedNode)[]=['cardActionPickerIntent','catalogueIntent','localIntent','shellIntent','shellActionId','shellSlot','shellIcon','connectionState','editor','formIntent','formActionId','formNavigation','formField','formLeaseId','preference','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','assistanceIntent','feedbackDismissId','publicDisclosureEventId','inspectionPreviewFor'];
const selectionInput=(node:PlannedNode)=>(node.id==='card-selection-submit'||id(node.decisionGroupId)&&node.id===decisionGroupNodeId(node.decisionGroupId,'card-selection-submit'))&&node.kind==='command'&&node.localIntent==='submit-card-set'&&!node.actionId&&!node.fieldId&&!node.cardId&&!node.inspectCardId&&!node.cardActionOptionId;
const catalogueInput=(node:PlannedNode)=>node.kind==='command'&&node.catalogueIntent?.kind==='open'&&id(node.catalogueIntent.fieldId)&&!node.actionId&&!node.cardId&&!node.fieldId&&!node.localIntent&&!node.cardActionOptionId;
const pickerInput=(node:PlannedNode)=>node.kind==='command'&&node.cardActionPickerIntent?.kind==='open'&&node.cardActionPickerIntent.leaseId===undefined&&!node.actionId&&!node.cardId&&!node.fieldId&&!node.optionId&&!node.localIntent&&!node.catalogueIntent&&!node.cardActionOptionId;
const decisionControl=(node:PlannedNode)=>selectionInput(node)||catalogueInput(node)||pickerInput(node);
const foreign=(node:PlannedNode)=>hostKeys.some(key=>node[key]!==undefined&&!(key==='localIntent'&&selectionInput(node)||key==='catalogueIntent'&&catalogueInput(node)||key==='cardActionPickerIntent'&&pickerInput(node)));
// The settled result is a closed paint-and-continuation lane, never a generic
// host capability container. Undefined optional presentation fields are inert.
const outcomeKeys=new Set(['id','parent','box','kind','label','role','textAlign','arrangement','semanticRole','inert','decoration','visual','emphasis','tone','suit','intent','enabled','actionId','decisionGroupId','localIntent','disclosureCatalogId','scroll','scrollAxis','scrollbarGutter']);
function outcomeInput(node:PlannedNode,catalogId?:string):boolean{if(node.disclosureCatalogId!==undefined)return node.kind==='command'&&id(catalogId)&&node.disclosureCatalogId===catalogId&&node.actionId===undefined&&node.localIntent===undefined;return node.kind==='command'&&node.localIntent==='toggle-information'&&node.actionId===undefined;}
function outcomeNode(node:PlannedNode,catalogId?:string):boolean{
 if(node.decisionGroupId!==undefined)return false;
 if(Object.keys(node).some(key=>!outcomeKeys.has(key)&&(node as unknown as Record<string,unknown>)[key]!==undefined)||!['group','text','suit','card','command'].includes(node.kind)||node.semanticRole!==undefined&&!['group','status'].includes(node.semanticRole))return false;
 if(node.visual!==undefined&&node.kind!=='card'||node.suit!==undefined&&node.kind!=='suit'||node.kind!=='command'&&node.enabled!==undefined)return false;
 if(node.localIntent!==undefined&&!outcomeInput(node,catalogId))return false;
 if(node.disclosureCatalogId!==undefined&&!outcomeInput(node,catalogId))return false;
 if(node.kind==='command')return outcomeInput(node,catalogId)||id(node.actionId)&&node.localIntent===undefined;
 return node.actionId===undefined&&node.localIntent===undefined&&(node.kind==='card'||node.visual===undefined)&&(node.kind==='suit'||node.suit===undefined);
}
const gameKeys:readonly (keyof PlannedNode)[]=['actionId','fieldId','cardId','inspectCardId','cardActionOptionId'];
function gameInput(node:PlannedNode):boolean{
 if(decisionControl(node))return true;
 const bindings=gameKeys.filter(key=>node[key]!==undefined);if(bindings.length!==1||!id(node[bindings[0]]))return false;
 return node.cardActionOptionId!==undefined?node.kind==='choice'&&node.optionId===undefined:node.actionId!==undefined?node.kind==='command':node.fieldId!==undefined?node.kind==='choice'&&id(node.optionId)||node.kind==='select':node.kind==='card';
}
/** A bounded internal masking recipe, never permission to execute a command.
 * The native adapter still proves the complete lane hidden/inert and every
 * input disabled before using it to settle essential deal geometry. */
export function essentialInputMask(frame:PresentationFrame):EssentialInputMask|null{
 try{
  const native=frame.essentialInputKind==='native-cards';
  if(frame.essentialInputKind!==undefined&&!native||native&&(frame.settled===true||frame.outcomeLaneId!==undefined||frame.decisionLaneId!==undefined))return null;
  const result=frame.settled===true&&frame.outcomeLaneId==='outcome';
  if(frame.outcomeLaneId!==undefined&&!result||result&&frame.decisionLaneId!==undefined)return null;
  const laneId=result?'outcome':frame.decisionLaneId;
  if(!native&&!laneId||frame.modalId!==undefined||(!native&&!result&&laneId!=='decisions')||!Array.isArray(frame.nodes)||frame.nodes.length<3||frame.nodes.length>4096)return null;
  const nodes=new Map<string,PlannedNode>(),children=new Map<string,string[]>();
  for(const node of frame.nodes){
   if(!node||!id(node.id)||nodes.has(node.id)||node.parent!==null&&!id(node.parent))return null;
   nodes.set(node.id,node);
  }
  const root=nodes.get('table'),underlay=nodes.get('table-underlay'),lane=laneId?nodes.get(laneId):undefined;
  if(!root||root.parent!==null||root.kind!=='group'||!underlay||underlay.parent!=='table'||underlay.kind!=='group'||!native&&(!lane||lane.kind!=='group'||lane===root||lane===underlay))return null;
  for(const node of nodes.values()){
   if(node.parent===null){if(node!==root)return null;continue;}
   if(!nodes.has(node.parent))return null;
   const list=children.get(node.parent)??[];list.push(node.id);children.set(node.parent,list);
  }
  // One rooted traversal proves references, connectivity and absence of cycles
  // in linear work, even for the maximum-depth admitted presentation.
  const connected=new Set<string>(),queue=['table'];
  for(let index=0;index<queue.length;index++){const current=queue[index];if(connected.has(current))return null;connected.add(current);queue.push(...children.get(current)??[]);}
  if(connected.size!==nodes.size)return null;
  if(native){
   const hand=nodes.get('hand');if(!hand||hand.kind!=='group')return null;
   let ancestor:PlannedNode|undefined=hand,underlaySeen=false;
   while(ancestor){
    if(ancestor.kind!=='group'||foreign(ancestor)||ancestor.inert||ancestor.semanticRole==='dialog'||ancestor.semanticRole==='alertdialog'||ancestor.entityId!==undefined||ancestor.zoneId!==undefined||ancestor.ownerId!==undefined||ancestor.stockCount!==undefined||ancestor.trickSlot!==undefined||ancestor.ownHandAnchor!==undefined||ancestor.id==='room-header')return null;
    if(ancestor===underlay)underlaySeen=true;
    ancestor=ancestor.parent===null?undefined:nodes.get(ancestor.parent);
   }
   if(!underlaySeen)return null;
   const handIds=new Set<string>(),queue=['hand'];
   for(let index=0;index<queue.length;index++){handIds.add(queue[index]);queue.push(...children.get(queue[index])??[]);}
   const inputIds:string[]=[],cards=new Set<string>();
   for(const node of nodes.values()){
    const bound=gameKeys.some(key=>node[key]!==undefined)||decisionControl(node);
    if(handIds.has(node.id)&&(foreign(node)||['command','choice','select','editor','toggle','range'].includes(node.kind)))return null;
    if(!bound)continue;
    const card=node.cardId??node.inspectCardId;
    if(!handIds.has(node.id)||foreign(node)||!gameInput(node)||node.kind!=='card'||!id(card)||card!==node.entityId||node.zoneId!=='hand'||node.optionId!==undefined||node.collectionPurpose!==undefined||node.recipientId!==undefined||node.recipientCount!==undefined||node.stockCount!==undefined||node.collectedBy!==undefined||node.trickSlot!==undefined||node.ownHandAnchor!==undefined||node.participantFeedbackFor!==undefined||node.identityMetaFor!==undefined||node.participantStatusFor!==undefined||node.recycleAnchor!==undefined||node.recycleCaption!==undefined||node.inert||cards.has(card))return null;
    cards.add(card);inputIds.push(node.id);
   }
   if(!inputIds.length||!inputIds.some(id=>nodes.get(id)!.enabled===true))return null;
   return Object.freeze({kind:'native-cards',inputIds:Object.freeze(inputIds),laneNodeIds:Object.freeze([])});
  }
  let ancestor:PlannedNode|undefined=lane;let underlaySeen=false;
  while(ancestor){
   if(ancestor.kind!=='group'||ancestor.entityId!==undefined||ancestor.zoneId!==undefined||ancestor.ownerId!==undefined||ancestor.recipientId!==undefined||ancestor.stockCount!==undefined||ancestor.participantFeedbackFor!==undefined||ancestor.identityMetaFor!==undefined||ancestor.trickSlot!==undefined||ancestor.collectedBy!==undefined||ancestor.ownHandAnchor!==undefined||['hand','dock','identity','arena'].includes(ancestor.id)||foreign(ancestor)||ancestor.inert||ancestor.semanticRole==='dialog'||ancestor.semanticRole==='alertdialog'||ancestor.id==='room-header')return null;
   if(ancestor===underlay)underlaySeen=true;
   ancestor=ancestor.parent===null?undefined:nodes.get(ancestor.parent);
  }
  if(!underlaySeen)return null;
  if(!laneId)return null;
  const captionSuit=(node:PlannedNode):boolean=>{
   if(node.kind!=='suit'||!['Spade','Heart','Diamond','Club'].includes(node.suit??'')||!node.parent||children.has(node.id))return false;
   const parent=nodes.get(node.parent);if(!parent||parent.paintChildren!==true||!['command','choice'].includes(parent.kind)||foreign(parent)||!gameInput(parent))return false;
   const allowed=new Set(['id','parent','box','kind','suit','label']);return Object.keys(node).every(key=>allowed.has(key)||(node as unknown as Record<string,unknown>)[key]===undefined);
  };
  const laneNodeIds:string[]=[],laneQueue=[laneId];let laneInputs=0;
  for(let index=0;index<laneQueue.length;index++){
   const node=nodes.get(laneQueue[index])!;
   if(result){if(!outcomeNode(node,frame.outcomeReadCatalogId))return null;if(node.actionId!==undefined||outcomeInput(node,frame.outcomeReadCatalogId))laneInputs++;laneNodeIds.push(node.id);laneQueue.push(...children.get(node.id)??[]);continue;}
   if(foreign(node)||!['group','text','command','choice','select'].includes(node.kind)&&!captionSuit(node)||node.semanticRole==='dialog'||node.semanticRole==='alertdialog'||node.entityId!==undefined||node.zoneId!==undefined||node.ownerId!==undefined||node.recipientId!==undefined||node.recipientCount!==undefined||node.stockCount!==undefined||node.participantFeedbackFor!==undefined||node.identityMetaFor!==undefined||node.trickSlot!==undefined||node.collectedBy!==undefined||node.ownHandAnchor!==undefined||node.collectionPurpose!==undefined||node.visual!==undefined||node.cardId!==undefined||node.inspectCardId!==undefined)return null;
   const bound=decisionControl(node)||gameKeys.some(key=>node[key]!==undefined);
   if(bound&&!gameInput(node)||['command','choice','select'].includes(node.kind)&&!bound)return null;
   if(bound)laneInputs++;
   laneNodeIds.push(node.id);laneQueue.push(...children.get(node.id)??[]);
  }
  if(!laneInputs)return null;
  const inputIds:string[]=[];
  for(const node of nodes.values()){
   if(result&&laneNodeIds.includes(node.id)&&outcomeInput(node,frame.outcomeReadCatalogId)){inputIds.push(node.id);continue;}
   if(foreign(node))continue;
   if(!decisionControl(node)&&!gameKeys.some(key=>node[key]!==undefined))continue;
   if(!gameInput(node))return null;
   inputIds.push(node.id);
  }
  return Object.freeze({kind:'lane',laneId,inputIds:Object.freeze(inputIds),laneNodeIds:Object.freeze(laneNodeIds)});
 }catch{return null;}
}
