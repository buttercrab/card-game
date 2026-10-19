import {expect,it,vi} from 'vitest';
import {admitPublicCompletion,currentPublicCompletion,currentPublicGameplayPresentation,issuePublicGameplayRead,readPublicGameplayPresentation,isPublicCompletionView,retirePublicCompletionGrant,completionFrameInputProof} from './publicCompletion';
import {publicPaintResources} from './paintResources';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {planTable,typography,validateLayout} from './planner';
import type {CandidateLayout,ChoiceView,Environment,MeasureRequest,PresentationFrame,Size,TableDocument,TableCard,SurfaceCallbacks,PlannedNode} from './contracts';
const environment:Environment={width:1280,height:800,textScale:1,fontFamily:'sans-serif',fontRevision:'completion',revision:'completion',controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const empty:ChoiceView={selected:null,fields:[],commands:[],values:{}};
function metric(r:MeasureRequest):Size{const natural=[...r.text].length*7*r.environment.textScale,w=r.width??natural;return {width:Math.min(w,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,w)))*typography(r.role,r.environment).lineHeight};}
function solve(doc:TableDocument<unknown>,choices=empty,env=environment){const metrics=new Map<string,Size>(),requests:MeasureRequest[]=[];for(let pass=0;pass<16;pass++){const result=planTable(doc,env,choices,metrics);if(result.kind==='ready'){expect(validateLayout(result.layout)).toEqual([]);return {layout:result.layout,requests};}if(result.kind!=='needs')throw Error(JSON.stringify(result));for(const request of result.requests){requests.push(request);metrics.set(request.key,metric(request));}}throw Error('measurements did not converge');}
function fixture(){const own:TableCard={id:'incoming',ownerId:'me',label:'PRIVATE_OLD_HAND_LABEL',visual:{kind:'standard',suit:'Heart',rank:14}},peers=Array.from({length:4},(_,i)=>({id:`p${i}`,name:`상대${i}`,handCount:0})),cards=peers.map((p,i):TableCard=>({id:`public-${i}`,ownerId:p.id,label:`Public ${i}`,visual:{kind:'standard',suit:'Spade',rank:i+2}})),before:TableDocument<unknown>={context:{session:'s',audience:'me',generation:'hand',revision:'old'},participant:{id:'me',name:'내 이름',markers:[]},opponents:peers,hand:[own],facts:[],collections:[{id:'trick',label:'현재 트릭',kind:'trick',purpose:'play',cards},{id:'stock',label:'옛 키티',purpose:'stock',cards:[],hiddenCount:3}],presentation:{id:'play',schemaVersion:1,tableCollectionIds:['trick']},decision:{id:'play',kind:'commands',commands:[]},offer:{id:'old',actions:[]}},next:TableDocument<unknown>={...before,context:{...before.context,revision:'done'},hand:[],participant:{...before.participant,name:'새 이름'},information:[{id:'result',title:'UNUSED_RESULT_MATRIX',primary:{value:{kind:'text',text:'UNUSED_SCORE'}},fields:[]}],outcome:{id:'done',informationId:'result',continuationActionIds:['next']},presentation:{id:'done',schemaVersion:1,tableCollectionIds:[]},collections:[{id:'trick',label:'현재 트릭',kind:'trick',purpose:'play',cards:[]},{id:'captured',label:'HIDDEN_CAPTURED',purpose:'captured',collectedBy:'p0',cards:[...cards,{...own,label:'PUBLIC_INCOMING'}]},{id:'stock',label:'미래 덱',purpose:'stock',kind:'deck',availability:'next-deal',hiddenCount:53,cards:[]}],decision:{id:'done',kind:'commands',commands:['next']},offer:{id:'new',actions:[{id:'next',kind:'command',intent:'primary',enabled:true,label:'UNUSED_NEXT',action:'next'}]}};return {before,next};}
function frame(doc:TableDocument<unknown>,layout:CandidateLayout,env=environment):PresentationFrame{return {...layout,id:1,environment:env,context:doc.context,offerId:doc.offer.id,settled:false,rosterIds:[doc.participant.id,...doc.opponents!.map(p=>p.id)],paintResources:publicPaintResources(doc)};}

it('binds exact issued view and recipe, rejects accessor substitution, expiry and semantic drift',()=>{
 const {before,next}=fixture(),old=frame(before,solve(before).layout),resources=publicPaintResources(next),view=admitPublicCompletion(old,before,next,resources,100)!;
 expect(view).not.toBeNull();expect(currentPublicCompletion(view,next,resources,environment,101)).toBe(true);expect(JSON.stringify(view)).not.toMatch(/PRIVATE_|PUBLIC_INCOMING|visual|action|offer/);
 expect(isPublicCompletionView({...view})).toBe(false);expect(currentPublicCompletion({...view,entityIds:['fake'],recipe:{...view.recipe}},next,resources,environment,101)).toBe(false);
 const getter=vi.fn(()=>view.event);expect(isPublicCompletionView(Object.defineProperty({},'event',{get:getter}))).toBe(false);expect(getter).not.toHaveBeenCalled();
 expect(currentPublicCompletion(view,next,resources,{...environment,revision:'changed'},101)).toBe(false);expect(currentPublicCompletion(view,next,resources,environment,view.event.expiresAt)).toBe(false);
 if(resources.status!=='available')throw Error('resources');expect(currentPublicCompletion(view,next,{...resources,collections:resources.collections.map(zone=>zone.id===view.capturedCollectionId?{...zone,purpose:'play'}:zone)},environment,101)).toBe(false);
 retirePublicCompletionGrant(view.event);expect(isPublicCompletionView(view)).toBe(false);
});
it('requires exact old visible faces, new incoming art and unique captured destination',()=>{
 const {before,next}=fixture(),old=frame(before,solve(before).layout),resources=publicPaintResources(next);
 expect(admitPublicCompletion({...old,nodes:old.nodes.map(node=>node.entityId==='public-0'?{...node,visual:{kind:'standard',suit:'Heart',rank:2}}:node)},before,next,resources,0)).toBeNull();
 expect(admitPublicCompletion(old,{...before,hand:before.hand.map(card=>({...card,visual:{kind:'standard',suit:'Heart',rank:13}}))},next,resources,0)).toBeNull();
 const aliased={...before,collections:[...before.collections!,{...next.collections![1],id:'already-public'}]};expect(admitPublicCompletion({...old,paintResources:publicPaintResources(aliased)},aliased,next,resources,0)).toBeNull();
 const duplicated={...next,collections:[...next.collections!,{...next.collections![1],id:'second-capture'}]};expect(admitPublicCompletion(old,before,duplicated,publicPaintResources(duplicated),0)).toBeNull();
});
it.each(['completed','unfulfilled'] as const)('separates input fence and native receipt, atomically retires %s before continuation paint',async outcome=>{
 const {before,next}=fixture(),session=createCardSession<unknown>({transport:vi.fn()});session.receive(before);let callbacks!:SurfaceCallbacks;
 const table=createCardTable({session,planner:(doc,env,choices)=>({kind:'ready',layout:solve(doc,choices,env).layout})});
 table.attach({identity:{},environment:()=>environment,listen(value){callbacks=value;return()=>{};},measure:()=>()=>{},publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback:reason=>{throw Error(reason);},clear:()=>{}});
 session.receive(next);await vi.waitFor(()=>expect(table.inspect().frame?.publicCompletion).toBeDefined());
 const current=table.inspect().frame!,view=current.publicCompletion!;expect(completionFrameInputProof(current,session.snapshot().document!)).toBe(true);
 const poison:Partial<PlannedNode>[]=[{kind:'command',enabled:true},{kind:'choice',enabled:true},{kind:'select',enabled:true},{kind:'editor',enabled:true},{kind:'toggle',enabled:true},{kind:'range',enabled:true},{formIntent:'submit'},{formActionId:'next'},{formNavigation:{leaseId:'forged'}},{editor:{leaseId:'forged',fieldId:'f',value:'',kind:'text',maxCodeUnits:10}},{shellActionId:'next'},{shellIntent:{kind:'command',actionId:'next'}},{disclosureCatalogId:'history'},{assistanceIntent:{kind:'tool',toolId:'advice'}}];
 for(const patch of poison)expect(completionFrameInputProof({...current,nodes:[...current.nodes,{id:'poison',parent:'table',kind:'text',label:'Poison',box:{x:0,y:0,width:44,height:44},...patch}]},next),JSON.stringify(patch)).toBe(false);
 
 expect(completionFrameInputProof({...current,nodes:[...current.nodes,{id:'poison',parent:'table',kind:'command',label:'Next',enabled:true,actionId:'next',box:{x:0,y:0,width:44,height:44}}]},next)).toBe(false);
 expect(callbacks.publicCompletionEnd!(current.id,view.event,'completed')).toBe(false);expect(callbacks.completionReady!(current.id,view.event)).toBe(false);expect(callbacks.completionFence!(current.id,view.event,true)).toBe(true);expect(callbacks.publicCompletionEnd!(current.id,view.event,'completed')).toBe(false);expect(callbacks.completionFence!(current.id,view.event,false)).toBe(false);
 if(outcome==='completed')expect(callbacks.completionReady!(current.id,view.event)).toBe(true);expect(callbacks.publicCompletionEnd!(current.id,view.event,outcome)).toBe(true);expect(isPublicCompletionView(view)).toBe(false);
 await vi.waitFor(()=>expect(table.inspect().frame?.publicCompletion).toBeUndefined());expect(table.inspect().completionOutcome).toBe(outcome);expect(session.snapshot().operations).toHaveLength(0);expect(callbacks.publicCompletionEnd!(current.id,view.event,'completed')).toBe(false);table.dispose();session.dispose();
});

it.each(['disconnect','replacement','expiry'] as const)('revokes the event on %s without replay or retained private paint',async interruption=>{
 const {before,next}=fixture(),session=createCardSession<unknown>({transport:vi.fn()});session.receive(before);let callbacks!:SurfaceCallbacks;
 const table=createCardTable({session,planner:(doc,env,choices)=>({kind:'ready',layout:solve(doc,choices,env).layout})});
 table.attach({identity:{},environment:()=>environment,listen(value){callbacks=value;return()=>{};},measure:()=>()=>{},publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback:reason=>{throw Error(reason);},clear:()=>{}});
 session.receive(next);await vi.waitFor(()=>expect(table.inspect().frame?.publicCompletion).toBeDefined());const current=table.inspect().frame!,view=current.publicCompletion!;
 expect(callbacks.completionFence!(current.id,view.event,true)).toBe(true);
 if(interruption==='disconnect')session.setConnected(false);
 else if(interruption==='replacement')session.receive({...next,context:{...next.context,revision:'new-hand',generation:'new-hand'},outcome:undefined,information:undefined,hand:before.hand,collections:before.collections,presentation:before.presentation,offer:before.offer,decision:before.decision});
 else await new Promise(resolve=>setTimeout(resolve,Math.max(0,view.event.expiresAt-performance.now()+5))); 
 await vi.waitFor(()=>expect(isPublicCompletionView(view)).toBe(false));expect(callbacks.completionReady!(current.id,view.event)).toBe(false);expect(callbacks.publicCompletionEnd!(current.id,view.event,'completed')).toBe(false);expect(session.snapshot().operations).toHaveLength(0);expect(table.inspect().completionOutcome).toBe('unfulfilled');table.dispose();session.dispose();
});

it('leases outgoing inert HUD only through exact current issued completion identity',()=>{
 const f=fixture(),symbol={kind:'card' as const,visual:{kind:'standard' as const,suit:'Diamond' as const,rank:14},label:'Public unplayed friend symbol'},panel={id:'hud',title:'HUD',fields:[{id:'friend',label:'Friend',value:symbol}]},before={...f.before,information:[panel],scoreboard:{id:'score',title:'Score',columns:[{id:'total',label:'Total'}],rows:[{participantId:'me',values:[-144]}]},participant:{...f.before.participant,status:{purpose:'standing' as const,tone:'gold' as const,value:{kind:'text' as const,text:'4점'}}}},next=f.next;
 const old=frame(before,solve(before).layout),resources=publicPaintResources(next),view=admitPublicCompletion(old,before,next,resources,100)!;expect(view).not.toBeNull();
 const get=(v=view,doc=next,r=resources,env=environment,now=101)=>currentPublicGameplayPresentation(v,doc,r,env,now),hud=get()!;expect(hud).not.toBeNull();expect(hud.information[0].fields[0].value).toEqual(symbol);expect(hud.scoreboard!.rows[0].values).toEqual([-144]);expect(view).not.toHaveProperty('gameplay');expect(JSON.stringify(view)).not.toContain('Public unplayed');
 panel.title='Changed';symbol.label='Changed symbol';expect(hud.information[0].title).toBe('HUD');expect(hud.information[0].fields[0].value).toMatchObject({label:'Public unplayed friend symbol'});
 expect(get({...view})).toBeNull();expect(get({...view,recipe:{...view.recipe}})).toBeNull();expect(get(view,{...next,context:{...next.context,audience:'other'}})).toBeNull();expect(get(view,{...next,context:{...next.context,generation:'other'}})).toBeNull();expect(get(view,{...next,opponents:next.opponents!.slice(1)})).toBeNull();expect(get(view,next,resources,{...environment,revision:'changed'})).toBeNull();expect(get(view,next,resources,environment,view.event.expiresAt)).toBeNull();expect(get(view,next,{status:'unavailable',reason:'budget'})).toBeNull();
 retirePublicCompletionGrant(view.event);expect(get()).toBeNull();
});

it('admits one opaque read per exact event; deterministic lookup rejects forged values and reads no clock',()=>{
 const {before,next}=fixture(),resources=publicPaintResources(next),old=frame(before,solve(before).layout),view=admitPublicCompletion(old,before,next,resources,100)!;
 const read=issuePublicGameplayRead(view,next,resources,environment,101)!;expect(read).not.toBeNull();expect(issuePublicGameplayRead(view,next,resources,environment,102)).toBe(read);expect(issuePublicGameplayRead(view,next,resources,environment,view.event.expiresAt)).toBeNull();expect(issuePublicGameplayRead(view,next,resources,environment,NaN)).toBeNull();
 const clock=vi.spyOn(performance,'now').mockImplementation(()=>{throw Error('planner clock read');}),date=vi.spyOn(Date,'now').mockImplementation(()=>{throw Error('planner clock read');});
 try{expect(readPublicGameplayPresentation(read,view,next,resources,environment)).not.toBeNull();expect(readPublicGameplayPresentation({...read},view,next,resources,environment)).toBeNull();expect(readPublicGameplayPresentation(undefined,view,next,resources,environment)).toBeNull();expect(readPublicGameplayPresentation(read,{...view},next,resources,environment)).toBeNull();expect(readPublicGameplayPresentation(read,view,{...next,context:{...next.context,audience:'foreign'}},resources,environment)).toBeNull();expect(readPublicGameplayPresentation(read,view,next,{status:'unavailable',reason:'budget'},environment)).toBeNull();expect(clock).not.toHaveBeenCalled();expect(date).not.toHaveBeenCalled();}finally{clock.mockRestore();date.mockRestore();}
 const missing=planTable(next,environment,{...empty,publicCompletion:view},new Map());expect(missing).toEqual({kind:'failed',reason:'Unavailable owned public gameplay read'});
 expect(planTable(next,environment,{...empty,publicCompletion:view,publicGameplayRead:{...read}},new Map())).toEqual(missing);
 const poisoned=Object.assign({...empty,publicCompletion:view},{publicGameplayPresentation:{facts:[{id:'fake',value:'LATEST_SCORE'}]}});expect(planTable(next,environment,poisoned,new Map())).toEqual(missing);
 const getter=vi.fn(()=>read),getterChoices=Object.defineProperty({...empty,publicCompletion:view},'publicGameplayRead',{get:getter});expect(planTable(next,environment,getterChoices,new Map())).toEqual(missing);expect(getter).not.toHaveBeenCalled();
 const snapshotGetter=vi.fn(()=>({information:[{id:'fake',title:'FORGED_HUD'}]})),injected=Object.defineProperty({...empty,publicCompletion:view,publicGameplayRead:read},'publicGameplayPresentation',{enumerable:true,get:snapshotGetter}),selected=solve(next,injected).layout;expect(selected.nodes.some(node=>node.label==='FORGED_HUD')).toBe(false);expect(snapshotGetter).not.toHaveBeenCalled();
 retirePublicCompletionGrant(view.event);expect(readPublicGameplayPresentation(read,view,next,resources,environment)).toBeNull();
});
it('runtime refuses a synchronous completion plan that expires before publication and settles current state without replay',()=>{
 const {before,next}=fixture(),session=createCardSession<unknown>({transport:vi.fn()}),published:PresentationFrame[]=[];let expired=false;
 const clock=vi.spyOn(performance,'now').mockReturnValue(100);session.receive(before);
 const table=createCardTable({session,planner:(doc,env,choices)=>{const result={kind:'ready' as const,layout:solve(doc,choices,env).layout};if(choices.publicCompletion&&!expired){expired=true;clock.mockReturnValue(choices.publicCompletion.event.expiresAt);}return result;}});
 try{
  table.attach({identity:{},environment:()=>environment,listen:()=>()=>{},measure:()=>()=>{},publish:value=>{published.push(value);},disarm:()=>{},invalidate:()=>{},fallback:reason=>{throw Error(reason);},clear:()=>{}});session.receive(next);
  expect(expired).toBe(true);expect(published.some(value=>value.publicCompletion)).toBe(false);expect(table.inspect().frame?.outcomeLaneId).toBe('outcome');expect(table.inspect().completionOutcome).toBe('unfulfilled');expect(session.snapshot().operations).toHaveLength(0);
 }finally{table.dispose();session.dispose();clock.mockRestore();}
});
