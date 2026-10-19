import type { ActionOffer, CommandSpec } from './presentation';
import type {CardVisual,CardEmphasis} from '../cardTypes';

export type DecisionCaptionAtom={readonly join?:'previous'}&({readonly kind:'text';readonly text:string}|{readonly kind:'number';readonly value:number}|{readonly kind:'suit';readonly suit:'Spade'|'Heart'|'Diamond'|'Club';readonly label:string});
export interface ChoiceContext {readonly value:string;readonly caption:readonly DecisionCaptionAtom[];}
export function captionAtomLabel(atom:DecisionCaptionAtom):string{return atom.kind==='text'?atom.text:atom.kind==='number'?String(atom.value):atom.label;}
export function captionLabel(atoms:readonly DecisionCaptionAtom[]):string{return atoms.reduce((text,atom,index)=>text+(index&&!(atom.join==='previous')?' ':'')+captionAtomLabel(atom),'');}
function ownCaptionAtom(value:unknown):DecisionCaptionAtom{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('invalid decision caption');
 const fields=Object.getOwnPropertyDescriptors(value),kind=fields.kind?.value,allowed=kind==='text'?['kind','text','join']:kind==='number'?['kind','value','join']:kind==='suit'?['kind','suit','label','join']:[];
 if(!allowed.length||Reflect.ownKeys(fields).some(key=>typeof key!=='string'||!allowed.includes(key)||!('value'in fields[key])||!fields[key].enumerable))throw Error('invalid decision caption');
 if(fields.join!==undefined&&fields.join.value!=='previous')throw Error('invalid caption join');
 const join=fields.join?{join:'previous' as const}:{};
 if(kind==='text'&&typeof fields.text?.value==='string'&&fields.text.value.trim()&&fields.text.value.length<=1000&&(fields.join===undefined||fields.join.value==='previous'))return Object.freeze({kind,text:fields.text.value,...(fields.join?{join:'previous' as const}:{})});
 if(kind==='number'&&Number.isFinite(fields.value?.value))return Object.freeze({kind,value:fields.value.value,...join});
 if(kind==='suit'&&['Spade','Heart','Diamond','Club'].includes(fields.suit?.value)&&typeof fields.label?.value==='string'&&fields.label.value.trim())return Object.freeze({kind,suit:fields.suit.value,label:fields.label.value,...join});
 throw Error('invalid decision caption');
}
export function ownCaption(atoms:readonly DecisionCaptionAtom[]):readonly DecisionCaptionAtom[]{
 if(!Array.isArray(atoms)||Object.getPrototypeOf(atoms)!==Array.prototype||!atoms.length||atoms.length>16||Reflect.ownKeys(atoms).length!==atoms.length+1)throw Error('invalid decision caption');
 const result:DecisionCaptionAtom[]=[];for(let i=0;i<atoms.length;i++){const d=Object.getOwnPropertyDescriptor(atoms,String(i));if(!d||!('value'in d)||!d.enumerable)throw Error('invalid decision caption');const atom=ownCaptionAtom(d.value);if(i===0&&atom.join!==undefined)throw Error('invalid leading caption join');result.push(atom);}return Object.freeze(result);
}
export interface ChoiceOption {
  readonly caption?:readonly DecisionCaptionAtom[];
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly visual?:CardVisual;
  readonly emphasis?:CardEmphasis;
  readonly description?:string;
}
/** Meaning and hierarchy only. The engine owns picker geometry and lifetime. */
export interface ChoiceCatalogue {
  readonly title:string;
  readonly openLabel:string;
  readonly featuredIds:readonly string[];
  readonly groups?:readonly {readonly id:string;readonly label:string;readonly optionIds:readonly string[]}[];
}
export interface ChoiceField {
  readonly id: string;
  readonly label: string;
  readonly options: readonly ChoiceOption[];
  readonly catalogue?:ChoiceCatalogue;
}
export interface FiniteChoicePresentation {readonly kind:'choice-strips';}
/** A closed control recipe; applications supply no dimensions or positions. */
export function ownFiniteChoicePresentation(value:unknown):FiniteChoicePresentation {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid finite presentation');
 const prototype=Object.getPrototypeOf(value),fields=Object.getOwnPropertyDescriptors(value);
 if(prototype!==Object.prototype&&prototype!==null||Reflect.ownKeys(fields).length!==1||!fields.kind||!('value'in fields.kind)||!fields.kind.enumerable||fields.kind.value!=='choice-strips')throw Error('invalid finite presentation');
 return Object.freeze({kind:'choice-strips'});
}
export type ChoiceValues = Readonly<Record<string, string>>;
export interface CompleteVariant { readonly tuple: ChoiceValues; readonly actionId: string; readonly caption?:readonly DecisionCaptionAtom[] }
interface DecisionBase { readonly id: string; readonly commands: readonly string[] }
export type DecisionSpec = DecisionBase & (
  | { readonly kind: 'commands'; readonly presentation?:never; readonly fields?: never; readonly variants?: never; readonly initialValues?: never; readonly reconciliation?: never; readonly submit?: never }
  | { readonly kind: 'finite-choice'; readonly policy?:'complete'|'staged'; readonly contexts?:Readonly<Record<string,ChoiceContext>>; readonly presentation?:FiniteChoicePresentation; readonly fields: readonly ChoiceField[]; readonly variants: readonly CompleteVariant[]; readonly initialValues: ChoiceValues; readonly reconciliation: 'reset-to-defaults' | 'preserve-compatible'; readonly submit: { readonly unavailable: 'disabled' | 'hidden'; readonly presentationLabel?: { readonly prefix: string } } }
);
export type FiniteDecisionSpec = Extract<DecisionSpec, {kind:'finite-choice'}>;
export interface AvailableOption extends ChoiceOption { readonly available: boolean }
export interface AvailableField extends Omit<ChoiceField, 'options'> { readonly options: readonly AvailableOption[] }
/** True blocks that class of activation. These are local UI guards, not server permission. */
export interface DecisionGuards { readonly commands: boolean; readonly submit: boolean }
const unique = (values: readonly string[]) => new Set(values).size === values.length && values.every(value => value.length > 0);
const has = (value: ChoiceValues, key: string) => Object.hasOwn(value, key);
export const command = <A>(offer: ActionOffer<A>, id: string): CommandSpec<A> | undefined => {
  const action = offer.actions.find(action => action.id === id);
  return action?.kind === 'command' ? action : undefined;
};

/** Semantic validation of typed descriptors. This is not an untrusted JSON decoder. */
export function validateDecision<A>(spec: DecisionSpec, offer: ActionOffer<A>): readonly string[] {
  const errors: string[] = [];
  if (!spec.id || !offer.id) errors.push('missing decision or offer id');
  if (!unique(offer.actions.map(action => action.id))) errors.push('invalid action ids');
  if (!unique(spec.commands)) errors.push('invalid command ids');
  const actions = new Map(offer.actions.map(action => [action.id,action]));
  const commands = new Set(spec.commands);
  const checkCommand = (id: string, choice: boolean) => {
    const candidate = actions.get(id), action = candidate?.kind === 'command' ? candidate : undefined;
    if (!action || (choice && commands.has(id))) errors.push(`${choice ? 'invalid choice' : 'invalid command'} binding: ${id}`);
    else if (!action.label.trim()) errors.push(`missing action label: ${id}`);
  };
  for (const id of spec.commands) checkCommand(id, false);
  if(spec.presentation!==undefined){try{ownFiniteChoicePresentation(spec.presentation);if(spec.kind!=='finite-choice'||spec.fields.some(field=>field.catalogue))errors.push('incompatible finite presentation');}catch{errors.push('invalid finite presentation');}}
  if (spec.kind === 'commands') return Object.freeze(errors);
  if(spec.policy!==undefined&&!['complete','staged'].includes(spec.policy))errors.push('invalid finite policy');
  if(spec.contexts!==undefined&&spec.policy!=='staged')errors.push('contexts require staged policy');
  if (spec.submit.presentationLabel && !spec.submit.presentationLabel.prefix.trim()) errors.push('missing submit prefix');
  if (!spec.fields.length || !unique(spec.fields.map(field => field.id))) errors.push('invalid field ids');
  for (const field of spec.fields) {
    if (!field.label.trim()) errors.push(`missing field label: ${field.id}`);
    if (!field.options.length || !unique(field.options.map(option => option.id))) errors.push(`invalid option ids: ${field.id}`);
    if (field.options.some(option => !option.label.trim())) errors.push(`missing option label: ${field.id}`);
    for(const option of field.options){
      const visual=option.visual;
      if(visual&&(visual.kind==='standard'?!['Spade','Heart','Diamond','Club'].includes(visual.suit)||!Number.isInteger(visual.rank)||visual.rank<2||visual.rank>14:visual.kind!=='joker'||!['Black','Red'].includes(visual.color)))errors.push(`invalid option artwork: ${field.id}`);
      if(option.emphasis!==undefined&&!['special','joker','call'].includes(option.emphasis))errors.push(`invalid option emphasis: ${field.id}`);
      if(option.description!==undefined&&(!option.description.trim()||option.description.length>1000))errors.push(`invalid option description: ${field.id}`);
    }
    const catalogue=field.catalogue;
    if(catalogue){
      const options=new Set(field.options.map(option=>option.id));
      if(field.options.length>104||!catalogue.title.trim()||!catalogue.openLabel.trim()||!unique(catalogue.featuredIds)||catalogue.featuredIds.length>12||catalogue.featuredIds.some(id=>!options.has(id)))errors.push(`invalid choice catalogue: ${field.id}`);
      if(catalogue.groups){const grouped=catalogue.groups.flatMap(group=>group.optionIds);if(catalogue.groups.length>8||!unique(catalogue.groups.map(group=>group.id))||catalogue.groups.some(group=>!group.label.trim()||!group.optionIds.length)||!unique(grouped)||grouped.length!==options.size||grouped.some(id=>!options.has(id)))errors.push(`invalid catalogue groups: ${field.id}`);}
    }
  }
  const optionIds = spec.fields.map(field => new Set(field.options.map(option => option.id)));
  for(const [id,context]of Object.entries(spec.contexts??{})){const field=spec.fields.find(f=>f.id===id);if(!field||!context.value?.trim()||field.options.some(option=>option.id===context.value))errors.push('invalid staged context');try{ownCaption(context.caption);}catch{errors.push('invalid context caption');}}
  for(const field of spec.fields)for(const option of field.options)if(option.caption){try{ownCaption(option.caption);}catch{errors.push('invalid option caption');}}
  const allowed=(field:ChoiceField,index:number,value:string)=>optionIds[index].has(value)||spec.policy==='staged'&&spec.contexts?.[field.id]?.value===value;
  const complete = (tuple: ChoiceValues) => Object.keys(tuple).length === spec.fields.length
    && spec.fields.every((field,index) => has(tuple, field.id) && allowed(field,index,tuple[field.id]));
  const tuples = new Set<string>();
  for (const variant of spec.variants) {
    if (!complete(variant.tuple)) errors.push('incomplete variant tuple');
    checkCommand(variant.actionId, true);if(variant.caption){try{ownCaption(variant.caption);}catch{errors.push('invalid variant caption');}}
    const key = JSON.stringify(spec.fields.map(field => variant.tuple[field.id]));
    if (tuples.has(key)) errors.push('ambiguous variant tuple');
    tuples.add(key);
  }
  if(spec.policy==='staged'){if(spec.reconciliation!=='preserve-compatible'||Object.keys(spec.initialValues).some(id=>!spec.fields.some(field=>field.id===id&&field.options.some(option=>option.id===spec.initialValues[id]))))errors.push('invalid staged initial tuple');}
  else if (!complete(spec.initialValues) || !spec.variants.some(row => spec.fields.every(field => row.tuple[field.id] === spec.initialValues[field.id]))) errors.push('invalid initial tuple');
  return Object.freeze(errors);
}
function eligibleRows<A>(spec: FiniteDecisionSpec, offer: ActionOffer<A>): readonly CompleteVariant[] {
  // Call-local indexes deliberately avoid caching caller-owned mutable descriptors.
  const enabledActions = new Set(offer.actions.filter(action => action.kind === 'command' && action.enabled).map(action => action.id));
  const enabledOptions = spec.fields.map(field => new Set(field.options.filter(option => option.enabled).map(option => option.id)));
  return spec.variants.filter(row => enabledActions.has(row.actionId)
    && spec.fields.every((field,index) => enabledOptions[index].has(row.tuple[field.id])||spec.policy==='staged'&&spec.contexts?.[field.id]?.value===row.tuple[field.id]));
}
export function eligible<A>(spec: FiniteDecisionSpec, offer: ActionOffer<A>, row: CompleteVariant): boolean {
  return command(offer, row.actionId)?.enabled === true
    && spec.fields.every(field => field.options.some(option => option.id === row.tuple[field.id] && option.enabled)||spec.policy==='staged'&&spec.contexts?.[field.id]?.value===row.tuple[field.id]);
}
function repair(spec: FiniteDecisionSpec, candidates: readonly CompleteVariant[], current: ChoiceValues, pinned?: string): ChoiceValues | null {
  let rows = [...candidates];
  for (const field of spec.fields) {
    if (field.id === pinned) continue;
    const preserved = rows.filter(row => row.tuple[field.id] === current[field.id]);
    if (preserved.length) rows = preserved;
    else {
      const supported = new Set(rows.map(row => row.tuple[field.id]));
      const fallback = field.options.find(option => option.enabled && supported.has(option.id));
      if (!fallback) return null;
      rows = rows.filter(row => row.tuple[field.id] === fallback.id);
    }
  }
  return rows[0] ? Object.freeze({...rows[0].tuple}) : null;
}
export function effectiveChoices(spec:FiniteDecisionSpec,explicit:ChoiceValues):ChoiceValues{return Object.freeze({...Object.fromEntries(Object.entries(spec.contexts??{}).map(([id,context])=>[id,context.value])),...explicit});}
export function selectedChoiceAction<A>(spec:FiniteDecisionSpec,offer:ActionOffer<A>,values:ChoiceValues|null):CommandSpec<A>|null{if(!values||validateDecision(spec,offer).length)return null;const effective=effectiveChoices(spec,values),row=spec.variants.find(row=>spec.fields.every(field=>row.tuple[field.id]===effective[field.id])&&eligible(spec,offer,row));return row?command(offer,row.actionId)??null:null;}
export function initializeChoices<A>(spec: FiniteDecisionSpec, offer: ActionOffer<A>, previous?: ChoiceValues): ChoiceValues | null {
  if (validateDecision(spec, offer).length) return null;
  if(spec.policy==='staged')return Object.freeze({...Object.fromEntries(Object.entries(previous??spec.initialValues).filter(([id,value])=>spec.fields.some(field=>field.id===id&&field.options.some(option=>option.id===value))))});
  return repair(spec, eligibleRows(spec, offer), spec.reconciliation === 'preserve-compatible' && previous ? previous : spec.initialValues);
}
export function reconcileChoices<A>(spec: FiniteDecisionSpec, offer: ActionOffer<A>, current: ChoiceValues, field: string, option: string): ChoiceValues | null {
  if (validateDecision(spec, offer).length || !spec.fields.some(f => f.id === field && f.options.some(o => o.id === option && o.enabled))) return null;
  const index=spec.fields.findIndex(candidate=>candidate.id===field);
  if(spec.policy==='staged'){const next=Object.fromEntries(spec.fields.slice(0,index).flatMap(prior=>has(current,prior.id)?[[prior.id,current[prior.id]]]:[]));if(current[field]!==option)Object.defineProperty(next,field,{value:option,enumerable:true,writable:true,configurable:true});const effective=effectiveChoices(spec,next);if(current[field]!==option&&!eligibleRows(spec,offer).some(row=>spec.fields.slice(0,index+1).every(prior=>effective[prior.id]===undefined||row.tuple[prior.id]===effective[prior.id])))return null;return Object.freeze(next);}
  const prefix=spec.presentation?.kind==='choice-strips'?spec.fields.slice(0,index):[];
  return repair(spec, eligibleRows(spec, offer).filter(row => row.tuple[field] === option&&prefix.every(previous=>row.tuple[previous.id]===(current[previous.id]??spec.initialValues[previous.id]))), current, field);
}
/** Availability means at least one enabled complete tuple supports that explicit choice. */
export function availableOptions<A>(spec: FiniteDecisionSpec, offer: ActionOffer<A>,currentValues?:ChoiceValues|null): readonly AvailableField[] {
  const rows = validateDecision(spec, offer).length ? [] : eligibleRows(spec, offer);
  const selected=spec.policy==='staged'?effectiveChoices(spec,currentValues??spec.initialValues):currentValues??spec.initialValues;
  return Object.freeze(spec.fields.map((field,index) => {
    const visible=spec.presentation?.kind==='choice-strips'||spec.policy==='staged'?new Set(spec.variants.filter(row=>spec.fields.slice(0,index).every(previous=>row.tuple[previous.id]===selected[previous.id])).map(row=>row.tuple[field.id])):null;
    const supported = new Set(rows.filter(row=>spec.presentation?.kind!=='choice-strips'&&spec.policy!=='staged'||spec.fields.slice(0,index).every(previous=>row.tuple[previous.id]===selected[previous.id])).map(row => row.tuple[field.id]));
    return Object.freeze({...field, options:Object.freeze(field.options.filter(option=>!visible||visible.has(option.id)).map(option => Object.freeze({...option, available: option.enabled && supported.has(option.id)})))});
  }));
}
export function immutableSpec(spec: DecisionSpec): DecisionSpec {
  const base = {...spec, commands:Object.freeze([...spec.commands])};
  if (base.kind === 'commands') return Object.freeze(base);
  const fields=Object.freeze(base.fields.map(field=>Object.freeze({
    ...field,
    options:Object.freeze(field.options.map(option=>Object.freeze({
      ...option,...(option.caption?{caption:ownCaption(option.caption)}:{}),...(option.visual?{visual:Object.freeze({...option.visual})}:{})
    }))),
    ...(field.catalogue?{catalogue:Object.freeze({
      ...field.catalogue,
      featuredIds:Object.freeze([...field.catalogue.featuredIds]),
      ...(field.catalogue.groups?{groups:Object.freeze(field.catalogue.groups.map(group=>Object.freeze({
        ...group,optionIds:Object.freeze([...group.optionIds])
      })))}:{})
    })}:{})
  })));
  return Object.freeze({...base,...(base.presentation?{presentation:ownFiniteChoicePresentation(base.presentation)}:{}),fields,
    variants:Object.freeze(base.variants.map(row=>Object.freeze({...row,tuple:Object.freeze({...row.tuple}),...(row.caption?{caption:ownCaption(row.caption)}:{})}))),
    initialValues:Object.freeze({...base.initialValues}),...(base.contexts?{contexts:Object.freeze(Object.fromEntries(Object.entries(base.contexts).map(([id,context])=>[id,Object.freeze({value:context.value,caption:ownCaption(context.caption)})])))}:{}),
    submit:Object.freeze({...base.submit,...(base.submit.presentationLabel?{presentationLabel:Object.freeze({...base.submit.presentationLabel})}:{})})
  });
}


/** Fixed caption positions with public atom alternatives. This describes a
 * measurement vocabulary, never tuples, actions, enabledness or geometry. */
export interface CaptionDomain {readonly parts:readonly (readonly DecisionCaptionAtom[])[];}
export const CAPTION_DOMAIN_LIMITS=Object.freeze({parts:16,alternatives:256,atoms:512});
export function ownCaptionDomain(value:unknown):CaptionDomain{
 const fail=():never=>{throw Error('invalid caption domain');};
 const record=(raw:unknown,keys:readonly string[])=>{if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw))||Reflect.ownKeys(raw).length!==keys.length)return fail();const fields=Object.getOwnPropertyDescriptors(raw);if(keys.some(key=>!fields[key]||!('value'in fields[key])||!fields[key].enumerable))return fail();return Object.fromEntries(keys.map(key=>[key,fields[key].value]));};
 const array=<T>(raw:unknown,max:number,own:(value:unknown)=>T):readonly T[]=>{if(!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype||!raw.length||raw.length>max||Reflect.ownKeys(raw).length!==raw.length+1)return fail();const values:T[]=[];for(let i=0;i<raw.length;i++){const d=Object.getOwnPropertyDescriptor(raw,String(i));if(!d||!('value'in d)||!d.enumerable)return fail();values.push(own(d.value));}return Object.freeze(values);};
 let count=0;const source=record(value,['parts']);
  let partIndex=0;
 const parts=array(source.parts,CAPTION_DOMAIN_LIMITS.parts,raw=>{const index=partIndex++,atoms=array(raw,CAPTION_DOMAIN_LIMITS.alternatives,input=>{const atom=ownCaptionAtom(input);if(index===0&&atom.join!==undefined)return fail();return atom;});if(new Set(atoms.map(atom=>JSON.stringify(atom))).size!==atoms.length)return fail();count+=atoms.length;if(count>CAPTION_DOMAIN_LIMITS.atoms)return fail();return atoms;});
 return Object.freeze({parts});
}
export function captionAtomKey(atom:DecisionCaptionAtom):string{return JSON.stringify(atom.kind==='text'?['text',atom.text,atom.join??null]:atom.kind==='number'?['number',atom.value,atom.join??null]:['suit',atom.suit,atom.label,atom.join??null]);}
export function captionMatchesDomain(atoms:readonly DecisionCaptionAtom[],domain:CaptionDomain):boolean{return atoms.length===domain.parts.length&&atoms.every((atom,index)=>domain.parts[index].some(value=>captionAtomKey(value)===captionAtomKey(atom)));}
/** Per-validation-call scalar index. No mutable caller object/global cache is
 * retained, and membership remains identical to exact typed atom comparison. */
export function compileCaptionDomain(domain:CaptionDomain):(atoms:readonly DecisionCaptionAtom[])=>boolean{
 const parts=domain.parts.map(atoms=>new Set(atoms.map(captionAtomKey)));
 return atoms=>atoms.length===parts.length&&atoms.every((atom,index)=>parts[index].has(captionAtomKey(atom)));
}
