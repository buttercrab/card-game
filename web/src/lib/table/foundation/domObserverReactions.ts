import type {PresentationFrame} from './contracts';
import {transferHitTarget} from './transferPolicy';
/** Verifies planned passive paint against current native clips. Never relocates
 * content or grants input authority; a stale native gap simply stays hidden. */
export function paintObserverReactions(host:HTMLElement,frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>,ready:boolean):void{
 const root=frame.nodes.find(node=>node.observerReactionLayer),layer=root&&elements.get(root.id);if(!root||!layer)return;
 layer.style.pointerEvents='none';layer.style.opacity='0';layer.setAttribute('aria-hidden','true');
 if(!ready||frame.modalId||!host.contains(layer))return;
 const intersect=(a:DOMRect|{left:number;top:number;right:number;bottom:number},b:{left:number;top:number;right:number;bottom:number})=>({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
 const hostRect=host.getBoundingClientRect(),viewport=intersect(hostRect,{left:0,top:0,right:innerWidth,bottom:innerHeight}),bounds=layer.getBoundingClientRect();
 if(bounds.width<=0||bounds.height<=0||bounds.left<viewport.left-.5||bounds.top<viewport.top-.5||bounds.right>viewport.right+.5||bounds.bottom>viewport.bottom+.5)return;
 const heading=new Set(['room-shell','room-header','room-notices','room-notice-content']);
 const byId=new Map(frame.nodes.map(node=>[node.id,node])),headerBackgrounds=new Set<string>();
 if(root.observerReactionSlotId){
  const slotNode=byId.get(root.observerReactionSlotId),slot=elements.get(root.observerReactionSlotId);if(slotNode?.observerReactionSlot!==true||!slot||slot.childNodes.length||slot.dataset.foundationFrame!==String(frame.id)||slotNode.parent!=='room-header')return;
  const box=slot.getBoundingClientRect(),css=getComputedStyle(slot);if(css.display==='none'||css.visibility==='hidden'||css.backgroundImage!=='none'||!['rgba(0, 0, 0, 0)','transparent'].includes(css.backgroundColor)||css.boxShadow!=='none'||slot.inert||bounds.left<box.left-.5||bounds.top<box.top-.5||bounds.right>box.right+.5||bounds.bottom>box.bottom+.5)return;
  let parent:string|null=slotNode.parent,steps=0;while(parent&&steps++<frame.nodes.length){const owner=byId.get(parent),element=elements.get(parent);if(!owner||!element)return;const parentCss=getComputedStyle(element);if(element.inert||element.getAttribute('aria-hidden')==='true'||parentCss.visibility==='hidden'||parentCss.display==='none'||Number(parentCss.opacity)===0)return;if(/(auto|scroll|hidden|clip)/.test(`${parentCss.overflowX} ${parentCss.overflowY}`)){const clip=element.getBoundingClientRect();if(bounds.left<clip.left+element.clientLeft-.5||bounds.top<clip.top+element.clientTop-.5||bounds.right>clip.left+element.clientLeft+element.clientWidth+.5||bounds.bottom>clip.top+element.clientTop+element.clientHeight+.5)return;}if(heading.has(parent))headerBackgrounds.add(parent);parent=owner.parent;}
 }
 for(const text of layer.querySelectorAll<HTMLElement>('[data-foundation-kind=text]')){const node=byId.get(text.dataset.foundationNode??'');if(!node||node.kind!=='text'||text.textContent!==node.label)return;const range=document.createRange();range.selectNodeContents(text);const box=range.getBoundingClientRect();range.detach();if(box.left<bounds.left-.5||box.top<bounds.top-.5||box.right>bounds.right+.5||box.bottom>bounds.bottom+.5)return;}

 for(const node of frame.nodes){
  const element=elements.get(node.id);if(!element||element===layer||layer.contains(element)||node.id===root.observerReactionSlotId||node.kind==='group'&&headerBackgrounds.has(node.id))continue;
  let header=heading.has(node.id),ancestor=node.parent,steps=0;while(ancestor&&steps++<frame.nodes.length){if(heading.has(ancestor))header=true;ancestor=byId.get(ancestor)?.parent??null;}
  const readable=node.kind==='text'&&!!node.label.trim();
  if(!header&&!transferHitTarget(node)&&node.kind!=='figure'&&node.kind!=='card'&&node.kind!=='suit'&&node.kind!=='progress'&&node.stockCount===undefined&&!node.ownHandAnchor&&!readable)continue;
  let clip=viewport,painted=true;
  for(let parent:HTMLElement|null=element;parent&&host.contains(parent);parent=parent.parentElement){
   const css=getComputedStyle(parent);if(parent.hidden||parent.inert||parent.getAttribute('aria-hidden')==='true'||css.visibility==='hidden'||css.display==='none'||Number(css.opacity)===0){painted=false;break;}
   if(parent!==element&&/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)){const rect=parent.getBoundingClientRect();clip=intersect(clip,{left:rect.left+parent.clientLeft,top:rect.top+parent.clientTop,right:rect.left+parent.clientLeft+parent.clientWidth,bottom:rect.top+parent.clientTop+parent.clientHeight});}
  }
  if(!painted)continue;
  let rect:DOMRect=element.getBoundingClientRect();
  if(readable){const range=document.createRange();range.selectNodeContents(element);rect=range.getBoundingClientRect();range.detach();}
  let paint=intersect(rect,clip);if(paint.right<=paint.left||paint.bottom<=paint.top)continue;
  if(transferHitTarget(node))paint={left:paint.left-6,top:paint.top-6,right:paint.right+6,bottom:paint.bottom+6};
  if(Math.min(bounds.right,paint.right)>Math.max(bounds.left,paint.left)&&Math.min(bounds.bottom,paint.bottom)>Math.max(bounds.top,paint.top))return;
 }
 layer.style.opacity='1';layer.setAttribute('aria-hidden','false');
}
