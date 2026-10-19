import {consumeCompletionReceiveSource,type CompletionReceiveSource} from './completionReceive';
import type {PresentationFrame,Rect,StatusPresentation} from './contracts';
/** Runtime-owned bounded public reservations, never an application layout API.
 * No old text, artwork, private hand, route or scene subtree is retained. */
export interface RetainedPublicTableRecipe {
 readonly localReceive?:{readonly participantId:string;readonly bounds:Rect};
 readonly width:number;
 readonly height:number;
 readonly header?:Rect;
 readonly headerStatus?:'all'|'fields'|'none';
 readonly statusPresentation?:StatusPresentation;
 /** Outgoing public fact references only; values always resolve canonically. */
 readonly factIds?:readonly string[];
 /** Closed existing public parent geometry only; no scene/paint/input cache. */
 readonly containers?:readonly {readonly id:string;readonly parentId:string;readonly bounds:Rect;readonly tray?:true;readonly scroll?:true;readonly gutter?:number}[];
 readonly statuses?:readonly {readonly section:'all'|'fields'|'context';readonly parentId:string;readonly bounds:Rect}[];
 readonly arena:Rect;
 readonly participants:readonly {readonly participantId:string;readonly local:boolean;readonly parentId?:string;readonly bounds:Rect;readonly figureSize:number}[];
 readonly slots:readonly {readonly ownerId:string;readonly bounds:Rect}[];
}
const key=(...parts:string[])=>JSON.stringify(parts);
export function captureRetainedPublicTableRecipe(frame:PresentationFrame,sourceCollectionId:string,receive?:{readonly participantId:string;readonly source:CompletionReceiveSource},statusPresentation?:StatusPresentation,factIds:readonly string[]=[]):RetainedPublicTableRecipe|null {
 if(frame.settled||frame.modalId||frame.nodes.length>4096||factIds.length>4096||new Set(factIds).size!==factIds.length)return null;
 const index=new Map(frame.nodes.map(node=>[node.id,node]));if(index.size!==frame.nodes.length)return null;
 const world=(id:string):Rect|null=>{let node=index.get(id);if(!node)return null;let {x,y,width,height}=node.box;const seen=new Set([id]);while(node.parent){if(seen.has(node.parent))return null;seen.add(node.parent);node=index.get(node.parent);if(!node)return null;x+=node.box.x;y+=node.box.y;}return {x,y,width,height};};
 const within=(box:Rect,clip:Rect)=>[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.width>0&&box.height>0&&box.x>=clip.x&&box.y>=clip.y&&box.x+box.width<=clip.x+clip.width&&box.y+box.height<=clip.y+clip.height;
 const viewport={x:0,y:0,width:frame.environment.width,height:frame.environment.height};
 const visible=(id:string)=>{const box=world(id);if(!box||!within(box,viewport))return false;let node=index.get(id)!;while(node.parent){node=index.get(node.parent)!;if(node.scroll&&!within(box,world(node.id)!))return false;}return true;};
 const copy=(box:Rect)=>Object.freeze({...box});
 const roster=frame.rosterIds;if(!roster||roster.length<2||roster.length>8||new Set(roster).size!==roster.length)return null;
 const slotNodes=frame.nodes.filter(node=>node.trickSlot&&node.zoneId===sourceCollectionId);
 if(slotNodes.length!==roster.length||slotNodes.some(node=>!node.ownerId||!roster.includes(node.ownerId)||!visible(node.id))||new Set(slotNodes.map(node=>node.ownerId)).size!==roster.length)return null;
 const arenaNode=index.get('arena');const arena=arenaNode&&world(arenaNode.id);if(!arena||!within(arena,viewport))return null;
 const participants:RetainedPublicTableRecipe['participants'][number][]=[];
 for(const participantId of roster){
  const figure=frame.nodes.find(node=>node.kind==='figure'&&node.ownerId===participantId);if(!figure)return null;
  const local=figure.id==='identity-figure',identityId=local?'identity':key(key('opponent',participantId),'identity'),bounds=world(identityId);
  if(!bounds||!visible(identityId)||!visible(figure.id))return null;
  participants.push(Object.freeze({participantId,local,parentId:index.get(identityId)!.parent!,bounds:copy(bounds),figureSize:figure.box.width}));
 }
 if(participants.filter(person=>person.local).length>1)return null;
 const oldCards=frame.nodes.filter(node=>node.kind==='card'&&node.collectionPurpose==='play'&&node.zoneId===sourceCollectionId&&node.entityId);
 if(oldCards.length!==roster.length-1||oldCards.some(node=>!visible(node.id)))return null;
 const receiveBounds=receive&&participants.some(p=>p.local&&p.participantId===receive.participantId)?consumeCompletionReceiveSource(receive.source,frame,receive.participantId):null;
 const header=world('room-shell');if(header&&!visible('room-shell'))return null;
 const allowed=new Set(['active-status-content','active-status-viewport','active-information','arena','table-body','active-table-content','native-dock-context','dock','active-arena-region','active-arena-viewport','regular-arena','landscape-arena-column','landscape-decision-lane','opponents-upper','opponents-left','opponents-right','opponents-bottom',...roster.filter(id=>!participants.some(p=>p.local&&p.participantId===id)).map(id=>key('opponent',id))]);
 const containers=new Map<string,NonNullable<RetainedPublicTableRecipe['containers']>[number]>();
 const captureParent=(id:string|null):boolean=>{if(!id||id==='table-underlay')return id==='table-underlay';if(containers.has(id))return true;const node=index.get(id);if(!node||node.kind!=='group'&&!(id==='active-information'&&node.kind==='command')||!allowed.has(id)||!node.parent||!visible(id)||containers.size>=32)return false;if(!captureParent(node.parent))return false;containers.set(id,Object.freeze({id,parentId:node.parent,bounds:copy(world(id)!),...(id==='dock'?{tray:true as const}:{}),...(node.scroll?{scroll:true as const,gutter:node.scrollbarGutter??0}:{})}));return true;};
 for(const person of participants)if(!captureParent(person.parentId!))return null;
 if(!captureParent(arenaNode!.parent))return null;
 const sidebar=index.get('table-sidebar');if(sidebar){if(!Number.isFinite(sidebar.scrollbarGutter??0)||(sidebar.scrollbarGutter??0)<0||(sidebar.scrollbarGutter??0)>=sidebar.box.width||sidebar.kind!=='group'||!sidebar.parent||!visible(sidebar.id)||!captureParent(sidebar.parent))return null;containers.set(sidebar.id,Object.freeze({id:sidebar.id,parentId:sidebar.parent,bounds:copy(world(sidebar.id)!),scroll:true,gutter:sidebar.scrollbarGutter??0}));}
 const inHeader=(id:string)=>{let node=index.get(id);while(node?.parent){if(node.parent==='room-shell')return true;node=index.get(node.parent);}return false;};
 const statuses:NonNullable<RetainedPublicTableRecipe['statuses']>[number][]=[];let headerStatus:RetainedPublicTableRecipe['headerStatus']='none';
 for(const section of ['all','fields','context'] as const){const id=section==='all'?'table-active-status':`table-active-status-${section}`,node=index.get(id);if(!node)continue;if(inHeader(id)){headerStatus=section==='context'?'all':section;continue;}if(!node.parent||!visible(id)||!captureParent(node.parent))return null;statuses.push(Object.freeze({section,parentId:node.parent,bounds:copy(world(id)!)}));}

 if(containers.size>32)return null;
 return Object.freeze({...(receiveBounds?{localReceive:Object.freeze({participantId:receive!.participantId,bounds:copy(receiveBounds)})}:{}),width:frame.environment.width,height:frame.environment.height,headerStatus,factIds:Object.freeze([...factIds]),...(statusPresentation?{statusPresentation:Object.freeze({...statusPresentation,fieldIds:Object.freeze([...statusPresentation.fieldIds])})}:{}),containers:Object.freeze([...containers.values()]),statuses:Object.freeze(statuses),...(header?{header:copy(header)}:{}),arena:copy(arena),participants:Object.freeze(participants),slots:Object.freeze(slotNodes.map(node=>Object.freeze({ownerId:node.ownerId!,bounds:copy(world(node.id)!)})))});
}
