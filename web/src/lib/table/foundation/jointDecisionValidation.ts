import type {PlannedNode,Rect} from './contracts';
import {figurePaintBounds} from './figureArtworkMetrics';
/** The engine-issued joint layer permits only empty transparent container
 * overlap. Full paint, identities, slot capacity and native corridors remain
 * independently disjoint across its known regions. */
export function validateJointDecisionLayers(nodes:readonly PlannedNode[]):{readonly errors:readonly string[];readonly parents:ReadonlySet<string>}{
 const errors:string[]=[],parents=new Set<string>(),byId=new Map(nodes.map(node=>[node.id,node])),children=new Map<string,PlannedNode[]>();for(const node of nodes)if(node.parent){const row=children.get(node.parent)??[];row.push(node);children.set(node.parent,row);}
 const validBox=(box:Rect)=>[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.width>=0&&box.height>=0;
 const duplicateIds=byId.size!==nodes.length;
 const passiveGroupKeys=new Set(['id','parent','kind','label','box','accessibleDescription','role','textAlign','arrangement','columnSpan','semanticRole','scrollResetKey','inert','decoration','tone','deemphasized','identityMetaFor','participantFeedbackFor','participantStatusFor','collectionPurpose','collectedBy','stockCount','recipientId','recipientCount','ownHandAnchor','trickSlot','ownerId','zoneId','scroll','scrollAxis','scrollbarGutter','readonlyMatrixViewport']);
 const teamPill=(node:PlannedNode):boolean=>{
  if(node.kind!=='group'||node.decoration!=='pill'||node.semanticRole!=='status'||!node.participantStatusFor||node.id!==JSON.stringify(['participant-status',node.participantStatusFor]))return false;
  const value=node.appearance;if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Reflect.ownKeys(value),team=Object.getOwnPropertyDescriptor(value,'team');
  return keys.length===1&&keys[0]==='team'&&!!team&&'value'in team&&team.enumerable===true&&['declarer','friend','defense'].includes(team.value);
 };
 const authorityKeys=new Set(['choiceCard','choiceLeaseId','catalogueIntent','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','assistanceIntent','publicDisclosureEventId','feedbackDismissId','inspectCardId','inspectionPreviewFor','editor','formIntent','formActionId','formNavigation','formField','formLeaseId','preference','hasPopup','popupExpanded','controlsId','paintChildren','shellIntent','shellActionId','intent','enabled','checked','fieldId','optionId','options','selectedOptionId','localIntent','cardActionOptionId','cardActionPickerIntent','actionId','cardId']);
 const nativeKinds=new Set(['command','choice','select','toggle','range','editor','card']);
 const positiveBox=(box:Rect)=>validBox(box)&&box.width>0&&box.height>0;
 const identities=new Set(nodes.filter(node=>node.kind==='figure'&&node.ownerId).map(node=>JSON.stringify(['opponent',node.ownerId])));
 const overlap=(a:Rect,b:Rect)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>0&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>0;
 const intersect=(a:Rect,b:Rect):Rect=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))});
 const world=(node:PlannedNode):Rect|null=>{if(!validBox(node.box))return null;let x=node.box.x,y=node.box.y,parent=node.parent;const seen=new Set([node.id]);while(parent){if(seen.has(parent))return null;seen.add(parent);const owner=byId.get(parent);if(!owner||!validBox(owner.box))return null;x+=owner.box.x;y+=owner.box.y;parent=owner.parent;}const box={...node.box,x,y};return validBox(box)?box:null;};
 for(const root of nodes.filter(node=>node.jointDecisionLayer!==undefined)){
  const start=errors.length,direct=children.get(root.id)??[],ids=direct.map(node=>node.id),regular=ids.includes('regular-arena');
  const allowed=new Set(regular?['regular-arena','native-dock-context','table-decision-strip']:['arena','dock','table-decision-strip','active-information','active-status','assistance-tools']);
  const required=regular?['regular-arena','native-dock-context','table-decision-strip']:['arena','dock','table-decision-strip'];
  if(duplicateIds||!positiveBox(root.box)||root.jointDecisionLayer!==true||root.id!=='active-table-content'||root.kind!=='group'||root.label!==''||root.arrangement!=='ordinary'||Object.keys(root).some(key=>!['id','parent','kind','label','box','jointDecisionLayer','arrangement'].includes(key))||!required.every(id=>ids.filter(value=>value===id).length===1)||direct.some(node=>!allowed.has(node.id)||!positiveBox(node.box))||direct.some(node=>node.id!=='active-information'&&node.kind!=='group')||direct.some(node=>node.id==='active-information'&&(node.kind!=='command'||node.localIntent!=='toggle-information')))errors.push(`Invalid joint decision layer: ${root.id}`);
  if(regular){
   const arena=byId.get('regular-arena'),context=byId.get('native-dock-context'),board=byId.get('arena'),dock=byId.get('dock'),instruction=byId.get('native-play-instruction');
   const transparent=(node:PlannedNode|undefined)=>!!node&&node.kind==='group'&&node.label===''&&node.arrangement==='ordinary'&&Object.keys(node).every(key=>['id','parent','kind','label','arrangement','box'].includes(key));
   const arenaChildren=children.get('regular-arena')??[],dockChildren=children.get('native-dock-context')??[];
   if(!transparent(arena)||!transparent(context)||arenaChildren.length!==1||arenaChildren[0]!==board||board?.kind!=='group'||board.parent!==arena?.id||board.box.y!==0||board.box.x<0||board.box.x+board.box.width>arena!.box.width||board.box.height!==arena!.box.height||!dock||dock.parent!==context?.id||dock.kind!=='group'||dock.box.x!==0||dock.box.y<0||dock.box.width!==context!.box.width||dock.box.y+dock.box.height!==context!.box.height||dockChildren.some(node=>node!==dock&&node!==instruction)||dockChildren.length!==(instruction?2:1)||instruction&&(instruction.parent!==context!.id||!transparent(instruction)||instruction.box.x!==0||instruction.box.y!==0||instruction.box.width!==context!.box.width||instruction.box.height>dock.box.y))errors.push(`Invalid regular scene regions: ${root.id}`);
  }
  const rectangles=new Map<string,Rect[]>();
  for(const region of direct){
   const paint:Rect[]=[],queue=[region],seen=new Set<string>();if(region.id==='table-decision-strip'){const box=world(region);if(box)paint.push(box);}
   for(let index=0;index<queue.length;index++){
    const node=queue[index];if(node.kind==='group'&&Object.keys(node).some(key=>!passiveGroupKeys.has(key)&&!(key==='appearance'&&teamPill(node))&&node[key as keyof PlannedNode]!==undefined)||!nativeKinds.has(node.kind)&&Object.keys(node).some(key=>authorityKeys.has(key)&&node[key as keyof PlannedNode]!==undefined))errors.push(`Foreign joint authority: ${node.id}`);if(seen.has(node.id)){errors.push(`Cyclic joint region: ${region.id}`);break;}seen.add(node.id);queue.push(...children.get(node.id)??[]);const box=world(node);if(!box){errors.push(`Invalid joint ancestry: ${node.id}`);continue;}
    const identity=node.id==='identity'||identities.has(node.id);
    const hit=!!node.scroll||['command','choice','select','toggle','range','editor'].includes(node.kind)||!!node.cardId||!!node.inspectCardId;
    if(!(identity||node.trickSlot||node.kind!=='group'||node.decoration||node.tone||hit))continue;
    if(node.kind==='figure'&&!positiveBox(box)){errors.push(`Invalid joint figure: ${node.id}`);continue;}
    let bounds=node.kind==='figure'?figurePaintBounds(box,true):box;
    if(hit){const parent=node.parent?byId.get(node.parent):null;if(parent?.kind==='group'&&(parent.id===JSON.stringify(['control-envelope',node.id])||parent.id===JSON.stringify(['tool-envelope',node.id]))){const envelope=world(parent);if(envelope)bounds=envelope;}}
    let parent=node.parent;while(parent&&parent!==root.id){const owner=byId.get(parent);if(!owner)break;if(owner.scroll){const clip=world(owner);if(clip)bounds=intersect(bounds,clip);}parent=owner.parent;}
    if(bounds.width>0&&bounds.height>0)paint.push(bounds);
   }
   // Full-capacity source slots may be published as an inert sibling stage.
   // Their placement remains protected even when no current card occupies it.
   if(regular&&region.id==='regular-arena')for(const node of nodes)if(node.trickSlot&&!seen.has(node.id)){const box=world(node);if(!box||!positiveBox(box))errors.push(`Invalid joint source slot: ${node.id}`);else paint.push(box);}
   rectangles.set(region.id,paint);
  }
  for(let a=0;a<direct.length;a++)for(let b=a+1;b<direct.length;b++)if((rectangles.get(direct[a].id)??[]).some(left=>(rectangles.get(direct[b].id)??[]).some(right=>overlap(left,right))))errors.push(`Joint decision paint overlap: ${direct[a].id}, ${direct[b].id}`);
  if(errors.length===start)parents.add(root.id);
 }
 return {errors,parents:errors.length?new Set<string>():parents};
}
