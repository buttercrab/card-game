import {layoutControlCluster,measureControlCluster,type ControlClusterInput,type ControlClusterPlan,type ControlClusterMeasurement} from '../controlClusterLayout';
import {layoutDecision} from '../decisionLayout';
import {controlClusterPaintMetrics} from '../controlClusterPaintMetrics';
import {canonicalFiniteClusterTargets} from './finiteClusterTargets';
import {calculateReadableHandLayout,calculateHandRowMetrics,HAND_SELECTION_PADDING} from '../handLayout';
import {canonicalOwnHandFanSteps,type HandGeometryEnvironment} from './ownHandGeometry';
import {informationAtomRole} from './informationTypography';
import {captionLabel} from '../decisionModel';
import {layoutHudStack} from './hudPolicy';
import {publicSceneEnvelope,PublicSceneUnavailable} from './publicSceneEnvelope';
import {nativeCardCaptionDomain} from './nativeCardPresentation';
import {decisionGroupNamespace} from './decisions';
import {cardDecision,finiteDecision,normalizeDecision} from '../decisionCore';
import {composeSideDockRow,registerOwnDockReceiveCandidate} from './ownDockReceive';
import {participantCaptionRecipe,measureParticipantCaption} from './participantCaption';
import {dockIdentityRow,calculateDockRegions} from './dockPolicy';
import {validateJointDecisionLayers} from './jointDecisionValidation';
import {readonlyInformationContent} from './informationControl';
import {jointDecisionCorridor} from './jointDecisionLayout';
import {measureInlineCaption,paintInlineCaption,measureCaptionDomain,type InlineCaptionAtom} from './inlineCaption';
import {phaseChoiceAtomLabel,type FiniteChoicePhasePresentation} from './presentationCohort';
import {calculateMeasuredFrameLayout} from './framePolicy';
import {allocateRing} from './ringAllocation';
import {figurePaintAdmission,figurePaintBounds} from './figureArtworkMetrics';
import {isPublicCompletionView,readPublicGameplayPresentation} from './publicCompletion';
import {publicPaintResources} from './paintResources';
import {visibleCollectionDocument} from './visibleCollections';
import {REGULAR_TRICK} from './directionalTrickLayout';
import {minimumHandViewport,compactIdentityWidths} from './compactDockAllocation';
import {chooseTableStack} from './activeTableAllocation';
import {allocateCompactPeerRow} from './compactPeerRow';
import {allocateCompactPublicPair} from './compactPublicAllocation';
import {shortLandscapePresentation,composeShortLandscape} from './shortLandscapeLayout';
import {allocateParticipantIdentity,composeParticipantIdentity,participantIdentityWidth,participantFigureMinimumWidth} from './participantIdentityLayout';
import {MEASUREMENT_BATCH_LIMIT} from './measurementLimits';
import {headerPassiveSlot} from './headerPassiveSlot';
import {createOutcomeOverviewLayout} from './outcomeOverviewLayout';
import {validateReadonlyMatrixViewports} from './readonlyMatrixViewport';
import {validatePrimaryViewport} from './primaryViewport';
import {chooseObserverReactionPlacement} from './observerReactionLayout';
import {validateObserverReactionLayers} from './observerReactionValidation';
import {PEER_FIGURE_SIZE,LOCAL_FIGURE_SIZE,PEER_NAME_ROLE,regularParticipantRegion,regularParticipantColumns,localParticipantPresentation} from './participantPresentation';
import {choosePublicDisclosurePlacement} from './publicDisclosureLayout';
import {createWaitingLayout} from './waitingLayout';
import {nativeTextControlHeight} from './nativeTextControl';
import {createDisclosureDialog} from './disclosureLayout';
import type {DisclosureDocument} from './disclosureTypes';
import type {DisclosureView} from './disclosureView';
import type {FormField,FormView,FormValue,TextFormField} from './forms';
import type {PreferenceField,RoomShellAction,RoomShellPage} from './roomShell';
import {sameRoomSubject} from './roomShell';
import { numericComposition, type CompositionKernel } from './composition';
import { SELECTION_LIFT } from './selectionMotion';
import type { InformationAtom, InformationValue, InformationPanel, CandidateLayout, CardCollection, TableCard, OpponentView, Environment, LayoutResult, MeasureRequest, PlannedNode, Planner, Size, Rect, PresentationFrame, TableDocument, TextRole, ChoiceView, ParticipantStatus } from './contracts';
const DENSE_CAPTURED_BINDINGS:readonly(keyof PlannedNode)[]=['cardActionPickerIntent','cardActionOptionId','catalogueIntent','choiceLeaseId','cardId','inspectCardId','actionId','fieldId','optionId','localIntent','shellActionId','shellIntent','formIntent','formField','formNavigation','editor','preference','assistanceIntent','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','feedbackDismissId','formActionId','formLeaseId','inspectionPreviewFor','recycleAnchor','recycleCaption','publicDisclosureEventId','clockPaint','figureCue','ownHandAnchor','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor','stockCount','recipientId','recipientCount','enabled','checked','role','semanticRole'];

function denseCapturedFace(value:PlannedNode['visual']):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=Reflect.ownKeys(value);if(keys.length>3||keys.some(key=>typeof key!=='string'))return false;
 const fields:Record<string,unknown>=Object.create(null);for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return false;fields[key as string]=descriptor.value;}
 return fields.kind==='standard'&&keys.length===3&&keys.every(key=>['kind','suit','rank'].includes(key as string))&&['Spade','Heart','Diamond','Club'].includes(fields.suit as string)&&typeof fields.rank==='number'&&Number.isInteger(fields.rank)&&fields.rank>=2&&fields.rank<=14||fields.kind==='joker'&&keys.length===2&&keys.every(key=>['kind','color'].includes(key as string))&&['Black','Red'].includes(fields.color as string);
}
type ParticipantLookup=Pick<TableDocument<unknown>,'participant'|'opponents'>;
/** Ephemeral renderer data: current public lookup plus inert HUD values only. */
type HudReadContext=Pick<TableDocument<unknown>,'participant'|'opponents'|'information'|'scoreboard'|'facts'|'statusPresentation'|'stage'>&{readonly outcome?:Pick<NonNullable<TableDocument<unknown>['outcome']>,'informationId'>;readonly suppressSummaryInk?:true};
const EMPTY_CARD_LABEL='카드 없음';
const GAP = 12;
const SMALL_GAP = 8;
const PADDING = 16;
const DOCK_PADDING = 8;
const TARGET = 44;
const CARD_WIDTH = 88;
const CARD_HEIGHT = 124;
const EXPOSED = 28;
export const FORM_SUMMARY_PAGE_SIZE=8;
const formFieldSection=(view:FormView,id:string)=>view.offer.fields.find(field=>field.id===id)?.sectionId??view.offer.clusters?.find(cluster=>cluster.fieldIds.includes(id))?.sectionId;
export function presentedFormFields(view:FormView):readonly FormField[]{
    const section=view.activeSection??view.offer.sections?.[0]?.id;
    return view.offer.fields.filter(field=>view.reduction?.visibility[field.id]!==false&&(!section||!formFieldSection(view,field.id)||formFieldSection(view,field.id)===section));
}
export interface FormSummaryItem {readonly id:string;readonly text:string;readonly fieldId?:string;readonly sectionId?:string;}
export function formSummaryItems(view:FormView):readonly FormSummaryItem[]{
    const result:FormSummaryItem[]=[],seen=new Set<string>();
    const append=(item:FormSummaryItem)=>{const signature=JSON.stringify([item.text,item.fieldId??null,item.sectionId??null]);if(!seen.has(signature)){seen.add(signature);result.push(item);}};
    const linked=(id:string,text:string,field:FormField):FormSummaryItem=>({id,text,fieldId:field.id,...(formFieldSection(view,field.id)?{sectionId:formFieldSection(view,field.id)}:{})});
    for(const field of view.offer.fields){const issue=view.issues[field.id];if(issue)append(linked(`issue:${field.id}`,`${field.label} · ${issue}`,field));}
    const changed=new Set(view.reduction?.changedFields??[]),rows=new Set<string>();
    for(const id of changed){
        const field=view.offer.fields.find(field=>field.id===id);if(!field||view.issues[id])continue;
        const row=view.offer.rows?.find(row=>row.fieldIds.includes(id));
        if(!row){append(linked(`changed:${id}`,`변경 · ${field.label}`,field));continue;}
        if(rows.has(row.id))continue;rows.add(row.id);
        const members=row.fieldIds.flatMap(id=>{const member=view.offer.fields.find(field=>field.id===id);return member&&changed.has(id)&&!view.issues[id]?[member]:[];});
        const editable=members.filter(member=>view.reduction?.visibility[member.id]!==false&&view.reduction?.enabled[member.id]!==false);
        const candidates=editable.length?editable:members;
        const target=candidates.find(member=>['number','text','multiline'].includes(member.kind))??candidates.find(member=>member.kind==='select')??candidates[0];
        if(target)append(linked(`changed-row:${row.id}`,`변경 · ${row.label}`,target));
    }
    for(const [index,entry] of (view.reduction?.summary??[]).entries()){
        const field=view.offer.fields.find(field=>entry.fieldIds?.includes(field.id));
        append(field?linked(`summary:${index}`,entry.text,field):{id:`summary:${index}`,text:entry.text});
    }
    return result;
}
function numericFormValue(field:TextFormField,value:FormValue|undefined):number|null{
    if(typeof value!=='string'||!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)||!Number.isFinite(Number(value)))return null;
    const number=Number(value),{min,max,step}=field;
    if(min===undefined||max===undefined||step===undefined||number<min||number>max||Math.abs((number-min)/step-Math.round((number-min)/step))>1e-7)return null;
    return number;
}
/** The probe and painter use precisely the same engine-owned metric recipe. */
export function typography(role: TextRole, environment: Environment): {
    fontSize: number;
    lineHeight: number;
    fontWeight: number;
} {
    if (role === 'button' || role === 'choice') {
        const metric = environment.controls[role === 'choice' ? 'choice' : 'command'];
        return { fontSize: metric.fontSize * environment.textScale, lineHeight: metric.lineHeight * environment.textScale, fontWeight: metric.fontWeight };
    }
    if(role==='announcement'){const {fontSize,lineHeight,fontWeight}=participantCaptionRecipe(environment.textScale);return {fontSize,lineHeight,fontWeight};}
    if(role==='select')return {fontSize:Math.max(16,16*environment.textScale),lineHeight:Math.max(24,24*environment.textScale),fontWeight:400};
    if(role==='compact-display')return {fontSize:20*environment.textScale,lineHeight:28*environment.textScale,fontWeight:700};
    if(role==='information-number')return {fontSize:38*environment.textScale,lineHeight:38*environment.textScale,fontWeight:800};
    if(role==='information-token')return {fontSize:18*environment.textScale,lineHeight:18*1.45*environment.textScale,fontWeight:800};
    if(role==='information-prose')return {fontSize:13*environment.textScale,lineHeight:13*1.35*environment.textScale,fontWeight:400};
    if(role==='display')return {fontSize:44*environment.textScale,lineHeight:52*environment.textScale,fontWeight:800};
    if(role==='art')return {fontSize:22,lineHeight:24,fontWeight:800};
    const recipe = { 'participant-name':[16,24,600], body: [16, 24, 400], name: [18, 26, 700], small: [14, 20, 400], button: [16, 22, 700] }[role];
    return { fontSize: recipe[0] * environment.textScale, lineHeight: recipe[1] * environment.textScale, fontWeight: recipe[2] };
}
export function measureKey(text: string, role: TextRole, width: number | null, environment: Environment): string {
    return JSON.stringify(['foundation-text-v2', text, role, width, environment.fontRevision, environment.fontFamily, environment.artFontFamily, environment.textScale, environment.controls]);
}
/** One synchronous candidate captures one metric namespace. Never memoize an
 * externally mutable environment across candidates or retain it in a global cache.
 */
export function createCandidateMeasureKey(environment: Environment): (text:string,role:TextRole,width:number|null)=>string {
    const suffix=JSON.stringify([environment.fontRevision,environment.fontFamily,environment.artFontFamily,environment.textScale,environment.controls]).slice(1);
    return (text,role,width)=>`${JSON.stringify(['foundation-text-v2',text,role,width]).slice(0,-1)},${suffix}`;
}
const collectionLabel = (zone: CardCollection) => zone.hiddenCount === undefined ? zone.label : `${zone.label} · ${zone.hiddenCount}장`;
const key = (...parts: string[]) => JSON.stringify(parts);
interface Fragment {
    readonly primaryCardBand?:Rect;
    readonly capturedCardBand?:Rect;
    /** Engine-owned priority footprint; auxiliary history may scroll beyond it. */
    readonly requiredVisibleHeight?:number;
    readonly sceneContentHeight?:number;
    readonly sceneCenterY?:number;
    readonly width: number;
    readonly height: number;
    readonly nodes: readonly PlannedNode[];
}
function leaf(node: PlannedNode): Fragment { return { width: node.box.width, height: node.box.height, nodes: [node] }; }
function group(id: string, width: number, height: number, placements: readonly {
    fragment: Fragment;
    x: number;
    y: number;
}[], extra: Partial<PlannedNode> = {}): Fragment {
    const nodes: PlannedNode[] = [{ id, parent: null, kind: 'group', label: '', arrangement: 'ordinary', ...extra, box: { x: 0, y: 0, width, height } }];
    for (const { fragment, x, y } of placements) {
        const root = fragment.nodes[0];
        nodes.push({ ...root, parent: id, box: { ...root.box, x, y } }, ...fragment.nodes.slice(1));
    }
    return { width, height, nodes };
}
const handValidationEnvironments=new WeakMap<CandidateLayout,Environment>();
export function createPlanner(kernel: CompositionKernel): Planner {
    function column(id: string, width: number, children: readonly Fragment[], gap = GAP, padding = 0): Fragment {
        const plan = kernel.column(width, children, gap, padding);
        return group(id, width, plan.height, children.map((fragment,index) => ({ fragment, ...plan.placements[index] })));
    }
    /** Direct measured flow children keep unrelated card ancestors independent of scroll content height. */
    function scrollColumn(id:string,width:number,height:number,children:readonly Fragment[],gutter:number,label:string):Fragment {
        let y=0;
        return group(id,width,height,children.map(fragment=>{const placement={fragment,x:0,y};y+=fragment.height+GAP;return placement;}),{scroll:true,scrollAxis:'y',scrollbarGutter:gutter,semanticRole:'group',label});
    }
    function rows(id: string, width: number, children: readonly Fragment[], extra: Partial<PlannedNode> = {}, align: 'start' | 'center' = 'start',gap=SMALL_GAP): Fragment {
        const plan = kernel.rows(width, children, gap, align);
        return group(id, width, plan.height, children.map((fragment,index) => ({ fragment, ...plan.placements[index] })), extra);
    }
    class Measurements {
        readonly missing = new Map<string, MeasureRequest>();
        // Validated scalar snapshots live only for this synchronous candidate.
        readonly naturalValues=new Map<TextRole,Map<string,Size>>();
        readonly key:ReturnType<typeof createCandidateMeasureKey>;
        constructor(readonly environment: Environment, readonly values: ReadonlyMap<string, Size>) { this.key=createCandidateMeasureKey(environment); }
        get(text: string, role: TextRole, width: number | null, metricKey=this.key(text,role,width)): Size | undefined {
            const value = this.values.get(metricKey);
            if (value) {
                if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width < 0 || value.height <= 0 || (width !== null && value.width > width + 0.5))
                    throw new Error(`Invalid text metric: ${metricKey}`);
                return value;
            }
            const request = { key: metricKey, text, role, width, environment: this.environment };
            this.missing.set(request.key, request);
            return undefined;
        }
        natural(text:string,role:TextRole,metricKey?:string):Size|undefined{
            const cached=this.naturalValues.get(role)?.get(text);if(cached)return cached;
            const measured=this.get(text,role,null,metricKey);if(!measured)return undefined;
            const width=measured.width,height=measured.height;if(!Number.isFinite(width)||!Number.isFinite(height)||width<0||height<=0)throw Error('Invalid intrinsic text metric');
            const owned=Object.freeze({width,height});let values=this.naturalValues.get(role);if(!values){values=new Map();this.naturalValues.set(role,values);}values.set(text,owned);return owned;
        }
        intrinsic(text: string, role: TextRole): Size {
            // Provisional values exist only inside a discarded candidate. They are never a ready layout.
            return this.natural(text, role) ?? { width: 0, height: typography(role, this.environment).lineHeight };
        }
        exact(text: string, role: TextRole, width: number): Size {
            // Identical font/role/whitespace recipes cannot wrap when the
            // measured intrinsic width already fits. Reuse that real host
            // metric instead of caching a second width-keyed copy of every
            // finite action label. Width-constrained overflowing text still
            // requires its own exact host measurement.
            let natural=this.naturalValues.get(role)?.get(text);
            if(!natural){const naturalKey=this.key(text,role,null);if(this.values.has(naturalKey))natural=this.natural(text,role,naturalKey);}
            if(natural&&Number.isFinite(width)&&natural.width<=width)return natural;
            return this.get(text, role, width) ?? { width, height: typography(role, this.environment).lineHeight };
        }
    }
    function textNode(id: string, text: string, role: TextRole, width: number, metrics: Measurements): Fragment {
        const measured = metrics.exact(text, role, width);
        return leaf({ id, parent: null, kind: 'text', label: text, role, box: { x: 0, y: 0, width, height: measured.height } });
    }
    function button(id: string, label: string, width: number, metrics: Measurements, extra: Partial<PlannedNode>, reserveLabels: readonly string[] = [], sizing:'content'|'prominent'='prominent',caption?:{atoms:readonly InlineCaptionAtom[];mode:'choice'|'inline';reserve?:Size}): Fragment {
        const role = extra.kind === 'choice' ? 'choice' : 'button';
        const metric = metrics.environment.controls[role === 'choice' ? 'choice' : 'command'];
        const labels = [label, ...reserveLabels];
        const inline=caption?measureInlineCaption(caption.atoms,{mode:caption.mode,fontSize:typography(role,metrics.environment).fontSize,textScale:metrics.environment.textScale,text:value=>metrics.intrinsic(value,role)}):null;
        const natural = Math.max(sizing==='prominent'&&extra.intent==='primary'?176*metrics.environment.textScale:0,(inline?Math.max(inline.width,caption?.reserve?.width??0):Math.max(...labels.map(value=>metrics.intrinsic(value, role).width))) + metric.paddingX * 2);
        // Reserve both native hit-target expansion and the shared selection pulse.
        const insetX = Math.max(3, Math.min(width, natural) * (metric.pulse - 1) / 2 + 3);
        const allocation = Math.min(width - insetX * 2, Math.max(TARGET, natural));
        const height = Math.max(TARGET, metric.minHeight, ...(inline?[Math.max(inline.height,caption?.reserve?.height??0)+metric.paddingY*2]:labels.map(value=>metrics.exact(value, role, allocation - metric.paddingX * 2).height + metric.paddingY * 2)));
        const insetY = Math.max(6, height * (metric.pulse - 1) / 2 + 5);
        const control = leaf({ id, parent: null, kind: 'command', label, role, ...extra,
            box: { x: 0, y: 0, width: allocation, height } });
        let painted=control;
        if(inline){const paint=paintInlineCaption(key(id,'caption'),inline,{group,text:(id,label,width,height)=>leaf({id,parent:null,kind:'text',label,role,box:{x:0,y:0,width,height}}),suit:(id,suit,label,width,height)=>leaf({id,parent:null,kind:'suit',suit,label,box:{x:0,y:0,width,height}})});painted={...control,nodes:[{...control.nodes[0],paintChildren:true},...paint.nodes.slice(1).map(node=>({...node,parent:id,box:{...node.box,x:node.box.x+(allocation-inline.width)/2,y:node.box.y+(height-inline.height)/2}}))]};}
        return group(key('control-envelope', id), allocation + insetX * 2, height + insetY * 2,
            [{ fragment: painted, x: insetX, y: insetY }]);
    }
    function iconButton(id:string,label:string,icon:NonNullable<PlannedNode['shellIcon']>,metrics:Measurements,extra:Partial<PlannedNode>,compactArtwork=false):Fragment{
        const iconSize=24*(compactArtwork?1:Math.max(1,metrics.environment.textScale)),size=Math.max(TARGET,iconSize+16);
        const art=leaf({id:key(id,'icon'),parent:null,kind:'icon',shellIcon:icon,label:'',box:{x:0,y:0,width:iconSize,height:iconSize}});
        const control=group(id,size,size,[{fragment:art,x:(size-iconSize)/2,y:(size-iconSize)/2}],{kind:'command',paintChildren:true,label,role:'button',...extra});
        return group(key('control-envelope',id),size+12,size+12,[{fragment:control,x:6,y:6}]);
    }
    function participantFigureCue(participantId:string,choices?:ChoiceView):Pick<PlannedNode,'figureCue'>{
        const cue=choices?.feedback?.cues.filter(cue=>cue.participantId===participantId).at(-1);
        return cue?{figureCue:{id:cue.id,...(cue.cue?{kind:cue.cue}:{})}}:{};
    }
    function participantMetaWidth(status:ParticipantStatus|undefined,markers:readonly string[],document:ParticipantLookup|undefined,metrics:Measurements):number{
        const widths:number[]=[];
        if(status?.purpose==='standing'&&document){
            const atoms=status.value.kind==='inline'?status.value.values:[status.value];
            widths.push(atoms.reduce((sum,atom)=>sum+(atom.kind==='suit'?32*metrics.environment.textScale:atom.kind==='card'?24*metrics.environment.textScale:metrics.intrinsic(informationText(document,atom),'small').width),0)+SMALL_GAP*Math.max(0,atoms.length-1)+8);
            widths.push(...(status.badges??[]).map(badge=>metrics.intrinsic(badge.text,'small').width+8));
        }
        widths.push(...markers.map(label=>metrics.intrinsic(label,'small').width+8));
        return widths.reduce((sum,width)=>sum+width,0)+4*Math.max(0,widths.length-1);
    }
    function participantStanding(participantId:string,width:number,metrics:Measurements,status:ParticipantStatus|undefined,document:ParticipantLookup|undefined):Fragment[]{
        if(!status||status.purpose!=='standing'||!document)return [];
        const value=status.value,atoms=value.kind==='inline'?value.values:[value],natural=atoms.reduce((sum,atom)=>sum+(atom.kind==='suit'?32*metrics.environment.textScale:atom.kind==='card'?24*metrics.environment.textScale:metrics.intrinsic(informationText(document,atom),'small').width),0)+SMALL_GAP*Math.max(0,atoms.length-1),allocation=Math.min(width,natural+8),paint=valueFragment(document,value,key('participant-status-value',participantId),Math.max(1,allocation-8),metrics,false,'small'),team=participant(document,participantId)?.appearance?.team;
        const role=group(key('participant-status',participantId),allocation,paint.height,[{fragment:paint,x:4,y:0}],{participantStatusFor:participantId,decoration:'pill',tone:status.tone,semanticRole:'status',label:'참가자 상태',...(team?{appearance:{team}}:{})});
        return [role,...(status.badges??[]).map((badge,index)=>{const id=key('participant-status-badge',participantId,String(index)),allocation=Math.min(width,metrics.intrinsic(badge.text,'small').width+8),paint=textNode(key('participant-status-badge-text',participantId,String(index)),badge.text,'small',Math.max(1,allocation-8),metrics);return group(id,allocation,paint.height,[{fragment:paint,x:4,y:0}],{participantStatusFor:participantId,decoration:'pill',tone:badge.tone,semanticRole:'status',label:badge.text});})];
    }
    function participantSignals(participantId:string,width:number,metrics:Measurements,choices?:ChoiceView,reserve=!!(choices?.assistance||choices?.feedback),status?:ParticipantStatus,document?:HudReadContext,compactSignal=false,retainAllocation=false):Fragment[]{
        if(status?.purpose==='standing')status=undefined;
        reserve=reserve||retainAllocation||!!status||!!document&&!document.outcome&&document.stage!=='waiting';
        // A typed announcement has one measurement/paint owner. Standing
        // metadata and reactions deliberately keep their separate recipes.
        const announcement=(available:number):Fragment=>{
            if(!status||!document)throw Error('Missing participant announcement');
            const atoms=status.value.kind==='inline'?status.value.values:[status.value],typed:InlineCaptionAtom[]=[];
            for(const atom of atoms){
                if(atom.kind==='card')break;
                typed.push(atom.kind==='suit'?{kind:'suit',suit:atom.suit,label:atom.label}:atom.kind==='number'?{kind:'number',value:atom.value}:{kind:'text',text:informationText(document,atom)});
            }
            const id=key('participant-status-value',participantId),team=participant(document,participantId)?.appearance?.team;
            let value:Fragment,allocation:number,height:number,insetX:number,insetY:number;
            if(typed.length===atoms.length){
                const plan=measureParticipantCaption(typed,available,metrics.environment.textScale,(text,width)=>width===null?metrics.intrinsic(text,'announcement'):metrics.exact(text,'announcement',width));
                value=paintInlineCaption(id,plan.content,{group,text:(id,label,width,height)=>leaf({id,parent:null,kind:'text',label,role:'announcement',box:{x:0,y:0,width,height}}),suit:(id,suit,label,width,height)=>leaf({id,parent:null,kind:'suit',suit,label,role:'announcement',box:{x:0,y:0,width,height}})});
                allocation=plan.width;height=plan.height;insetX=plan.insetX;insetY=plan.insetY;
            }else{
                // Card-valued public facts keep their existing physical-art
                // recipe; do not stringify artwork into a text caption.
                const natural=atoms.reduce((sum,atom)=>sum+(atom.kind==='suit'?32*metrics.environment.textScale:atom.kind==='card'?24*metrics.environment.textScale:metrics.intrinsic(informationText(document,atom),'announcement').width),0)+SMALL_GAP*Math.max(0,atoms.length-1);
                allocation=Math.min(available,natural+8);value=valueFragment(document,status.value,id,Math.max(1,allocation-8),metrics,false,'announcement');height=value.height+8;insetX=4;insetY=4;
            }
            return group(key('participant-status',participantId),allocation,height,[{fragment:value,x:insetX,y:insetY}],{participantStatusFor:participantId,tone:status.tone,decoration:'pill',semanticRole:'status',label:'참가자 상태',...(team?{appearance:{team}}:{})});
        };
        const persistentLabel=status?.value.kind==='text'?status.value.text:undefined;
        const records=[...(choices?.assistance?.projection.reactions.filter(reaction=>reaction.participantId===participantId).map(reaction=>({id:`reaction:${reaction.eventId}`,text:reaction.text}))??[]),...(choices?.feedback?.cues.filter(cue=>cue.participantId===participantId&&cue.label).map(cue=>({id:`cue:${cue.id}`,text:cue.label!}))??[])].filter(record=>record.text!==persistentLabel);
        if(document?.outcome&&!retainAllocation){
            const children:Fragment[]=[];
            if(status){const padding=4;children.push(announcement(width));
                for(const [index,badge] of (status.badges??[]).entries()){const allocation=Math.min(width,metrics.intrinsic(badge.text,'small').width+padding*2),text=textNode(key('participant-status-badge-text',participantId,String(index)),badge.text,'small',Math.max(1,allocation-padding*2),metrics);children.push(group(key('participant-status-badge',participantId,String(index)),allocation,text.height+padding*2,[{fragment:text,x:padding,y:padding}],{decoration:'pill',tone:badge.tone,semanticRole:'status',label:badge.text}));}
            }
            for(const record of records){const allocation=Math.min(width,metrics.intrinsic(record.text,'small').width+8),text=textNode(key('participant-signal-text',record.id),record.text,'small',Math.max(1,allocation-8),metrics);children.push(group(key('participant-signal',record.id),allocation,text.height+8,[{fragment:text,x:4,y:4}],{decoration:'callout',semanticRole:'status',label:record.text}));}
            return children.length?[rows(key('participant-signals',participantId),width,children,{semanticRole:'group',label:'참가자 알림'},'center')]:[];
        }
        const gutter=reserve?(metrics.environment.scrollbarWidth??0):0,innerWidth=width-gutter;
        const children=records.map(record=>{const padding=compactSignal?4:SMALL_GAP,text=textNode(key('participant-signal-text',record.id),record.text,'small',Math.max(1,innerWidth-padding*2),metrics);return group(key('participant-signal',record.id),innerWidth,text.height+padding*2,[{fragment:text,x:padding,y:padding}],{decoration:'callout',semanticRole:'status' as const,label:record.text});});
        let persistentHeight=0;
        if(status&&document){
            const padding=4,role=announcement(innerWidth);
            const badgeFragments=(status.badges??[]).map((badge,index)=>{const id=key('participant-status-badge',participantId,String(index)),allocation=Math.min(innerWidth,metrics.intrinsic(badge.text,'small').width+padding*2),text=textNode(key('participant-status-badge-text',participantId,String(index)),badge.text,'small',Math.max(1,allocation-padding*2),metrics);return group(id,allocation,text.height+padding*2,[{fragment:text,x:padding,y:padding}],{decoration:'pill',tone:badge.tone,semanticRole:'status',label:badge.text});});
            const fragments=[role,...badgeFragments],plan=kernel.rows(innerWidth,fragments,4,compactSignal?'start':'center'),caption=group(key('participant-status-caption',participantId),innerWidth,plan.height,fragments.map((fragment,index)=>({fragment,...plan.placements[index]})),{semanticRole:'group',label:'참가자 상태'});
            persistentHeight=caption.height;children.unshift(caption);
        }
        if(!reserve)return children;
        const content=compactSignal?rows(key('participant-signals-content',participantId),innerWidth,children,{},'start'):column(key('participant-signals-content',participantId),innerWidth,children,SMALL_GAP);
        const short=!document?.outcome&&document?.stage!=='waiting'?shortLandscapePresentation(metrics.environment):null;
        const reservedHeight=Math.max(short?.feedbackHeight??28,metrics.intrinsic('Ag','small').height+SMALL_GAP);
        const height=reservedHeight;
        return [group(key('participant-signals',participantId),width,height,[{fragment:content,x:0,y:0}],{...(content.height>height?{scroll:true,scrollAxis:'y',scrollbarGutter:gutter}:{}),semanticRole:'group',label:'참가자 알림',participantFeedbackFor:participantId})];
    }
    function observerSignals<A>(document:TableDocument<A>,width:number,metrics:Measurements,choices:ChoiceView):Fragment|null {
        const anchored=new Set([...(document.opponents??[]).map(person=>person.id),...(document.participant.role==='observer'?[]:[document.participant.id])]);
        const ids=new Set([...(choices.assistance?.projection.reactions??[]).map(reaction=>reaction.participantId),...(choices.feedback?.cues??[]).filter(cue=>cue.label).map(cue=>cue.participantId)].filter(id=>!anchored.has(id)));
        const bubbles:Fragment[]=[];
        for(const id of ids){const name=document.shell?.pages.flatMap(page=>page.people??[]).find(person=>person.id===id)?.name??'관전자',nameWidth=Math.min(width*.45,Math.max(1,metrics.intrinsic(name,'small').width)),label=textNode(key('observer-name',id),name,'small',nameWidth,metrics),recordTexts=[...(choices.assistance?.projection.reactions??[]).filter(record=>record.participantId===id).map(record=>record.text),...(choices.feedback?.cues??[]).filter(record=>record.participantId===id&&record.label).map(record=>record.label!)],bubbleWidth=Math.max(1,Math.min(width-nameWidth-SMALL_GAP,Math.max(TARGET,...recordTexts.map(text=>metrics.intrinsic(text,'small').width+SMALL_GAP*2)))),signals=participantSignals(id,bubbleWidth,metrics,choices,false);
            const content=column(key('observer-reactions',id),bubbleWidth,signals,4),height=Math.max(label.height,content.height);bubbles.push(group(key('observer-signal',id),nameWidth+SMALL_GAP+bubbleWidth,height,[{fragment:label,x:0,y:(height-label.height)/2},{fragment:content,x:nameWidth+SMALL_GAP,y:0}],{semanticRole:'group',label:'관전자 반응'}));}
        return bubbles.length?rows('observer-signals',width,bubbles):null;
    }
    function assistanceTools(width:number,metrics:Measurements,choices:ChoiceView,shrink=false,compactArtwork=false):Fragment|null {
        const view=choices.assistance;
        const controls=(view?.projection.tools??[]).map(tool=>{
            if(tool.kind==='request-advice')return iconButton(key('assistance-tool',tool.id),tool.label,'hint',metrics,{assistanceIntent:{kind:'tool',toolId:tool.id},enabled:tool.enabled,checked:view?.adviceOpen,intent:'quiet'},compactArtwork);
            return iconButton(key('assistance-tool',tool.id),tool.label,'smile',metrics,{enabled:tool.enabled,checked:view?.reactionsOpen,assistanceIntent:{kind:'toggle-reactions'},intent:'secondary',decoration:'pill'},compactArtwork);
        });
        if(!controls.length)return null;const fragment=rows('assistance-tools',width,controls,{},shrink?'start':'center');if(!shrink)return fragment;const actual=Math.max(...fragment.nodes.filter(node=>node.parent===fragment.nodes[0].id).map(node=>node.box.x+node.box.width));return {...fragment,width:actual,nodes:[{...fragment.nodes[0],box:{...fragment.nodes[0].box,width:actual}},...fragment.nodes.slice(1)]};
    }
    function assistancePanel<A>(document:TableDocument<A>,width:number,metrics:Measurements,choices:ChoiceView,includeTools=true):Fragment|null {
        const view=choices.assistance;

        const children:Fragment[]=[];
        if(includeTools){
            if(view?.projection.guidance){const text=textNode('assistance-guidance-text',view.projection.guidance,'small',width-SMALL_GAP*2,metrics);children.push(group('assistance-guidance',width,text.height+SMALL_GAP*2,[{fragment:text,x:SMALL_GAP,y:SMALL_GAP}],{decoration:'callout'}));}
        }else{
            const gutter=metrics.environment.scrollbarWidth??0,inner=width-gutter,height=metrics.intrinsic('Ag','small').height*2+SMALL_GAP*2;
            const text=view?.projection.guidance?textNode('assistance-guidance-text',view.projection.guidance,'small',Math.max(1,inner-SMALL_GAP*2),metrics):null;
            const content=group('assistance-guidance-content',inner,text?text.height+SMALL_GAP*2:0,text?[{fragment:text,x:SMALL_GAP,y:SMALL_GAP}]:[]);
            children.push(group('assistance-guidance',width,height,[{fragment:content,x:0,y:0}],{...(content.height>height?{scroll:true,scrollAxis:'y' as const,scrollbarGutter:gutter}:{}),...(text?{decoration:'callout' as const}:{}),semanticRole:'group',label:'안내'}));
        }
        const anchored=new Set([...(document.opponents??[]).map(person=>person.id),...(document.participant.role==='observer'?[]:[document.participant.id])]);
        const unanchored=new Set([...(view?.projection.reactions??[]).map(reaction=>reaction.participantId),...(choices.feedback?.cues??[]).map(cue=>cue.participantId)].filter(id=>!anchored.has(id)));
        for(const id of unanchored)children.push(...participantSignals(id,width,metrics,choices));
        const tools=includeTools?assistanceTools(width,metrics,choices):null;if(tools)children.push(tools);
        return children.length?column('assistance',width,children,SMALL_GAP):null;
    }
    function assistanceDialog<A>(document:TableDocument<A>,metrics:Measurements,choices:ChoiceView):Fragment|null {
        const view=choices.assistance;if(!view)return null;
        const inspection=view.inspection,advice=view.adviceOpen?view.projection.advice:undefined,reaction=view.reactionsOpen?view.projection.tools.find(tool=>tool.kind==='send-reaction'):undefined;
        const adviceVisible=!!view.adviceOpen&&!!(advice||view.projection.guidance);
        if(!inspection&&!adviceVisible&&!reaction)return null;
        const id=inspection?'assistance-inspection':adviceVisible?'assistance-advice':'assistance-reactions',title=inspection?'카드를 낼 수 없어요':adviceVisible?'힌트':'반응';
        const width=Math.min(metrics.environment.width-32,480*metrics.environment.textScale),available=width-PADDING*2;
        const bodyAt=(allocation:number):Fragment=>{
            const children:Fragment[]=[textNode(key(id,'title'),title,'name',allocation,metrics)];
            if(inspection){const card=document.hand.find(card=>card.id===inspection.cardId);if(card){const art=leaf({id:key(id,'card'),parent:null,kind:'card',inspectionPreviewFor:inspection.cardId,label:card.label,visual:card.visual,emphasis:card.emphasis,box:{x:0,y:0,width:64,height:90}});children.push(group(key(id,'art'),allocation,90,[{fragment:art,x:(allocation-64)/2,y:0}]));}children.push(textNode(key(id,'reason'),inspection.reason,'body',allocation,metrics));}
            else if(advice)children.push(textNode(key(id,'label'),advice.label,'body',allocation,metrics));
            else if(reaction?.kind==='send-reaction')children.push(rows(key(id,'options'),allocation,reaction.options.map(option=>{
                const optionId=key('reaction-option',reaction.id,option.id),fragment=button(optionId,option.text,allocation,metrics,{assistanceIntent:{kind:'tool',toolId:reaction.id,optionId:option.id},enabled:reaction.enabled,intent:'secondary'}),control=fragment.nodes.find(node=>node.id===optionId)!;
                const textWidth=Math.max(1,control.box.width-metrics.environment.controls.command.paddingX*2),paint=textNode(key(optionId,'paint'),option.text,'button',textWidth,metrics);
                return {...fragment,nodes:[...fragment.nodes.map(node=>node.id===optionId?{...node,label:option.label,paintChildren:true}:node),{...paint.nodes[0],parent:optionId,box:{...paint.nodes[0].box,x:(control.box.width-textWidth)/2,y:(control.box.height-paint.height)/2}}]};
            })));
            if(adviceVisible&&view.projection.guidance)children.push(textNode(key(id,'guidance'),view.projection.guidance,'small',allocation,metrics));
            children.push(button(key(id,'close'),'닫기',allocation,metrics,{assistanceIntent:{kind:inspection?'dismiss-inspection':adviceVisible?'dismiss-advice':'close-reactions'},enabled:true,intent:'quiet'}));
            return column(key(id,'content'),allocation,children,GAP);
        };
        let content=bodyAt(available),height=Math.min(metrics.environment.height-32,content.height+PADDING*2),viewportHeight=Math.max(1,height-PADDING*2);
        const gutter=content.height>viewportHeight?(metrics.environment.scrollbarWidth??0):0;if(gutter)content=bodyAt(available-gutter);
        const viewport=group(key(id,'viewport'),available,viewportHeight,[{fragment:content,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:gutter});
        return group(id,width,height,[{fragment:viewport,x:PADDING,y:PADDING}],{semanticRole:'dialog',label:title,decoration:'dialog'});
    }
    function participantIdentity(input:{id:string;ownerId:string;nameId:string;badgeId:string;figure:Fragment;width:number;name:string;nameRole:TextRole;metaNatural:number;markers:readonly {id:string;label:string}[];arrangement:'adjacent'|'portrait';standing:(width:number)=>Fragment[];signals:(width:number)=>Fragment[];metrics:Measurements;thinking?:boolean;muted?:boolean;shortLocal?:boolean}):Fragment {
        const {metrics,width}=input,nameNatural=metrics.intrinsic(input.name,input.nameRole).width+16;
        const metaNatural=input.metaNatural;
        const allocation=allocateParticipantIdentity({width,arrangement:input.arrangement,figureSize:input.figure.width,nameNatural,metaNatural,textScale:metrics.environment.textScale,shortLocal:input.shortLocal});
        const pillWidth=Math.min(allocation.nameWidth,nameNatural),paint=textNode(input.nameId,input.name,input.nameRole,Math.max(1,pillWidth-16),metrics),name=group(input.badgeId,pillWidth,paint.height,[{fragment:paint,x:8,y:0}],{...(input.thinking?{decoration:'pill' as const,tone:'accent' as const}:{})});
        const standing=[...input.standing(allocation.metaWidth),...input.markers.map(marker=>{const paint=textNode(marker.id,marker.label,'small',Math.min(Math.max(1,allocation.metaWidth-8),Math.max(1,metrics.intrinsic(marker.label,'small').width)),metrics);return group(key(marker.id,'badge'),paint.width+8,paint.height,[{fragment:paint,x:4,y:0}],{decoration:'pill',semanticRole:'status',label:marker.label});})];
        const metaContent=rows(key('identity-meta-content',input.ownerId),allocation.metaWidth,standing,{},'center',4),meta=group(key('identity-meta',input.ownerId),allocation.metaWidth,Math.max(allocation.metaMinimum,metaContent.height),[{fragment:metaContent,x:0,y:0}],{identityMetaFor:input.ownerId});
        const signals=column(key(input.id,'cues'),width,input.signals(width),SMALL_GAP),plan=composeParticipantIdentity(allocation,{name,meta,feedback:signals}),portrait=group(input.id==='identity'?'identity-portrait':key(input.id,'portrait'),allocation.coreWidth,plan.coreHeight,[{fragment:input.figure,...plan.figure},{fragment:meta,...plan.meta},{fragment:name,...plan.name}]);
        return group(input.id,width,plan.height,[{fragment:portrait,x:(width-allocation.coreWidth)/2,y:0},{fragment:signals,...plan.feedback}],{deemphasized:input.muted===true});
    }
    function identity<A>(document:TableDocument<A>,width:number,metrics:Measurements,horizontal=false,choices?:ChoiceView,sideCue=false,hud?:HudReadContext,retainFeedback=false):Fragment {
        const person=hud?.participant??document.participant;
        const presentation=localParticipantPresentation(metrics.environment),figureSize=presentation.figure,figure=leaf({id:'identity-figure',parent:null,kind:'figure',appearance:person.appearance,ownerId:person.id,...participantFigureCue(person.id,choices),...(choices?.feedback?.clock?.participantId===person.id?{clockPaint:choices.feedback.clock,clockTextScale:metrics.environment.textScale}:{}),label:person.name,box:{x:0,y:0,width:figureSize,height:figureSize*110/120}});
        const result=participantIdentity({id:'identity',ownerId:person.id,nameId:'identity-name',badgeId:'identity-name-badge',figure,width:width-4,name:person.name,nameRole:'participant-name',metaNatural:participantMetaWidth(person.status,person.markers,hud??document,metrics),markers:person.markers.map((label,index)=>({id:key('marker',String(index)),label})),arrangement:document.outcome&&!choices?.publicCompletion?'portrait':presentation.arrangement,standing:allocation=>participantStanding(person.id,allocation,metrics,person.status,hud??document),signals:allocation=>participantSignals(person.id,allocation,metrics,choices,!!(document.assistance||document.feedback||choices?.assistance||choices?.feedback),person.status,hud??document,!document.outcome,retainFeedback),metrics,thinking:!document.outcome&&person.appearance?.thinking,muted:person.status?.muted,shortLocal:presentation.short});
        const figureNode=result.nodes.find(node=>node.id==='identity-figure')!,anchor:PlannedNode={id:'own-hand-count-anchor',parent:figureNode.parent,kind:'group',label:'',inert:true,ownHandAnchor:{participantId:person.id,count:document.hand.length},box:{...figureNode.box}};
        return {...result,width,height:result.height+4,nodes:[...result.nodes,anchor].map(node=>node.id==='identity'?{...node,semanticRole:'group' as const,label:person.name,accessibleDescription:`${person.name} · 내 카드 ${document.hand.length}장`,box:{...node.box,width,height:result.height+4}}:node.parent==='identity'?{...node,box:{...node.box,x:node.box.x+2,y:node.box.y+2}}:node)};
    }
    function hand<A>(document: TableDocument<A>, width: number, metrics: Measurements, id = 'hand', selection?: ChoiceView['cards'], zone = 'hand', compact = false, collectionPurpose?: CardCollection['purpose'],choices?:ChoiceView,prominent=false): Fragment {
        const emptyActiveOwn=!document.hand.length&&id==='hand'&&zone==='hand'&&!document.outcome&&document.stage!=='waiting'&&document.participant.role!=='observer';
        if (!document.hand.length&&!emptyActiveOwn)
            return column(id, width, [textNode(id === 'hand' ? 'hand-empty' : key(id, 'empty'), EMPTY_CARD_LABEL, 'small', width, metrics)]);
        const count = document.hand.length;
        const cardFragment=(card:TableCard,cardWidth:number,cardHeight:number)=>leaf({ id: key(id, 'card', card.id), parent: null, kind: 'card', entityId: card.id, ownerId:card.ownerId, zoneId: zone, collectionPurpose, label: card.label, visual: card.visual, emphasis:card.emphasis, ...(id==='hand'&&choices?.assistance?.adviceOpen&&choices.assistance.projection.advice?.cardIds.includes(card.id)?{hinted:true}:{}), ...(id==='hand'&&choices?.assistance?.projection.inspections.some(item=>item.cardId===card.id)&&!(selection?.eligible??selection?.available)?.includes(card.id)?{inspectCardId:card.id,unavailable:true,enabled:true}:(selection ? {cardId:card.id,checked:selection.selected.includes(card.id),unavailable:!(selection.eligible??selection.available).includes(card.id),enabled:selection.available.includes(card.id)} : {})), box: { x: 0, y: 0, width: cardWidth, height: cardHeight } });
        if(id==='hand'&&zone==='hand'&&!compact){
            const selectionFootprint=!!selection||!!choices?.selectionPresentation;
            const lift=selectionFootprint?SELECTION_LIFT:0,padding=selectionFootprint?HAND_SELECTION_PADDING:0;
            const plan=calculateReadableHandLayout({regionWidth:width,viewportWidth:metrics.environment.width,viewportHeight:metrics.environment.height,count,selectionLift:lift,padding,scrollbarHeight:metrics.environment.scrollbarHeight??0});
            if(emptyActiveOwn)return group(id,width,plan.height,[],{scroll:false,semanticRole:'group',label:'내 카드'});
            const cards=plan.cards.map(position=>({fragment:cardFragment(document.hand[position.index],position.width,position.height),x:position.x,y:position.y-(selection?.selected.includes(document.hand[position.index].id)?lift:0)}));
            const fan=plan.rows.length===1?group('hand-fan',plan.contentWidth,plan.bodyHeight,cards,{arrangement:'fan'}):group('hand-fan',plan.contentWidth,plan.bodyHeight,plan.rows.map((row,index)=>({fragment:group(key('hand','row',String(index)),row.width,row.height,cards.filter((_,cardIndex)=>plan.cards[cardIndex].row===index).map(card=>({...card,x:card.x-row.x,y:card.y-row.y})),{arrangement:'fan'}),x:row.x,y:row.y})));
            return group(id,width,plan.height,[{fragment:fan,x:0,y:0}],{scroll:plan.scroll,...(plan.scroll?{scrollAxis:'x' as const}:{}),semanticRole:'group',label:plan.scroll?'내 카드 · 가로 스크롤':'내 카드'});
        }
        const history = compact && collectionPurpose==='captured'&&!prominent;
        const denseHistory=history&&!!document.outcome?.overview;
        const short=!document.outcome&&document.stage!=='waiting'?shortLandscapePresentation(metrics.environment):null;
        const cardWidth = history ? denseHistory?16:32 : compact ? short?.publicCard.width??64 : short?.hand.width??CARD_WIDTH, cardHeight = history ? denseHistory?23:45 : compact ? short?.publicCard.height??90 : short?.hand.height??CARD_HEIGHT;
        const selectionFootprint=!!selection||id==='hand'&&!!choices?.selectionPresentation;
        const lift = selectionFootprint ? SELECTION_LIFT : 0, padding = selectionFootprint ? 6 : 0;
        const height = cardHeight + lift + padding * 2;
        if(emptyActiveOwn)return group(id,width,height+(metrics.environment.scrollbarHeight??0),[],{scroll:false,semanticRole:'group',label:'내 카드'});
        const step = count === 1 ? 0 : Math.min(id==='hand'&&document.opponents?.length?TARGET:cardWidth + SMALL_GAP, Math.max(selectionFootprint ? TARGET : EXPOSED, (width - cardWidth - padding * 2) / (count - 1)));
        const contentWidth = cardWidth + Math.max(0, count - 1) * step + padding * 2;
        const cards = document.hand.map((card, index) => ({ fragment: cardFragment(card,cardWidth,cardHeight), x: (compact||id==='hand'&&document.opponents?.length?Math.max(0,(width-contentWidth)/2):0) + padding + index * step, y: padding + lift - (selection?.selected.includes(card.id) ? lift : 0) }));
        const fan = group(id === 'hand' ? 'hand-fan' : key(id, 'fan'), Math.max(width, contentWidth), height, cards, { arrangement: 'fan' });
        return group(id, width, height+(contentWidth>width+.001||id==='hand'&&!document.outcome?(metrics.environment.scrollbarHeight??0):0), [{ fragment: fan, x: 0, y: 0 }], { scroll: contentWidth > width + 0.001, ...(id==='hand' ? {semanticRole:'group' as const,label:contentWidth>width+.001?'내 카드 · 가로 스크롤':'내 카드'} : {}) });
    }
    function identityRequirements<A>(document: TableDocument<A>, metrics: Measurements): {
        preferredWidth: number;
    } {
        const presentation=localParticipantPresentation(metrics.environment),metaNatural=participantMetaWidth(document.participant.status,document.participant.markers,document,metrics),nameNatural=metrics.intrinsic(document.participant.name,'participant-name').width+16;
        return {preferredWidth:participantIdentityWidth({arrangement:presentation.arrangement,figureSize:presentation.figure,nameNatural,metaNatural})+4};
    }
    function handAllocationSlots<A>(document:TableDocument<A>):number {
        const activeOwn=document.participant.role!=='observer'&&document.stage!=='waiting'&&!document.outcome;
        return activeOwn?6:Math.min(document.hand.length,6);
    }
    function handRequirements<A>(document: TableDocument<A>, width:number,metrics:Measurements,selection?: ChoiceView['cards'], presentation=false): {
        minimumWidth: number;
    } {
        const interactiveFootprint=!!selection||presentation;
        // The active own-hand row is an allocation, even when its body is empty.
        // Admit the dock against the same existing six-slot envelope throughout
        // depletion; current card membership must not choose a different tray.
        const slots=handAllocationSlots(document);
        const row=calculateHandRowMetrics({regionWidth:width,viewportWidth:metrics.environment.width,viewportHeight:metrics.environment.height,selectionLift:interactiveFootprint?SELECTION_LIFT:0,padding:interactiveFootprint?HAND_SELECTION_PADDING:0,scrollbarHeight:metrics.environment.scrollbarHeight??0});
        return {minimumWidth:Math.min(256,row.cardWidth+row.padding*2+Math.max(0,slots-1)*row.minimumStep)};
    }
    function dock<A>(document: TableDocument<A>, width: number, metrics: Measurements, choices: ChoiceView): {
        fragment: Fragment;
        recipe: CandidateLayout['recipe'];
    } {
        const shortDock=!document.outcome&&!!shortLandscapePresentation(metrics.environment),dockPadding=shortDock?4:DOCK_PADDING;
        const available = width - dockPadding * 2;
        if(document.outcome&&!document.hand.length){
            const participant=identity(document,available,metrics,true,choices);
            return {fragment:group('dock',width,participant.height+DOCK_PADDING*2,[{fragment:participant,x:DOCK_PADDING,y:DOCK_PADDING}]),recipe:'stacked'};
        }
        const identityRequirement = identityRequirements(document, metrics);
        const handRequirement = handRequirements(document, available,metrics,choices.cards,!!choices.selectionPresentation);
        const short=!document.outcome?shortLandscapePresentation(metrics.environment):null;
        const seatedPortrait=dockIdentityRow(metrics.environment)>0;
        const sideCue=!!document.opponents?.length&&!document.outcome;
        const sideWidth=short?92:identityRequirement.preferredWidth;
        // The short dock reserves a real public-card-width transit corridor
        // between the own-count destination and retained private-card targets.
        const dockGap=short?short.publicCard.width:GAP;
        const side = !seatedPortrait&&available >= sideWidth + dockGap + handRequirement.minimumWidth;
        // Dock measures immediate children at their exact allocation and composes only returned footprints.
        const participant = identity(document, side ? sideWidth : available, metrics, !!short||!side && !!document.opponents?.length,choices,side&&sideCue);
        const cards = hand(document, side ? available - participant.width - dockGap : available, metrics, 'hand', choices.cards,'hand',false,undefined,choices);
        const row=composeSideDockRow({identity:participant,hand:cards,padding:dockPadding,gap:dockGap,short:shortDock});
        const fragment = side
            ? group('dock', width, row.height, [{ fragment: participant, ...row.identity }, { fragment: cards, ...row.hand }])
            : column('dock', width, [participant, cards], GAP, dockPadding);
        return { fragment: { ...fragment, nodes: [{ ...fragment.nodes[0], decoration: 'tray' }, ...fragment.nodes.slice(1)] }, recipe: side ? 'side-by-side' : 'stacked' };
    }
    function compactDockCandidates<A>(document:TableDocument<A>,width:number,metrics:Measurements,choices:ChoiceView):readonly {fragment:Fragment;recipe:CandidateLayout['recipe']}[] {
        if(document.participant.role==='observer'||!handAllocationSlots(document)||document.outcome)return [];
        const padding=choices.cards||choices.selectionPresentation?6:0,available=width-DOCK_PADDING*2;
        const handMinimum=minimumHandViewport({cardWidth:CARD_WIDTH,feedbackPadding:padding,stride:TARGET,count:handAllocationSlots(document)});
        const glyph=(labels:readonly string[],role:TextRole)=>Math.max(1,...[...new Set(labels.flatMap(label=>Array.from(label)))].map(char=>metrics.intrinsic(char,role).width));
        const widths=compactIdentityWidths({available,gap:GAP,handMinimum,figure:localParticipantPresentation(metrics.environment).figure,artGap:0,outerPadding:12,countArtwork:0,captionGap:0,nameGlyph:glyph([document.participant.name],'participant-name')+16,countGlyph:0});
        return widths.map(identityWidth=>{
            const participant=identity(document,identityWidth,metrics,true,choices),cards=hand(document,available-identityWidth-GAP,metrics,'hand',choices.cards,'hand',false,undefined,choices);
            const fragment=group('dock',width,Math.max(participant.height,cards.height)+DOCK_PADDING*2,[{fragment:participant,x:DOCK_PADDING,y:DOCK_PADDING},{fragment:cards,x:DOCK_PADDING+participant.width+GAP,y:DOCK_PADDING}],{decoration:'tray'});
            return {fragment,recipe:'side-by-side' as const};
        });
    }
    // Native one-card activation owns confirmation. Keep genuine commands and
    // fields in the control lane; the hand retains the complete selection view.
    function controlChoices(choices:ChoiceView):ChoiceView {
        return choices.nativeCardPresentation?{...choices,selected:null,selectedLabels:undefined,cards:undefined,selectionPresentation:undefined,nativeCardPresentation:undefined}:choices;
    }
    function nativeInstruction(choices:ChoiceView,width:number,metrics:Measurements):Fragment|null {
        const presentation=choices.nativeCardPresentation;if(!presentation)return null;
        const insetX=15,insetY=6;
        const pillWidth=Math.min(width,Math.max(...presentation.captions.map(caption=>metrics.intrinsic(caption,'small').width))+insetX*2);
        const textWidth=Math.max(1,pillWidth-insetX*2);
        const height=Math.max(...presentation.captions.map(caption=>metrics.exact(caption,'small',textWidth).height))+insetY*2;
        const paint=presentation.caption?group('native-play-pill',pillWidth,height,[{fragment:textNode('native-play-caption',presentation.caption,'small',textWidth,metrics),x:insetX,y:insetY}],{decoration:'prompt'}):null;
        return group('native-play-instruction',width,height,paint?[{fragment:paint,x:(width-pillWidth)/2,y:0}]:[]);
    }
    function withNativeInstruction<T extends {fragment:Fragment}>(local:T,choices:ChoiceView,metrics:Measurements):T {
        const instruction=nativeInstruction(choices,local.fragment.width,metrics);
        return instruction?{...local,fragment:column('native-dock-context',local.fragment.width,[instruction,local.fragment],SMALL_GAP)}:local;
    }
    function playCollections<A>(document:TableDocument<A>){
        const all=document.collections??[],history=all.filter(zone=>zone.purpose==='captured');
        const secondary=all.filter(zone=>history.includes(zone)||!!document.presentation?.selection&&zone.relevance==='auxiliary');
        return {history,secondary,arenaDocument:secondary.length?{...document,collections:all.filter(zone=>!secondary.includes(zone))}:document};
    }
    function submitCaptionReserve(domain:FiniteChoicePhasePresentation,metrics:Measurements):Size {
        const text=(value:string)=>metrics.intrinsic(value,'button'),fontSize=typography('button',metrics.environment).fontSize,space=text(' ').width;
        const prefix=measureInlineCaption([{kind:'text',text:domain.submit.prefix}],{mode:'inline',fontSize,textScale:metrics.environment.textScale,text});let width=prefix.width,height=prefix.height;
        for(const id of domain.submit.fieldIds){const field=domain.fields.find(field=>field.id===id);if(!field)throw Error('Missing public submit field');const sizes=field.options.map(option=>measureInlineCaption([option.atom],{mode:'inline',fontSize,textScale:metrics.environment.textScale,text}));width+=space+Math.max(...sizes.map(size=>size.width));height=Math.max(height,...sizes.map(size=>size.height));}
        return {width,height};
    }
    function captionSize(atoms:readonly InlineCaptionAtom[],role:'choice'|'button',metrics:Measurements){return measureInlineCaption(atoms,{mode:role==='choice'?'choice':'inline',fontSize:typography(role,metrics.environment).fontSize,textScale:metrics.environment.textScale,text:value=>metrics.intrinsic(value,role)});}
    function captionDomainSize(domains:readonly import('../decisionModel').CaptionDomain[],role:'choice'|'button',metrics:Measurements):Size{
        const sizes=domains.map(domain=>measureCaptionDomain(domain,{mode:role==='choice'?'choice':'inline',fontSize:typography(role,metrics.environment).fontSize,textScale:metrics.environment.textScale,text:value=>metrics.intrinsic(value,role)}));
        return {width:Math.max(...sizes.map(size=>size.width)),height:Math.max(...sizes.map(size=>size.height))};
    }
    function finitePreferredHeight(measurement:ControlClusterMeasurement,metrics:Measurements){const cap=calculateMeasuredFrameLayout({viewport:metrics.environment,region:metrics.environment,controls:true}).decisionCap??metrics.environment.height;return Math.max(measurement.minimumHeight,Math.min(measurement.preferredHeight,cap));}
    type FiniteDomain=FiniteChoicePhasePresentation|import('./presentationCohort').FiniteGroupPresentation;
    type ActualField={field:ChoiceView['fields'][number];options:readonly {option:ChoiceView['fields'][number]['options'][number];atoms:readonly InlineCaptionAtom[];slot:string}[]};
    type ActualCommand={command:NonNullable<ChoiceView['selected']>;atoms:readonly InlineCaptionAtom[];slot:string};
    function finiteClusterInput(domain:FiniteDomain,width:number,metrics:Measurements,actual?:ChoiceView){
        const modern='submitDomains'in domain;
        const bindings:ActualField[]=[];
        const fields=domain.fields.map((field,index)=>{
            const observed=actual?.fields.find(candidate=>candidate.id===field.id);
            const maximum=modern?captionDomainSize((field as import('./presentationCohort').FiniteGroupPresentation['fields'][number]).captionDomains,'choice',metrics):(()=>{const values=(field as FiniteChoicePhasePresentation['fields'][number]).options.map(option=>captionSize([option.atom],'choice',metrics));return {width:Math.max(...values.map(value=>value.width)),height:Math.max(...values.map(value=>value.height))};})();
            const options=observed?.options.map((option,ordinal)=>{
                const atom=!modern?(field as FiniteChoicePhasePresentation['fields'][number]).options.find(candidate=>candidate.key===option.id)?.atom:undefined;
                if(!modern&&!atom)throw Error('Missing public option caption');
                const atoms=option.caption??(atom?[atom]:[{kind:'text' as const,text:option.label}]);
                return {option,atoms,slot:`field${index}:option${ordinal}`};
            })??[];
            if(observed)bindings.push({field:observed,options});
            const numeric=!modern&&(field as FiniteChoicePhasePresentation['fields'][number]).options.every(option=>option.atom.kind==='number');
            return {key:`field${index}`,visibleOptionCapacity:modern?(field as import('./presentationCohort').FiniteGroupPresentation['fields'][number]).visibleOptionCapacity:(field as FiniteChoicePhasePresentation['fields'][number]).options.length,maximumCaption:maximum,...(numeric?{numeric:true as const}:{}),options:options.map(option=>({key:option.slot,caption:captionSize(option.atoms,'choice',metrics),...(option.atoms.length===1&&option.atoms[0].kind==='number'?{numeric:true as const}:{})}))};
        });
        const auxiliary=modern?[]:domain.auxiliaryLabels;
        const actions=[...auxiliary.map((label,index)=>({key:`aux${index}`,caption:captionSize([{kind:'text',text:label}],'button',metrics)})),{key:'submit',caption:modern?captionDomainSize(domain.submitDomains,'button',metrics):submitCaptionReserve(domain,metrics),primary:true as const}];
        const commandBindings:ActualCommand[]=[],used=new Set<number>();
        for(const command of actual?.commands??[]){const index=auxiliary.findIndex((label,index)=>label===command.label&&!used.has(index));if(index<0)throw Error('Auxiliary action is outside its public vocabulary');used.add(index);commandBindings.push({command,atoms:command.caption??[{kind:'text',text:command.label}],slot:`aux${index}`});}
        if(actual?.selected){const command=actual.selected;let atoms=command.caption;if(!atoms&&!modern){const values:InlineCaptionAtom[]=[{kind:'text',text:domain.submit.prefix}];for(const id of domain.submit.fieldIds){const option=domain.fields.find(field=>field.id===id)?.options.find(option=>option.key===actual.values?.[id]);if(!option)throw Error('Missing selected public caption');values.push(option.atom);}atoms=values;}commandBindings.push({command,atoms:atoms??[{kind:'text',text:command.label}],slot:'submit'});}
        const maximum=(kind:'choice'|'command')=>{const native=metrics.environment.controls[kind],captions=kind==='choice'?fields.map(field=>field.maximumCaption):actions.map(action=>action.caption);return {width:Math.max(kind==='command'?width:0,...captions.map(caption=>caption.width+native.paddingX*2)),height:Math.max(kind==='choice'?40:44,native.minHeight,...captions.map(caption=>caption.height+native.paddingY*2))};};
        const input:ControlClusterInput={viewport:metrics.environment,allocation:{width,height:100000},scrollbar:{width:metrics.environment.scrollbarWidth??0,height:metrics.environment.scrollbarHeight??0},recipe:modern?'staged':'bid',fields,actions,primitives:{choice:controlClusterPaintMetrics('choice',maximum('choice'),metrics.environment.controls.choice),command:controlClusterPaintMetrics('command',maximum('command'),metrics.environment.controls.command)}};
        return {input,bindings,commandBindings};
    }
    function materializeFiniteCluster(plan:Extract<ControlClusterPlan,{kind:'admitted'}>,fields:readonly ActualField[],commands:readonly ActualCommand[],metrics:Measurements):Fragment{
        const planned=new Map(plan.controls.map(control=>[control.key,control]));
        const material=(id:string,label:string,atoms:readonly InlineCaptionAtom[],slot:string,extra:Partial<PlannedNode>):Fragment=>{
            const assignment=planned.get(slot);if(!assignment)throw Error('Missing finite cluster body');
            const role=extra.kind==='choice'?'choice':'button',inline=captionSize(atoms,role,metrics),body=assignment.body;
            if(inline.width>body.width||inline.height>body.height)throw Error('Finite caption escapes assigned body');
            const paint=paintInlineCaption(key(id,'caption'),inline,{group,text:(id,label,width,height)=>leaf({id,parent:null,kind:'text',label,role,box:{x:0,y:0,width,height}}),suit:(id,suit,label,width,height)=>leaf({id,parent:null,kind:'suit',suit,label,box:{x:0,y:0,width,height}})});
            return {width:body.width,height:body.height,nodes:[{id,parent:null,kind:'command',label,role,paintChildren:true,...extra,box:{x:0,y:0,width:body.width,height:body.height}},...paint.nodes.slice(1).map(node=>({...node,parent:id,box:{...node.box,x:node.box.x+(body.width-inline.width)/2,y:node.box.y+(body.height-inline.height)/2}}))]};
        };
        type Item={fragment:Fragment;x:number;y:number};
        const bounds=(items:readonly Item[])=>({left:Math.min(...items.map(item=>item.x)),top:Math.min(...items.map(item=>item.y)),right:Math.max(...items.map(item=>item.x+item.fragment.width)),bottom:Math.max(...items.map(item=>item.y+item.fragment.height))});
        const fieldItems:Item[]=fields.flatMap(({field,options})=>{if(!options.length)return [];const items=options.map(({option,atoms,slot})=>{const body=planned.get(slot)!.body;return {fragment:material(key('option',field.id,option.id),option.label,atoms,slot,{kind:'choice',fieldId:field.id,optionId:option.id,enabled:option.enabled,checked:false}),x:body.x,y:body.y};});const b=bounds(items);return [{fragment:group(key('finite-cluster-field',field.id),b.right-b.left,b.bottom-b.top,items.map(item=>({...item,x:item.x-b.left,y:item.y-b.top})),{semanticRole:'radiogroup',label:field.label}),x:b.left,y:b.top}];});
        const commandItems:Item[]=commands.map(({command,atoms,slot})=>{const body=planned.get(slot)!.body;return {fragment:material(key('command',command.id),command.label,atoms,slot,{actionId:command.id,enabled:command.enabled,intent:command.intent}),x:body.x,y:body.y};});
        const placements:Item[]=[];
        const append=(kind:'fields'|'actions',items:Item[])=>{if(!items.length)return;const plane=plan.scroll.find(plane=>plane.key===kind);if(plane){const content=group(key('finite-cluster-content',kind),plane.content.width,plane.content.height,items.map(item=>({...item,x:item.x-plane.bounds.x,y:item.y-plane.bounds.y})));placements.push({fragment:group(key('finite-cluster-scroll',kind),plane.bounds.width,plane.bounds.height,[{fragment:content,x:0,y:0}],{scroll:true,scrollAxis:plane.axis,...(plane.axis==='y'?{scrollbarGutter:metrics.environment.scrollbarWidth??0}:{}),semanticRole:'group',label:kind==='fields'?'선택 항목':'실행 항목'}),x:plane.bounds.x,y:plane.bounds.y});}else placements.push(...items);};
        append('fields',fieldItems);
        if(commandItems.length){const b=bounds(commandItems);append('actions',[{fragment:group('finite-cluster-actions',b.right-b.left,b.bottom-b.top,commandItems.map(item=>({...item,x:item.x-b.left,y:item.y-b.top}))),x:b.left,y:b.top}]);}
        return group('decisions',plan.allocation.width,plan.allocation.height,[{fragment:group('finite-control-cluster',plan.allocation.width,plan.allocation.height,placements),x:0,y:0}]);
    }
    function finiteClusterControls(choices:ChoiceView,width:number,metrics:Measurements,footerBudget?:number,domainOverride?:FiniteDomain):Fragment|null{
        const domain=domainOverride??choices.captionPresentation??choices.decisionPresentation;if(!domain)return null;
        const recipe=finiteClusterInput(domain,width,metrics,choices),measurement=measureControlCluster(recipe.input);if(measurement.kind==='refused')return null;
        const plan=layoutControlCluster({...recipe.input,observedActionKeys:recipe.commandBindings.map(binding=>binding.slot),allocation:{width,height:footerBudget??finitePreferredHeight(measurement,metrics)}});if(plan.kind==='refused')return null;
        const rendered=materializeFiniteCluster(plan,recipe.bindings,recipe.commandBindings,metrics);
        return {...rendered,nodes:rendered.nodes.map(node=>node.kind==='choice'?{...node,checked:choices.values?.[node.fieldId!]===node.optionId}:node)};
    }
    function measureDecisionDomain(domain:NonNullable<ChoiceView['decisionPresentation']>,width:number,metrics:Measurements):Size&{readonly minimumHeight:number}{
        const result=measureControlCluster(finiteClusterInput(domain,width,metrics).input);if(result.kind==='refused')throw Error(`Finite public cluster cannot fit: ${result.reason}`);return {width,height:finitePreferredHeight(result,metrics),minimumHeight:result.minimumHeight};
    }
    function measureCaptionPresentation(domain:import('./presentationCohort').FiniteGroupPresentation,width:number,metrics:Measurements):Size&{readonly minimumHeight:number}{
        const result=measureControlCluster(finiteClusterInput(domain,width,metrics).input);if(result.kind==='refused')throw Error(`Finite public cluster cannot fit: ${result.reason}`);return {width,height:finitePreferredHeight(result,metrics),minimumHeight:result.minimumHeight};
    }
    function countGroupView(domain:import('./presentationCohort').CardGroupPresentation):ChoiceView{return {values:null,fields:[],commands:[],selected:null,selectionPresentation:{...domain,scopeKey:'public-count-measure'}};}
    function exchangeGroups(choices:ChoiceView){const domains=choices.decisionReservations??[],finite=domains.filter((domain):domain is import('./presentationCohort').FiniteGroupPresentation=>domain.kind==='finite-choice'&&domain.presentation.kind==='choice-strips'),count=domains.filter((domain):domain is import('./presentationCohort').CardGroupPresentation=>domain.kind==='card-selection'&&domain.mode==='count');return domains.length===2&&finite.length===1&&count.length===1?{finite:finite[0],count:count[0]}:null;}
    function exchangeReservation(choices:ChoiceView,width:number,metrics:Measurements){
        const pair=exchangeGroups(choices);if(!pair)return null;
        const initial=layoutDecision({mode:'exchange',width,viewport:metrics.environment,gap:4,items:[{id:'count',kind:'discard',width,height:0},{id:'finite',kind:'contract-controls',width,height:0}]});
        const finiteWidth=initial.nodes.find(node=>node.id==='finite')!.bounds.width,countWidth=initial.nodes.find(node=>node.id==='count')!.bounds.width;
        if(finiteWidth<=0||countWidth<=0)return null;
        const finite=measureCaptionPresentation(pair.finite,finiteWidth,metrics),count=decisions(countGroupView(pair.count),countWidth,metrics,true),root=choices.commands.length?decisions({...choices,groups:undefined,fields:[],selected:null,cards:undefined,selectionPresentation:undefined,nativeCardPresentation:undefined,finitePresentation:undefined,decisionPresentation:undefined,captionPresentation:undefined},width,metrics,true):null;
        const minimum=layoutDecision({mode:'exchange',width,viewport:metrics.environment,gap:4,items:[{id:'count',kind:'discard',width:countWidth,height:count.height},{id:'finite',kind:'contract-controls',width:finiteWidth,height:finite.minimumHeight}]}),preferred=layoutDecision({mode:'exchange',width,viewport:metrics.environment,gap:4,items:[{id:'count',kind:'discard',width:countWidth,height:count.height},{id:'finite',kind:'contract-controls',width:finiteWidth,height:finite.height}]});
        return {pair,finiteWidth,countWidth,count,root,height:preferred.height+(root?4+root.height:0),minimumHeight:minimum.height+(root?4+root.height:0),groupHeight:preferred.height};
    }
    function groupDecisionReservation(choices:ChoiceView,width:number,metrics:Measurements):{readonly height:number;readonly minimumHeight:number}|null{
        const exchange=exchangeReservation(choices,width,metrics);if(exchange)return {height:exchange.height,minimumHeight:exchange.minimumHeight};
        const domains=choices.decisionReservations;if(!domains?.length&&!choices.groups?.length)return choices.captionPresentation?measureCaptionPresentation(choices.captionPresentation,width,metrics):null;
        const parts=domains?.length?domains.map(domain=>domain.kind==='finite-choice'?measureCaptionPresentation(domain,width,metrics):{height:decisions(countGroupView(domain),width,metrics,true).height,minimumHeight:decisions(countGroupView(domain),width,metrics,true).height}):choices.groups!.map(view=>view.captionPresentation?measureCaptionPresentation(view.captionPresentation,width,metrics):{height:decisions({...view,groups:undefined,commands:[]},width,metrics,true).height,minimumHeight:decisions({...view,groups:undefined,commands:[]},width,metrics,true).height});
        const root=choices.groups&&choices.commands.length?decisions({...choices,groups:undefined,fields:[],selected:null,cards:undefined,selectionPresentation:undefined,nativeCardPresentation:undefined,finitePresentation:undefined,decisionPresentation:undefined,captionPresentation:undefined},width,metrics,true):null;
        const gaps=4*Math.max(0,parts.length+(root?1:0)-1);
        return {height:parts.reduce((sum,part)=>sum+part.height,0)+(root?.height??0)+gaps,minimumHeight:parts.reduce((sum,part)=>sum+part.minimumHeight,0)+(root?.height??0)+gaps};
    }
    function composeExchangeGroups(choices:ChoiceView,width:number,metrics:Measurements,footerBudget?:number):Fragment|null{
        const reserved=exchangeReservation(choices,width,metrics);if(!reserved||!choices.groups)return null;
        const finiteView=choices.groups.find(view=>view.decisionGroupId===reserved.pair.finite.id&&view.groupKind==='finite-choice'),countView=choices.groups.find(view=>view.decisionGroupId===reserved.pair.count.id&&view.groupKind==='card-selection');if(!finiteView||!countView)return null;
        const desktop=metrics.environment.width>=1024&&metrics.environment.height>=640,total=footerBudget??reserved.height,groupBudget=total-(reserved.root?reserved.root.height+4:0),finiteBudget=desktop?groupBudget:groupBudget-reserved.count.height-4;
        if(total<reserved.minimumHeight)return null;
        const finite=finiteClusterControls({...finiteView,groups:undefined,commands:[]},reserved.finiteWidth,metrics,finiteBudget,reserved.pair.finite);if(!finite)return null;
        const selected=countView.selected?{...countView.selected,intent:finiteView.selected?.enabled?'secondary' as const:'primary' as const}:null,count=decisions({...countView,groups:undefined,commands:[],selected},reserved.countWidth,metrics,true);
        const owned=(fragment:Fragment,id:string)=>{const namespaced=namespace(fragment,decisionGroupNamespace(id));return {...namespaced,nodes:namespaced.nodes.map(node=>node.actionId||node.fieldId||node.localIntent==='submit-card-set'?{...node,decisionGroupId:id}:node)};};
        const left=owned(finite,finiteView.decisionGroupId),right=owned(count,countView.decisionGroupId),layout=layoutDecision({mode:'exchange',width,viewport:metrics.environment,gap:4,items:[{id:'count',kind:'discard',width:right.width,height:right.height},{id:'finite',kind:'contract-controls',width:left.width,height:left.height}]}),parts=new Map([['count',right],['finite',left]]);
        const groups=group('decision-exchange',width,layout.height,layout.nodes.filter(node=>node.visible).map(node=>({fragment:parts.get(node.id)!,x:node.bounds.x,y:node.bounds.y})));
        return column('decisions',width,[groups,...(reserved.root?[namespace(reserved.root,'decision-root-commands')]:[])],4);
    }
    function decisions(choices: ChoiceView, width: number, metrics: Measurements, compact = false,footerBudget?:number): Fragment {
        if(choices.groups){
            const exchange=composeExchangeGroups(choices,width,metrics,footerBudget);if(exchange)return exchange;
            const root=choices.commands.length?decisions({...choices,groups:undefined,cards:undefined,selectionPresentation:undefined,nativeCardPresentation:undefined,finitePresentation:undefined,decisionPresentation:undefined,captionPresentation:undefined,fields:[],selected:null},width,metrics,compact):null;
            const reservations=choices.groups.map(view=>view.captionPresentation?measureCaptionPresentation(view.captionPresentation,width,metrics):(()=>{const height=decisions({...view,groups:undefined,commands:[]},width,metrics,compact).height;return {height,minimumHeight:height};})());
            const gaps=4*Math.max(0,choices.groups.length+(root?1:0)-1),minimum=reservations.reduce((sum,part)=>sum+part.minimumHeight,0)+(root?.height??0)+gaps;
            if(footerBudget!==undefined&&footerBudget<minimum)throw Error('Grouped controls exceed assigned complete minimum');
            let remaining=footerBudget===undefined?Infinity:footerBudget-minimum;
            const budgets=reservations.map(part=>{const extra=Math.min(remaining,part.height-part.minimumHeight);remaining-=extra;return part.minimumHeight+extra;});
            const confirming=choices.groups.some(group=>group.groupKind==='finite-choice'&&group.selected?.enabled),parts=choices.groups.map((view,index)=>{
                const selected=view.groupKind==='card-selection'&&view.selected?{...view.selected,intent:confirming?'secondary' as const:'primary' as const}:view.selected;
                const fragment=namespace(decisions({...view,groups:undefined,commands:[],selected},width,metrics,compact,budgets[index]),decisionGroupNamespace(view.decisionGroupId));
                return {...fragment,nodes:fragment.nodes.map(node=>node.actionId||node.fieldId||node.localIntent==='submit-card-set'?{...node,decisionGroupId:view.decisionGroupId}:node)};
            });
            return column('decisions',width,[...parts,...(root?[namespace(root,'decision-root-commands')]:[])],4);
        }

        if(choices.nativeCardPresentation){const controls=controlChoices(choices);return controls.commands.length||controls.fields.length?decisions(controls,width,metrics,compact,footerBudget):group('native-controls-empty',width,0,[]);}
        if(choices.finitePresentation?.kind==='choice-strips'){
            const cluster=finiteClusterControls(choices,width,metrics,footerBudget);if(cluster)return cluster;
            const domain=choices.decisionPresentation,reserve=domain?submitCaptionReserve(domain,metrics):undefined;
            const fields=choices.fields.map(field=>{
                const publicField=domain?.fields.find(candidate=>candidate.id===field.id);
                const options=field.options.map(option=>{const atom=publicField?.options.find(candidate=>candidate.key===option.id)?.atom;if(publicField&&!atom)throw Error('Missing public option caption');return button(key('option',field.id,option.id),option.label,width,metrics,{kind:'choice',fieldId:field.id,optionId:option.id,enabled:option.enabled,checked:choices.values?.[field.id]===option.id},[],'content',option.caption?{atoms:option.caption,mode:'choice'}:atom?{atoms:[atom],mode:'choice'}:undefined);});
                const extent=options.reduce((sum,option)=>sum+option.width,0)+Math.max(0,options.length-1)*SMALL_GAP,height=Math.max(0,...options.map(option=>option.height));
                let x=0;return group(key('field',field.id),extent,height,options.map(fragment=>{const placement={fragment,x,y:(height-fragment.height)/2};x+=fragment.width+SMALL_GAP;return placement;}),{semanticRole:'radiogroup',label:field.label});
            });
            const extent=fields.reduce((sum,field)=>sum+field.width,0)+Math.max(0,fields.length-1)*SMALL_GAP,height=Math.max(0,...fields.map(field=>field.height));
            let x=0;const content=group('decision-strips-content',extent,height,fields.map(fragment=>{const placement={fragment,x,y:(height-fragment.height)/2};x+=fragment.width+SMALL_GAP;return placement;}));
            const strip=choices.staged?column('decision-fields',width,fields.map((fragment,index)=>group(key('staged-field',String(index)),width,fragment.height+(metrics.environment.scrollbarHeight??0),[{fragment:group(key('staged-field-content',String(index)),fragment.width,fragment.height,[{fragment,x:0,y:0}]),x:0,y:0}],{...(fragment.width>width?{scroll:true,scrollAxis:'x' as const}:{}),semanticRole:'group',label:choices.fields[index].label})),4):group('decision-fields',width,height+(extent>width?(metrics.environment.scrollbarHeight??0):0),[{fragment:content,x:extent<=width?(width-extent)/2:0,y:0}],{...(extent>width?{scroll:true,scrollAxis:'x' as const}:{}),semanticRole:'group',label:'선택 항목'});
            const commands=[...choices.commands,...(choices.selected?[choices.selected]:[])].map(command=>{
                let caption:{atoms:readonly InlineCaptionAtom[];mode:'inline';reserve?:Size}|undefined;
                if(command.caption)caption={atoms:command.caption,mode:'inline'};
                else if(domain&&command===choices.selected){const atoms:InlineCaptionAtom[]=[{kind:'text',text:domain.submit.prefix}];for(const id of domain.submit.fieldIds){const field=domain.fields.find(field=>field.id===id),key=choices.values?.[id],option=field?.options.find(option=>option.key===key);if(option)atoms.push(option.atom);else if(command.id!=='domain-submit')throw Error('Missing selected public caption');}caption={atoms,mode:'inline',reserve};}
                const label=caption&&command.id!=='domain-submit'?captionLabel(caption.atoms):command.label;
                return button(key('command',command.id),label,width,metrics,{actionId:command.id,enabled:command.enabled,intent:command.intent},!domain&&command===choices.selected?choices.selectedLabels:undefined,'prominent',caption);
            });
            return column('decisions',width,[...(fields.length?[strip]:[]),...(commands.length?[rows('decision-commands',width,commands,{},'center')]:[])],4);
        }
        const nativeFinite=footerBudget!==undefined&&choices.fields.length>0&&decisions(choices,width,metrics,compact).height>footerBudget;
        const preferred=choices.fields.map(field=>{
            if(field.catalogue)return width;
            if(nativeFinite)return Math.min(width,Math.max(88*metrics.environment.textScale,metrics.intrinsic(field.label,'small').width,Math.min(160*metrics.environment.textScale,Math.max(...field.options.map(option=>metrics.intrinsic(option.label,'select').width+68)))));
            if(field.options.length>12)return Math.min(width,Math.max(144,metrics.intrinsic(field.label,'small').width,...field.options.map(option=>metrics.intrinsic(option.label,'select').width+56)));
            const controls=field.options.map(option=>button(key('option',field.id,option.id),option.label,width,metrics,{kind:'choice'}));
            return Math.min(width,Math.max(metrics.intrinsic(field.label,'small').width,controls.reduce((sum,control)=>sum+control.width,0)+Math.max(0,controls.length-1)*SMALL_GAP));
        });
        const inline=compact&&preferred.reduce((sum,value)=>sum+value,0)+Math.max(0,preferred.length-1)*SMALL_GAP<=width;
        const labelWidths=choices.fields.map(field=>metrics.intrinsic(field.label,'small').width);
        const inlineLabels=nativeFinite&&preferred.reduce((sum,value,index)=>sum+value+labelWidths[index]+SMALL_GAP,0)+Math.max(0,preferred.length-1)*SMALL_GAP<=width&&choices.fields.every((field,index)=>field.options.every(option=>metrics.intrinsic(option.label,'select').width+56<=preferred[index]-12));
        const fields = choices.fields.map((field,index) => {
            const fieldWidth=inlineLabels?preferred[index]+labelWidths[index]+SMALL_GAP:inline?preferred[index]:width;
            const selectWidth=inlineLabels?preferred[index]:fieldWidth;
            if(field.catalogue){
                const selected=choices.values?.[field.id],ids=[...field.catalogue.featuredIds,...(selected&&!field.catalogue.featuredIds.includes(selected)?[selected]:[])];
                const options=ids.flatMap(id=>{const option=field.options.find(option=>option.id===id);return option?[button(key('option',field.id,id),option.label,fieldWidth,metrics,{kind:'choice',fieldId:field.id,optionId:id,enabled:option.enabled,checked:selected===id})]:[];});
                const more=button(key('catalogue-open',field.id),field.catalogue.openLabel,fieldWidth,metrics,{catalogueIntent:{kind:'open',fieldId:field.id},enabled:field.options.some(option=>option.enabled),intent:'secondary'});
                return column(key('field',field.id),fieldWidth,[textNode(key('field-label',field.id),field.label,'small',fieldWidth,metrics),rows(key('options',field.id),fieldWidth,[...options,more],{semanticRole:'group',label:field.label},'start')],4);
            }
            if(field.options.length>12||nativeFinite){
                const selected=choices.values?.[field.id],selectedLabel=field.options.find(option=>option.id===selected)?.label;
                const control=leaf({id:key('select',field.id),parent:null,kind:'select',role:'select',fieldId:field.id,label:field.label,options:field.options,selectedOptionId:selected,enabled:field.options.some(option=>option.enabled),box:{x:0,y:0,width:selectWidth-12,height:nativeTextControlHeight(typography('select',metrics.environment).lineHeight)}});
                const envelope=group(key('select-envelope',field.id),selectWidth,control.height+12,[{fragment:control,x:6,y:6}]);
                // Finite choices reserve the complete wrapped-label envelope, just as
                // their submit button does. A draft change must not discover new
                // metrics or move its neighbours after the initial publication.
                const overflowing=field.options.filter(option=>metrics.intrinsic(option.label,'select').width+56>selectWidth-12);
                const summaryHeight=Math.max(0,...overflowing.map(option=>metrics.exact(option.label,'body',fieldWidth).height));
                const overflow=selectedLabel&&overflowing.some(option=>option.id===selected);
                const summary=summaryHeight>0?[group(key('select-summary-envelope',field.id),fieldWidth,summaryHeight,overflow?[{fragment:textNode(key('select-summary',field.id),selectedLabel,'body',fieldWidth,metrics),x:0,y:0}]:[])]:[];
                if(inlineLabels){const label=textNode(key('field-label',field.id),field.label,'small',labelWidths[index],metrics),height=Math.max(label.height,envelope.height);return group(key('field',field.id),fieldWidth,height,[{fragment:label,x:0,y:(height-label.height)/2},{fragment:envelope,x:label.width+SMALL_GAP,y:0}]);}
                return column(key('field',field.id),fieldWidth,[textNode(key('field-label',field.id),field.label,'small',fieldWidth,metrics),envelope,...summary],SMALL_GAP);
            }
            const options = field.options.map(option => button(key('option', field.id, option.id), option.label, fieldWidth, metrics, { kind: 'choice', fieldId: field.id, optionId: option.id, enabled: option.enabled, checked: choices.values?.[field.id] === option.id }));
            return column(key('field', field.id), fieldWidth, [textNode(key('field-label', field.id), field.label, 'small', fieldWidth, metrics), rows(key('options', field.id), fieldWidth, options, { semanticRole: 'radiogroup', label: field.label }, compact?'center':'start')], SMALL_GAP);
        });
        const commandViews=choices.cards?[...(choices.selected?[choices.selected]:[]),...choices.commands]:[...choices.commands,...(choices.selected?[choices.selected]:[])];
        if(footerBudget!==undefined&&!choices.cards)commandViews.sort((a,b)=>Number(b.intent==='primary')-Number(a.intent==='primary'));
        const commandFragment=(command:typeof commandViews[number],allocation:number)=>button(choices.cards&&command===choices.selected?'card-selection-submit':key('command',command.id),command.label,allocation,metrics,{...(choices.cards?.batch&&command===choices.selected?{localIntent:'submit-card-set' as const}:{actionId:command.id}),enabled:command.enabled,intent:command.intent},command===choices.selected?choices.selectionPresentation?.submitLabels??choices.cards?.submitLabels??choices.selectedLabels:undefined,choices.cards&&command===choices.selected?'content':'prominent');
        const commands=commandViews.map(command=>commandFragment(command,width));
        const fieldRows=(inline||inlineLabels)&&fields.length?[rows('decision-fields',width,fields,{},'center')]:fields;
        if(choices.cards||choices.selectionPresentation){
            // Feedback and confirmation form one measured semantic region. Paint
            // intent does not impose an arbitrary button width. Future labels
            // reserve this region before the player changes the draft.
            const labels=choices.selectionPresentation?.statusLabels??(choices.cards?.statusLabels?.length?choices.cards.statusLabels:[choices.cards!.label]);
            const variantChoices=(choices.cards?.actionVariants?.length??0)>1;
            const actionVocabulary=!!choices.selectionPresentation?.actionVariantLabelGroups?.length||choices.cards?.actionVariants!==undefined;
            const statusDomain=actionVocabulary?[...labels,'내기 방법']:labels;
            const natural=actionVocabulary?button('selection-status-measure',statusDomain[0],width,metrics,{intent:'secondary'},statusDomain,'content').width:Math.max(...labels.map(label=>metrics.intrinsic(label,'small').width));
            const future=choices.selectionPresentation?.submitLabels??choices.cards!.submitLabels;
            const submitAt=(allocation:number):Fragment|null=>{
                if(choices.selected)return commandFragment(choices.selected,allocation);
                if(!future.length)return null;
                const reserved=button('selection-future',future[0],allocation,metrics,{intent:'primary'},future,'content');
                return group('selection-future-reservation',reserved.width,reserved.height,[]);
            };
            const statusAt=(allocation:number):Fragment=>{
                if(actionVocabulary){
                    const label=variantChoices?'내기 방법':choices.cards?.label??labels[0];
                    const measured=button('card-action-open',label,allocation,metrics,{cardActionPickerIntent:{kind:'open'},enabled:variantChoices,checked:!!choices.cardActionPicker,intent:'secondary'},statusDomain,'content');
                    if(variantChoices)return measured;
                    const paint=choices.cards?textNode('card-selection-status',choices.cards.label,'small',Math.max(1,measured.width),metrics):null;
                    return group('card-selection-status-envelope',measured.width,measured.height,paint?[{fragment:paint,x:0,y:Math.max(0,(measured.height-paint.height)/2)}]:[]);
                }
                const text=choices.cards?textNode('card-selection-status',choices.cards.label,'small',allocation,metrics):group('card-selection-status',allocation,0,[]);
                const height=Math.max(text.height,...labels.map(label=>metrics.exact(label,'small',allocation).height));
                return {...text,height,nodes:[{...text.nodes[0],box:{...text.nodes[0].box,height}},...text.nodes.slice(1)]};
            };
            const submit=submitAt(width),status=statusAt(width);
            let primary=column('decision-primary',width,[status,...(submit?[rows('decision-confirmation',width,[submit],{},'center')]:[])],4);
            if(submit){
                const fits=natural+GAP+submit.width<=width;
                const pairedSubmit=fits?submit:submitAt(Math.max(TARGET,Math.min(submit.width,width*.45)))!;
                const statusWidth=width-GAP-pairedSubmit.width;
                if(statusWidth>0){
                    const pairedStatus=statusAt(fits?Math.max(1,natural):statusWidth),height=Math.max(pairedStatus.height,pairedSubmit.height);
                    if(height<=primary.height)primary=group('decision-primary',width,height,[{fragment:pairedStatus,x:0,y:(height-pairedStatus.height)/2},{fragment:pairedSubmit,x:width-pairedSubmit.width,y:(height-pairedSubmit.height)/2}]);
                }
            }
            const auxiliary=commands.slice(choices.selected?1:0);
            return column('decisions',width,[primary,...fieldRows,...(auxiliary.length?[rows('decision-commands',width,auxiliary,{},compact?'center':'start')]:[])],4);
        }
        if(choices.fields.some(field=>field.catalogue)){
            const selected=choices.selected?commandFragment(choices.selected,width):null;
            const primary=column('decision-primary',width,[...fieldRows,...(selected?[rows('decision-confirmation',width,[selected],{},'center')]:[])],4);
            const auxiliary=commands.filter((_command,index)=>commandViews[index]!==choices.selected);
            return column('decisions',width,[primary,...(auxiliary.length?[rows('decision-commands',width,auxiliary)]:[])],4);
        }
        const commandRows=commands.length?[rows('decision-commands',width,commands,{},compact?'center':'start')]:[];
        return column('decisions',width,footerBudget!==undefined?[...commandRows,...fieldRows]:[...fieldRows,...commandRows],footerBudget!==undefined?4:GAP);
    }
    function opponents(items: readonly OpponentView[], width: number, metrics: Measurements, id: string,choices?:ChoiceView,reserveSignals=!!(choices?.assistance||choices?.feedback),compactIdentity=false,statusDocument?:HudReadContext,rowWidths?:readonly number[],arrangement:'portrait'|'adjacent'='portrait',peerFigureOverride?:number,retainFeedback=false): Fragment {
        reserveSignals=reserveSignals||!!statusDocument&&!statusDocument.outcome&&statusDocument.stage!=='waiting';
        const defaultAllocation=items.length===1?width:(width-SMALL_GAP)/2;
        const children=items.map((person,index)=>{
            const allocation=rowWidths?.[index]??defaultAllocation;
            const cell=key('opponent',person.id), identityWidth=rowWidths||arrangement==='adjacent'?allocation:Math.min(144,allocation), offset=(allocation-identityWidth)/2;
            const figureSize=peerFigureOverride??(!statusDocument?.outcome?shortLandscapePresentation(metrics.environment)?.peerFigure??PEER_FIGURE_SIZE:PEER_FIGURE_SIZE);
            const art=leaf({id:key(cell,'figure'),parent:null,kind:'figure',appearance:person.appearance,ownerId:person.id,...participantFigureCue(person.id,choices),...(choices?.feedback?.clock?.participantId===person.id?{clockPaint:choices.feedback.clock,clockTextScale:metrics.environment.textScale}:{}),label:person.name,box:{x:0,y:0,width:figureSize,height:figureSize*110/120}});
            const pileId=key(cell,'hand'),pile=leaf({id:pileId,parent:null,kind:'group',label:'',inert:true,recipientId:person.id,recipientCount:person.handCount,box:{x:0,y:0,width:figureSize,height:figureSize*110/120}});
            const identity=participantIdentity({id:key(cell,'identity'),ownerId:person.id,nameId:key(cell,'name'),badgeId:key(cell,'name-badge'),figure:art,width:identityWidth,name:person.name,nameRole:PEER_NAME_ROLE,metaNatural:participantMetaWidth(person.status,[],statusDocument,metrics),markers:[],arrangement:'portrait',standing:allocation=>participantStanding(person.id,allocation,metrics,person.status,statusDocument),signals:allocation=>participantSignals(person.id,allocation,metrics,choices,reserveSignals,person.status,statusDocument,false,retainFeedback),metrics,thinking:person.appearance?.thinking,muted:person.status?.muted});
            const figureNode=identity.nodes.find(node=>node.id===art.nodes[0].id)!;
            const anchored={...identity,nodes:[...identity.nodes,{...pile.nodes[0],parent:figureNode.parent,box:{...figureNode.box}}]};
            return group(cell,allocation,identity.height,[{fragment:anchored,x:offset,y:0}],{semanticRole:'group',label:person.name,accessibleDescription:`${person.name} · 카드 ${person.handCount}장`,deemphasized:person.status?.muted===true});
        });
        if(rowWidths){let x=0;const placements=children.map(fragment=>{const placement={fragment,x,y:0};x+=fragment.width+4;return placement;});return group(id,width,Math.max(0,...children.map(child=>child.height)),placements);}
        return rows(id,width,children);
    }
    function peerMinimumWidth<A>(person:OpponentView,document:TableDocument<A>,metrics:Measurements,figure:number):number {
        const glyph=(labels:readonly string[],role:TextRole)=>Math.max(0,...[...new Set(labels.flatMap(label=>Array.from(label)))].map(char=>metrics.intrinsic(char,role).width));
        const atoms=person.status?.value.kind==='inline'?person.status.value.values:person.status?[person.status.value]:[];
        const labels=atoms.map(atom=>informationText(document,atom));
        const meta=Math.max(glyph(labels.concat((person.status?.badges??[]).map(badge=>badge.text)),'small')+8,...atoms.map(atom=>atom.kind==='suit'?32*metrics.environment.textScale+8:atom.kind==='card'?24*metrics.environment.textScale+8:0));
        return Math.max(participantFigureMinimumWidth(figure),glyph([person.name],PEER_NAME_ROLE)+16,meta+(!document.outcome?(metrics.environment.scrollbarWidth??0):0));
    }
    /** Existing adjacent/stacked peer recipe, admitted before construction. */
    function adjacentPeerArena<A>(document:TableDocument<A>,width:number,metrics:Measurements,choices:ChoiceView|undefined,columns:number,figure:number):Fragment|null {
        const people=[...(document.opponents??[])].reverse(),allocation=(width-SMALL_GAP*(columns-1))/columns;
        if(allocation<=0||people.some(person=>peerMinimumWidth(person,document,metrics,figure)>allocation))return null;
        const cells=people.map(person=>opponents([person],allocation,metrics,key('adjacent-peer',person.id),choices,true,true,document,undefined,'adjacent',figure));
        const peers=rows('opponents-upper',width,cells,{},'center'),collections=publicCollections(document,width,metrics,'collections',false,true,choices);
        const arena=column('arena',width,[peers,...(document.outcome?.overview?[overviewFragment(document.outcome.overview,width,metrics)]:[]),collections],GAP);
        return {...arena,requiredVisibleHeight:arena.height};
    }
    /** Width-bound table recipe: clockwise seats surround a separately measured center. */
    function overviewFragment(document:DisclosureDocument,width:number,metrics:Measurements):Fragment {
        const result=createOutcomeOverviewLayout(document,width,metrics.environment,{text:(id,label,role,allocation)=>textNode(id,label,role,allocation,metrics),group,column,rows,measureText:(label,role)=>metrics.intrinsic(label,role),card:(id,card,artWidth,artHeight)=>leaf({id,parent:null,kind:'card',label:card.label,visual:card.visual,emphasis:card.emphasis,box:{x:0,y:0,width:artWidth,height:artHeight}})});
        return {...result,nodes:[...result.nodes]};
    }
    function seatArena<A>(document:TableDocument<A>,width:number,minHeight:number,metrics:Measurements,choices?:ChoiceView,compactParticipants=false,visibleBudget?:number,peerFigureOverride?:number,scene?:{centerHeight:number;columns:{wing:number;centerWidth:number}}):Fragment {
        const people=document.opponents??[],overview=document.outcome?.overview,peerFigure=peerFigureOverride??(!document.outcome?shortLandscapePresentation(metrics.environment)?.peerFigure??PEER_FIGURE_SIZE:PEER_FIGURE_SIZE);
        const ringGap=!document.outcome&&shortLandscapePresentation(metrics.environment)?SMALL_GAP:GAP;
        const primaryContentHeight=(content:Fragment)=>{
            const play=(document.collections??[]).filter(zone=>zone.cards.length>0&&zone.relevance!=='auxiliary'&&(zone.purpose==='play'||zone.kind==='trick'));
            const primary=play.length?play:(document.collections??[]).filter(zone=>zone.purpose==='stock'&&(zone.hiddenCount??0)>0);
            const ids=new Set(primary.map(zone=>key('collection',zone.id)));
            return Math.max(0,...content.nodes.filter(node=>ids.has(node.id)&&node.parent==='collections').map(node=>node.box.y+node.box.height));
        };
        if(people.length<3||people.length>5){const peers=opponents(people,width,metrics,'opponents-upper',choices,!!(document.assistance||document.feedback||choices?.assistance||choices?.feedback),compactParticipants,document,undefined,'portrait',peerFigureOverride,!!scene),collections=publicCollections(document,width,metrics,'collections',false,compactParticipants,choices),primary=primaryContentHeight(collections);return {...column('arena',width,[peers,...(overview?[overviewFragment(overview,width,metrics)]:[]),collections]),requiredVisibleHeight:peers.height+(primary?ringGap+primary:0)};}

        const shortPresentation=!document.outcome?shortLandscapePresentation(metrics.environment):null;
        if(shortPresentation&&compactParticipants){
            const ordered=[...people].reverse(),gutter=metrics.environment.scrollbarWidth??0;
            const minimums=ordered.map(person=>{
                const atoms=person.status?.value.kind==='inline'?person.status.value.values:person.status?[person.status.value]:[];
                const statusValue=atoms.reduce((sum,atom)=>sum+(atom.kind==='suit'?32*metrics.environment.textScale:atom.kind==='card'?24*metrics.environment.textScale:metrics.intrinsic(informationText(document,atom),'small').width),0)+SMALL_GAP*Math.max(0,atoms.length-1);
                const badges=(person.status?.badges??[]).map(badge=>metrics.intrinsic(badge.text,'small').width+8),caption=(person.status?statusValue+8:0)+badges.reduce((sum,value)=>sum+value,0)+4*Math.max(0,badges.length+(person.status?1:0)-1);
                return Math.max(metrics.intrinsic(person.name,PEER_NAME_ROLE).width+16,participantFigureMinimumWidth(peerFigureOverride??shortPresentation.peerFigure),Math.min(caption,144))+gutter;
            });
            const allocations=allocateCompactPeerRow(width,minimums);
            if(allocations){
                const peers=opponents(ordered,width,metrics,'opponents-upper',choices,!!(document.assistance||document.feedback||choices?.assistance||choices?.feedback),true,document,allocations,'portrait',peerFigureOverride,!!scene);
                const collections=publicCollections(document,width,metrics,'collections',false,true,choices);
                const height=peers.height+SMALL_GAP+collections.height;
                return {...group('arena',width,Math.max(minHeight,height),[{fragment:peers,x:0,y:0},{fragment:collections,x:0,y:peers.height+SMALL_GAP}]),requiredVisibleHeight:height,...(collections.primaryCardBand?{primaryCardBand:{...collections.primaryCardBand,y:peers.height+SMALL_GAP+collections.primaryCardBand.y}}:{})};
            }
        }
        const settledIdentityWidth=(person:OpponentView)=>participantIdentityWidth({arrangement:'portrait',figureSize:peerFigure,nameNatural:metrics.intrinsic(person.name,PEER_NAME_ROLE).width+16,metaNatural:participantMetaWidth(person.status,[],document,metrics)});
        const peerPaintMinimum=participantFigureMinimumWidth(peerFigure);
        const originalWing=Math.min(144,Math.max(peerPaintMinimum,peerFigure+SMALL_GAP*2));
        const capacity=people.length+(document.participant.role==='observer'?0:1);
        const shortPublic=!document.outcome?shortLandscapePresentation(metrics.environment)?.publicCard:null;
        const auxiliaryStock=(document.collections??[]).find(zone=>zone.hiddenCount!==undefined&&zone.relevance==='auxiliary');
        const captionWidth=auxiliaryStock?Math.max(...Array.from({length:105},(_,count)=>metrics.intrinsic(`${count}장`,'small').width)):0;
        const primaryTrickMinimum=Math.max(scene?REGULAR_TRICK.minimumWidth:shortPublic?shortPublic.width:88,...(document.collections??[]).filter(zone=>zone.kind==='trick'&&zone.purpose==='play'&&zone.relevance!=='auxiliary').map(zone=>{
            const primary=!shortPublic&&directionalOwners(document)&&width>=REGULAR_TRICK.minimumWidth+peerFigure*2+ringGap*2?REGULAR_TRICK.minimumWidth:(shortPublic?.width??64)+Math.max(0,Math.max(capacity,zone.cards.length)-1)*EXPOSED;
            return shortPublic&&auxiliaryStock?primary+SMALL_GAP+Math.max(24,captionWidth):primary;
        }));
        const preferredWing=overview?Math.min(144,Math.max(originalWing,...people.map(settledIdentityWidth))):Math.min(144,Math.max(peerPaintMinimum,...people.map(settledIdentityWidth),(width-primaryTrickMinimum-ringGap*2)/2));
        const minimumWing=Math.max(peerPaintMinimum,...people.map(person=>peerMinimumWidth(person,document,metrics,peerFigure)));
        const allocation=scene?.columns??allocateRing({width,gap:ringGap,preferredWing,minimumWing,minimumCenter:primaryTrickMinimum});
        if(!allocation){
            const fallback=adjacentPeerArena(document,width,metrics,choices,2,peerFigure)??adjacentPeerArena(document,width,metrics,choices,1,peerFigure);
            if(!fallback)throw Error('Participant artwork and readable labels exceed the available arena width');
            return fallback;
        }
        const {wing,centerWidth}=allocation;
        const upper=opponents([...people.slice(1,-1-(people.length===5?1:0))].reverse(),Math.max(1,compactParticipants?width:width-wing),metrics,'opponents-upper',choices,!!(document.assistance||document.feedback||choices?.assistance||choices?.feedback),compactParticipants,document,undefined,'portrait',peerFigureOverride,!!scene);
        const left=opponents([people[Math.min(3,people.length-1)]],wing,metrics,'opponents-left',choices,!!(document.assistance||document.feedback||choices?.assistance||choices?.feedback),compactParticipants,document,undefined,'portrait',peerFigureOverride,!!scene);
        const right=opponents([people[0]],wing,metrics,'opponents-right',choices,!!(document.assistance||document.feedback||choices?.assistance||choices?.feedback),compactParticipants,document,undefined,'portrait',peerFigureOverride,!!scene);
        const activePrimary=(document.collections??[]).filter(zone=>zone.cards.length>0&&zone.relevance!=='auxiliary'&&(zone.purpose==='play'||zone.kind==='trick'));
        const centerDocument=!document.outcome?{...document,collections:[...activePrimary,...(document.collections??[]).filter(zone=>!activePrimary.includes(zone))]}:document;
        const center=overview?column('settled-board-center',centerWidth,[overviewFragment(overview,centerWidth,metrics),publicCollections({...document,collections:(document.collections??[]).map(zone=>zone.purpose==='captured'?{...zone,relevance:'auxiliary' as const}:zone)},centerWidth,metrics,'collections',false,true,choices)],SMALL_GAP):publicCollections(centerDocument,centerWidth,metrics,'collections',false,compactParticipants,choices);
        const middleHeight=Math.max(left.height,right.height,scene?.centerHeight??center.height);
        const bottom=people.length===5?opponents([people[4]],wing,metrics,'opponents-bottom',choices,!!(document.assistance||document.feedback||choices?.assistance||choices?.feedback),compactParticipants,document,undefined,'portrait',peerFigureOverride,!!scene):null;
        const minimum=upper.height+ringGap+middleHeight+(bottom?ringGap+bottom.height:0);
        const requiredVisibleHeight=upper.height+ringGap+Math.max(left.height,right.height,primaryContentHeight(center))+(bottom?ringGap+bottom.height:0);
        const height=Math.max(minHeight,minimum);
        const middleY=upper.height+ringGap+(scene?0:(height-minimum)*.5);
        const visibleMiddleBottom=visibleBudget===undefined?undefined:visibleBudget-(bottom?ringGap+bottom.height:0);
        const sideY=(identity:Fragment)=>{const centered=middleY+(middleHeight-identity.height)/2;return !document.outcome&&visibleMiddleBottom!==undefined&&middleY+identity.height<=visibleMiddleBottom?Math.max(middleY,Math.min(centered,visibleMiddleBottom-identity.height)):centered;};
        return {...group('arena',width,height,[
            {fragment:upper,x:compactParticipants?0:wing/2,y:scene?0:(height-minimum)*.2},
            {fragment:left,x:0,y:sideY(left)},
            {fragment:center,x:wing+ringGap,y:middleY+(scene?Math.max(0,(middleHeight-center.height)/2):(middleHeight-center.height)/2)},
            {fragment:right,x:width-wing,y:sideY(right)},
            ...(bottom?[{fragment:bottom,x:(width-wing)/2,y:!document.outcome&&visibleBudget!==undefined&&requiredVisibleHeight<=visibleBudget?visibleBudget-bottom.height:height-bottom.height}]:[]),
        ]),requiredVisibleHeight,...(scene?{sceneContentHeight:minimum,sceneCenterY:middleY}:{})};
    }
    /** The settled board preserves the live seat relationships. Read-only
     * historical extras follow this primary ring instead of preceding people. */
    function settledArena<A>(document:TableDocument<A>,width:number,metrics:Measurements,choices:ChoiceView,peerFigure?:number):{fragment:Fragment;firstBlockHeight:number;priorityHeight:number} {
        const zones=document.collections??[],play=zones.filter(zone=>zone.cards.length&&zone.purpose==='play'),lastCaptured=zones.filter(zone=>zone.purpose==='captured'&&zone.cards.length).at(-1),priority=play.length?play:lastCaptured?[lastCaptured]:[];
        const stocks=zones.filter(zone=>zone.purpose==='stock'),remaining=zones.filter(zone=>!priority.includes(zone)&&!stocks.includes(zone)&&zone.cards.length);
        const ring=seatArena({...document,collections:[...priority.map(zone=>({...zone,relevance:'primary' as const})),...stocks.map(zone=>({...zone,relevance:'auxiliary' as const}))]},width,0,metrics,choices,true,undefined,peerFigure);
        const trailing=remaining;
        const history=trailing.length?publicCollections({...document,collections:trailing},width,metrics,'settled-history'):null;
        // Reserve current public collection destinations and complete seat
        // identities, rather than every auxiliary/history block in the ring.
        const index=new Map(ring.nodes.map(node=>[node.id,node])),tops=new Map<string,number>();
        const top=(node:PlannedNode):number=>{const cached=tops.get(node.id);if(cached!==undefined)return cached;const parent=node.parent?index.get(node.parent):undefined;const value=node.box.y+(parent?top(parent):0);tops.set(node.id,value);return value;};
        const peerRoots=new Set(['opponents-upper','opponents-left','opponents-right','opponents-bottom']);
        const participantPaintBottoms=ring.nodes.filter(node=>node.kind==='figure'&&node.ownerId).map(node=>{const paint=figurePaintBounds({...node.box,y:top(node)},true);return paint.y+paint.height;});
        const priorityZoneIds=new Set(priority.map(zone=>zone.id)),priorityRoots=new Set(priority.map(zone=>key('collection',zone.id)));
        const priorityHeight=Math.ceil(Math.max(TARGET,ring.requiredVisibleHeight??0,...participantPaintBottoms,...ring.nodes.filter(node=>peerRoots.has(node.id)||node.readonlyMatrixViewport||priorityRoots.has(node.id)||node.kind==='card'&&!!node.entityId&&!!node.zoneId&&priorityZoneIds.has(node.zoneId)).map(node=>top(node)+node.box.height)));
        const content=column('settled-arena',width,[ring,...(history?[history]:[])],GAP),height=Math.max(content.height,priorityHeight);
        // Materialize the already reserved integral priority allocation. Native
        // clientHeight rounding must not shorten a fractional content root.
        const fragment={...content,height,nodes:content.nodes.map((node,index)=>index===0?{...node,box:{...node.box,height}}:node)};
        return {fragment,firstBlockHeight:priorityHeight,priorityHeight};
    }
    const shellIcons={share:'invite',people:'watch',menu:'menu',rules:'book',scores:'result',settings:'sliders',manage:'sliders',operation:'sliders',report:'flag',leave:'leave',close:'close',confirm:'leave',cancel:'close'} as const;
    function shellTool<A>(document:TableDocument<A>,action:RoomShellAction,id:string,width:number,metrics:Measurements,choices:ChoiceView,visibleText:string|null=action.label,pill=false,fill=false,compactChrome=false):Fragment {
        const scale=metrics.environment.textScale,iconSize=compactChrome?24:24*Math.max(1,scale),padding=compactChrome?8:12,gap=compactChrome?6:8;
        const natural=visibleText===null?Math.max(TARGET,iconSize+16):iconSize+gap+metrics.intrinsic(visibleText,'button').width+padding*2;
        const allocation=Math.max(TARGET,fill?width-12:Math.min(width-12,natural));
        const textWidth=Math.max(1,allocation-padding*2-iconSize-gap);
        const text=visibleText===null?null:textNode(key(id,'label'),visibleText,'button',textWidth,metrics);
        const height=Math.max(TARGET,iconSize+16,(text?.height??0)+20);
        const icon=leaf({id:key(id,'icon'),parent:null,kind:'icon',shellIcon:shellIcons[action.purpose],label:'',box:{x:0,y:0,width:iconSize,height:iconSize}});
        const leave=action.intent.kind==='request-effect'&&action.intent.effect==='leave-room';
        const enabled=action.enabled&&(action.intent.kind!=='command'||!!choices.shellCommandEnabled)&&(!leave||!document.shell?.leaveActionId||!!choices.shellLeaveEnabled)&&(!(action.intent.kind==='request-effect'&&(!leave||!document.shell?.leaveActionId))||!!choices.effectsAvailable);
        const control=group(id,allocation,height,[{fragment:icon,x:visibleText===null?(allocation-iconSize)/2:pill?allocation-padding-iconSize:padding,y:(height-iconSize)/2},...(text?[{fragment:text,x:pill?padding:padding+iconSize+gap,y:(height-text.height)/2}]:[])],{kind:'command',paintChildren:true,label:action.label,role:'button',enabled,shellActionId:action.id,shellIntent:action.intent,intent:action.purpose==='confirm'?'danger':action.purpose==='close'||action.purpose==='menu'?'quiet':'secondary',...(pill?{decoration:'pill' as const}:{})});
        return group(key('tool-envelope',id),allocation+12,height+12,[{fragment:control,x:6,y:6}]);
    }
    function activeStatus(document:HudReadContext,width:number,metrics:Measurements,section:'all'|'fields'|'context'='all'):Fragment|null {
        const reference=document.statusPresentation,panel=document.information?.find(panel=>panel.id===reference?.informationId),essential=document.facts.filter(fact=>fact.essential);if(document.outcome||document.stage==='waiting'||!panel&&!essential.length)return null;
        const fields:Fragment[]=[];
        const pair=(id:string,label:string|undefined,value:InformationValue)=>{
            const atoms=value.kind==='inline'?value.values:[value],natural=atoms.reduce((sum,atom)=>sum+(atom.kind==='card'?24*metrics.environment.textScale:atom.kind==='suit'?32*metrics.environment.textScale:metrics.intrinsic(informationText(document,atom),atom.kind==='participant'?'name':'body').width),0)+SMALL_GAP*Math.max(0,atoms.length-1),labelWidth=label?metrics.intrinsic(label,'small').width:0,allocation=Math.max(1,Math.min(width,labelWidth+(label?SMALL_GAP:0)+natural));
            const text=label?textNode(key(id,'label'),label,'small',labelWidth+(label?SMALL_GAP:0)+natural<=width?labelWidth:Math.min(labelWidth,allocation*.4),metrics):null,valuePart=valueFragment(document,value,key(id,'value'),Math.max(1,allocation-(text?text.width+SMALL_GAP:0)),metrics);return group(id,allocation,Math.max(text?.height??0,valuePart.height),[...(text?[{fragment:text,x:0,y:0}]:[]),{fragment:valuePart,x:text?text.width+SMALL_GAP:0,y:0}]);
        };
        if(reference?.primary&&panel?.primary)fields.push(pair('active-status-primary',panel.primary.label,panel.primary.value));
        for(const id of reference?.fieldIds??[]){const field=panel?.fields.find(field=>field.id===id);if(field)fields.push(pair(key('active-status-field',id),field.label,field.value));}
        const progress=reference?.progress?panel?.progress:undefined;
        const progressSummary=progress?progress.series.map(series=>`${series.label} ${series.value}${series.from==='start'&&progress.target!==undefined?`/${progress.target}`:''}`).join(' · '):null;
        const progressText=progressSummary?textNode('active-status-progress',progressSummary,'small',width,metrics):null;
        const compactProgress=progress&&progressText?{...progressText,nodes:progressText.nodes.map(node=>({...node,accessibleDescription:`${progress.label} · ${progressSummary} · 전체 ${progress.total}${progress.target!==undefined?` · 목표 ${progress.target}`:''}`}))}:null;
        const children=[...(section!=='context'&&fields.length?[rows('active-status-fields',width,fields,{},'center')]:[]),...(section!=='fields'&&reference?.summary&&panel?.summary?[summaryInk(textNode('active-status-summary',panel.summary.text,'small',width,metrics),document)]:[]),...(section!=='fields'&&compactProgress?[compactProgress]:[]),...(section!=='context'?essential.map(fact=>textNode(key('active-essential-fact',fact.id),`${fact.label}: ${fact.value}`,'body',width,metrics)):[])];
        if(!children.length)return null;
        const content=column(section==='all'?'table-active-status':`table-active-status-${section}`,width,children,4);return {...content,nodes:[{...content.nodes[0],semanticRole:'status',label:'현재 게임 상태'},...content.nodes.slice(1)]};
    }
    function informationStatus(status:Fragment,choices:ChoiceView):Fragment{
        if(choices.publicCompletion||status.height<TARGET||!readonlyInformationContent(status.nodes,status.nodes[0].id))return status;
        const labels=status.nodes.filter(node=>node.kind==='text'||node.kind==='suit').map(node=>node.label).filter(Boolean);
        return group('active-information',status.width,status.height,[{fragment:status,x:0,y:0}],{kind:'command',paintChildren:true,role:'button',localIntent:'toggle-information',enabled:true,intent:'quiet',label:`테이블 정보 · ${labels.join(' ')}`});
    }
    function shellHeader<A>(document:TableDocument<A>,width:number,metrics:Measurements,choices:ChoiceView,statusSection:'all'|'fields'|'none'='all',headerTools?:Fragment,hud?:HudReadContext):Fragment|null {
        const shell=document.shell,renderOutcome=hud?hud.outcome:document.outcome;if(!shell)return null;
        const actions=shell.header.actions,compactChrome=width<480,headerGap=compactChrome?4:SMALL_GAP;
        const fragments=actions.map(action=>{
            const visual=action.purpose==='share'?`● ${shell.roomCode}`:action.purpose==='people'?(width<480?String(shell.header.requestCount||shell.header.observerCount):shell.header.requestCount?shell.header.requestLabel:shell.header.observerLabel):null;
            const planned=shellTool(document,action,key('shell-action','header',action.id),width,metrics,choices,visual,action.purpose==='share',false,compactChrome);
            const fragment=action.purpose==='people'||action.purpose==='settings'?{...planned,nodes:planned.nodes.map(node=>node.shellActionId===action.id?{...node,intent:'quiet' as const}:node)}:planned;
            if(action.purpose==='people')return {...fragment,nodes:fragment.nodes.map(node=>node.shellActionId===action.id?{...node,label:`${shell.header.observerLabel} · ${shell.header.requestLabel} · ${action.label}`}:node)};
            if(action.purpose!=='share')return fragment;
            return {...fragment,nodes:fragment.nodes.map(node=>node.shellActionId===action.id?{...node,label:`${shell.header.connectionLabel} · ${shell.roomCode} · ${action.label}`,shellSlot:'room-code' as const,connectionState:shell.header.connection}:node)};
        });
        const total=fragments.reduce((sum,fragment)=>sum+fragment.width,0)+headerGap*Math.max(0,fragments.length-1);
        let bar:Fragment;
        if(total<=width){let x=0;bar=group('room-header',width,Math.max(1,...fragments.map(fragment=>fragment.height)),fragments.map((fragment,index)=>{const placement={fragment,x:index===fragments.length-1?width-fragment.width:x,y:0};x+=fragment.width+headerGap;return placement;}));}
        else bar=rows('room-header',width,fragments,{},'start',headerGap);
        const emptySlot=headerPassiveSlot(bar.nodes);if(emptySlot)bar={...bar,nodes:[...bar.nodes,{id:'observer-reaction-slot',parent:bar.nodes[0].id,kind:'group',label:'',observerReactionSlot:true,box:emptySlot}]};
        const short=!renderOutcome&&document.stage!=='waiting'&&shortLandscapePresentation(metrics.environment),sideWidth=width-total-GAP,gutter=metrics.environment.scrollbarWidth??0;
        const beside=!headerTools&&!!short&&total<=width&&sideWidth>=240*metrics.environment.textScale,toolsBeside=!!headerTools&&width-headerTools.width-GAP>=TARGET,noticeWidth=toolsBeside?width-headerTools!.width-GAP:beside?sideWidth:width;
        if(statusSection==='none'&&!shell.notices.length&&!headerTools)return group('room-shell',width,bar.height,[{fragment:bar,x:0,y:0}]);
        let status=statusSection==='none'?null:activeStatus(hud??document,noticeWidth-gutter,metrics,statusSection);
        if(headerTools&&status)status=informationStatus(status,choices);
        const content=column('room-notice-content',noticeWidth-gutter,[...(status?[status]:[]),...shell.notices.map(notice=>textNode(key('room-notice',notice.id),notice.text,'small',noticeWidth-gutter,metrics))],4);
        const noticeHeight=beside?Math.max(TARGET,status?.height??0,content.height):document.stage==='waiting'||renderOutcome?60:Math.max(TARGET,metrics.intrinsic('Ag','small').height*2+SMALL_GAP*2,status?.height??0);
        const notices=group('room-notices',noticeWidth,noticeHeight,[{fragment:content,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:metrics.environment.scrollbarWidth??0,semanticRole:'status',label:''});
        if(headerTools){const band=toolsBeside?group('room-status-tools',width,Math.max(notices.height,headerTools.height),[{fragment:notices,x:0,y:0},{fragment:headerTools,x:width-headerTools.width,y:(Math.max(notices.height,headerTools.height)-headerTools.height)/2}]):column('room-status-tools',width,[notices,headerTools],4);return column('room-shell',width,[bar,band],4);}
        if(beside){const compactBar=group('room-header',total,bar.height,fragments.map((fragment,index)=>({fragment,x:fragments.slice(0,index).reduce((sum,child)=>sum+child.width+headerGap,0),y:0})));return group('room-shell',width,Math.max(compactBar.height,notices.height),[{fragment:compactBar,x:0,y:0},{fragment:notices,x:total+GAP,y:0}]);}
        return column('room-shell',width,[bar,notices],4);
    }
    function namespace(fragment:Fragment,prefix:string):Fragment {
        const ids=new Map(fragment.nodes.map(node=>[node.id,key(prefix,node.id)]));
        return {...fragment,nodes:fragment.nodes.map(node=>({...node,id:ids.get(node.id)!,parent:node.parent?ids.get(node.parent)??node.parent:null}))};
    }
    function preferenceControl(field:PreferenceField,width:number,metrics:Measurements,choices:ChoiceView):Fragment {
        const id=key('preference',field.id),inner=Math.max(TARGET,width-12),enabled=field.enabled&&!!choices.preferencesAvailable;
        const labelWidth=field.kind==='toggle'?Math.max(1,width-(TARGET+12)-GAP):width;
        let control:Fragment;
        if(field.kind==='toggle'){
            control=leaf({id,parent:null,kind:'toggle',label:field.label,preference:field,enabled,box:{x:0,y:0,width:TARGET,height:TARGET}});
        }else if(field.kind==='select'){
            const height=nativeTextControlHeight(typography('select',metrics.environment).lineHeight);
            control=leaf({id,parent:null,kind:'select',role:'select',label:field.label,preference:field,options:field.options,selectedOptionId:field.value,enabled,box:{x:0,y:0,width:inner,height}});
        }else{
            control=leaf({id,parent:null,kind:'range',label:field.label,preference:field,enabled,box:{x:0,y:0,width:inner,height:TARGET}});
        }
        const envelope=group(key('preference-envelope',field.id),field.kind==='toggle'?TARGET+12:width,control.height+12,[{fragment:control,x:6,y:6}]);
        const labels=[textNode(key('preference-label',field.id),field.label,'body',labelWidth,metrics)];
        if(field.help)labels.push(textNode(key('preference-help',field.id),field.help,'small',labelWidth,metrics));
        if(field.kind==='select'){
            // Native popup options do not wrap. Retain the exact chosen label in
            // measured document flow when the closed select cannot display it.
            for(const option of field.options)metrics.exact(option.label,'select',Math.max(1,inner-56));
            const selected=field.options.find(option=>option.id===field.value);
            if(selected&&metrics.intrinsic(selected.label,'select').width+56>inner)labels.push(textNode(key('preference-value',field.id),selected.label,'body',width,metrics));
            if(selected?.help)labels.push(textNode(key('preference-option-help',field.id),selected.help,'small',width,metrics));
        }
        if(field.kind==='number')labels.push(textNode(key('preference-value',field.id),String(field.value),'small',width,metrics));
        if(field.kind==='toggle'){
            const label=column(key('preference-labels',field.id),labelWidth,labels,4),height=Math.max(label.height,envelope.height);
            return group(key('preference-row',field.id),width,height,[{fragment:label,x:0,y:(height-label.height)/2},{fragment:envelope,x:width-envelope.width,y:(height-envelope.height)/2}]);
        }
        return column(key('preference-row',field.id),width,[...labels,envelope],4);
    }
    function shellDialog<A>(document:TableDocument<A>,metrics:Measurements,choices:ChoiceView):Fragment|null {
        const shell=document.shell;if(!shell)return null;
        const confirmation=choices.shellCommandConfirmation??(choices.shellConfirmation?shell.leaveConfirmation:undefined);
        const page=shell.pages.find(page=>page.id===choices.shellPage);
        if(!confirmation&&!page)return null;
        const id='room-dialog',width=Math.max(1,Math.min(metrics.environment.width-32,560*metrics.environment.textScale)),available=width-PADDING*2;
        const subjectGroup=page?.id==='manage'&&choices.shellSubject?shell.management?.find(group=>sameRoomSubject(group.subject,choices.shellSubject)):undefined;
        const title=confirmation?.title??subjectGroup?.title??page!.title;
        const actions=confirmation?.actions??(page!.id==='manage'?[...page!.actions.filter(action=>action.purpose==='close'),...(subjectGroup?.actions??[])]:page!.actions);
        const close=actions.find(action=>action.purpose==='close'||action.purpose==='cancel');
        const headingAt=(available:number):Fragment=>{
            const closeButton=close?shellTool(document,close,key('shell-action',confirmation?'confirmation':`page:${page!.id}`,close.id),Math.min(available,72*metrics.environment.textScale),metrics,choices,null):null;
            const heading=textNode('room-dialog-title',title,'name',Math.max(1,available-(closeButton?closeButton.width+SMALL_GAP:0)),metrics);
            const height=Math.max(heading.height,closeButton?.height??0);
            return group('room-dialog-heading',available,height,[{fragment:heading,x:0,y:(height-heading.height)/2},...(closeButton?[{fragment:closeButton,x:available-closeButton.width,y:0}]:[])]);
        };
        const top=headingAt(available);
        const bodyAt=(available:number):Fragment=>{
        const children:Fragment[]=[];
        if(shell.notices.length){const notices=column('room-dialog-notice-content',available,shell.notices.map(notice=>textNode(key('room-dialog-notice',notice.id),notice.text,'small',available,metrics)),4);children.push(group('room-dialog-notices',available,notices.height,[{fragment:notices,x:0,y:0}],{semanticRole:'status',label:''}));}
        if(confirmation)children.push(textNode('room-leave-message',confirmation.message,'body',available,metrics));
        if(page&&!confirmation){
            const description=page.id==='manage'?subjectGroup?.description:page.description;
            if(description)children.push(textNode('room-page-description',description,'body',available,metrics));
            if(page.id!=='manage'){
            for(const field of page.preferences??[])children.push(preferenceControl(field,available,metrics,choices));
            if(page.people){
                for(const person of page.people){
                    const rowId=key('room-person',person.id),name=textNode(key(rowId,'name'),`${person.name}${person.mine?' · 나':''}`,'name',Math.max(1,available-52),metrics),status=textNode(key(rowId,'status'),person.status,'small',Math.max(1,available-52),metrics);
                    const identity=column(key(rowId,'identity'),Math.max(1,available-52),[name,status],4),figure=leaf({id:key(rowId,'figure'),parent:null,kind:'figure',appearance:{bot:person.kind==='bot'},label:person.name,box:{x:0,y:0,width:40,height:40}});
                    const portrait=group(key(rowId,'portrait'),available,Math.max(40,identity.height),[{fragment:figure,x:0,y:0},{fragment:identity,x:52,y:0}]);
                    children.push(column(rowId,available,[portrait,...(person.actions??[]).map(action=>shellTool(document,action,key('shell-action','person',person.id,action.id),available,metrics,choices,action.label,false,true))],4));
                }
                for(const seat of shell.seats??[]){
                    if(seat.kind!=='empty')continue;
                    const rowId=key('room-seat',String(seat.seat));
                    children.push(column(rowId,available,[textNode(key(rowId,'name'),seat.name,'name',available,metrics),...seat.actions.map(action=>shellTool(document,action,key('shell-action','seat',String(seat.seat),action.id),available,metrics,choices,action.label,false,true))],4));
                }
                if(page.anonymousObservers)children.push(textNode('room-anonymous-observers',`이름 없이 관전 중 · ${page.anonymousObservers}명`,'body',available,metrics));
                if(!page.people.length&&!page.anonymousObservers&&!shell.seats?.some(seat=>seat.kind==='empty'))children.push(textNode('room-no-people','아직 함께 있는 사람이 없어요','body',available,metrics));
            }
            for(const panel of page.information??[])children.push(namespace(informationPanel(document,panel,available,metrics),`dialog:${page.id}`));
            if(page.scoreboard)children.push(namespace(scoreboard({...document,scoreboard:page.scoreboard},available,metrics),`dialog:${page.id}`));
            }
        }
        children.push(...actions.filter(action=>action!==close).map(action=>shellTool(document,action,key('shell-action',confirmation?'confirmation':`page:${page!.id}`,action.id),available,metrics,choices,action.label,false,true)));
        return column('room-dialog-body',available,children,GAP);
        };
        let body=bodyAt(available);
        const maxHeight=Math.max(44,metrics.environment.height-32),fixed=top.height+GAP+PADDING*2,bodyHeight=Math.max(TARGET,Math.min(body.height,maxHeight-fixed));
        const gutter=metrics.environment.scrollbarWidth??0;
        if(fixed+TARGET>maxHeight){
            if(maxHeight<PADDING*2+TARGET)throw new Error('Viewport cannot contain a readable modal');
            const innerHeight=maxHeight-PADDING*2,innerWidth=available-gutter;
            const all=column('room-dialog-all',innerWidth,[headingAt(innerWidth),bodyAt(innerWidth)],GAP);
            const viewport=group('room-dialog-whole-scroll',available,innerHeight,[{fragment:all,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:gutter});
            return group(id,width,maxHeight,[{fragment:viewport,x:PADDING,y:PADDING}],{semanticRole:confirmation?'alertdialog':'dialog',label:title,decoration:'dialog'});
        }
        const scrollbar=body.height>bodyHeight?gutter:0;if(scrollbar)body=bodyAt(available-scrollbar);
        const bodyView=group('room-dialog-scroll',available,bodyHeight,[{fragment:body,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:scrollbar});
        const height=Math.min(maxHeight,Math.max(fixed+bodyHeight,top.height+PADDING*2));
        return group(id,width,height,[{fragment:top,x:PADDING,y:PADDING},{fragment:bodyView,x:PADDING,y:PADDING+top.height+GAP}],{semanticRole:confirmation?'alertdialog':'dialog',label:title,decoration:'dialog'});
    }
    function historicalDocument(record:DisclosureDocument):TableDocument<never> {
        return {context:{session:'historical',audience:'historical',generation:record.entryId,revision:'1'},participant:{id:'historical-reader',name:'기록',role:'observer',markers:[]},opponents:record.roster.map(person=>({id:person.id,name:person.name,handCount:0})),hand:[],facts:[],decision:{id:'historical',kind:'commands',commands:[]},offer:{id:'historical',actions:[]}};
    }
    function disclosureDialog(view:DisclosureView,metrics:Measurements):Fragment {
        return createDisclosureDialog(view,metrics.environment,{
            text:(id,value,role,width)=>textNode(id,value,role,width,metrics),
            button:(id,label,width,disclosureIntent,extra)=>button(id,label,width,metrics,{...extra,disclosureIntent}),
            column,rows,group,
            information:(record,panel,width,prefix)=>namespace(informationPanel(historicalDocument(record),panel,width,metrics),prefix),
            value:(record,value,width,id)=>valueFragment(historicalDocument(record),value,id,width,metrics),
            card:(id,card)=>leaf({id,parent:null,kind:'card',label:card.label,visual:card.visual,emphasis:card.emphasis,box:{x:0,y:0,width:64,height:90}})
        });
    }
    function formDialog<A>(document:TableDocument<A>,view:FormView,metrics:Measurements):Fragment {
        const {offer,leaseId}=view,width=Math.max(1,Math.min(metrics.environment.width-32,560*metrics.environment.textScale));
        const available=width-PADDING*2,gutter=metrics.environment.scrollbarWidth??0;
        const lockedStatuses=['queued','sending','accepted','processed','uncertain'];
        const locked=!!view.actions?.some(action=>lockedStatuses.includes(action.status??'')&&(offer.actions?.find(offered=>offered.id===action.id)?.completion??'lock')==='lock')||!offer.actions&&lockedStatuses.includes(view.status);
        const editable=offer.enabled&&!locked&&(!!view.actions||['editing','rejected','cancelled','stored','failed'].includes(view.status));
        const navigationEnabled=!view.composingFieldId;
        const activeFields=presentedFormFields(view),activeIds=new Set(activeFields.map(field=>field.id));
        const activeSection=offer.sections?.find(section=>section.id===(view.activeSection??offer.sections?.[0]?.id));
        const binding=(field:FormField,operation?:NonNullable<PlannedNode['formField']>['operation']):NonNullable<PlannedNode['formField']>=>({leaseId,fieldId:field.id,value:view.values[field.id],...(view.fieldLeases?.[field.id]?{fieldLeaseId:view.fieldLeases[field.id]}:{}),...(operation?{operation}:{})});
        const fieldEnabled=(field:FormField)=>editable&&view.reduction?.enabled[field.id]!==false;
        const nativeId=(field:FormField,kind:string)=>view.fieldLeases?.[field.id]?key(kind,leaseId,field.id,view.fieldLeases[field.id]):key(kind,leaseId,field.id);
        const bodyAt=(allocation:number):Fragment=>{
            const children:Fragment[]=[textNode(key('form-title',leaseId),offer.title,'name',allocation,metrics)];
            if(offer.help)children.push(textNode(key('form-help',leaseId),offer.help,'body',allocation,metrics));
            if(offer.sections?.length){
                const links=offer.sections.map(section=>button(key('form-section',leaseId,section.id),section.title,allocation,metrics,{formNavigation:{leaseId,sectionId:section.id},enabled:navigationEnabled,intent:section.id===activeSection?.id?'secondary':'quiet',checked:section.id===activeSection?.id}));
                children.push(rows(key('form-sections',leaseId),allocation,links));
            }
            if(view.issues.$form){const issue=textNode(key('form-global-issue',leaseId),view.issues.$form,'small',allocation,metrics);children.push({...issue,nodes:issue.nodes.map(node=>({...node,tone:'danger' as const}))});}
            const status=formStatus(view.status);
            if(status){const message=textNode(key('form-status',leaseId),status,'small',allocation,metrics);children.push({...message,nodes:message.nodes.map(node=>({...node,tone:view.status==='rejected'||view.status==='conflict'?'danger' as const:'muted' as const}))});}
            const summary=formSummaryItems(view),pageCount=Math.max(1,Math.ceil(summary.length/FORM_SUMMARY_PAGE_SIZE)),page=Math.max(0,Math.min(view.summaryPage??0,pageCount-1));
            if(summary.length){
                const entries=summary.slice(page*FORM_SUMMARY_PAGE_SIZE,(page+1)*FORM_SUMMARY_PAGE_SIZE).map(item=>item.fieldId?button(key('form-summary',leaseId,item.id),item.text,allocation,metrics,{formNavigation:{leaseId,fieldId:item.fieldId,...(item.sectionId?{sectionId:item.sectionId}:{})},enabled:navigationEnabled,intent:'quiet'}):textNode(key('form-summary',leaseId,item.id),item.text,'small',allocation,metrics));
                children.push(column(key('form-summary-list',leaseId),allocation,entries,4));
                if(pageCount>1)children.push(rows(key('form-summary-pages',leaseId),allocation,[button(key('form-summary-prev',leaseId),'이전 요약',allocation,metrics,{formNavigation:{leaseId,summaryPage:Math.max(0,page-1)},enabled:navigationEnabled&&page>0,intent:'quiet'}),textNode(key('form-summary-page',leaseId),`${page+1} / ${pageCount}`,'small',Math.min(allocation,metrics.intrinsic(`${page+1} / ${pageCount}`,'small').width),metrics),button(key('form-summary-next',leaseId),'다음 요약',allocation,metrics,{formNavigation:{leaseId,summaryPage:Math.min(pageCount-1,page+1)},enabled:navigationEnabled&&page+1<pageCount,intent:'quiet'})]));
            }
            if(activeSection?.help)children.push(textNode(key('form-section-help',leaseId,activeSection.id),activeSection.help,'small',allocation,metrics));
            const tool=(field:FormField,glyph:string,label:string,operation:'increment'|'decrement'|'reset',enabled:boolean):Fragment=>{
                const id=key('form-field-tool',leaseId,field.id,operation),fragment=button(id,glyph,allocation,metrics,{formField:binding(field,operation),enabled:enabled&&navigationEnabled,intent:'quiet'});
                const control=fragment.nodes.find(node=>node.id===id)!;
                const textWidth=Math.max(1,control.box.width-metrics.environment.controls.command.paddingX*2),paint=textNode(key(id,'paint'),glyph,'button',textWidth,metrics);
                return {...fragment,nodes:[...fragment.nodes.map(node=>node.id===id?{...node,label,paintChildren:true}:node),{...paint.nodes[0],parent:id,box:{...paint.nodes[0].box,x:(control.box.width-textWidth)/2,y:(control.box.height-paint.height)/2}}]};
            };
            const fieldAt=(field:FormField):Fragment=>{
                const id=key('form-field',leaseId,field.id),enabled=fieldEnabled(field),fieldChildren:Fragment[]=[];
                const labelWidth=field.kind==='toggle'?Math.max(1,allocation-56-GAP):allocation;
                fieldChildren.push(textNode(key('form-label',leaseId,field.id),field.label,'body',labelWidth,metrics));
                if(field.help)fieldChildren.push(textNode(key('form-field-help',leaseId,field.id),field.help,'small',labelWidth,metrics));
                let control:Fragment;
                if(field.kind==='toggle'){
                    const state=view.values[field.id]===true,word=state?field.onLabel:field.offLabel;
                    if(word)fieldChildren.push(textNode(key('form-field-state',leaseId,field.id),word,'small',labelWidth,metrics));
                    control=leaf({id:nativeId(field,'form-toggle'),parent:null,kind:'toggle',label:field.label,enabled:enabled&&navigationEnabled,checked:state,formField:binding(field,'toggle'),box:{x:0,y:0,width:TARGET,height:TARGET}});
                    const envelope=group(key('form-control-envelope',leaseId,field.id),56,56,[{fragment:control,x:6,y:6}]);
                    const labels=column(key('form-field-labels',leaseId,field.id),labelWidth,fieldChildren,4),height=Math.max(labels.height,envelope.height);
                    fieldChildren.splice(0,fieldChildren.length,group(key('form-toggle-row',leaseId,field.id),allocation,height,[{fragment:labels,x:0,y:(height-labels.height)/2},{fragment:envelope,x:allocation-envelope.width,y:(height-envelope.height)/2}]));
                }else if(field.kind==='select'){
                    const value=typeof view.values[field.id]==='string'?view.values[field.id] as string:undefined;
                    control=leaf({id:nativeId(field,'form-select'),parent:null,kind:'select',label:field.label,role:'select',enabled:enabled&&navigationEnabled,formField:binding(field,'choose'),options:field.options,selectedOptionId:value,box:{x:0,y:0,width:Math.max(TARGET,allocation-12),height:nativeTextControlHeight(typography('select',metrics.environment).lineHeight)}});
                    fieldChildren.push(group(key('form-control-envelope',leaseId,field.id),allocation,control.height+12,[{fragment:control,x:6,y:6}]));
                    const option=field.options.find(option=>option.id===value);
                    if(option&&metrics.intrinsic(option.label,'select').width+56>control.width)fieldChildren.push(textNode(key('form-select-value',leaseId,field.id),option.label,'body',allocation,metrics));
                    if(option?.help)fieldChildren.push(textNode(key('form-option-help',leaseId,field.id),option.help,'small',allocation,metrics));
                }else{
                    control=leaf({id:nativeId(field,'form-editor'),parent:null,kind:'editor',label:field.label,role:'select',enabled,
                        editor:{leaseId,fieldId:field.id,...(view.fieldLeases?.[field.id]?{fieldLeaseId:view.fieldLeases[field.id]}:{}),value:typeof view.values[field.id]==='string'?view.values[field.id] as string:'',kind:field.kind,maxCodeUnits:field.maxCodeUnits,required:field.required},
                        box:{x:0,y:0,width:Math.max(TARGET,allocation-12),height:nativeTextControlHeight(typography('select',metrics.environment).lineHeight,field.kind==='multiline'?4:1)}});
                    fieldChildren.push(group(key('form-editor-envelope',leaseId,field.id),allocation,control.height+12,[{fragment:control,x:6,y:6}]));
                }
                const issue=view.issues[field.id];
                if(issue){const message=textNode(key('form-issue',leaseId,field.id),issue,'small',allocation,metrics);fieldChildren.push({...message,nodes:message.nodes.map(node=>({...node,tone:'danger' as const}))});}
                const tools:Fragment[]=[];
                if(field.kind==='number'){
                    const value=numericFormValue(field,view.values[field.id]);
                    tools.push(tool(field,'−',`${field.label} 줄이기`,'decrement',enabled&&value!==null&&value-field.step!>=field.min!),tool(field,'+',`${field.label} 늘리기`,'increment',enabled&&value!==null&&value+field.step!<=field.max!));
                }
                if(view.reduction)tools.push(tool(field,'초기화',`${field.label} 초기화`,'reset',enabled));
                if(tools.length)fieldChildren.push(rows(key('form-field-tools',leaseId,field.id),allocation,tools));
                const fragment=column(id,allocation,fieldChildren,4);
                return {...fragment,nodes:fragment.nodes.map(node=>node.id===id?{...node,semanticRole:'group',label:field.label}:node)};
            };
            const rendered=new Set<string>();
            const appendField=(field:FormField,into:Fragment[])=>{if(!rendered.has(field.id)){rendered.add(field.id);into.push(fieldAt(field));}};
            for(const cluster of offer.clusters??[]){
                const fields=activeFields.filter(field=>cluster.fieldIds.includes(field.id));if(!fields.length)continue;
                const parts:Fragment[]=[textNode(key('form-cluster-label',leaseId,cluster.id),cluster.label,'name',allocation,metrics)];
                if(cluster.help)parts.push(textNode(key('form-cluster-help',leaseId,cluster.id),cluster.help,'small',allocation,metrics));
                for(const row of offer.rows?.filter(row=>row.clusterId===cluster.id)??[]){
                    const rowFields=row.fieldIds.map(id=>fields.find(field=>field.id===id)).filter((field):field is FormField=>!!field&&!rendered.has(field.id));if(!rowFields.length)continue;
                    const rowParts:Fragment[]=[];
                    if(row.leading){const art=valueFragment(document,row.leading,key('form-row-leading',leaseId,row.id),allocation,metrics);rowParts.push(art);}
                    rowParts.push(textNode(key('form-row-label',leaseId,row.id),row.label,'name',allocation,metrics));
                    for(const field of rowFields)appendField(field,rowParts);
                    parts.push(column(key('form-row',leaseId,row.id),allocation,rowParts,SMALL_GAP));
                }
                for(const field of fields)appendField(field,parts);
                children.push(column(key('form-cluster',leaseId,cluster.id),allocation,parts,GAP));
            }
            for(const field of activeFields)appendField(field,children);
            const actions=view.actions?.length?view.actions.map(action=>button(key('form-action',leaseId,action.id),action.label,allocation,metrics,{formLeaseId:leaseId,formIntent:'submit',...(offer.actions?{formActionId:action.id}:{}),enabled:action.enabled&&navigationEnabled,intent:action.intent==='ghost'?'quiet':action.intent})):[button(key('form-submit',leaseId),offer.submitLabel,allocation,metrics,{formLeaseId:leaseId,formIntent:'submit',enabled:editable&&view.canSubmit&&navigationEnabled,intent:offer.purpose==='confirmation'?'danger':'primary'})];
            if(offer.purpose!=='confirmation')actions.push(button(key('form-reset',leaseId),'다시 쓰기',allocation,metrics,{formLeaseId:leaseId,formIntent:'reset',enabled:offer.enabled&&!locked&&(!!view.actions||['editing','rejected','cancelled','conflict','stored','failed'].includes(view.status))&&navigationEnabled,intent:'secondary'}));
            actions.push(button(key('form-close',leaseId),offer.purpose==='confirmation'?'취소':'닫기',allocation,metrics,{formLeaseId:leaseId,formIntent:'close',enabled:navigationEnabled,intent:'quiet'}));
            children.push(rows(key('form-actions',leaseId),allocation,actions));
            for(const action of view.actions??[]){const status=action.message??(action.status?formStatus(action.status):'');if(status)children.push(textNode(key('form-action-status',leaseId,action.id),`${action.label} · ${status}`,'small',allocation,metrics));}
            return column(key('form-content',leaseId),allocation,children,GAP);
        };
        let content=bodyAt(available);
        const height=Math.min(metrics.environment.height-32,content.height+PADDING*2),viewportHeight=Math.max(1,height-PADDING*2),scrollbar=content.height>viewportHeight?gutter:0;
        if(scrollbar)content=bodyAt(available-scrollbar);
        const viewport=group(key('form-viewport',leaseId),available,viewportHeight,[{fragment:content,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:scrollbar});
        return group(key('form-dialog',leaseId),width,height,[{fragment:viewport,x:PADDING,y:PADDING}],{semanticRole:'dialog',label:offer.title,decoration:'dialog',formLeaseId:leaseId});
    }
    function participant(document:ParticipantLookup,id:string) {
        return document.participant.role!=='observer'&&document.participant.id===id?document.participant:document.opponents?.find(person=>person.id===id);
    }
    function informationText(document:ParticipantLookup,atom:InformationAtom):string {
        return atom.kind==='text'?atom.text:atom.kind==='number'?String(atom.value):atom.kind==='participant'?participant(document,atom.participantId)?.name??'':atom.label;
    }
    function informationPaintText(document:ParticipantLookup,atom:InformationAtom,primary=false):string {
        return primary&&atom.kind==='token'?atom.token:informationText(document,atom);
    }
    function valueFragment(document:ParticipantLookup,value:InformationValue,id:string,width:number,metrics:Measurements,primary=false,textRole?:TextRole):Fragment {
        const atoms=value.kind==='inline'?value.values:[value];
        const fragments=atoms.map((atom,index)=>{
            const nodeId=key(id,String(index)),scale=metrics.environment.textScale;
            if(atom.kind==='suit')return leaf({id:nodeId,parent:null,kind:'suit',suit:atom.suit,label:atom.label,box:{x:0,y:0,width:Math.min(width,32*scale),height:32*scale}});
            if(atom.kind==='card'){const w=Math.min(width,24*scale);return leaf({id:nodeId,parent:null,kind:'card',label:atom.label,visual:atom.visual,emphasis:atom.emphasis,box:{x:0,y:0,width:w,height:w*140/100}});}
            const text=informationPaintText(document,atom,primary),role=informationAtomRole(atom,primary?(value.kind==='inline'?'primary-inline':'primary'):'value',textRole);
            const fragment=textNode(nodeId,text,role,Math.max(1,Math.min(width,metrics.intrinsic(text,role).width)),metrics);
            if(primary&&atom.kind==='token'){const glyph={...fragment,nodes:fragment.nodes.map(node=>node.id===nodeId?{...node,id:key(nodeId,'glyph'),inert:true}:node)};return group(nodeId,fragment.width,fragment.height,[{fragment:glyph,x:0,y:0}],{semanticRole:'group',label:atom.label});}
            return role==='information-prose'?{...fragment,nodes:fragment.nodes.map(node=>({...node,tone:'muted' as const}))}:fragment;
        });
        return rows(id,width,fragments);
    }
    function badges(items:readonly {text:string;tone:PlannedNode['tone']}[],id:string,width:number,metrics:Measurements):Fragment {
        return rows(id,width,items.map((item,index)=>{const fragment=textNode(key(id,String(index)),item.text,'small',Math.max(1,Math.min(width,metrics.intrinsic(item.text,'small').width)),metrics);return {...fragment,nodes:fragment.nodes.map(node=>({...node,tone:item.tone}))};}));
    }
    function summaryInk(fragment:Fragment,context:HudReadContext):Fragment {
        return context.suppressSummaryInk?group(fragment.nodes[0].id,fragment.width,fragment.height,[],{inert:true}):fragment;
    }
    function informationPanel(document:HudReadContext,panel:InformationPanel,width:number,metrics:Measurements,condensed=false):Fragment {
        const available=width-PADDING*2,id=key('information',panel.id),scale=metrics.environment.textScale;
        const children:Fragment[]=condensed?[]:[textNode(key(id,'title'),panel.title,'name',available,metrics)];
        if(panel.summary){const label=textNode(key(id,'summary','text'),panel.summary.text,condensed?'body':'name',Math.max(1,available-SMALL_GAP*2),metrics);children.push(summaryInk(group(key(id,'summary'),available,label.height+SMALL_GAP*2,[{fragment:label,x:SMALL_GAP,y:SMALL_GAP}],{decoration:'callout',tone:panel.summary.tone}),document));}
        const naturalValue=(value:InformationValue)=>{
            const atoms=value.kind==='inline'?value.values:[value];
            return atoms.reduce((sum,atom)=>sum+(atom.kind==='suit'?32*scale:atom.kind==='card'?24*scale:metrics.intrinsic(informationText(document,atom),atom.kind==='participant'?'name':'body').width),0)+SMALL_GAP*(atoms.length-1);
        };
        const fieldFragment=(field:InformationPanel['fields'][number],allocation:number):Fragment=>{
            const fieldId=key(id,'field',field.id),labelWidth=Math.min(condensed?allocation-SMALL_GAP-1:allocation*.4,Math.max(32,metrics.intrinsic(field.label,'small').width));
            const label=textNode(key(fieldId,'label'),field.label,'small',labelWidth,metrics);
            const value=valueFragment(document,field.value,key(fieldId,'value'),Math.max(1,allocation-labelWidth-SMALL_GAP),metrics);
            return group(fieldId,allocation,Math.max(label.height,value.height),[{fragment:label,x:0,y:0},{fragment:value,x:labelWidth+SMALL_GAP,y:0}]);
        };
        if(condensed){
            const items:Fragment[]=[];
            if(panel.primary){
                if(panel.primary.label){const field={id:'primary',label:panel.primary.label,value:panel.primary.value};items.push(fieldFragment(field,Math.min(available,Math.max(32,metrics.intrinsic(field.label,'small').width)+SMALL_GAP+naturalValue(field.value))));}
                else items.push(valueFragment(document,panel.primary.value,key(id,'primary'),Math.min(available,naturalValue(panel.primary.value)),metrics));
            }
            items.push(...panel.fields.map(field=>fieldFragment(field,Math.min(available,Math.max(32,metrics.intrinsic(field.label,'small').width)+SMALL_GAP+naturalValue(field.value)))));
            if(items.length)children.push(rows(key(id,'details'),available,items));
        }else if(panel.primary&&panel.fields.length&&available>=240*scale){
            const primaryWidth=Math.min(120*scale,available*.4),detailsWidth=available-primaryWidth-SMALL_GAP;
            const primary=column(key(id,'contract'),primaryWidth,[...(panel.primary.label?[textNode(key(id,'primary-label'),panel.primary.label,'small',primaryWidth,metrics)]:[]),valueFragment(document,panel.primary.value,key(id,'primary'),primaryWidth,metrics,true)],SMALL_GAP);
            const fields=column(key(id,'fields'),detailsWidth,panel.fields.map(field=>fieldFragment(field,detailsWidth)),SMALL_GAP);
            children.push(group(key(id,'details'),available,Math.max(primary.height,fields.height),[{fragment:primary,x:0,y:0},{fragment:fields,x:primaryWidth+SMALL_GAP,y:0}]));
        }else{
            if(panel.primary){if(panel.primary.label)children.push(textNode(key(id,'primary-label'),panel.primary.label,'small',available,metrics));children.push(valueFragment(document,panel.primary.value,key(id,'primary'),available,metrics,true));}
            children.push(...panel.fields.map(field=>fieldFragment(field,available)));
        }
        if(panel.progress){
            const progress=panel.progress;
            const labels=progress.series.map(item=>`${item.label} ${item.value}${item.from==='start'&&progress.target!==undefined?`/${progress.target}`:''}`);
            children.push(textNode(key(id,'progress-label'),labels.join(' · '),'body',available,metrics));
            const segments:{x:number;width:number;tone:PlannedNode['tone']}[]=[],startValues=progress.series.filter(item=>item.from==='start'),endValues=progress.series.filter(item=>item.from==='end');
            let start=0,end=progress.total;
            const ranges=[...startValues.map(item=>{const from=start;start+=item.value;return {from,to:start,tone:item.tone};}),...endValues.map(item=>{const to=end;end-=item.value;return {from:end,to,tone:item.tone};})];
            if(Number.isInteger(progress.total)&&progress.total<=32&&progress.series.every(item=>Number.isInteger(item.value))){
                for(let tick=0;tick<progress.total;tick++){const range=ranges.find(range=>tick>=range.from&&tick<range.to);segments.push({x:tick/progress.total*100,width:Math.max(0,100/progress.total-1),tone:range?.tone??'muted'});}
            }else{segments.push({x:0,width:100,tone:'muted'});for(const range of ranges)segments.push({x:range.from/progress.total*100,width:(range.to-range.from)/progress.total*100,tone:range.tone});}
            children.push(leaf({id:key(id,'progress'),parent:null,kind:'progress',label:`${progress.label} · ${labels.join(' · ')} · 전체 ${progress.total}${progress.target!==undefined?` · 목표 ${progress.target}`:''}`,progressPaint:{segments:segments.map(segment=>({...segment,tone:segment.tone??'plain'})),...(progress.target!==undefined?{target:progress.target/progress.total*100}:{})},box:{x:0,y:0,width:available,height:16}}));
        }
        if(panel.badges?.length)children.push(badges(panel.badges,key(id,'badges'),available,metrics));
        const content=column(key(id,'content'),available,children,SMALL_GAP);
        return group(id,width,content.height+PADDING*2,[{fragment:content,x:PADDING,y:PADDING}],{decoration:'panel',semanticRole:'group',label:panel.title});
    }
    function scoreboard(document:HudReadContext,width:number,metrics:Measurements):Fragment {
        const score=document.scoreboard!,id=key('scoreboard',score.id),available=width-PADDING*2,scale=metrics.environment.textScale;
        const figureWidth=32*scale,gap=SMALL_GAP;
        // If measured columns cannot leave a readable identity, switch the entire
        // scoreboard to labeled rows. Never squeeze numeric glyphs into 1px cells.
        const minimumColumns=score.columns.map((column,index)=>Math.max(36*scale,metrics.intrinsic(column.label,'small').width,...score.rows.map(row=>metrics.intrinsic(row.values[index]===null?'–':String(row.values[index]),'body').width)));
        if(minimumColumns.reduce((sum,value)=>sum+value,0)+gap*score.columns.length+figureWidth+gap+48*scale>available){
            const children:Fragment[]=[textNode(key(id,'title'),score.title,'name',available,metrics)];
            for(const row of score.rows){
                const person=participant(document,row.participantId)!,rowId=key(id,'row',row.participantId);
                const identity=valueFragment(document,{kind:'participant',participantId:row.participantId},key(rowId,'identity'),available,metrics);
                const fields=score.columns.map((column,index)=>textNode(key(rowId,column.id),`${column.label}: ${row.values[index]===null?'–':row.values[index]}`,'body',available,metrics));
                children.push(column(key(rowId,'content'),available,[identity,...(row.badges?.length?[badges(row.badges,key(rowId,'badges'),available,metrics)]:[]),...fields],SMALL_GAP));
                // Preserve the same explicit unavailable-score semantics as columns.
                const last=children.length-1,fragment=children[last];children[last]={...fragment,nodes:fragment.nodes.map((node,index)=>index===0?{...node,semanticRole:'group',label:`${person.name} · ${score.columns.map((column,index)=>`${column.label} ${row.values[index]===null?'아직 없음':row.values[index]}`).join(' · ')}`}:node)};
            }
            const content=column(key(id,'content'),available,children,GAP);
            return group(id,width,content.height+PADDING*2,[{fragment:content,x:PADDING,y:PADDING}],{decoration:'panel',semanticRole:'group',label:score.title});
        }
        const maximumColumn=Math.max(1,(available-figureWidth-gap*2-48*scale-gap*score.columns.length)/score.columns.length);
        const columns=score.columns.map((column,index)=>Math.min(maximumColumn,Math.max(36*scale,metrics.intrinsic(column.label,'small').width,...score.rows.map(row=>metrics.intrinsic(row.values[index]===null?'–':String(row.values[index]),'body').width))));
        const numericWidth=columns.reduce((sum,value)=>sum+value,0)+gap*columns.length;
        const identityWidth=Math.max(1,available-numericWidth);
        const headingChildren:Fragment[]=[textNode(key(id,'title'),score.title,'name',identityWidth,metrics)];
        const alignEnd=(fragment:Fragment):Fragment=>({...fragment,nodes:fragment.nodes.map(node=>({...node,textAlign:'end'}))});
        let cursor=identityWidth;
        const headings:{fragment:Fragment;x:number;y:number}[]=[{fragment:headingChildren[0],x:0,y:0}];
        score.columns.forEach((column,index)=>{const fragment=alignEnd(textNode(key(id,'column',column.id),column.label,'small',columns[index],metrics));cursor+=gap;headings.push({fragment,x:cursor,y:0});cursor+=columns[index];});
        const heading=group(key(id,'head'),available,Math.max(...headings.map(item=>item.fragment.height)),headings);
        const rows=score.rows.map(row=>{
            const person=participant(document,row.participantId)!;
            const rowId=key(id,'row',row.participantId),nameWidth=Math.max(1,identityWidth-figureWidth-gap);
            const name=textNode(key(rowId,'name'),person.name,'name',nameWidth,metrics);
            const identity=column(key(rowId,'identity'),nameWidth,[name,...(row.badges?.length?[badges(row.badges,key(rowId,'badges'),nameWidth,metrics)]:[])],4);
            const figure=leaf({id:key(rowId,'figure'),parent:null,kind:'figure',appearance:person.appearance,label:person.name,box:{x:0,y:0,width:figureWidth,height:figureWidth}});
            const cells=row.values.map((value,index)=>alignEnd(textNode(key(rowId,score.columns[index].id),value===null?'–':String(value),'body',columns[index],metrics)));
            const height=Math.max(figureWidth,identity.height,...cells.map(cell=>cell.height));
            const placements=[{fragment:figure,x:0,y:(height-figureWidth)/2},{fragment:identity,x:figureWidth+gap,y:(height-identity.height)/2}];
            let x=identityWidth;cells.forEach((fragment,index)=>{x+=gap;placements.push({fragment,x,y:(height-fragment.height)/2});x+=columns[index];});
            return group(rowId,available,height,placements,{semanticRole:'group',label:`${person.name} · ${score.columns.map((column,index)=>`${column.label} ${row.values[index]===null?'아직 없음':row.values[index]}`).join(' · ')}`});
        });
        const content=column(key(id,'content'),available,[heading,...rows],SMALL_GAP);
        return group(id,width,content.height+PADDING*2,[{fragment:content,x:PADDING,y:PADDING}],{decoration:'panel',semanticRole:'group',label:score.title});
    }
    function outcome<A>(document:TableDocument<A>,width:number,metrics:Measurements,choices:ChoiceView,heightBudget?:number):Fragment|null {
        if(!document.outcome)return null;
        const panel=document.information?.find(panel=>panel.id===document.outcome!.informationId);
        if(!panel)throw new Error('Outcome information reference is unavailable');
        const short=!!shortLandscapePresentation(metrics.environment),surfaceWidth=short?width:Math.min(width,400),paddingX=short?8:12,paddingY=short||metrics.environment.width<600?8:12;
        const compose=(width:number)=>{
        const commands=(choices.outcomeCommands??[]).map(command=>button(key('command',command.id),command.label,width,metrics,{actionId:command.id,enabled:command.enabled,intent:command.intent}));
        const ownStatus=document.participant.role!=='observer'?document.participant.status?.value:undefined;
        const ownStatusText=ownStatus?(ownStatus.kind==='inline'?ownStatus.values:[ownStatus]).map(atom=>informationText(document,atom)).join(' '):undefined;
        const summary=panel.summary&&panel.summary.text!==ownStatusText?textNode('outcome-summary',panel.summary.text,'body',width,metrics):null;
        const primaryParts:Fragment[]=[];
        if(panel.primary){
            if(panel.primary.label)primaryParts.push(textNode('outcome-primary-label',panel.primary.label,'small',Math.max(1,Math.min(width,metrics.intrinsic(panel.primary.label,'small').width)),metrics));
            const atoms=panel.primary.value.kind==='inline'?panel.primary.value.values:[panel.primary.value];
            atoms.forEach((atom,index)=>{
                const id=key('outcome-primary-value',String(index));
                if(atom.kind==='text'||atom.kind==='number'){
                    const text=informationText(document,atom),role='compact-display';
                    primaryParts.push(textNode(id,text,role,Math.max(1,Math.min(width,metrics.intrinsic(text,role).width)),metrics));
                }else{
                    const natural=atom.kind==='suit'?32*metrics.environment.textScale:atom.kind==='card'?24*metrics.environment.textScale:metrics.intrinsic(informationText(document,atom),'name').width;
                    primaryParts.push(valueFragment(document,atom,id,Math.max(1,Math.min(width,natural)),metrics));
                }
            });
        }
        const primaryWidth=Math.min(width,primaryParts.reduce((sum,part)=>sum+part.width,0)+Math.max(0,primaryParts.length-1)*SMALL_GAP);
        const primary=primaryParts.length?rows('outcome-primary',Math.max(1,primaryWidth),primaryParts):null;
        const titleWidth=Math.max(1,Math.min(width,metrics.intrinsic(panel.title,'name').width));
        const heading=textNode('outcome-title',panel.title,'name',titleWidth,metrics);
        const header=rows('outcome-header',width,[heading,...(primary?[primary]:[])]);
        const compactFields=(document.outcome!.compactFieldIds??[]).map(fieldId=>{
            const field=panel.fields.find(field=>field.id===fieldId);
            if(!field)throw new Error('Outcome compact information reference is unavailable');
            const id=key('outcome-field',field.id),scale=metrics.environment.textScale;
            const label=textNode(key(id,'label'),field.label,'small',Math.max(1,Math.min(width,metrics.intrinsic(field.label,'small').width)),metrics);
            const atoms=field.value.kind==='inline'?field.value.values:[field.value];
            const natural=atoms.reduce((sum,atom)=>sum+(atom.kind==='suit'?32*scale:atom.kind==='card'?24*scale:metrics.intrinsic(informationText(document,atom),atom.kind==='participant'?'name':'body').width),0)+Math.max(0,atoms.length-1)*SMALL_GAP;
            const value=valueFragment(document,field.value,key(id,'value'),Math.max(1,Math.min(width,natural)),metrics);
            return rows(id,Math.max(1,Math.min(width,label.width+SMALL_GAP+value.width)),[label,value]);
        });
        const details=document.disclosures?.find(catalog=>catalog.id===document.outcome!.detailsCatalogId);
        const information=details?button('outcome-details','더보기',width,metrics,{disclosureCatalogId:details.id,enabled:true,intent:'quiet'}):button('outcome-information','테이블 정보',width,metrics,{localIntent:'toggle-information',enabled:true,intent:'quiet'});
        const result=column('outcome-content',width,[header,...(summary?[summary]:[]),...(compactFields.length?[rows('outcome-fields',width,compactFields)]:[]),...(panel.badges?.length?[badges(panel.badges,'outcome-badges',width,metrics)]:[]),rows('outcome-commands',width,[...commands,information],{},'center')],SMALL_GAP);
        return result;
        };
        const inner=surfaceWidth-paddingX*2;
        const nativeMinimum=(content:Fragment)=>Math.max(TARGET+12,...content.nodes.filter(node=>node.kind==='command').map(node=>content.nodes.find(parent=>parent.id===node.parent)?.box.height??node.box.height));
        let content=compose(inner);
        const maximum=heightBudget===undefined?Infinity:Math.max(nativeMinimum(content)+paddingY*2,heightBudget);
        let height=Math.min(maximum,content.height+paddingY*2);
        const scroll=content.height+paddingY*2>height,gutter=scroll?(metrics.environment.scrollbarWidth??0):0;
        if(gutter){content=compose(Math.max(1,inner-gutter));height=Math.max(height,nativeMinimum(content)+paddingY*2);}
        const body=scroll?scrollColumn('outcome-body',inner,height-paddingY*2,[content],gutter,'이번 판 결과 · 세로 스크롤'):content;
        const surface=group('outcome',surfaceWidth,height,[{fragment:body,x:paddingX,y:paddingY}],{decoration:'result',semanticRole:'group',label:'이번 판 결과'});
        return group('outcome-region',width,height,[{fragment:surface,x:(width-surfaceWidth)/2,y:0}]);
    }
    function factsPanel(document:HudReadContext,width:number,metrics:Measurements,condensed=false,choices?:ChoiceView,heightBudget?:number):Fragment {
        // Read-only panels share the HUD owner's natural stack, independently
        // of the generic table-content spacing and current information height.
        const stack=(children:readonly Fragment[]):Fragment=>{
            const plan=layoutHudStack(children.map(fragment=>({id:fragment.nodes[0].id,width:fragment.width,height:fragment.height})),width);
            return group('facts',width,plan.height,children.map((fragment,index)=>({fragment,x:plan.nodes[index].bounds.x,y:plan.nodes[index].bounds.y})));
        };
        if(document.information?.length||document.scoreboard){
            const compose=(compactInformation:boolean,rosterFirst=false)=>{
                const children=(document.information??[]).filter(panel=>panel.id!==document.outcome?.informationId).map(panel=>informationPanel(document,panel,width,metrics,compactInformation));
                if(document.scoreboard){
                    if(condensed)children.push(button('scoreboard-disclosure',choices?.scoreboardExpanded?(document.scoreboard.disclosure?.closeLabel??`${document.scoreboard.title} 접기`):(document.scoreboard.disclosure?.openLabel??`${document.scoreboard.title} 보기`),width,metrics,{kind:'command',enabled:true,checked:!!choices?.scoreboardExpanded,localIntent:'toggle-scoreboard',intent:'quiet'}));
                    if(!condensed||choices?.scoreboardExpanded){const roster=scoreboard(document,width,metrics);if(rosterFirst)children.unshift(roster);else children.push(roster);}
                }
                for(const fact of document.facts)children.push(textNode(key('fact',fact.id),`${fact.label}: ${fact.value}`,'body',width,metrics));
                return stack(children);
            };
            const detailed=compose(condensed);
            // The complete roster is essential to an admitted rail. Prefer a
            // compact information recipe before allowing secondary detail to
            // push its final participant below the initial viewport. This
            // changes presentation only; all fields, scores and rows remain.
            if(condensed||heightBudget===undefined||detailed.height<=heightBudget)return detailed;
            const compact=compose(true);
            // The active status already presents the declared essential facts
            // above this rail. Its detailed duplicate yields before the roster;
            // the complete information remains reachable after the score rows.
            return compact.height>heightBudget&&document.statusPresentation&&document.scoreboard?compose(true,true):compact;
        }
        const available=width-PADDING*2;
        const panel=(id:string,title:string,children:Fragment[])=>{
            const heading=textNode(key(id,'heading'),title,'name',available,metrics);
            const content=column(key(id,'content'),available,[heading,...children],SMALL_GAP);
            return group(id,width,content.height+PADDING*2,[{fragment:content,x:PADDING,y:PADDING}],{decoration:'panel'});
        };
        const table=document.facts.filter(fact=>fact.subject==='table');
        const participants=document.facts.filter(fact=>fact.subject==='participant');
        if(condensed){
            const facts=table.map(fact=>{const text=`${fact.label}: ${fact.value}`;return textNode(key('fact',fact.id),text,'body',Math.min(available,Math.max(1,metrics.intrinsic(text,'body').width)),metrics);});
            const scores=participants.map(fact=>{
                const valueWidth=Math.max(24,Math.min(available/3,metrics.intrinsic(fact.value,'body').width));
                const labelWidth=Math.max(1,Math.min(available-valueWidth-SMALL_GAP,metrics.intrinsic(fact.label,'name').width));
                const label=textNode(key('fact',fact.id,'name'),fact.label,'name',labelWidth,metrics);
                const value=textNode(key('fact',fact.id),fact.value,'body',valueWidth,metrics);
                return group(key('score-row',fact.id),labelWidth+SMALL_GAP+valueWidth,Math.max(label.height,value.height),[{fragment:label,x:0,y:0},{fragment:value,x:labelWidth+SMALL_GAP,y:0}]);
            });
            return panel('facts','상황판',[...(facts.length?[rows('status-items',available,facts)]:[]),...(scores.length?[rows('score-items',available,scores)]:[])]);
        }
        return stack([
            ...(table.length?[panel('status-panel','상황판',table.map(fact=>textNode(key('fact',fact.id),`${fact.label}: ${fact.value}`,'body',available,metrics)))]:[]),
            ...(participants.length?[panel('score-panel','점수판',participants.map(fact=>{
                const valueWidth=Math.min(available/3,Math.max(44,metrics.intrinsic(fact.value,'body').width));
                const label=textNode(key('fact',fact.id,'name'),fact.label,'name',available-valueWidth-SMALL_GAP,metrics);
                const raw=textNode(key('fact',fact.id),fact.value,'body',valueWidth,metrics);
                const value={...raw,nodes:raw.nodes.map(node=>({...node,textAlign:'end' as const}))};
                return group(key('score-row',fact.id),available,Math.max(label.height,value.height),[{fragment:label,x:0,y:0},{fragment:value,x:available-valueWidth,y:0}]);
            }))]:[]),
        ]);
    }
    function directionalOwners<A>(document:TableDocument<A>):readonly string[]|null {
        const people=document.opponents??[];return people.length>=4&&people.length<=5?[people.length===5?people[4].id:document.participant.id,...people.slice(0,4).map(person=>person.id)]:null;
    }
    function trickCards<A>(document:TableDocument<A>,collection:CardCollection,width:number):Fragment|null {
        const owners=directionalOwners(document),slots=REGULAR_TRICK.slots(width);
        if(!owners||!slots||collection.cards.length>owners.length||collection.cards.some(card=>!card.ownerId||!owners.includes(card.ownerId))||new Set(collection.cards.map(card=>card.ownerId)).size!==collection.cards.length)return null;
        const id=key('collection',collection.id,'trick');
        return group(id,width,REGULAR_TRICK.height,collection.cards.map(card=>{const box=slots[owners.indexOf(card.ownerId!)]!;return {fragment:leaf({id:key('collection',collection.id,'card',card.id),parent:null,kind:'card',entityId:card.id,ownerId:card.ownerId,zoneId:collection.id,collectionPurpose:collection.purpose,label:card.label,visual:card.visual,emphasis:card.emphasis,box:{x:0,y:0,width:box.width,height:box.height}}),x:box.x,y:box.y};}));
    }
    function publicCollections<A>(document: TableDocument<A>, width: number, metrics: Measurements, rootId='collections',prominent=false,collapseEmptyPlay=false,choicesForCollections?:ChoiceView): Fragment {
        const publicArt=!document.outcome&&document.stage!=='waiting'?shortLandscapePresentation(metrics.environment)?.publicCard??{width:64,height:90}:{width:64,height:90};
        const allZones=document.collections??[];
        const primaryPairZone=publicArt.width===32&&rootId==='collections'&&allZones.length===2?allZones.find(zone=>zone.kind==='trick'&&zone.purpose==='play'&&zone.relevance!=='auxiliary'):undefined;
        const auxiliaryPairZone=primaryPairZone?allZones.find(zone=>zone!==primaryPairZone&&zone.hiddenCount!==undefined&&zone.relevance==='auxiliary'):undefined;
        const compactPair=auxiliaryPairZone?allocateCompactPublicPair({width,capacity:(document.opponents?.length??0)+(document.participant.role==='observer'?0:1),cardWidth:publicArt.width,exposed:EXPOSED,auxiliaryCaptionWidth:Math.max(...Array.from({length:105},(_,count)=>metrics.intrinsic(`${count}장`,'small').width)),auxiliaryArtWidth:24,gap:SMALL_GAP}):null;
        const hasMeaningfulContent=allZones.some(zone=>zone.cards.length>0||(zone.hiddenCount??0)>0);
        const dormant=collapseEmptyPlay&&hasMeaningfulContent?allZones.filter(zone=>zone!==primaryPairZone&&!zone.cards.length&&zone.hiddenCount===undefined&&(zone.kind==='trick'||zone.purpose==='play')):[];
        // Semantic order is stable even when the first real card promotes the
        // trick ahead of an existing stock in the arena's source document.
        const orderedZones=compactPair?[primaryPairZone!,auxiliaryPairZone!]:allZones;
        const zones=orderedZones.filter(zone=>!dormant.includes(zone));
        const compact = zones.length > 0 && zones.every(zone => !!zone.purpose);
        // The engine chooses compact public-zone composition from semantics.
        const minimumZoneWidth=Math.max(publicArt.width,...zones.map(zone=>publicArt.width===REGULAR_TRICK.card.width&&width>=REGULAR_TRICK.minimumWidth&&zone.kind==='trick'&&directionalOwners(document)?REGULAR_TRICK.minimumWidth:(zone.purpose==='captured'?32:publicArt.width)+Math.max(0,Math.min(5,zone.cards.length)-1)*EXPOSED));
        const columns = compact&&!prominent ? Math.max(1, Math.min(zones.length, Math.floor((width + SMALL_GAP) / (minimumZoneWidth + SMALL_GAP)))) : 1;
        const defaultAllocation = compact ? (width - (columns - 1) * SMALL_GAP) / columns : width;
        const children = zones.map(collection => {
            const allocation=compactPair?.primaryWidth!==undefined?(collection===primaryPairZone?compactPair.primaryWidth:compactPair.auxiliaryWidth):defaultAllocation;
            const id = key('collection', collection.id);
            if(collection.relevance==='auxiliary'&&collection.hiddenCount!==undefined){
                const count=collection.hiddenCount,artWidth=24,artHeight=34,captionId=key(id,'label');
                const recycle=choicesForCollections?.recyclePresentation?.source===collection.id?choicesForCollections.recyclePresentation:document.recycle?.source===collection.id?document.recycle:undefined;
                const alternate=recycle?`다시 모은 카드 · ${recycle.totalCount}장`:undefined,canonical=textNode(captionId,`${count}장`,'small',allocation,metrics),captionHeight=Math.max(canonical.height,...(compactPair?Array.from({length:105},(_,count)=>metrics.exact(`${count}장`,'small',allocation).height):[]),...(alternate?[metrics.exact(alternate,'small',allocation).height]:[]));
                const label={...canonical,height:captionHeight,nodes:canonical.nodes.map(node=>({...node,box:{...node.box,height:captionHeight},...(alternate?{recycleCaption:alternate}:{})}))};
                const pile=count?leaf({id:key(id,'stock'),parent:null,kind:'card',zoneId:collection.id,stockCount:count,visual:{kind:'back'},label:collectionLabel(collection),...(recycle?{recycleAnchor:{totalCount:recycle.totalCount,captionId}}:{}),box:{x:0,y:0,width:artWidth,height:artHeight}}):group(key(id,'stock'),artWidth,artHeight,[],{zoneId:collection.id,stockCount:0});
                const compact=column(id,allocation,[{...label,nodes:label.nodes.map(node=>({...node,textAlign:'center' as const}))},group(key(id,'pile'),allocation,artHeight,[{fragment:pile,x:(allocation-artWidth)/2,y:0}])],4);return {...compact,nodes:compact.nodes.map((node,index)=>index===0?{...node,semanticRole:'group' as const,label:collectionLabel(collection)}:node)};
            }
            const hidden = collection.hiddenCount !== undefined;
            const pileId = key(id,'stock');
            const recycle=choicesForCollections?.recyclePresentation?.source===collection.id?choicesForCollections.recyclePresentation:document.recycle?.source===collection.id?document.recycle:undefined;
            const captionId=key(id,'label'),alternate=recycle?`다시 모은 카드 · ${recycle.totalCount}장`:undefined;
            const pile: Fragment = collection.hiddenCount
                ? leaf({id:pileId,parent:null,kind:'card',label:collectionLabel(collection),zoneId:collection.id,stockCount:collection.hiddenCount,visual:{kind:'back'},...(recycle?{recycleAnchor:{totalCount:recycle.totalCount,captionId}}:{}),box:{x:0,y:0,width:publicArt.width,height:publicArt.height}})
                : group(pileId,publicArt.width,publicArt.height,[],{zoneId:collection.id,stockCount:0});
            const directional=publicArt.width===64&&collection.kind==='trick'?trickCards(document,collection,allocation):null;
            let cards = directional ?? (hidden ? group(key(id,'pile'),allocation,publicArt.height,[{fragment:pile,x:document.opponents?.length?(allocation-publicArt.width)/2:0,y:0}]) : collection.cards.length
                ? hand({ ...document, hand: collection.cards }, allocation, metrics, key(id, 'cards'), undefined, collection.purpose ? collection.id : '', compact, collection.purpose,undefined,prominent||collection.relevance==='primary')
                : group(key(id, 'empty'), allocation, compact ? publicArt.height : 0, []));
            if(collection.kind==='trick'&&!directional){
                const capacity=(document.opponents?.length??0)+(document.participant.role==='observer'?0:1);
                const reserve=publicArt.width+Math.max(0,capacity-1)*EXPOSED>allocation?(metrics.environment.scrollbarHeight??0):0;
                const height=Math.max(cards.height,publicArt.height+reserve);
                cards={...cards,height,nodes:[{...cards.nodes[0],box:{...cards.nodes[0].box,height}},...cards.nodes.slice(1)]};
            }
            if(document.outcome?.overview&&collection.purpose==='captured'&&collection.relevance==='auxiliary'){
                // The complete current collection remains a real scene target.
                // The primary matrix already supplies the visible record labels.
                return group(id,allocation,cards.height,[{fragment:cards,x:0,y:0}],{semanticRole:'group',label:collectionLabel(collection)});
            }
            if(collection.kind==='trick'){return {...group(id,allocation,cards.height,[{fragment:cards,x:0,y:0}],{semanticRole:'group',label:collectionLabel(collection)}),primaryCardBand:{x:0,y:0,width:allocation,height:publicArt.height}};}
            const canonicalTitle=textNode(captionId,collectionLabel(collection),'small',allocation,metrics);
            const alternatives=collection.purpose==='stock'?[...Array.from({length:105},(_,count)=>`${collection.label} · ${count}장`),...(recycle?Array.from({length:105},(_,count)=>`다시 모은 카드 · ${count}장`):[])]:[];
            const title={...canonicalTitle,height:Math.max(canonicalTitle.height,...alternatives.map(label=>metrics.exact(label,'small',allocation).height)),nodes:canonicalTitle.nodes.map(node=>({...node,box:{...node.box,height:Math.max(canonicalTitle.height,...alternatives.map(label=>metrics.exact(label,'small',allocation).height))},...(alternate?{recycleCaption:alternate}:{})}))};
            const heading=document.opponents?.length?{...title,nodes:title.nodes.map(node=>({...node,textAlign:'center' as const}))}:title;
            const header=heading;
            const fragment=column(id, allocation, [header, cards], SMALL_GAP),band={x:0,y:header.height+SMALL_GAP,width:allocation,height:publicArt.height};
            return {...fragment,...(collection.purpose==='play'?{primaryCardBand:band}:collection.purpose==='captured'?{capturedCardBand:band}:{})};
        });
        const ownedChildren=children.map(child=>{const collection=zones.find(zone=>child.nodes[0].id===key('collection',zone.id));return collection?.collectedBy?{...child,nodes:[{...child.nodes[0],collectedBy:collection.collectedBy,zoneId:collection.id,collectionPurpose:'captured' as const},...child.nodes.slice(1)]}:child;});
        const rawContent=compact?rows(rootId,width,ownedChildren):column(rootId,width,ownedChildren);
        const band=(kind:'primaryCardBand'|'capturedCardBand')=>{const child=children.find(child=>kind in child);if(!child)return undefined;const box=(child as Fragment)[kind]!,root=rawContent.nodes.find(node=>node.id===child.nodes[0].id)!;return {...box,x:root.box.x+box.x,y:root.box.y+box.y};};
        const content={...rawContent,primaryCardBand:band('primaryCardBand'),capturedCardBand:band('capturedCardBand')};
        return dormant.length?{...content,nodes:[...content.nodes,...dormant.map(zone=>({id:key('collection',zone.id),parent:rootId,kind:'group' as const,label:zone.label,zoneId:zone.id,collectionPurpose:zone.purpose,box:{x:0,y:0,width:0,height:0}}))]}:content;
    }
    function texts<A>(document: TableDocument<A>, choices: ChoiceView): readonly [
        string,
        TextRole
    ][] {
        const nativeTexts:[string,TextRole][]=(choices.nativeCardPresentation?.captions??[]).map(caption=>[caption,'small']);
        const statusTexts:[string,TextRole][]=[...nativeTexts,['테이블 정보','button'],...(choices.informationOpen?[['테이블 정보','name'],['닫기','button']] as [string,TextRole][]:[]),...(choices.disclosure?.selected?[['A K Q J 10 9 8 7 6 5 4 3 2 홍 흑 조커','art'] as [string,TextRole]]:[]),...(document.outcome?.detailsCatalogId&&document.disclosures?.some(catalog=>catalog.id===document.outcome!.detailsCatalogId)?[['더보기','button']] as [string,TextRole][]:[]),['가나','body'],['Ag','small'],['Ag','body'],['Ag','button'],...((document.collections??[]).some(zone=>zone.hiddenCount!==undefined)?Array.from({length:105},(_,count)=>[`${count}장`,'small'] as [string,TextRole]):[])];
        for(const status of [document.participant.status,...(document.opponents??[]).map(person=>person.status)])if(status){if(status.purpose!=='standing')statusTexts.push([' ','announcement']);for(const badge of status.badges??[])statusTexts.push([badge.text,'small']);for(const atom of status.value.kind==='inline'?status.value.values:[status.value])if(atom.kind!=='card'&&atom.kind!=='suit')statusTexts.push([informationText(document,atom),status.purpose==='standing'?'small':'announcement']);}
        if(choices.form){
            const form=choices.form,offer=form.offer,fields=presentedFormFields(form),ids=new Set(fields.map(field=>field.id));
            statusTexts.push([offer.title,'name'],[offer.submitLabel,'button'],['다시 쓰기','button'],['취소','button'],['닫기','button'],['−','button'],['+','button'],['초기화','button']);
            if(offer.help)statusTexts.push([offer.help,'body']);
            for(const section of offer.sections??[]){statusTexts.push([section.title,'button']);if(section.id===(form.activeSection??offer.sections?.[0]?.id)&&section.help)statusTexts.push([section.help,'small']);}
            const status=formStatus(form.status);if(status)statusTexts.push([status,'small']);if(form.issues.$form)statusTexts.push([form.issues.$form,'small']);
            const summary=formSummaryItems(form),pages=Math.max(1,Math.ceil(summary.length/FORM_SUMMARY_PAGE_SIZE)),page=Math.max(0,Math.min(form.summaryPage??0,pages-1));
            for(const item of summary.slice(page*FORM_SUMMARY_PAGE_SIZE,(page+1)*FORM_SUMMARY_PAGE_SIZE))statusTexts.push([item.text,item.fieldId?'button':'small']);
            if(pages>1)statusTexts.push(['이전 요약','button'],['다음 요약','button'],[`${page+1} / ${pages}`,'small']);
            for(const cluster of offer.clusters??[])if(cluster.fieldIds.some(id=>ids.has(id))){statusTexts.push([cluster.label,'name']);if(cluster.help)statusTexts.push([cluster.help,'small']);}
            for(const row of offer.rows??[])if(row.fieldIds.some(id=>ids.has(id))){statusTexts.push([row.label,'name']);const atom=row.leading;if(atom){if(atom.kind==='card')statusTexts.push(['A K Q J 10 9 8 7 6 5 4 3 2 홍 흑 조커','art']);else if(atom.kind!=='suit')statusTexts.push([informationText(document,atom),'small']);}}
            for(const field of fields){statusTexts.push([field.label,'body']);if(field.help)statusTexts.push([field.help,'small']);if(form.issues[field.id])statusTexts.push([form.issues[field.id],'small']);
                if(field.kind==='select'){for(const option of field.options)statusTexts.push([option.label,'select'],[option.label,'body']);const option=field.options.find(option=>option.id===form.values[field.id]);if(option?.help)statusTexts.push([option.help,'small']);}
                if(field.kind==='toggle'){const word=form.values[field.id]===true?field.onLabel:field.offLabel;if(word)statusTexts.push([word,'small']);}
            }
            for(const action of form.actions??[]){statusTexts.push([action.label,'button']);const status=action.message??(action.status?formStatus(action.status):'');if(status)statusTexts.push([`${action.label} · ${status}`,'small']);}
        }
        if(choices.assistance){const view=choices.assistance;for(const tool of view.projection.tools){statusTexts.push([tool.label,'button']);if(tool.kind==='send-reaction')for(const option of tool.options)statusTexts.push([option.text,'button']);}if(view.projection.guidance)statusTexts.push([view.projection.guidance,'small']);if(view.projection.advice)statusTexts.push([view.projection.advice.label,'body']);for(const inspection of view.projection.inspections)statusTexts.push([inspection.reason,'body']);for(const reaction of view.projection.reactions)statusTexts.push([reaction.text,'small']);statusTexts.push(['카드를 낼 수 없어요','name'],['힌트','name'],['반응','name'],['닫기','button']);}
        for(const cue of choices.feedback?.cues??[])if(cue.label)statusTexts.push([cue.label,'small']);
        for(const disclosure of choices.feedback?.disclosures??[])statusTexts.push([disclosure.title,'name'],['닫기','button'],['A K Q J 10 9 8 7 6 5 4 3 2 홍 흑 조커','art']);
        const actionTexts=(action:RoomShellAction)=>{statusTexts.push([action.label,'button']);if(action.confirmation)statusTexts.push([action.confirmation.title,'name'],[action.confirmation.message,'body'],[action.confirmation.confirmLabel,'button']);};
        if(document.shell){
            const shell=document.shell;statusTexts.push([`● ${shell.roomCode}`,'button'],[String(shell.header.requestCount||shell.header.observerCount),'button'],[shell.header.observerLabel,'button'],[shell.header.requestLabel,'button']);
            for(const notice of shell.notices)statusTexts.push([notice.text,'small']);
            for(const page of shell.pages){statusTexts.push([page.title,'name']);if(page.description)statusTexts.push([page.description,'body']);for(const field of page.preferences??[]){statusTexts.push([field.label,'body']);if(field.help)statusTexts.push([field.help,'small']);if(field.kind==='select')for(const option of field.options){statusTexts.push([option.label,'select'],[option.label,'body']);if(option.help)statusTexts.push([option.help,'small']);}if(field.kind==='number')statusTexts.push([String(field.value),'small']);}for(const action of page.actions)actionTexts(action);for(const person of page.people??[]){statusTexts.push([`${person.name}${person.mine?' · 나':''}`,'name'],[person.status,'small']);for(const action of person.actions??[])actionTexts(action);}}
            for(const seat of shell.seats??[]){statusTexts.push([seat.name,'name']);for(const action of seat.actions)actionTexts(action);}
            for(const group of shell.management??[]){statusTexts.push([group.title,'name']);if(group.description)statusTexts.push([group.description,'body']);for(const action of group.actions)actionTexts(action);}
            if(choices.shellCommandConfirmation){statusTexts.push([choices.shellCommandConfirmation.title,'name'],[choices.shellCommandConfirmation.message,'body']);for(const action of choices.shellCommandConfirmation.actions)actionTexts(action);}
            if(shell.leaveConfirmation){statusTexts.push([shell.leaveConfirmation.title,'name'],[shell.leaveConfirmation.message,'body']);for(const action of shell.leaveConfirmation.actions)statusTexts.push([action.label,'button']);}
        }
        const addValue=(value:InformationValue,primary=false)=>{for(const atom of value.kind==='inline'?value.values:[value]){if(atom.kind==='card')continue;const role=informationAtomRole(atom,primary?(value.kind==='inline'?'primary-inline':'primary'):'value');statusTexts.push([informationPaintText(document,atom,primary),role]);if(primary&&(atom.kind==='number'||atom.kind==='text'||atom.kind==='token'))statusTexts.push([informationText(document,atom),'body']);}};
        for(const panel of document.information??[]){statusTexts.push([panel.title,'name']);if(panel.summary)statusTexts.push([panel.summary.text,'name']);if(panel.primary){if(panel.primary.label)statusTexts.push([panel.primary.label,'small']);addValue(panel.primary.value,true);if(panel.id===document.outcome?.informationId)for(const atom of panel.primary.value.kind==='inline'?panel.primary.value.values:[panel.primary.value])if(atom.kind==='text'||atom.kind==='number'||atom.kind==='token')statusTexts.push([informationText(document,atom),'compact-display']);}for(const field of panel.fields){statusTexts.push([field.label,'small']);addValue(field.value);}for(const badge of panel.badges??[])statusTexts.push([badge.text,'small']);}
        const score=document.scoreboard;
        if(score){statusTexts.push([score.title,'name'],[score.disclosure?.openLabel??`${score.title} 보기`,'button'],[score.disclosure?.closeLabel??`${score.title} 접기`,'button']);for(const column of score.columns)statusTexts.push([column.label,'small']);for(const row of score.rows){statusTexts.push([participant(document,row.participantId)?.name??'','name']);for(const value of row.values)statusTexts.push([value===null?'–':String(value),'body']);for(const badge of row.badges??[])statusTexts.push([badge.text,'small']);}}
        return [
            ...statusTexts,
            ...(choices.decisionPresentation?[[' ','button'],[' ','choice'],[choices.decisionPresentation.submit.prefix,'button'],...choices.decisionPresentation.auxiliaryLabels.map(label=>[label,'button']),...choices.decisionPresentation.fields.flatMap(field=>field.options.flatMap(option=>option.atom.kind==='suit'?[]:[[phaseChoiceAtomLabel(option.atom),'choice'],[phaseChoiceAtomLabel(option.atom),'button']]))] as [string,TextRole][]:(choices.selectedLabels??[]).map(label=>[label,'button'] as [string,TextRole])),
            // Public glyph repertoire, independent of hidden deck contents.
            ...((document.hand.length || document.collections?.some(zone=>zone.cards.length || zone.hiddenCount)) ? [['A K Q J 10 9 8 7 6 5 4 3 2 홍 흑 조커', 'art'] as [string,TextRole]] : []),
            ['상황판','name'],['점수판','name'],...document.facts.flatMap(fact=>[[fact.label,'name'],[fact.value,'body']] as [string,TextRole][]),[document.participant.name,'name'],...(document.stage==='waiting'?[]:[[document.participant.name,'participant-name'] as [string,TextRole]]), ...(document.opponents??[]).map(person=>[person.name,PEER_NAME_ROLE] as [string,TextRole]), ...(choices.cards ? [[choices.cards.label,'small'] as [string,TextRole],...choices.cards.submitLabels.map(label=>[label,'button'] as [string,TextRole])] : []), ...(document.collections ?? []).map(collection => [collectionLabel(collection), 'small'] as [string, TextRole]), ...document.participant.markers.map(label => [label, 'small'] as [
                string,
                TextRole
            ]),
            ...document.facts.map(fact => [`${fact.label}: ${fact.value}`, 'body'] as [
                string,
                TextRole
            ]),
            ...choices.fields.flatMap(field => [[field.label, 'small'] as [
                    string,
                    TextRole
                // Body summaries are measured at their actual allocation only
                // for overflowing options. Reserving every possible summary's
                // unused intrinsic metric can evict the real working set.
                ], ...field.options.flatMap(option => option.caption?option.caption.flatMap(atom=>atom.kind==='suit'?[]:[[atom.kind==='number'?String(atom.value):atom.text,'choice']] as [string,TextRole][]):choices.finitePresentation?.kind==='choice-strips'?[[option.label,'choice']] as [string,TextRole][]:[[option.label,'select'],...(field.options.length<=12?[[option.label,'choice']] as [string,TextRole][]:[])] as [string,TextRole][])]),
            ...[...choices.commands,...(choices.outcomeCommands??[])].map(command => [command.label, 'button'] as [
                string,
                TextRole
            ]),
            ...(choices.selected&&!choices.selected.caption&&!choices.decisionPresentation ? [[choices.selected.label, 'button'] as [
                    string,
                    TextRole
                ]] : []),
            ...(!document.hand.length ? [[EMPTY_CARD_LABEL, 'small'] as [
                    string,
                    TextRole
                ]] : []),
        ];
    }
    function catalogueDialog(metrics:Measurements,choices:ChoiceView):Fragment|null {
        const field=choices.fields.find(field=>field.id===choices.catalogue?.fieldId),catalogue=field?.catalogue;if(!field||!catalogue)return null;
        const id='choice-catalogue',width=Math.min(metrics.environment.width-32,720),available=width-PADDING*2;
        const heading=textNode('catalogue-title',catalogue.title,'name',available,metrics);
        const selected=field.options.find(option=>option.id===choices.values?.[field.id]);
        const descriptions=field.options.flatMap(option=>option.description?[option.description]:[]),reservedDescriptionHeight=Math.max(0,...descriptions.map(label=>metrics.exact(label,'small',available).height));
        const descriptionHeight=selected?.description?metrics.exact(selected.description,'small',available).height:0;
        const description=group('catalogue-description',available,descriptionHeight,selected?.description?[{fragment:textNode('catalogue-description-text',selected.description,'small',available,metrics),x:0,y:0}]:[]);
        const cancel=button('catalogue-cancel','취소',available,metrics,{catalogueIntent:{kind:'close',fieldId:field.id},enabled:true,intent:'secondary'});
        const confirmation=choices.selected?button('catalogue-confirm',choices.selected.label,available,metrics,{actionId:choices.selected.id,enabled:choices.selected.enabled,intent:'primary',accessibleDescription:selected?.description},choices.selectedLabels):null;
        const actions=rows('catalogue-actions',available,[cancel,...(confirmation?[confirmation]:[])],{},'center');
        const descriptionBudget=Math.max(0,metrics.environment.height-32-(PADDING*2+heading.height+actions.height+GAP*2+TARGET+4));
        const scrollDescription=descriptionHeight>descriptionBudget;
        const footer=column('catalogue-footer',available,[...(descriptionHeight&&!scrollDescription?[description]:[]),actions],4);
        const bodyAt=(allocation:number)=>{
            const groups=catalogue.groups??[{id:'all',label:field.label,optionIds:field.options.map(option=>option.id)}];
            const categories=groups.map(category=>{
                const options=category.optionIds.map(optionId=>field.options.find(option=>option.id===optionId)!).map(option=>{
                    const nodeId=key('catalogue-option',field.id,option.id),checked=choices.values?.[field.id]===option.id;
                    if(!option.visual)return button(nodeId,option.label,allocation,metrics,{kind:'choice',fieldId:field.id,optionId:option.id,enabled:option.enabled,checked,accessibleDescription:option.description});
                    const art=leaf({id:key(nodeId,'art'),parent:null,kind:'card',label:option.label,visual:option.visual,emphasis:option.emphasis,checked,box:{x:0,y:0,width:44,height:61.6}});
                    const control=group(nodeId,44,61.6,[{fragment:art,x:0,y:0}],{kind:'choice',choiceCard:true,paintChildren:true,label:option.label,fieldId:field.id,optionId:option.id,enabled:option.enabled,checked,accessibleDescription:option.description});
                    return group(key(nodeId,'focus-envelope'),54,71.6,[{fragment:control,x:5,y:5}]);
                });
                return column(key('catalogue-group',category.id),allocation,[textNode(key('catalogue-group-label',category.id),category.label,'small',allocation,metrics),rows(key('catalogue-options',category.id),allocation,options,{semanticRole:'group',label:category.label},'start',category.optionIds.every(id=>!!field.options.find(option=>option.id===id)?.visual)?0:SMALL_GAP)],SMALL_GAP);
            });
            const warning=scrollDescription&&selected?.description?textNode('catalogue-description-text',selected.description,'small',allocation,metrics):null;
            return column('catalogue-content',allocation,[...(warning?[warning]:[]),...categories],GAP);
        };
        const reservedFooter=reservedDescriptionHeight?reservedDescriptionHeight+4+actions.height:actions.height;
        return choiceDialog(id,width,heading,footer,bodyAt,field.label,choices.catalogue!.leaseId,metrics,reservedFooter);
    }
    /** Shared bounded choice chrome; callers own option semantics and consequence content. */
    function choiceDialog(id:string,width:number,heading:Fragment,footer:Fragment,bodyAt:(allocation:number)=>Fragment,label:string,leaseId:string,metrics:Measurements,reservedFooter=footer.height):Fragment {
        const available=width-PADDING*2,maximum=metrics.environment.height-32,fixed=PADDING*2+heading.height+footer.height+GAP*2;
        if(maximum-fixed<TARGET)throw Error('Viewport cannot contain a readable choice dialogue');
        let body=bodyAt(available);
        const dialogHeight=Math.min(maximum,PADDING*2+heading.height+reservedFooter+GAP*2+body.height),bodyHeight=dialogHeight-fixed;
        const gutter=body.height>bodyHeight?(metrics.environment.scrollbarWidth??0):0;if(gutter)body=bodyAt(available-gutter);
        const viewport=group(id==='choice-catalogue'?'catalogue-viewport':`${id}-viewport`,available,bodyHeight,[{fragment:body,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:gutter,semanticRole:'radiogroup',label});
        return group(id,width,fixed+bodyHeight,[{fragment:heading,x:PADDING,y:PADDING},{fragment:viewport,x:PADDING,y:PADDING+heading.height+GAP},{fragment:footer,x:PADDING,y:PADDING+heading.height+GAP+bodyHeight+GAP}],{semanticRole:'dialog',label:heading.nodes[0].label,decoration:'dialog',choiceLeaseId:leaseId});
    }
    function cardActionDialog(metrics:Measurements,choices:ChoiceView):Fragment|null {
        const picker=choices.cardActionPicker,options=choices.cards?.actionVariants;
        if(!picker||!options||options.length<2)return null;
        const id='card-action-dialog',width=Math.min(metrics.environment.width-32,720),available=width-PADDING*2;
        const heading=textNode('card-action-title','내기 방법','name',available,metrics);
        const cancel=button('card-action-cancel','취소',available,metrics,{cardActionPickerIntent:{kind:'close',leaseId:picker.leaseId},enabled:true,intent:'secondary'});
        const confirm=button('card-action-confirm',choices.selected?.label??'내기',available,metrics,{cardActionPickerIntent:{kind:'confirm',leaseId:picker.leaseId},enabled:choices.selected?.enabled===true,intent:'primary'},choices.selectionPresentation?.submitLabels??choices.cards?.submitLabels);
        const footer=rows('card-action-actions',available,[cancel,confirm],{},'center');
        const bodyAt=(allocation:number)=>rows('card-action-options',allocation,options.map(option=>button(key('card-action-option',option.id),option.label,allocation,metrics,{kind:'choice',cardActionOptionId:option.id,enabled:option.enabled,checked:choices.cards?.selectedActionId===option.id})),{},'start');
        return choiceDialog(id,width,heading,footer,bodyAt,'카드 내기 방법',picker.leaseId,metrics);
    }

    /** Separate readonly score surface. Never trade typography or the hand for fit. */
    function scoreboardDialog<A>(document:TableDocument<A>,metrics:Measurements,choices:ChoiceView):Fragment|null{
        if(!choices.scoreboardOpen)return null;
        const width=Math.min(metrics.environment.width-32,560*metrics.environment.textScale),available=width-PADDING*2;
        const close=iconButton('table-scoreboard-close','닫기','close',metrics,{localIntent:'toggle-information',enabled:true,intent:'quiet'});
        const title=textNode('table-scoreboard-title',document.scoreboard?.title??'점수판','name',Math.max(1,available-close.width-SMALL_GAP),metrics);
        const headingHeight=Math.max(title.height,close.height);
        const heading=group('table-scoreboard-heading',available,headingHeight,[{fragment:title,x:0,y:(headingHeight-title.height)/2},{fragment:close,x:available-close.width,y:0}]);
        const back=choices.scoreboardReturnToInformation?button('table-scoreboard-back','테이블 정보로 돌아가기',available,metrics,{localIntent:'toggle-scoreboard',enabled:true,intent:'quiet'}):null;
        const fixed=PADDING*2+headingHeight+GAP+(back?back.height+GAP:0),maximum=metrics.environment.height-32;
        const score=document.scoreboard?namespace(scoreboard(document,available,metrics),'current-scoreboard'):null;
        const body=score&&score.height+fixed<=maximum?score:textNode('table-scoreboard-refusal',document.scoreboard?'이 화면에는 점수판 전체를 표시할 공간이 부족해요. 창을 넓히거나 화면을 회전해 주세요.':'현재 표시할 점수판이 없어요.','body',available,metrics);
        // Await complete native measurements before making a fit decision.
        if(!metrics.missing.size&&body.height+fixed>maximum)throw Error('Viewport cannot contain readable scoreboard navigation');
        return group('table-scoreboard-dialog',width,fixed+body.height,[{fragment:heading,x:PADDING,y:PADDING},{fragment:body,x:PADDING,y:PADDING+headingHeight+GAP},...(back?[{fragment:back,x:PADDING,y:PADDING+headingHeight+GAP+body.height+GAP}]:[])],{semanticRole:'dialog',label:document.scoreboard?.title??'점수판',decoration:'dialog'});
    }

    function informationDialog<A>(document:TableDocument<A>,metrics:Measurements,choices:ChoiceView):Fragment|null{
        if(!choices.informationOpen)return null;
        const id='table-information-dialog',width=Math.min(metrics.environment.width-32,560*metrics.environment.textScale),available=width-PADDING*2;
        const close=iconButton('table-information-close','닫기','close',metrics,{localIntent:'toggle-information',enabled:true,intent:'quiet'});
        const title=textNode('table-information-title','테이블 정보','name',Math.max(1,available-close.width-SMALL_GAP),metrics),headingHeight=Math.max(title.height,close.height);
        const heading=group('table-information-heading',available,headingHeight,[{fragment:title,x:0,y:(headingHeight-title.height)/2},{fragment:close,x:available-close.width,y:0}]);
        const bodyAt=(allocation:number)=>{
            const observers=observerSignals(document,allocation,metrics,choices),outcomePanel=document.outcome?document.information?.find(panel=>panel.id===document.outcome!.informationId):undefined;
            const detailsId=document.outcome?.detailsCatalogId;
            const details=detailsId&&document.disclosures?.some(catalog=>catalog.id===detailsId)?button('outcome-details','자세히 보기',allocation,metrics,{enabled:true,intent:'quiet',disclosureCatalogId:detailsId}):null;
            const parts=[...(outcomePanel?[informationPanel(document,outcomePanel,allocation,metrics)]:[]),...(details?[details]:[]),...(document.scoreboard?[button('table-information-scoreboard',`${document.scoreboard.title} 보기`,allocation,metrics,{localIntent:'toggle-scoreboard',enabled:true,intent:'quiet'})]:[]),...(document.information?.length||document.scoreboard||document.facts.length?[factsPanel({...document,scoreboard:undefined},allocation,metrics,false,choices)]:[]),...(choices.assistance?.projection.guidance?[textNode('current-information-guidance',choices.assistance.projection.guidance,'small',allocation,metrics)]:[]),...(observers?[observers]:[])];
            return namespace(column('current-information-content',allocation,parts.length?parts:[textNode('current-information-empty','표시할 테이블 정보가 없어요.','body',allocation,metrics)],GAP),'current-information');
        };
        const maximum=metrics.environment.height-32,fixed=headingHeight+GAP+PADDING*2;
        if(maximum-fixed<TARGET)throw Error('Viewport cannot contain readable table information');
        let body=bodyAt(available),inner=Math.max(TARGET,Math.min(body.height,maximum-fixed)),gutter=body.height>inner?(metrics.environment.scrollbarWidth??0):0;if(gutter)body=bodyAt(available-gutter);
        const viewport=group('table-information-viewport',available,inner,[{fragment:body,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:gutter,semanticRole:'group',label:'테이블 정보 · 세로 스크롤'});
        return group(id,width,fixed+inner,[{fragment:heading,x:PADDING,y:PADDING},{fragment:viewport,x:PADDING,y:PADDING+headingHeight+GAP}],{semanticRole:'dialog',label:'테이블 정보',decoration:'dialog'});
    }
    function publicDisclosureOverlay(shell:Fragment,environment:Environment,choices:ChoiceView,metrics:Measurements):Fragment|null {
        const disclosure=choices.feedback?.disclosures?.[0];if(!disclosure?.cards.length)return null;
        const width=environment.width-PADDING*2,id=key('feedback-disclosure',disclosure.eventId),title=textNode(key(id,'title'),disclosure.title,'name',width,metrics);
        const cardWidth=64,cardHeight=90,step=Math.min(cardWidth+SMALL_GAP,Math.max(EXPOSED,(width-cardWidth)/Math.max(1,disclosure.cards.length-1))),contentWidth=cardWidth+(disclosure.cards.length-1)*step;
        const fan=group(key(id,'fan'),Math.max(width,contentWidth),cardHeight,disclosure.cards.map((card,index)=>({fragment:leaf({id:key(id,'card',String(index)),parent:null,kind:'card',publicDisclosureEventId:disclosure.eventId,label:card.label,visual:card.visual,emphasis:card.emphasis,box:{x:0,y:0,width:cardWidth,height:cardHeight}}),x:index*step,y:0})),{arrangement:'fan'});
        const viewport=group(key(id,'viewport'),width,cardHeight+(contentWidth>width?(environment.scrollbarHeight??0):0),[{fragment:fan,x:0,y:0}],{scroll:contentWidth>width,semanticRole:'group',label:disclosure.title});
        const panel=column(id,width,[title,viewport],SMALL_GAP),placement=choosePublicDisclosurePlacement(shell.nodes,environment.width,environment.height,panel.height);
        return placement?{...panel,nodes:panel.nodes.map((node,index)=>index===0?{...node,publicDisclosureEventId:disclosure.eventId,semanticRole:'group',label:disclosure.title,decoration:'callout',box:{...node.box,x:placement.x,y:placement.y}}:node)}:null;
    }
    function observerReactionOverlay<A>(document:TableDocument<A>,nodes:readonly PlannedNode[],environment:Environment,choices:ChoiceView,metrics:Measurements):Fragment|null {
        const anchored=new Set([...(document.opponents??[]).map(person=>person.id),...(document.participant.role==='observer'?[]:[document.participant.id])]);
        const ids=[...new Set([...(choices.assistance?.projection.reactions??[]).map(record=>record.participantId),...(choices.feedback?.cues??[]).filter(cue=>cue.label).map(cue=>cue.participantId)].filter(id=>!anchored.has(id)))];
        if(!ids.length)return null;
        const slot=nodes.find(node=>node.observerReactionSlot);
        if(slot){
            const byId=new Map(nodes.map(node=>[node.id,node]));let x=slot.box.x,y=slot.box.y,parent=slot.parent,valid=true,steps=0;
            while(parent){const owner=byId.get(parent);if(!owner||++steps>nodes.length){valid=false;break;}x+=owner.box.x;y+=owner.box.y;parent=owner.parent;}
            const bubbles=ids.map(id=>{const name=document.shell?.pages.flatMap(page=>page.people??[]).find(person=>person.id===id)?.name??'관전자',nameWidth=metrics.intrinsic(name,'small').width,labels=[...(choices.assistance?.projection.reactions??[]).filter(record=>record.participantId===id).map(record=>record.text),...(choices.feedback?.cues??[]).filter(record=>record.participantId===id&&record.label).map(record=>record.label!)],signalWidth=Math.max(TARGET,...labels.map(label=>metrics.intrinsic(label,'small').width+SMALL_GAP*2)),title=textNode(key('observer-header-name',id),name,'small',Math.max(1,nameWidth),metrics),signal=column(key('observer-header-signal',id),signalWidth,participantSignals(id,signalWidth,metrics,choices,false),4),height=Math.max(title.height,signal.height);return group(key('observer-header-person',id),nameWidth+SMALL_GAP+signalWidth,height,[{fragment:title,x:0,y:(height-title.height)/2},{fragment:signal,x:nameWidth+SMALL_GAP,y:0}]);});
            if(valid&&bubbles.every(bubble=>bubble.width<=slot.box.width)){const inline=rows('observer-reactions-layer',slot.box.width,bubbles,{},'start');if(inline.height<=slot.box.height&&y+inline.height<=environment.height)return {...inline,nodes:[{...inline.nodes[0],observerReactionLayer:true,observerReactionSlotId:slot.id,semanticRole:'group',label:'관전자 반응 모음',box:{...inline.nodes[0].box,x,y}},...inline.nodes.slice(1)]};}
        }
        const maximum=environment.width-PADDING*2,minimum=Math.max(TARGET,metrics.intrinsic('Ag','small').height+SMALL_GAP*2);
        const naturalWidth=Math.max(minimum,...ids.flatMap(id=>{const name=document.shell?.pages.flatMap(page=>page.people??[]).find(person=>person.id===id)?.name??'관전자',labels=[...(choices.assistance?.projection.reactions??[]).filter(record=>record.participantId===id).map(record=>record.text),...(choices.feedback?.cues??[]).filter(record=>record.participantId===id&&record.label).map(record=>record.label!)];return [metrics.intrinsic(name,'small').width,...labels.map(label=>metrics.intrinsic(label,'small').width+SMALL_GAP*2)];}));
        const widths=[...new Set([Math.min(maximum,naturalWidth),maximum,Math.min(maximum,144*environment.textScale),Math.min(maximum,minimum)])];
        const natural=new Map<string,Size>();for(const node of nodes)if(node.kind==='text'&&node.label){const value=metrics.values.get(metrics.key(node.label,node.role??'body',null));if(value)natural.set(node.id,value);}
        for(const width of widths){
            const bubbles=ids.map(id=>{const name=document.shell?.pages.flatMap(page=>page.people??[]).find(person=>person.id===id)?.name??'관전자',title=textNode(key('observer-overlay-name',id),name,'small',width,metrics),signals=participantSignals(id,width,metrics,choices,false);return column(key('observer-overlay-person',id),width,[title,...signals],4);});
            const content=column('observer-reactions-layer',width,bubbles,SMALL_GAP),placement=chooseObserverReactionPlacement(nodes,environment.width,environment.height,{width:content.width,height:content.height},natural);
            if(placement)return {...content,nodes:[{...content.nodes[0],observerReactionLayer:true,semanticRole:'group',label:'관전자 반응 모음',box:{...content.nodes[0].box,x:placement.x,y:placement.y}},...content.nodes.slice(1)]};
        }
        return null; // All current reactions remain in the full readonly information view.
    }
    /** Invisible complete-trick landmarks. The paint recipe stays unchanged;
     * resolution uses the outgoing frame before publishing a settled layout. */
    function trickLandmarks<A>(document:TableDocument<A>,shell:Fragment,environment:Environment):readonly PlannedNode[]{
        const zone=document.collections?.find(zone=>zone.kind==='trick'&&zone.purpose==='play'),owners=[...(document.participant.role==='observer'?[]:[document.participant.id]),...(document.opponents??[]).map(person=>person.id)];
        if(!zone||owners.length<2||owners.length>8||new Set(owners).size!==owners.length)return [];
        const index=new Map(shell.nodes.map(node=>[node.id,node]));
        const world=(node:PlannedNode)=>{let x=node.box.x,y=node.box.y,parent=node.parent;while(parent){const ancestor=index.get(parent);if(!ancestor)break;x+=ancestor.box.x;y+=ancestor.box.y;parent=ancestor.parent;}return {x,y,width:node.box.width,height:node.box.height};};
        const root=shell.nodes[0],arena=index.get('arena')??index.get('settled-arena')??root,region=world(arena),collection=index.get(key('collection',zone.id)),directional=index.get(key('collection',zone.id,'trick'));
        const short=!!shortLandscapePresentation(environment),base=directional?world(directional):collection&&collection.box.width>0&&collection.box.height>0?world(collection):region;
        const w=short?32:64,h=short?45:90,stage=key('trick-stage',zone.id),plays=zone.cards.map(card=>card.ownerId).filter((id):id is string=>!!id&&owners.includes(id)),order=[...plays,...owners.filter(owner=>!plays.includes(owner))];
        const rowWidth=owners.length*w+Math.max(0,owners.length-1)*4;
        const slots=owners.map(owner=>{
            let x:number,y:number;
            if(!short&&directional&&owners.length===5){const relative=directionalOwners(document)!.indexOf(owner),box=REGULAR_TRICK.slots(base.width)![relative];x=base.x+box.x;y=base.y+box.y;}
            else{x=base.x+(base.width-rowWidth)/2+order.indexOf(owner)*(w+4);y=base.y+Math.max(0,(base.height-h)/2);}
            return {id:key('trick-slot',zone.id,owner),parent:stage,kind:'group' as const,label:'',inert:true,trickSlot:true as const,ownerId:owner,zoneId:zone.id,box:{x,y,width:w,height:h}};
        });
        if(slots.some(slot=>slot.box.x<0||slot.box.y<0||slot.box.x+w>shell.width||slot.box.y+h>shell.height))return [];
        return [{id:stage,parent:root.id,kind:'group',label:'',inert:true,box:{x:0,y:0,width:shell.width,height:shell.height}},...slots];
    }
    /** One engine-owned outgoing public reservation. Latest canonical semantics
     * stay settled: only public identities and inert original slots are rebuilt. */
    function completionTable<A>(document:TableDocument<A>,environment:Environment,choices:ChoiceView,metrics:Measurements):LayoutResult {
        const completion=Object.getOwnPropertyDescriptor(choices,'publicCompletion')?.value;
        if(!isPublicCompletionView(completion))return {kind:'failed',reason:'Unowned public completion'};
        const readDescriptor=Object.getOwnPropertyDescriptor(choices,'publicGameplayRead');
        const read=readDescriptor&&'value'in readDescriptor?readDescriptor.value:undefined;
        const gameplay=readPublicGameplayPresentation(read,completion,document,publicPaintResources(document),environment);
        if(!gameplay)return {kind:'failed',reason:'Unavailable owned public gameplay read'};
        const recipe=completion.recipe;
        const standing=new Map(gameplay.standing.map(person=>[person.participantId,person]));
        const currentPerson={...document.participant,status:standing.get(document.participant.id)?.status,markers:standing.get(document.participant.id)?.markers??[],appearance:document.participant.appearance?{...document.participant.appearance,thinking:false}:undefined};
        const currentPeers=document.opponents?.map(person=>({...person,status:standing.get(person.id)?.status,appearance:person.appearance?{...person.appearance,thinking:false}:undefined}));
        const hud:HudReadContext={participant:currentPerson,opponents:currentPeers,information:gameplay.information,facts:gameplay.facts,scoreboard:gameplay.scoreboard,statusPresentation:gameplay.statusPresentation,stage:document.stage,suppressSummaryInk:true};
        const roster=[...(document.participant.role==='observer'?[]:[document.participant.id]),...(document.opponents??[]).map(person=>person.id)];
        const bounded=(box:Rect)=>[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.x>=0&&box.y>=0&&box.width>0&&box.height>0&&box.x+box.width<=environment.width&&box.y+box.height<=environment.height;
        if(!document.outcome||document.hand.length||(document.opponents??[]).some(person=>person.handCount!==0)||recipe.width!==environment.width||recipe.height!==environment.height||roster.length<2||roster.length>8||recipe.participants.length!==roster.length||recipe.slots.length!==roster.length||new Set(recipe.participants.map(person=>person.participantId)).size!==roster.length||new Set(recipe.slots.map(slot=>slot.ownerId)).size!==roster.length||recipe.participants.some(person=>!roster.includes(person.participantId)||person.local!==(person.participantId===document.participant.id&&document.participant.role!=='observer')||!bounded(person.bounds)||!Number.isFinite(person.figureSize)||person.figureSize<=0)||recipe.slots.some(slot=>!roster.includes(slot.ownerId)||!bounded(slot.bounds))||!bounded(recipe.arena)||recipe.header&&!bounded(recipe.header))return {kind:'cannot-fit',reason:'Current completion cannot retain the outgoing public recipe'};
        const readChoices:ChoiceView={publicCompletion:completion,publicGameplayRead:read,selected:null,fields:[],commands:[],values:null,effectsAvailable:Object.getOwnPropertyDescriptor(choices,'effectsAvailable')?.value===true,preferencesAvailable:Object.getOwnPropertyDescriptor(choices,'preferencesAvailable')?.value===true,shellCommandEnabled:false,shellLeaveEnabled:false};
        const containers=recipe.containers??[],containerIds=new Set(containers.map(item=>item.id));
        if(containerIds.size!==containers.length||containers.length>32||containers.some(item=>!bounded(item.bounds)||item.parentId!=='table-underlay'&&!containerIds.has(item.parentId)))return {kind:'cannot-fit',reason:'Invalid retained public parent composition'};
        const reference=gameplay.statusPresentation,panel=gameplay.information.find(panel=>panel.id===reference?.informationId);
        const chromeDocument=hud;
        const hasCurrentFields=!!(reference?.primary&&panel?.primary)||!!reference?.fieldIds.some(id=>panel?.fields.some(field=>field.id===id));
        const hasContextOwner=recipe.headerStatus==='all'||(recipe.statuses??[]).some(status=>status.section==='all'||status.section==='context');
        const promoteFields=!hasCurrentFields&&!hasContextOwner&&!!panel?.summary;
        const headerSection=recipe.headerStatus==='fields'&&promoteFields?'all':recipe.headerStatus??'none';
        const statusRoot=(section:'all'|'fields'|'context')=>section==='all'?'table-active-status':`table-active-status-${section}`;
        const retainStatusId=(fragment:Fragment,from:'all'|'fields'|'context',to:'all'|'fields'|'context'):Fragment=>from===to?fragment:{...fragment,nodes:fragment.nodes.map(node=>({...node,...(node.id===statusRoot(from)?{id:statusRoot(to)}:{}),...(node.parent===statusRoot(from)?{parent:statusRoot(to)}:{})}))};
        // Held inert values feed only this closed renderer context. Canonical
        // document, resources, shell and action authority remain latest.
        const statusDocument:HudReadContext={...chromeDocument,...(reference?{statusPresentation:{...reference,...(promoteFields?{summary:true}:{}),fieldIds:reference.fieldIds.filter(id=>panel?.fields.some(field=>field.id===id))}}:{})};
        const nodes:PlannedNode[]=[{id:'table-underlay',parent:null,kind:'group',label:'',box:{x:0,y:0,width:environment.width,height:environment.height}}];
        const boundsFor=(id:string):Rect=>id==='table-underlay'?{x:0,y:0,width:environment.width,height:environment.height}:containers.find(item=>item.id===id)!.bounds;
        const add=(fragment:Fragment,parentId:string,bounds:Rect,reserve=false)=>{const parent=boundsFor(parentId);nodes.push(...fragment.nodes.map((node,index)=>index===0?{...node,parent:parentId,box:{...node.box,x:bounds.x-parent.x,y:bounds.y-parent.y,...(reserve?{width:bounds.width,height:bounds.height}:{})}}:node));};
        for(const item of containers){const parent=boundsFor(item.parentId);nodes.push({id:item.id,parent:item.parentId,kind:'group',label:item.id==='table-sidebar'?'테이블 정보 · 세로 스크롤':'',box:{...item.bounds,x:item.bounds.x-parent.x,y:item.bounds.y-parent.y},...(item.tray?{decoration:'tray' as const}:{}),...(item.scroll?{scroll:true,scrollAxis:'y' as const,scrollbarGutter:item.gutter??0,semanticRole:'group' as const}:{})});}
        const plannedHeader=shellHeader(document,recipe.header?.width??environment.width-PADDING*2,metrics,readChoices,headerSection,undefined,statusDocument),header=plannedHeader&&promoteFields&&recipe.headerStatus==='fields'?retainStatusId(plannedHeader,'all','fields'):plannedHeader;
        if(header){if(!recipe.header||header.height>recipe.header.height)return metrics.missing.size?{kind:'needs',requests:[...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT)}:{kind:'cannot-fit',reason:'Current room controls exceed retained public header'};add(header,'table-underlay',recipe.header,true);}
        for(const person of recipe.participants){
            const current=(currentPeers??[]).find(candidate=>candidate.id===person.participantId);
            const complete=person.local?identity(document,person.bounds.width,metrics,false,readChoices,false,hud):opponents([current!],person.bounds.width,metrics,key('completion-peer',person.participantId),readChoices,false,false,hud,undefined,'portrait',person.figureSize);
            const identityId=person.local?'identity':key(key('opponent',person.participantId),'identity'),root=complete.nodes.find(node=>node.id===identityId)!;
            const owned=new Set([identityId]);for(const node of complete.nodes)if(node.parent&&owned.has(node.parent))owned.add(node.id);
            const fragment:Fragment={width:root.box.width,height:root.box.height,nodes:complete.nodes.filter(node=>owned.has(node.id)).map(node=>node.id===identityId?{...node,parent:null,box:{...node.box,x:0,y:0}}:node)};
            if(fragment.height>person.bounds.height||fragment.width>person.bounds.width){if(metrics.missing.size)return {kind:'needs',requests:[...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT)};return {kind:'cannot-fit',reason:'Current identity exceeds retained public allocation'};}
            const parent=person.parentId??'table-underlay';if(parent!=='table-underlay'&&!containerIds.has(parent))return {kind:'cannot-fit',reason:'Missing retained participant parent'};add(fragment,parent,person.bounds,true);
        }
        if(!containerIds.has('arena'))add(group('arena',recipe.arena.width,recipe.arena.height,[]),'table-underlay',recipe.arena);
        const sidebar=containers.find(item=>item.id==='table-sidebar');
        if(sidebar){const gutter=sidebar.gutter??0,allocation=Math.max(1,sidebar.bounds.width-gutter);if(hud.scoreboard&&scoreboard(hud,allocation,metrics).height>sidebar.bounds.height)return metrics.missing.size?{kind:'needs',requests:[...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT)}:{kind:'cannot-fit',reason:'Current public roster exceeds retained sidebar'};const content=factsPanel(chromeDocument,allocation,metrics,false,readChoices,sidebar.bounds.height);add(content,sidebar.id,{x:sidebar.bounds.x,y:sidebar.bounds.y,width:content.width,height:content.height});}
        for(const status of recipe.statuses??[]){const section=status.section==='fields'&&promoteFields?'all':status.section,planned=activeStatus(statusDocument,status.bounds.width,metrics,section),content=planned?retainStatusId(planned,section,status.section):null;if(!content||content.height>status.bounds.height)return metrics.missing.size?{kind:'needs',requests:[...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT)}:{kind:'cannot-fit',reason:'Current status exceeds retained public allocation'};add(content,status.parentId,status.bounds,true);}
        const stage=key('trick-stage',completion.sourceCollectionId);nodes.push({id:stage,parent:'table-underlay',kind:'group',label:'',inert:true,box:{x:0,y:0,width:environment.width,height:environment.height}},...recipe.slots.map(slot=>({id:key('trick-slot',completion.sourceCollectionId,slot.ownerId),parent:stage,kind:'group' as const,label:'',inert:true,trickSlot:true as const,ownerId:slot.ownerId,zoneId:completion.sourceCollectionId,box:{...slot.bounds}})));
        const shell:Fragment={width:environment.width,height:environment.height,nodes};
        return finishTable(visibleCollectionDocument(document),environment,readChoices,metrics,shell,'stacked');
    }
    /** A directional public table has one responsive parent composition. Its
     * public capacity and separate decision owner never resize the seat ring. */
    function regularPublicScene<A>(canonical:TableDocument<A>,document:TableDocument<A>,environment:Environment,choices:ChoiceView,metrics:Measurements):LayoutResult|null {
        const people=document.opponents??[],roster=[...(document.participant.role==='observer'?[]:[document.participant.id]),...people.map(person=>person.id)],tricks=canonical.collections?.filter(zone=>zone.kind==='trick'&&zone.purpose==='play')??[],selected=canonical.presentation?.tableCollectionIds;
        // Legacy all-collection surfaces keep their existing composition. This
        // profile owns one explicitly selected public trick (or its empty
        // settled selection), never unrelated history/stock collections.
        if(environment.width<1100||environment.height<640||document.outcome?.overview||document.participant.role==='observer'||people.length!==4||tricks.length!==1||!selected||selected.some(id=>id!==tricks[0].id)||!document.scoreboard||!roster.every(id=>document.scoreboard!.rows.some(row=>row.participantId===id)))return null;
        const width=environment.width-PADDING*2,gutter=environment.scrollbarWidth??0;
        const railWidth=Math.min(Math.max(360,280*environment.textScale),Math.max(280*environment.textScale,width*.24)),mainWidth=width-railWidth-GAP-gutter;
        const header=shellHeader(document,width,metrics,choices,'none'),headerHeight=header?header.height+GAP:0,bodyHeight=environment.height-headerHeight-PADDING*2;
        if(!Number.isFinite(bodyHeight)||bodyHeight<=0||!Number.isFinite(mainWidth)||mainWidth<=0)return null;
        const localWidth=identityRequirements(document,metrics).preferredWidth,handWidth=mainWidth-DOCK_PADDING*2-localWidth-GAP;
        if(handWidth<=0)return {kind:'cannot-fit',reason:'Public scene cannot contain its measured local identity and hand'};
        const localAllocation=identity(document,localWidth,metrics,false,choices,false,undefined,true);
        const local=document.outcome?identity(document,mainWidth-DOCK_PADDING*2,metrics,true,choices,false,undefined,true):localAllocation;
        const row=calculateHandRowMetrics({regionWidth:handWidth,viewportWidth:environment.width,viewportHeight:environment.height,selectionLift:SELECTION_LIFT,padding:HAND_SELECTION_PADDING,scrollbarHeight:environment.scrollbarHeight??0});
        const handHeight=row.oneRowHeight,rowHeight=Math.max(handHeight,localAllocation.height)+DOCK_PADDING*2;
        const potentialInstruction=document.interaction?.cardActivation?nativeInstruction({selected:null,values:{},commands:[],fields:[],nativeCardPresentation:{kind:'native-one',activation:document.interaction.cardActivation,captions:nativeCardCaptionDomain,caption:null}},mainWidth,metrics):null;
        const instructionHeight=potentialInstruction?potentialInstruction.height+SMALL_GAP:0;
        let scene:ReturnType<typeof publicSceneEnvelope>;
        try{scene=publicSceneEnvelope({viewport:environment,region:{width,height:bodyHeight},mainWidth,dockHeight:rowHeight,instructionHeight});}
        catch(error){if(error instanceof PublicSceneUnavailable)return null;throw error;}
        const columns=regularParticipantColumns({width:scene.arena.width,figure:scene.peerFigure,gap:GAP,minimumCenter:REGULAR_TRICK.minimumWidth,minimumWing:Math.max(...people.map(person=>peerMinimumWidth(person,document,metrics,scene.peerFigure)))});
        if(!columns)return null;
        const centerWidth=columns.centerWidth;
        const controlWidth=Math.max(1,scene.arena.width-gutter);
        const controlView=controlChoices(choices),reservation=controlView.decisionPresentation?measureDecisionDomain(controlView.decisionPresentation,controlWidth,metrics):groupDecisionReservation(controlView,controlWidth,metrics);
        const hasControls=controlView.commands.length>0||!!controlView.selected||controlView.fields.length>0||!!controlView.cards||!!controlView.selectionPresentation;
        const guidance=!hasControls&&!choices.nativeCardPresentation?choices.assistance?.projection.guidance:undefined;
        const unreservedControls=reservation?null:guidance?column('decisions',controlWidth,[textNode('decision-guidance',guidance,'small',controlWidth,metrics)],SMALL_GAP):decisions(choices,controlWidth,metrics,true);
        const nativeEnvelope=(role:'button'|'choice')=>{const recipe=environment.controls[role==='button'?'command':'choice'],height=Math.max(TARGET,recipe.minHeight,metrics.intrinsic('Ag',role).height+recipe.paddingY*2);return height+Math.max(6,height*(recipe.pulse-1)/2+5)*2;};
        const minimumCorridor=document.outcome||choices.nativeCardPresentation&&!hasControls&&!reservation?0:Math.max(nativeEnvelope('button'),nativeEnvelope('choice')+(environment.scrollbarHeight??0),reservation?.minimumHeight??0);
        // Admit the full ring and complete decision minimum inside the physical
        // scene before materializing controls into their assigned corridor.
        const measuredRing=seatArena(document,scene.arena.width,0,metrics,choices,true,undefined,scene.peerFigure,{centerHeight:REGULAR_TRICK.height,columns});
        const minimumScene=Math.ceil((measuredRing.sceneContentHeight??measuredRing.height)+(minimumCorridor?SMALL_GAP+minimumCorridor:0));
        if(minimumScene>scene.arena.height){try{scene=publicSceneEnvelope({viewport:environment,region:{width,height:bodyHeight},mainWidth,dockHeight:rowHeight,instructionHeight,minimumArenaHeight:minimumScene});}catch(error){if(error instanceof PublicSceneUnavailable)return null;throw error;}}
        const resultRoom=scene.arena.height-(measuredRing.sceneCenterY??0),result=outcome(document,centerWidth,metrics,choices,resultRoom);
        if(result&&result.height>resultRoom)return {kind:'cannot-fit',reason:'Current result exceeds the public centre allocation'};
        const ring=seatArena(document,scene.arena.width,scene.arena.height,metrics,choices,true,undefined,scene.peerFigure,{centerHeight:REGULAR_TRICK.height,columns});
        const corridorHeight=scene.arena.height-(ring.sceneContentHeight??ring.height)-SMALL_GAP;
        const preferredControlHeight=reservation?.height??unreservedControls!.height,assignedControlHeight=Math.min(preferredControlHeight,corridorHeight,Math.max(scene.frame.decisionCap??Infinity,reservation?.minimumHeight??0));
        const controls=unreservedControls??decisions(choices,controlWidth,metrics,true,assignedControlHeight);
        const actualControlMinimum=Math.max(TARGET,...controls.nodes.filter(node=>['command','choice','select','toggle','range','editor'].includes(node.kind)).map(node=>{const parent=controls.nodes.find(parent=>parent.id===node.parent);return parent?.id===key('control-envelope',node.id)?parent.box.height:node.box.height;}));
        const controlHeight=controls.height?assignedControlHeight:0,requiredMinimum=reservation?.minimumHeight??Math.min(controls.height,actualControlMinimum);
        if(!result&&controls.height&&controlHeight<requiredMinimum)return {kind:'cannot-fit',reason:'Current controls exceed the public scene free corridor'};
        const controlContent={...controls,nodes:controls.nodes.map((node,index)=>index===0?{...node,id:'decision-content'}:node.parent===controls.nodes[0].id?{...node,parent:'decision-content'}:node)};
        const nativeControl=controls.nodes.some(node=>['command','choice','select','toggle','range','editor'].includes(node.kind));
        if(nativeControl&&controlHeight<TARGET)return {kind:'cannot-fit',reason:'Native decision cannot fit its required viewport'};
        const controlViewport=!result&&controls.height?controlHeight>=TARGET?scrollColumn('decisions',scene.arena.width,controlHeight,[controlContent],gutter,'선택과 실행 · 세로 스크롤'):group('decisions',scene.arena.width,controlHeight,[{fragment:controlContent,x:0,y:0}],{semanticRole:'group',label:'현재 선택 안내'}):null;
        const dockParts:{fragment:Fragment;x:number;y:number}[]=[];
        if(local)dockParts.push({fragment:local,x:DOCK_PADDING,y:DOCK_PADDING});
        if(!document.outcome){
            const cards=hand(document,handWidth,metrics,'hand',choices.cards,'hand',false,undefined,choices);
            if(cards.height>handHeight)return {kind:'cannot-fit',reason:'Current hand needs more than the shared single-row allocation'};
            dockParts.push({fragment:cards,x:DOCK_PADDING+localWidth+GAP,y:DOCK_PADDING});
        }
        const tray=group('dock',mainWidth,rowHeight,dockParts,{decoration:'tray'}),instruction=nativeInstruction(choices,mainWidth,metrics);
        const dockContext=group('native-dock-context',mainWidth,scene.frame.regions.tray.height,[...(instruction?[{fragment:instruction,x:0,y:0}]:[]),{fragment:tray,x:0,y:instructionHeight}]);
        const sceneHeight=scene.contentHeight;
        const arena=group('regular-arena',mainWidth,ring.height,[{fragment:ring,x:scene.arena.x,y:0}]);
        const corridor=controlViewport?jointDecisionCorridor({...scene.frame,regions:{...scene.frame.regions,strip:{...scene.frame.regions.strip,x:scene.arena.x,width:scene.arena.width}}},{contentHeight:controlHeight,minimumHeight:Math.min(controlHeight,requiredMinimum),frameHeight:sceneHeight,protected:[]}):null;
        if(controlViewport&&!corridor)return {kind:'cannot-fit',reason:'Current controls exceed the public decision corridor'};
        const stripContent=result??controlViewport;
        const strip=stripContent?group('table-decision-strip',stripContent.width,stripContent.height,[{fragment:stripContent,x:0,y:0}]):null;
        const stripPosition=result?{x:scene.arena.x+columns.wing+GAP,y:scene.arena.y+(measuredRing.sceneCenterY??0)+Math.max(0,(REGULAR_TRICK.height-result.height)/2)}:corridor?{x:corridor.x,y:corridor.y}:null;
        const left=group('active-table-content',mainWidth,sceneHeight,[{fragment:arena,x:0,y:scene.arena.y},{fragment:dockContext,x:0,y:scene.frame.regions.tray.y},...(strip&&stripPosition?[{fragment:strip,...stripPosition}]:[])],strip?{jointDecisionLayer:true}:{});
        const facts=factsPanel(document,Math.max(1,railWidth-gutter),metrics,false,choices,scene.railHeight),tools=assistanceTools(Math.max(1,railWidth-gutter),metrics,choices);
        const rail=scrollColumn('table-sidebar',railWidth,scene.railHeight,[facts,...(tools?[tools]:[])],gutter,'테이블 정보 · 세로 스크롤');
        const body=group('table-body',width,sceneHeight,[{fragment:left,x:0,y:0},{fragment:rail,x:mainWidth+GAP+gutter,y:0}]);
        const shell=column('table-underlay',environment.width,[...(header?[header]:[]),body],GAP,PADDING);
        return finishTable(document,environment,choices,metrics,shell,'side-by-side',['dock',...(controls.height&&!result?['decisions']:[]),...(instruction?['native-play-instruction']:[])],sceneHeight>bodyHeight);
    }
    function finishTable<A>(document:TableDocument<A>,environment:Environment,choices:ChoiceView,metrics:Measurements,shell:Fragment,recipe:CandidateLayout['recipe'],primaryRegionIds?:readonly string[],primaryOverflow=false):LayoutResult{
            const height = Math.max(environment.height, shell.height),dialog=choices.disclosure?disclosureDialog(choices.disclosure,metrics):choices.form?formDialog(document,choices.form,metrics):shellDialog(document,metrics,choices)??cardActionDialog(metrics,choices)??catalogueDialog(metrics,choices)??scoreboardDialog(document,metrics,choices)??informationDialog(document,metrics,choices)??assistanceDialog(document,metrics,choices);
            if(metrics.missing.size)return {kind:'needs',requests:[...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT)};
            const publicDisclosure=dialog?null:publicDisclosureOverlay(shell,environment,choices,metrics);
            if(metrics.missing.size)return {kind:'needs',requests:[...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT)};
            const underlay={...shell.nodes[0],parent:'table',inert:!!dialog,box:{...shell.nodes[0].box,height}};
            const root:PlannedNode={id:'table',parent:null,kind:'group',label:'',arrangement:'overlay',scroll:height>environment.height,box:{x:0,y:0,width:environment.width,height}};
            const normalized=normalizeDecision({decision:document.decision,offer:document.offer,handIds:document.hand.map(card=>card.id)}).value;
            const groupNodes=shell.nodes.slice(1).map(node=>{const id=node.actionId?normalized?.bindings[node.actionId]:node.cardId||node.inspectCardId||node.cardActionPickerIntent||node.cardActionOptionId||node.localIntent==='submit-card-set'?cardDecision(document.decision)?.id:node.fieldId||node.catalogueIntent?finiteDecision(document.decision)?.id:undefined;return id?{...node,decisionGroupId:id}:node;});
            const baseNodes=[root,underlay,...groupNodes,...trickLandmarks(document,shell,environment),...(publicDisclosure?[{...publicDisclosure.nodes[0],parent:'table'},...publicDisclosure.nodes.slice(1)]:[])],observer=dialog?null:observerReactionOverlay(document,baseNodes,environment,choices,metrics);
            if(metrics.missing.size)return {kind:'needs',requests:[...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT)};
            const layout: CandidateLayout = { ...(primaryRegionIds?{primaryViewport:Object.freeze({height:environment.height,regionIds:Object.freeze([...primaryRegionIds]),...(primaryOverflow?{overflow:'root-scroll' as const}:{})})}:{}),...(document.outcome&&shell.nodes.some(node=>node.id==='outcome')?{outcomeLaneId:'outcome' as const}:{}),...(!document.outcome&&document.stage!=='waiting'&&shell.nodes.some(node=>node.id==='decisions')?{decisionLaneId:'decisions'}:{}),...(dialog?{modalId:dialog.nodes[0].id}:{}),deals:document.deals, stockReturn:document.stockReturn, reveals:document.reveals, width: environment.width, height, recipe, nodes: [...baseNodes,...(observer?[{...observer.nodes[0],parent:'table'},...observer.nodes.slice(1)]:[]),...(dialog?[{...dialog.nodes[0],parent:'table',box:{...dialog.nodes[0].box,x:(environment.width-dialog.width)/2,y:Math.max(0,(environment.height-dialog.height)/2)}},...dialog.nodes.slice(1)]:[])] };
            if(!document.outcome&&document.stage!=='waiting'&&document.participant.role!=='observer'&&!document.hand.length){const short=shortLandscapePresentation(environment);registerOwnDockReceiveCandidate(layout,document.participant.id,[document.participant.id,...(document.opponents??[]).map(person=>person.id)],{padding:short?4:DOCK_PADDING,gap:short?short.publicCard.width:GAP,short:!!short});}
            handValidationEnvironments.set(layout,Object.freeze({...environment}));
            const errors = [...validateLayout(layout,environment),...figurePaintAdmission(layout.nodes,layout.width,layout.height)];
            return errors.length ? { kind: 'failed', reason: errors.join('; ') } : { kind: 'ready', layout };
    }
    /** Pure width-bound composition. No renderer, legacy geometry or transport dependency. */
    return (canonicalDocument, environment, choices, values): LayoutResult => {
        const document=visibleCollectionDocument(canonicalDocument);
        if (![environment.width, environment.height, environment.textScale].every(Number.isFinite) || environment.width <= 0 || environment.height <= 0 || environment.textScale <= 0)
            return { kind: 'failed', reason: 'Invalid environment dimensions or text scale' };
        if (environment.width < PADDING * 2 + DOCK_PADDING * 2 + CARD_WIDTH + (cardDecision(document.decision) ? 12 : 0))
            return { kind: 'cannot-fit', reason: 'TableShell allocation cannot contain the hand and its required paint clearance' };
        if(document.opponents?.length && environment.width<(document.opponents.length>=3?264:248))return {kind:'cannot-fit',reason:'Seat arena cannot contain readable identities and anonymous hands'};
        if([environment.scrollbarWidth??0,environment.scrollbarHeight??0].some(value=>!Number.isFinite(value)||value<0))return {kind:'failed',reason:'Invalid native scrollbar metric'};
        const metrics = new Measurements(environment, values);
        try {
            const completionDescriptor=Object.getOwnPropertyDescriptor(choices,'publicCompletion');
            if(completionDescriptor&&!('value'in completionDescriptor))return {kind:'failed',reason:'Unowned public completion'};
            if(completionDescriptor?.value)return completionTable(canonicalDocument,environment,choices,metrics);
            // Discover all intrinsic reads together. No zero-sized substitute can enter a visible frame.
            for (const [text, role] of texts(document, choices))
                metrics.intrinsic(text, role);
            if (metrics.missing.size)
                return { kind: 'needs', requests: [...metrics.missing.values()].slice(0,MEASUREMENT_BATCH_LIMIT) };
            const width = environment.width - PADDING * 2;
            let roomHeader=shellHeader(document,width,metrics,choices),headerHeight=roomHeader?roomHeader.height+GAP:0;
            if(document.stage==='waiting'){
                const hasInformation=!!document.information?.length||!!document.scoreboard||document.facts.length>0,wideInformation=hasInformation&&width>=640+GAP+280*environment.textScale,railWidth=wideInformation?Math.max(280*environment.textScale,Math.min(360*environment.textScale,width*.28)):0,arenaWidth=wideInformation?width-railWidth-GAP:width;
                const controls=decisions(choices,arenaWidth,metrics);
                const reactionChoices:ChoiceView=choices.assistance?{...choices,assistance:{...choices.assistance,projection:{...choices.assistance.projection,tools:choices.assistance.projection.tools.filter(tool=>tool.kind==='send-reaction'||tool.enabled)}}}:choices;
                const reactions=assistanceTools(arenaWidth,metrics,reactionChoices,true),opener=hasInformation&&!wideInformation?button('waiting-information','테이블 정보',arenaWidth,metrics,{localIntent:'toggle-information',enabled:true,intent:'quiet'}):null;
                const tools=opener&&reactions?(opener.width+reactions.width+GAP<=arenaWidth?group('waiting-toolbar',arenaWidth,Math.max(opener.height,reactions.height),[{fragment:opener,x:0,y:0},{fragment:reactions,x:arenaWidth-reactions.width,y:0}]):column('waiting-toolbar',arenaWidth,[opener,reactions],GAP)):opener??reactions;
                const waiting=createWaitingLayout(document,arenaWidth,environment.height-headerHeight-PADDING*2,controls,tools,{
                    group,column,text:(id,label,role,allocation)=>textNode(id,label,role,allocation,metrics),
                    figure:(id,label,size,appearance,ownerId)=>leaf({id,parent:null,kind:'figure',label,appearance,ownerId,...(ownerId?participantFigureCue(ownerId,choices):{}),box:{x:0,y:0,width:size,height:size}}),
                    action:(id,action,allocation)=>button(id,action.label,allocation,metrics,{shellActionId:action.id,shellIntent:action.intent,enabled:action.enabled&&(action.intent.kind!=='command'||choices.shellCommandEnabled===true),intent:action.intent.kind==='inspect-subject'?'quiet':'secondary'}),
                    stock:(id,collection,artWidth,artHeight)=>leaf({id,parent:null,kind:'card',zoneId:collection.id,stockCount:collection.hiddenCount??0,visual:{kind:'back'},label:collectionLabel(collection),box:{x:0,y:0,width:artWidth,height:artHeight}}),
                    local:allocation=>{
                        if(document.participant.role==='observer')return group('waiting-local',allocation,0,[]);
                        const figure=leaf({id:'identity-figure',parent:null,kind:'figure',label:document.participant.name,appearance:document.participant.appearance,ownerId:document.participant.id,...participantFigureCue(document.participant.id,choices),box:{x:0,y:0,width:LOCAL_FIGURE_SIZE,height:LOCAL_FIGURE_SIZE}});
                        const art=group('identity-art',allocation,LOCAL_FIGURE_SIZE,[{fragment:figure,x:(allocation-LOCAL_FIGURE_SIZE)/2,y:0}]);
                        const measured=textNode('identity-name',document.participant.name,'name',allocation,metrics),name={...measured,nodes:measured.nodes.map(node=>({...node,textAlign:'center' as const}))};
                        const signals=participantSignals(document.participant.id,allocation,metrics,choices);
                        const participant=column('identity',allocation,[art,name,...signals],SMALL_GAP),figureNode=participant.nodes.find(node=>node.id==='identity-figure')!;
                        return {...participant,nodes:[...participant.nodes,{id:'own-hand-count-anchor',parent:figureNode.parent,kind:'group',label:'',inert:true,ownHandAnchor:{participantId:document.participant.id,count:document.hand.length},box:{...figureNode.box}}]};
                    }
                });
                const waitingZeros=(document.opponents??[]).filter(person=>person.handCount===0).flatMap(person=>{const figures=waiting.nodes.filter(node=>node.kind==='figure'&&node.ownerId===person.id);if(figures.length!==1)return [];const figure=figures[0];return [{id:key('waiting-recipient-zero',person.id),parent:figure.parent,kind:'group' as const,label:'',inert:true,recipientId:person.id,recipientCount:0,box:{...figure.box}}];});
                const waitingWithCounts={...waiting,nodes:[...waiting.nodes,...waitingZeros]};
                const info=wideInformation?scrollColumn('waiting-information-rail',railWidth,waiting.height,[factsPanel(document,railWidth-(environment.scrollbarWidth??0),metrics,false,choices)],environment.scrollbarWidth??0,'테이블 정보 · 세로 스크롤'):null;
                const body=info?group('waiting-body',width,waiting.height,[{fragment:waitingWithCounts,x:0,y:0},{fragment:info,x:arenaWidth+GAP,y:0}]):waitingWithCounts;
                const shell=column('table-underlay',environment.width,[...(roomHeader?[roomHeader]:[]),body],GAP,PADDING);
                return finishTable(document,environment,choices,metrics,shell,'stacked');
            }
            const regularScene=regularPublicScene(canonicalDocument,document,environment,choices,metrics);
            if(regularScene)return regularScene;
            const people=document.opponents??[];
            const compact=people.length>0;
            const hasFacts=document.facts.length>0||!!document.information?.some(panel=>panel.id!==document.outcome?.informationId)||!!document.scoreboard;
            const continuationIds=new Set(document.outcome?.continuationActionIds??[]);
            const gameChoices=document.outcome?{...choices,commands:choices.commands.filter(command=>!continuationIds.has(command.id)),...(choices.selected&&continuationIds.has(choices.selected.id)?{selected:null}:{})}:choices;
            const hasSidebar=compact&&width>=640+GAP+280*environment.textScale;
            // The detailed rail may own status only after its full information
            // and complete score roster fit the initial viewport together.
            let railOwnsStatus=false;
            const rosterIds=[...(document.participant.role==='observer'?[]:[document.participant.id]),...people.map(person=>person.id)];
            const completeRoster=!!document.scoreboard&&rosterIds.every(id=>document.scoreboard!.rows.some(row=>row.participantId===id));
            if(completeRoster&&hasSidebar&&!document.outcome&&!shortLandscapePresentation(environment)&&(document.statusPresentation||document.facts.some(fact=>fact.essential))){
                const sidebarWidth=Math.min(Math.max(360,280*environment.textScale),Math.max(280*environment.textScale,width*.24));
                const controlsHeader=shellHeader(document,width,metrics,choices,'none');
                const controlsHeight=controlsHeader?controlsHeader.height+GAP:0,railBudget=environment.height-controlsHeight-PADDING*2;
                const completeRail=factsPanel(document,Math.max(1,sidebarWidth),metrics,false,choices);
                if(!metrics.missing.size&&completeRail.height<=railBudget){railOwnsStatus=true;roomHeader=controlsHeader;headerHeight=controlsHeight;}
            }
            const narrowFooter=compact&&!hasSidebar&&!document.outcome;
            const footerRow=(role:'button'|'choice')=>{const recipe=environment.controls[role==='choice'?'choice':'command'],height=Math.max(TARGET,recipe.minHeight,metrics.intrinsic('Ag',role).height+recipe.paddingY*2);return height+Math.max(6,height*(recipe.pulse-1)/2+5)*2;};
            const footerHeight=narrowFooter?Math.ceil(footerRow('button')+nativeTextControlHeight(typography('select',environment).lineHeight)+12+metrics.intrinsic('Ag','small').height+SMALL_GAP+GAP):0;

            if(compact&&!document.outcome&&shortLandscapePresentation(environment)&&!choices.decisionPresentation){
                const shortHeader=shellHeader(document,width,metrics,choices,'fields'),shortHeaderHeight=shortHeader?shortHeader.height+GAP:0;
                const bodyHeight=environment.height-shortHeaderHeight-PADDING*2,gutter=environment.scrollbarWidth??0;
                const laneWidths=[Math.max(240,Math.round(width*.36)),Math.max(240,Math.round(width*.42)),240];
                for(const laneWidth of laneWidths){
                    if(bodyHeight<=0)break;
                    const mainWidth=width-laneWidth-SMALL_GAP;if(mainWidth<232)continue;
                    const local=document.participant.role==='observer'?{fragment:group('dock',mainWidth,0,[]),recipe:'stacked' as const}:dock(document,mainWidth,metrics,choices);
                    if(local.recipe!=='side-by-side'&&document.participant.role!=='observer')continue;
                    const {secondary,arenaDocument}=playCollections(document);
                    const ring=seatArena(arenaDocument,mainWidth,0,metrics,choices,true),standaloneStatus=!shortHeader?activeStatus(document,mainWidth,metrics,'fields'):null;
                    const arena=standaloneStatus?{...column('landscape-arena-column',mainWidth,[standaloneStatus,ring],SMALL_GAP),...(ring.primaryCardBand?{primaryCardBand:{...ring.primaryCardBand,y:standaloneStatus.height+SMALL_GAP+ring.primaryCardBand.y}}:{})}:ring;
                    const controls=decisions(gameChoices,laneWidth-gutter,metrics,true,bodyHeight-TARGET-SMALL_GAP),instruction=nativeInstruction(gameChoices,laneWidth-gutter,metrics);
                    const panel=column('short-play-context',laneWidth-gutter,[...(controls.height?[controls]:[]),...(instruction?[instruction]:[])],4);
                    const opener=button('active-information','테이블 정보',laneWidth-gutter,metrics,{localIntent:'toggle-information',enabled:true,intent:'quiet'}),tools=assistanceTools(laneWidth-gutter,metrics,choices,true);
                    const toolContent=rows('active-tools-content',laneWidth-gutter,[opener,...(tools?[tools]:[])],{},'start');
                    const toolbarHeight=Math.max(footerRow('button'),24*Math.max(1,environment.textScale)+28);
                    const toolbar=scrollColumn('table-footer',laneWidth,toolbarHeight,[toolContent],gutter,'테이블 정보와 도구 · 세로 스크롤');
                    const phaseContext=activeStatus(document,laneWidth-gutter,metrics,'context');
                    const historyContent=secondary.length?publicCollections({...document,collections:[...secondary.filter(zone=>zone.purpose==='captured'),...secondary.filter(zone=>zone.purpose!=='captured')]},laneWidth-gutter,metrics,'history-collections',false,false,choices):null;
                    const laneGap=Math.max(0,Math.min(SMALL_GAP,bodyHeight-arena.height-local.fragment.height));
                    // Retain a complete captured-card band; additional auxiliary
                    // collections remain reachable in this existing scroll path.
                    const historyMinimum=historyContent?{width:historyContent.width,height:Math.min(historyContent.height,Math.max(TARGET,(historyContent.capturedCardBand?.y??0)+(historyContent.capturedCardBand?.height??0)))}:undefined;
                    const plan=composeShortLandscape({width,height:bodyHeight,laneWidth,arena,dock:local.fragment,context:phaseContext??undefined,decisions:panel,tools:toolbar,history:historyMinimum,gap:laneGap});
                    if(!plan)continue;
                    const strip=group('table-decision-strip',laneWidth,panel.height,[{fragment:panel,x:0,y:0}]);
                    const count=[phaseContext,historyContent,panel.height?panel:null,toolbar].filter(Boolean).length;
                    const historyHeight=bodyHeight-(phaseContext?.height??0)-panel.height-toolbar.height-laneGap*Math.max(0,count-1);
                    const historyPanel=historyContent?scrollColumn('landscape-history',laneWidth,historyHeight,[historyContent],gutter,'지난 카드와 보조 카드 · 세로 스크롤'):null;
                    const lane=column('landscape-decision-lane',laneWidth,[...(phaseContext?[phaseContext]:[]),...(historyPanel?[historyPanel]:[]),...(panel.height?[strip]:[]),toolbar],laneGap);
                    const body=group('active-table-content',width,bodyHeight,[{fragment:arena,...plan.arena},{fragment:local.fragment,...plan.dock},{fragment:lane,...plan.lane}]);
                    const shell=column('table-underlay',environment.width,[...(shortHeader?[shortHeader]:[]),body],GAP,PADDING);
                    return finishTable(document,environment,choices,metrics,shell,'side-by-side',['dock',...(controls.height?['decisions']:[]),...(instruction?['native-play-instruction']:[])]);
                }
            }
            const dockWidth=hasSidebar?width-Math.min(Math.max(360,280*environment.textScale),Math.max(280*environment.textScale,width*.24))-GAP-(environment.scrollbarWidth??0):width;
            const localDock=document.participant.role==='observer'?{fragment:group('dock',dockWidth,0,[]),recipe:'stacked' as const}:dock(document,dockWidth,metrics,choices);
            const settledReservation=document.outcome&&!document.outcome.overview?regularParticipantRegion({viewportWidth:environment.width,viewportHeight:environment.height,width:Math.max(1,dockWidth-(hasSidebar?0:environment.scrollbarWidth??0)),height:Math.max(0,environment.height-headerHeight-PADDING*2-localDock.fragment.height-GAP)}):null;
            const publicMinimum=settledReservation?settledArena(document,settledReservation.width,metrics,choices,settledReservation.peerFigure).priorityHeight:0;
            const result=outcome(document,dockWidth,metrics,choices,environment.height-headerHeight-PADDING*2-localDock.fragment.height-publicMinimum-GAP*2);
            const promptDock=withNativeInstruction(localDock,gameChoices,metrics);
            const measuredDock=result?{...localDock,fragment:column('settled-dock',dockWidth,[result,...(localDock.fragment.height?[localDock.fragment]:[])],GAP)}:promptDock;
            if(compact&&!document.outcome&&choices.decisionPresentation){
                const domain=choices.decisionPresentation,gutter=environment.scrollbarWidth??0,activeWidth=dockWidth,railWidth=width-activeWidth-GAP;
                const tools=assistanceTools(Math.max(1,activeWidth),metrics,choices,true,true),desktop=environment.width>=1024&&environment.height>=640;
                const initialDock=calculateDockRegions({viewport:environment,region:{width:activeWidth,height:0},handHeight:CARD_HEIGHT});
                const ownPortrait=desktop?identity(document,initialDock.identity.width,metrics,true,choices):null,ownCards=desktop?hand(document,initialDock.handArea.width,metrics,'hand',choices.cards,'hand',false,undefined,choices):null;
                const dockMinimum=ownPortrait&&ownCards?calculateDockRegions({viewport:environment,region:{width:activeWidth,height:0},handHeight:ownCards.height,identityHeight:ownPortrait.height}).minimumHeight:measuredDock.fragment.height;
                const header=desktop?roomHeader:shellHeader(document,width,metrics,choices,railOwnsStatus?'none':'all',tools??group('phase-tools-empty',0,0,[]));
                roomHeader=header;headerHeight=header?header.height+GAP:0;
                const headerSpace=headerHeight,bodyHeight=Math.max(0,environment.height-headerSpace-PADDING*2);
                const status=!header?activeStatus(document,Math.max(1,activeWidth-gutter),metrics):null,publicStatus=status?informationStatus(status,choices):null;
                const basis=calculateMeasuredFrameLayout({viewport:environment,region:{width,height:bodyHeight},controls:true,tools:tools??undefined},{mainWidth:activeWidth,statusHeight:hasSidebar?0:publicStatus?.height??0,eventHeight:hasSidebar?publicStatus?.height??0:0,dockHeight:dockMinimum});
                let phaseDock=measuredDock.fragment;
                if(ownPortrait&&ownCards){const placement=calculateDockRegions({viewport:environment,region:{width:activeWidth,height:basis.regions.tray.height},handHeight:ownCards.height,identityHeight:ownPortrait.height}),parts=[{fragment:ownPortrait,x:placement.identity.x,y:placement.identity.y+(placement.identity.height-ownPortrait.height)/2},{fragment:ownCards,x:placement.hand.x,y:placement.hand.y}];if(tools){if(tools.width>placement.tools.width||tools.height>placement.tools.height)throw Error('Original tray tools cannot fit their measured column');parts.push({fragment:tools,x:placement.tools.x+(placement.tools.width-tools.width)/2,y:placement.tools.y+(placement.tools.height-tools.height)/2});}phaseDock=group('dock',activeWidth,basis.regions.tray.height,parts,{decoration:'tray'});}
                const laneWidth=basis.regions.strip.width,contentWidth=Math.max(1,laneWidth-gutter),reserved=measureDecisionDomain(domain,contentWidth,metrics),actual=decisions(gameChoices,contentWidth,metrics,true);
                const minimum=reserved.minimumHeight;
                const proposed=jointDecisionCorridor(basis,{contentHeight:reserved.height,minimumHeight:Math.min(minimum,reserved.height),frameHeight:bodyHeight,protected:[]});
                const {arenaDocument}=playCollections(document),baseWidth=Math.max(1,basis.regions.felt.width-gutter),region=regularParticipantRegion({viewportWidth:environment.width,viewportHeight:environment.height,width:baseWidth,height:basis.regions.felt.height});
                const sizes=[basis.regions.felt.height,...(proposed&&basis.mode!=='short'?[Math.max(0,proposed.y-basis.regions.felt.y)]:[])];
                for(const height of sizes){
                    const board=seatArena(arenaDocument,region.width,height,metrics,choices,true,undefined,basis.mode==='short'?shortLandscapePresentation(environment)?.peerFigure:region.peerFigure);
                    if(board.height>basis.regions.felt.height)continue;
                    const corridor=jointDecisionCorridor(basis,{contentHeight:reserved.height,minimumHeight:Math.min(minimum,reserved.height),frameHeight:bodyHeight,protected:[]});if(!corridor)continue;
                    const local=phaseDock,localY=basis.regions.tray.y+(basis.regions.tray.height-local.height)/2;
                    if(localY<0||localY+local.height>bodyHeight)continue;
                    const placements:{fragment:Fragment;x:number;y:number}[]=[{fragment:board,x:basis.regions.felt.x+region.x,y:basis.regions.felt.y},{fragment:local,x:0,y:localY}];
                    if(publicStatus)placements.push({fragment:publicStatus,x:0,y:0});
                    if(actual.height){const root=actual.nodes[0].id,content={...actual,nodes:actual.nodes.map((node,index)=>index===0?{...node,id:'decision-content'}:node.parent===root?{...node,parent:'decision-content'}:node)};const viewport=scrollColumn('decisions',laneWidth,corridor.height,[content],gutter,'선택과 실행 · 세로 스크롤');placements.push({fragment:group('table-decision-strip',laneWidth,corridor.height,[{fragment:viewport,x:0,y:0}]),x:corridor.x,y:corridor.y});}
                    
                    // Selection and publication use the SAME full paint/hit proof.
                    // Idle evaluates the public corridor without publishing any
                    // future control or hidden reservation node.
                    const proof=group('active-table-content',activeWidth,bodyHeight,[...placements,...(!actual.height?[{fragment:group('table-decision-strip',laneWidth,corridor.height,[]),x:corridor.x,y:corridor.y}]:[])],{jointDecisionLayer:true});
                    const admission=validateJointDecisionLayers(proof.nodes);
                    if(admission.errors.length||!admission.parents.has('active-table-content'))continue;
                    const left=actual.height?proof:group('active-table-content',activeWidth,bodyHeight,placements);
                    const rail=hasSidebar?scrollColumn('table-sidebar',railWidth,bodyHeight,[factsPanel(document,Math.max(1,railWidth-gutter),metrics,false,choices)],gutter,'테이블 정보 · 세로 스크롤'):null;
                    const body=rail?group('table-body',width,bodyHeight,[{fragment:left,x:0,y:0},{fragment:rail,x:activeWidth+GAP,y:0}]):left;
                    const shell=column('table-underlay',environment.width,[...(header?[header]:[]),body],GAP,PADDING);
                    return finishTable(document,environment,choices,metrics,shell,measuredDock.recipe,['dock',...(actual.height?['decisions']:[])],false);
                }
                // A public phase reservation, not the current offer, owns the
                // honest measured fallback below as well.
            }
            if(compact&&!document.outcome){
                const activeWidth=dockWidth,railWidth=width-activeWidth-GAP,gutter=environment.scrollbarWidth??0;
                const controls=controlChoices(gameChoices);
                const hasControls=controls.commands.length>0||!!controls.selected||controls.fields.length>0||!!controls.cards||!!controls.selectionPresentation;
                const guidance=!hasControls&&!gameChoices.nativeCardPresentation?choices.assistance?.projection.guidance:undefined;
                const phaseReservation=choices.decisionPresentation?measureDecisionDomain(choices.decisionPresentation,Math.max(1,activeWidth-gutter),metrics):groupDecisionReservation(choices,Math.max(1,activeWidth-gutter),metrics);
                const decisionBudget=phaseReservation?.height??Math.ceil(footerRow('button')+4+nativeTextControlHeight(typography('select',environment).lineHeight)+12);
                const gamePanel=guidance?column('decisions',Math.max(1,activeWidth-gutter),[textNode('decision-guidance',guidance,'small',Math.max(1,activeWidth-gutter),metrics)],SMALL_GAP):decisions(gameChoices,Math.max(1,activeWidth-gutter),metrics,true,decisionBudget);
                const hasDecision=hasControls||gamePanel.height>0||!!phaseReservation;
                // Selection feedback and its confirmation are one required footprint;
                // neither may be left below a scroll-clipped command row.
                // Reserve that row before selection so choosing a card cannot move
                // the board or hand. Finite decision cohorts retain their envelope.
                const commandRowHeight=gamePanel.nodes.find(node=>node.id==='decision-commands')?.box.height??0;
                const futureSubmitHeight=Math.max(0,...(controls.cards?.submitLabels??[]).map(label=>button('card-selection-future-envelope',label,Math.max(1,activeWidth-gutter),metrics,{}).height));
                const selectionPrimaryHeight=gamePanel.nodes.find(node=>node.id==='decision-primary')?.box.height??0;
                const preferredDecisionHeight=phaseReservation?.height??(gameChoices.nativeCardPresentation?gamePanel.height:!hasControls?gamePanel.height:(choices.cards||choices.selectionPresentation)&&!choices.fields.length?Math.min(decisionBudget,Math.max(TARGET,footerRow('button'),commandRowHeight,futureSubmitHeight,selectionPrimaryHeight)):decisionBudget);
                const contentRoot=gamePanel.nodes[0].id,decisionContent={...gamePanel,nodes:gamePanel.nodes.map((node,index)=>index===0?{...node,id:'decision-content'}:node.parent===contentRoot?{...node,parent:'decision-content'}:node)};
                const tools=hasSidebar?assistanceTools(Math.max(1,railWidth-gutter),metrics,choices):null,opener=hasFacts||choices.assistance?.projection.guidance||observerSignals(document,Math.max(1,activeWidth-gutter),metrics,choices)?button('active-information','테이블 정보',activeWidth-gutter,metrics,{localIntent:'toggle-information',enabled:true,intent:'quiet'}):null;
                const filteredTools=(reaction:boolean)=>choices.assistance?{...choices,assistance:{...choices.assistance,projection:{...choices.assistance.projection,tools:choices.assistance.projection.tools.filter(tool=>(tool.kind==='send-reaction')===reaction)}}}:choices;
                const reactions=assistanceTools(Math.max(1,activeWidth-gutter),metrics,filteredTools(true),true),otherTools=assistanceTools(Math.max(1,activeWidth-gutter),metrics,filteredTools(false),true);
                const quietContent=rows('active-tools-content',Math.max(1,activeWidth-gutter),[...(opener?[opener]:[]),...(reactions?[reactions]:[]),...(otherTools?[namespace(otherTools,'active-other-tools')]:[])],{},'start');
                const toolHeight=Math.max(footerRow('button'),24*Math.max(1,environment.textScale)+28);
                const toolbar=hasSidebar||choices.decisionPresentation&&roomHeader?.nodes.some(node=>node.localIntent==='toggle-information')?null:scrollColumn('table-footer',activeWidth,toolHeight,[quietContent],gutter,'테이블 정보와 반응 · 세로 스크롤');
                const standaloneStatus=!roomHeader?activeStatus(document,Math.max(1,activeWidth-gutter),metrics):null;
                const statusPotential=!roomHeader&&!!(standaloneStatus||document.feedback||document.assistance||choices.feedback||choices.assistance),statusContent=column('active-status-content',Math.max(1,activeWidth-gutter),[...(standaloneStatus?[standaloneStatus]:[])],4);
                const status=statusPotential?scrollColumn('active-status-viewport',activeWidth,Math.max(TARGET,metrics.intrinsic('Ag','small').height*2+SMALL_GAP*2,standaloneStatus?.height??0),[statusContent],gutter,'현재 게임 상태 · 세로 스크롤'):null;
                const commandEnvelopes=phaseReservation?[phaseReservation.minimumHeight]:gamePanel.nodes.filter(node=>node.kind==='command').map(node=>gamePanel.nodes.find(parent=>parent.id===node.parent)?.box.height??node.box.height);
                const futureLabels=controls.selectedLabels??[];
                const futureCommandHeight=futureLabels.length?button('decision-future-envelope',futureLabels[0],Math.max(1,activeWidth-gutter),metrics,{intent:'primary'},futureLabels).height:0;
                const minimumDecisionHeight=hasControls||phaseReservation?Math.max(TARGET,footerRow('button'),...commandEnvelopes,futureSubmitHeight,futureCommandHeight,selectionPrimaryHeight):gamePanel.height;
                // Captured history is secondary to the complete current table.
                // Keep its paint after the primary board, where ordinary scrolling
                // can reveal it without moving any retained seat into a clip.
                const {history,secondary,arenaDocument}=playCollections(document);
                const arenaWidth=Math.max(1,activeWidth-gutter),bodyBudget=Math.max(0,environment.height-headerHeight-PADDING*2);
                const remainingArena=Math.max(0,bodyBudget-measuredDock.fragment.height-(hasDecision?Math.max(minimumDecisionHeight,preferredDecisionHeight):0)-(toolbar?.height??0)-(status?.height??0)-SMALL_GAP*(1+Number(hasDecision)+Number(!!toolbar)+Number(!!status)));
                const region=regularParticipantRegion({viewportWidth:environment.width,viewportHeight:environment.height,width:arenaWidth,height:remainingArena});
                const measuredRing=seatArena(arenaDocument,region.width,region.minimumHeight,metrics,choices,true,undefined,region.peerFigure);
                const ring=region.width<arenaWidth?{...group('regular-arena',arenaWidth,measuredRing.height,[{fragment:measuredRing,x:region.x,y:0}]),requiredVisibleHeight:measuredRing.requiredVisibleHeight}:measuredRing;
                const adjacentArena=(columns:number)=>adjacentPeerArena(arenaDocument,arenaWidth,metrics,choices,columns,region.peerFigure);
                const contained=(fragment:Fragment)=>{const nodes=new Map(fragment.nodes.map(node=>[node.id,node]));return fragment.nodes.every(node=>{const parent=node.parent?nodes.get(node.parent):undefined;return !parent||parent.scroll||node.box.x>=-.001&&node.box.y>=-.001&&node.box.x+node.box.width<=parent.box.width+.001&&node.box.y+node.box.height<=parent.box.height+.001;});};
                const alternatives=[ring,...(people.length>1?[adjacentArena(2),adjacentArena(1)].filter((candidate):candidate is Fragment=>!!candidate).filter(contained):[])];
                const stackFor=(locals:readonly typeof measuredDock[])=>chooseTableStack(locals.flatMap(local=>alternatives.map(arena=>({candidate:{arena,local},requirements:{height:bodyBudget,arena:{minimum:Math.max(TARGET,arena.requiredVisibleHeight??arena.height),preferred:Math.max(bodyBudget,arena.height,arena.requiredVisibleHeight??arena.height)},...(hasDecision?{decision:{minimum:minimumDecisionHeight,preferred:Math.max(minimumDecisionHeight,preferredDecisionHeight)}}:{}),dock:local.fragment.height,status:status?.height??0,tools:toolbar?.height??0,preferredGap:SMALL_GAP,minimumGap:toolbar?SMALL_GAP:0}}))));
                const preferredStack=stackFor([measuredDock]);
                // Resolve preferred metrics before opening a new caption-width
                // domain. An already fitting established layout never measures or
                // adopts the compact side-dock alternative.
                const dockAlternatives=preferredStack.allocation.kind==='overflow'&&measuredDock.recipe!=='side-by-side'&&!metrics.missing.size?[measuredDock,...compactDockCandidates(document,activeWidth,metrics,choices).map(local=>withNativeInstruction(local,gameChoices,metrics)).filter(candidate=>contained(candidate.fragment))]:[measuredDock];
                const compactStack=dockAlternatives.length===1?preferredStack:stackFor(dockAlternatives);
                const selectedStack=compactStack.allocation.kind==='fit'?compactStack:preferredStack;
                const {allocation}=selectedStack,regionGap=allocation.gap,decisionHeight=allocation.decision;
                const decisionViewport=!gamePanel.height?group('decisions',activeWidth,decisionHeight,[],{inert:true,label:''}):decisionHeight>=TARGET?scrollColumn('decisions',activeWidth,decisionHeight,[decisionContent],gutter,'선택과 실행 · 세로 스크롤'):group('decisions',activeWidth,decisionHeight,[{fragment:decisionContent,x:0,y:0}],{semanticRole:'group',label:'현재 선택 안내'});
                const decisionStrip=group('table-decision-strip',activeWidth,decisionHeight,[{fragment:decisionViewport,x:0,y:0}]);
                const board=selectedStack.candidate.arena,chosenDock=selectedStack.candidate.local;
                const trailingHistory=!hasSidebar&&secondary.length?publicCollections({...document,collections:secondary},arenaWidth,metrics,'secondary-collections',false,false,choices):null;
                const overflow=allocation.kind==='overflow';
                const arenaContent=!overflow&&trailingHistory?column('active-arena-content',arenaWidth,[board,trailingHistory],SMALL_GAP):board;
                const available=overflow?Math.max(allocation.arena,board.height):allocation.arena;
                const arena=!overflow&&arenaContent.height>available?scrollColumn('active-arena-viewport',activeWidth,available,[arenaContent],gutter,'공개 테이블과 지난 카드 · 세로 스크롤'):group('active-arena-region',activeWidth,available,[{fragment:arenaContent,x:0,y:0}],{semanticRole:'group',label:'공개 테이블'});
                const left=column('active-table-content',activeWidth,[...(status?[status]:[]),arena,...(hasDecision?[decisionStrip]:[]),chosenDock.fragment,...(toolbar?[toolbar]:[]),...(overflow&&trailingHistory?[trailingHistory]:[])],regionGap);
                const historyPanel=history.length?publicCollections({...document,collections:history},Math.max(1,railWidth-gutter),metrics,'history-collections',false,false,choices):null;
                const secondaryRail=hasSidebar&&secondary.some(zone=>!history.includes(zone))?publicCollections({...document,collections:secondary.filter(zone=>!history.includes(zone))},Math.max(1,railWidth-gutter),metrics,'secondary-collections',false,false,choices):null;
                const railChildren=hasSidebar?[...(hasFacts?[factsPanel(document,Math.max(1,railWidth-gutter),metrics,false,choices,railOwnsStatus?undefined:left.height)]:[]),...(historyPanel?[historyPanel]:[]),...(secondaryRail?[secondaryRail]:[]),...(tools?[namespace(tools,'active-rail-tools')]:[])]:[];
                if(hasSidebar&&!railChildren.length)railChildren.push(group('active-rail-empty',railWidth-gutter,0,[]));
                const rail=hasSidebar?scrollColumn('table-sidebar',railWidth,left.height,railChildren,gutter,'테이블 정보와 조작 · 세로 스크롤'):null;
                const body=rail?group('table-body',width,left.height,[{fragment:left,x:0,y:0},{fragment:rail,x:activeWidth+GAP,y:0}]):left;
                const shell=column('table-underlay',environment.width,[...(roomHeader?[roomHeader]:[]),body],GAP,PADDING);
                return finishTable(document,environment,choices,metrics,shell,chosenDock.recipe,['dock',...(hasDecision?['decisions']:[]),...(gameChoices.nativeCardPresentation?['native-play-instruction']:[])],allocation.kind==='overflow');
            }
            const composeBody=(width:number,outerWidth:number)=>{
                // A sidebar is admitted only alongside an arena with readable seat pairs.
                const sidebar=hasSidebar,outcomeSidebar=sidebar&&!!document.outcome;
                const railGutter=metrics.environment.scrollbarWidth??0;
                const sidebarBasis=outcomeSidebar?outerWidth:width;
                const sidebarWidth=Math.min(Math.max(360,280*environment.textScale),Math.max(280*environment.textScale,sidebarBasis*.24));
                const primaryWidth=outcomeSidebar?outerWidth-sidebarWidth-GAP:outerWidth;
                // Reserve the native gutter once inside the primary viewport;
                // the sibling rail is allocated from the complete outer width.
                const arenaWidth=outcomeSidebar?primaryWidth-railGutter:sidebar?width-sidebarWidth-GAP:width;
                const railWidth=sidebarWidth-railGutter;
                const contentWidth=narrowFooter?width-railGutter:width;
                const facts=(compact||!!document.information?.length||!!document.scoreboard)?factsPanel(document,sidebar?railWidth:contentWidth,metrics,!sidebar,choices):column('facts',width,document.facts.map(fact=>textNode(key('fact',fact.id),`${fact.label}: ${fact.value}`,'body',width,metrics)),SMALL_GAP);
                const panelAside=sidebar||narrowFooter;
                const gameWidth=sidebar?railWidth:narrowFooter?contentWidth-railGutter:arenaWidth;
                const gamePanel=decisions(gameChoices,gameWidth,metrics,compact,narrowFooter?footerHeight:undefined),assistance=assistancePanel(document,gameWidth,metrics,choices,!narrowFooter);
                const panel=assistance?column('decision-and-assistance',sidebar?railWidth:narrowFooter?contentWidth:arenaWidth,[gamePanel,assistance],SMALL_GAP):gamePanel;
                const controls=panel.height&&!panelAside?[panel]:[];
                const headHeight=!sidebar&&!narrowFooter&&hasFacts&&!document.outcome?facts.height+GAP:0;
                const available=environment.height-headerHeight-PADDING*2-GAP-measuredDock.fragment.height-headHeight-(controls.length?panel.height+GAP:0)-(narrowFooter?footerHeight+GAP:0);
                const hasHistory=document.collections?.some(zone=>zone.purpose==='captured');
                const history=sidebar&&!document.outcome?(document.collections??[]).filter(zone=>zone.purpose==='captured'&&zone.cards.length||hasHistory&&zone.purpose==='stock'&&zone.kind!=='deck'):[];
                const arenaDocument=sidebar&&!document.outcome?{...document,collections:(document.collections??[]).filter(zone=>zone.purpose!=='captured'&&!history.includes(zone))}:document;
                const settledRegion=document.outcome&&!document.outcome.overview?regularParticipantRegion({viewportWidth:environment.width,viewportHeight:environment.height,width:arenaWidth,height:Math.max(0,environment.height-headerHeight-PADDING*2-localDock.fragment.height-GAP)}):null;
                const settledBase=document.outcome?settledArena(arenaDocument,settledRegion?.width??arenaWidth,metrics,choices,settledRegion?.peerFigure):null;
                const settled=settledBase&&settledRegion?{...settledBase,fragment:group('regular-settled-arena',arenaWidth,settledBase.fragment.height,[{fragment:settledBase.fragment,x:settledRegion.x,y:0}])}:settledBase;
                const play=settled?.fragment??seatArena(arenaDocument,arenaWidth,Math.max(0,available),metrics,choices,narrowFooter);
                const content=compact?column('table-play',arenaWidth,[play,...controls],GAP):null;
                const arena=[play];
                const flow=document.collections?.some(zone=>zone.purpose);
                const historyPanel=history.length?publicCollections({...document,collections:history},railWidth,metrics,'history-collections'):null;
                // The result and local dock consume only the primary column. An
                // outcome sidebar spans beside that complete left stack, never
                // inside its shorter above-dock scroll viewport.
                const railHeight=outcomeSidebar?Math.max(0,environment.height-headerHeight-PADDING*2):Math.max(160*environment.textScale,available);
                const railChildren=[...(hasFacts?[facts]:[]),...(historyPanel?[historyPanel]:[]),panel];
                const side=sidebar?scrollColumn('table-sidebar',sidebarWidth,railHeight,railChildren,railGutter,'테이블 정보와 조작 · 세로 스크롤'):facts;
                let footer:Fragment|null=null;
                if(narrowFooter){
                    const tools=assistanceTools(gameWidth,metrics,choices),gameContent=column('footer-game-content',gameWidth,[gamePanel,...(tools?[tools]:[])],GAP);
                    const gameSlot=scrollColumn('footer-game',contentWidth,footerHeight,[gameContent],railGutter,'선택과 실행 · 세로 스크롤');
                    const assistancePotential=!!(document.assistance||document.feedback||choices.assistance||choices.feedback);
                    const assistanceHeight=footerRow('button')+metrics.intrinsic('Ag','small').height*2+SMALL_GAP*2;
                    const assistanceContent=assistance??group('assistance',gameWidth,0,[]);
                    const assistanceSlot={...assistanceContent,width:contentWidth,height:assistanceHeight,nodes:[{...assistanceContent.nodes[0],box:{...assistanceContent.nodes[0].box,width:contentWidth,height:assistanceHeight},scroll:true,scrollAxis:'y' as const,scrollbarGutter:railGutter,semanticRole:'group' as const,label:'안내와 반응 · 세로 스크롤'},...assistanceContent.nodes.slice(1)]};
                    // Empty content still supplies one inert measured flow root.
                    if(!assistanceSlot.nodes.slice(1).some(node=>node.parent===assistanceSlot.nodes[0].id)){const empty=group('assistance-empty',gameWidth,0,[]);assistanceSlot.nodes.push({...empty.nodes[0],parent:assistanceSlot.nodes[0].id});}
                    footer=scrollColumn('table-footer',width,footerHeight,[gameSlot,...(assistancePotential?[assistanceSlot]:[]),...(hasFacts?[facts]:[])],railGutter,'테이블 정보와 조작 · 세로 스크롤');
                }
                const body=content&&sidebar&&!outcomeSidebar?group('table-body',width,Math.max(content.height,railHeight),[{fragment:content,x:0,y:0},{fragment:side,x:arenaWidth+GAP,y:0}]):content;
                return {footer,sidebar:outcomeSidebar?{fragment:side,x:primaryWidth+GAP}:null,primaryWidth,priorityHeight:settled?.priorityHeight??0,firstBlockHeight:headHeight+(settled?.firstBlockHeight??0),fragment:compact?column('table-content',outcomeSidebar?arenaWidth:width,[...(!sidebar&&!narrowFooter&&hasFacts&&!document.outcome?[facts]:[]),body!,...(!sidebar&&hasFacts&&document.outcome?[facts]:[])],GAP):column('table-content',width,[...(hasFacts&&!document.outcome?[facts]:[]),...(flow?[...controls,...arena]:[...arena,...controls]),...(hasFacts&&document.outcome?[facts]:[])],GAP)};
            };
            // Result text cannot change peer widths by appearing/disappearing
            // with the native scrollbar. Keep its existing gutter reservation.
            const gutter=environment.scrollbarWidth??0,stableOutcome=!!document.outcome&&!document.outcome.overview,compositionWidth=stableOutcome?width-gutter:width;
            let composition=composeBody(compositionWidth,width),bodyContent=composition.fragment;
            const bodyAndGap=environment.height-headerHeight-PADDING*2-measuredDock.fragment.height-(narrowFooter?footerHeight+GAP:0);
            // The inter-region gap is preferred spacing, not protected content.
            // Spend it before clipping a current terminal collection destination.
            const gapFor=()=>document.outcome?Math.max(0,Math.min(GAP,bodyAndGap-composition.priorityHeight)):GAP;
            let bodyGap=gapFor(),availableHeight=bodyAndGap-bodyGap;
            // Only a sufficiently tall top viewport may retain the local dock.
            // Otherwise the complete table grows and scrolls; no child is shrunk.
            let bounded=compact&&!narrowFooter&&availableHeight>=(document.outcome?composition.firstBlockHeight:160*environment.textScale)&&bodyContent.height>availableHeight;
            if(!Number.isFinite(gutter)||gutter<0||gutter>=width)throw new Error('Invalid native scrollbar metric');
            if(bounded&&width-gutter<(people.length>=3?232:216))return {kind:'cannot-fit',reason:'Native scrollbar leaves insufficient width for readable seat pairs'};
            if(bounded&&gutter&&!stableOutcome){composition=composeBody(width-gutter,width);bodyContent=composition.fragment;bodyGap=gapFor();availableHeight=bodyAndGap-bodyGap;if(document.outcome&&composition.firstBlockHeight>availableHeight){bounded=false;composition=composeBody(width,width);bodyContent=composition.fragment;}}
            const tableBody=bounded?group(document.outcome?'settled-table-viewport':'table-viewport',composition.primaryWidth,availableHeight,[{fragment:bodyContent,x:0,y:0}],{scroll:true,scrollAxis:'y',scrollbarGutter:gutter,semanticRole:'group',label:'테이블 · 세로 스크롤'}):bodyContent;
            const leftStack=composition.sidebar?column('settled-primary-column',composition.primaryWidth,[tableBody,measuredDock.fragment],bodyGap):null;
            const settledColumns=leftStack&&composition.sidebar?group('settled-table-columns',width,Math.max(leftStack.height,composition.sidebar.fragment.height),[{fragment:leftStack,x:0,y:0},{fragment:composition.sidebar.fragment,x:composition.sidebar.x,y:0}]):null;
            const shell = document.outcome?group('table-underlay',environment.width,PADDING*2+headerHeight+(settledColumns?.height??tableBody.height+bodyGap+measuredDock.fragment.height),[...(roomHeader?[{fragment:roomHeader,x:PADDING,y:PADDING}]:[]),...(settledColumns?[{fragment:settledColumns,x:PADDING,y:PADDING+headerHeight}]:[{fragment:tableBody,x:PADDING,y:PADDING+headerHeight},{fragment:measuredDock.fragment,x:PADDING,y:PADDING+headerHeight+tableBody.height+bodyGap}])]):column('table-underlay', environment.width, [...(roomHeader?[roomHeader]:[]),tableBody,measuredDock.fragment,...(composition.footer?[composition.footer]:[])], GAP, PADDING);
            return finishTable(document,environment,choices,metrics,shell,measuredDock.recipe,document.outcome?['settled-dock']:undefined,!!document.outcome&&shell.height>environment.height);
        }
        catch (error) {
            return { kind: 'failed', reason: error instanceof Error ? error.message : 'Layout preparation failed' };
        }
    };
}
export const planTable = createPlanner(numericComposition);

const formStatus=(status:NonNullable<ChoiceView['form']>['status']):string=>({editing:'',accepted:'적용했어요.',stored:'이 기기에 저장했어요.',failed:'완료하지 못했어요.',unsupported:'이 설정은 여기에서 편집할 수 없어요.',conflict:'내용이 바뀌었어요. 양식을 다시 열어 확인해주세요.',queued:'보내는 중이에요.',sending:'보내는 중이에요.',processed:'접수했어요.',rejected:'보내지 못했어요. 내용을 확인해주세요.',uncertain:'처리 결과를 확인할 수 없어요.',cancelled:'보내기를 취소했어요.'})[status];
export interface PendingFormAllocation {
    readonly leaseId:string;
    readonly dialogId:string;
    readonly placements:readonly {readonly id:string;readonly box:Rect;readonly scrollBoth?:boolean}[];
}
/** During asynchronous metrics the previous exact-width content remains intact.
 * Only its engine-owned viewport is clamped, with both axes reachable by scroll. */
export function pendingFormAllocation(frame:PresentationFrame,environment:Environment):PendingFormAllocation|null {
    const dialog=frame.nodes.find(node=>node.id===frame.modalId&&(node.formLeaseId||node.modalLeaseId||node.choiceLeaseId));
    const leaseId=dialog?.formLeaseId??dialog?.modalLeaseId??dialog?.choiceLeaseId;
    if(!dialog||!leaseId||![environment.width,environment.height].every(value=>Number.isFinite(value)&&value>0))return null;
    const viewport=frame.nodes.find(node=>node.parent===dialog.id&&node.scroll);
    if(!viewport)return null;
    const width=Math.min(dialog.box.width,Math.max(1,environment.width-32),environment.width);
    const height=Math.min(dialog.box.height,Math.max(1,environment.height-32),environment.height);
    const paddingX=Math.min(PADDING,Math.max(0,(width-1)/2)),paddingY=Math.min(PADDING,Math.max(0,(height-1)/2));
    return {leaseId,dialogId:dialog.id,placements:[
        {id:dialog.id,box:{x:(environment.width-width)/2,y:(environment.height-height)/2,width,height}},
        {id:viewport.id,box:{x:paddingX,y:paddingY,width:Math.max(1,width-paddingX*2),height:Math.max(1,height-paddingY*2)},scrollBoth:true},
    ]};
}

/** Independent structural acceptance gate; deliberate card overlap is narrowly scoped. */
export function validateLayout(layout: CandidateLayout,environment?:HandGeometryEnvironment&Partial<Environment>): readonly string[] {
    const frameEnvironment=Object.getOwnPropertyDescriptor(layout,'environment');
    const handEnvironment=environment??(frameEnvironment&&'value'in frameEnvironment?frameEnvironment.value:handValidationEnvironments.get(layout));
    const canonicalHandFans=canonicalOwnHandFanSteps(layout,handEnvironment);
    const finiteTargets=canonicalFiniteClusterTargets(layout,handEnvironment);
    const joint=validateJointDecisionLayers(layout.nodes),errors:string[]=[...joint.errors];
    const epsilon = 0.01;
    if (![layout.width, layout.height].every(value => Number.isFinite(value) && value > 0))
        errors.push('Invalid layout size');
    const byId = new Map<string, PlannedNode>();
    for (const node of layout.nodes) {
        if (byId.has(node.id))
            errors.push(`Duplicate node: ${node.id}`);
        byId.set(node.id, node);
        if (![node.box.x, node.box.y, node.box.width, node.box.height].every(Number.isFinite) || node.box.width < 0 || node.box.height < 0)
            errors.push(`Invalid box: ${node.id}`);
        if ((node.kind === 'choice' || node.kind === 'command' || node.kind==='select' || node.kind==='range' || node.kind==='toggle' || node.kind==='editor' || !!node.cardId || !!node.inspectCardId) && (node.box.width < TARGET || node.box.height < TARGET)&&!finiteTargets.has(node.id))
            errors.push(`Undersized target: ${node.id}`);
        if(node.publicDisclosureEventId&&(typeof node.publicDisclosureEventId!=='string'||node.publicDisclosureEventId.length>2048||!node.publicDisclosureEventId||!['group','card'].includes(node.kind)||node.enabled||node.trickSlot!==undefined||node.collectedBy!==undefined||node.identityMetaFor!==undefined||node.participantFeedbackFor!==undefined||node.entityId||node.zoneId||node.ownerId||node.recipientId||node.stockCount!==undefined||node.cardId||node.inspectCardId||node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined||node.actionId||node.fieldId||node.shellActionId||node.shellIntent||node.localIntent||node.assistanceIntent||node.disclosureIntent))errors.push(`Invalid passive public disclosure: ${node.id}`);
        if(node.ownHandAnchor){
            const hand=node.ownHandAnchor;
            const figure=layout.nodes.find(figure=>figure.kind==='figure'&&figure.ownerId===hand.participantId&&figure.parent===node.parent);
            if(node.id!=='own-hand-count-anchor'||node.kind!=='group'||node.label!==''||node.inert!==true||!figure||layout.nodes.some(child=>child.parent===node.id)||JSON.stringify(figure.box)!==JSON.stringify(node.box)||!hand.participantId||!Number.isSafeInteger(hand.count)||hand.count<0||Object.keys(node).some(field=>!['id','parent','kind','label','inert','ownHandAnchor','box'].includes(field)))errors.push(`Invalid internal own-hand anchor: ${node.id}`);
        }
        if(node.decisionGroupId!==undefined&&(!node.decisionGroupId.trim()||!node.actionId&&!node.cardId&&!node.inspectCardId&&!node.fieldId&&!node.catalogueIntent&&!node.cardActionPickerIntent&&!node.cardActionOptionId&&node.localIntent!=='submit-card-set'))errors.push(`Invalid decision group binding: ${node.id}`);
        if(node.kind==='select'){
            const options=node.options;
            if((!node.fieldId&&!node.preference&&!node.formField)||node.preference&&node.fieldId||node.preference&&node.preference.kind!=='select'||node.optionId||node.actionId||node.cardId||node.localIntent||!options?.length||new Set(options.map(option=>option.id)).size!==options.length||options.some(option=>!option.id||!option.label||typeof option.enabled!=='boolean')||node.selectedOptionId!==undefined&&!options.some(option=>option.id===node.selectedOptionId))errors.push(`Invalid native choice binding: ${node.id}`);
        }else if(node.options||node.selectedOptionId!==undefined)errors.push(`Native choice data on non-select: ${node.id}`);
        if(node.preference){
            if(node.actionId||node.cardId||node.fieldId||node.optionId||node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined||node.localIntent||node.shellIntent||node.shellActionId||!['toggle','select','range'].includes(node.kind)||node.kind!==(node.preference.kind==='number'?'range':node.preference.kind))errors.push(`Mixed preference authority: ${node.id}`);
        }else if(node.kind==='range'||node.kind==='toggle'&&!node.formField)errors.push(`Missing preference binding: ${node.id}`);
        if(node.editor){
            if(node.kind!=='editor'||!node.editor.leaseId||!node.editor.fieldId||!['text','multiline','number'].includes(node.editor.kind)||typeof node.editor.value!=='string'||!Number.isSafeInteger(node.editor.maxCodeUnits)||node.editor.maxCodeUnits<1||node.editor.required!==undefined&&typeof node.editor.required!=='boolean'||node.preference||node.actionId||node.cardId||node.fieldId||node.optionId||node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined||node.localIntent||node.shellIntent||node.shellActionId||node.formIntent||node.formField||node.formNavigation)errors.push(`Invalid native editor binding: ${node.id}`);
        }else if(node.kind==='editor')errors.push(`Missing native editor binding: ${node.id}`);
        if(node.formIntent&&(node.kind!=='command'||!node.formLeaseId||node.actionId||node.cardId||node.fieldId||node.optionId||node.preference||node.shellIntent||node.localIntent||node.formField||node.formNavigation||!['submit','reset','close'].includes(node.formIntent)))errors.push(`Mixed form authority: ${node.id}`);
        if(node.formActionId&&(!node.formIntent||node.formIntent!=='submit'))errors.push(`Invalid form action target: ${node.id}`);
        if(node.formField){
            const field=node.formField;
            if(!field.leaseId||!field.fieldId||!['string','boolean'].includes(typeof field.value)||node.actionId||node.cardId||node.fieldId||node.optionId||node.preference||node.shellIntent||node.shellActionId||node.localIntent||node.formIntent||node.formNavigation||!['toggle','select','command'].includes(node.kind)||node.kind==='toggle'&&(field.operation!=='toggle'||typeof field.value!=='boolean')||node.kind==='select'&&(field.operation!=='choose'||typeof field.value!=='string')||node.kind==='command'&&!['increment','decrement','reset'].includes(field.operation??''))errors.push(`Invalid form field binding: ${node.id}`);
        }
        if(node.formNavigation&&(node.kind!=='command'||!node.formNavigation.leaseId||node.actionId||node.cardId||node.fieldId||node.optionId||node.preference||node.shellIntent||node.shellActionId||node.localIntent||node.formIntent||node.formField))errors.push(`Mixed form navigation authority: ${node.id}`);
        if(node.formLeaseId&&!(node.kind==='group'&&node.semanticRole==='dialog'||node.kind==='command'&&node.formIntent))errors.push(`Invalid form lease owner: ${node.id}`);
        if(node.progressPaint&&(node.kind!=='progress'||node.progressPaint.segments.length>33||node.progressPaint.segments.some(segment=>!Number.isFinite(segment.x)||!Number.isFinite(segment.width)||segment.x<0||segment.width<0||segment.x+segment.width>100+epsilon||!['accent','gold','danger','plain','muted'].includes(segment.tone))||node.progressPaint.target!==undefined&&(!Number.isFinite(node.progressPaint.target)||node.progressPaint.target<0||node.progressPaint.target>100)))errors.push(`Invalid progress geometry: ${node.id}`);
        if(node.choiceLeaseId&&(!['choice-catalogue','card-action-dialog'].includes(node.id)||node.id!==layout.modalId||node.choiceLeaseId.length>2048||node.kind!=='group'||node.semanticRole!=='dialog'||!node.choiceLeaseId||node.modalLeaseId||node.formLeaseId))errors.push(`Invalid choice catalogue lease: ${node.id}`);
        if(node.catalogueIntent&&(node.kind!=='command'||!node.catalogueIntent.fieldId||!['open','close'].includes(node.catalogueIntent.kind)||node.actionId||node.cardId||node.fieldId||node.localIntent||node.shellIntent||node.assistanceIntent))errors.push(`Mixed catalogue authority: ${node.id}`);
        if(node.choiceCard&&(node.kind!=='choice'||!node.paintChildren||!node.fieldId||!node.optionId||node.entityId||node.cardId||node.actionId))errors.push(`Invalid choice artwork: ${node.id}`);
        if(node.cardActionPickerIntent!==undefined){
            const request=node.cardActionPickerIntent,forbidden:readonly (keyof PlannedNode)[]=['actionId','cardId','fieldId','optionId','localIntent','catalogueIntent','choiceLeaseId','choiceCard','cardActionOptionId','shellIntent','shellActionId','formIntent','formActionId','formField','formNavigation','formLeaseId','editor','preference','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','assistanceIntent','inspectCardId','feedbackDismissId','publicDisclosureEventId','inspectionPreviewFor','entityId','ownerId','zoneId','recipientId','recipientCount','stockCount','collectionPurpose','recycleAnchor','recycleCaption','ownHandAnchor','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor'];
            if(node.kind!=='command'||!['open','close','confirm'].includes(request.kind)||forbidden.some(key=>node[key]!==undefined)||(request.kind==='open'?request.leaseId!==undefined:typeof request.leaseId!=='string'||!request.leaseId.trim()))errors.push(`Mixed card-action picker authority: ${node.id}`);
            if(request.kind!=='open'&&(layout.modalId!=='card-action-dialog'||!layout.nodes.some(root=>root.id===layout.modalId&&root.choiceLeaseId===request.leaseId)))errors.push(`Card-action picker control escapes lease: ${node.id}`);
        }
        if(node.cardActionOptionId!==undefined){
            const forbidden:readonly (keyof PlannedNode)[]=['cardActionPickerIntent','actionId','cardId','fieldId','optionId','localIntent','catalogueIntent','choiceLeaseId','choiceCard','shellIntent','shellActionId','formIntent','formActionId','formField','formNavigation','formLeaseId','editor','preference','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','assistanceIntent','inspectCardId','feedbackDismissId','publicDisclosureEventId','inspectionPreviewFor','entityId','ownerId','zoneId','recipientId','recipientCount','stockCount','collectionPurpose','recycleAnchor','recycleCaption','ownHandAnchor','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor'];
            if(node.kind!=='choice'||(typeof node.cardActionOptionId!=='string'||!node.cardActionOptionId.trim())||forbidden.some(key=>node[key]!==undefined))errors.push(`Mixed card-action choice authority: ${node.id}`);
        }
        if(node.localIntent&&(!['toggle-scoreboard','toggle-information','submit-card-set'].includes(node.localIntent)||node.kind!=='command'||node.actionId||node.cardId||node.fieldId))errors.push(`Mixed local and server authority: ${node.id}`);
        if(node.shellIcon!==undefined&&(node.kind!=='icon'||!['menu','invite','watch','book','leave','close','result','sliders','flag','smile','hint'].includes(node.shellIcon)))errors.push(`Invalid shared icon: ${node.id}`);
        if(node.hasPopup!==undefined&&(node.hasPopup!=='dialog'||node.kind!=='card'||!node.cardId||node.inspectCardId||node.actionId||node.fieldId||node.localIntent||node.shellIntent||node.shellActionId||node.formIntent||node.formField||node.assistanceIntent))errors.push(`Invalid card popup semantics: ${node.id}`);
        if(node.popupExpanded!==undefined&&(typeof node.popupExpanded!=='boolean'||node.hasPopup!=='dialog'))errors.push(`Invalid card popup state: ${node.id}`);
        if(node.inspectCardId&&(node.kind!=='card'||node.cardId||node.actionId||node.fieldId||node.localIntent||node.assistanceIntent||node.formField||node.shellIntent))errors.push(`Inspection mixed with command authority: ${node.id}`);
        if(node.assistanceIntent&&(node.kind!=='command'||node.cardId||node.actionId||node.fieldId||node.localIntent||node.shellIntent||node.formIntent||node.formNavigation||node.formField))errors.push(`Mixed assistance authority: ${node.id}`);
        if(node.clockTextScale!==undefined&&(!node.clockPaint||!Number.isFinite(node.clockTextScale)||node.clockTextScale<.75||node.clockTextScale>3))errors.push(`Invalid bounded countdown text scale: ${node.id}`);
        if(node.clockPaint&&(node.kind!=='figure'||node.ownerId!==node.clockPaint.participantId))errors.push(`Clock requires its participant figure: ${node.id}`);
        if (node.cardId && node.kind !== 'card') errors.push(`Card binding on non-card: ${node.id}`);
        if (node.arrangement === 'fan' && node.kind !== 'group')
            errors.push(`Only groups can arrange a fan: ${node.id}`);
        if(node.columnSpan!==undefined&&(!Number.isSafeInteger(node.columnSpan)||node.columnSpan<1||node.columnSpan>54||node.kind!=='group'||!['cell','rowheader','columnheader'].includes(node.semanticRole??'')))errors.push(`Invalid table column span: ${node.id}`);
        if (node.semanticRole && node.kind !== 'group' && !(node.kind==='command'&&node.semanticRole==='tab'&&typeof node.checked==='boolean'&&node.controlsId&&node.disclosureIntent?.kind==='section'))
            errors.push(`Semantic group role on non-group: ${node.id}`);
        if(node.disclosureIntent&&(node.kind!=='command'||!node.disclosureIntent.leaseId||node.actionId||node.cardId||node.fieldId||node.optionId||node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined||node.localIntent||node.shellIntent||node.formIntent||node.formField||node.formNavigation||node.preference||node.assistanceIntent||node.inspectCardId||node.disclosureCatalogId))errors.push(`Mixed disclosure authority: ${node.id}`);
        if(node.scrollResetKey!==undefined&&(!node.scroll||node.kind!=='group'||!node.scrollResetKey||node.scrollResetKey.length>2048))errors.push(`Invalid scroll reset identity: ${node.id}`);
        if(node.modalLeaseId&&!(node.kind==='group'&&node.semanticRole==='dialog'&&!node.formLeaseId))errors.push(`Invalid disclosure modal lease: ${node.id}`);
        if(node.controlsId&&!(node.semanticRole==='tab'&&layout.nodes.some(panel=>panel.id===node.controlsId&&panel.semanticRole==='tabpanel')))errors.push(`Invalid tab panel reference: ${node.id}`);
        if(node.disclosureFormActionId&&(node.kind!=='command'||node.actionId||node.cardId||node.fieldId||node.shellIntent||node.formIntent||node.disclosureIntent||node.disclosureCatalogId||node.optionId||node.localIntent||node.formField||node.formNavigation||node.editor||node.preference||node.assistanceIntent||node.inspectCardId||node.feedbackDismissId))errors.push(`Mixed disclosure form authority: ${node.id}`);
        if(node.disclosureCatalogId&&(node.kind!=='command'||node.actionId||node.cardId||node.fieldId||node.localIntent||node.shellIntent||node.formIntent||node.formField||node.assistanceIntent||node.disclosureIntent))errors.push(`Mixed disclosure catalog authority: ${node.id}`);
        if(node.shellIntent&&(node.kind!=='command'||!node.shellActionId||node.actionId||node.cardId||node.fieldId||node.localIntent))errors.push(`Mixed shell authority: ${node.id}`);
        if(node.kind==='command'&&node.localIntent==='toggle-information'&&node.paintChildren){
            if(node.paintChildren!==true||node.arrangement!==undefined&&node.arrangement!=='ordinary'||Object.keys(node).some(field=>!['id','parent','kind','label','box','role','enabled','intent','localIntent','paintChildren','arrangement'].includes(field)&&node[field as keyof PlannedNode]!==undefined))errors.push(`Foreign painted information control field: ${node.id}`);
            const content=layout.nodes.filter(child=>child.parent===node.id);
            if(node.id==='table-information-close'||node.id==='table-scoreboard-close'){
                const icon=content[0];
                if(content.length!==1||icon.id!==key(node.id,'icon')||icon.parent!==node.id||icon.kind!=='icon'||icon.shellIcon!=='close'||icon.label!==''||Object.keys(icon).some(field=>!['id','parent','kind','label','box','shellIcon'].includes(field)&&icon[field as keyof PlannedNode]!==undefined))errors.push(`Invalid information close control: ${node.id}`);
            }else if(node.id==='active-information'){
                if(content.length!==1||content[0].kind!=='group'||!readonlyInformationContent(layout.nodes,content[0].id)||node.box.height<TARGET)errors.push(`Invalid readonly information control: ${node.id}`);
            }else errors.push(`Unknown painted information control: ${node.id}`);
        }
        if(node.paintChildren&&node.kind!=='command'&&!(node.kind==='choice'&&(node.choiceCard||node.fieldId&&node.optionId)))errors.push(`Paint children require command: ${node.id}`);
        if (node.decoration && node.kind !== 'group' && !(node.kind==='command'&&node.decoration==='pill'))
            errors.push(`Group decoration on non-group: ${node.id}`);
    }
    if(layout.nodes.filter(node=>node.ownHandAnchor).length>1)errors.push('Multiple internal own-hand anchors');
    const dialogs=layout.nodes.filter(node=>node.semanticRole==='dialog'||node.semanticRole==='alertdialog');
    if(dialogs.length!==(layout.modalId?1:0)||layout.modalId&&dialogs[0]?.id!==layout.modalId)errors.push('Invalid modal identity');
    const roots = layout.nodes.filter(node => node.parent === null);
    if(layout.modalId&&(roots[0]?.arrangement!=='overlay'||dialogs[0]?.parent!==roots[0]?.id))errors.push('Modal must use root viewport coordinates');
    if (roots.length !== 1)
        errors.push('Layout requires exactly one root');
    if (roots[0] && (roots[0].box.x !== 0 || roots[0].box.y !== 0 || roots[0].box.width !== layout.width || roots[0].box.height !== layout.height))
        errors.push('Root allocation differs from layout');
    for(const node of layout.nodes)if(node.publicDisclosureEventId){
        let owner=node;const visited=new Set<string>();
        while(owner.parent&&owner.parent!==roots[0]?.id&&!visited.has(owner.id)){visited.add(owner.id);const parent=byId.get(owner.parent);if(!parent)break;owner=parent;}
        if(owner.parent!==roots[0]?.id||owner.publicDisclosureEventId!==node.publicDisclosureEventId||owner.kind!=='group'||node.kind==='card'&&node.parent===roots[0]?.id)errors.push(`Unowned passive public disclosure: ${node.id}`);
    }
    for(const layer of layout.nodes.filter(node=>node.parent===roots[0]?.id&&node.publicDisclosureEventId)){
        for(const node of layout.nodes){let parent=node.parent;const visited=new Set<string>();while(parent&&parent!==layer.id&&!visited.has(parent)){visited.add(parent);parent=byId.get(parent)?.parent??null;}
            if(parent!==layer.id)continue;
            if(!['text','group','card'].includes(node.kind)||node.kind==='card'&&node.publicDisclosureEventId!==layer.publicDisclosureEventId||node.enabled||node.trickSlot!==undefined||node.collectedBy!==undefined||node.identityMetaFor!==undefined||node.participantFeedbackFor!==undefined||node.entityId||node.zoneId||node.ownerId||node.recipientId||node.stockCount!==undefined||node.cardId||node.inspectCardId||node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined||node.actionId||node.fieldId||node.shellActionId||node.shellIntent||node.localIntent||node.assistanceIntent||node.disclosureIntent)errors.push(`Authority beneath passive public disclosure: ${node.id}`);
        }
    }
    errors.push(...validateObserverReactionLayers(layout.nodes,roots[0]?.id,layout.modalId));
    errors.push(...validatePrimaryViewport(layout));
    errors.push(...validateReadonlyMatrixViewports(layout.nodes));
    for(const node of layout.nodes.filter(node=>node.recipientId!==undefined&&node.kind==='group'&&node.inert===true)){const figure=layout.nodes.find(figure=>figure.kind==='figure'&&figure.ownerId===node.recipientId&&figure.parent===node.parent);if(node.label!==''||!figure||layout.nodes.some(child=>child.parent===node.id)||JSON.stringify(figure.box)!==JSON.stringify(node.box)||Object.keys(node).some(field=>!['id','parent','kind','label','inert','recipientId','recipientCount','box'].includes(field))||!Number.isSafeInteger(node.recipientCount)||node.recipientCount!<0)errors.push(`Invalid inert participant anchor: ${node.id}`);}
    const metaForbidden:readonly (keyof PlannedNode)[]=['enabled','actionId','cardId','inspectCardId','fieldId','optionId','localIntent','shellIntent','shellActionId','formIntent','formActionId','formField','formNavigation','formLeaseId','editor','preference','assistanceIntent','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','feedbackDismissId','cardActionPickerIntent','cardActionOptionId','catalogueIntent','choiceLeaseId','entityId','ownerId','zoneId','recipientId','recipientCount','ownHandAnchor','stockCount','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor','publicDisclosureEventId'];
    for(const feedback of layout.nodes.filter(node=>node.participantFeedbackFor!==undefined)){
        if(feedback.kind!=='group'||feedback.id!==key('participant-signals',feedback.participantFeedbackFor??'')||!layout.nodes.some(node=>node.kind==='figure'&&node.ownerId===feedback.participantFeedbackFor)||feedback.box.height<28||Object.keys(feedback).some(field=>!['id','parent','kind','label','box','arrangement','scroll','scrollAxis','scrollbarGutter','semanticRole','participantFeedbackFor'].includes(field)))errors.push(`Invalid passive participant feedback: ${feedback.id}`);
        const descendants=new Set([feedback.id]);for(const node of layout.nodes)if(node.parent&&descendants.has(node.parent)){descendants.add(node.id);if(!['group','text','card','suit'].includes(node.kind)||metaForbidden.some(field=>node[field]!==undefined))errors.push(`Authority beneath passive participant feedback: ${node.id}`);}
    }
    for(const meta of layout.nodes.filter(node=>node.identityMetaFor!==undefined)){
        const figure=layout.nodes.find(node=>node.kind==='figure'&&node.ownerId===meta.identityMetaFor&&node.parent===meta.parent);
        if(meta.kind!=='group'||meta.label!==''||meta.id!==key('identity-meta',meta.identityMetaFor??'')||!figure||Object.keys(meta).some(field=>!['id','parent','kind','label','box','arrangement','identityMetaFor'].includes(field)))errors.push(`Invalid participant identity meta: ${meta.id}`);
        const descendants=new Set([meta.id]);for(const node of layout.nodes)if(node.parent&&descendants.has(node.parent)){descendants.add(node.id);if(!['group','text','card','suit'].includes(node.kind)||metaForbidden.some(field=>node[field]!==undefined)||node.identityMetaFor!==undefined)errors.push(`Authority beneath participant identity meta: ${node.id}`);}
    }
    const winnerRoster=new Set(layout.nodes.filter(node=>node.kind==='figure'&&node.ownerId).map(node=>node.ownerId!));
    const collectedRootKeys=new Set(['id','parent','kind','label','box','arrangement','semanticRole','accessibleDescription','scroll','scrollAxis','scrollbarGutter','decoration','tone','collectedBy','zoneId','collectionPurpose']);
    for(const node of layout.nodes)if(node.collectedBy!==undefined&&(Object.keys(node).some(field=>!collectedRootKeys.has(field))||node.kind!=='group'||node.collectionPurpose!=='captured'||typeof node.collectedBy!=='string'||!node.collectedBy.trim()||!winnerRoster.has(node.collectedBy)||!node.zoneId||node.id!==key('collection',node.zoneId)||node.enabled!==undefined||node.visual||node.entityId||node.ownerId||node.recipientId||node.stockCount!==undefined||node.trickSlot!==undefined||node.actionId||node.cardId||node.fieldId||node.shellIntent||node.localIntent||node.disclosureIntent))errors.push(`Invalid captured collection winner: ${node.id}`);
    const slotKeys=new Set(['id','parent','kind','label','box','inert','trickSlot','ownerId','zoneId']),slotOwners=new Map<string,Set<string>>();
    const roster=new Set(layout.nodes.filter(node=>node.kind==='figure'&&node.ownerId).map(node=>node.ownerId!));
    for(const slot of layout.nodes.filter(node=>node.trickSlot!==undefined)){
        const parent=slot.parent?byId.get(slot.parent):undefined,owners=slotOwners.get(slot.zoneId??'')??new Set<string>();
        if(slot.trickSlot!==true||slot.kind!=='group'||slot.inert!==true||slot.label!==''||typeof slot.ownerId!=='string'||!slot.ownerId||!roster.has(slot.ownerId)||typeof slot.zoneId!=='string'||!slot.zoneId||slot.zoneId==='hand'||slot.id!==key('trick-slot',slot.zoneId,slot.ownerId)||parent?.id!==key('trick-stage',slot.zoneId)||parent?.kind!=='group'||parent?.inert!==true||parent?.label!==''||slot.box.width<=0||slot.box.height<=0||Object.keys(slot).some(field=>!slotKeys.has(field))||layout.nodes.some(node=>node.parent===slot.id)||owners.has(slot.ownerId??''))errors.push(`Invalid inert trick slot: ${slot.id}`);
        owners.add(slot.ownerId??'');slotOwners.set(slot.zoneId??'',owners);
    }
    for(const [zone,owners] of slotOwners)if(owners.size>8||owners.size!==roster.size||[...roster].some(owner=>!owners.has(owner)))errors.push(`Incomplete trick slot roster: ${zone}`);
    for(const zone of slotOwners.keys()){const stage=byId.get(key('trick-stage',zone));if(!stage||Object.keys(stage).some(field=>!['id','parent','kind','label','inert','box'].includes(field))||layout.nodes.some(node=>node.parent===stage.id&&node.trickSlot!==true))errors.push(`Invalid inert trick stage: ${zone}`);}
    const children = new Map<string, PlannedNode[]>();
    const preceding = new Set<string>();
    for (const node of layout.nodes) {
        if (node.parent !== null && !preceding.has(node.parent))
            errors.push(`Parent must precede child: ${node.id}`);
        preceding.add(node.id);
        if (node.parent === null)
            continue;
        const parent = byId.get(node.parent);
        {
            let owner=parent;const chain=new Set<string>();
            while(owner&&!chain.has(owner.id)&&!owner.modalLeaseId){chain.add(owner.id);owner=owner.parent?byId.get(owner.parent):undefined;}
            if(owner?.modalLeaseId&&(node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined||node.catalogueIntent||node.choiceLeaseId||node.trickSlot!==undefined||node.collectedBy!==undefined||node.identityMetaFor!==undefined||node.participantFeedbackFor!==undefined||node.entityId||node.ownerId||node.zoneId||node.recipientId||node.ownHandAnchor||node.stockCount!==undefined||node.cardId||node.actionId||node.fieldId||node.localIntent||node.shellIntent||node.formIntent||node.formField||node.formNavigation||node.editor||node.preference||node.assistanceIntent||node.inspectCardId||node.feedbackDismissId||node.disclosureCatalogId||node.formLeaseId))errors.push(`Historical disclosure contains live authority: ${node.id}`);
        }
        if(node.disclosureIntent||node.disclosureFormActionId){
            let owner=parent;const chain=new Set<string>();
            while(owner&&!chain.has(owner.id)&&!owner.modalLeaseId){chain.add(owner.id);owner=owner.parent?byId.get(owner.parent):undefined;}
            if(!owner?.modalLeaseId||node.disclosureIntent&&owner.modalLeaseId!==node.disclosureIntent.leaseId||owner?.id!==layout.modalId)errors.push(`Disclosure control escapes its lease: ${node.id}`);
        }
        if(node.editor||node.formIntent||node.formField||node.formNavigation){
            let owner=parent;const chain=new Set<string>();
            while(owner&&!chain.has(owner.id)&&!(owner.kind==='group'&&owner.formLeaseId)){chain.add(owner.id);owner=owner.parent?byId.get(owner.parent):undefined;}
            const lease=node.editor?.leaseId??node.formLeaseId??node.formField?.leaseId??node.formNavigation?.leaseId;
            if(!owner?.formLeaseId||owner.formLeaseId!==lease||owner.id!==layout.modalId)errors.push(`Native form escapes its lease: ${node.id}`);
        }
        if (!parent || parent.kind !== 'group' && !((parent.kind==='command'||parent.kind==='choice'&&(parent.choiceCard||parent.fieldId&&parent.optionId))&&parent.paintChildren)) {
            errors.push(`Missing group parent: ${node.id}`);
            continue;
        }
        const informationChild=parent.id==='active-information'&&parent.kind==='command'&&parent.localIntent==='toggle-information'&&parent.paintChildren===true&&readonlyInformationContent(layout.nodes,node.id);
        const captionChild=parent.paintChildren===true&&['choice','command'].includes(parent.kind)&&['text','suit'].includes(node.kind)&&Object.keys(node).every(field=>['id','parent','kind','label','box','role','suit'].includes(field)||node[field as keyof PlannedNode]===undefined)&&(!node.role||node.role==='choice'||node.role==='button')&&(node.kind!=='suit'||['Spade','Heart','Diamond','Club'].includes(node.suit??''));
        if(parent.kind==='choice'&&!captionChild&&(!parent.choiceCard||node.kind!=='card'||node.enabled!==undefined||node.trickSlot!==undefined||node.collectedBy!==undefined||node.identityMetaFor!==undefined||node.participantFeedbackFor!==undefined||node.entityId||node.ownerId||node.zoneId||node.cardId||node.fieldId||node.actionId||node.catalogueIntent||node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined))errors.push(`Interactive choice artwork descendant: ${node.id}`);
        if(parent.kind==='command'&&!informationChild&&!captionChild&&(!['text','icon'].includes(node.kind)||node.actionId||node.cardId||node.fieldId||node.shellIntent||node.cardActionPickerIntent!==undefined||node.cardActionOptionId!==undefined))errors.push(`Interactive command descendant: ${node.id}`);
        const list = children.get(parent.id) ?? [];
        list.push(node);
        children.set(parent.id, list);
        const horizontalScrollContent = parent.scroll && node.kind==='group'&&(!parent.scrollAxis&&node.arrangement==='fan'||parent.scrollAxis==='x');
        const verticalScrollContent = parent.scroll && parent.scrollAxis==='y' && node.kind==='group';
        if (node.box.x < -epsilon || node.box.y < -epsilon || (!horizontalScrollContent && node.box.x + node.box.width > parent.box.width + epsilon) || (!verticalScrollContent && node.box.y + node.box.height > parent.box.height + epsilon))
            errors.push(`Child escapes allocation: ${node.id}`);
        const visited = new Set<string>([node.id]);
        let ancestor: PlannedNode | undefined = parent;
        while (ancestor) {
            if (visited.has(ancestor.id)) {
                errors.push(`Parent cycle: ${node.id}`);
                break;
            }
            visited.add(ancestor.id);
            ancestor = ancestor.parent === null ? undefined : byId.get(ancestor.parent);
        }
    }
    for(const parent of layout.nodes.filter(node=>node.scrollAxis==='y')){
        const siblings=children.get(parent.id)??[];
        if(!Number.isFinite(parent.scrollbarGutter??0)||(parent.scrollbarGutter??0)<0||parent.kind!=='group'||!parent.scroll||parent.box.height<(parent.participantFeedbackFor!==undefined?28:TARGET)||siblings.length<1||siblings[0].box.y!==0||siblings.some(node=>node.kind!=='group'||node.box.x!==0||node.box.width!==parent.box.width-(parent.scrollbarGutter??0)))errors.push(`Invalid vertical viewport: ${parent.id}`);
    }
    for (const [parentId, siblings] of children) {
        const parent = byId.get(parentId)!;
        const horizontalContent=parent.kind==='group'&&parent.scrollAxis==='x'&&siblings.length===1&&siblings[0].kind==='group'&&siblings[0].box.x===0&&siblings[0].box.y===0&&siblings[0].box.height<=parent.box.height+epsilon;
        if (parent.scroll && siblings.some(node => node.box.width > parent.box.width + epsilon) && (siblings.length !== 1 || siblings[0].arrangement !== 'fan')&&!parent.readonlyMatrixViewport&&!horizontalContent)
            errors.push(`Invalid scroll content: ${parentId}`);
        if(joint.parents.has(parent.id))continue;
        if(parent.arrangement==='overlay'){
            const modal=layout.modalId?byId.get(layout.modalId):null;
            const publicLayers=siblings.filter(node=>node.publicDisclosureEventId||node.observerReactionLayer);
            if(parent.parent!==null||publicLayers.filter(node=>node.publicDisclosureEventId).length>1||publicLayers.filter(node=>node.observerReactionLayer).length>1||!!modal&&publicLayers.length>0||siblings.length!==(modal?2:1+publicLayers.length)||publicLayers.some(node=>node.parent!==parent.id||node.box.x<0||node.box.y<0||node.box.x+node.box.width>layout.width||node.box.y+node.box.height>layout.height)||siblings.some(node=>node.kind!=='group')||siblings[0]?.inert!==!!modal||modal&&(modal.parent!==parent.id||!['dialog','alertdialog'].includes(modal.semanticRole??'')))errors.push(`Invalid modal layering: ${parentId}`);
            continue;
        }
        if (parent.arrangement === 'fan') {
            if (siblings.some(node => node.kind !== 'card'))
                errors.push(`Fan overlap permits only cards: ${parentId}`);
            const ordered = [...siblings].sort((a, b) => a.box.x - b.box.x);

            const denseCaptured=siblings[0]?.collectionPurpose==='captured'&&siblings[0].box.width===16&&new Set(siblings.map(node=>node.zoneId)).size===1&&siblings.every(node=>node.kind==='card'&&node.collectionPurpose==='captured'&&!!node.entityId&&!!node.zoneId&&node.zoneId!=='hand'&&node.box.width===16&&node.box.height===23&&denseCapturedFace(node.visual)&&DENSE_CAPTURED_BINDINGS.every(key=>node[key]===undefined));
            // Dense public collection faces are fully exposed; they have no
            // activation binding. Ordinary/interactive fan clearances remain.
            const exposure = canonicalHandFans.get(parentId)??(siblings.some(node=>node.cardId) ? TARGET : denseCaptured?16:EXPOSED);
            for (let index = 1; index < ordered.length; index++)
                if (ordered[index].box.x - ordered[index - 1].box.x < exposure - epsilon)
                    errors.push(`Card exposure below ${exposure}px: ${parentId}`);
            continue;
        }
        for (let a = 0; a < siblings.length; a++)
            for (let b = a + 1; b < siblings.length; b++) {
                const invisibleAnchor=(node:PlannedNode)=>node.kind==='group'&&node.inert===true&&node.label===''&&(node.recipientId!==undefined||node.ownHandAnchor!==undefined);
                if(invisibleAnchor(siblings[a])||invisibleAnchor(siblings[b]))continue;
                const metadata=siblings[a].identityMetaFor?siblings[a]:siblings[b].identityMetaFor?siblings[b]:null,portraitArt=metadata===siblings[a]?siblings[b]:siblings[a];
                if(metadata&&portraitArt.kind==='figure'&&portraitArt.ownerId===metadata.identityMetaFor)continue;
                const recipient=siblings[a].recipientId!==undefined||siblings[a].ownHandAnchor?siblings[a]:siblings[b].recipientId!==undefined||siblings[b].ownHandAnchor?siblings[b]:null,figure=recipient===siblings[a]?siblings[b]:siblings[a];
                if(recipient?.kind==='group'&&recipient.inert===true&&recipient.label===''&&figure.kind==='figure'&&figure.ownerId===(recipient.recipientId??recipient.ownHandAnchor?.participantId)&&JSON.stringify(figure.box)===JSON.stringify(recipient.box))continue;
                const landmark=(node:PlannedNode)=>node.trickSlot===true||node.kind==='group'&&node.inert===true&&node.label===''&&[...slotOwners.keys()].some(zone=>node.id===key('trick-stage',zone));
                if(landmark(siblings[a])||landmark(siblings[b]))continue;
                const left = siblings[a].box, right = siblings[b].box;
                if (Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) > epsilon && Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) > epsilon)
                    errors.push(`Ordinary siblings overlap: ${siblings[a].id}, ${siblings[b].id}`);
            }
    }
    return errors;
}
