import {DECISION_DESCRIPTOR_LIMITS} from './decisionDescriptor';
import type {Bounds} from './movement';
import {layoutDecision,type DecisionItem} from './decisionLayout';
type Size={readonly width:number;readonly height:number};
export type ControlInsets={readonly left:number;readonly right:number;readonly top:number;readonly bottom:number};
/** Private measured compound extents, not application style knobs. */
export interface ClusterPrimitive {readonly paddingX:number;readonly paddingY:number;readonly nativeMinimum?:number;readonly hit:ControlInsets;readonly paint:ControlInsets;}
export interface ClusterControl {readonly key:string;readonly caption:Size;readonly numeric?:true;}
export interface ClusterAction extends ClusterControl {readonly primary?:true;}
export interface ClusterField {readonly key:string;readonly options:readonly ClusterControl[];readonly visibleOptionCapacity?:number;readonly maximumCaption?:Size;readonly numeric?:true;}
export interface ControlClusterInput {
 readonly viewport:Size;readonly allocation:Size;readonly scrollbar:Size;readonly recipe:'bid'|'staged';
 readonly fields:readonly ClusterField[];readonly actions:readonly ClusterAction[];
 /** Current internal slot keys; ordered unique subset of the full public footer. */
 readonly observedActionKeys?:readonly string[];
 readonly primitives:{readonly choice:ClusterPrimitive;readonly command:ClusterPrimitive};
}
export interface ClusterPlacedControl {readonly key:string;readonly kind:'choice'|'command';readonly body:Bounds;readonly caption:Bounds;readonly hit:Bounds;readonly target:Bounds;readonly paint:Bounds;}
export interface ClusterScrollPlane {readonly key:'fields'|'actions';readonly axis:'x'|'y';readonly bounds:Bounds;readonly content:Size;readonly range:number;}
type Refusal={readonly kind:'refused';readonly reason:'invalid-metrics'|'caption-minimum'|'physical-target'|'hit-obstruction'|'clip-escape'|'scroll-hit-overlap'|'viewport-minimum'};
export interface ControlClusterMeasurement {readonly kind:'measured';readonly minimumHeight:number;readonly preferredHeight:number;readonly pickerMinimumHeight:number;readonly pickerContentHeight:number;readonly footerHeight:number;}
export type ControlClusterPlan={readonly kind:'admitted';readonly allocation:Size;readonly content:Size;readonly paint:Bounds;readonly controls:readonly ClusterPlacedControl[];readonly scroll:readonly ClusterScrollPlane[];readonly measurement:ControlClusterMeasurement}|Refusal;
const fail=(reason:Refusal['reason']):Refusal=>Object.freeze({kind:'refused',reason});
const finite=(n:number,min=0,max=100000)=>Number.isFinite(n)&&n>=min&&n<=max;
const size=(s:Size)=>finite(s.width,0)&&finite(s.height,1);
const expand=(b:Bounds,i:ControlInsets):Bounds=>({x:b.x-i.left,y:b.y-i.top,width:b.width+i.left+i.right,height:b.height+i.top+i.bottom});
const overlap=(a:Bounds,b:Bounds)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const contains=(a:Bounds,b:Bounds)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const union=(rs:readonly Bounds[]):Bounds=>{if(!rs.length)return {x:0,y:0,width:0,height:0};const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return {x,y,width:Math.max(...rs.map(r=>r.x+r.width))-x,height:Math.max(...rs.map(r=>r.y+r.height))-y};};
// Original picker padding is owned once, not wrapped around every row.
const PICKER={top:12,rowTop:2,rowBottom:4,rowGap:8};
function prepare(input:ControlClusterInput){
 const {allocation,viewport,scrollbar,primitives}=input;
 if(!['bid','staged'].includes(input.recipe)||![allocation,viewport].every(s=>finite(s.width,1)&&finite(s.height,1))||![scrollbar.width,scrollbar.height].every(n=>finite(n,0,64))||input.fields.length>DECISION_DESCRIPTOR_LIMITS.fields||input.actions.length>16)return fail('invalid-metrics');
 let count=0;for(const field of input.fields){const capacity=field.visibleOptionCapacity??field.options.length;if(!Number.isInteger(capacity)||capacity<1||field.options.length>capacity||(count+=capacity)>DECISION_DESCRIPTOR_LIMITS.options)return fail('invalid-metrics');}
 for(const p of Object.values(primitives))if(p.nativeMinimum!==undefined&&!finite(p.nativeMinimum,0,100000)||![p.paddingX,p.paddingY].every(n=>finite(n,0,128))||![p.hit,p.paint].every(i=>[i.left,i.right,i.top,i.bottom].every(n=>finite(n,0,256))))return fail('invalid-metrics');
 const all=[...input.fields.flatMap(field=>field.options),...input.actions],keys=[...input.fields.map(field=>field.key),...all.map(control=>control.key)];
 if(!all.length&&!input.fields.length||input.actions.filter(a=>a.primary).length>1||keys.some(k=>typeof k!=='string'||!k.length||k.length>128)||new Set(keys).size!==keys.length||all.some(c=>!size(c.caption)))return fail('invalid-metrics');
 const body=(c:ClusterControl,kind:'choice'|'command'):DecisionItem=>{const p=primitives[kind];return {id:c.key,width:Math.max(c.caption.width+2*p.paddingX,c.numeric?44:0),height:Math.max(kind==='choice'?40:44,p.nativeMinimum??0,c.caption.height+2*p.paddingY),...('primary'in c&&c.primary?{primary:true}:{})};};
 const left=Math.max(input.recipe==='bid'?6:4,...Object.values(primitives).flatMap(p=>[p.hit.left,p.paint.left])),right=Math.max(input.recipe==='bid'?6:4,...Object.values(primitives).flatMap(p=>[p.hit.right,p.paint.right])),inner=allocation.width-left-right;
 if(inner<=0)return fail('viewport-minimum');
 const top=Math.max(input.recipe==='bid'?6:PICKER.top+PICKER.rowTop,primitives.choice.paint.top,primitives.choice.hit.top),bottom=Math.max(input.recipe==='bid'?8:PICKER.rowBottom+PICKER.rowGap,primitives.choice.paint.bottom,primitives.choice.hit.bottom);
 const bounds=input.fields.map(field=>{const maximum=field.maximumCaption??{width:Math.max(...field.options.map(c=>c.caption.width)),height:Math.max(...field.options.map(c=>c.caption.height))};if(!size(maximum)||field.options.some(c=>c.caption.width>maximum.width||c.caption.height>maximum.height))return null;return {capacity:field.visibleOptionCapacity??field.options.length,item:body({key:field.key,caption:maximum,...(field.numeric?{numeric:true}:{})},'choice')};});
 if(bounds.some(b=>!b))return fail('invalid-metrics');
 const fields=bounds.filter((b):b is NonNullable<typeof b>=>b!==null),rowHeight=Math.max(0,...fields.map(f=>f.item.height));
 let publicPickerContent=0;
 if(fields.length&&input.recipe==='bid')publicPickerContent=top+rowHeight+bottom+scrollbar.height*(fields.reduce((n,f)=>n+f.capacity*(f.item.width+6),-6)>inner?1:0);
 if(fields.length&&input.recipe==='staged'){
  // Numeric capacity arithmetic only: no proxy options or caption Cartesian product.
  for(const f of fields){const usable=inner-scrollbar.width;if(f.item.width>usable)return fail('caption-minimum');const columns=Math.max(1,Math.floor((usable+6)/(f.item.width+6))),rows=Math.ceil(f.capacity/columns);publicPickerContent+=(rows*f.item.height+Math.max(0,rows-1)*6);}
  publicPickerContent+=top+bottom+Math.max(0,fields.length-1)*(PICKER.rowBottom+PICKER.rowGap+PICKER.rowTop);
 }
 const publicActionKeys=input.actions.map(action=>action.key),observed=input.observedActionKeys??publicActionKeys;
 if(observed.length>publicActionKeys.length||new Set(observed).size!==observed.length||observed.some((key,index)=>!publicActionKeys.includes(key)||index>0&&publicActionKeys.indexOf(key)<=publicActionKeys.indexOf(observed[index-1])))return fail('invalid-metrics');
 const footer=layoutDecision({mode:'actions',width:inner,viewport,items:input.actions.map(c=>body(c,'command')),gap:8,align:'center'}),footerScroll=footer.contentWidth>inner;
 const observedSet=new Set(observed),actualFooter=layoutDecision({mode:'actions',width:inner,viewport,items:input.actions.filter(action=>observedSet.has(action.key)).map(c=>body(c,'command')),gap:8,align:'center'});
 const footerTop=!fields.length?Math.max(6,primitives.command.paint.top,primitives.command.hit.top):footerScroll?Math.max(primitives.command.paint.top,primitives.command.hit.top):primitives.command.hit.top;
 const footerBottom=Math.max(primitives.command.paint.bottom,primitives.command.hit.bottom),footerHeight=input.actions.length?footerTop+footer.height+footerBottom+(footerScroll?scrollbar.height:0):0;
 const pickerMinimum=fields.length?top+rowHeight+bottom+(input.recipe==='bid'&&publicPickerContent>top+rowHeight+bottom?scrollbar.height:0):0;
 const measurement:ControlClusterMeasurement=Object.freeze({kind:'measured',minimumHeight:pickerMinimum+footerHeight,preferredHeight:Math.max(pickerMinimum,publicPickerContent)+footerHeight,pickerMinimumHeight:pickerMinimum,pickerContentHeight:publicPickerContent,footerHeight});
 return {kind:'prepared' as const,body,left,right,inner,top,bottom,fields,footer:actualFooter,footerTop,footerScroll:actualFooter.nodes.length>0&&actualFooter.contentWidth>inner,measurement};
}
/** Same public metric owner as assignment. Empty observed lists are legal only
 * with numeric public capacity; measurement never manufactures native controls. */
export function measureControlCluster(input:ControlClusterInput):ControlClusterMeasurement|Refusal {const p=prepare(input);return p.kind==='refused'?p:p.measurement;}
/** A complete picker plus a separate visible footer. Coordinates are in the
 * cluster; picker children are unscrolled content coordinates. */
export function layoutControlCluster(input:ControlClusterInput):ControlClusterPlan {
 const p=prepare(input);if(p.kind==='refused')return p;
 const {allocation,viewport,scrollbar,primitives}=input,m=p.measurement;
 if(allocation.height<m.minimumHeight)return fail('viewport-minimum');
 const height=Math.min(allocation.height,m.preferredHeight),pickerHeight=height-m.footerHeight;
 const controls:ClusterPlacedControl[]=[],scroll:ClusterScrollPlane[]=[],owner=new Map<string,'fields'|'actions'>();
 const add=(c:ClusterControl,kind:'choice'|'command',body:Bounds)=>controls.push({key:c.key,kind,body,caption:{x:body.x+(body.width-c.caption.width)/2,y:body.y+(body.height-c.caption.height)/2,...c.caption},hit:expand(body,primitives[kind].hit),target:{x:body.x+(body.width-44)/2,y:body.y+(body.height-44)/2,width:44,height:44},paint:expand(body,primitives[kind].paint)});
 if(input.fields.length){
  if(input.recipe==='bid'){
   const options=input.fields.flatMap(field=>field.options),byKey=new Map(options.map(c=>[c.key,c])),items=options.map(c=>p.body(c,'choice')),row=layoutDecision({mode:'row',width:p.inner,viewport,items,gap:6,align:'center'});
   for(const node of row.nodes)add(byKey.get(node.id)!,'choice',{...node.bounds,x:node.bounds.x+p.left,y:node.bounds.y+p.top});
   if(row.contentWidth>p.inner){const clientHeight=pickerHeight-scrollbar.height;scroll.push({key:'fields',axis:'x',bounds:{x:0,y:0,width:allocation.width,height:pickerHeight},content:{width:row.contentWidth+p.left+p.right,height:clientHeight},range:row.contentWidth+p.left+p.right-allocation.width});for(const c of options)owner.set(c.key,'fields');}
  }else{
   // Reserve the actual y-scrollbar once. A second pass only when the first
   // wrapped content really needs scrolling, never a whole-cluster gutter.
   const pack=(gutter:number)=>{let y=p.top;const placed:{c:ClusterControl;body:Bounds}[]=[];for(let i=0;i<input.fields.length;i++){const field=input.fields[i],byKey=new Map(field.options.map(c=>[c.key,c])),items=field.options.map(c=>p.body(c,'choice'));if(items.some(item=>item.width>p.inner-gutter))return null;const row=layoutDecision({mode:'flow',width:p.inner-gutter,viewport,items,gap:6});for(const node of row.nodes)placed.push({c:byKey.get(node.id)!,body:{...node.bounds,x:node.bounds.x+p.left,y:node.bounds.y+y}});y+=row.height+(i<input.fields.length-1?PICKER.rowBottom+PICKER.rowGap+PICKER.rowTop:0);}return {placed,height:y+p.bottom};};
   let actual=pack(0);if(!actual)return fail('caption-minimum');if(actual.height>pickerHeight){actual=pack(scrollbar.width);if(!actual)return fail('caption-minimum');scroll.push({key:'fields',axis:'y',bounds:{x:0,y:0,width:allocation.width,height:pickerHeight},content:{width:allocation.width-scrollbar.width,height:actual.height},range:actual.height-pickerHeight});for(const f of input.fields)for(const c of f.options)owner.set(c.key,'fields');}
   for(const entry of actual.placed)add(entry.c,'choice',entry.body);
  }
 }
 const actionByKey=new Map(input.actions.map(c=>[c.key,c]));
 for(const node of p.footer.nodes)add(actionByKey.get(node.id)!,'command',{...node.bounds,x:node.bounds.x+p.left,y:node.bounds.y+pickerHeight+p.footerTop});
 if(p.footerScroll){scroll.push({key:'actions',axis:'x',bounds:{x:0,y:pickerHeight,width:allocation.width,height:m.footerHeight},content:{width:p.footer.contentWidth+p.left+p.right,height:m.footerHeight-scrollbar.height},range:p.footer.contentWidth+p.left+p.right-allocation.width});for(const c of p.footer.nodes)owner.set(c.id,'actions');}
 const planes=new Map(scroll.map(plane=>[plane.key,plane]));
 for(const c of controls){if(!contains(c.hit,c.target))return fail('physical-target');if(!contains(c.body,c.caption))return fail('caption-minimum');if(c.paint.x<0||c.paint.y<0||c.hit.x<0||c.hit.y<0)return fail('clip-escape');const own=owner.get(c.key),plane=own?planes.get(own):undefined;if(plane){const reachable={...plane.bounds,width:plane.axis==='x'?plane.content.width:plane.content.width,height:plane.axis==='y'?plane.content.height:plane.content.height};if(!contains(reachable,c.paint)||!contains(reachable,c.hit)||plane.axis==='y'&&c.target.height>plane.bounds.height||plane.axis==='x'&&c.target.width>plane.bounds.width)return fail('clip-escape');}else if(c.paint.x+c.paint.width>allocation.width||c.paint.y+c.paint.height>height)return fail('clip-escape');}
 const ownerCodes=controls.map(control=>owner.get(control.key));
 for(let a=0;a<controls.length;a++)for(let b=0;b<controls.length;b++)if(a!==b&&ownerCodes[a]===ownerCodes[b]&&overlap(controls[a].target,controls[b].hit))return fail('hit-obstruction');
 for(const plane of scroll)for(const c of controls)if(owner.get(c.key)!==plane.key&&overlap(plane.bounds,c.hit))return fail('scroll-hit-overlap');
 if(scroll.length===2&&overlap(scroll[0].bounds,scroll[1].bounds))return fail('scroll-hit-overlap');
 const paint=union(controls.map(c=>{let rect=c.paint;const own=owner.get(c.key),plane=own?planes.get(own):undefined;if(plane){if(plane.axis==='x'){const x=Math.max(plane.bounds.x,rect.x-plane.range),right=Math.min(plane.bounds.x+plane.bounds.width,rect.x+rect.width);rect={...rect,x,width:Math.max(0,right-x)};}else{const y=Math.max(plane.bounds.y,rect.y-plane.range),bottom=Math.min(plane.bounds.y+plane.bounds.height,rect.y+rect.height);rect={...rect,y,height:Math.max(0,bottom-y)};}}return rect;}));
 for(const c of controls){for(const rect of [c.body,c.caption,c.hit,c.target,c.paint])Object.freeze(rect);Object.freeze(c);}for(const plane of scroll){Object.freeze(plane.bounds);Object.freeze(plane.content);Object.freeze(plane);}
 return Object.freeze({kind:'admitted',allocation:Object.freeze({width:allocation.width,height}),content:Object.freeze({width:allocation.width,height}),paint:Object.freeze(paint),controls:Object.freeze(controls),scroll:Object.freeze(scroll),measurement:m});
}
