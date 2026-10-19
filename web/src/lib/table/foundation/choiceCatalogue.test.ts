import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {validateLayout} from './planner';
import {validateDecision} from '../decision';
import type {Environment,SurfaceCallbacks,TableDocument} from './contracts';
function document():TableDocument<{call:string}>{
 const options=Array.from({length:54},(_,i)=>({id:`card-${i}`,label:i===53?'No friend':`Card ${i}`,enabled:true,...(i===53?{}:{visual:{kind:'standard' as const,suit:'Spade' as const,rank:2+i%13}}),...(i===12?{description:'This is a held card.'}:{})}));
 return {context:{session:'s',audience:'alice',generation:'1',revision:'1'},participant:{id:'alice',name:'Alice',markers:[]},opponents:Array.from({length:4},(_,i)=>({id:`p${i}`,name:`Peer ${i}`,handCount:10})),hand:[],facts:[],decision:{kind:'finite-choice',id:'friend',commands:[],fields:[{id:'call',label:'Friend',options,catalogue:{title:'Choose a friend card',openLabel:'Other card…',featuredIds:['card-0','card-53'],groups:[{id:'cards',label:'Cards',optionIds:options.slice(0,53).map(o=>o.id)},{id:'other',label:'Other',optionIds:['card-53']}]}}],variants:options.map(o=>({tuple:{call:o.id},actionId:o.id})),initialValues:{call:'card-0'},reconciliation:'preserve-compatible',submit:{unavailable:'disabled'}},offer:{id:'offer',actions:options.map(o=>({id:o.id,kind:'command',label:`Call ${o.label}`,enabled:true,intent:'primary',action:{call:o.id}}))}};
}
function fixture(source=document()){
 const send=vi.fn(),session=createCardSession<{call:string}>({transport:send});session.receive(source);let callbacks!:SurfaceCallbacks;
 let environment:Environment={width:768,height:1024,fontRevision:'1',revision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
 const preserveModal=vi.fn(),surface={identity:{},environment:()=>environment,listen(next:SurfaceCallbacks){callbacks=next;return()=>{};},measure(requests:readonly import('./contracts').MeasureRequest[],reply:(values:readonly import('./contracts').MeasureReply[])=>void){reply(requests.map(r=>{const natural=r.text.length*8*r.environment.textScale,width=r.width??natural;return{key:r.key,size:{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*20*r.environment.textScale}};}));return()=>{};},publish(){},disarm(){},preserveModal,invalidate(){},fallback(reason:string){throw Error(reason);},clear(){}};
 const table=createCardTable({session});table.attach(surface);
 return {session,table,send,surface,preserveModal,get callbacks(){return callbacks;},activate(id:string){callbacks.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId:id});},resize(width:number,height:number,textScale=1){environment={...environment,width,height,textScale,revision:`${width}:${height}:${textScale}`};callbacks.environment(environment);},dispose(){table.dispose();session.dispose();}};
}
const option=(id:string)=>JSON.stringify(['catalogue-option','call',id]);
test('featured choices and catalogue draft share canonical bindings; cancel does not change the main draft',async()=>{
 const f=fixture();expect(f.table.inspect().status).toBe('ready');let frame=f.table.inspect().frame!;expect(validateLayout(frame)).toEqual([]);expect(frame.nodes.filter(n=>n.kind==='choice')).toHaveLength(2);expect(frame.nodes.some(n=>n.kind==='select')).toBe(false);
 const open=frame.nodes.find(n=>n.catalogueIntent?.kind==='open')!;f.activate(open.id);frame=f.table.inspect().frame!;expect(frame.modalId).toBe('choice-catalogue');expect(frame.revealFocusId).toBe(option('card-0'));expect(frame.nodes.find(n=>n.id===frame.modalId)?.choiceLeaseId).toBeTruthy();expect(frame.nodes.filter(n=>n.choiceCard)).toHaveLength(53);
 f.activate(option('card-12'));expect(f.table.inspect().frame!.nodes.find(n=>n.id==='catalogue-confirm')).toMatchObject({actionId:'card-12',enabled:true});expect(f.table.inspect().frame!.nodes.some(n=>n.label==='This is a held card.')).toBe(true);expect(f.send).not.toHaveBeenCalled();
 f.activate('catalogue-cancel');frame=f.table.inspect().frame!;expect(frame.modalId).toBeUndefined();expect(frame.nodes.find(n=>n.kind==='choice'&&n.optionId==='card-0')?.checked).toBe(true);expect(frame.focusId).toBe(open.id);expect(f.session.snapshot().operations).toEqual([]);
 f.activate(open.id);f.activate(option('card-12'));f.activate('catalogue-confirm');await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action).toEqual({call:'card-12'});expect(f.table.inspect().frame!.modalId).toBeUndefined();f.dispose();
});
test('catalogue keeps its lease and draft across resize but closes on changed authority or detachment',()=>{
 const f=fixture();f.activate(f.table.inspect().frame!.nodes.find(n=>n.catalogueIntent?.kind==='open')!.id);f.activate(option('card-12'));let frame=f.table.inspect().frame!,lease=frame.nodes.find(n=>n.id===frame.modalId)!.choiceLeaseId;
 f.resize(390,844,2);frame=f.table.inspect().frame!;expect(frame.nodes.find(n=>n.id===frame.modalId)?.choiceLeaseId).toBe(lease);expect(frame.nodes.find(n=>n.id==='catalogue-confirm')?.actionId).toBe('card-12');expect(f.preserveModal).toHaveBeenCalledWith(lease);expect(validateLayout(frame)).toEqual([]);
 const old=frame.id,changed=document();f.session.receive({...changed,context:{...changed.context,revision:'2'},offer:{...changed.offer,id:'new-offer'}});expect(f.table.inspect().frame!.modalId).toBeUndefined();f.callbacks.intent({kind:'activate',frameId:old,nodeId:'catalogue-confirm'});expect(f.session.snapshot().operations).toEqual([]);
 f.activate(f.table.inspect().frame!.nodes.find(n=>n.catalogueIntent?.kind==='open')!.id);f.table.detach();f.table.attach(f.surface);expect(f.table.inspect().frame!.modalId).toBeUndefined();f.dispose();
});
test('catalogue metadata cannot hide, duplicate or invent native choices',()=>{
 const doc=document();if(doc.decision.kind!=='finite-choice')throw Error();const spec=doc.decision,field=spec.fields[0],catalogue=field.catalogue!;
 for(const patch of [{featuredIds:['invented']},{featuredIds:['card-0','card-0']},{groups:[{id:'missing',label:'Only one',optionIds:['card-0']}]},{groups:[{id:'duplicates',label:'Duplicate',optionIds:Array(54).fill('card-0')}]}])expect(validateDecision({...spec,fields:[{...field,catalogue:{...catalogue,...patch}}]},doc.offer).length).toBeGreaterThan(0);
});

test('consequences consume scroll space without shifting the confirmation target',()=>{
 const f=fixture();f.resize(320,568,2);f.activate(f.table.inspect().frame!.nodes.find(n=>n.catalogueIntent?.kind==='open')!.id);
 const before=f.table.inspect().frame!,buttonBefore=before.nodes.find(n=>n.id==='catalogue-confirm')!;
 f.activate(option('card-12'));const after=f.table.inspect().frame!;
 expect(after.nodes.find(n=>n.id==='catalogue-confirm')?.box).toEqual(buttonBefore.box);
 expect(after.nodes.find(n=>n.id==='catalogue-confirm')?.accessibleDescription).toBe('This is a held card.');
 expect(after.nodes.find(n=>n.id===option('card-12'))?.accessibleDescription).toBe('This is a held card.');
 expect(before.nodes.find(n=>n.id==='catalogue-viewport')!.box.height).toBeGreaterThan(after.nodes.find(n=>n.id==='catalogue-viewport')!.box.height);
 expect(validateLayout(after)).toEqual([]);f.dispose();
});

test('a maximum-length catalogue consequence scrolls with its options while confirmation remains visible',()=>{
 const source=document(),warning='Held card consequence. '.repeat(46).slice(0,1000);if(source.decision.kind!=='finite-choice')throw Error('finite choice');
 const decision={...source.decision,fields:source.decision.fields.map(field=>({...field,options:field.options.map(option=>option.id==='card-12'?{...option,description:warning}:option)}))};
 const f=fixture({...source,decision});f.resize(320,568,2);f.activate(f.table.inspect().frame!.nodes.find(node=>node.catalogueIntent?.kind==='open')!.id);f.activate(option('card-12'));
 const frame=f.table.inspect().frame!,viewport=frame.nodes.find(node=>node.id==='catalogue-viewport')!,description=frame.nodes.find(node=>node.id==='catalogue-description-text')!,confirmation=frame.nodes.find(node=>node.id==='catalogue-confirm')!;
 expect(f.table.inspect().status).toBe('ready');expect(viewport.box.height).toBeGreaterThanOrEqual(44);expect(description.label).toBe(warning);expect(description.parent).toBe('catalogue-content');
 expect(confirmation.accessibleDescription).toBe(warning);expect(frame.nodes.find(node=>node.id===option('card-12'))?.accessibleDescription).toBe(warning);
 const global=(id:string)=>{let node=frame.nodes.find(node=>node.id===id)!;const box={...node.box};while(node.parent){node=frame.nodes.find(parent=>parent.id===node.parent)!;box.x+=node.box.x;box.y+=node.box.y;}return box;};
 for(const id of ['catalogue-cancel','catalogue-confirm']){const box=global(id);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(568);}
 expect(validateLayout(frame)).toEqual([]);expect(f.send).not.toHaveBeenCalled();f.dispose();
});
