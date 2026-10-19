import {expect,test,vi} from 'vitest';
import {ownPhasePresentation,selectionPresentation} from './presentationCohort';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {ChoiceView,Environment,SurfacePort} from './contracts';
import type {PhasePresentation} from './presentationCohort';
import type {TableDocument} from './contracts';
const cohort=():PhasePresentation=>({id:'play',schemaVersion:1,selection:{kind:'card-selection',mode:'one',submit:{prefix:'Play'},statusLabels:['카드 선택 · 0장','카드 선택 · 1장'],submitLabels:['Play Ace','Play King']}});
const doc=():TableDocument<string>=>({context:{session:'s',audience:'p',generation:'g',revision:'1'},presentation:cohort(),participant:{id:'p',name:'P',markers:[]},hand:[{id:'ace',label:'Ace',visual:{kind:'standard',suit:'Spade',rank:14}}],facts:[],offer:{id:'o',actions:[{kind:'command',id:'play',label:'Ace',intent:'primary',enabled:true,action:'ace'}]},decision:{kind:'card-selection',id:'d',mode:'one',commands:[],variants:[{cardIds:['ace'],actionId:'play'}],submit:{prefix:'Play'}}});
test('owns immutable caption vocabulary and scopes content without offer/revision authority',()=>{
 const input=cohort(),owned=ownPhasePresentation(input);(input.selection!.submitLabels as string[])[0]='mutated';
 expect(owned.selection!.submitLabels[0]).toBe('Play Ace');expect(Object.isFrozen(owned.selection!.submitLabels)).toBe(true);expect(Object.isFrozen(owned.selection!.submit)).toBe(true);
 const context=doc().context,key=selectionPresentation(context,owned)!.scopeKey;
 expect(selectionPresentation({...context,revision:'2'},owned)!.scopeKey).toBe(key);
 for(const change of [{session:'other'},{audience:'other'},{generation:'other'}])expect(selectionPresentation({...context,...change},owned)!.scopeKey).not.toBe(key);
 expect(selectionPresentation(context,{...owned,id:'other'})!.scopeKey).not.toBe(key);
 expect(selectionPresentation(context,{...owned,schemaVersion:2})!.scopeKey).not.toBe(key);
 expect(selectionPresentation(context,{...owned,selection:{...owned.selection!,submitLabels:['Play Other']}})!.scopeKey).not.toBe(key);
});
test('rejects unknown, authority-bearing, accessor, sparse and oversized data',()=>{
 const base=cohort();let reads=0;
 for(const invalid of [
 {...base,actionId:'secret'}, {...base,selection:{...base.selection,enabled:true}},
 {...base,selection:{...base.selection,submit:{prefix:'Play',payload:{cardIds:['secret']}}}},
 {...base,selection:{...base.selection,selected:[]}}, {...base,selection:{...base.selection,submitLabels:new Array(2)}},
 {...base,selection:{...base.selection,submitLabels:Array.from({length:105},(_,i)=>String(i))}},
 {...base,selection:{...base.selection,submitLabels:['x'.repeat(257)]}},
 {...base,selection:{...base.selection,submitLabels:Array.from({length:104},(_,i)=>`${i}${'한'.repeat(240)}`)}},
 {...base,selection:{...base.selection,get submitLabels(){reads++;return [];}}},
 ])expect(()=>ownPhasePresentation(invalid)).toThrow('Invalid phase presentation');
 expect(reads).toBe(0);
});
test('session refuses uncovered active captions transactionally without modifying offers',()=>{
 const session=createCardSession<string>({transport:vi.fn()}),source=doc();session.receive(source);
 const before=session.snapshot().document!;
 expect(before.offer).toEqual(source.offer);expect(before.presentation).not.toBe(source.presentation);
 for(const selection of [{...cohort().selection!,submit:{prefix:'Other'}},{...cohort().selection!,statusLabels:['카드 선택 · 0장']},{...cohort().selection!,submitLabels:['Play King']}]){
 expect(()=>session.receive({...source,presentation:{...cohort(),selection}})).toThrow();expect(session.snapshot().document).toBe(before);
 }
 session.receive({...source,presentation:undefined});expect(session.snapshot().document!.presentation).toBeUndefined();session.dispose();
});
test('passive caption cohort retains no native offer or admission authority',()=>{
 const send=vi.fn(),session=createCardSession<string>({transport:send}),active=doc();session.receive(active);const old=session.snapshot().document!;
 session.receive({...active,context:{...active.context,revision:'2'},hand:[],offer:{id:'passive',actions:[]},decision:{id:'passive',kind:'commands',commands:[]}});
 expect(session.snapshot().document!.presentation).toEqual(old.presentation);expect(session.snapshot().document!.offer.actions).toEqual([]);
 expect(session.admit(old.context,old.offer.id,'play',old.offer.actions[0].kind==='command'?old.offer.actions[0].action:'')).toBe(false);expect(send).not.toHaveBeenCalled();session.dispose();
});

test('a fresh passive runtime projects only the separate public presentation vocabulary',()=>{
 const environment:Environment={width:500,height:500,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1}}};
 const source=doc(),session=createCardSession<string>({transport:vi.fn()}),observed:ChoiceView[]=[];
 session.receive({...source,hand:[],offer:{id:'passive',actions:[]},decision:{kind:'commands',id:'passive',commands:[]}});
 const table=createCardTable({session,planner:(_doc,_env,choices)=>{observed.push(choices);return {kind:'ready',layout:{width:500,height:500,recipe:'stacked',nodes:[{id:'root',parent:null,kind:'group',label:'Table',box:{x:0,y:0,width:500,height:500}}]}};}});
 const surface:SurfacePort={identity:{},environment:()=>environment,listen:()=>()=>{},measure:()=>()=>{},publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback:()=>{},clear:()=>{}};
 table.attach(surface);const view=observed.at(-1)!;
 expect(view.selectionPresentation?.submitLabels).toEqual(source.presentation!.selection!.submitLabels);
 expect(view.cards).toBeUndefined();expect(view.commands).toEqual([]);expect(view.selected).toBeNull();
 table.dispose();session.dispose();
});

test('owns bounded action-caption groups and rejects uncovered native groups without synthesizing labels',()=>{
 const groups=[['Ace','King']],input={...cohort(),selection:{...cohort().selection!,actionVariantLabelGroups:groups}};
 const owned=ownPhasePresentation(input);groups[0][0]='Changed';expect(owned.selection!.actionVariantLabelGroups).toEqual([['Ace','King']]);expect(Object.isFrozen(owned.selection!.actionVariantLabelGroups![0])).toBe(true);
 for(const actionVariantLabelGroups of [[],[new Array(2)],[Array.from({length:17},(_,i)=>String(i))],Array.from({length:105},()=>['Ace']),[[{actionId:'secret'}]]])expect(()=>ownPhasePresentation({...input,selection:{...input.selection,actionVariantLabelGroups}})).toThrow();
 const source=doc(),decision={kind:'card-selection' as const,id:'d',mode:'one' as const,disambiguation:'choose-action' as const,submit:{prefix:'Play'},commands:[],variants:[{cardIds:['ace'],actionId:'play'},{cardIds:['ace'],actionId:'king'}]},offer={id:'o',actions:[...source.offer.actions,{kind:'command' as const,id:'king',label:'King',intent:'primary' as const,enabled:true,action:'king'}]};
 const session=createCardSession<string>({transport:vi.fn()});const active={...source,decision,offer,presentation:owned};session.receive(active);
 const before=session.snapshot().document;
 expect(()=>session.receive({...active,presentation:{...owned,selection:{...owned.selection!,actionVariantLabelGroups:[['Ace'],['King']]}}})).toThrow();expect(session.snapshot().document).toBe(before);session.dispose();
});

test('aggregate action-label work is bounded independently from byte and per-group limits',()=>{
 const base=cohort(),groups=Array.from({length:104},(_,g)=>Array.from({length:16},(_,i)=>`v${g.toString().padStart(3,'0')}${i.toString().padStart(2,'0')}`));
 const input={...base,selection:{...base.selection!,actionVariantLabelGroups:groups}};
 expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThan(16384);
 expect(()=>ownPhasePresentation(input)).toThrow('Invalid phase presentation cohort');
});

test('owns a bounded set of current public collection references, including explicit none',()=>{
 const session=createCardSession<string>({transport:()=>{}}),source=doc(),ids=['z','a'];
 const collections=[{id:'a',label:'A',cards:[]},{id:'z',label:'Z',cards:[]}];session.receive({...source,collections,presentation:{...cohort(),tableCollectionIds:ids}});ids.push('foreign');
 expect(session.snapshot().document!.presentation!.tableCollectionIds).toEqual(['a','z']);expect(Object.isFrozen(session.snapshot().document!.presentation!.tableCollectionIds)).toBe(true);
 const context=source.context,a=ownPhasePresentation({...cohort(),tableCollectionIds:['z','a']}),b=ownPhasePresentation({...cohort(),tableCollectionIds:['a','z']});expect(selectionPresentation(context,a)?.scopeKey).toBe(selectionPresentation(context,b)?.scopeKey);
 session.receive({...source,collections,presentation:{...cohort(),tableCollectionIds:[]}});expect(session.snapshot().document!.presentation!.tableCollectionIds).toEqual([]);
 const before=session.snapshot().document;
 for(const tableCollectionIds of [['hand'],['ace'],['play'],['a','a'],Array.from({length:129},(_,i)=>`id${i}`)]){expect(()=>session.receive({...source,collections,presentation:{...cohort(),tableCollectionIds}})).toThrow();expect(session.snapshot().document).toBe(before);}
 const getter=vi.fn(()=> 'a'),input=Array(1);Object.defineProperty(input,'0',{get:getter,enumerable:true});expect(()=>ownPhasePresentation({...cohort(),tableCollectionIds:input})).toThrow();expect(getter).not.toHaveBeenCalled();session.dispose();
});
test('next-deal is an owned settled anonymous stock fact, never an active count reset',()=>{
 const session=createCardSession<string>({transport:()=>{}}),source:TableDocument<string>={context:doc().context,participant:doc().participant,hand:[],facts:[],decision:{id:'next',kind:'commands',commands:['next']},offer:{id:'next',actions:[{id:'next',kind:'command',label:'Next',intent:'primary',enabled:true,action:'next'}]},information:[{id:'result',title:'Result',fields:[]}],outcome:{id:'done',informationId:'result',continuationActionIds:['next']},collections:[{id:'stock',label:'Future',kind:'deck',purpose:'stock',availability:'next-deal',hiddenCount:53,cards:[]}]};
 session.receive(source);expect(session.snapshot().document!.collections![0].availability).toBe('next-deal');const before=session.snapshot().document;
 expect(()=>session.receive({...source,outcome:undefined})).toThrow(/availability/);
 expect(()=>session.receive({...source,collections:source.collections!.map(zone=>({...zone,purpose:'play'}))})).toThrow();
 const getter=vi.fn(()=> 'next-deal'),zone={...source.collections![0]};Object.defineProperty(zone,'availability',{get:getter,enumerable:true});expect(()=>session.receive({...source,collections:[zone]})).toThrow(/availability/);expect(getter).not.toHaveBeenCalled();expect(session.snapshot().document).toBe(before);session.dispose();
});

test('reserves the private hand zone independently of public selection or collection contents',()=>{
 const session=createCardSession<string>({transport:vi.fn()}),source=doc();session.receive(source);const admitted=session.snapshot().document;
 for(const cards of [[],source.hand])for(const presentation of [undefined,{...cohort(),tableCollectionIds:[]},{...cohort(),tableCollectionIds:['hand']}]){
  expect(()=>session.receive({...source,collections:[{id:'hand',label:'Public alias',cards}],presentation})).toThrow('Reserved private hand collection id');expect(session.snapshot().document).toBe(admitted);
 }
 expect(()=>session.receive({...source,presentation:{...cohort(),tableCollectionIds:['hand']}})).toThrow();expect(session.snapshot().document).toBe(admitted);
 session.receive({...source,collections:[{id:'public-hand',label:'Public zone',cards:[]}],presentation:{...cohort(),tableCollectionIds:['public-hand']}});expect(session.snapshot().document!.collections![0].id).toBe('public-hand');session.dispose();
});
