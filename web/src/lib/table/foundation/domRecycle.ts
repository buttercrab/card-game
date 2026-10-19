import type {PlannedNode,PresentationFrame,Rect} from './contracts';
import {isRecycleAdmission,type RecycleAdmission} from './recycle';
import {resourceRecycledDealPlan} from './transferMotion';
export interface PaintedRecycleOrigin {readonly kind?:'painted';readonly frameId:number;readonly proof:RecycleAdmission;readonly sourceNodeId:string;readonly box:Rect;readonly art:SVGSVGElement;readonly owner:string;}
export interface ResourceRecycleOrigin {readonly kind:'resource';readonly frameId:number;readonly proof:RecycleAdmission;readonly art:SVGSVGElement;readonly owner:string;}
export type RecycleOrigin=PaintedRecycleOrigin|ResourceRecycleOrigin;
interface Source {nodeId:string;captionId:string;element:HTMLElement;caption:HTMLElement;art:SVGSVGElement;box:Rect;captionBox:Rect;clip:Rect;alternative:string;handIds:readonly string[];}
interface Phase {frameId:number;proof:RecycleAdmission;owner:string;scope:string;environment:string;source:Source;root:HTMLDivElement;art:SVGSVGElement;caption:HTMLElement;ready:boolean;mask:boolean;raf:number|null;timer:ReturnType<typeof setTimeout>|null;opacity:string;captionOpacity:string;aria:string|null;captionAria:string|null;}
const rect=(value:DOMRect):Rect=>({x:value.left,y:value.top,width:value.width,height:value.height});
const inside=(a:Rect,b:Rect)=>[a.x,a.y,a.width,a.height,b.x,b.y,b.width,b.height].every(Number.isFinite)&&a.width>0&&a.height>0&&b.width>0&&b.height>0&&a.x>=b.x-.1&&a.y>=b.y-.1&&a.x+a.width<=b.x+b.width+.1&&a.y+a.height<=b.y+b.height+.1;
const equal=(a:Rect,b:Rect)=>['x','y','width','height'].every(key=>Math.abs(a[key as keyof Rect]-b[key as keyof Rect])<.1);
const context=(frame:PresentationFrame)=>JSON.stringify([frame.context.session,frame.context.audience,frame.context.generation]);
const stamp=(element:HTMLElement,id:string,frame:number)=>element.dataset.foundationNode===id&&element.dataset.foundationFrame===String(frame);
let sequence=0;
/** Clone only the current neutral SVG. References within its own defs receive
 * fresh IDs; all engine/native ownership metadata is removed. */
function cloneBack(source:SVGSVGElement):SVGSVGElement{
 const clone=source.cloneNode(true) as SVGSVGElement,ids=new Map<string,string>(),prefix=`foundation-recycle-art-${++sequence}-`;
 for(const element of [clone,...clone.querySelectorAll('*')]){
  if(element.id){ids.set(element.id,prefix+element.id);element.id=prefix+element.id;}
  for(const attribute of [...element.attributes])if(attribute.name.startsWith('data-foundation-')||attribute.name==='tabindex'||attribute.name==='aria-labelledby'||attribute.name==='aria-describedby')element.removeAttribute(attribute.name);
 }
 for(const element of [clone,...clone.querySelectorAll('*')])for(const attribute of [...element.attributes]){
  let value=attribute.value;for(const [oldId,newId] of ids){value=value.replaceAll(`url(#${oldId})`,`url(#${newId})`);if(attribute.localName==='href'&&value===`#${oldId}`)value=`#${newId}`;}if(value!==attribute.value)element.setAttributeNS(attribute.namespaceURI,attribute.name,value);
 }
 return clone;
}
/** A count-conserved, neutral presentation phase. It never manufactures a
 * canonical full stock, retains old faces, or supplies a game action. */
export function createDomRecycle(options:{host:HTMLElement;conceal(frameId:number,nodeIds:readonly string[],owner:string):boolean;onReady(origin:RecycleOrigin):void;onCancel(evidence:{readonly frameId:number;readonly owner:string;readonly proof:RecycleAdmission}):void;onIdle():void;current():PresentationFrame|null;ready():boolean;paint?:{recycle(frame:PresentationFrame,proof:RecycleAdmission):SVGSVGElement|null}}){
 let phase:Phase|null=null,epoch=0,lastFrame=0;let resourcePhase:{frame:PresentationFrame;proof:RecycleAdmission;owner:string;art:SVGSVGElement;handIds:readonly string[];meaning:string;ready:boolean;timer:ReturnType<typeof setTimeout>}|null=null;
 const resourceMeaning=(frame:PresentationFrame)=>JSON.stringify([context(frame),frame.environment,resourceRecycledDealPlan(frame.recycleAdmission!,frame).map(item=>[item.entityId,item.destination.kind,item.destination.node?.id])]);
 function stopResource(cancelled:boolean){const old=resourcePhase;resourcePhase=null;if(!old)return;clearTimeout(old.timer);if(old.handIds.length)try{options.conceal(old.frame.id,[],old.owner);}catch{}if(cancelled)try{options.onCancel(Object.freeze({frameId:old.frame.id,owner:old.owner,proof:old.proof}));}catch{}queueMicrotask(options.onIdle);}
 function resourceValid(frame:PresentationFrame,requireReady=true){return !!resourcePhase&&options.current()===frame&&(!requireReady||options.ready()===true)&&frame.recycleAdmission===resourcePhase.proof&&!frame.modalId&&resourceMeaning(frame)===resourcePhase.meaning;}
 function startResource(frame:PresentationFrame):boolean{const proof=frame.recycleAdmission!;if(!isRecycleAdmission(proof)||!resourceRecycledDealPlan(proof,frame).length)return false;const art=options.paint?.recycle(frame,proof);if(!art)return false;const handIds=Object.freeze(frame.nodes.filter(node=>node.kind==='card'&&node.zoneId==='hand'&&node.entityId).map(node=>node.id));const owner=`recycle-resource-${++sequence}`;const candidate={frame,proof,owner,art,handIds,meaning:resourceMeaning(frame),ready:false,timer:setTimeout(()=>stopResource(true),3500)};resourcePhase=candidate;let accepted=handIds.length===0;if(handIds.length)try{accepted=options.conceal(frame.id,handIds,owner)===true;}catch{}if(resourcePhase!==candidate)return false;if(!accepted||!resourceValid(frame,false)){stopResource(true);return false;}queueMicrotask(()=>{if(resourcePhase!==candidate)return;if(!resourceValid(candidate.frame)){stopResource(true);return;}candidate.ready=true;try{options.onReady(Object.freeze({kind:'resource',frameId:candidate.frame.id,proof,art,owner}));}catch{stopResource(true);}});return true;}
 const consumed=new Set<string>();
 const safe=(run:()=>void)=>{try{run();}catch{}};
 function source(frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>,proof:RecycleAdmission):Source|null{
  try{
   if(frame.modalId||frame.nodes.length>4096||context(frame)!==JSON.stringify([proof.toContext.session,proof.toContext.audience,proof.toContext.generation])||JSON.stringify(frame.rosterIds)!==JSON.stringify(proof.rosterIds))return null;
   const nodes=new Map<string,PlannedNode>();for(const node of frame.nodes){if(nodes.has(node.id))return null;nodes.set(node.id,node);}
   const allStocks=frame.nodes.filter(node=>node.stockCount!==undefined),expectedStocks=proof.collections.filter(collection=>collection.hiddenCount!==null);if(allStocks.length!==expectedStocks.length||expectedStocks.some(collection=>allStocks.filter(node=>node.zoneId===collection.id&&node.stockCount===collection.hiddenCount).length!==1))return null;
   const stocks=frame.nodes.filter(node=>node.stockCount!==undefined&&node.zoneId===proof.source),markers=frame.nodes.filter(node=>node.recycleAnchor!==undefined);
   const node=stocks[0];if(stocks.length!==1||markers.length!==1||markers[0]!==node||node.kind!=='card'||node.visual?.kind!=='back'||node.stockCount!==proof.newStock||node.recycleAnchor?.totalCount!==proof.totalCount||node.entityId||node.cardId||node.inspectCardId||node.recipientId)return null;
   const captionNode=nodes.get(node.recycleAnchor.captionId),element=elements.get(node.id),caption=captionNode&&elements.get(captionNode.id);
   if(!captionNode||captionNode.kind!=='text'||typeof captionNode.recycleCaption!=='string'||!captionNode.recycleCaption||captionNode.recycleCaption.length>500||captionNode.entityId||captionNode.actionId||!element||!caption||!stamp(element,node.id,frame.id)||!stamp(caption,captionNode.id,frame.id))return null;
   const art=element.firstElementChild;if(!(art instanceof SVGSVGElement)||!art.matches('[data-card-back]'))return null;
   const hand=frame.nodes.filter(node=>node.kind==='card'&&node.zoneId==='hand'&&node.entityId!==undefined);
   if(hand.length!==proof.newLocalCount||new Set(hand.map(node=>node.entityId)).size!==hand.length||hand.some(node=>node.ownerId!==undefined&&node.ownerId!==proof.localParticipantId))return null;
   const own=frame.nodes.filter(node=>node.ownHandAnchor!==undefined);if(proof.localParticipantId===null?own.length!==0:own.length!==1||own[0].ownHandAnchor!.participantId!==proof.localParticipantId||own[0].ownHandAnchor!.count!==proof.newLocalCount)return null;
   const recipients=frame.nodes.filter(node=>node.recipientId!==undefined);if(recipients.length!==proof.newRecipients.length||new Set(recipients.map(node=>node.recipientId)).size!==recipients.length||proof.newRecipients.some(peer=>!recipients.some(node=>node.recipientId===peer.participantId&&node.recipientCount===peer.count)))return null;
   const deal=frame.deals;if(deal?.length!==1||deal[0].id!==proof.deal.id||deal[0].source!==proof.source||deal[0].handCount!==proof.newLocalCount||deal[0].cardIds.length||JSON.stringify(deal[0].recipients??[])!==JSON.stringify(proof.deal.recipients))return null;
   const host=rect(options.host.getBoundingClientRect()),clip={x:Math.max(0,host.x),y:Math.max(0,host.y),width:Math.min(innerWidth,host.x+host.width)-Math.max(0,host.x),height:Math.min(innerHeight,host.y+host.height)-Math.max(0,host.y)};
   const artBox=rect(art.getBoundingClientRect()),captionBox=rect(caption.getBoundingClientRect());
   for(const [target,bounds] of [[art,artBox],[caption,captionBox]] as const){
    if(!inside(bounds,clip))return null;
    for(let parent:Element|null=target;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(css.display==='none'||css.visibility!=='visible'||css.zoom!=='1'&&css.zoom!=='normal'||css.transform!=='none'||css.perspective!=='none'||css.scale!=='none'||css.rotate!=='none'||css.translate!=='none')return null;
     if(/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)){const parentBox=parent.getBoundingClientRect();if(!inside(bounds,{x:parentBox.left+parent.clientLeft,y:parentBox.top+parent.clientTop,width:parent.clientWidth,height:parent.clientHeight}))return null;}
    }
   }
   return{nodeId:node.id,captionId:captionNode.id,element,caption,art,box:artBox,captionBox,clip,alternative:captionNode.recycleCaption,handIds:Object.freeze(hand.map(node=>node.id))};
  }catch{return null;}
 }
 function valid(candidate:Phase,frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>):boolean{
  if(phase!==candidate||frame.id<candidate.frameId||frame.recycleAdmission!==candidate.proof||context(frame)!==candidate.scope||JSON.stringify(frame.environment)!==candidate.environment)return false;
  const next=source(frame,elements,candidate.proof),old=candidate.source;
  return !!next&&next.element===old.element&&next.caption===old.caption&&next.art===old.art&&next.nodeId===old.nodeId&&next.captionId===old.captionId&&next.alternative===old.alternative&&JSON.stringify(next.handIds)===JSON.stringify(old.handIds)&&equal(next.box,old.box)&&equal(next.captionBox,old.captionBox)&&equal(next.clip,old.clip);
 }
 function stop(candidate:Phase,cancelled:boolean){
  if(phase!==candidate)return;phase=null;const token=++epoch;
  if(candidate.raf!==null)safe(()=>cancelAnimationFrame(candidate.raf!));if(candidate.timer!==null)safe(()=>clearTimeout(candidate.timer!));candidate.raf=null;candidate.timer=null;
  window.removeEventListener('resize',cancel);document.removeEventListener('scroll',scroll,true);safe(()=>candidate.root.remove());
  let current:PresentationFrame|null=null,ready=false;try{current=options.current();ready=options.ready()===true;}catch{}
  if(epoch===token&&current&&context(current)===candidate.scope&&ready){
   for(const [element,id,opacity,aria] of [[candidate.source.element,candidate.source.nodeId,candidate.opacity,candidate.aria],[candidate.source.caption,candidate.source.captionId,candidate.captionOpacity,candidate.captionAria]] as const){
    const node=current.nodes.find(node=>node.id===id);if(!node||!stamp(element,id,current.id)||!element.isConnected||element===candidate.source.element&&element.firstElementChild!==candidate.source.art)continue;
    safe(()=>{element.style.opacity=opacity;if(aria===null)element.removeAttribute('aria-hidden');else element.setAttribute('aria-hidden',aria);});
   }
  }
  if(candidate.mask)safe(()=>options.conceal(candidate.frameId,[],candidate.owner));
  if(cancelled&&epoch===token)safe(()=>options.onCancel(Object.freeze({frameId:candidate.frameId,owner:candidate.owner,proof:candidate.proof})));safe(options.onIdle);
 }
 function painted(element:Element):boolean{if(!element.isConnected)return false;for(let ancestor:Element|null=element;ancestor;ancestor=ancestor.parentElement){const css=getComputedStyle(ancestor);if(css.display==='none'||css.visibility!=='visible'||Number(css.opacity)<=0)return false;}return true;}
 function cancel(){stopResource(true);if(phase)stop(phase,true);}
 function currentValid(candidate:Phase):boolean{
  try{const current=options.current();return !!current&&current.id===candidate.frameId&&options.ready()===true&&valid(candidate,current,new Map([[candidate.source.nodeId,candidate.source.element],[candidate.source.captionId,candidate.source.caption]]));}catch{return false;}
 }
 function scroll(){const candidate=phase;if(candidate&&!currentValid(candidate))stop(candidate,true);}
 function expose(candidate:Phase){
  if(phase!==candidate)return;candidate.raf=requestAnimationFrame(()=>{candidate.raf=null;if(phase!==candidate)return;
   if(!currentValid(candidate)){stop(candidate,true);return;}
   candidate.root.style.opacity='1';candidate.raf=requestAnimationFrame(()=>{candidate.raf=null;if(phase!==candidate)return;
    if(!currentValid(candidate)){stop(candidate,true);return;}
    candidate.timer=setTimeout(()=>{candidate.timer=null;if(phase!==candidate)return;
     if(!currentValid(candidate)||!painted(candidate.root)||!painted(candidate.art)){stop(candidate,true);return;}
     candidate.ready=true;try{options.onReady(Object.freeze({frameId:candidate.frameId,proof:candidate.proof,sourceNodeId:candidate.source.nodeId,box:Object.freeze({...candidate.source.box}),art:candidate.art,owner:candidate.owner}));}catch{stop(candidate,true);}
    },160);
   });
  });
 }
 return{
  start(frame:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>):boolean{
   if(phase||resourcePhase||frame.id<lastFrame||!isRecycleAdmission(frame.recycleAdmission))return false;const proof=frame.recycleAdmission,key=JSON.stringify([context(frame),proof.transitionId]);if(consumed.has(key))return false;
   lastFrame=frame.id;consumed.add(key);while(consumed.size>256)consumed.delete(consumed.values().next().value!);
   if(frame.paintResources?.status==='available'&&!frame.nodes.some(node=>node.stockCount!==undefined&&node.zoneId===proof.source))return startResource(frame);
   const current=source(frame,elements,proof);if(!current||!painted(current.art)||!painted(current.caption))return false;
   const root=document.createElement('div'),art=cloneBack(current.art),caption=current.caption.cloneNode(true) as HTMLElement;for(const element of [caption,...caption.querySelectorAll('*')]){element.removeAttribute('id');for(const attribute of [...element.attributes])if(attribute.name.startsWith('data-foundation-')||attribute.name.startsWith('aria-')||attribute.name==='tabindex')element.removeAttribute(attribute.name);}caption.textContent=current.alternative;
   root.dataset.foundationRecycle='';root.setAttribute('role','img');root.setAttribute('aria-label',current.alternative);root.inert=false;
   Object.assign(root.style,{position:'fixed',left:`${current.clip.x}px`,top:`${current.clip.y}px`,width:`${current.clip.width}px`,height:`${current.clip.height}px`,overflow:'clip',pointerEvents:'none',zIndex:'99',contain:'strict',opacity:'0'});
   Object.assign(art.style,{position:'absolute',left:`${current.box.x-current.clip.x}px`,top:`${current.box.y-current.clip.y}px`,width:`${current.box.width}px`,height:`${current.box.height}px`,transform:'none',opacity:'1'});
   Object.assign(caption.style,{position:'absolute',left:`${current.captionBox.x-current.clip.x}px`,top:`${current.captionBox.y-current.clip.y}px`,width:`${current.captionBox.width}px`,height:`${current.captionBox.height}px`,transform:'none',opacity:'1'});root.append(art,caption);
   const candidate:Phase={frameId:frame.id,proof,owner:`recycle-${++sequence}`,scope:context(frame),environment:JSON.stringify(frame.environment),source:current,root,art,caption,ready:false,mask:false,raf:null,timer:null,opacity:current.element.style.opacity,captionOpacity:current.caption.style.opacity,aria:current.element.getAttribute('aria-hidden'),captionAria:current.caption.getAttribute('aria-hidden')};phase=candidate;++epoch;
   let accepted=current.handIds.length===0;candidate.mask=current.handIds.length>0;if(candidate.mask)try{accepted=options.conceal(frame.id,current.handIds,candidate.owner)===true;}catch{}
   if(phase!==candidate)return false;if(!accepted||!valid(candidate,frame,elements)){stop(candidate,true);return false;}
   try{current.element.style.opacity='0';current.element.setAttribute('aria-hidden','true');current.caption.style.opacity='0';current.caption.setAttribute('aria-hidden','true');document.body.append(root);window.addEventListener('resize',cancel);document.addEventListener('scroll',scroll,true);expose(candidate);return true;}catch{stop(candidate,true);return false;}
  },
  retain(next:PresentationFrame,elements:ReadonlyMap<string,HTMLElement>):boolean{
   if(resourcePhase){const candidate=resourcePhase;if(!resourceValid(next,false)){stopResource(true);return false;}candidate.frame=next;let accepted=candidate.handIds.length===0;if(candidate.handIds.length)try{accepted=options.conceal(next.id,candidate.handIds,candidate.owner)===true;}catch{}if(resourcePhase!==candidate)return false;if(!accepted){stopResource(true);return false;}return true;}
   const candidate=phase;if(!candidate)return false;if(!valid(candidate,next,elements)){stop(candidate,true);return false;}
   const previous=candidate.frameId;candidate.frameId=next.id;let accepted=!candidate.mask;if(candidate.mask)try{accepted=options.conceal(next.id,candidate.source.handIds,candidate.owner)===true;}catch{}
   if(phase!==candidate)return false;if(!accepted){candidate.frameId=previous;stop(candidate,true);return false;}
   candidate.source.element.style.opacity='0';candidate.source.element.setAttribute('aria-hidden','true');candidate.source.caption.style.opacity='0';candidate.source.caption.setAttribute('aria-hidden','true');lastFrame=Math.max(lastFrame,next.id);return true;
  },
  skip(frame:PresentationFrame){if(!isRecycleAdmission(frame.recycleAdmission))return;const key=JSON.stringify([context(frame),frame.recycleAdmission.transitionId]);consumed.add(key);while(consumed.size>256)consumed.delete(consumed.values().next().value!);lastFrame=Math.max(lastFrame,frame.id);},
  current(origin:RecycleOrigin,frame:PresentationFrame):boolean{if(origin.kind==='resource')return !!resourcePhase&&resourcePhase.ready&&origin.owner===resourcePhase.owner&&origin.art===resourcePhase.art&&origin.proof===resourcePhase.proof&&resourceValid(frame);const candidate=phase;if(!candidate||!candidate.ready||origin.owner!==candidate.owner||origin.proof!==candidate.proof||origin.art!==candidate.art||!painted(candidate.root)||!painted(candidate.art))return false;return valid(candidate,frame,new Map([[candidate.source.nodeId,candidate.source.element],[candidate.source.captionId,candidate.source.caption]]));},
  finish(){stopResource(false);if(phase)stop(phase,false);},clear:cancel,count(){return phase||resourcePhase?1:0;},
 };
}
