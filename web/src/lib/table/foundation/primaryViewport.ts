import type {CandidateLayout,Rect} from './contracts';
/** Issued by measured composition only. Applications cannot supply primary boxes. */
export interface PrimaryViewport {readonly height:number;readonly regionIds:readonly string[];readonly overflow?:'root-scroll';}
export function validatePrimaryViewport(layout:CandidateLayout):readonly string[]{
 const owned=layout.primaryViewport;if(!owned)return [];
 const fail=()=>['Invalid primary viewport reservation'];
 if(!Number.isFinite(owned.height)||owned.height<=0||owned.height>layout.height+.5||!Array.isArray(owned.regionIds)||!owned.regionIds.length||owned.regionIds.length>4||new Set(owned.regionIds).size!==owned.regionIds.length)return fail();
 if(owned.overflow!==undefined&&owned.overflow!=='root-scroll')return fail();
 const root=layout.nodes.find(node=>node.parent===null);if(owned.overflow==='root-scroll'&&(!root?.scroll||layout.height<=owned.height))return fail();
 const nodes=new Map(layout.nodes.map(node=>[node.id,node]));
 for(const id of owned.regionIds){const node=nodes.get(id);if(!node||node.kind!=='group')return fail();if(owned.overflow==='root-scroll')continue;let box:Rect={...node.box},current=node,steps=0;
  while(current.parent){const parent=nodes.get(current.parent);if(!parent||++steps>layout.nodes.length)return fail();box={...box,x:box.x+parent.box.x,y:box.y+parent.box.y};current=parent;}
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.x<-.5||box.y<-.5||box.x+box.width>layout.width+.5||box.y+box.height>owned.height+.5)return [`Primary region escapes initial viewport: ${id}`];
  // Full primary allocations must survive every native scroll clip, including
  // root flow; horizontal card fans may scroll INSIDE their owned region.
  current=node;let left=box.x,top=box.y;while(current.parent){const parent=nodes.get(current.parent)!;left-=current.box.x;top-=current.box.y;if(parent.scroll&&(box.x<left-.5||box.y<top-.5||box.x+box.width>left+parent.box.width+.5||box.y+box.height>top+parent.box.height+.5))return [`Primary region clipped by ancestor: ${id}`];current=parent;}
 }
 return [];
}
