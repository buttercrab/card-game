import type {CandidateLayout,PresentationFrame,Rect,Size} from './contracts';
import {participantIdentityStructure} from './participantHandoff';
/** The existing side-row owner distinguishes its allocated column from the
 * current hand body. This function changes neither placement nor row size. */
export function composeSideDockRow(input:{identity:Size;hand:Size;padding:number;gap:number;short:boolean}){
 const {identity,hand,padding,gap,short}=input,y=short?0:padding,height=Math.max(identity.height,hand.height);
 return {height:height+(short?padding:padding*2),identity:{x:padding,y},hand:{x:padding+identity.width+gap,y},receive:{x:padding+identity.width+gap,y,width:hand.width,height}};
}
export interface OwnDockReceiveAllocation {readonly kind:'empty-hand-column';readonly participantId:string;readonly bounds:Rect;}
interface CandidateProof {participantId:string;bounds:Rect;fingerprint:string;}
const candidates=new WeakMap<CandidateLayout,CandidateProof>();
function fingerprint(layout:CandidateLayout){const children=new Map<string,string[]>();for(const n of layout.nodes)if(n.parent){const row=children.get(n.parent)??[];row.push(n.id);children.set(n.parent,row);}const ids=new Set<string>(),queue=['dock'];for(let i=0;i<queue.length;i++){const id=queue[i];if(ids.has(id))continue;ids.add(id);queue.push(...children.get(id)??[]);}return JSON.stringify(layout.nodes.filter(n=>ids.has(n.id)));}
function world(layout:CandidateLayout,id:string):Rect|null{const index=new Map(layout.nodes.map(n=>[n.id,n]));let n=index.get(id);if(!n)return null;const b={...n.box},seen=new Set([id]);while(n.parent){if(seen.has(n.parent))return null;seen.add(n.parent);n=index.get(n.parent);if(!n)return null;b.x+=n.box.x;b.y+=n.box.y;}return b;}
/** Called by the parent compositor, never read from arbitrary planner fields.
 * Exact candidate identity and geometry survive only until runtime promotion. */
export function registerOwnDockReceiveCandidate(layout:CandidateLayout,participantId:string,rosterIds:readonly string[],policy:{padding:number;gap:number;short:boolean}):void {
 if(layout.recipe!=='side-by-side')return;
 const identity=participantIdentityStructure({...layout,rosterIds},'own-hand-count-anchor');if(!identity?.local||identity.participantId!==participantId||identity.anchor.ownHandAnchor?.count!==0)return;
 const dock=layout.nodes.find(n=>n.id==='dock'),hand=layout.nodes.find(n=>n.id==='hand');
 if(!dock||dock.kind!=='group'||!hand||hand.kind!=='group'||hand.parent!=='dock'||identity.identity.parent!=='dock'||hand.scroll!==false||hand.semanticRole!=='group'||Object.keys(hand).some(key=>!['id','parent','kind','label','arrangement','box','scroll','semanticRole'].includes(key))||layout.nodes.some(n=>n.id==='hand-fan'||n.zoneId==='hand'&&n.entityId)||layout.nodes.some(n=>n.parent==='hand')||layout.nodes.some(n=>n.parent==='dock'&&n.id!=='identity'&&n.id!=='hand'))return;
 const row=composeSideDockRow({identity:identity.identity.box,hand:hand.box,...policy});
 if(dock.box.height!==row.height||identity.identity.box.x!==row.identity.x||identity.identity.box.y!==row.identity.y||hand.box.x!==row.hand.x||hand.box.y!==row.hand.y||dock.box.width!==hand.box.x+hand.box.width+policy.padding)return;
 const origin=world(layout,'dock');if(!origin)return;const bounds={...row.receive,x:origin.x+row.receive.x,y:origin.y+row.receive.y};if(![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)return;
 candidates.set(layout,{participantId,bounds:Object.freeze(bounds),fingerprint:fingerprint(layout)});
}
export function consumeOwnDockReceiveCandidate(layout:CandidateLayout,frame:PresentationFrame):OwnDockReceiveAllocation|null {
 const proof=candidates.get(layout);candidates.delete(layout);if(!proof||layout.recipe!=='side-by-side'||frame.recipe!=='side-by-side'||frame.settled||frame.modalId||fingerprint(layout)!==proof.fingerprint||fingerprint(frame)!==proof.fingerprint||!frame.rosterIds?.includes(proof.participantId))return null;
 return Object.freeze({kind:'empty-hand-column',participantId:proof.participantId,bounds:proof.bounds});
}
