import type {PlannedNode} from './contracts';
/** Narrow horizontal overflow capability for an engine-owned readonly table.
 * This cannot carry scene identity, inputs or application navigation. */
export function validateReadonlyMatrixViewports(nodes:readonly PlannedNode[]):readonly string[]{
 const errors:string[]=[],children=new Map<string,PlannedNode[]>();for(const node of nodes)if(node.parent){const siblings=children.get(node.parent)??[];siblings.push(node);children.set(node.parent,siblings);}
 const forbidden:readonly(keyof PlannedNode)[]=['cardActionPickerIntent','cardActionOptionId','catalogueIntent','choiceLeaseId','entityId','ownerId','zoneId','recipientId','recipientCount','stockCount','ownHandAnchor','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor','cardId','inspectCardId','actionId','fieldId','optionId','localIntent','shellActionId','shellIntent','formIntent','formField','formNavigation','editor','preference','assistanceIntent','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','feedbackDismissId','formActionId','formLeaseId','inspectionPreviewFor','recycleAnchor','recycleCaption','publicDisclosureEventId','clockPaint','figureCue','participantStatusFor'];
 for(const root of nodes.filter(node=>node.readonlyMatrixViewport!==undefined)){
  const direct=children.get(root.id)??[];
  if(root.readonlyMatrixViewport!==true||root.kind!=='group'||root.semanticRole!=='group'||root.scrollAxis!==undefined&&root.scrollAxis!=='x'||root.scrollAxis==='x'&&!root.scroll||direct.length!==1||direct[0].kind!=='group'||direct[0].semanticRole!=='table'||direct[0].box.x!==0||direct[0].box.y!==0||direct[0].box.width<root.box.width||direct[0].box.height>root.box.height)errors.push(`Invalid readonly matrix viewport: ${root.id}`);
  const queue=[root],seen=new Set<string>();for(let index=0;index<queue.length;index++){const node=queue[index];if(seen.has(node.id)){errors.push('Cyclic readonly matrix viewport');break;}seen.add(node.id);queue.push(...children.get(node.id)??[]);
   if(!['group','text','card'].includes(node.kind)||node.enabled!==undefined||node!==root&&(node.scroll||node.readonlyMatrixViewport!==undefined)||forbidden.some(key=>node[key]!==undefined))errors.push(`Authority beneath readonly matrix viewport: ${node.id}`);
  }
 }
 // Generic single-content horizontal viewports are validated by validateLayout.
 // Only the explicit readonly-matrix marker grants the closed no-input tree.
 for(const root of nodes.filter(node=>node.scrollAxis==='x'&&node.readonlyMatrixViewport!==true)){
  const queue=[root],seen=new Set<string>();for(let index=0;index<queue.length;index++){const node=queue[index];if(seen.has(node.id))continue;seen.add(node.id);if(node.semanticRole==='table'){errors.push(`Unowned horizontal matrix viewport: ${root.id}`);break;}queue.push(...children.get(node.id)??[]);}
 }
 return errors;
}
