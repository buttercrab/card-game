import type {ActionOffer,CommandSpec} from './presentation';
import {validateDecision,initializeChoices,reconcileChoices,availableOptions,selectedChoiceAction,immutableSpec,type DecisionSpec,type FiniteDecisionSpec,type ChoiceValues} from './decisionModel';
import {validateCardSelection,toggleCards,availableCardIds,eligibleCardIds,selectedCardAction,selectedCardActions,selectedCardCommands,cardSelectionAuthority,type CardSelectionDecision} from './cardSelection';

type DecisionGroupSpec=FiniteDecisionSpec|CardSelectionDecision;
type WithoutCommands<T>=T extends unknown?Omit<T,'commands'>:never;
export type DecisionGroup=WithoutCommands<DecisionGroupSpec>;
export interface DecisionComposition {readonly kind:'composition';readonly id:string;readonly commands:readonly string[];readonly groups:readonly DecisionGroup[];}
export type ComposableDecision=DecisionSpec|CardSelectionDecision|DecisionComposition;
export interface DecisionInput<A>{readonly decision:ComposableDecision;readonly offer:ActionOffer<A>;readonly handIds:readonly string[];}
export interface NormalizedDecision {readonly id:string;readonly origin:'legacy-listed'|'composition-exhaustive';readonly commands:readonly string[];readonly groups:readonly DecisionGroupSpec[];readonly bindings:Readonly<Record<string,string|null>>;}
export const ROOT_DECISION_GROUP=null;
const unique=(ids:readonly string[])=>ids.every(id=>typeof id==='string'&&id.trim().length>0)&&new Set(ids).size===ids.length;
export function decisionGroups(decision:ComposableDecision):readonly DecisionGroupSpec[]{return decision.kind==='composition'?decision.groups.map(group=>({...group,commands:[]})):decision.kind==='commands'?[]:[decision];}
export function finiteDecision(decision:ComposableDecision):FiniteDecisionSpec|undefined{return decisionGroups(decision).find((g):g is FiniteDecisionSpec=>g.kind==='finite-choice');}
export function cardDecision(decision:ComposableDecision):CardSelectionDecision|undefined{return decisionGroups(decision).find((g):g is CardSelectionDecision=>g.kind==='card-selection');}
/** Call-local semantic validation/indexing. Nothing here retains caller state or
 * obtains authority from labels, unlisted offers, nodes or normalized defaults. */
export function normalizeDecision<A>(input:DecisionInput<A>):{readonly value:NormalizedDecision|null;readonly errors:readonly string[]}{
 const errors:string[]=[];let value:NormalizedDecision|null=null;
 try{
  const {decision,offer,handIds}=input,composition=decision.kind==='composition';
  if(composition){const shape=(value:object,allowed:readonly string[])=>{const prototype=Object.getPrototypeOf(value),fields=Object.getOwnPropertyDescriptors(value);return [Object.prototype,null].includes(prototype)&&Reflect.ownKeys(fields).every(key=>typeof key==='string'&&allowed.includes(key)&&'value'in fields[key]&&fields[key].enumerable);};if(!shape(decision,['kind','id','commands','groups'])||!Array.isArray(decision.groups)||decision.groups.some(group=>!shape(group,group.kind==='finite-choice'?['kind','id','fields','variants','initialValues','reconciliation','submit','presentation','policy','contexts']:['kind','id','variants','submit','mode','count','disambiguation'])))errors.push('invalid composition shape');}
  const groups=decisionGroups(decision);
  // The modern discriminant opts into exact scalar semantics as well as an
  // exhaustive partition. Legacy listed-only typed callers retain parity.
  if(composition&&offer.actions.some(action=>action.kind!=='command'||typeof action.enabled!=='boolean'||!['primary','secondary','quiet','danger'].includes(action.intent)||action.reason!==undefined&&(typeof action.reason!=='string'||action.reason.length>1000)))errors.push('invalid composition action scalars');
  if(composition&&groups.some(group=>group.kind==='finite-choice'&&(!['preserve-compatible','reset-to-defaults'].includes(group.reconciliation)||!['disabled','hidden'].includes(group.submit.unavailable)||group.fields.some(field=>field.options.some(option=>typeof option.enabled!=='boolean'||option.reason!==undefined&&(typeof option.reason!=='string'||option.reason.length>1000))))))errors.push('invalid composition finite scalars');
  if(!decision.id?.trim()||!offer.id?.trim()||!Array.isArray(decision.commands)||!unique(decision.commands)||!Array.isArray(offer.actions)||!unique(offer.actions.map(a=>a.id)))errors.push('invalid decision/offer identities');
  if(composition&&(!Array.isArray(groups)||groups.length>2||!unique(groups.map(g=>g.id))||new Set(groups.map(g=>g.kind)).size!==groups.length||groups.some(group=>!group.variants.length)))errors.push('invalid composition groups');
  const commands=new Map(offer.actions.filter((a):a is CommandSpec<A>=>a.kind==='command').map(a=>[a.id,a]));
  const bindings:Record<string,string|null>=Object.create(null);
  const bind=(id:string,owner:string|null)=>{if(!commands.has(id)||!commands.get(id)!.label.trim())errors.push(`invalid binding: ${id}`);if(Object.hasOwn(bindings,id))errors.push(`overlapping action binding: ${id}`);else bindings[id]=owner;};
  for(const id of decision.commands)bind(id,ROOT_DECISION_GROUP);
  for(const group of groups){
   if(!['finite-choice','card-selection'].includes(group.kind)) {errors.push('invalid group kind');continue;}
   if(composition&&'commands' in decision.groups.find(value=>value.id===group.id)!)errors.push('group commands must be root bindings');
   const spec={...group,commands:composition?[]:group.commands};
   errors.push(...(spec.kind==='finite-choice'?validateDecision(spec,offer):validateCardSelection(spec,offer,handIds)));
   for(const row of group.variants)bind(row.actionId,group.id);
  }
  if(composition&&(offer.actions.some(a=>a.kind!=='command')||offer.actions.some(a=>!Object.hasOwn(bindings,a.id))))errors.push('composition must exhaustively partition offered commands');
  if(!errors.length)value=Object.freeze({id:decision.id,origin:composition?'composition-exhaustive':'legacy-listed',commands:Object.freeze([...decision.commands]),groups:Object.freeze([...groups]),bindings:Object.freeze(bindings)});
 }catch{errors.push('invalid decision structure');}
 return Object.freeze({value,errors:Object.freeze(errors)});
}
export function decisionCoverage<A>(input:DecisionInput<A>){const groups=decisionGroups(input.decision),listed=[...input.decision.commands,...groups.flatMap(g=>g.variants.map(r=>r.actionId))],offered=input.offer.actions.filter(a=>a.kind==='command').map(a=>a.id);return Object.freeze({offeredCommandIds:Object.freeze(offered),listedBindingIds:Object.freeze(listed),unboundCommandIds:Object.freeze(offered.filter(id=>!listed.includes(id))),duplicateBindingIds:Object.freeze([...new Set(listed.filter((id,i)=>listed.indexOf(id)!==i))])});}
export function ownComposableDecision(decision:ComposableDecision):ComposableDecision{
 if(decision.kind==='commands'||decision.kind==='finite-choice')return immutableSpec(decision);
 const own=(group:DecisionGroupSpec):DecisionGroupSpec=>group.kind==='finite-choice'?immutableSpec(group) as FiniteDecisionSpec:Object.freeze({...group,commands:Object.freeze([...group.commands]),variants:Object.freeze(group.variants.map(row=>Object.freeze({actionId:row.actionId,cardIds:Object.freeze([...row.cardIds])}))),submit:Object.freeze({...group.submit})});
 return decision.kind==='card-selection'?own(decision):Object.freeze({...decision,commands:Object.freeze([...decision.commands]),groups:Object.freeze(decisionGroups(decision).map(group=>{const {commands,...result}=own(group);return Object.freeze(result);}))});
}
export type GroupDraft={readonly kind:'finite-choice';readonly values:ChoiceValues|null}|{readonly kind:'card-selection';readonly cardIds:readonly string[];readonly actionId:string|null};
export interface DecisionDraftState {readonly revision:number;readonly groups:Readonly<Record<string,GroupDraft>>;}
export const emptyDecisionDraft=():DecisionDraftState=>Object.freeze({revision:0,groups:Object.freeze(Object.create(null))});
export const clearDecisionDraft=(draft:DecisionDraftState):DecisionDraftState=>Object.freeze({revision:draft.revision+1,groups:Object.freeze(Object.create(null))});
const freezeDraft=(revision:number,groups:Record<string,GroupDraft>):DecisionDraftState=>Object.freeze({revision,groups:Object.freeze(groups)});
const schema=(group:DecisionGroupSpec)=>JSON.stringify(group.kind==='finite-choice'?[group.id,group.kind,group.policy??'complete',group.reconciliation,Object.entries(group.contexts??{}).map(([id,context])=>[id,context.value]).sort(([a],[b])=>String(a).localeCompare(String(b)))]:[group.id,group.kind,group.mode,group.count??null,group.disambiguation??null]);
/** Count drafts contain card IDs, never an action choice. Stable semantic
 * bindings can survive publication lease/payload refresh; confirmation still
 * resolves the new exact offer. This call-local value is never retained. */
function countDraftFingerprint<A>(input:DecisionInput<A>,group:CardSelectionDecision):string{
 const actions=new Map(input.offer.actions.filter((action):action is CommandSpec<A>=>action.kind==='command').map(action=>[action.id,action]));
 return JSON.stringify([[...input.handIds].sort(),group.variants.map(row=>[row.actionId,[...row.cardIds].sort(),actions.get(row.actionId)?.enabled]).sort((a,b)=>String(a[0])<String(b[0])?-1:String(a[0])>String(b[0])?1:0)]);
}
/** Reconciliation has no retained descriptor/payload. Caller explicitly supplies
 * the old/current semantic input and whether the authenticated scope survived. */
export function reconcileDecisionDraft<A>(input:DecisionInput<A>,draft:DecisionDraftState,previous?:DecisionInput<A>,sameScope=false,continuousCountScope=sameScope):DecisionDraftState{
 const normalized=normalizeDecision(input).value,groups:Record<string,GroupDraft>=Object.create(null);if(!normalized)return freezeDraft(draft.revision+1,groups);
 for(const group of normalized.groups){const old=previous&&decisionGroups(previous.decision).find(g=>g.id===group.id),stored=draft.groups[group.id],inertCount=group.kind==='card-selection'&&group.mode==='count'&&input.decision.kind==='composition'&&previous?.decision.kind==='composition',compatible=!!old&&(inertCount?continuousCountScope:sameScope)&&previous!.decision.id===input.decision.id&&old.kind===group.kind&&schema(old)===schema(group);
  if(group.kind==='finite-choice'){const values=initializeChoices(group,input.offer,compatible&&stored?.kind==='finite-choice'?stored.values??undefined:undefined);groups[group.id]=Object.freeze({kind:'finite-choice',values});}
  else {const authority=(value:DecisionInput<A>,spec:CardSelectionDecision)=>cardSelectionAuthority({context:{session:'scope',audience:'scope',generation:'scope'},offer:value.offer,decision:spec,hand:value.handIds.map(id=>({id}))});
  const sameBindings=old?.kind==='card-selection'&&(inertCount?countDraftFingerprint(previous!,old)===countDraftFingerprint(input,group):authority(previous!,old)===authority(input,group));
  const ids=compatible&&stored?.kind==='card-selection'&&old?.kind==='card-selection'&&(group.mode!=='count'||previous!.decision.kind===input.decision.kind)&&sameBindings?stored.cardIds:Object.freeze([]);groups[group.id]=Object.freeze({kind:'card-selection',cardIds:ids,actionId:group.mode==='count'?null:compatible&&stored?.kind==='card-selection'&&ids===stored.cardIds?stored.actionId:null});}
 }
 return freezeDraft(draft.revision+1,groups);
}
export type DecisionEdit={readonly kind:'choose';readonly groupId:string;readonly fieldId:string;readonly optionId:string}|{readonly kind:'toggle-card';readonly groupId:string;readonly cardId:string}|{readonly kind:'choose-card-action';readonly groupId:string;readonly actionId:string}|{readonly kind:'replace-finite';readonly groupId:string;readonly values:ChoiceValues};
export function reduceDecisionDraft<A>(input:DecisionInput<A>,draft:DecisionDraftState,edit:DecisionEdit):DecisionDraftState|null{
 const normalized=normalizeDecision(input).value,group=normalized?.groups.find(g=>g.id===edit.groupId),stored=draft.groups[edit.groupId];if(!group||!stored||group.kind!==stored.kind)return null;
 let next:GroupDraft;
 if(group.kind==='finite-choice'&&stored.kind==='finite-choice'){
  const values=edit.kind==='choose'?reconcileChoices(group,input.offer,stored.values??group.initialValues,edit.fieldId,edit.optionId):edit.kind==='replace-finite'?edit.values:null;
  if(!values)return null;if(edit.kind==='replace-finite'&&!selectedChoiceAction(group,input.offer,values))return null;
  next=Object.freeze({kind:'finite-choice',values:Object.freeze({...values})});
 }else if(group.kind==='card-selection'&&stored.kind==='card-selection'){
  if(edit.kind==='toggle-card'){const ids=toggleCards(group,input.offer,stored.cardIds,edit.cardId);if(!ids)return null;next=Object.freeze({kind:'card-selection',cardIds:ids,actionId:null});}
  else if(edit.kind==='choose-card-action'&&selectedCardActions(group,input.offer,stored.cardIds).some(a=>a.id===edit.actionId&&a.enabled))next=Object.freeze({...stored,actionId:edit.actionId});else return null;
 }else return null;
 return freezeDraft(draft.revision+1,{...draft.groups,[edit.groupId]:next});
}
export type DecisionCommitment<A>={readonly kind:'command';readonly actionId:string;readonly action:A}|{readonly kind:'card-set';readonly cardIds:readonly string[]};
/** Bindings remain exact canonical objects; count batches compile in offer order. */
export function resolveDecisionCommitment<A>(input:DecisionInput<A>,groupId:string|null,commitment:DecisionCommitment<A>):readonly CommandSpec<A>[]|null{
 const normalized=normalizeDecision(input).value;if(!normalized)return null;
 if(commitment.kind==='card-set'){const group=normalized.groups.find(g=>g.id===groupId);return group?.kind==='card-selection'&&group.mode==='count'?selectedCardCommands(group,input.offer,commitment.cardIds):null;}
 if(normalized.bindings[commitment.actionId]!==groupId)return null;
 const action=input.offer.actions.find(a=>a.id===commitment.actionId);if(action?.kind!=='command'||!action.enabled||action.action!==commitment.action)return null;
 const group=normalized.groups.find(g=>g.id===groupId);if(group?.kind==='card-selection'&&group.mode==='count')return null;
 if(group?.kind==='finite-choice'&&!group.variants.some(row=>row.actionId===action.id&&group.fields.every(field=>field.options.some(o=>o.id===row.tuple[field.id]&&o.enabled)||group.policy==='staged'&&group.contexts?.[field.id]?.value===row.tuple[field.id])))return null;
 return Object.freeze([action]);
}
export function draftCommitment<A>(input:DecisionInput<A>,draft:DecisionDraftState,groupId:string):DecisionCommitment<A>|null{
 const group=normalizeDecision(input).value?.groups.find(g=>g.id===groupId),stored=draft.groups[groupId];if(!group||!stored)return null;
 if(group.kind==='finite-choice'&&stored.kind==='finite-choice'){const action=selectedChoiceAction(group,input.offer,stored.values);return action?Object.freeze({kind:'command',actionId:action.id,action:action.action}):null;}
 if(group.kind==='card-selection'&&stored.kind==='card-selection'){if(group.mode==='count')return selectedCardCommands(group,input.offer,stored.cardIds)?Object.freeze({kind:'card-set',cardIds:stored.cardIds}):null;const action=selectedCardAction(group,input.offer,stored.cardIds,stored.actionId);return action?Object.freeze({kind:'command',actionId:action.id,action:action.action}):null;}
 return null;
}
export function deriveDecisionViews<A>(input:DecisionInput<A>,draft:DecisionDraftState){const normalized=normalizeDecision(input).value;if(!normalized)return Object.freeze([]);return Object.freeze(normalized.groups.map(group=>{const stored=draft.groups[group.id];if(group.kind==='finite-choice'){const values=stored?.kind==='finite-choice'?stored.values:Object.freeze({});return Object.freeze({id:group.id,kind:group.kind,spec:group,values,fields:availableOptions(group,input.offer,values),selected:selectedChoiceAction(group,input.offer,values)});}const cardIds=stored?.kind==='card-selection'?stored.cardIds:Object.freeze([]),actionId=stored?.kind==='card-selection'?stored.actionId:null;return Object.freeze({id:group.id,kind:group.kind,spec:group,cardIds,actionId,available:availableCardIds(group,input.offer,cardIds),eligible:eligibleCardIds(group,input.offer),countReady:group.mode==='count'&&!!selectedCardCommands(group,input.offer,cardIds),actionVariants:selectedCardActions(group,input.offer,cardIds),selected:selectedCardAction(group,input.offer,cardIds,actionId)});}));}

export function resetDecisionGroup<A>(input:DecisionInput<A>,draft:DecisionDraftState,groupId:string):DecisionDraftState|null{const next=reconcileDecisionDraft(input,draft),group=next.groups[groupId];return group?freezeDraft(draft.revision+1,{...draft.groups,[groupId]:group}):null;}
