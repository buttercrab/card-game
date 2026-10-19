import type {PresentationFrame} from './contracts';
/** Postpatch receipt only. Runtime separately validates its closed semantic
 * recipe and event; this checks the actual native tree, never just markers. */
export function nativeCompletionInputReady(host:HTMLElement,frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>):boolean{
 try{
  if(!frame.publicCompletion||frame.modalId||frame.decisionLaneId||frame.outcomeLaneId)return false;
  const nodes=new Map(frame.nodes.map(node=>[node.id,node]));if(nodes.size!==frame.nodes.length)return false;
  for(const node of frame.nodes){const element=elements.get(node.id);if(!element||!host.contains(element)||element.dataset.foundationFrame!==String(frame.id)||element.dataset.foundationNode!==node.id)return false;}
  for(const element of host.querySelectorAll<HTMLElement>('[data-foundation-node]')){const id=element.dataset.foundationNode;if(!id||elements.get(id)!==element||!nodes.has(id)||element.dataset.foundationFrame!==String(frame.id))return false;}
  for(const element of host.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[contenteditable="true"]')){
   const id=element.dataset.foundationNode,node=id?nodes.get(id):undefined;
   if(element.tagName!=='BUTTON'||!node||elements.get(node.id)!==element||element.dataset.foundationFrame!==String(frame.id)||node.kind!=='command'||!node.shellIntent||node.actionId!==undefined||node.cardId!==undefined||node.inspectCardId!==undefined||node.fieldId!==undefined||node.formIntent!==undefined||node.formField!==undefined||node.editor!==undefined||node.preference!==undefined||node.enabled!==true&&(element as HTMLButtonElement).disabled!==true)return false;
  }
  return true;
 }catch{return false;}
}
