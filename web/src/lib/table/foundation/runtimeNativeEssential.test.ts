import {expect,it,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {createAssistanceSnapshot} from './assistance';
import {essentialInputMask} from './essentialInput';
import type {CandidateLayout,Environment,PlannedNode,PresentationFrame,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
const control={fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1};
const environment:Environment={width:500,height:700,fontFamily:'sans-serif',textScale:1,revision:'1',fontRevision:'1',controls:{command:control,choice:control}};
function document():TableDocument<string>{return {
 context:{session:'native',audience:'me',generation:'hand',revision:'1'},participant:{id:'me',name:'Me',markers:[]},interaction:{cardActivation:'single'},
 presentation:{id:'play',schemaVersion:1,selection:{kind:'card-selection',mode:'one',submit:{prefix:'Play'},statusLabels:['카드 선택 · 0장','카드 선택 · 1장'],submitLabels:['Play Ace','Play Two']}},
 hand:[{id:'ace',label:'Ace',visual:{kind:'standard',suit:'Spade',rank:14}},{id:'two',label:'Two',visual:{kind:'standard',suit:'Spade',rank:2}}],facts:[],
 decision:{id:'play',kind:'card-selection',mode:'one',commands:[],variants:[{cardIds:['ace'],actionId:'play'},{cardIds:['two'],actionId:'blocked'}],submit:{prefix:'Play'}},
 offer:{id:'offer',actions:[{id:'play',kind:'command',label:'Ace',intent:'primary',enabled:true,action:'canonical-ace'},{id:'blocked',kind:'command',label:'Two',intent:'primary',enabled:false,action:'canonical-two'}]}
};}
function fixture(source=document(),patch:(layout:CandidateLayout)=>CandidateLayout=layout=>layout){
 const send=vi.fn(),session=createCardSession<string>({transport:send});session.receive(source);
 let callbacks!:SurfaceCallbacks,current!:PresentationFrame;const admissions:boolean[]=[];
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(value){callbacks=value;return()=>{};},measure:()=>()=>{},publish(frame){current=frame;admissions.push(callbacks.essential!(frame.id,'native-flight',true));},disarm:vi.fn(),invalidate:vi.fn(),clear:vi.fn(),fallback:vi.fn()};
 const table=createCardTable({session,planner:(doc,_env,choices)=>{
  const nodes:PlannedNode[]=[{id:'table',parent:null,kind:'group',label:'Table',box:{x:0,y:0,width:500,height:700}},
   {id:'table-underlay',parent:'table',kind:'group',label:'Underlay',box:{x:0,y:0,width:500,height:700}},
   {id:'hand',parent:'table-underlay',kind:'group',label:'Hand',box:{x:0,y:300,width:500,height:160}},
   ...doc.hand.map((card,index)=>{const inspect=!!choices.assistance?.projection.inspections.some(item=>item.cardId===card.id)&&!choices.cards?.eligible?.includes(card.id);return {id:`card:${card.id}`,parent:'hand',kind:'card' as const,...(inspect?{inspectCardId:card.id,enabled:true}:{cardId:card.id,enabled:choices.cards?.available.includes(card.id)??false}),entityId:card.id,zoneId:'hand',label:card.label,visual:card.visual,checked:choices.cards?.selected.includes(card.id),box:{x:10+index*100,y:10,width:88,height:124}};})];
  // An untrusted/custom planner cannot manufacture runtime native provenance.
  return {kind:'ready',layout:patch({width:500,height:700,recipe:'stacked',nodes,...{essentialInputKind:'native-cards'}})};
 }});table.attach(surface);expect(surface.fallback).not.toHaveBeenCalled();
 return {table,session,send,admissions,surface,get frame(){return current;},get callbacks(){return callbacks;},dispose(){table.dispose();session.dispose();}};
}
it('owns an exact native hand lease before paint and blocks AT, focus and canonical dispatch until release',async()=>{
 const f=fixture(),frame=f.frame;expect(frame.essentialInputKind).toBe('native-cards');expect(f.admissions).toEqual([true]);expect(essentialInputMask(frame)).toEqual({kind:'native-cards',inputIds:['card:ace','card:two'],laneNodeIds:[]});
 for(const nodeId of ['card:ace','card:two']){f.callbacks.intent({kind:'focus',frameId:frame.id,nodeId});f.callbacks.intent({kind:'activate',provenance:'direct',frameId:frame.id,nodeId});}
 expect(f.table.inspect().focusId).toBeNull();expect(f.session.snapshot().operations).toEqual([]);expect(f.send).not.toHaveBeenCalled();
 expect(f.callbacks.essential!(frame.id,'foreign',false)).toBe(false);expect(f.callbacks.essential!(frame.id,'native-flight',false)).toBe(true);
 f.callbacks.intent({kind:'activate',frameId:frame.id,nodeId:'card:ace'});expect(f.send).not.toHaveBeenCalled();
 f.callbacks.intent({kind:'begin',frameId:frame.id,nodeId:'card:ace'});f.callbacks.intent({kind:'activate',frameId:frame.id,nodeId:'card:ace'});await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action).toBe('canonical-ace');f.dispose();
});
it.each(['default','cohort','many','count','observer','commands'] as const)('planner provenance cannot create a native lease for%s semantics',kind=>{
 const source=document();if(source.decision.kind!=='card-selection')throw Error('Expected cards');
 const base={kind:'card-selection' as const,id:source.decision.id,commands:source.decision.commands,variants:source.decision.variants,submit:source.decision.submit};
 const changed:TableDocument<string>=kind==='default'?{...source,interaction:undefined}:kind==='cohort'?{...source,presentation:undefined}:kind==='observer'?{...source,participant:{...source.participant,role:'observer'},hand:[],decision:{id:'watch',kind:'commands',commands:[]},offer:{id:'watch',actions:[]}}:kind==='commands'?{...source,decision:{...source.decision,commands:['play'],variants:[source.decision.variants[1]]}}:kind==='many'?{...source,presentation:undefined,decision:{...base,mode:'many' as const}}:{...source,presentation:undefined,decision:{...base,mode:'count' as const,count:1}};
 const f=fixture(changed);expect(f.frame.essentialInputKind).toBeUndefined();expect(f.admissions).toEqual([false]);expect(f.send).not.toHaveBeenCalled();f.dispose();
});
it.each(['missing','extra','enabled','entity','inspection','mixed','outside'] as const)('native input admission rejects%s hand bindings',kind=>{
 const f=fixture(document(),layout=>{
  const nodes=layout.nodes.map(node=>node.id!=='card:ace'?node:kind==='enabled'?{...node,enabled:false}:kind==='entity'?{...node,entityId:'foreign'}:kind==='inspection'?{...node,cardId:undefined,inspectCardId:'ace'}:kind==='mixed'?{...node,actionId:'play'}:kind==='outside'?{...node,parent:'table-underlay'}:node);
  return {...layout,nodes:kind==='missing'?nodes.filter(node=>node.id!=='card:two'):kind==='extra'?[...nodes,{...nodes.find(node=>node.id==='card:two')!,id:'extra',box:{x:310,y:10,width:88,height:124}}]:nodes};
 });
 expect(f.admissions).toEqual([false]);expect(f.send).not.toHaveBeenCalled();f.dispose();
});
it.each(['disconnect','offer','generation','audience'] as const)('native admission cannot revive stale frames after%s',kind=>{
 const f=fixture(),old=f.frame;
 if(kind==='disconnect')f.session.setConnected(false);else {const source=document();f.session.receive({...source,context:{...source.context,revision:'2',...(kind==='generation'?{generation:'next'}:{}),...(kind==='audience'?{audience:'other'}:{})},offer:{...source.offer,id:'next-offer'}});}
 expect(f.callbacks.essential!(old.id,'native-flight',true)).toBe(false);f.callbacks.intent({kind:'activate',provenance:'direct',frameId:old.id,nodeId:'card:ace'});expect(f.send).not.toHaveBeenCalled();f.dispose();expect(f.callbacks.essential!(old.id,'native-flight',true)).toBe(false);
});

it('includes canonical unavailable-card inspection in the same exact native input lease',()=>{
 const base=document(),scope={context:base.context,roomId:'room',roomEpoch:'epoch',connectionEpoch:'connection',actorId:'me',seat:0,gameVersion:1};
 const source={...base,assistance:createAssistanceSnapshot({scope,offerId:'help',tools:[],inspections:[{cardId:'two',reason:'Follow suit'}],reactions:[]},{authority:{scope,connected:true,activeTurn:true,ownHandAuthorized:true},handIds:base.hand.map(card=>card.id),actions:[{id:'play',label:'Ace',cardIds:['ace']}],participantIds:['me'],reactionOptions:[]})};
 const f=fixture(source);expect(f.frame.nodes.find(node=>node.id==='card:two')).toMatchObject({inspectCardId:'two',enabled:true});expect(f.admissions).toEqual([true]);expect(essentialInputMask(f.frame)?.inputIds).toEqual(['card:ace','card:two']);f.callbacks.intent({kind:'activate',provenance:'direct',frameId:f.frame.id,nodeId:'card:two'});expect(f.send).not.toHaveBeenCalled();f.dispose();
});
it('modal publications cannot inherit the runtime native-card provenance',()=>{
 const f=fixture(document(),layout=>({...layout,modalId:'picker',nodes:[...layout.nodes.map(node=>node.id==='table'?{...node,arrangement:'overlay' as const}:node.id==='table-underlay'?{...node,inert:true}:node),{id:'picker',parent:'table',kind:'group',semanticRole:'dialog',label:'Picker',box:{x:0,y:0,width:500,height:200}}]}));
 expect(f.frame.essentialInputKind).toBeUndefined();expect(f.admissions).toEqual([false]);expect(f.send).not.toHaveBeenCalled();f.dispose();
});

it('canonical frame publication cannot inherit disabled-card checked state or play descriptions from a custom planner',()=>{
 const f=fixture(document(),layout=>({...layout,nodes:layout.nodes.map(node=>node.id==='card:two'?{...node,checked:true,accessibleDescription:'forged press to play'}:node)}));
 expect(f.frame.nodes.find(node=>node.id==='card:two')).toMatchObject({enabled:false,checked:false,accessibleDescription:undefined,hasPopup:undefined});expect(f.send).not.toHaveBeenCalled();f.dispose();
 const source=document(),passive:TableDocument<string>={...source,decision:{id:'wait',kind:'commands',commands:[]},offer:{id:'passive',actions:[]}};
 const g=fixture(passive,layout=>({...layout,nodes:layout.nodes.map(node=>node.zoneId==='hand'?{...node,cardId:undefined,checked:true,accessibleDescription:'stale own turn'}:node)}));
 for(const node of g.frame.nodes.filter(node=>node.zoneId==='hand'))expect(node).toMatchObject({checked:false,accessibleDescription:undefined,hasPopup:undefined});expect(g.send).not.toHaveBeenCalled();g.dispose();
});
