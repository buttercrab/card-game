import type {PresentationFrame} from './contracts';
import {essentialInputMask,type EssentialInputMask} from './essentialInput';
type NativeInput=HTMLButtonElement|HTMLSelectElement;
type RecordEntry={id:string;element:HTMLElement;opacity:string;aria:string|null;inert:boolean;tabIndex:number};
type Lease={frameId:number;offerId:string;owner:string;scope:string;recipe:EssentialInputMask;committed:boolean;records:Map<string,RecordEntry>};
const empty=():ReadonlySet<string>=>new Set<string>();
const scope=(frame:PresentationFrame):string|null=>{const context=frame.context;if(!context||[context.session,context.audience,context.generation].some(value=>typeof value!=='string'||!value||value.length>2048))return null;return JSON.stringify([context.session,context.audience,context.generation]);};
const native=(element:HTMLElement):element is NativeInput=>element instanceof HTMLButtonElement||element instanceof HTMLSelectElement;
const stamped=(element:HTMLElement,id:string,frameId:number)=>element.dataset.foundationNode===id&&element.dataset.foundationFrame===String(frameId);
const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every(id=>b.includes(id));
const sameRecipe=(a:EssentialInputMask,b:EssentialInputMask)=>a.kind===b.kind&&a.laneId===b.laneId&&same(a.inputIds,b.inputIds)&&same(a.laneNodeIds,b.laneNodeIds);
export function createEssentialSurface(options:{elements:ReadonlyMap<string,HTMLElement>;current():PresentationFrame|null;admit(frameId:number,owner:string,active:boolean):boolean;cancelGestures():void;ready():boolean;blur(element:HTMLElement):void}){
 let lease:Lease|null=null,revision=0;
 const active=(candidate:Lease)=>lease===candidate;
 const remember=(candidate:Lease,id:string,element:HTMLElement)=>{
  const previous=candidate.records.get(id);if(previous?.element===element)return true;
  candidate.records.set(id,{id,element,opacity:element.style.opacity,aria:element.getAttribute('aria-hidden'),inert:element.inert,tabIndex:element.tabIndex});return true;
 };
 function retire(candidate:Lease){
  if(!active(candidate))return;lease=null;const token=++revision;
  // Retire first: native freshness callbacks and the runtime release can reenter.
  let current:PresentationFrame|null=null,ready=false;
  try{current=options.current();if(revision===token)ready=options.ready()===true;}catch{}
  const currentRecipe=current&&scope(current)===candidate.scope&&essentialInputMask(current);
  if(revision===token&&ready&&current&&current.offerId===candidate.offerId&&currentRecipe&&sameRecipe(currentRecipe,candidate.recipe)){
   const nodes=new Map(current.nodes.map(node=>[node.id,node]));
   for(const record of candidate.records.values()){
    if(revision!==token)break;
    const node=nodes.get(record.id),element=options.elements.get(record.id);
    if(!node||element!==record.element||!stamped(element,record.id,current.id))continue;
    try{
     if(candidate.recipe.inputIds.includes(record.id)&&native(element))element.disabled=node.enabled!==true||!!node.inert;
     if(record.id===candidate.recipe.laneId){element.style.opacity=record.opacity;element.inert=!!node.inert;if(node.inert)element.setAttribute('aria-hidden','true');else if(record.aria===null)element.removeAttribute('aria-hidden');else element.setAttribute('aria-hidden',record.aria);}
     if(node.scroll&&candidate.recipe.laneNodeIds.includes(record.id))element.tabIndex=record.tabIndex;
    }catch{/* Continue draining other native resources. */}
   }
  }
  candidate.records.clear();
  try{options.admit(candidate.frameId,candidate.owner,false);}catch{}
 }
 function acknowledged(frame:PresentationFrame):boolean{
  const candidate=lease;if(!candidate?.committed||candidate.frameId!==frame.id||candidate.offerId!==frame.offerId||scope(frame)!==candidate.scope)return false;
  const recipe=essentialInputMask(frame);if(!recipe||!sameRecipe(recipe,candidate.recipe))return false;
  try{
   if(recipe.kind==='lane'){
    const root=options.elements.get(recipe.laneId),record=candidate.records.get(recipe.laneId);
    if(!root||record?.element!==root||!stamped(root,recipe.laneId,frame.id)||root.style.opacity!=='0'||Number(getComputedStyle(root).opacity)!==0||root.inert!==true||root.getAttribute('aria-hidden')!=='true')return false;
    for(const id of recipe.laneNodeIds){const element=options.elements.get(id);if(!element||!stamped(element,id,frame.id)||id!==recipe.laneId&&!root!.contains(element))return false;const node=frame.nodes.find(node=>node.id===id);if(native(element)&&(!recipe.inputIds.includes(id)||element.disabled!==true))return false;if(node?.scroll&&element.tabIndex!==-1)return false;}
   }
   for(const id of recipe.inputIds){const element=options.elements.get(id);if(!element||candidate.records.get(id)?.element!==element||!stamped(element,id,frame.id)||!native(element)||element.disabled!==true)return false;}
   return true;
  }catch{return false;}
 }
 function hidden(frame:PresentationFrame):ReadonlySet<string>{
  return acknowledged(frame)&&lease?.recipe.kind==='lane'?new Set(lease.recipe.laneNodeIds):empty();
 }

 return{
  begin(frame:PresentationFrame,owner:string):boolean{
   if(typeof owner!=='string'||!owner||owner!==owner.trim()||owner.length>128||!Number.isSafeInteger(frame.id)||frame.id<1)return false;
   const recipe=essentialInputMask(frame),frameScope=scope(frame);if(!recipe||!frameScope||lease&&(lease.owner!==owner||lease.scope!==frameScope||frame.id<lease.frameId))return false;
   const candidate:Lease={frameId:frame.id,offerId:frame.offerId,owner,scope:frameScope,recipe,committed:false,records:lease?.records??new Map()};lease=candidate;++revision;
   let accepted=false;try{accepted=options.admit(frame.id,owner,true)===true;}catch{}
   if(!active(candidate))return false;
   if(!accepted){retire(candidate);return false;}
   try{options.cancelGestures();}catch{retire(candidate);return false;}
   return active(candidate);
  },
  commit(frame:PresentationFrame,owner:string):boolean{
   const candidate=lease;if(!candidate||candidate.owner!==owner||candidate.frameId!==frame.id)return false;
   const recipe=essentialInputMask(frame);if(!recipe||frame.offerId!==candidate.offerId||scope(frame)!==candidate.scope||!sameRecipe(recipe,candidate.recipe)){retire(candidate);return false;}
   const retainedIds=new Set([...recipe.inputIds,...(recipe.kind==='lane'?[recipe.laneId,...frame.nodes.filter(node=>recipe.laneNodeIds.includes(node.id)&&node.scroll).map(node=>node.id)]:[])]);
   for(const id of candidate.records.keys())if(!retainedIds.has(id))candidate.records.delete(id);
   try{
    const root=recipe.kind==='lane'?options.elements.get(recipe.laneId):undefined;
    if(recipe.kind==='lane'&&(!root||!stamped(root,recipe.laneId,frame.id)||!remember(candidate,recipe.laneId,root)))throw Error('Missing essential lane');
    for(const id of recipe.laneNodeIds){const element=options.elements.get(id);if(!element||!stamped(element,id,frame.id)||id!==recipe.laneId&&!root!.contains(element))throw Error('Missing lane descendant');if(native(element)&&!recipe.inputIds.includes(id))throw Error('Unexpected essential native input');const node=frame.nodes.find(node=>node.id===id);if(node?.scroll&&!remember(candidate,id,element))throw Error('Replaced lane scroll');}
    for(const id of recipe.inputIds){const element=options.elements.get(id);if(!element||!stamped(element,id,frame.id)||!native(element)||!remember(candidate,id,element))throw Error('Missing essential input');}
    if(root){root.style.opacity='0';root.inert=true;root.setAttribute('aria-hidden','true');}
    for(const id of recipe.laneNodeIds){const node=frame.nodes.find(node=>node.id===id);if(node?.scroll)options.elements.get(id)!.tabIndex=-1;}
    for(const id of recipe.inputIds)(options.elements.get(id)! as NativeInput).disabled=true;
    const focused=(root??options.elements.get(recipe.inputIds[0]))?.ownerDocument.activeElement;
    if(focused instanceof HTMLElement&&(root?.contains(focused)||recipe.inputIds.some(id=>options.elements.get(id)===focused)))options.blur(focused);
    if(!active(candidate))return false;candidate.committed=true;
    if(!acknowledged(frame))throw Error('Incomplete essential native mask');return true;
   }catch{retire(candidate);return false;}
  },
  release(frameId:number,owner:string){if(lease?.frameId===frameId&&lease.owner===owner)retire(lease);},
  hidden,acknowledged,
  blocked(id:string){return lease?.recipe.inputIds.includes(id)??false;},
  clear(){if(lease)retire(lease);},
 };
}
