import {MAX_COMMAND_BATCH} from '../../generated/protocol';
import {DECISION_DESCRIPTOR_LIMITS} from '../decisionDescriptor';
import {decisionGroups,cardDecision,finiteDecision} from '../decisionCore';
import {ownCaptionDomain,captionMatchesDomain,compileCaptionDomain,type CaptionDomain,type DecisionCaptionAtom} from '../decisionModel';
import type {TableDocument,ViewContext,InformationAtom} from './contracts';
import {ownFiniteChoicePresentation,type FiniteChoicePresentation,type ChoiceField,type ChoiceValues} from '../decisionModel';
import {shellCommandActionIds} from './roomShell';
import type {CardSelectionDecision} from './cardSelection';

/** Caption vocabulary for a public phase, independent of current private offers. */
export interface CardSelectionPresentation {
    readonly kind:'card-selection';
    readonly mode:'one';
    readonly submit:Pick<CardSelectionDecision['submit'],'prefix'>;
    readonly statusLabels:readonly string[];
    readonly submitLabels:readonly string[];
    /** Native caption groups that can share one selected card; no identities or authority. */
    readonly actionVariantLabelGroups?:readonly (readonly string[])[];
}
/** Public atoms only: never a participant/card reference, payload or draft. */
export type PhaseChoiceAtom=DecisionCaptionAtom & {readonly join?:never};
export interface PhaseChoiceOption {readonly key:string;readonly atom:PhaseChoiceAtom;}
export interface FiniteChoicePhasePresentation {
 readonly kind:'finite-choice';
 readonly presentation:FiniteChoicePresentation;
 readonly fields:readonly {readonly id:string;readonly label:string;readonly options:readonly PhaseChoiceOption[]}[];
 readonly auxiliaryLabels:readonly string[];
 readonly submit:{readonly prefix:string;readonly fieldIds:readonly string[]};
}
export type DecisionPresentation=FiniteChoicePhasePresentation & {readonly scopeKey:string};
export const PHASE_DECISION_LIMITS=Object.freeze({fields:8,optionsPerField:256,options:512,auxiliary:16,variantFieldWork:16384});
/** Native spelling is derived from typed suit meaning, never parsed from text. */
const suitCaptions={Spade:'♠',Diamond:'♦',Heart:'♥',Club:'♣'} as const;
export function phaseChoiceAtomLabel(atom:PhaseChoiceAtom):string{return atom.kind==='text'?atom.text:atom.kind==='number'?String(atom.value):atom.label;}
export function phaseChoiceAtomCaption(atom:PhaseChoiceAtom):string{return atom.kind==='suit'?suitCaptions[atom.suit]:phaseChoiceAtomLabel(atom);}
export interface FiniteGroupPresentation {readonly participantIds?:readonly string[];readonly id:string;readonly kind:'finite-choice';readonly presentation:FiniteChoicePresentation;readonly fields:readonly {readonly id:string;readonly visibleOptionCapacity:number;readonly captionDomains:readonly CaptionDomain[]}[];readonly submitDomains:readonly CaptionDomain[];}
export interface CardGroupPresentation {readonly participantIds?:readonly string[];readonly id:string;readonly kind:'card-selection';readonly mode:'one'|'many'|'count';readonly count?:number;readonly submit:{readonly prefix:string};readonly statusLabels:readonly string[];readonly submitLabels:readonly string[];readonly actionVariantLabelGroups?:readonly (readonly string[])[];}
export type GroupPhasePresentation=FiniteGroupPresentation|CardGroupPresentation;
export const GROUP_PHASE_LIMITS=Object.freeze({groups:2,fields:8,domains:4,distinctAtoms:512,bytes:65536});
export interface PhasePresentation {
    readonly groups?:readonly GroupPhasePresentation[];
    readonly id:string;
    readonly schemaVersion:number;
    readonly selection?:CardSelectionPresentation;
    readonly decision?:FiniteChoicePhasePresentation;
    readonly tableCollectionIds?:readonly string[];
}
export type SelectionPresentation=(CardSelectionPresentation|CardGroupPresentation) & {readonly scopeKey:string};
const fail=():never=>{throw Error('Invalid phase presentation cohort');};
function record(input:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
    if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return fail();
    const keys=Reflect.ownKeys(input);
    if(keys.some(key=>typeof key!=='string'||![...required,...optional].includes(key))||required.some(key=>!keys.includes(key)))return fail();
    const result:Record<string,unknown>={};
    for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(input,key)!;if(!('value'in descriptor)||!descriptor.enumerable)return fail();result[key as string]=descriptor.value;}
    return result;
}
function label(input:unknown):string{if(typeof input!=='string'||!input.trim()||input.length>256)return fail();return input;}
function labels(input:unknown,limit=104):readonly string[]{
    if(!Array.isArray(input)||input.length<1||input.length>limit||Reflect.ownKeys(input).length!==input.length+1)return fail();
    const result:string[]=[];
    for(let index=0;index<input.length;index++){const descriptor=Object.getOwnPropertyDescriptor(input,String(index));if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail();result.push(label(descriptor.value));}
    if(new Set(result).size!==result.length)return fail();
    return Object.freeze(result);
}
function sequence<T>(input:unknown,maximum:number,minimum:number,own:(value:unknown)=>T):readonly T[]{
 if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length<minimum||input.length>maximum||Reflect.ownKeys(input).length!==input.length+1)return fail();
 const values:T[]=[];for(let i=0;i<input.length;i++){const item=Object.getOwnPropertyDescriptor(input,String(i));if(!item||!('value'in item)||!item.enumerable)return fail();values.push(own(item.value));}return Object.freeze(values);
}
function ownChoiceAtom(input:unknown):PhaseChoiceAtom{
 const fields=record(input,['kind'],['text','value','suit','label']);
 if(fields.kind==='text'){const atom=record(input,['kind','text']);return Object.freeze({kind:'text',text:label(atom.text)});}
 if(fields.kind==='number'){const atom=record(input,['kind','value']);if(typeof atom.value!=='number'||!Number.isFinite(atom.value))return fail();return Object.freeze({kind:'number',value:atom.value});}
 if(fields.kind==='suit'){const atom=record(input,['kind','suit','label']);if(typeof atom.suit!=='string'||!Object.hasOwn(suitCaptions,atom.suit))return fail();return Object.freeze({kind:'suit',suit:atom.suit as keyof typeof suitCaptions,label:label(atom.label)});}
 return fail();
}
function ownDecisionPresentation(input:unknown):FiniteChoicePhasePresentation{
 const raw=record(input,['kind','presentation','fields','auxiliaryLabels','submit']);if(raw.kind!=='finite-choice')return fail();
 let presentation:FiniteChoicePresentation;try{presentation=ownFiniteChoicePresentation(raw.presentation);}catch{return fail();}
 let count=0;
 const fields=sequence(raw.fields,PHASE_DECISION_LIMITS.fields,1,value=>{const field=record(value,['id','label','options']),options=sequence(field.options,PHASE_DECISION_LIMITS.optionsPerField,1,value=>{const option=record(value,['key','atom']);return Object.freeze({key:label(option.key),atom:ownChoiceAtom(option.atom)});});if(new Set(options.map(option=>option.key)).size!==options.length)return fail();count+=options.length;if(count>PHASE_DECISION_LIMITS.options)return fail();return Object.freeze({id:label(field.id),label:label(field.label),options});});
 if(new Set(fields.map(field=>field.id)).size!==fields.length)return fail();
 const submit=record(raw.submit,['prefix','fieldIds']),fieldIds=sequence(submit.fieldIds,PHASE_DECISION_LIMITS.fields,1,label);
 if(fieldIds.length!==fields.length||new Set(fieldIds).size!==fieldIds.length||fieldIds.some(id=>!fields.some(field=>field.id===id)))return fail();
 return Object.freeze({kind:'finite-choice',presentation,fields,auxiliaryLabels:sequence(raw.auxiliaryLabels,PHASE_DECISION_LIMITS.auxiliary,0,label),submit:Object.freeze({prefix:label(submit.prefix),fieldIds})});
}
/** Exact inert schema: unknown keys, including nested authority, are rejected. */
export function ownPhasePresentation(input:unknown):PhasePresentation {
    const source=record(input,['id','schemaVersion'],['selection','decision','tableCollectionIds','groups']),id=label(source.id),schemaVersion=source.schemaVersion;
    if(!Number.isSafeInteger(schemaVersion)||Number(schemaVersion)<1)return fail();
    if('selection'in source&&'decision'in source||'groups'in source&&('selection'in source||'decision'in source))return fail();
    const groups='groups'in source?sequence(source.groups,GROUP_PHASE_LIMITS.groups,1,ownGroupPresentation):undefined;
    if(groups&&(new Set(groups.map(group=>group.id)).size!==groups.length||new Set(groups.map(group=>group.kind)).size!==groups.length))return fail();
    const decision='decision'in source?ownDecisionPresentation(source.decision):undefined;
    let selection:CardSelectionPresentation|undefined;
    if('selection'in source){
        const raw=record(source.selection,['kind','mode','submit','statusLabels','submitLabels'],['actionVariantLabelGroups']),submit=record(raw.submit,['prefix']);
        if(raw.kind!=='card-selection'||raw.mode!=='one')return fail();
        let groups:readonly (readonly string[])[]|undefined;
        if('actionVariantLabelGroups'in raw){
            const input=raw.actionVariantLabelGroups;
            if(!Array.isArray(input)||input.length<1||input.length>104||Reflect.ownKeys(input).length!==input.length+1)return fail();
            const copied:(readonly string[])[]=[];
            for(let index=0;index<input.length;index++){const descriptor=Object.getOwnPropertyDescriptor(input,String(index));if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail();copied.push(labels(descriptor.value,16));}
            if(copied.reduce((total,group)=>total+group.length,0)>104)return fail();
            groups=Object.freeze(copied);
        }
        selection=Object.freeze({...(groups?{actionVariantLabelGroups:groups}:{}),kind:'card-selection',mode:'one',submit:Object.freeze({prefix:label(submit.prefix)}),statusLabels:labels(raw.statusLabels),submitLabels:labels(raw.submitLabels)});
    }
    let tableCollectionIds:readonly string[]|undefined;
    if('tableCollectionIds'in source){
        const input=source.tableCollectionIds;if(!Array.isArray(input)||input.length>128||Reflect.ownKeys(input).length!==input.length+1)return fail();
        const values:string[]=[];for(let i=0;i<input.length;i++){const descriptor=Object.getOwnPropertyDescriptor(input,String(i));if(!descriptor||!('value'in descriptor)||!descriptor.enumerable||typeof descriptor.value!=='string'||!descriptor.value.trim()||descriptor.value.length>2048)return fail();values.push(descriptor.value);}
        if(new Set(values).size!==values.length)return fail();tableCollectionIds=Object.freeze(values.sort());
    }
    const result=Object.freeze({id,schemaVersion:schemaVersion as number,...(selection?{selection}:{}),...(decision?{decision}:{}),...(groups?{groups}:{}),...(tableCollectionIds!==undefined?{tableCollectionIds}:{})});
    if(new TextEncoder().encode(JSON.stringify(result)).byteLength>(groups?GROUP_PHASE_LIMITS.bytes:16384))return fail();
    return result;
}
/** An active descriptor must fit the supplied public domain; never enlarge it from a hand. */
export function validateSelectionPresentation<A>(presentation:PhasePresentation|undefined,doc:TableDocument<A>):void {
    if(presentation?.groups){for(const group of decisionGroups(doc.decision)){const vocabulary=presentation.groups.find(value=>value.id===group.id&&value.kind===group.kind);if(!vocabulary)return fail();if(group.kind==='card-selection'&&vocabulary.kind==='card-selection'){if(group.mode!==vocabulary.mode||group.mode==='count'&&group.count!==vocabulary.count||group.submit.prefix!==vocabulary.submit.prefix)return fail();}}return;}
    const cohort=presentation?.selection,spec=doc.decision;
    if(!cohort||spec.kind!=='card-selection')return;
    if(spec.mode!=='one'||cohort.submit.prefix!==spec.submit.prefix||!['카드 선택 · 0장','카드 선택 · 1장'].every(label=>cohort.statusLabels.includes(label)))return fail();
    if(spec.disambiguation==='choose-action'){
        const groups=new Map<string,string[]>();
        for(const variant of spec.variants){const command=doc.offer.actions.find(command=>command.id===variant.actionId);if(!command)return fail();const key=JSON.stringify([...variant.cardIds].sort());groups.set(key,[...(groups.get(key)??[]),command.label]);}
        for(const labels of groups.values())if(labels.length>1&&!cohort.actionVariantLabelGroups?.some(group=>labels.every(label=>group.includes(label))))return fail();
    }
    for(const variant of spec.variants){const command=doc.offer.actions.find(command=>command.id===variant.actionId);if(!command||!cohort.submitLabels.includes(`${spec.submit.prefix} ${command.label}`))return fail();}
}
export function selectionPresentation(context:ViewContext,presentation:PhasePresentation,groupId?:string):SelectionPresentation|undefined {
    const group=groupId?presentation.groups?.find(group=>group.id===groupId&&group.kind==='card-selection'):undefined,selection=group?.kind==='card-selection'?group:presentation.selection;return selection?Object.freeze({...selection,scopeKey:JSON.stringify([context.session,context.audience,context.generation,groupId??null,presentation])}):undefined;
}


/** The selector is a public collection set, never a card/hand/action reference. */
export function validateTableCollectionSelection(presentation:PhasePresentation|undefined,document:TableDocument<unknown>):void {
 const ids=presentation?.tableCollectionIds;if(ids===undefined)return;
 const registry=new Set<string>();for(const zone of document.collections??[]){const descriptor=Object.getOwnPropertyDescriptor(zone,'id');if(!descriptor||!('value'in descriptor)||typeof descriptor.value!=='string'||!descriptor.value.trim()||registry.has(descriptor.value))return fail();registry.add(descriptor.value);}
 if(ids.some(id=>!registry.has(id)))return fail();
}

/** Exactly the canonical command partition rendered by runtime decisions. */
export function decisionCommandIds<A>(doc:TableDocument<A>):readonly string[]{const reserved=new Set([...(doc.shell?shellCommandActionIds(doc.shell):[]),...(doc.outcome?.continuationActionIds??[])]);return doc.decision.commands.filter(id=>!reserved.has(id));}
/** Resolve only one actual tuple through field-scoped logical keys; never enumerate
 * the public Cartesian domain or synthesize an action/selection from it. */
export function finiteChoiceSubmitCaption(presentation:FiniteChoicePhasePresentation,fields:readonly Pick<ChoiceField,'id'|'options'>[],tuple:ChoiceValues):string|null{
 const captions:string[]=[presentation.submit.prefix];
 for(const id of presentation.submit.fieldIds){const actual=fields.find(field=>field.id===id),domain=presentation.fields.find(field=>field.id===id),value=Object.getOwnPropertyDescriptor(tuple,id);if(!actual||!domain||!value||!('value'in value))return null;const actualOption=actual.options.find(option=>option.id===value.value),option=domain.options.find(option=>option.key===value.value);if(!actualOption||!option||actualOption.label!==phaseChoiceAtomLabel(option.atom))return null;captions.push(phaseChoiceAtomCaption(option.atom));}
 return captions.join(' ');
}
/** Covered labels remain inert even when the current phase offers no choices. */
export function validateDecisionPresentation<A>(presentation:PhasePresentation|undefined,doc:TableDocument<A>):void{
 if(presentation?.groups){
 const roster=new Set([...(doc.participant.role==='observer'||doc.participant.appearance?.vacant?[]:[doc.participant.id]),...(doc.opponents??[]).filter(person=>!person.appearance?.vacant).map(person=>person.id)]);
 for(const group of presentation.groups)if(group.participantIds?.some(id=>!roster.has(id)))return fail();
 for(const spec of decisionGroups(doc.decision)){const group=presentation.groups.find(group=>group.id===spec.id&&group.kind===spec.kind);if(!group||doc.participant.role==='observer'||doc.participant.appearance?.vacant||group.participantIds&&!group.participantIds.includes(doc.participant.id))return fail();if(spec.kind!=='finite-choice'||group.kind!=='finite-choice')continue;if(spec.presentation?.kind!==group.presentation.kind||new Set(spec.fields.map(field=>field.id)).size!==spec.fields.length||spec.fields.some((field,index)=>{const at=group.fields.findIndex(domain=>domain.id===field.id);return at<0||index>0&&at<=group.fields.findIndex(domain=>domain.id===spec.fields[index-1].id);}))return fail();for(const [index,field] of spec.fields.entries()){const domain=group.fields.find(domain=>domain.id===field.id)!,prefixes=new Map<string,Set<string>>();for(const variant of spec.variants){const prefix=JSON.stringify(spec.fields.slice(0,index).map(prior=>variant.tuple[prior.id]));let options=prefixes.get(prefix);if(!options){options=new Set();prefixes.set(prefix,options);}options.add(variant.tuple[field.id]);if(options.size>domain.visibleOptionCapacity)return fail();}const matches=domain.captionDomains.map(compileCaptionDomain);for(const option of field.options)if(!option.caption||!matches.some(match=>match(option.caption!)))return fail();}const submits=group.submitDomains.map(compileCaptionDomain);for(const variant of spec.variants)if(!variant.caption||!submits.some(match=>match(variant.caption!)))return fail();}return;}
 const domain=presentation?.decision;if(!domain)return;
 const spec=doc.decision;if(spec.kind==='card-selection')return fail();
 const actions=new Map(doc.offer.actions.map(action=>[action.id,action]));let auxiliaryIndex=0;
 for(const id of decisionCommandIds(doc)){const action=actions.get(id);if(!action||action.kind!=='command')return fail();const index=domain.auxiliaryLabels.findIndex((label,index)=>index>=auxiliaryIndex&&label===action.label);if(index<0)return fail();auxiliaryIndex=index+1;}
 if(spec.kind!=='finite-choice')return;
 if(spec.presentation?.kind!==domain.presentation.kind||spec.submit.presentationLabel?.prefix!==domain.submit.prefix||spec.fields.length!==domain.fields.length||spec.variants.length*domain.fields.length>PHASE_DECISION_LIMITS.variantFieldWork)return fail();
 const captionFields=new Map<string,Map<string,string>>();
 for(let i=0;i<domain.fields.length;i++){const expected=domain.fields[i],actual=spec.fields[i];if(actual.id!==expected.id||actual.label!==expected.label||actual.catalogue!==undefined||actual.options.length>expected.options.length)return fail();let prior=-1;const captions=new Map<string,string>();for(const option of actual.options){const index=expected.options.findIndex(value=>value.key===option.id);if(index<=prior||index<0||option.label!==phaseChoiceAtomLabel(expected.options[index].atom)||option.visual!==undefined||option.emphasis!==undefined||option.description!==undefined)return fail();prior=index;captions.set(option.id,phaseChoiceAtomCaption(expected.options[index].atom));}captionFields.set(expected.id,captions);}
 for(const variant of spec.variants){const action=actions.get(variant.actionId),parts=domain.submit.fieldIds.map(id=>captionFields.get(id)?.get(variant.tuple[id]));if(!action||action.kind!=='command'||parts.some(part=>part===undefined)||[domain.submit.prefix,...parts].join(' ')!==`${domain.submit.prefix} ${action.label}`)return fail();}
}
export function decisionPresentation(context:ViewContext,presentation:PhasePresentation):DecisionPresentation|undefined{return presentation.decision?Object.freeze({...presentation.decision,scopeKey:JSON.stringify([context.session,context.audience,context.generation,presentation])}):undefined;}

/** A field-scoped logical key returns only an inert public atom, not a route. */
export function phaseChoiceOptionAtom(presentation:FiniteChoicePhasePresentation,fieldId:string,key:string):PhaseChoiceAtom|undefined{return presentation.fields.find(field=>field.id===fieldId)?.options.find(option=>option.key===key)?.atom;}

function ownGroupPresentation(input:unknown):GroupPhasePresentation{
 const head=record(input,['id','kind'],['presentation','fields','submitDomains','mode','count','submit','statusLabels','submitLabels','actionVariantLabelGroups','participantIds']);
 const ids=head.participantIds===undefined?undefined:sequence(head.participantIds,9,1,label);if(ids&&new Set(ids).size!==ids.length)return fail();const scope=ids?{participantIds:ids}:{};
 if(head.kind==='finite-choice'){const raw=record(input,['id','kind','presentation','fields','submitDomains'],['participantIds']),fields=sequence(raw.fields,GROUP_PHASE_LIMITS.fields,1,value=>{const field=record(value,['id','visibleOptionCapacity','captionDomains']);if(!Number.isSafeInteger(field.visibleOptionCapacity)||Number(field.visibleOptionCapacity)<1||Number(field.visibleOptionCapacity)>DECISION_DESCRIPTOR_LIMITS.options)return fail();return Object.freeze({id:label(field.id),visibleOptionCapacity:Number(field.visibleOptionCapacity),captionDomains:sequence(field.captionDomains,GROUP_PHASE_LIMITS.domains,1,ownCaptionDomain)});});if(new Set(fields.map(field=>field.id)).size!==fields.length||fields.reduce((sum,field)=>sum+field.visibleOptionCapacity,0)>DECISION_DESCRIPTOR_LIMITS.options)return fail();const result=Object.freeze({...scope,id:label(raw.id),kind:'finite-choice' as const,presentation:ownFiniteChoicePresentation(raw.presentation),fields,submitDomains:sequence(raw.submitDomains,GROUP_PHASE_LIMITS.domains,1,ownCaptionDomain)});const atoms=[...fields.flatMap(field=>field.captionDomains),...result.submitDomains].flatMap(domain=>domain.parts.flat());if(new Set(atoms.map(atom=>JSON.stringify(atom))).size>GROUP_PHASE_LIMITS.distinctAtoms)return fail();return result;}
 if(head.kind==='card-selection'){const raw=record(input,['id','kind','mode','submit','statusLabels','submitLabels'],['count','actionVariantLabelGroups','participantIds']),submit=record(raw.submit,['prefix']);if(!['one','many','count'].includes(String(raw.mode))||raw.mode==='count'&&(!Number.isInteger(raw.count)||Number(raw.count)<1||Number(raw.count)>MAX_COMMAND_BATCH)||raw.mode!=='count'&&raw.count!==undefined)return fail();return Object.freeze({...scope,id:label(raw.id),kind:'card-selection',mode:raw.mode as CardGroupPresentation['mode'],...(raw.count!==undefined?{count:Number(raw.count)}:{}),submit:Object.freeze({prefix:label(submit.prefix)}),statusLabels:labels(raw.statusLabels),submitLabels:labels(raw.submitLabels),...(raw.actionVariantLabelGroups?{actionVariantLabelGroups:sequence(raw.actionVariantLabelGroups,104,1,value=>labels(value,16))}:{})});}
 return fail();
}
export function groupPresentation(presentation:PhasePresentation|undefined,groupId:string):GroupPhasePresentation|undefined{return presentation?.groups?.find(group=>group.id===groupId);}

/** Public applicability is independent of executable offers and display names. */
export function applicableGroupPresentations(doc:TableDocument<unknown>):readonly GroupPhasePresentation[]{return doc.participant.role==='observer'||doc.participant.appearance?.vacant?Object.freeze([]):Object.freeze((doc.presentation?.groups??[]).filter(group=>!group.participantIds||group.participantIds.includes(doc.participant.id)));}
