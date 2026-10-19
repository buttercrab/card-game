import {describe,expect,it} from 'vitest';
import {CATALOG} from '../../catalog';
import {presetRules} from '../../games/mighty/catalog';
import {SUITS} from '../../games/mighty/cards';
import {createMightyRuleForm,MIGHTY_RULE_FORM_POLICY} from '../../games/mighty/ruleForms';
import type {Card,RoomView,Rules} from '../../games/mighty/types';
import type {CommandScope} from '../../generated/protocol';
import type {ChoiceView,Environment,Size,MeasureRequest} from './contracts';
import type {FormView} from './forms';
import {planTable,presentedFormFields,formSummaryItems,typography,validateLayout} from './planner';
import {shellDocument} from './shellFixture';
const environment:Environment={width:320,height:568,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:2,scrollbarWidth:15,scrollbarHeight:15,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const scope:CommandScope={domain:'room',room_id:'rules',room_epoch:'a'.repeat(32),actor_id:'me',seat:0,session_id:1,hand:0,version:7};
function maximalRules():Rules{
 const rules=presetRules('default'),cards:Card[]=[...SUITS.flatMap(suit=>Array.from({length:13},(_,index):Card=>({Normal:[suit,index+2]}))),{Joker:'Black'},{Joker:'Red'}];
 rules.deck='TwoJokers';rules.joker_call.calls.push([{Normal:['Heart',3]},{Normal:['Diamond',3]}]);rules.misdeal.card_values=cards.map(card=>[card,0]);rules.misdeal.threshold=-128;rules.misdeal.all_points=false;rules.bidding.allow_no_trump=true;rules.bidding.last_chance_min=13;rules.bidding.change_to_no_trump_cost=1;rules.scoring.win={BothOver:255};rules.scoring.lose={PaysBack:10};rules.scoring.back_run={ShortBy:255};return rules;
}
function worstForm():FormView{
 const rules=maximalRules(),room:RoomView={id:'rules',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default',rules,preset_rules:structuredClone(rules)},rules,customized:true,seats:Array.from({length:rules.players},(_,i)=>({kind:'human',name:`P${i}`,connected:true,away:false})),participant_ids:Array.from({length:rules.players},(_,i)=>i?'p'+i:'me'),in_hand:false,showing:false,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(rules.players).fill(true),participation:[],scores:[],hands_played:0,history:[],hands:[]};
 const raw=JSON.stringify(Array.from({length:5},(_,i)=>({id:`custom-${i}`,name:'가'.repeat(24),base:'default',rules}))),result=createMightyRuleForm({room,scope,viewerId:'me',seat:0,customStorageRaw:raw});if(!result.offer)throw Error(result.diagnostic);
 const offer=result.offer,values=Object.fromEntries(offer.fields.map(field=>[field.id,field.initial]));
 const reduction=MIGHTY_RULE_FORM_POLICY.reduce(offer,values,{fieldId:'custom-name',value:'가'.repeat(24)});
 return {offer,leaseId:'rule-lease',values:reduction.values,issues:reduction.issues,status:'editing',draftRevision:1,compositionEpoch:0,canSubmit:true,activeSection:'deal',reduction,fieldLeases:Object.fromEntries(offer.fields.map(field=>[field.id,`sublease:${field.id}`])),actions:offer.actions!.map(action=>({id:action.id,label:action.label,intent:action.intent??'secondary',enabled:true}))};
}
function metric(request:MeasureRequest):Size{const natural=[...request.text].length*9*request.environment.textScale,width=request.width??natural;return {width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(request.role,request.environment).lineHeight};}
function solve(form:FormView,env=environment){
 const metrics=new Map<string,Size>();let maxNeeds=0;
 const choices:ChoiceView={values:{},fields:[],commands:[],selected:null,form};
 for(let pass=0;pass<12;pass++){const result=planTable(shellDocument(),env,choices,metrics);if(result.kind==='ready')return {layout:result.layout,workingSet:metrics.size,maxNeeds};if(result.kind!=='needs')throw Error(JSON.stringify(result));maxNeeds=Math.max(maxNeeds,result.requests.length);for(const request of result.requests)metrics.set(request.key,metric(request));}
 throw Error('Rule form did not converge');
}
describe('actual largest Mighty rule form layout',()=>{
 it.each([[320,568,2],[390,844,2],[1440,900,1]])('keeps 54 card rows in one active section within the2048metric working set at %sx%s ×%s',(width,height,textScale)=>{
  const form=worstForm(),result=solve(form,{...environment,width,height,textScale});
  expect(form.offer.fields).toHaveLength(166);expect(form.offer.rows).toHaveLength(54);expect(validateLayout(result.layout)).toEqual([]);
  expect(result.workingSet).toBeLessThanOrEqual(2048);expect(result.maxNeeds).toBeLessThanOrEqual(512);
  const native=result.layout.nodes.filter(node=>node.editor||node.formField?.operation==='toggle'||node.formField?.operation==='choose'),ids=new Set(native.map(node=>node.editor?.fieldId??node.formField!.fieldId));
  expect(ids).toEqual(new Set(presentedFormFields(form).map(field=>field.id)));expect(result.layout.nodes.filter(node=>node.kind==='group'&&node.id.startsWith('["form-row",'))).toHaveLength(54);
  expect(result.layout.nodes.filter(node=>node.id.includes('form-section')&&node.formNavigation)).toHaveLength(7);
  expect(result.layout.nodes.some(node=>node.editor?.fieldId==='custom-name')).toBe(false);
  for(const cluster of form.offer.clusters!.filter(cluster=>cluster.sectionId==='deal'&&cluster.help))expect(result.layout.nodes.filter(node=>node.label===cluster.help)).toHaveLength(1);
 });
 it('renders declared leading card artwork without application geometry',()=>{
  const form=worstForm(),first=form.offer.rows![0],layout=solve({...form,offer:{...form.offer,rows:form.offer.rows!.map(row=>row===first?{...row,leading:{kind:'card' as const,label:'스페이드 2',visual:{kind:'standard' as const,suit:'Spade' as const,rank:2}}}:row)}}).layout;
  expect(layout.nodes.find(node=>node.id.includes('form-row-leading')&&node.kind==='card')?.visual).toEqual({kind:'standard',suit:'Spade',rank:2});
 });
 it('mounts only the selected section and changes native IDs only with field subleases',()=>{
  const form=worstForm(),first=solve(form).layout,next=solve({...form,values:{...form.values,c0v:'1'},draftRevision:2}).layout;
  expect(next.nodes.find(node=>node.editor?.fieldId==='c0v')?.id).toBe(first.nodes.find(node=>node.editor?.fieldId==='c0v')?.id);
  const retired=solve({...form,fieldLeases:{...form.fieldLeases,c0v:'new-token'}}).layout;
  expect(retired.nodes.find(node=>node.editor?.fieldId==='c0v')?.id).not.toBe(first.nodes.find(node=>node.editor?.fieldId==='c0v')?.id);
  const other=solve({...form,activeSection:'local'}).layout;expect(other.nodes.filter(node=>node.editor).map(node=>node.editor?.fieldId)).toEqual(['custom-name']);expect(other.nodes.some(node=>node.formField?.fieldId==='c0v')).toBe(false);
 });
 it('preserves full typed numeric ranges and disables adjustment of invalid intermediates',()=>{
  const form=worstForm(),current=solve({...form,values:{...form.values,c0v:'-128'}}).layout;
  expect(current.nodes.find(node=>node.formField?.fieldId==='c0v'&&node.formField.operation==='decrement')?.enabled).toBe(false);expect(current.nodes.find(node=>node.formField?.fieldId==='c0v'&&node.formField.operation==='increment')?.enabled).toBe(true);
  const invalid=solve({...form,values:{...form.values,c0v:'-'}}).layout;expect(invalid.nodes.filter(node=>node.formField?.fieldId==='c0v'&&['increment','decrement'].includes(node.formField.operation??'')).every(node=>!node.enabled)).toBe(true);
  const byte=form.offer.fields.find(field=>field.kind==='number'&&field.max===255&&!field.id.startsWith('c'))!;
  const section=byte.sectionId??form.offer.clusters!.find(cluster=>cluster.fieldIds.includes(byte.id))!.sectionId;
  const high=solve({...form,activeSection:section,values:{...form.values,[byte.id]:'200'}}).layout;
  expect(high.nodes.find(node=>node.editor?.fieldId===byte.id)?.editor?.value).toBe('200');
  expect(high.nodes.find(node=>node.formField?.fieldId===byte.id&&node.formField.operation==='increment')?.enabled).toBe(true);
 });
 it('paginates bounded changed/error navigation instead of measuring hidden summaries',()=>{
  const base=worstForm(),issues=Object.fromEntries(base.offer.fields.map(field=>[field.id,`확인이 필요해요 · ${field.id}`])),form={...base,issues,reduction:{...base.reduction!,issues,changedFields:base.offer.fields.map(field=>field.id)}};
  const first=solve(form),last=solve({...form,summaryPage:Math.ceil(formSummaryItems(form).length/8)-1});
  expect(first.layout.nodes.filter(node=>node.formNavigation?.fieldId)).toHaveLength(8);expect(last.layout.nodes.filter(node=>node.formNavigation?.fieldId).length).toBeLessThanOrEqual(8);expect(last.workingSet).toBeLessThanOrEqual(2048);
  expect(first.layout.nodes.find(node=>node.formNavigation?.summaryPage===1)?.enabled).toBe(true);
 });
 it('locks native editing after Apply admission while local Save remains a separate result',()=>{
  const form=worstForm();
  for(const status of ['queued','sending','accepted','uncertain'] as const){const layout=solve({...form,actions:[{id:'apply',label:'테이블에 적용',intent:'primary',enabled:false,status},{id:'save',label:'이 기기에 저장',intent:'secondary',enabled:true,status:'stored'}]}).layout;expect(layout.nodes.filter(node=>node.editor).every(node=>!node.enabled)).toBe(true);expect(layout.nodes.find(node=>node.formIntent==='reset')?.enabled).toBe(false);expect(layout.nodes.find(node=>node.formIntent==='close')?.enabled).toBe(true);}
  const saved=solve({...form,actions:[{id:'apply',label:'테이블에 적용',intent:'primary',enabled:true},{id:'save',label:'이 기기에 저장',intent:'secondary',enabled:false,status:'stored'}]}).layout;expect(saved.nodes.filter(node=>node.editor).every(node=>node.enabled)).toBe(true);
 });
 it('keeps independent action statuses and destinations in the planned footer',()=>{
  const form=worstForm(),layout=solve({...form,actions:[{id:'apply',label:'테이블에 적용',intent:'primary',enabled:false,status:'accepted',message:'새 테이블 상태를 기다려요.'},{id:'save',label:'이 기기에 저장',intent:'secondary',enabled:true,status:'stored'}]}).layout;
  expect(layout.nodes.find(node=>node.formActionId==='apply')?.enabled).toBe(false);expect(layout.nodes.find(node=>node.formActionId==='save')?.enabled).toBe(true);expect(layout.nodes.some(node=>node.label==='테이블에 적용 · 새 테이블 상태를 기다려요.')).toBe(true);expect(layout.nodes.some(node=>node.label==='이 기기에 저장 · 이 기기에 저장했어요.')).toBe(true);
 });
});
