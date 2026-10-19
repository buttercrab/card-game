import type {PlannedNode} from './contracts';
type Attributes=Pick<HTMLElement,'setAttribute'|'removeAttribute'>;
/** Shared native paint path; popup semantics never install an action binding. */
export function paintNativeCardAccessibility(element:Attributes,node:PlannedNode,modalId:string|undefined,dialogDomId:string|undefined):void {
 if(node.kind==='card'){if(node.inspectCardId)element.setAttribute('aria-description','낼 수 없는 이유 보기');else if(node.accessibleDescription)element.setAttribute('aria-description',node.accessibleDescription);else element.removeAttribute('aria-description');}
 if(node.kind!=='card'||!node.cardId||node.inspectCardId){element.removeAttribute('aria-pressed');element.removeAttribute('aria-controls');if(node.kind==='card'){element.removeAttribute('aria-haspopup');element.removeAttribute('aria-expanded');}return;}
 element.setAttribute('aria-pressed',String(!!node.checked));
 if(node.hasPopup==='dialog'){
  const expanded=modalId==='card-action-dialog'&&node.popupExpanded===true&&!!node.checked&&typeof dialogDomId==='string'&&dialogDomId.length>0;
  element.setAttribute('aria-haspopup','dialog');element.setAttribute('aria-expanded',String(expanded));
  if(expanded&&dialogDomId!==undefined)element.setAttribute('aria-controls',dialogDomId);else element.removeAttribute('aria-controls');
 }else {element.removeAttribute('aria-haspopup');element.removeAttribute('aria-expanded');element.removeAttribute('aria-controls');}
}
