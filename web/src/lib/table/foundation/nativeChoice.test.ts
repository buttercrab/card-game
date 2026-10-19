import {describe,it,expect,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {planTable,validateLayout} from './planner';
import {largeChoiceDocument,type LargeChoiceAction} from './largeChoiceFixture';
import {mightyBidPressureDocument} from './mightyBidPressureFixture';
import type {MightyCommand} from '../../games/mighty/foundation';
import type {CandidateLayout,Environment,Planner,Size,SurfaceCallbacks,SurfacePort} from './contracts';
const env:Environment={width:390,height:844,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const planner:Planner=(_doc,_env,choices)=>({kind:'ready',layout:{width:390,height:844,recipe:'stacked',nodes:[{id:'root',parent:null,kind:'group',label:'',box:{x:0,y:0,width:390,height:844}},{id:'amount',parent:'root',kind:'select',role:'select',label:'금액',fieldId:'amount',options:choices.fields[0].options,selectedOptionId:choices.values?.amount,enabled:choices.fields[0].options.some(option=>option.enabled),box:{x:16,y:16,width:358,height:44}},{id:'confirm',parent:'root',kind:'command',label:choices.selected!.label,actionId:choices.selected!.id,enabled:choices.selected!.enabled,box:{x:16,y:80,width:358,height:44}}]}});
function fixture(sparse=false){
 const send=vi.fn(),session=createCardSession<LargeChoiceAction>({transport:send});session.receive(largeChoiceDocument({sparse}));
 let callbacks:SurfaceCallbacks;
 const surface:SurfacePort={identity:{},environment:()=>env,listen(value){callbacks=value;return()=>{};},measure:()=>()=>{},publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback:()=>{},clear:()=>{}};
 const table=createCardTable({session,planner});table.attach(surface);
 return {send,session,table,surface,get callbacks(){return callbacks;},choose(optionId:string,frameId=table.inspect().frame!.id){callbacks.intent({kind:'choose',frameId,nodeId:'amount',optionId});},selected(){return table.inspect().frame!.nodes[1].selectedOptionId;},dispose(){table.dispose();session.dispose();}};
}
describe('native finite choices share engine admission',()=>{
 it('changes only the draft until exact confirmation, with frozen option metadata',async()=>{
  const f=fixture();f.choose('197');expect(f.selected()).toBe('197');expect(f.table.inspect().focusId).toBe('amount');expect(f.session.snapshot().operations).toHaveLength(0);expect(f.send).not.toHaveBeenCalled();
  const options=f.table.inspect().frame!.nodes[1].options!;expect(Object.isFrozen(options)).toBe(true);expect(Object.isFrozen(options[0])).toBe(true);
  f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:'confirm'});await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action).toEqual({amount:197});f.dispose();
 });
 it('rejects unavailable and forged options without changing the draft',()=>{
  const f=fixture(true);expect(f.selected()).toBe('7');for(const value of ['1','198','__proto__']){f.choose(value);expect(f.selected()).toBe('7');}f.choose('14');expect(f.selected()).toBe('14');f.dispose();
 });
 it('rejects stale, disconnected and detached callbacks',()=>{
  const f=fixture(),old=f.table.inspect().frame!.id;f.session.receive(largeChoiceDocument({revision:2}));f.choose('197',old);expect(f.selected()).toBe('1');
  f.session.setConnected(false);f.choose('197');expect(f.selected()).toBe('1');f.table.detach();const callback=f.callbacks;callback.intent({kind:'choose',frameId:old,nodeId:'amount',optionId:'197'});expect(f.send).not.toHaveBeenCalled();f.dispose();
 });
 it('does not inherit a previous button activation cancellation after a fresh offer',()=>{
  const f=fixture();f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:'confirm'});f.session.receive(largeChoiceDocument({revision:2}));f.choose('100');expect(f.selected()).toBe('100');f.dispose();
 });
});
function solve(width:number,textScale:number,longName=false):CandidateLayout{
 const doc=largeChoiceDocument({longName}),choices={values:{amount:'1'},fields:doc.decision.kind==='finite-choice'?doc.decision.fields:[],commands:[{id:'pass',label:'패스',intent:'secondary' as const,enabled:true}],selected:{id:'amount:1',label:'확정 금액 1',intent:'primary' as const,enabled:true}};
 const metrics=new Map<string,Size>();
 for(let pass=0;pass<10;pass++){
  const result=planTable(doc,{...env,width,textScale},choices,metrics);if(result.kind==='ready')return result.layout;if(result.kind!=='needs')throw new Error(JSON.stringify(result));
  for(const request of result.requests){const natural=[...request.text].length*10*textScale,width=request.width??natural;metrics.set(request.key,{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*24*textScale});}
 }
 throw new Error('No measured layout');
}
it.each([[320,1],[390,1],[768,1.5],[1440,3]])('bounds a complete 197-option domain in one control at %s, scale %s',(width,scale)=>{
 const layout=solve(width,scale),select=layout.nodes.filter(node=>node.kind==='select');expect(select).toHaveLength(1);expect(select[0].options).toHaveLength(197);expect(select[0].box.height).toBeGreaterThanOrEqual(44);const envelope=layout.nodes.find(node=>node.id===select[0].parent)!;expect(select[0].box.x).toBeGreaterThanOrEqual(6);expect(select[0].box.y).toBeGreaterThanOrEqual(6);expect(select[0].box.x+select[0].box.width).toBeLessThanOrEqual(envelope.box.width-6);expect(layout.nodes.filter(node=>node.kind==='choice')).toHaveLength(0);expect(validateLayout(layout)).toEqual([]);
});
it('provides fully wrapped current-label text when a closed native field cannot show it',()=>{const layout=solve(320,1.5,true);expect(layout.nodes.some(node=>node.kind==='text'&&node.label.startsWith('1 · 여러 언어'))).toBe(true);});
it('rejects mixed authority and duplicate native choice bindings before publication',()=>{
 const layout=solve(390,1),select=layout.nodes.find(node=>node.kind==='select')!;
 for(const invalid of [{...select,actionId:'do-not-send'},{...select,options:[select.options![0],select.options![0]]},{...select,selectedOptionId:'missing'}])expect(validateLayout({...layout,nodes:layout.nodes.map(node=>node.id===select.id?invalid:node)}).some(error=>error.includes('Invalid native choice binding'))).toBe(true);
});

it.each([[197,false],[300,false],[300,true]] as const)('admits %s exact options (long labels %s) in bounded measurement batches and reuses its submit envelope',(count,longName)=>{
 const session=createCardSession<LargeChoiceAction>({transport:()=>{}});const document=largeChoiceDocument({count,longName});
 // Mix short, near-wrap and multi-line labels in the same finite domain.
 const mixed=longName&&document.decision.kind==='finite-choice'?{...document,decision:{...document.decision,fields:document.decision.fields.map(field=>({...field,options:field.options.map((option,index)=>({...option,label:index===0?'1':index===1?'Near wrap label with enough words':option.label}))}))}}:document;
 session.receive(mixed);let callbacks:SurfaceCallbacks;
 const fallback=vi.fn();
 const measure=vi.fn<SurfacePort['measure']>((requests,reply)=>{reply(requests.map(request=>{const natural=[...request.text].length*10,width=request.width??natural;return {key:request.key,size:{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*24}};}));return()=>{};});
 const surface:SurfacePort={identity:{},environment:()=>env,listen(value){callbacks=value;return()=>{};},measure,publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback,clear:()=>{}};
 const table=createCardTable({session});table.attach(surface);expect(table.inspect().status,JSON.stringify(fallback.mock.calls)).toBe('ready');
 // The300-option fixtures deliberately exceed one512-key measurement batch.
 // The197-option domain still proves complete admission without requiring
 // redundant identity/count metrics to inflate its working set.
 const measuredKeys=new Set(measure.mock.calls.flatMap(([requests])=>requests.map(request=>request.key)));
 if(count===300){expect(measuredKeys.size).toBeGreaterThan(512);expect(measure.mock.calls.length).toBeGreaterThan(1);}
 expect(measure.mock.calls.every(([requests])=>requests.length<=512)).toBe(true);expect(table.inspect().cacheSize).toBeLessThanOrEqual(2048);
 const first=table.inspect().frame!,control=first.nodes.find(node=>node.kind==='select')!,before=measure.mock.calls.length;
 expect(control.options?.map(option=>option.id)).toEqual(Array.from({length:count},(_,index)=>String(index+1)));
 const submit=first.nodes.find(node=>node.actionId==='amount:1')!;
 callbacks!.intent({kind:'choose',frameId:first.id,nodeId:control.id,optionId:'197'});
 expect(table.inspect().status).toBe('ready');expect(measure.mock.calls.length).toBe(before);
 const next=table.inspect().frame!.nodes.find(node=>node.actionId==='amount:197')!;expect(next.box).toEqual(submit.box);
 const allocations=(frame:typeof first)=>frame.nodes.filter(node=>node.kind==='select'||node.id==='dock'||node.id.includes('select-summary-envelope')).map(node=>({id:node.id,box:node.box}));
 const baseline=allocations(first);
 for(const optionId of ['2',String(count),'1']){
  callbacks!.intent({kind:'choose',frameId:table.inspect().frame!.id,nodeId:control.id,optionId});
  const frame=table.inspect().frame!;expect(table.inspect().status).toBe('ready');expect(measure.mock.calls.length).toBe(before);expect(allocations(frame)).toEqual(baseline);
  expect(frame.nodes.find(node=>node.actionId===`amount:${optionId}`)!.box).toEqual(submit.box);expect(validateLayout(frame)).toEqual([]);
 }
 table.dispose();session.dispose();
});

it.each([[1440,1],[390,2]])('renders the full native 1276-action Mighty domain under the unchanged metric budget at %s/%s',(width,textScale)=>{
 const send=vi.fn(),session=createCardSession<MightyCommand>({transport:send});session.receive(mightyBidPressureDocument());
 let callbacks:SurfaceCallbacks;
 const fallback=vi.fn();
 const measure=vi.fn<SurfacePort['measure']>((requests,reply)=>{reply(requests.map(request=>{const natural=[...request.text].length*10*textScale,allocation=request.width??natural;return {key:request.key,size:{width:Math.min(allocation,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,allocation)))*24*textScale}};}));return()=>{};});
 const surface:SurfacePort={identity:{},environment:()=>({...env,width,textScale}),listen(value){callbacks=value;return()=>{};},measure,publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback,clear:()=>{}};
 const table=createCardTable({session});table.attach(surface);expect(table.inspect().status,JSON.stringify({fallback:fallback.mock.calls,rounds:measure.mock.calls.map(([requests])=>({n:requests.length,first:requests[0]&&[requests[0].text,requests[0].role,requests[0].width],last:requests.at(-1)&&[requests.at(-1)!.text,requests.at(-1)!.role,requests.at(-1)!.width]}))})).toBe('ready');expect(table.inspect().cacheSize).toBeLessThanOrEqual(2048);expect(measure.mock.calls.every(([requests])=>requests.length<=512)).toBe(true);
 const first=table.inspect().frame!,count=first.nodes.find(node=>node.kind==='choice'&&node.fieldId==='count'&&node.optionId==='255')!,before=measure.mock.calls.length;
 expect(first.nodes.filter(node=>node.kind==='choice'&&node.fieldId==='count')).toHaveLength(255);expect(first.nodes.filter(node=>node.kind==='select')).toEqual([]);callbacks!.intent({kind:'activate',frameId:first.id,nodeId:count.id});
 const next=table.inspect().frame!,trump=next.nodes.find(node=>node.fieldId==='trump'&&node.optionId==='no-trump');
 if(trump)callbacks!.intent({kind:'activate',frameId:next.id,nodeId:trump.id});
 else{const select=next.nodes.find(node=>node.kind==='select'&&node.fieldId==='trump')!;callbacks!.intent({kind:'choose',frameId:next.id,nodeId:select.id,optionId:'no-trump'});}
 expect(table.inspect().frame!.nodes.find(node=>node.fieldId==='count'&&node.optionId==='255')?.checked).toBe(true);expect(table.inspect().frame!.nodes.find(node=>node.fieldId==='trump'&&node.optionId==='no-trump')?.checked).toBe(true);expect(table.inspect().status).toBe('ready');expect(measure.mock.calls.length).toBe(before);expect(session.snapshot().document!.offer.actions).toHaveLength(1276);expect(send).not.toHaveBeenCalled();expect(validateLayout(table.inspect().frame!)).toEqual([]);
 table.dispose();session.dispose();
});
