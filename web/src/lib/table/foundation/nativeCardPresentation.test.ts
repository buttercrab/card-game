import {expect,it} from 'vitest';
import {nativeCardPresentation,nativeCardSemantics} from './nativeCardPresentation';
import type {TableDocument} from './contracts';
function document(ambiguous=false):TableDocument<string>{return {
 context:{session:'s',audience:'me',generation:'play',revision:'1'},participant:{id:'me',name:'Me',markers:[]},hand:[{id:'ace',label:'Ace',visual:{kind:'standard',suit:'Spade',rank:14}}],facts:[],interaction:{cardActivation:'repeat'},
 presentation:{id:'play',schemaVersion:1,selection:{kind:'card-selection',mode:'one',submit:{prefix:'Play'},statusLabels:['카드 선택 · 0장','카드 선택 · 1장'],submitLabels:['Play Ace',...(ambiguous?['Play Ace alternative']:[])],...(ambiguous?{actionVariantLabelGroups:[['Ace','Ace alternative']]}:{})}},
 decision:{id:'play',kind:'card-selection',mode:'one',...(ambiguous?{disambiguation:'choose-action' as const}:{}),commands:[],variants:[{cardIds:['ace'],actionId:'play'},...(ambiguous?[{cardIds:['ace'],actionId:'alternative'}]:[])],submit:{prefix:'Play'}},
 offer:{id:'offer',actions:[{id:'play',kind:'command',label:'Ace',intent:'primary',enabled:true,action:'ace'},...(ambiguous?[{id:'alternative',kind:'command' as const,label:'Ace alternative',intent:'primary' as const,enabled:false,action:'alternative'}]:[])]}
};}
it('uses exactly the three original complete captions and owns its immutable selection-independent domain',()=>{
 const doc=document(),before=nativeCardPresentation(doc,true,[])!,selected=nativeCardPresentation(doc,true,['ace'])!,single=nativeCardPresentation({...doc,interaction:{cardActivation:'single'}},true,[])!;
 expect(before.captions).toEqual(['내 차례 · 낼 카드를 누르세요','내 차례 · 낼 카드를 두 번 누르세요','내 차례 · 한 번 더 누르면 내요']);
 expect(before.caption).toBe(before.captions[1]);expect(selected.caption).toBe(before.captions[2]);expect(single.caption).toBe(before.captions[0]);expect(selected.captions).toBe(before.captions);expect(Object.isFrozen(before)).toBe(true);expect(Object.isFrozen(before.captions)).toBe(true);
});
it.each(['single','repeat'] as const)('fresh passive%s projection keeps the public domain without private hand, actions or stale turn text',activation=>{
 const doc={...document(true),interaction:{cardActivation:activation}},active=nativeCardPresentation(doc,true,['ace'])!;
 const passive:TableDocument<string>={...doc,context:{...doc.context,revision:'passive'},hand:[],decision:{id:'wait',kind:'commands',commands:[]},offer:{id:'passive',actions:[]}};
 const view=nativeCardPresentation(passive,true,['stale-secret-selection'])!;expect(view.captions).toEqual(active.captions);expect(view.caption).toBeNull();expect(Object.keys(view).sort()).toEqual(['activation','caption','captions','kind']);expect(JSON.stringify(view)).not.toMatch(/ace|secret|offer|actionId|cardId/);
 expect(nativeCardPresentation(doc,false,['ace'])?.caption).toBeNull();
});
it('names ambiguous method selection truthfully even when only one offered variant is enabled',()=>{
 const view=nativeCardPresentation(document(true),true,['ace'])!;
 expect(view.captions).toHaveLength(4);expect(view.caption).toBe('내 차례 · 카드 내기 선택');expect(view.caption).not.toContain('한 번 더 누르면 내요');
 expect(nativeCardPresentation(document(true),false,[])?.captions).toEqual(view.captions);
});
it('native presentation retains real auxiliary commands and never claims their execution',()=>{
 const doc=document();if(doc.decision.kind!=='card-selection')throw Error('Expected cards');
 const view=nativeCardPresentation({...doc,decision:{...doc.decision,commands:['auxiliary']}},true,[])!;expect(view.kind).toBe('native-one');expect(Object.keys(view)).not.toContain('commands');expect(Object.keys(view)).not.toContain('selected');
});
it('keeps compatibility presentation without public cohort, host activation or one-card player semantics',()=>{
 const doc=document();if(doc.decision.kind!=='card-selection')throw Error('Expected cards');
 expect(nativeCardPresentation({...doc,presentation:undefined},true,[])).toBeUndefined();expect(nativeCardPresentation({...doc,interaction:undefined},true,[])).toBeUndefined();expect(nativeCardPresentation({...doc,participant:{...doc.participant,role:'observer'}},true,[])).toBeUndefined();
 const base={id:'selection',kind:'card-selection' as const,commands:[],variants:doc.decision.variants,submit:doc.decision.submit};
 expect(nativeCardPresentation({...doc,decision:{...base,mode:'many' as const}},true,[])).toBeUndefined();expect(nativeCardPresentation({...doc,decision:{...base,mode:'count' as const,count:1}},true,[])).toBeUndefined();
});

it('native accessibility is derived from exact own-card bindings and local selection, not supplied checked paint',()=>{
 const doc=document(true),presentation=nativeCardPresentation(doc,true,[])!,node={id:'card',parent:'hand',kind:'card' as const,label:'Ace',cardId:'ace',entityId:'ace',zoneId:'hand',enabled:true,checked:true,box:{x:0,y:0,width:88,height:124}};
 const initial=nativeCardSemantics(doc,node,presentation,[],undefined);expect(initial).toMatchObject({hasPopup:'dialog',popupExpanded:false,checked:false});expect(initial.accessibleDescription).toBe('한 번 누르면 선택하고, 한 번 더 누르면 카드 내기 선택을 열어요');
 const selected=nativeCardSemantics(doc,node,presentation,['ace'],undefined);expect(selected).toMatchObject({checked:true,popupExpanded:false});expect(selected.accessibleDescription).toBe('한 번 더 누르면 카드 내기 선택을 열어요');
 expect(nativeCardSemantics(doc,node,presentation,['ace'],'ace').popupExpanded).toBe(true);
 expect(nativeCardSemantics(doc,{...node,cardId:'foreign'},presentation,[],undefined).hasPopup).toBeUndefined();
 const inspect={...node,cardId:undefined,inspectCardId:'ace',accessibleDescription:'낼 수 없는 이유 보기'};expect({...inspect,...nativeCardSemantics(doc,inspect,presentation,[],undefined)}).toMatchObject({accessibleDescription:'낼 수 없는 이유 보기'});expect(nativeCardSemantics(doc,inspect,presentation,[],undefined).hasPopup).toBeUndefined();
});

it('canonicalizes disabled and no-enabled-match cards before deriving activation metadata',()=>{
 const doc=document(),presentation=nativeCardPresentation(doc,true,[])!,node={id:'card',parent:'hand',kind:'card' as const,label:'Ace',cardId:'ace',entityId:'ace',zoneId:'hand',enabled:false,checked:true,hasPopup:'dialog' as const,popupExpanded:true,accessibleDescription:'forged: press to play',box:{x:0,y:0,width:88,height:124}};
 const disabled={...node,...nativeCardSemantics(doc,node,presentation,[],undefined)};expect(disabled).toMatchObject({checked:false,hasPopup:undefined,popupExpanded:undefined,accessibleDescription:undefined});
 const blocked={...doc,offer:{...doc.offer,actions:doc.offer.actions.map(action=>({...action,enabled:false}))}},enabledPaint={...node,enabled:true};
 expect({...enabledPaint,...nativeCardSemantics(blocked,enabledPaint,presentation,[],undefined)}).toMatchObject({checked:false,hasPopup:undefined,popupExpanded:undefined,accessibleDescription:undefined});
 expect(nativeCardSemantics(doc,node,presentation,['ace'],undefined).checked).toBe(true);
});
it('clears stale checked and play descriptions on passive private cards and invalid bindings',()=>{
 const doc=document(),passive:TableDocument<string>={...doc,decision:{id:'wait',kind:'commands',commands:[]},offer:{id:'passive',actions:[]}},node={id:'card',parent:'hand',kind:'card' as const,label:'Ace',entityId:'ace',zoneId:'hand',enabled:false,checked:true,accessibleDescription:'stale play claim',box:{x:0,y:0,width:88,height:124}};
 const presentation=nativeCardPresentation(passive,false,[])!;
 for(const current of [node,{...node,cardId:'ace'},{...node,cardId:'foreign'},{...node,cardId:'ace',ownerId:'foreign'},{...node,cardId:'ace',actionId:'foreign'},{...node,cardId:'ace',localIntent:'toggle-information' as const}])expect({...current,...nativeCardSemantics(passive,current,presentation,['ace'],undefined)}).toMatchObject({checked:false,accessibleDescription:undefined});
 const inspect={...node,inspectCardId:'ace'};expect({...inspect,...nativeCardSemantics(doc,inspect,presentation,['ace'],undefined)}).toMatchObject({checked:false,accessibleDescription:'낼 수 없는 이유 보기'});
});

it('group-keyed first-passive native captions retain only applicable public one-card vocabulary',()=>{const doc=document(true);if(doc.decision.kind!=='card-selection'||!doc.presentation?.selection)throw Error();const {commands,...group}=doc.decision,presentation={id:'group-play',schemaVersion:1,groups:[{...doc.presentation.selection,id:group.id,participantIds:['me']}]},active={...doc,presentation,decision:{kind:'composition' as const,id:'play',commands,groups:[group]}},passive={...active,decision:{kind:'composition' as const,id:'passive',commands:[],groups:[]},offer:{id:'passive',actions:[]}};const before=nativeCardPresentation(active,true,[])!,after=nativeCardPresentation(passive,true,['stale'])!;expect(after.captions).toEqual(before.captions);expect(after.caption).toBeNull();expect(nativeCardPresentation({...passive,participant:{...passive.participant,id:'other'}},true,[])).toBeUndefined();expect(nativeCardPresentation({...passive,participant:{...passive.participant,role:'observer'}},true,[])).toBeUndefined();});
