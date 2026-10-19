import {motionFixtureResources} from './motionResourceTestFixture';
import {expect,test} from 'vitest';
import {planTrickResolution,continuesTrickResolution} from './trickResolution';
import type {PlannedNode,PresentationFrame} from './contracts';
const box={x:100,y:100,width:32,height:45},owners=['me','p1','p2','p3','p4'];
const node=(id:string,extra:Partial<PlannedNode>):PlannedNode=>({id,parent:null,kind:'group',label:id,box,...extra});
const card=(index:number,zone:string):PlannedNode=>node(`${zone}:${index}`,{kind:'card',entityId:`c${index}`,ownerId:owners[index],zoneId:zone,collectionPurpose:zone==='play'?'play':zone==='captured'?'captured':undefined,visual:{kind:'standard',suit:'Spade',rank:index+2}});
const slots=()=>owners.map(ownerId=>node(`slot:${ownerId}`,{trickSlot:true,inert:true,ownerId,zoneId:'play'}));
const peer=(count:number)=>node('peer',{kind:count?'card':'group',recipientId:'p4',recipientCount:count,...(count?{visual:{kind:'back' as const}}:{inert:true,label:''})});
function fixture(own=false,settled=false){
 const frame=(id:number,nodes:PlannedNode[]):PresentationFrame=>({id,context:{session:'s',audience:'a',generation:'g',revision:String(id)},environment:{revision:'e'} as PresentationFrame['environment'],offerId:String(id),rosterIds:owners,width:800,height:800,recipe:'stacked',nodes,paintResources:motionFixtureResources(nodes,owners)});
 const indices=own?[1,2,3,4]:[0,1,2,3];
 const common=[node('own-count',{inert:true,label:'',ownHandAnchor:{participantId:'me',count:own?1:0}}),...['p1','p2','p3'].map(recipientId=>node(`count:${recipientId}`,{inert:true,label:'',recipientId,recipientCount:0}))];
 const before=frame(1,[...common,...slots(),...indices.map(index=>card(index,'play')),peer(own?2:1),...(own?[card(0,'hand')]:[])]);
 const next:PresentationFrame={...frame(2,[...common.map(n=>n.ownHandAnchor?{...n,ownHandAnchor:{participantId:'me',count:0}}:n),...slots(),...owners.map((_,index)=>card(index,'captured')),peer(own?2:0),node('captured-root',{zoneId:'captured',collectedBy:'p1',collectionPurpose:'captured'}),node('winner',{kind:'figure',ownerId:'p1'})]),settled,...(!own?{reveals:[{participantId:'p4',cardId:'c4'}]}:{})};
 return{before,next};
}
test.each([false,true])('one atomic four-to-five publication stages the authorized incoming source, own=%s',own=>{
 const {before,next}=fixture(own),plan=planTrickResolution(before,next)!;expect(plan).not.toBeNull();expect(plan.incomingId).toBe(own?'c0':'c4');expect(plan.items).toHaveLength(5);expect(plan.items.find(item=>item.entityId===plan.incomingId)?.presentation).toBe('face');expect(new Set(plan.items.map(item=>item.entityId)).size).toBe(5);expect(plan.items.every(item=>item.slotId===`slot:${item.ownerId}`)).toBe(true);expect(Object.isFrozen(plan.items[0])).toBe(true);expect(Object.isFrozen(plan.items)).toBe(true);
});
test('terminal Done uses identical public proof, not a manufactured intermediate document',()=>{const {before,next}=fixture(false,true);expect(planTrickResolution(before,next)?.items).toHaveLength(5);expect(next.settled).toBe(true);expect(next.nodes.filter(node=>node.collectionPurpose==='play')).toHaveLength(0);expect(planTrickResolution(next,{...next,id:3,context:{...next.context,revision:'3'}})).toBeNull();expect(planTrickResolution(null,next)).toBeNull();});
test('scope, environment, modal, roster, return and deal changes refuse staging',()=>{
 const {before,next}=fixture();expect(planTrickResolution(before,{...next,environment:{...next.environment,revision:'font'}})).not.toBeNull();for(const change of [{context:{...next.context,audience:'foreign'}},{context:{...next.context,generation:'new'}},{rosterIds:[...owners].reverse()},{modalId:'dialog'},{deals:[{id:'deal',source:'stock',cardIds:[]}]}])expect(planTrickResolution(before,{...next,...change})).toBeNull();
});
test('missing/wrong reveal, count, original owner, face, primary slot or complete partition refuses',()=>{
 const {before,next}=fixture();
 for(const altered of [{...next,reveals:[]},{...next,reveals:[{participantId:'p3',cardId:'c4'}]},{...next,nodes:next.nodes.map(node=>node.id==='peer'?{...node,recipientCount:1}:node)},{...next,nodes:next.nodes.map(node=>node.id==='captured:0'?{...node,ownerId:'p4'}:node)},{...next,nodes:next.nodes.map(node=>node.id==='captured:0'?{...node,visual:{kind:'standard' as const,suit:'Heart' as const,rank:2}}:node)},{...next,nodes:next.nodes.filter(node=>node.id!=='slot:p3')},{...next,nodes:[...next.nodes,card(0,'play')]}])expect(planTrickResolution(before,altered)).toBeNull();
});
test('all unrelated peer, hand and stock deltas are conserved',()=>{
 const f=fixture(),retained={...card(6,'hand'),ownerId:undefined},add=(frame:PresentationFrame)=>({...frame,nodes:frame.nodes.map(n=>n.ownHandAnchor?{...n,ownHandAnchor:{participantId:'me',count:1}}:n)}),before=add(f.before),next=add(f.next);
 expect(planTrickResolution({...before,nodes:[...before.nodes,retained]},{...next,nodes:[...next.nodes,retained]})).not.toBeNull();
 expect(planTrickResolution({...before,nodes:[...before.nodes,retained]},next)).toBeNull();
 const stock=node('stock',{stockCount:3,zoneId:'stock'});expect(planTrickResolution({...before,nodes:[...before.nodes,stock]},{...next,nodes:[...next.nodes,{...stock,stockCount:4}]})).toBeNull();
});

test('terminal current stock retirement requires an explicit distinct future-deal resource',()=>{
 const f=fixture(false,true),stock=node('stock',{kind:'card',zoneId:'stock',stockCount:3,visual:{kind:'back'}}),oldNodes=[...f.before.nodes,stock],nextNodes=[...f.next.nodes,{...stock,stockCount:53}];
 const before={...f.before,nodes:oldNodes,paintResources:motionFixtureResources(oldNodes,owners)},current=motionFixtureResources(nextNodes,owners)!;
 if(current.status!=='available')throw Error('fixture resources');const next={...f.next,nodes:nextNodes,paintResources:{...current,collections:current.collections.map(c=>c.id==='stock'?{...c,kind:'deck' as const,availability:'next-deal' as const}:c)}};
 expect(planTrickResolution(before,next)).not.toBeNull();expect(planTrickResolution(before,{...next,settled:false})).toBeNull();expect(planTrickResolution(before,{...next,paintResources:current})).toBeNull();expect(planTrickResolution(before,{...next,paintResources:{...next.paintResources,collections:next.paintResources.collections.filter(c=>c.id!=='stock')}})).toBeNull();
 expect(planTrickResolution({...before,nodes:before.nodes.filter(n=>n.id!=='stock')},{...next,nodes:next.nodes.filter(n=>n.id!=='stock')})).not.toBeNull();
});

test('one next lead retains the resource cohort without requiring captured DOM',()=>{
 const f=fixture(),other=node('other',{inert:true,label:'',recipientId:'p2',recipientCount:2}),before={...f.before,nodes:[...f.before.nodes.filter(n=>n.recipientId!=='p2'),other]},resolved={...f.next,nodes:[...f.next.nodes.filter(n=>n.recipientId!=='p2'),other]},plan=planTrickResolution(before,resolved)!;expect(plan).not.toBeNull();
 const nodes=[...resolved.nodes.map(value=>value.id==='other'?{...value,recipientCount:1}:value),node('new-lead',{kind:'card',entityId:'new-lead',ownerId:'p2',zoneId:'play',collectionPurpose:'play',visual:{kind:'standard',suit:'Heart',rank:8}})];
 const lead:PresentationFrame={...resolved,id:3,context:{...resolved.context,revision:'3'},reveals:[{participantId:'p2',cardId:'new-lead'}],nodes,paintResources:motionFixtureResources(nodes,owners)};
 expect(continuesTrickResolution(plan,resolved,lead)).toBe(true);expect(continuesTrickResolution(plan,resolved,{...lead,nodes:lead.nodes.filter(n=>n.collectionPurpose!=='captured')})).toBe(true);
 for(const changed of [{...lead,context:{...lead.context,audience:'other'}},{...lead,context:{...lead.context,generation:'new'}},{...lead,environment:{...lead.environment,revision:'new'}},{...lead,rosterIds:[...owners].reverse()},{...lead,modalId:'modal'},{...lead,nodes:lead.nodes.map(value=>value.id==='captured-root'?{...value,collectedBy:'p2'}:value)},{...lead,nodes:lead.nodes.map(value=>value.id==='captured:0'?{...value,ownerId:'p2'}:value)},{...lead,nodes:lead.nodes.map(value=>value.id==='captured:0'?{...value,visual:{kind:'standard' as const,suit:'Heart' as const,rank:14}}:value)}])expect(continuesTrickResolution(plan,resolved,changed)).toBe(false);
 if(lead.paintResources?.status!=='available')throw Error('resources');expect(continuesTrickResolution(plan,resolved,{...lead,paintResources:{...lead.paintResources,collections:lead.paintResources.collections.map(c=>c.id==='captured'?{...c,cards:c.cards.slice(1)}:c)}})).toBe(false);
});
