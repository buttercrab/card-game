import type {PlannedNode} from './contracts';
/** A passive layer can neither acquire scene identity nor carry a hidden input
 * binding. The application provides only admitted reaction meaning. */
export function validateObserverReactionLayers(nodes:readonly PlannedNode[],rootId:string|undefined,modalId?:string):readonly string[]{
 const errors:string[]=[],layers=nodes.filter(node=>node.observerReactionLayer!==undefined);
 if(layers.length>1)return ['Multiple observer reaction layers'];
 const children=new Map<string,PlannedNode[]>();for(const node of nodes)if(node.parent){let siblings=children.get(node.parent);if(!siblings){siblings=[];children.set(node.parent,siblings);}siblings.push(node);}
 const byId=new Map(nodes.map(node=>[node.id,node])),slots=nodes.filter(node=>node.observerReactionSlot!==undefined);
 if(slots.length>1)errors.push('Multiple observer reaction slots');
 const slotKeys=new Set(['id','parent','kind','label','box','observerReactionSlot']);
 for(const slot of slots){const parent=slot.parent?byId.get(slot.parent):undefined;if(slot.observerReactionSlot!==true||slot.kind!=='group'||slot.label!==''||parent?.id!=='room-header'||(children.get(slot.id)?.length??0)!==0||Object.keys(slot).some(key=>!slotKeys.has(key))||slot.box.width<44||slot.box.height<44||slot.box.x<0||slot.box.y<0||slot.box.x+slot.box.width>parent.box.width||slot.box.y+slot.box.height>parent.box.height)errors.push(`Invalid observer reaction slot: ${slot.id}`);}
 const absolute=(node:PlannedNode)=>{let x=node.box.x,y=node.box.y,parent=node.parent,steps=0;while(parent){const owner=byId.get(parent);if(!owner||++steps>nodes.length)return null;x+=owner.box.x;y+=owner.box.y;parent=owner.parent;}return{x,y,width:node.box.width,height:node.box.height};};
 const forbidden=['cardActionPickerIntent','cardActionOptionId','catalogueIntent','choiceLeaseId','entityId','ownerId','zoneId','collectionPurpose','recipientId','recipientCount','stockCount','ownHandAnchor','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor','cardId','inspectCardId','actionId','fieldId','optionId','localIntent','shellIntent','shellActionId','shellSlot','preference','editor','formIntent','formActionId','formField','formNavigation','formLeaseId','modalLeaseId','disclosureIntent','disclosureCatalogId','disclosureFormActionId','assistanceIntent','feedbackDismissId','clockPaint','figureCue','visual','publicDisclosureEventId','participantStatusFor'] as const;
 for(const layer of layers){
  if(layer.observerReactionSlotId!==undefined){const slot=slots.find(node=>node.id===layer.observerReactionSlotId),box=slot&&absolute(slot);if(!box||layer.box.x<box.x||layer.box.y<box.y||layer.box.x+layer.box.width>box.x+box.width||layer.box.y+layer.box.height>box.y+box.height)errors.push(`Observer layer escapes empty header slot: ${layer.id}`);}
  if(layer.observerReactionLayer!==true||layer.parent!==rootId||layer.kind!=='group'||layer.semanticRole!=='group'||modalId)errors.push(`Invalid observer reaction layer: ${layer.id}`);
  const queue=[layer],seen=new Set<string>();for(let index=0;index<queue.length;index++){const node=queue[index];if(seen.has(node.id)){errors.push('Cyclic observer reaction layer');break;}seen.add(node.id);queue.push(...children.get(node.id)??[]);
   if(node.observerReactionSlot!==undefined||node!==layer&&node.observerReactionSlotId!==undefined||!['group','text'].includes(node.kind)||node.enabled!==undefined||node.scroll||node.semanticRole&&!['group','status'].includes(node.semanticRole)||forbidden.some(key=>node[key]!==undefined))errors.push(`Authority beneath observer reaction layer: ${node.id}`);
  }
 }
 return errors;
}
