import type {PlannedNode} from './contracts';
import {validateJointDecisionLayers} from './jointDecisionValidation';

/** Only independently admitted joint compositions may pass passive hits through. */
export function jointPointerNodeIds(nodes:readonly PlannedNode[]):ReadonlySet<string>{
    const admission=validateJointDecisionLayers(nodes);
    if(admission.errors.length)return new Set<string>();
    const roots=admission.parents,children=new Map<string,string[]>(),ids=new Set<string>();
    for(const node of nodes)if(node.parent){const row=children.get(node.parent)??[];row.push(node.id);children.set(node.parent,row);}
    const queue=[...roots];
    for(let index=0;index<queue.length;index++){const id=queue[index];if(ids.has(id))continue;ids.add(id);queue.push(...children.get(id)??[]);}
    return ids;
}

type PointerElement={readonly tagName:string;readonly style:Pick<CSSStyleDeclaration,'pointerEvents'>};
/** Hit paint never creates input: native disabled/inert/lease checks still own it. */
export function createJointPointerPaint(){
    const owned=new WeakSet<PointerElement>();
    return (element:PointerElement,node:Pick<PlannedNode,'scroll'|'observerReactionLayer'>,joint:boolean):void=>{
        if(node.observerReactionLayer){element.style.pointerEvents='none';if(joint)owned.add(element);return;}
        if(joint){
            element.style.pointerEvents=/^(BUTTON|SELECT|INPUT|TEXTAREA)$/.test(element.tagName)||node.scroll===true?'auto':'none';
            owned.add(element);
        }else if(owned.delete(element))element.style.pointerEvents='';
    };
}
