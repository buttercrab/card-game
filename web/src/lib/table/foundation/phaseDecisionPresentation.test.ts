import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {decisionPresentation,finiteChoiceSubmitCaption,ownPhasePresentation,phaseChoiceAtomCaption,phaseChoiceAtomLabel,phaseChoiceOptionAtom,validateDecisionPresentation,PHASE_DECISION_LIMITS} from './presentationCohort';
import {validateTableDecision} from './decisions';
import {mightyBiddingPresentation} from '../../games/mighty/phasePresentation';
import {biddingDecision} from '../../games/mighty/bidding';
import {presetRules} from '../../games/mighty/catalog';
import type {Action,Rules} from '../../games/mighty/types';
import type {ActionOffer} from '../presentation';
import type {ChoiceView,Environment,SurfaceCallbacks,TableDocument} from './contracts';
const rules=()=>presetRules('default');
function offer():ActionOffer<Action>{return {id:'native-offer',actions:[
 {id:'native:spade14',kind:'command',label:'♠ 14',intent:'primary',enabled:true,action:{Bid:{trump:'Spade',count:14}}},
 {id:'native:heart16',kind:'command',label:'♥ 16',intent:'primary',enabled:true,action:{Bid:{trump:'Heart',count:16}}},
 {id:'native:heart19',kind:'command',label:'♥ 19',intent:'primary',enabled:true,action:{Bid:{trump:'Heart',count:19}}},
 {id:'native:pass',kind:'command',label:'패스',intent:'secondary',enabled:true,action:'Pass'}]};}
function document(active=true,publicRules=rules(),nativeOffer=offer()):TableDocument<Action>{return {context:{session:'phase',audience:'local',generation:'hand',revision:'1'},participant:{id:'local',name:'나',markers:[]},opponents:[{id:'peer',name:'상대',handCount:10}],hand:[{id:'PRIVATE_A',label:'PRIVATE_A',visual:{kind:'standard',suit:'Club',rank:2}}],facts:[],presentation:mightyBiddingPresentation(publicRules),offer:active?nativeOffer:{id:'passive',actions:[]},decision:active?biddingDecision(nativeOffer,publicRules):{kind:'commands',id:'passive',commands:[]}};}
const control={fontSize:15,lineHeight:18,fontWeight:600,paddingX:12,paddingY:10,minHeight:44,pulse:1};
const environment:Environment={width:600,height:700,textScale:1,fontFamily:'sans',fontRevision:'phase',revision:'phase',controls:{command:control,choice:control}};
function mount(source:TableDocument<Action>,paintInputs=false){
 const send=vi.fn(),session=createCardSession<Action>({transport:send});session.receive(source);let current!:ChoiceView,callbacks!:SurfaceCallbacks;
 const table=createCardTable({session,planner:(_document,_environment,choices)=>{current=choices;return {kind:'ready',layout:{width:600,height:700,recipe:'stacked',nodes:[{id:'table',kind:'group',parent:null,label:'',box:{x:0,y:0,width:600,height:700}},...(paintInputs?choices.fields.flatMap((field,i)=>field.options.map((option,j)=>({id:JSON.stringify([field.id,option.id]),parent:'table',kind:'choice' as const,label:option.label,fieldId:field.id,optionId:option.id,enabled:option.enabled,checked:choices.values?.[field.id]===option.id,box:{x:j*90,y:60+i*60,width:80,height:44}}))):[]),...(paintInputs&&choices.selected?[{id:'submit',parent:'table',kind:'command' as const,label:choices.selected.label,actionId:choices.selected.id,enabled:choices.selected.enabled,box:{x:0,y:240,width:180,height:44}}]:[])]}};}});
 table.attach({identity:{},environment:()=>environment,listen(value){callbacks=value;return()=>{};},measure:()=>()=>{},publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback:reason=>{throw Error(reason);},clear:()=>{}});
 return {session,table,send,get view(){return current;},activate(id:string){callbacks.intent({kind:'activate',provenance:'direct',frameId:table.inspect().frame!.id,nodeId:id});},dispose(){table.dispose();session.dispose();}};
}
test('owns typed public domains immutably and scopes semantic content without current offer or hand authority',()=>{
 const input=mightyBiddingPresentation(rules()),owned=ownPhasePresentation(input),spade=owned.decision!.fields[0].options[0].atom;
 expect(spade).toEqual({kind:'suit',suit:'Spade',label:'스페이드'});expect(phaseChoiceAtomLabel(spade)).toBe('스페이드');expect(phaseChoiceAtomCaption(spade)).toBe('♠');expect(Object.isFrozen(spade)).toBe(true);expect(Object.isFrozen(owned.decision!.fields[0].options)).toBe(true);
 Object.defineProperty(input.decision.fields[0].options[0].atom,'label',{value:'Changed'});expect(phaseChoiceAtomLabel(spade)).toBe('스페이드');
 const context=document().context,first=decisionPresentation(context,owned)!;expect(Object.isFrozen(first)).toBe(true);expect(decisionPresentation({...context,revision:'new'},owned)?.scopeKey).toBe(first.scopeKey);expect(decisionPresentation({...context,audience:'other'},owned)?.scopeKey).not.toBe(first.scopeKey);expect(decisionPresentation({...context,generation:'other'},owned)?.scopeKey).not.toBe(first.scopeKey);
 const changed=ownPhasePresentation({...owned,decision:{...owned.decision!,submit:{...owned.decision!.submit,prefix:'다른 공약'}}});expect(decisionPresentation(context,changed)?.scopeKey).not.toBe(first.scopeKey);expect(JSON.stringify(owned)).not.toMatch(/native:|PRIVATE_|actionId|cardId|enabled|selected|payload|coordinates/);
});
test('rejects nested authority, unsupported atoms, accessors, sparse arrays and bounded resource amplification',()=>{
 const base=mightyBiddingPresentation(rules()),domain=base.decision,field=domain.fields[0],option=field.options[0];
 const atoms:unknown[]=[{kind:'suit',suit:'Spade',label:'스페이드',enabled:false},{kind:'text',text:'X',actionId:'native:spade14'},{kind:'number',value:NaN},{kind:'participant',participantId:'peer'},{kind:'card',visual:{kind:'standard',suit:'Spade',rank:14},label:'Card'},{kind:'inline',values:[{kind:'text',text:'X'}]},Object.create({kind:'text',text:'X'})];
 for(const atom of atoms)expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:[{...field,options:[{...option,atom}]},domain.fields[1]]}})).toThrow();
 expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:[{...field,options:[option,option]},domain.fields[1]]}})).toThrow();
 for(const extra of [{actionId:'native'},{payload:{secret:'x'}},{selected:true},{enabled:false},{x:10}])expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:[{...field,options:[{...option,...extra}]},domain.fields[1]]}})).toThrow();
 for(const patch of [{actionIds:['native']},{enabled:true},{selected:'14'},{bounds:{height:44}},{submit:{...domain.submit,fieldIds:['foreign','count']}},{submit:{...domain.submit,fieldIds:['trump','trump']}}])expect(()=>ownPhasePresentation({...base,decision:{...domain,...patch}})).toThrow();
 const getter=vi.fn(()=>({kind:'text',text:'X'})),poison={key:'Spade'};Object.defineProperty(poison,'atom',{get:getter,enumerable:true});expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:[{...field,options:[poison]},domain.fields[1]]}})).toThrow();expect(getter).not.toHaveBeenCalled();
 expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:[{...field,options:new Array(1)},domain.fields[1]]}})).toThrow();expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:[{...field,options:Array.from({length:257},(_,i)=>({key:String(i),atom:{kind:'number',value:i}}))},domain.fields[1]]}})).toThrow();
 expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:Array.from({length:9},(_,i)=>({...field,id:String(i)}))}})).toThrow();expect(()=>ownPhasePresentation({...base,decision:{...domain,auxiliaryLabels:Array(17).fill('X')}})).toThrow();expect(()=>ownPhasePresentation({...base,decision:{...domain,fields:[{...field,options:Array.from({length:200},(_,i)=>({key:String(i),atom:{kind:'text',text:'한'.repeat(256)}}))},domain.fields[1]]}})).toThrow();
 expect(()=>ownPhasePresentation({...base,selection:{kind:'card-selection',mode:'one',submit:{prefix:'Play'},submitLabels:['Play'],statusLabels:['선택']}})).toThrow();
});
test('validates ordered actual key subsets, multiplicity and every disabled native caption before replacement',()=>{
 const source=document(),session=createCardSession<Action>({transport:vi.fn()});session.receive(source);const before=session.snapshot().document;
 if(source.decision.kind!=='finite-choice')throw Error('Finite fixture');const spec=source.decision;const {presentation:_recipe,...untagged}=spec;
 const invalid:TableDocument<Action>[]=[
  {...source,decision:{...spec,fields:spec.fields.map((field,i)=>i?field:{...field,options:[...field.options].reverse()})}},
  {...source,decision:{...spec,fields:spec.fields.map((field,i)=>i?field:{...field,options:[...field.options,...Array.from({length:200},(_,n)=>({id:`foreign-${n}`,label:'스페이드',enabled:true}))]})}},
  {...source,decision:{...spec,fields:spec.fields.map((field,i)=>i?field:{...field,options:field.options.map((option,j)=>j?option:{...option,label:'♠'})})}},
  {...source,offer:{...source.offer,actions:source.offer.actions.map(action=>action.id==='native:heart19'?{...action,enabled:false,label:'Wrong caption'}:action)}},
  {...source,offer:{...source.offer,actions:source.offer.actions.map(action=>action.id==='native:pass'?{...action,enabled:false,label:'Uncovered'}:action)}},
  {...source,decision:untagged},
  {...source,decision:{...spec,commands:[...spec.commands,'native:pass2']},offer:{...source.offer,actions:[...source.offer.actions,{id:'native:pass2',kind:'command',label:'패스',intent:'secondary',enabled:true,action:'Pass'}]}},
 ];
 for(const value of invalid){expect(validateTableDecision(value)).toEqual([]);expect(()=>session.receive(value)).toThrow('Invalid phase presentation cohort');expect(session.snapshot().document).toBe(before);}
 const disabled={...source,offer:{...source.offer,actions:source.offer.actions.map(action=>({...action,enabled:false}))}};session.receive(disabled);expect(session.snapshot().document!.offer.actions.every(action=>!action.enabled)).toBe(true);
 const foreignTuple={...source,offer:{...source.offer,actions:[...source.offer.actions,{id:'native:future',kind:'command' as const,label:'노기루다 20',intent:'primary' as const,enabled:true,action:{Bid:{trump:null,count:20}}}]},decision:{...spec,variants:[...spec.variants,{tuple:{trump:'no-trump',count:'20'},actionId:'native:future'}]}};expect(()=>validateDecisionPresentation(source.presentation,foreignTuple)).toThrow();
 expect(finiteChoiceSubmitCaption(source.presentation!.decision!,spec.fields,{trump:'Heart',count:'19'})).toBe('공약 ♥ 19');expect(phaseChoiceOptionAtom(source.presentation!.decision!,'trump','Heart')).toEqual({kind:'suit',suit:'Heart',label:'하트'});expect(phaseChoiceOptionAtom(source.presentation!.decision!,'trump','native:heart19')).toBeUndefined();session.dispose();
});
test('fresh passive snapshot projects only inert reservation and shares it across private/offer changes',()=>{
 const passive=document(false),host=mount(passive),scope=host.view.decisionPresentation!.scopeKey;expect(host.view.fields).toEqual([]);expect(host.view.commands).toEqual([]);expect(host.view.selected).toBeNull();expect(host.view.selectedLabels).toBeUndefined();expect(host.view.finitePresentation).toBeUndefined();expect(host.table.inspect().frame!.nodes.some(node=>node.fieldId||node.actionId||node.cardId)).toBe(false);expect(host.session.admit(passive.context,passive.offer.id,'Heart','Pass')).toBe(false);host.activate(JSON.stringify(['trump','Heart']));expect(host.send).not.toHaveBeenCalled();expect(host.session.snapshot().operations).toEqual([]);
 host.session.receive({...document(),context:{...passive.context,revision:'2'},hand:[{id:'PRIVATE_B',label:'PRIVATE_B',visual:{kind:'standard',suit:'Diamond',rank:13}}]});expect(host.view.decisionPresentation?.scopeKey).toBe(scope);expect(host.view.fields[0].options.map(option=>option.label)).toEqual(['스페이드','하트']);expect(host.view.fields[1].options.map(option=>option.label)).toEqual(['14']);expect(host.view.selectedLabels).toBeUndefined();expect(host.view.finitePresentation).toEqual({kind:'choice-strips'});
 const observer={...passive,context:{...passive.context,audience:'watch',revision:'3'},participant:{...passive.participant,role:'observer' as const},hand:[]};host.session.receive(observer);expect(host.view.decisionPresentation).toBeUndefined();expect(observer.presentation).toEqual(passive.presentation);host.dispose();
});
test('real dependent count choices and native payload dispatch remain separate from full public reservation',async()=>{
 const source=document(),host=mount(source,true),scope=host.view.decisionPresentation!.scopeKey;expect(host.view.fields[1].options.map(option=>option.id)).toEqual(['14']);host.activate(JSON.stringify(['trump','Heart']));expect(host.view.fields[1].options.map(option=>option.id)).toEqual(['16','19']);expect(host.view.values).toEqual({trump:'Heart',count:'16'});expect(host.view.decisionPresentation?.scopeKey).toBe(scope);
 host.activate(JSON.stringify(['count','19']));expect(host.view.selected?.id).toBe('native:heart19');expect(host.view.selected?.label).toBe('공약 ♥ 19');host.activate('submit');await Promise.resolve();expect(host.send).toHaveBeenCalledTimes(1);expect(host.send.mock.calls[0][0].action).toEqual({Bid:{trump:'Heart',count:19}});expect(host.session.snapshot().operations).toHaveLength(1);host.dispose();
});
test('maximum255 public domain stays compact and validates only actual1275 rows, without Cartesian caption projection',()=>{
 const publicRules=rules();publicRules.bidding.min=1;publicRules.bidding.max=255;publicRules.bidding.allow_no_trump=true;
 const native:ActionOffer<Action>={id:'max',actions:(['Spade','Diamond','Heart','Club',null] as const).flatMap(trump=>Array.from({length:255},(_,index)=>({id:`native:${trump}:${index+1}`,kind:'command' as const,label:`${trump===null?'노기루다':({Spade:'♠',Diamond:'♦',Heart:'♥',Club:'♣'} as const)[trump]} ${index+1}`,intent:'primary' as const,enabled:true,action:{Bid:{trump,count:index+1}}})))};
 const source=document(true,publicRules,native);expect(new TextEncoder().encode(JSON.stringify(source.presentation)).byteLength).toBeLessThan(16384);const host=mount(source);expect(host.session.snapshot().document!.offer.actions).toHaveLength(1275);expect(host.view.decisionPresentation!.fields.reduce((sum,field)=>sum+field.options.length,0)).toBe(260);expect(host.view.fields[1].options).toHaveLength(255);expect(host.view.selectedLabels).toBeUndefined();expect(JSON.stringify(host.view.decisionPresentation)).not.toMatch(/native:|variants|selectedLabels/);expect(host.table.inspect().cacheSize).toBe(0);host.dispose();
});
test('cohort variant-work bound rejects before reading an oversized matrix',()=>{
 const source=document();if(source.decision.kind!=='finite-choice')throw Error('Finite fixture');const read=vi.fn(()=>({trump:'Spade',count:'14'})),row={actionId:'native:spade14',tuple:{trump:'Spade',count:'14'}};Object.defineProperty(row,'tuple',{get:read,enumerable:true});
 const variants=Array.from({length:Math.floor(PHASE_DECISION_LIMITS.variantFieldWork/2)+1},()=>row);
 // Isolate the bounded validator from the ordinary action/tuple validators.
 const raw={...source,decision:{...source.decision,variants}};expect(()=>validateDecisionPresentation(source.presentation,raw)).toThrow();expect(read).not.toHaveBeenCalled();
});
