import type {PlannedNode,Rect} from './contracts';
interface Allocation {readonly id:string;readonly parent:string|null;readonly kind:string;readonly box:Rect;}
const fail=():never=>{throw Error('Invalid bounded header allocation');};
function field(value:unknown,key:string):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor))return fail();return descriptor.value;
}
function allocation(value:unknown):Allocation{
 const keys=Reflect.ownKeys(value as object);if(keys.length>64||keys.some(key=>typeof key!=='string'))return fail();
 // Header nodes are already owned engine snapshots. Still refuse accessors in
 // this tiny geometry boundary instead of invoking a supplied property reader.
 for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor))return fail();}
 const id=field(value,'id'),parent=field(value,'parent'),kind=field(value,'kind'),raw=field(value,'box');
 if(typeof id!=='string'||!id||id.length>2048||!(parent===null||typeof parent==='string'&&!!parent&&parent.length<=2048)||typeof kind!=='string'||!raw||typeof raw!=='object'||Reflect.ownKeys(raw).length!==4)return fail();
 const x=field(raw,'x'),y=field(raw,'y'),width=field(raw,'width'),height=field(raw,'height');if(![x,y,width,height].every(v=>typeof v==='number'&&Number.isFinite(v))||(x as number)<0||(y as number)<0||(width as number)<0||(height as number)<0)return fail();
 return{id,parent,kind,box:{x:x as number,y:y as number,width:width as number,height:height as number}};
}
/** Find one genuinely unused measured header-row gap. This produces only a
 * passive rectangle, never new header height, app geometry or action authority. */
export function headerPassiveSlot(header:readonly PlannedNode[]):Rect|null{
 try{
  if(!Array.isArray(header))return null;const size=Object.getOwnPropertyDescriptor(header,'length');if(!size||!('value'in size)||!Number.isSafeInteger(size.value)||size.value<2||size.value>128)return null;
  const nodes:Allocation[]=[];for(let index=0;index<size.value;index++){const descriptor=Object.getOwnPropertyDescriptor(header,String(index));if(!descriptor||!('value'in descriptor))return null;nodes.push(allocation(descriptor.value));}
  const byId=new Map(nodes.map(node=>[node.id,node]));if(byId.size!==nodes.length)return null;const roots=nodes.filter(node=>node.parent===null);if(roots.length!==1)return null;const root=roots[0];if(root.id!=='room-header'||root.kind!=='group'||root.box.x!==0||root.box.y!==0||root.box.width<44||root.box.height<44)return null;
  const children=new Map<string,Allocation[]>();for(const node of nodes)if(node.parent!==null){if(!byId.has(node.parent))return null;const siblings=children.get(node.parent)??[];siblings.push(node);children.set(node.parent,siblings);}
  const reached=new Set<string>(),queue=[root];for(let index=0;index<queue.length;index++){const node=queue[index];if(reached.has(node.id))return null;reached.add(node.id);queue.push(...children.get(node.id)??[]);}if(reached.size!==nodes.length)return null;
  const envelopes=children.get(root.id)??[];if(!envelopes.length||envelopes.length>16||envelopes.some(node=>node.box.x+node.box.width>root.box.width||node.box.y+node.box.height>root.box.height))return null;
  const bands=new Map<number,number>();for(const node of envelopes)bands.set(node.box.y,Math.max(bands.get(node.box.y)??0,node.box.height));
  let best:Rect|null=null;
  for(const [y,height] of bands){
   if(height<44||y+height>root.box.height)continue;
   const intervals=envelopes.filter(node=>node.box.width>0&&node.box.height>0&&node.box.y<y+height&&node.box.y+node.box.height>y).map(node=>({left:Math.max(0,node.box.x-8),right:Math.min(root.box.width,node.box.x+node.box.width+8)})).sort((a,b)=>a.left-b.left);
   let x=0;const consider=(right:number)=>{const width=right-x;if(width<44)return;const candidate={x,y,width,height};if(!best||width*height>best.width*best.height||width*height===best.width*best.height&&width>best.width)best=candidate;};
   for(const interval of intervals){consider(interval.left);x=Math.max(x,interval.right);}consider(root.box.width);
  }
  return best?Object.freeze(best):null;
 }catch{return null;}
}
