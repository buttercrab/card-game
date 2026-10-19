import type {CandidateLayout,ControlMetrics,Environment,PlannedNode,Rect} from './contracts';
import type {HandGeometryEnvironment} from './ownHandGeometry';
const key=(...parts:string[])=>JSON.stringify(parts);
const closed=(node:PlannedNode,keys:readonly string[])=>Object.keys(node).every(field=>keys.includes(field)||node[field as keyof PlannedNode]===undefined);
const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const contains=(a:Rect,b:Rect)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const groupKeys=['id','parent','kind','label','arrangement','box','semanticRole','scroll','scrollAxis','scrollbarGutter'];
type TargetEnvironment=Pick<Environment,'width'|'height'|'textScale'|'controls'>&{readonly scrollbarWidth:number;readonly scrollbarHeight:number};
/** Snapshot only enumerable own scalar data before consulting host metrics.
 * Neither a top-level accessor nor a nested metric accessor may grant a target. */
function ownTargetEnvironment(input:unknown):TargetEnvironment|null {
 try{
  const record=(value:unknown):object|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))?value:null;
  const missing=Symbol('missing'),invalid=Symbol('invalid');
  const data=(object:object,key:string):unknown=>{const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor)return key in object?invalid:missing;return descriptor.enumerable===true&&'value'in descriptor?descriptor.value:invalid;};
  const source=record(input);if(!source)return null;
  const width=data(source,'width'),height=data(source,'height'),textScale=data(source,'textScale'),controlSource=record(data(source,'controls'));
  const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
  const nonnegative=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  if(!positive(width)||!positive(height)||!positive(textScale)||!controlSource)return null;
  const rawWidth=data(source,'scrollbarWidth'),rawHeight=data(source,'scrollbarHeight'),scrollbarWidth=rawWidth===missing?0:rawWidth,scrollbarHeight=rawHeight===missing?0:rawHeight;
  if(!nonnegative(scrollbarWidth)||!nonnegative(scrollbarHeight))return null;
  const metric=(kind:'choice'|'command'):ControlMetrics|null=>{
   const source=record(data(controlSource,kind));if(!source)return null;
   const fontSize=data(source,'fontSize'),lineHeight=data(source,'lineHeight'),fontWeight=data(source,'fontWeight'),paddingX=data(source,'paddingX'),paddingY=data(source,'paddingY'),minHeight=data(source,'minHeight'),pulse=data(source,'pulse');
   if(!positive(fontSize)||!positive(lineHeight)||!positive(fontWeight)||!nonnegative(paddingX)||!nonnegative(paddingY)||!nonnegative(minHeight)||!positive(pulse))return null;
   return Object.freeze({fontSize,lineHeight,fontWeight,paddingX,paddingY,minHeight,pulse});
  };
  const choice=metric('choice'),command=metric('command');if(!choice||!command)return null;
  return Object.freeze({width,height,textScale,scrollbarWidth,scrollbarHeight,controls:Object.freeze({choice,command})});
 }catch{return null;}
}
/** Re-derive original physical pseudo targets from the exact finite tree and
 * real host context. A scalar marker never authorizes smaller visible bodies. */
function proveFiniteClusterTargets(layout:CandidateLayout,environment:TargetEnvironment):ReadonlySet<string>{
 const accepted=new Set<string>();if(layout.width!==environment.width)return accepted;
 const byId=new Map(layout.nodes.map(node=>[node.id,node]));if(byId.size!==layout.nodes.length)return accepted;
 const root=byId.get('finite-control-cluster');if(!root||root.kind!=='group'||root.label!==''||root.arrangement!=='ordinary'||!closed(root,groupKeys))return accepted;
 const descendants=new Set([root.id]);for(const node of layout.nodes)if(node.parent&&descendants.has(node.parent))descendants.add(node.id);
 for(const node of layout.nodes)if(descendants.has(node.id)){if(node.kind==='group'){if(!closed(node,groupKeys)||node.semanticRole!==undefined&&!['group','radiogroup'].includes(node.semanticRole)||node.scroll&&!['x','y'].includes(node.scrollAxis??''))return accepted;}else if(!['choice','command','text','suit'].includes(node.kind))return accepted;}
 const native=layout.nodes.filter(node=>descendants.has(node.id)&&['choice','command'].includes(node.kind));if(!native.length)return accepted;
 const world=(node:PlannedNode):Rect|null=>{let {x,y}=node.box,parent=node.parent;const seen=new Set([node.id]);while(parent){if(seen.has(parent))return null;seen.add(parent);const p=byId.get(parent);if(!p)return null;x+=p.box.x;y+=p.box.y;parent=p.parent;}return {...node.box,x,y};};
 const hit=new Map<string,Rect>(),target=new Map<string,Rect>(),planes=new Map<string,{id:string;box:Rect}>();
 for(const node of native){
  if(!closed(node,['id','parent','kind','label','role','box','paintChildren','fieldId','optionId','actionId','enabled','checked','intent','decisionGroupId'])||!node.paintChildren||node.role!==(node.kind==='choice'?'choice':'button'))return accepted;
  if(node.kind==='choice'&&(!node.fieldId||!node.optionId||node.actionId||node.id!==key('option',node.fieldId,node.optionId)))return accepted;
  if(node.kind==='command'&&(!node.actionId||node.fieldId||node.optionId||node.id!==key('command',node.actionId)))return accepted;
  const parent=node.parent?byId.get(node.parent):undefined;
  if(!parent||parent.kind!=='group'||!closed(parent,groupKeys)||node.kind==='choice'&&(parent.id!==key('finite-cluster-field',node.fieldId!)||parent.semanticRole!=='radiogroup'))return accepted;
  if(!contains({x:0,y:0,width:parent.box.width,height:parent.box.height},node.box))return accepted;
  const children=layout.nodes.filter(child=>child.parent===node.id);if(!children.length||children.some(child=>!['text','suit'].includes(child.kind)||!closed(child,['id','parent','kind','label','role','box','suit'])||(child.kind==='text'?child.role!==node.role:child.role!==undefined)||!contains({x:0,y:0,width:node.box.width,height:node.box.height},child.box)))return accepted;
  const metric=environment.controls[node.kind==='choice'?'choice':'command'];
  if(children.some(child=>child.box.x<metric.paddingX||child.box.x+child.box.width>node.box.width-metric.paddingX||child.box.y<metric.paddingY||child.box.y+child.box.height>node.box.height-metric.paddingY||child.kind==='text'&&child.box.height<metric.lineHeight*environment.textScale!||child.kind==='suit'&&child.box.height<(node.kind==='choice'?18*environment.textScale!:metric.fontSize*environment.textScale!*.92)))return accepted;
  const body=world(node);if(!body)return accepted;
  const h=node.kind==='choice'?{x:body.x-2,y:body.y-4,width:body.width+4,height:body.height+8}:body;
  const t={x:body.x+(body.width-44)/2,y:body.y+(body.height-44)/2,width:44,height:44};
  if(!contains(h,t)||node.box.height<Math.max(node.kind==='choice'?40:44,metric.minHeight))return accepted;
  let owner=node.parent,projected={...t};
  while(owner){const p=byId.get(owner);if(!p)return accepted;if(p.scroll){const clip=world(p);if(!clip)return accepted;if(descendants.has(p.id)&&!planes.has(node.id))planes.set(node.id,{id:p.id,box:clip});const horizontal=p.scrollAxis==='x',vertical=p.scrollAxis==='y',content=layout.nodes.filter(child=>child.parent===p.id);if(content.length!==1||content[0].kind!=='group'||content[0].box.x!==0||content[0].box.y!==0)return accepted;
   const clientWidth=clip.width-(vertical?environment.scrollbarWidth:0),clientHeight=clip.height-(horizontal?environment.scrollbarHeight:0);
   if(clientWidth<=0||clientHeight<=0)return accepted;
   const reachable={...clip,width:horizontal?content[0].box.width:clientWidth,height:vertical?content[0].box.height:clientHeight};
   if(!contains(reachable,projected))return accepted;
   // Compose a real reachable scroll offset before testing outer clips. Raw
   // content coordinates are not painted simultaneously outside this viewport.
   // At the minimum exposing offset the trailing edge is exactly the client
   // edge. Derive that coordinate directly instead of subtracting two large
   // content coordinates (which can manufacture an out-of-clip float residue).
   if(horizontal){const minimum=Math.max(0,projected.x+projected.width-clip.x-clientWidth),maximum=Math.min(content[0].box.width-clientWidth,projected.x-clip.x);if(minimum>maximum)return accepted;projected.x=minimum>0?clip.x+clientWidth-projected.width:projected.x;}
   if(vertical){const minimum=Math.max(0,projected.y+projected.height-clip.y-clientHeight),maximum=Math.min(content[0].box.height-clientHeight,projected.y-clip.y);if(minimum>maximum)return accepted;projected.y=minimum>0?clip.y+clientHeight-projected.height:projected.y;}
   if(!contains({...clip,width:clientWidth,height:clientHeight},projected))return accepted;
  }owner=p.parent;}
  hit.set(node.id,h);target.set(node.id,t);
 }
 for(const [id,t] of target)for(const [other,h] of hit)if(id!==other){const a=planes.get(id),b=planes.get(other);if(intersects(a?.id===b?.id?t:a?.box??t,a?.id===b?.id?h:b?.box??h))return accepted;}
 // Every foreign control/scroll plane remains protected; no larger ancestor
 // group is treated as an input or used as a blanket overlap exemption.
 for(const node of layout.nodes){if(descendants.has(node.id)||!node.scroll&&!['choice','command','select','range','toggle','editor'].includes(node.kind)&&!node.cardId&&!node.inspectCardId)continue;const rect=world(node);if(!rect)return accepted;if(native.some(control=>{let p=control.parent;while(p){if(p===node.id)return true;p=byId.get(p)?.parent??null;}return false;}))continue;for(const [id,t] of target)if(intersects(planes.get(id)?.box??t,rect))return accepted;}
 for(const node of native)if(node.kind==='choice')accepted.add(node.id);return accepted;
}

/** Recognize exact engine namespaces rather than a scalar smaller-target flag. */
export function canonicalFiniteClusterTargets(layout:CandidateLayout,inputEnvironment:(HandGeometryEnvironment&Partial<Environment>)|undefined):ReadonlySet<string>{
 const environment=ownTargetEnvironment(inputEnvironment),accepted=new Set<string>();if(!environment)return accepted;
 const namespace=(id:string):{prefix:string;groupId:string;inner:string}|null=>{try{const value=JSON.parse(id);return Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&value[0].startsWith('decision-group:')&&value[0].length>'decision-group:'.length&&typeof value[1]==='string'?{prefix:value[0],groupId:value[0].slice('decision-group:'.length),inner:value[1]}:null;}catch{return null;}};
 const roots=layout.nodes.filter(node=>node.id==='finite-control-cluster'||namespace(node.id)?.inner==='finite-control-cluster');
 for(const root of roots){const scope=namespace(root.id),ids=new Set([root.id]);for(const node of layout.nodes)if(node.parent&&ids.has(node.parent))ids.add(node.id);
  if(!scope){const proof=proveFiniteClusterTargets(layout,environment);for(const id of proof)accepted.add(id);if(layout.nodes.some(node=>ids.has(node.id)&&node.kind==='choice')&&!proof.size)return new Set();continue;}
  const renamed=new Map<string,string>();for(const node of layout.nodes)if(ids.has(node.id)){const owned=namespace(node.id);if(!owned||owned.prefix!==scope.prefix||(['choice','command'].includes(node.kind)&&node.decisionGroupId!==scope.groupId))return new Set();renamed.set(node.id,owned.inner);}
  const normalized={...layout,nodes:layout.nodes.map(node=>ids.has(node.id)?{...node,id:renamed.get(node.id)!,parent:node.parent?renamed.get(node.parent)??node.parent:null}:node)};
  const proof=proveFiniteClusterTargets(normalized,environment);if(layout.nodes.some(node=>ids.has(node.id)&&node.kind==='choice')&&!proof.size)return new Set();for(const [original,inner] of renamed)if(proof.has(inner))accepted.add(original);
 }return accepted;
}
