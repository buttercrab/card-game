import {decisionGroups,finiteDecision,cardDecision,normalizeDecision,emptyDecisionDraft,clearDecisionDraft,reconcileDecisionDraft,resetDecisionGroup,reduceDecisionDraft,deriveDecisionViews,draftCommitment,ROOT_DECISION_GROUP,type DecisionGroup,type DecisionDraftState,type DecisionCommitment,type DecisionEdit} from '../decisionCore';
import {selectedChoiceAction,captionLabel,type DecisionSpec} from '../decisionModel';
import {createCompletionReceiveIssuer} from './completionReceive';
import {publicPaintResources} from './paintResources';
import {completionFrameInputProof,admitPublicCompletion,currentPublicCompletion,issuePublicGameplayRead,retirePublicCompletionGrant,publicCompletionFingerprint,type PublicCompletionView,type PublicCompletionGrant} from './publicCompletion';
import {decisionCommandIds,decisionPresentation,selectionPresentation,groupPresentation,applicableGroupPresentations} from './presentationCohort';
import {nativeCardPresentation,nativeCardSemantics} from './nativeCardPresentation';
import {MEASUREMENT_BATCH_LIMIT} from './measurementLimits';
import {isPresentationOwnership,type PresentationOwnership} from './presentationOwnership';
import {admitRecycle,type RecycleAdmission} from './recycle';
import {essentialInputMask} from './essentialInput';
import type {DisclosureRefresh} from './disclosures';
import {ownConcealment} from './concealment';
import {createDisclosureController} from './disclosureController';
import {captureAssistance,resolveAssistanceIntent,inspectAssistance,sameAssistanceGameScope,type AssistanceOperation,type InspectionPresentation} from './assistance';
import {createFeedbackCoordinator,type FeedbackSink} from './feedback';
import {normalizeFormActions,formEditIdentity,type FormReduction,type FormEdit,type FormValue,validateFormValues,type FormOffer,type FormView,type FormDraftSnapshot,type FormCommitPort} from './forms';
// Bounded metric working set includes complete finite submit-label envelopes.
const MAX_METRICS=2048;
import type {RoomShellAction,RoomShellPageId} from './roomShell';
import {acceptPreferenceValue,roomShellActions,waitingSeatActions,sameRoomSubject} from './roomShell';
import type {RoomOperationSubject} from './roomOperations';
import {sameBackMotionSpace,neutralDealOrigin} from './transferPolicy';
import {validateTableDecision,tableDecisionInput} from './decisions';
import { availableCardIds, cardSelectionAuthority, eligibleCardIds, selectedCardActions, selectedCardAction, selectedCardCommands, toggleCards } from './cardSelection';
import { availableOptions, initializeChoices, reconcileChoices, type ChoiceValues } from '../decisionModel';
import type { HostEffects,ChoiceView, CandidateLayout, Environment, Planner, PresentationFrame, SessionPort, SessionSnapshot, Size, SurfaceIntent, SurfacePort, TableDocument } from './contracts';
import { planTable, validateLayout,presentedFormFields,formSummaryItems,FORM_SUMMARY_PAGE_SIZE } from './planner';
import { sameContext, sameScope } from './session';
const writers = new WeakMap<object, object>();
let nextFrameId = 0,nextEditingLease=0,nextCatalogueLease=0;
/** One presentation writer; host callbacks carry mount and candidate provenance. */
export function createCardTable<A>({ session, planner = planTable,effects,assistance,feedback }: {
    session: SessionPort<A>;
    planner?: Planner;
    effects?: HostEffects;
    assistance?:{invoke(operation:AssistanceOperation):boolean};
    feedback?:FeedbackSink;
}) {
    const owner = {};
    let disposed = false, surface: SurfacePort | null = null, releaseListen: (() => void) | null = null, releaseMeasure: (() => void) | null = null;
    let measurementDeadline: ReturnType<typeof setTimeout> | null = null;
    if(typeof session.admitDecision!=='function')throw Error('Session requires admitDecision');
    let snapshot: SessionSnapshot<A> = session.snapshot(), environment: Environment | null = null, frame: PresentationFrame | null = null;
    let publishingFrame:PresentationFrame|null=null;
    const completionReceive=createCompletionReceiveIssuer();
    let frameOwnership:PresentationOwnership|undefined;
    let concealed:{frameId:number;owner:string;ids:ReadonlySet<string>}|null=null;
    const concealNeedsBegin=new Set<string>();
    let essentialMask:{frameId:number;owner:string;ids:ReadonlySet<string>;scope:string}|null=null;
    let completion:{view:PublicCompletionView;ownership:PresentationOwnership;timer:ReturnType<typeof setTimeout>;acknowledgedFrame:number|null;fenced:boolean}|null=null;
    let consumedCompletion:string|null=null,completionOutcome:'completed'|'unfulfilled'|null=null;
    function retireCompletion(outcome:'completed'|'unfulfilled'='unfulfilled'){
        const previous=completion;if(!previous)return;completion=null;clearTimeout(previous.timer);retirePublicCompletionGrant(previous.view.event);completionOutcome=outcome;gesture=null;cancelled=true;
    }
    function completionAuthorityCurrent():boolean{const ownership=completion?.ownership;return !!ownership&&snapshot.presentationOwnership===ownership&&isPresentationOwnership(ownership,session)&&session.snapshot().presentationOwnership===ownership;}
    let motionContinuity=0;
    let pendingRecycle:{proof:RecycleAdmission;targets:readonly string[];environment:Environment;recovery:boolean}|null=null;
    const contextScope=(context:PresentationFrame['context'])=>JSON.stringify([context.session,context.audience,context.generation]);
    const roster=(doc:TableDocument<A>)=>[...(doc.participant.role==='observer'?[]:[doc.participant.id]),...(doc.opponents??[]).map(person=>person.id)];
    function recycleCurrent(doc:TableDocument<A>):boolean{
        const pending=pendingRecycle;if(!pending||pending.proof.continuity!==motionContinuity||!sameScope(pending.proof.toContext,doc.context)||JSON.stringify(roster(doc))!==JSON.stringify(pending.proof.rosterIds)||JSON.stringify(doc.hand.map(card=>card.id))!==JSON.stringify(pending.targets)||doc.deals?.[0]?.id!==pending.proof.deal.id)return false;
        if(JSON.stringify((doc.collections??[]).map(collection=>({id:collection.id,purpose:collection.purpose??null,kind:collection.kind??null,availability:collection.availability??'current',hiddenCount:collection.hiddenCount??null})))!==JSON.stringify(pending.proof.collections)||(doc.collections??[]).some(collection=>collection.cards.length>0)||doc.deals?.length!==1||doc.stockReturn||doc.reveals?.length||doc.outcome)return false;
        const source=doc.collections?.find(zone=>zone.id===pending.proof.source);return source?.hiddenCount===pending.proof.newStock&&(doc.opponents??[]).every(person=>pending.proof.newRecipients.some(peer=>peer.participantId===person.id&&peer.count===person.handCount));
    }

    let mount = 0, generation = 0, attempts = 0, status = 'detached', busy = false, rerun = false;
    let gesture: {
        frame: number;
        node: string;
    } | null = null, cancelled = false;
    let decisionDraft:DecisionDraftState=emptyDecisionDraft();
    function finiteValues(doc=snapshot.document):ChoiceValues|null{const group=doc&&finiteDecision(doc.decision),draft=group&&decisionDraft.groups[group.id];return draft?.kind==='finite-choice'?draft.values:null;}
    function cardIds(doc=snapshot.document):readonly string[]{const group=doc&&cardDecision(doc.decision),draft=group&&decisionDraft.groups[group.id];return draft?.kind==='card-selection'?draft.cardIds:[];}
    function cardActionId(doc=snapshot.document):string|null{const group=doc&&cardDecision(doc.decision),draft=group&&decisionDraft.groups[group.id];return draft?.kind==='card-selection'?draft.actionId:null;}
    function editDecision(doc:TableDocument<A>,edit:DecisionEdit):boolean{if(session.snapshot().document!==doc)return false;const next=reduceDecisionDraft(tableDecisionInput(doc),decisionDraft,edit);if(!next)return false;decisionDraft=next;return true;}
    function commitDecision(doc:TableDocument<A>,groupId:string|null,commitment:DecisionCommitment<A>):boolean{
        if(!session.admitDecision||session.snapshot().document!==doc||!frame)return false;
        const capture={document:doc,frameId:frame.id,mount,generation,revision:decisionDraft.revision,decisionId:doc.decision.id,groupId,commitment,used:false};
        if(capture.used||snapshot.document!==capture.document||session.snapshot().document!==capture.document||frame?.id!==capture.frameId||mount!==capture.mount||generation!==capture.generation||decisionDraft.revision!==capture.revision)return false;
        capture.used=true;return session.admitDecision(doc,{decisionId:capture.decisionId,groupId:capture.groupId,commitment:capture.commitment});
    }
    function commitCommand(doc:TableDocument<A>,id:string,action:A,groupId?:string):boolean{const input=tableDecisionInput(doc),owner=normalizeDecision(input).value?.bindings[id];if(owner===undefined||groupId!==undefined&&owner!==groupId)return false;if(owner!==ROOT_DECISION_GROUP){const ready=draftCommitment(input,decisionDraft,owner);if(ready?.kind!=='command'||ready.actionId!==id||ready.action!==action)return false;}return commitDecision(doc,owner,{kind:'command',actionId:id,action});}
    let cardActionPicker:{leaseId:string;draftActionId:string|null;opener:string;authority:string;cards:string;revision:number;document:TableDocument<A>}|null=null;
    let nextCardActionLease=0;
    let catalogue:{leaseId:string;fieldId:string;draft:ChoiceValues;opener:string;authority:string;revision:number;document:TableDocument<A>}|null=null;
    let scoreboardExpanded = false,informationOpen=false;
    let scoreboardOpen=false,scoreboardReturnToInformation=false,scoreboardOpener:string|null=null;
    let informationOpener:string|null=null;
    let adviceOpen=false,reactionsOpen=false,inspection:InspectionPresentation|undefined,lastAdviceId:string|undefined;
    let receivingFeedback=false,refusalSerial=0;
    let pendingRefusal:{nodeId:string;cardId:string;reason:string}|null=null;
    const feedbackController=feedback?createFeedbackCoordinator({sink:feedback,onChange(){if(!receivingFeedback&&!disposed&&surface&&snapshot.document){invalidate();schedule();}},onClock(id,fraction,seconds){surface?.updateClock?.(id,fraction,seconds);}}):null;
    let shellPage:RoomShellPageId|undefined,shellConfirmation=false,confirmationOpener:string|null=null;
    let shellSubject:RoomOperationSubject|undefined,commandConfirmation:{action:RoomShellAction;fingerprint:string}|null=null;
    let leaveConfirmationFingerprint:string|null=null;
    let shellHistory:{page:RoomShellPageId|undefined;subject?:RoomOperationSubject;focus:string|null}[]=[];
    let pendingDisclosureRefresh:{directive:DisclosureRefresh;scope:string;operationId:string}|null=null;
    let formSerial=0;let formFocusField:string|null=null;
    let activeForm:{offer:FormOffer<A>;leaseId:string;scope:string;draft:FormDraftSnapshot;port:FormCommitPort;conflict:boolean;overflowFields:Set<string>;composingFieldId?:string;reduction?:FormReduction;activeSection?:string;summaryPage:number;fieldLeases:Record<string,string>}|null=null;
    const disclosure=createDisclosureController({readCurrent(){const current=session.snapshot();return session.disclosures?{offers:current.document?.disclosures??[],port:session.disclosures}:null;}});
    function disclosureView(){const view=disclosure.snapshot(),doc=snapshot.document;if(!view)return;const receipt=view.selection;return Object.freeze({...view,...(receipt?{formActions:Object.freeze((doc?.disclosureFormActions??[]).filter(action=>action.selectionId===receipt.id&&action.catalogId===receipt.catalogId&&action.catalogRevision===receipt.revision&&action.entryId===receipt.entryId&&doc?.forms?.some(form=>form.id===action.formId&&form.instanceId===action.formInstanceId&&form.enabled)))}:{})});}
    function modalLease(){return activeForm?.leaseId??disclosureView()?.leaseId??cardActionPicker?.leaseId??catalogue?.leaseId;}
    function closeDisclosure(){disclosure.close();surface?.preserveModal?.(null);}
    function openDisclosure(catalogId:string){
        const doc=snapshot.document;if(!doc||session.snapshot().document!==doc||!doc.disclosures?.some(offer=>offer.id===catalogId))return false;
        discardForm();adviceOpen=false;reactionsOpen=false;inspection=undefined;
        const opened=disclosure.open(catalogId);if(!opened)return false;
        informationOpen=false;informationOpener=null;scoreboardOpen=false;scoreboardReturnToInformation=false;scoreboardOpener=null;shellPage=undefined;shellSubject=undefined;shellConfirmation=false;commandConfirmation=null;leaveConfirmationFingerprint=null;shellHistory=[];confirmationOpener=null;
        metrics.clear();attempts=0;surface?.preserveModal?.(disclosureView()?.leaseId??null);focusId=null;invalidate();schedule();return true;
    }
    const actorScope=(context:TableDocument<A>['context'])=>JSON.stringify([context.session,context.audience]);
    function discardForm(){activeForm?.port.dispose();activeForm=null;formFocusField=null;surface?.preserveEditing?.(null);}
    function formView():FormView|undefined{
        if(!activeForm)return;const form=activeForm,ops=snapshot.formOperations?.filter(op=>op.instanceId===form.port.instanceId||form.offer.retry==='new-offer'&&op.formId===form.offer.id&&op.offerInstanceId===form.offer.instanceId)??[];
        const declared=normalizeFormActions(form.offer),op=ops.filter(op=>op.actionId===declared[0]?.id||!op.actionId).at(-1);
        const issues={...(form.reduction?.issues??validateFormValues(form.offer,form.draft.values)),...Object.fromEntries([...form.overflowFields].map(id=>[id,'입력할 수 있는 길이를 넘었어요.']))};
        const actionViews=declared.map(action=>{const latest=ops.filter(op=>op.actionId===action.id||!op.actionId&&action.id===declared[0]?.id).at(-1),status=latest?.status;
            const blocking=form.offer.retry==='new-offer'&&latest?.attempted===true||!!status&&(['queued','sending','uncertain'].includes(status)||['accepted','processed','stored'].includes(status)&&(action.completion==='lock'||latest?.draftRevision===form.draft.revision));
            return Object.freeze({id:action.id,label:action.label,intent:action.intent,completion:action.completion,...(status?{status}:{}),...(latest?.message?{message:latest.message}:{}),enabled:!(form.conflict&&action.basis==='current')&&!form.draft.composing&&form.offer.enabled&&(snapshot.connected||!!form.offer.access&&disclosureView()?.selection?.id===form.offer.access.selectionId)&&Object.keys(issues).length===0&&!blocking&&(action.target.kind!=='command'||!!snapshot.document&&canExecuteShellCommand(snapshot.document))});});
        const primary=actionViews[0];const state=form.conflict?'conflict':op?.status??'editing';
        return Object.freeze({offer:form.offer,leaseId:form.leaseId,sourceInstanceId:form.port.instanceId,values:form.draft.values,issues,status:state,draftRevision:form.draft.revision,compositionEpoch:form.draft.compositionEpoch,composingFieldId:form.composingFieldId,canSubmit:primary?.enabled??false,actions:actionViews,activeSection:form.activeSection,summaryPage:form.summaryPage,reduction:form.reduction,fieldLeases:Object.freeze({...form.fieldLeases})});
    }
    function refreshFieldLeases(){const form=activeForm,view=formView();if(!form||!view)return;const visible=new Set(presentedFormFields(view).filter(field=>form.reduction?.enabled[field.id]!==false).map(field=>field.id));for(const id of Object.keys(form.fieldLeases))if(!visible.has(id))delete form.fieldLeases[id];for(const id of visible)if(!form.fieldLeases[id])form.fieldLeases[id]=`field-lease-${++nextEditingLease}`;surface?.preserveEditing?.(form.leaseId,form.fieldLeases);}
    function beginForm(offer:FormOffer<A>){
        if(!session.bindForm)return;if(!offer.access)closeDisclosure();discardForm();const draft:FormDraftSnapshot=Object.freeze({values:Object.freeze(Object.fromEntries(offer.fields.map(field=>[field.id,field.initial]))),revision:0,compositionEpoch:0,composing:false});
        const port=session.bindForm(offer.instanceId,()=>activeForm?.port===port&&!activeForm.overflowFields.size?activeForm.draft:null);
        activeForm={offer,port,leaseId:`editor-lease-${++nextEditingLease}`,scope:actorScope(snapshot.document!.context),draft,conflict:false,overflowFields:new Set(),activeSection:offer.sections?.[0]?.id,summaryPage:0,fieldLeases:{}};
        activeForm.reduction=port.reduce({kind:'initialize'})??undefined;
        if(activeForm.reduction)activeForm.draft=Object.freeze({...draft,values:activeForm.reduction.values});refreshFieldLeases();
        formSerial++;focusId=null;shellConfirmation=false;commandConfirmation=null;invalidate();schedule();
    }
    function applyFormEdit(edit:FormEdit):boolean{
        const form=activeForm;if(!form||form.draft.composing)return false;const reduction=form.port.reduce(edit);if(!reduction)return false;
        if(edit.kind==='reset-field'){delete form.fieldLeases[edit.fieldId];for(const id of Object.keys(reduction.values))if(reduction.values[id]!==form.draft.values[id])delete form.fieldLeases[id];}form.reduction=reduction;form.draft=Object.freeze({...form.draft,values:reduction.values,revision:form.draft.revision+1});refreshFieldLeases();invalidate();schedule();return true;
    }
    function formAction(action:'submit'|'reset'|'close',actionId?:string){
        const form=activeForm,doc=snapshot.document;if(!form||!doc||session.snapshot().document!==doc||form.draft.composing)return;
        if(action==='close'){pendingDisclosureRefresh=null;discardForm();focusId=null;effects?.formClosed?.(doc.context);invalidate();schedule();return;}
        const state=formView();if(action==='submit'){if(state?.actions?.find(candidate=>candidate.id===(actionId??state.actions?.[0]?.id))?.enabled)form.port.commit(doc.context,form.offer.id,actionId);return;}
        if(state&&!['queued','sending','uncertain'].includes(state.status)){beginForm(doc.forms?.find(offer=>offer.id===form.offer.id&&offer.instanceId===form.offer.instanceId)??form.offer);}
    }
    function formField(node:PresentationFrame['nodes'][number],value?:FormValue){const form=activeForm,binding=node.formField;if(!form||!binding||binding.leaseId!==form.leaseId||binding.fieldLeaseId!==form.fieldLeases[binding.fieldId]||!node.enabled||form.draft.composing)return;
        const field=form.offer.fields.find(field=>field.id===binding.fieldId);if(!field||form.reduction?.visibility[field.id]===false||form.reduction?.enabled[field.id]===false)return;
        if(binding.operation==='reset'){applyFormEdit({kind:'reset-field',fieldId:field.id});return;}
        let next=value??binding.value;if(binding.operation==='toggle')next=!binding.value;
        if(binding.operation==='increment'||binding.operation==='decrement'){if(field.kind!=='number'||typeof binding.value!=='string'||!Number.isFinite(Number(binding.value)))return;next=String(Number(binding.value)+(binding.operation==='increment'?1:-1)*(field.step??1));}
        if(field.kind==='select'&&!field.options.some(option=>option.id===next&&option.enabled))return;
        applyFormEdit({fieldId:field.id,value:next});
    }
    let focusId: string | null = null, lastFrameId: number | null = null;
    const metrics = new Map<string, Size>();
    const releaseRequest = () => { const fn = releaseMeasure; releaseMeasure = null; fn?.(); };
    const release = (kind: 'measure' | 'listen') => { if (kind === 'measure' && measurementDeadline !== null) {
        clearTimeout(measurementDeadline);
        measurementDeadline = null;
    } const fn = kind === 'measure' ? releaseMeasure : releaseListen; if (kind === 'measure')
        releaseMeasure = null;
    else
        releaseListen = null; fn?.(); };
    const disarm = () => { surface?.preserveModal?.(disclosureView()?.leaseId??cardActionPicker?.leaseId??catalogue?.leaseId??null);surface?.preserveEditing?.(activeForm?.leaseId??null,activeForm?.fieldLeases); if (gesture)
        cancelled = true; gesture = null; surface?.disarm(); };
    const invalidate = () => { generation++; disarm(); release('measure'); };
    const fail = (reason: string) => { retireCompletion();essentialMask=null;pendingRecycle=null;motionContinuity++;concealed=null;concealNeedsBegin.clear();surface?.preserveEditing?.(null);generation++; release('measure'); frame = null;frameOwnership=undefined; status = 'failed'; surface?.disarm(); surface?.fallback(reason); };
    function nativeCardInputKind(doc:TableDocument<A>,layout:CandidateLayout):'native-cards'|undefined {
        if(!snapshot.connected||snapshot.admissionBlocked||doc.outcome||doc.participant.role==='observer'||layout.decisionLaneId!==undefined||layout.outcomeLaneId!==undefined||layout.modalId!==undefined||!cardDecision(doc.decision)||cardDecision(doc.decision)!.mode!=='one'||!doc.interaction?.cardActivation)return undefined;
        const view=choiceView(doc),selection=view.cards;
        if(!selection||!view.nativeCardPresentation||view.commands.length||view.fields.length)return undefined;
        const hand=layout.nodes.filter(node=>node.kind==='card'&&node.zoneId==='hand'&&node.entityId!==undefined);
        if(!hand.length||hand.length!==doc.hand.length||new Set(hand.map(node=>node.entityId)).size!==hand.length)return undefined;
        for(const card of doc.hand){
            const node=hand.find(node=>node.entityId===card.id);if(!node||node.ownerId!==undefined&&node.ownerId!==doc.participant.id)return undefined;
            const inspection=!!view.assistance?.projection.inspections.some(item=>item.cardId===card.id)&&!(selection.eligible??selection.available).includes(card.id);
            if(inspection?(node.inspectCardId!==card.id||node.cardId!==undefined||node.enabled!==true):(node.cardId!==card.id||node.inspectCardId!==undefined||node.enabled!==selection.available.includes(card.id)))return undefined;
        }
        return hand.some(node=>node.enabled===true)?'native-cards':undefined;
    }
    function choiceView(doc:TableDocument<A>):ChoiceView{
        const finite=finiteDecision(doc.decision),cards=cardDecision(doc.decision),previewGroups={...decisionDraft.groups};
        if(catalogue&&finite)previewGroups[finite.id]={kind:'finite-choice',values:catalogue.draft};
        if(cardActionPicker&&cards){const stored=previewGroups[cards.id];if(stored?.kind==='card-selection')previewGroups[cards.id]={...stored,actionId:cardActionPicker.draftActionId};}
        const semantic=deriveDecisionViews(tableDecisionInput(doc),{revision:decisionDraft.revision,groups:previewGroups});
        const decisionReservations=applicableGroupPresentations(doc),passiveCard=decisionReservations.find(group=>group.kind==='card-selection');
        const reservations={...(decisionReservations.length?{decisionReservations}:{}),...(!cards&&passiveCard?{selectionPresentation:selectionPresentation(doc.context,doc.presentation!,passiveCard.id)}:{})};
        if(doc.decision.kind!=='composition')return Object.freeze({...groupChoiceView(doc,doc.decision,semantic.find(group=>group.id===doc.decision.id)),...reservations});
        const groups=decisionGroups(doc.decision).map(spec=>Object.freeze({...groupChoiceView(doc,spec,semantic.find(group=>group.id===spec.id)),decisionGroupId:spec.id,groupKind:spec.kind}));
        const finiteView=groups.find(group=>group.groupKind==='finite-choice'),cardView=groups.find(group=>group.groupKind==='card-selection'),base=groups[0]??groupChoiceView(doc,{id:doc.decision.id,kind:'commands',commands:doc.decision.commands},undefined);
        return Object.freeze({...base,...reservations,groups:Object.freeze(groups),values:finiteView?.values??null,fields:finiteView?.fields??[],finitePresentation:finiteView?.finitePresentation,decisionPresentation:finiteView?.decisionPresentation,captionPresentation:finiteView?.captionPresentation,cards:cardView?.cards,selectionPresentation:cardView?.selectionPresentation??base.selectionPresentation,nativeCardPresentation:cardView?.nativeCardPresentation??base.nativeCardPresentation,selected:finiteView?.selected??cardView?.selected??null,commands:base?.commands??[]});
    }
    function groupChoiceView(doc: TableDocument<A>,spec:DecisionSpec|import('../cardSelection').CardSelectionDecision,semantic:ReturnType<typeof deriveDecisionViews<A>>[number]|undefined): ChoiceView {
        const choiceValues=semantic?.kind==='finite-choice'?semantic.values:null;
        const actionDraft=cardActionPicker?cardActionPicker.draftActionId:cardActionId();
        const shellExecutable=canExecuteShellCommand(doc);
        const disclosureState=activeForm?undefined:disclosureView();
        const executable = !completion&&!informationOpen&&!disclosureState&&!shellPage&&!shellConfirmation&&shellExecutable&&!(doc.participant.role==='observer'&&spec.kind!=='commands');

        const actions = new Map(doc.offer.actions.map(action=>[action.id,action]));
        const command = (id: string) => {const action=actions.get(id);return action?.kind==='command'?action:undefined;};
        const view = (id: string) => { const action = command(id); return action ? Object.freeze({ id: action.id, label: action.label, intent: action.intent, enabled: action.enabled && executable }) : null; };
        const currentSelection=semantic?.selected;
        let selected:ChoiceView['selected']=currentSelection?view(currentSelection.id):null;
        if(spec.kind==='card-selection'&&spec.mode==='count')selected={id:'card-set-submit',label:spec.submit.prefix,intent:'primary',enabled:executable&&semantic?.kind==='card-selection'&&semantic.countReady&&!!session.admitDecision};
        else if (spec.kind === 'card-selection') selected = selected ? {...selected,label:`${spec.submit.prefix} ${selected.label}`} : {id:'pending-card-selection',label:spec.submit.prefix,intent:'primary',enabled:false};
        if(spec.kind==='finite-choice'&&spec.policy==='staged'&&selected){const caption=spec.variants.find(row=>row.actionId===selected!.id)?.caption;if(caption)selected={...selected,label:captionLabel(caption),caption};}
        if (selected && spec.kind === 'finite-choice' && spec.submit.presentationLabel)
            selected = { ...selected, label: `${spec.submit.presentationLabel.prefix} ${selected.label}` };
        const publicGroup=groupPresentation(doc.presentation,spec.id);
        return Object.freeze({...(spec.kind==='finite-choice'&&spec.policy==='staged'?{staged:true}:{}),...(publicGroup?.kind==='finite-choice'?{captionPresentation:publicGroup}:{}),...(spec.kind==='finite-choice'&&spec.presentation?{finitePresentation:spec.presentation}:{}),...(completion?{publicCompletion:completion.view}:{}),...(doc.presentation?.decision&&doc.participant.role!=='observer'?{decisionPresentation:decisionPresentation(doc.context,doc.presentation)}:{}),nativeCardPresentation:spec.kind==='card-selection'||spec.kind==='commands'?nativeCardPresentation(doc,executable,cardIds()):undefined,...(cardActionPicker?{cardActionPicker:{leaseId:cardActionPicker.leaseId}}:{}),...(doc.presentation&&(doc.presentation.selection||publicGroup?.kind==='card-selection')&&doc.participant.role!=='observer'&&(spec.kind==='card-selection'||spec.kind==='commands')?{selectionPresentation:selectionPresentation(doc.context,doc.presentation,spec.id)}:{}),...(catalogue?{catalogue:{fieldId:catalogue.fieldId,leaseId:catalogue.leaseId}}:{}),...(disclosureState?{disclosure:disclosureState}:{}),...(doc.outcome?{outcomeCommands:(completion?[]:doc.outcome.continuationActionIds).flatMap(id=>{const item=view(id);return item?[item]:[];})}:{}),...(snapshot.connected&&doc.assistance?{assistance:{projection:doc.assistance.projection,adviceOpen,reactionsOpen,...(inspection?{inspection}:{})}}:{}),...(feedbackController?{feedback:feedbackController.view()}:{}), ...(recycleCurrent(doc)?{recyclePresentation:{source:pendingRecycle!.proof.source,totalCount:pendingRecycle!.proof.totalCount}}:{}),form:formView(), shellPage,shellSubject,shellConfirmation,shellCommandConfirmation:currentCommandConfirmation(doc),shellCommandEnabled:shellExecutable,effectsAvailable:!!effects,preferencesAvailable:!!effects?.changePreference,shellLeaveEnabled:snapshot.connected&&!snapshot.admissionBlocked&&!snapshot.operations.some(op=>op.offerId===doc.offer.id&&['queued','uncertain','accepted','unavailable'].includes(op.status))&&!!(doc.shell?.leaveActionId&&command(doc.shell.leaveActionId)?.enabled),scoreboardExpanded,scoreboardOpen,scoreboardReturnToInformation,informationOpen, ...(spec.kind==='finite-choice'&&spec.policy!=='staged'&&!doc.presentation?.decision?{selectedLabels:Object.freeze([...new Set(spec.variants.map(variant=>`${spec.submit.presentationLabel?spec.submit.presentationLabel.prefix+' ':''}${command(variant.actionId)!.label}`))])}:{}), ...(spec.kind === 'card-selection' ? {cards:{...(spec.disambiguation==='choose-action'?{actionVariants:(semantic?.kind==='card-selection'?semantic.actionVariants:[]).map(action=>({id:action.id,label:action.label,enabled:action.enabled&&executable})),...(actionDraft?{selectedActionId:actionDraft}:{})}:{}),statusLabels:Array.from({length:(spec.mode==='count'?spec.count:Math.max(1,...spec.variants.map(row=>row.cardIds.length)))+1},(_,count)=>spec.mode==='count'?`${spec.submit.prompt??'카드 선택'} · ${count}/${spec.count}`:`카드 선택 · ${count}장`),batch:spec.mode==='count',eligible:semantic?.kind==='card-selection'?semantic.eligible:[],selected:cardIds(),available:executable&&semantic?.kind==='card-selection'?semantic.available:[],label:spec.mode==='count'?`${spec.submit.prompt??'카드 선택'} · ${cardIds().length}/${spec.count}`:`카드 선택 · ${cardIds().length}장`,submitLabels:spec.mode==='count'?[spec.submit.prefix]:[...new Set(spec.variants.map(variant=>`${spec.submit.prefix} ${command(variant.actionId)!.label}`))]}} : {}), values:choiceValues, fields: spec.kind === 'finite-choice' ? (semantic?.kind==='finite-choice'?semantic.fields:[]).map(field => ({ id: field.id, label: field.label,...(field.catalogue?{catalogue:field.catalogue}:{}), options: field.options.map(option => ({ id: option.id, label: option.label,...(option.visual?{visual:option.visual}:{}),...(option.emphasis?{emphasis:option.emphasis}:{}),...(option.description?{description:option.description}:{}),...(option.caption?{caption:option.caption}:{}), enabled: option.available && executable })) })) : [], commands: decisionCommandIds(doc).filter(()=>!completion).flatMap(id => { const item = view(id); return item ? [item] : []; }), selected:completion?null:selected });
    }
    function schedule() {
        if (busy) {
            rerun = true;
            return;
        }
        busy = true;
        try {
            let passes = 0;
            do {
                rerun = false;
                solve();
                if (++passes >= 16 && rerun) {
                    rerun = false;
                    fail('Reentrant update limit exceeded');
                    break;
                }
            } while (rerun && !disposed && surface);
        }
        finally {
            busy = false;
        }
    }
    function solve() {
        const target = surface, doc = snapshot.document, env = environment, token = generation, mounted = mount,publicationOwnership=snapshot.presentationOwnership;
        if (!target || disposed)
            return;
        if(completion&&(!completionAuthorityCurrent()||!doc||!env||activeForm||disclosureView()||shellPage||shellConfirmation||informationOpen||!currentPublicCompletion(completion.view,doc,publicPaintResources(doc),env,performance.now())))retireCompletion();
        if (!doc || !env) {
            frame = null;frameOwnership=undefined;
            status = 'empty';
            target.clear(modalLease());
            return;
        }
        const current = () => !disposed && surface === target && mount === mounted && generation === token && snapshot.document === doc && session.snapshot().document === doc && environment === env && (publicationOwnership===undefined||isPresentationOwnership(publicationOwnership,session)&&snapshot.presentationOwnership===publicationOwnership&&session.snapshot().presentationOwnership===publicationOwnership);
        if(publicationOwnership!==undefined&&!isPresentationOwnership(publicationOwnership,session)){fail('Invalid presentation ownership');return;}
        if (!Number.isFinite(env.width) || !Number.isFinite(env.height) || env.width <= 0 || env.height <= 0 || !Number.isFinite(env.textScale) || env.textScale <= 0 || !env.fontFamily.trim()) {
            fail('Invalid environment');
            return;
        }
        if (validateTableDecision(doc).length || doc.offer.actions.some(action => action.kind !== 'command')) {
            fail('Unsupported or invalid decision');
            return;
        }
        const planningCompletion=completion?.view;
        const gameplayRead=planningCompletion?issuePublicGameplayRead(planningCompletion,doc,publicPaintResources(doc),env,performance.now()):null;
        if(planningCompletion&&!gameplayRead){retireCompletion();invalidate();schedule();return;}
        const planningCompletionCurrent=()=>!planningCompletion||completion?.view===planningCompletion&&completionAuthorityCurrent()&&issuePublicGameplayRead(planningCompletion,doc,publicPaintResources(doc),env,performance.now())===gameplayRead;
        status = 'preparing';
        let result;
        try {
            result = planner(doc, env, Object.freeze({...choiceView(doc),...(gameplayRead?{publicGameplayRead:gameplayRead}:{})}), metrics);
        }
        catch {
            if (current())
                fail('Planner failed');
            return;
        }
        if (!current())
            return;
        if (result.kind === 'needs') {
            if (++attempts > 8) {
                fail('Measurement did not converge');
                return;
            }
            const missing = [...new Map(result.requests.map(request => [request.key, request])).values()];
            if (!missing.length || missing.length > MAX_METRICS) {
                fail(missing.length ? 'Measurement working set exceeds engine budget' : 'Invalid measurement request batch');
                return;
            }
            const requests=missing.slice(0,MEASUREMENT_BATCH_LIMIT);
            const requested = new Set(requests.map(request => request.key));
            status = 'measuring';
            let completed = false;
            if (measurementDeadline === null)
                measurementDeadline = setTimeout(() => { if (!current())
                    return; completed = true; generation++; release('measure'); fail('Measurement deadline exceeded'); }, 500);
            let cleanup: (() => void);
            try {
                cleanup = target.measure(requests, replies => {
                    if (completed || !current())
                        return;
                    completed = true;
                    releaseRequest();
                    const received = new Map(replies.map(reply => [reply.key, reply.size]));
                    if (received.size !== requested.size || [...received].some(([key, size]) => !requested.has(key) || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 0 || size.height < 0)) {
                        fail('Invalid or partial measurement');
                        return;
                    }
                    for (const [key, size] of received) {
                        if (metrics.size >= MAX_METRICS && !metrics.has(key))
                            metrics.delete(metrics.keys().next().value!);
                        metrics.set(key, Object.freeze({ ...size }));
                    }
                    schedule();
                });
            }
            catch {
                if (current())
                    fail('Measurement host failed');
                return;
            }
            if (completed || !current())
                cleanup();
            else
                releaseMeasure = cleanup;
            return;
        }
        if (result.kind !== 'ready') {
            // A current public rename may honestly outgrow the outgoing motion
            // allocation. Retire that event, then render the latest static view;
            // never enlarge/crop its reserved geometry or claim arrival.
            if(result.kind==='cannot-fit'&&planningCompletion&&completion?.view===planningCompletion){retireCompletion();invalidate();schedule();return;}
            fail(result.reason);
            return;
        }
        release('measure');
        const errors = [...validateLayout(result.layout,env)];
        if(result.layout.primaryViewport&&result.layout.primaryViewport.height!==env.height)errors.push('Primary viewport environment changed');
        if (result.layout.width !== env.width)
            errors.push('Layout width differs from environment');
        if (errors.length) {
            fail(errors.join('; '));
            return;
        }
        if(result.layout.modalId)pendingRecycle=null;
        let revealFocusId:string|undefined;
        if(formFocusField&&activeForm){const target=result.layout.nodes.find(node=>node.enabled&&(node.editor?.fieldId===formFocusField||node.formField?.fieldId===formFocusField));if(target){focusId=target.id;revealFocusId=target.id;formFocusField=null;}}
        const focusable=result.layout.nodes.filter(node=>inModal(node.id,result.layout)&&(node.kind==='group'&&node.scroll||node.enabled&&(node.kind==='command'||node.kind==='choice'||node.kind==='select'||node.kind==='toggle'||node.kind==='range'||node.kind==='editor'||node.kind==='card'&&!!(node.cardId||node.inspectCardId))));
        const fallbackControl=(activeForm?focusable.find(node=>node.kind==='editor'):undefined)??focusable.find(node=>node.kind!=='group');
        const nextFocus=focusId&&focusable.some(node=>node.id===focusId)?focusId:result.layout.modalId?fallbackControl?.id??focusable[0]?.id??null:null;
        if((catalogue||cardActionPicker)&&nextFocus&&focusable.some(node=>node.id===nextFocus&&node.kind==='choice'))revealFocusId=nextFocus;
        if(nextFocus&&focusable.some(node=>node.id===nextFocus&&node.kind==='card'&&node.zoneId==='hand'))revealFocusId=nextFocus;
        const nativePresentation=choiceView(doc).nativeCardPresentation;
        const pickerCardId=cardActionPicker&&cardActionPicker.authority===selectionAuthority(doc)&&cardActionPicker.cards===JSON.stringify(cardIds())&&cardIds().length===1?cardIds()[0]:undefined;
        const layout:CandidateLayout={width:result.layout.width,height:result.layout.height,recipe:result.layout.recipe,nodes:result.layout.nodes,primaryViewport:result.layout.primaryViewport,decisionLaneId:result.layout.decisionLaneId,outcomeLaneId:result.layout.outcomeLaneId,modalId:result.layout.modalId,deals:result.layout.deals,stockReturn:result.layout.stockReturn, reveals:result.layout.reveals};
        const next: PresentationFrame = completionReceive.materialize(Object.freeze({ ...layout,paintResources:publicPaintResources(doc),publicCompletion:completion?.view,outcomeReadCatalogId:doc.outcome?.detailsCatalogId,essentialInputKind:nativeCardInputKind(doc,result.layout),...(result.layout.primaryViewport?{primaryViewport:Object.freeze({...result.layout.primaryViewport,regionIds:Object.freeze([...result.layout.primaryViewport.regionIds])})}:{}), nodes: Object.freeze(result.layout.nodes.map(node => Object.freeze({ ...node, ...nativeCardSemantics(doc,node,nativePresentation,cardIds(),pickerCardId), ...(node.ownHandAnchor?{ownHandAnchor:Object.freeze({...node.ownHandAnchor})}:{}), ...(node.disclosureIntent?{disclosureIntent:Object.freeze({...node.disclosureIntent})}:{}), ...(node.options?{options:Object.freeze(node.options.map(option=>Object.freeze({...option})))}:{}), ...(node.progressPaint?{progressPaint:Object.freeze({...node.progressPaint,segments:Object.freeze(node.progressPaint.segments.map(segment=>Object.freeze({...segment})))})}:{}), box: Object.freeze({ ...node.box }) }))), id: ++nextFrameId,rosterIds:Object.freeze(roster(doc)),...(recycleCurrent(doc)?{recycleAdmission:pendingRecycle!.proof}:{}),settled:!!doc.outcome, environment: Object.freeze({ ...env }), context: Object.freeze({ ...doc.context }), offerId: doc.offer.id,...(doc.feedback?{feedbackScope:doc.feedback.scope}:{}),...(feedbackController?{feedbackArrivals:feedbackController.prepareFrame(nextFrameId,result.layout.nodes.flatMap(node=>node.entityId?[node.entityId]:[]))}:{}), focusId: nextFocus,...(revealFocusId?{revealFocusId}:{}) }),result.layout);
        try {
            if (!current())
                return;
            if(!planningCompletionCurrent()){retireCompletion();invalidate();schedule();return;}
            publishingFrame=next;try{target.publish(next);}finally{publishingFrame=null;}
            if (!current()) {
                if (writers.get(target.identity) === owner || !writers.has(target.identity)) {
                    target.disarm();
                    target.clear();
                }
                return;
            }
            frame = next;frameOwnership=isPresentationOwnership(publicationOwnership,session)?publicationOwnership:undefined;
            if(concealed?.frameId!==next.id)concealed=null;
            for(const id of concealNeedsBegin)if(!next.nodes.some(node=>node.id===id))concealNeedsBegin.delete(id);
            lastFrameId = next.id;
            focusId = nextFocus;
            status = 'ready';
            attempts = 0;feedbackController?.published(next.id);if(pendingRefusal&&current()){const refusal=pendingRefusal;pendingRefusal=null;if(inspection?.cardId===refusal.cardId&&inspection.reason===refusal.reason){surface?.refuse?.(refusal.nodeId);feedbackController?.local({id:`refusal:${++refusalSerial}`,kind:'refusal',milestone:{kind:'visible'}});}}
        }
        catch {
            if (current())
                fail('Frame publication failed');
        }
    }
    function inModal(id:string,layout:Pick<PresentationFrame,'nodes'|'modalId'>):boolean {
        if(!layout.modalId)return true;
        let node=layout.nodes.find(node=>node.id===id);
        while(node){if(node.id===layout.modalId)return true;node=node.parent?layout.nodes.find(parent=>parent.id===node!.parent):undefined;}
        return false;
    }
    function canExecuteShellCommand(doc:TableDocument<A>):boolean {
        return snapshot.connected&&!snapshot.admissionBlocked&&!snapshot.operations.some(op=>op.offerId===doc.offer.id&&['queued','uncertain','accepted','unavailable'].includes(op.status));
    }
    function commandFingerprint(doc:TableDocument<A>,action:RoomShellAction):string|null {
        if(action.intent.kind!=='command'||!action.enabled||!doc.shell)return null;
        const actionId=action.intent.actionId;
        const binding=doc.offer.actions.find(binding=>binding.id===actionId);
        if(binding?.kind!=='command'||!binding.enabled||!doc.decision.commands.includes(binding.id))return null;
        return JSON.stringify([doc.context.session,doc.context.audience,doc.context.generation,binding.id,binding.action,action.subjects,action.confirmation,action.id,action.label]);
    }
    function leaveFingerprint(doc:TableDocument<A>):string|null {
        const binding=doc.offer.actions.find(action=>action.id===doc.shell?.leaveActionId);
        return binding?.kind==='command'&&binding.enabled?JSON.stringify([doc.context.session,doc.context.audience,doc.context.generation,binding.id,binding.action,doc.shell?.leaveConfirmation]):null;
    }
    function currentCommandConfirmation(doc:TableDocument<A>):ChoiceView['shellCommandConfirmation'] {
        const pending=commandConfirmation;
        if(!pending||!shellConfirmation||!pending.action.confirmation||commandFingerprint(doc,pending.action)!==pending.fingerprint)return undefined;
        return Object.freeze({title:pending.action.confirmation.title,message:pending.action.confirmation.message,actions:Object.freeze([
            Object.freeze({id:'room-shell:cancel-command',purpose:'cancel' as const,label:'취소',enabled:true,intent:Object.freeze({kind:'cancel-confirmation' as const})}),
            Object.freeze({id:'room-shell:confirm-command',purpose:'confirm' as const,label:pending.action.confirmation.confirmLabel,enabled:true,intent:pending.action.intent,subjects:pending.action.subjects}),
        ])});
    }
    function visibleShellActions(doc:TableDocument<A>):readonly RoomShellAction[] {
        const shell=doc.shell;if(!shell)return [];
        if(shellConfirmation)return currentCommandConfirmation(doc)?.actions??shell.leaveConfirmation?.actions??[];
        if(!shellPage)return [...shell.header.actions,...(doc.stage==='waiting'?waitingSeatActions(shell):[])];
        const page=shell.pages.find(page=>page.id===shellPage);if(!page)return [];
        if(shellPage==='manage')return [...page.actions.filter(action=>action.purpose==='close'),...(shell.management?.find(group=>sameRoomSubject(group.subject,shellSubject))?.actions??[])];
        return [...page.actions,...(page.people??[]).flatMap(person=>person.actions??[]),...(page.people?shell.seats?.filter(seat=>seat.kind==='empty').flatMap(seat=>seat.actions)??[]:[])];
    }
    const catalogueAuthority=(doc:TableDocument<A>)=>JSON.stringify([doc.context.session,doc.context.audience,doc.context.generation,doc.offer.id,doc.decision,!!finiteDecision(doc.decision)?finiteDecision(doc.decision)!.variants.map(row=>doc.offer.actions.find(action=>action.id===row.actionId)):[]]);
    const selectionAuthority=(doc:TableDocument<A>)=>JSON.stringify([cardSelectionAuthority({...doc,decision:cardDecision(doc.decision)??doc.decision}),doc.interaction?.cardActivation]);
    function openCardActionPicker(doc:TableDocument<A>,opener:string):boolean {
        if(cardActionPicker||!cardDecision(doc.decision)||cardDecision(doc.decision)!.disambiguation!=='choose-action'||!canExecuteShellCommand(doc)||activeForm||disclosureView()||catalogue||informationOpen||shellPage||shellConfirmation||selectedCardActions(cardDecision(doc.decision)!,doc.offer,cardIds()).length<2)return false;
        cardActionPicker={leaseId:`card-action-${++nextCardActionLease}`,draftActionId:cardActionId(),opener,authority:selectionAuthority(doc),cards:JSON.stringify(cardIds()),revision:decisionDraft.revision,document:doc};
        focusId=null;adviceOpen=false;reactionsOpen=false;inspection=undefined;invalidate();schedule();return true;
    }
    function closeCardActionPicker(){if(!cardActionPicker)return;focusId=cardActionPicker.opener;cardActionPicker=null;invalidate();schedule();}
    function closeCatalogue(){if(!catalogue)return;focusId=catalogue.opener;catalogue=null;invalidate();schedule();}
    function closeScoreboard(){
        scoreboardOpen=false;
        if(scoreboardReturnToInformation){focusId=scoreboardOpener;}
        else{informationOpen=false;focusId=informationOpener;informationOpener=null;}
        scoreboardReturnToInformation=false;scoreboardOpener=null;invalidate();schedule();
    }
    function closeShell():boolean {
        if(cardActionPicker){closeCardActionPicker();return true;}
        if(catalogue){closeCatalogue();return true;}
        if(activeForm){if(activeForm.draft.composing)return true;formAction('close');return true;}
        if(scoreboardOpen){closeScoreboard();return true;}
        if(informationOpen){informationOpen=false;focusId=informationOpener;informationOpener=null;invalidate();schedule();return true;}
        if(inspection||adviceOpen||reactionsOpen){inspection=undefined;adviceOpen=false;reactionsOpen=false;invalidate();schedule();return true;}
        if(shellConfirmation){shellConfirmation=false;commandConfirmation=null;leaveConfirmationFingerprint=null;focusId=confirmationOpener;confirmationOpener=null;}
        else if(shellPage){
            let previous=shellHistory.pop();
            while(previous?.page&&!snapshot.document?.shell?.pages.some(page=>page.id===previous!.page))previous=shellHistory.pop();
            shellPage=previous?.page;shellSubject=previous?.subject;focusId=previous?.focus??null;
        }
        else return false;
        invalidate();schedule();return true;
    }
    function openShell(page:RoomShellPageId,opener:string|null,subject?:RoomOperationSubject):void {
        if(!snapshot.document?.shell?.pages.some(candidate=>candidate.id===page)||(shellPage===page&&(page!=='manage'||sameRoomSubject(shellSubject,subject))))return;
        const existing=shellHistory.findIndex(entry=>entry.page===page&&(page!=='manage'||sameRoomSubject(entry.subject,subject)));
        if(existing>=0){
            const previous=shellHistory[existing];shellHistory=shellHistory.slice(0,existing);focusId=previous.focus;
        }else if(shellPage===page&&page==='manage'){
            // A different target replaces the detail surface instead of growing a per-person stack.
            focusId=null;
        }else{shellHistory.push({page:shellPage,subject:shellSubject,focus:opener});focusId=null;}
        shellPage=page;shellSubject=page==='manage'?subject:undefined;shellConfirmation=false;commandConfirmation=null;leaveConfirmationFingerprint=null;invalidate();schedule();
    }
    function shellAction(action:RoomShellAction,nodeId:string,doc:TableDocument<A>):void {
        const shell=doc.shell;if(!shell)return;
        switch(action.intent.kind){
            case 'open-disclosure':openDisclosure(action.intent.catalogId);return;
            case 'open-form':{const offer=doc.forms?.find(form=>form.id===(action.intent.kind==='open-form'?action.intent.formId:null)&&form.enabled);if(offer)beginForm(offer);return;}
            case 'open-page':openShell(action.intent.page,nodeId);return;
            case 'inspect-subject':{
                const group=shell.management?.find(group=>sameRoomSubject(group.subject,action.intent.kind==='inspect-subject'?action.intent.subject:undefined));
                if(group)openShell('manage',nodeId,group.subject);return;
            }
            case 'command':{
                if(!canExecuteShellCommand(doc))return;
                const binding=doc.offer.actions.find(binding=>binding.id===(action.intent.kind==='command'?action.intent.actionId:null));
                if(binding?.kind!=='command'||!binding.enabled||!doc.decision.commands.includes(binding.id))return;
                if(commandConfirmation){
                    const pending=commandConfirmation;
                    if(!shellConfirmation||pending.action.intent.kind!=='command'||pending.action.intent.actionId!==binding.id||commandFingerprint(doc,pending.action)!==pending.fingerprint)return;
                }else if(action.confirmation){
                    const fingerprint=commandFingerprint(doc,action);if(!fingerprint)return;
                    commandConfirmation={action,fingerprint};leaveConfirmationFingerprint=null;shellConfirmation=true;confirmationOpener=nodeId;focusId=null;invalidate();schedule();return;
                }
                cancelled=true;commitCommand(doc,binding.id,binding.action);return;
            }
            case 'close':closeShell();return;
            case 'confirm-leave':commandConfirmation=null;leaveConfirmationFingerprint=leaveFingerprint(doc);shellConfirmation=true;confirmationOpener=nodeId;focusId=null;invalidate();schedule();return;
            case 'cancel-confirmation':closeShell();return;
            case 'request-effect':{
                const effect=action.intent.effect;
                if(effect==='leave-room'){
                    if(shell.leaveConfirmation&&!shellConfirmation){commandConfirmation=null;leaveConfirmationFingerprint=leaveFingerprint(doc);shellConfirmation=true;confirmationOpener=nodeId;focusId=null;invalidate();schedule();return;}
                    if(shell.leaveConfirmation&&leaveConfirmationFingerprint!==leaveFingerprint(doc)){closeShell();return;}
                    if(shell.leaveActionId){
                        const command=doc.offer.actions.find(candidate=>candidate.id===shell.leaveActionId);
                        if(command?.kind==='command'&&command.enabled){cancelled=true;commitCommand(doc,command.id,command.action);}
                        return;
                    }
                }
                if(shell.effects.includes(effect))effects?.invoke(effect,doc.context);
            }
        }
    }
    function assistanceAction(action:NonNullable<PresentationFrame['nodes'][number]['assistanceIntent']>){
        const doc=snapshot.document,current=doc?.assistance;if(!doc||!current||!snapshot.connected||session.snapshot().document!==doc)return;
        if(action.kind==='dismiss-advice')adviceOpen=false;
        else if(action.kind==='dismiss-inspection')inspection=undefined;
        else if(action.kind==='toggle-reactions'){if(!current.projection.tools.some(tool=>tool.kind==='send-reaction'&&tool.enabled))return;reactionsOpen=!reactionsOpen;}
        else if(action.kind==='close-reactions')reactionsOpen=false;
        else if(action.kind==='tool'){
            const tool=current.projection.tools.find(tool=>tool.id===action.toolId&&tool.enabled);if(!tool)return;
            if(tool.kind==='request-advice'&&action.optionId!==undefined)return;
            if(tool.kind==='request-advice'&&current.projection.advice){adviceOpen=true;inspection=undefined;reactionsOpen=false;invalidate();schedule();return;}
            const captured=captureAssistance(current,current.bindings.authority,action.toolId,action.optionId),operation=captured&&resolveAssistanceIntent(current,current.bindings.authority,captured);if(!operation)return;
            try{assistance?.invoke(operation);}catch{/* An ephemeral request has no durable acceptance. */}
            if(disposed||session.snapshot().document!==doc)return;if(tool.kind==='send-reaction')reactionsOpen=false;
        }
        invalidate();schedule();
    }
    function intent(input: SurfaceIntent) {
        if(input.kind==='shortcut'||input.kind==='assistance-dismiss'){
            if(disposed||!surface||status!=='ready'||!frame||input.frameId!==frame.id||session.snapshot().document!==snapshot.document||activeForm||disclosureView()||shellPage||shellConfirmation)return;
            if(input.kind==='assistance-dismiss'){inspection=undefined;adviceOpen=false;reactionsOpen=false;invalidate();schedule();return;}
            if(frame.modalId&&!adviceOpen&&!reactionsOpen)return;
            if(input.key==='R'){assistanceAction({kind:'toggle-reactions'});return;}
            const tool=snapshot.document?.assistance?.projection.tools.find(tool=>tool.kind==='request-advice');if(tool)assistanceAction({kind:'tool',toolId:tool.id});return;
        }

        if(input.kind==='edit'){
            const form=activeForm,doc=snapshot.document;
            if(disposed||!surface||!form||!doc||session.snapshot().document!==doc||input.leaseId!==form.leaseId||form.scope!==actorScope(doc.context)||input.fieldLeaseId!==form.fieldLeases[input.fieldId])return;
            const field=form.offer.fields.find(field=>field.id===input.fieldId);if(!field||!['text','number','multiline'].includes(field.kind)||!('maxCodeUnits' in field)||typeof input.value!=='string'||form.reduction?.visibility[field.id]===false||form.reduction?.enabled[field.id]===false)return;
            const view=formView();if(view?.actions?.some(action=>action.completion==='lock'&&['queued','sending','accepted','processed','uncertain'].includes(action.status??'')))return;
            const overflow=input.value.length>field.maxCodeUnits;if(overflow)form.overflowFields.add(field.id);else form.overflowFields.delete(field.id);
            if(form.composingFieldId&&form.composingFieldId!==field.id)return;
            const composing=input.composition==='start'||input.composition==='update'||input.composition==='input'&&form.draft.composing;
            const values=Object.freeze({...form.draft.values,[field.id]:overflow?form.draft.values[field.id]:input.value});if(JSON.stringify(values).length>65536)return;
            focusId=frame?.nodes.find(node=>node.editor?.leaseId===form.leaseId&&node.editor.fieldId===field.id)?.id??focusId;
            form.draft=Object.freeze({values,revision:form.draft.revision+1,compositionEpoch:form.draft.compositionEpoch+(input.composition==='start'||input.composition==='end'?1:0),composing});
            form.composingFieldId=composing?field.id:undefined;
            if(!composing&&!overflow){const reduced=form.port.reduce({fieldId:field.id,value:input.value});if(reduced){form.reduction=reduced;form.draft=Object.freeze({...form.draft,values:reduced.values});refreshFieldLeases();}}
            invalidate();schedule();return;
        }
        if(input.kind==='form-field'){
            if(status!=='ready'||!frame||frame.id!==input.frameId||session.snapshot().document!==snapshot.document)return;const node=frame.nodes.find(node=>node.id===input.nodeId);if(node&&inModal(node.id,frame)&&node.formField)formField(node,input.value);return;
        }
        if(input.kind==='form'){
            if(status==='ready'&&frame&&input.frameId===frame.id&&input.leaseId===activeForm?.leaseId&&frame.modalId)formAction(input.action);return;
        }

        if (input.kind === 'focus') {
            if (disposed || !surface || session.snapshot().document !== snapshot.document)
                return;
            if (input.nodeId === null) {
                if (input.frameId === frame?.id || input.frameId === lastFrameId)
                    focusId = null;
                return;
            }
            if (status !== 'ready' || !frame || input.frameId !== frame.id)
                return;
            const focused = frame.nodes.find(node => node.id === input.nodeId);
            if (focused && !(essentialMask?.frameId===frame.id&&essentialMask.ids.has(focused.id)) && !(concealed?.frameId===frame.id&&concealed.ids.has(focused.id)) && inModal(focused.id,frame) && (focused.kind==='editor'&&focused.enabled || focused.kind==='group'&&focused.scroll || focused.enabled&&(focused.kind === 'command' || focused.kind === 'choice' || focused.kind==='select' || focused.kind==='toggle' || focused.kind==='range' || focused.kind === 'card')))
                focusId = focused.id;
            return;
        }
        if (input.kind === 'cancel') {
            // Focus leaving an old button must not cancel the newer pointer press
            // which just moved focus to another button in the same surface.
            if (input.nodeId && gesture?.node !== input.nodeId)
                return;
            if (gesture) {
                gesture = null;
                cancelled = true;
            }
            return;
        }
        if (disposed || !surface || status !== 'ready' || !frame || input.frameId !== frame.id)
            return;
        if(input.kind==='dismiss'){
            const doc=snapshot.document;if(doc&&session.snapshot().document===doc&&sameContext(frame.context,doc.context)&&frame.modalId){if(activeForm){formAction('close');}else if(disclosureView()){closeDisclosure();focusId=null;invalidate();schedule();}else closeShell();}
            return;
        }
        const node = frame.nodes.find(node => node.id === input.nodeId);
        if (!node || !node.enabled || essentialMask?.frameId===frame.id&&essentialMask.ids.has(node.id) || concealed?.frameId===frame.id&&concealed.ids.has(node.id) || !inModal(node.id,frame) || (!snapshot.connected&&!node.localIntent&&!node.shellIntent&&!node.preference&&!node.formIntent&&!node.disclosureIntent&&!node.disclosureCatalogId&&!node.disclosureFormActionId) || (node.kind !== 'command' && node.kind !== 'choice' && node.kind!=='select' && node.kind!=='toggle' && node.kind!=='range' && node.kind !== 'card'))
            return;
        if(completion&&(node.actionId||node.cardId||node.inspectCardId||node.fieldId||node.cardActionOptionId||node.cardActionPickerIntent||node.catalogueIntent||node.localIntent==='submit-card-set'||node.shellIntent?.kind==='command'&&snapshot.document?.outcome?.continuationActionIds.includes(node.shellIntent.actionId)))return;
        if (input.kind === 'begin') {
            concealNeedsBegin.delete(node.id);
            gesture = { frame: frame.id, node: node.id };
            cancelled = false;
            return;
        }
        if (input.kind !== 'activate'&&input.kind!=='choose'&&input.kind!=='preference') return;
        if((input.kind==='activate'||input.kind==='choose')&&input.provenance!=='direct'&&concealNeedsBegin.has(node.id)&&(!gesture||gesture.frame!==frame.id||gesture.node!==node.id))return;
        if (input.kind==='activate'&&input.provenance!=='direct'&&cancelled) {
            cancelled = false;
            return;
        }
        if (input.kind==='activate'&&input.provenance!=='direct'&&gesture && (gesture.frame !== frame.id || gesture.node !== node.id))
            return;
        gesture = null;
        const doc = snapshot.document;
        const authoritative = session.snapshot();
        if (authoritative.document !== doc || !authoritative.connected&&!node.localIntent&&!node.shellIntent&&!node.preference&&!node.formIntent&&!node.disclosureIntent&&!node.disclosureCatalogId&&!node.disclosureFormActionId)
            return;
        if (!doc || !sameContext(frame.context, doc.context) || frame.offerId !== doc.offer.id)
            return;
        const expectedDecisionGroup=node.actionId?normalizeDecision(tableDecisionInput(doc)).value?.bindings[node.actionId]:node.cardId||node.inspectCardId||node.cardActionPickerIntent||node.cardActionOptionId||node.localIntent==='submit-card-set'?cardDecision(doc.decision)?.id:node.fieldId||node.catalogueIntent?finiteDecision(doc.decision)?.id:undefined;
        if(expectedDecisionGroup===null&&node.decisionGroupId!==undefined||typeof expectedDecisionGroup==='string'&&(node.decisionGroupId!==undefined&&node.decisionGroupId!==expectedDecisionGroup||doc.decision.kind==='composition'&&node.decisionGroupId!==expectedDecisionGroup))return;
        if(node.cardActionPickerIntent!==undefined){
            const request=node.cardActionPickerIntent;
            const forbidden:readonly (keyof typeof node)[]=['actionId','cardId','fieldId','optionId','localIntent','catalogueIntent','choiceLeaseId','choiceCard','cardActionOptionId','shellIntent','shellActionId','formIntent','formActionId','formField','formNavigation','formLeaseId','editor','preference','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','assistanceIntent','inspectCardId','feedbackDismissId','publicDisclosureEventId','inspectionPreviewFor','entityId','ownerId','zoneId','recipientId','recipientCount','stockCount','collectionPurpose','recycleAnchor','recycleCaption','ownHandAnchor','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor'];
            if(node.kind!=='command'||forbidden.some(key=>node[key]!==undefined)||!cardDecision(doc.decision)||cardDecision(doc.decision)!.disambiguation!=='choose-action'||!canExecuteShellCommand(doc)||activeForm||disclosureView()||catalogue||informationOpen||shellPage||shellConfirmation)return;
            if(request.kind==='open'){
                if(request.leaseId===undefined)openCardActionPicker(doc,node.id);return;
            }
            const picker=cardActionPicker;
            if(!picker||request.leaseId!==picker.leaseId||picker.authority!==selectionAuthority(doc)||picker.cards!==JSON.stringify(cardIds())||picker.revision!==decisionDraft.revision||picker.document!==doc)return;
            if(request.kind==='close'){closeCardActionPicker();return;}
            if(request.kind!=='confirm')return;
            const action=selectedCardAction(cardDecision(doc.decision)!,doc.offer,cardIds(),picker.draftActionId);
            if(action&&editDecision(doc,{kind:'choose-card-action',groupId:cardDecision(doc.decision)!.id,actionId:action.id})){if(commitCommand(doc,action.id,action.action,cardDecision(doc.decision)!.id)&&cardActionPicker===picker)closeCardActionPicker();else if(cardActionPicker===picker)cardActionPicker={...picker,revision:decisionDraft.revision};}
            return;
        }
        if(node.cardActionOptionId!==undefined){
            // Native options are drafts within the current engine choice lease.
            const forbidden:readonly (keyof typeof node)[]=['actionId','cardId','fieldId','optionId','localIntent','catalogueIntent','choiceLeaseId','choiceCard','cardActionPickerIntent','shellIntent','shellActionId','formIntent','formActionId','formField','formNavigation','formLeaseId','editor','preference','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','assistanceIntent','inspectCardId','feedbackDismissId','publicDisclosureEventId','inspectionPreviewFor','entityId','ownerId','zoneId','recipientId','recipientCount','stockCount','collectionPurpose','recycleAnchor','recycleCaption','ownHandAnchor','trickSlot','collectedBy','identityMetaFor','participantFeedbackFor'];
            if(node.kind!=='choice'||forbidden.some(key=>node[key]!==undefined))return;
            if(!cardActionPicker||frame.modalId!=='card-action-dialog'||frame.nodes.find(node=>node.id===frame!.modalId)?.choiceLeaseId!==cardActionPicker.leaseId||!cardDecision(doc.decision)||cardDecision(doc.decision)!.disambiguation!=='choose-action'||!canExecuteShellCommand(doc)||activeForm||disclosureView()||catalogue||informationOpen||shellPage||shellConfirmation)return;
            const candidate=selectedCardActions(cardDecision(doc.decision)!,doc.offer,cardIds()).find(action=>action.id===node.cardActionOptionId);
            if(!candidate?.enabled)return;
            cardActionPicker={...cardActionPicker,draftActionId:candidate.id};focusId=node.id;invalidate();schedule();return;
        }
        if(node.catalogueIntent){
            if(node.catalogueIntent.kind==='close'){closeCatalogue();return;}
            if(!finiteDecision(doc.decision)||!finiteValues(doc)||!finiteDecision(doc.decision)!.fields.some(field=>field.id===node.catalogueIntent!.fieldId&&field.catalogue))return;
            catalogue={leaseId:`catalogue-${++nextCatalogueLease}`,fieldId:node.catalogueIntent.fieldId,draft:{...finiteValues(doc)!},opener:node.id,authority:catalogueAuthority(doc),revision:decisionDraft.revision,document:doc};
            focusId=JSON.stringify(['catalogue-option',catalogue.fieldId,finiteValues(doc)![catalogue.fieldId]]);informationOpen=false;adviceOpen=false;reactionsOpen=false;inspection=undefined;invalidate();schedule();return;
        }
        if(node.feedbackDismissId){feedbackController?.dismiss(node.feedbackDismissId);return;}
        if(node.assistanceIntent){assistanceAction(node.assistanceIntent);return;}
        if(node.inspectCardId){const current=doc.assistance;const inspected=current&&inspectAssistance(current,current.bindings.authority,node.inspectCardId);if(inspected){inspection=inspected;pendingRefusal={nodeId:node.id,cardId:inspected.cardId,reason:inspected.reason};adviceOpen=false;reactionsOpen=false;invalidate();schedule();}return;}
        if(node.formNavigation){const nav=node.formNavigation,form=activeForm;if(!form||nav.leaseId!==form.leaseId||form.draft.composing)return;if(nav.sectionId&&form.offer.sections?.some(section=>section.id===nav.sectionId))form.activeSection=nav.sectionId;if(nav.summaryPage!==undefined){const pages=Math.max(1,Math.ceil(formSummaryItems(formView()!).length/FORM_SUMMARY_PAGE_SIZE));if(Number.isSafeInteger(nav.summaryPage)&&nav.summaryPage>=0&&nav.summaryPage<pages)form.summaryPage=nav.summaryPage;}refreshFieldLeases();formFocusField=nav.fieldId??null;focusId=null;invalidate();schedule();return;}
        if(node.formField){formField(node);return;}
        if(node.disclosureFormActionId){const view=disclosureView(),receipt=view?.selection,link=doc.disclosureFormActions?.find(action=>action.id===node.disclosureFormActionId);if(!activeForm&&receipt&&link&&link.selectionId===receipt.id&&link.catalogId===receipt.catalogId&&link.catalogRevision===receipt.revision&&link.entryId===receipt.entryId&&session.disclosures?.selectionCurrent?.(receipt.id)===true){const offer=doc.forms?.find(form=>form.id===link.formId&&form.instanceId===link.formInstanceId&&form.enabled&&form.access?.selectionId===receipt.id);if(offer&&session.snapshot().document===doc)beginForm(offer);}return;}
        if(node.disclosureIntent){if(disclosure.intent(node.disclosureIntent)){metrics.clear();attempts=0;surface?.preserveModal?.(disclosureView()?.leaseId??null);focusId=node.semanticRole==='tab'?node.id:null;invalidate();schedule();}return;}
        if(node.disclosureCatalogId){if(doc.outcome?.detailsCatalogId===node.disclosureCatalogId)openDisclosure(node.disclosureCatalogId);return;}
        if(disclosureView()&&!activeForm)return;
        if(node.formIntent){if(activeForm&&node.formLeaseId===activeForm.leaseId)formAction(node.formIntent,node.formActionId);return;}
        if(activeForm)return;
        if(node.preference){
            if(!shellPage||shellConfirmation||!effects?.changePreference)return;
            const field=doc.shell?.pages.find(page=>page.id===shellPage)?.preferences?.find(field=>field.id===node.preference!.id);
            if(!field||!field.enabled||JSON.stringify(field)!==JSON.stringify(node.preference)||
                (field.kind==='toggle'?node.kind!=='toggle':field.kind==='select'?node.kind!=='select':node.kind!=='range'))return;
            const value=input.kind==='preference'?input.value:input.kind==='activate'&&field.kind==='toggle'?!field.value:undefined;
            if(value===undefined||!acceptPreferenceValue(field,value))return;
            focusId=node.id;gesture=null;
            effects.changePreference(Object.freeze({fieldId:field.id,value}),doc.context);return;
        }
        if(node.shellIntent&&node.shellActionId&&doc.shell){
            const actions=visibleShellActions(doc);
            const action=actions?.find(action=>action.id===node.shellActionId&&action.enabled&&JSON.stringify(action.intent)===JSON.stringify(node.shellIntent));
            if(action)shellAction(action,node.id,doc);return;
        }
        if(input.kind==='choose'){
            if(node.kind!=='select'||!node.fieldId||!finiteDecision(doc.decision)||!node.options?.some(option=>option.id===input.optionId&&option.enabled))return;
            const next=reconcileChoices(finiteDecision(doc.decision)!,doc.offer,finiteValues(doc)??finiteDecision(doc.decision)!.initialValues,node.fieldId,input.optionId);
            if(!next)return;
            if(!editDecision(doc,{kind:'choose',groupId:finiteDecision(doc.decision)!.id,fieldId:node.fieldId,optionId:input.optionId}))return;focusId=node.id;invalidate();schedule();return;
        }
        if(node.localIntent==='submit-card-set'){if(!!cardDecision(doc.decision)&&cardDecision(doc.decision)!.mode==='count')commitDecision(doc,cardDecision(doc.decision)!.id,{kind:'card-set',cardIds:cardIds()});return;}
        if(node.localIntent==='toggle-information'){if(informationOpen){informationOpen=false;focusId=informationOpener;informationOpener=null;scoreboardOpen=false;scoreboardReturnToInformation=false;scoreboardOpener=null;}else if(doc.information?.length||doc.scoreboard||doc.facts.length||doc.assistance?.projection.guidance?.length||doc.assistance?.projection.reactions.some(reaction=>!doc.opponents?.some(person=>person.id===reaction.participantId)&&(doc.participant.role==='observer'||doc.participant.id!==reaction.participantId))){informationOpen=true;informationOpener=node.id;focusId=null;adviceOpen=false;reactionsOpen=false;inspection=undefined;}invalidate();schedule();return;}
        if(node.localIntent==='toggle-scoreboard'){
            if(scoreboardOpen){closeScoreboard();return;}
            if(!doc.scoreboard)return;
            scoreboardReturnToInformation=informationOpen;scoreboardOpener=node.id;
            if(!informationOpen)informationOpener=node.id;
            informationOpen=true;scoreboardOpen=true;
            focusId=null;adviceOpen=false;reactionsOpen=false;inspection=undefined;invalidate();schedule();return;
        }
        if (node.kind === 'card' && !!cardDecision(doc.decision) && node.cardId) {
            const activation=doc.interaction?.cardActivation;
            if(activation&&cardDecision(doc.decision)!.mode==='one'){
                const repeated=cardIds().length===1&&cardIds()[0]===node.cardId;
                const matches=selectedCardActions(cardDecision(doc.decision)!,doc.offer,[node.cardId]);
                if(matches.length===1){
                    const candidate=selectedCardAction(cardDecision(doc.decision)!,doc.offer,[node.cardId]);
                    if(candidate?.enabled&&(activation==='single'||repeated)){
                        if(!repeated&&!editDecision(doc,{kind:'toggle-card',groupId:cardDecision(doc.decision)!.id,cardId:node.cardId}))return;cancelled=true;commitCommand(doc,candidate.id,candidate.action,cardDecision(doc.decision)!.id);return;
                    }
                }else if(matches.length>1&&cardDecision(doc.decision)!.disambiguation==='choose-action'&&choiceView(doc).nativeCardPresentation&&(activation==='single'||repeated)){
                    const next=toggleCards(cardDecision(doc.decision)!,doc.offer,[],node.cardId);if(!next)return;
                    if(!repeated&&!editDecision(doc,{kind:'toggle-card',groupId:cardDecision(doc.decision)!.id,cardId:node.cardId}))return;
                    if(openCardActionPicker(doc,node.id))return;
                }
            }
            const next = toggleCards(cardDecision(doc.decision)!, doc.offer, cardIds(), node.cardId);
            if (!next) return;
            if(!editDecision(doc,{kind:'toggle-card',groupId:cardDecision(doc.decision)!.id,cardId:node.cardId}))return;cardActionPicker=null;
            invalidate(); schedule(); return;
        }
        if (node.kind === 'choice' && !!finiteDecision(doc.decision) && node.fieldId && node.optionId) {
            const next = reconcileChoices(finiteDecision(doc.decision)!, doc.offer, catalogue?.draft??finiteValues(doc)??finiteDecision(doc.decision)!.initialValues, node.fieldId, node.optionId);
            if (!next)
                return;
            if(catalogue)catalogue={...catalogue,draft:next};else if(!editDecision(doc,{kind:'choose',groupId:finiteDecision(doc.decision)!.id,fieldId:node.fieldId,optionId:node.optionId}))return;
            invalidate();
            schedule();
            return;
        }
        const choice = choiceView(doc), allowed = [...choice.commands,...(choice.outcomeCommands??[])].some(command => command.id === node.actionId && command.enabled) || choice.selected?.id === node.actionId && choice.selected?.enabled === true;
        const action = doc.offer.actions.find(action => action.id === node.actionId);
        if (!allowed || action?.kind !== 'command' || !action.enabled)
            return;
        cancelled = true;
        if(catalogue){if(catalogue.document!==doc||catalogue.revision!==decisionDraft.revision||!editDecision(doc,{kind:'replace-finite',groupId:finiteDecision(doc.decision)!.id,values:catalogue.draft}))return;const preview=catalogue;if(commitCommand(doc,action.id,action.action,node.decisionGroupId)&&catalogue===preview){catalogue=null;invalidate();schedule();}else if(catalogue===preview)catalogue={...preview,revision:decisionDraft.revision};}else commitCommand(doc,action.id,action.action,node.decisionGroupId);
    }
    const unsubscribe = session.subscribe(next => {
        if (disposed)
            return;
        const previous = snapshot.document, doc = next.document,previousConnected=snapshot.connected;
        
        const pickerBefore=cardActionPicker;
        const rebasePicker=!!pickerBefore&&!!doc&&!!previous&&next.connected&&sameScope(previous.context,doc.context)&&pickerBefore.document===previous&&pickerBefore.revision===decisionDraft.revision&&pickerBefore.authority===selectionAuthority(doc)&&pickerBefore.cards===JSON.stringify(cardIds(previous));
        if(cardActionPicker&&!rebasePicker)cardActionPicker=null;
        if(catalogue&&(!doc||!next.connected||catalogue.authority!==catalogueAuthority(doc))){catalogue=null;}
        const oldOwnership=snapshot.presentationOwnership,newOwnership=next.presentationOwnership;
        const ownedLineage=isPresentationOwnership(oldOwnership,session)&&oldOwnership===newOwnership&&isPresentationOwnership(newOwnership,session);
        const legacyLineage=oldOwnership===undefined&&newOwnership===undefined&&previousConnected&&next.connected;
        if(completion&&(!doc||!ownedLineage||completion.ownership!==newOwnership||!environment||!currentPublicCompletion(completion.view,doc,publicPaintResources(doc),environment,performance.now())))retireCompletion();
        if(!completion&&doc&&previous&&frame&&environment&&ownedLineage&&isPresentationOwnership(newOwnership,session)&&frameOwnership===oldOwnership&&sameContext(frame.context,previous.context)&&JSON.stringify(frame.environment)===JSON.stringify(environment)){
            const view=admitPublicCompletion(frame,previous,doc,publicPaintResources(doc),performance.now(),id=>surface?.captureCompletionReceiveSource?.(frame!.id,id)??null),key=view&&publicCompletionFingerprint(view);
            if(view&&key&&key!==consumedCompletion){consumedCompletion=key;completionOutcome=null;const timer=setTimeout(()=>{if(completion?.view===view){retireCompletion();invalidate();schedule();}},Math.max(0,view.event.expiresAt-performance.now()));completion={view,ownership:newOwnership,timer,acknowledgedFrame:null,fenced:false};}
            else if(view)retirePublicCompletionGrant(view.event);
        }
        if(!doc||!previous||previous.context.session!==doc.context.session||previous.context.audience!==doc.context.audience||!ownedLineage&&!legacyLineage){motionContinuity++;pendingRecycle=null;essentialMask=null;frameOwnership=undefined;consumedCompletion=null;}
        if(activeForm){const form=activeForm,refresh=next.formOperations?.find(op=>op.instanceId===form.port.instanceId&&op.status==='stored'&&op.refreshDisclosure);
            if(refresh?.refreshDisclosure)pendingDisclosureRefresh={directive:refresh.refreshDisclosure,scope:form.scope,operationId:refresh.id};
            const candidate=doc?.forms?.find(offer=>offer.id===form.offer.id&&offer.instanceId===form.offer.instanceId);
            const schema=(offer:FormOffer<A>)=>JSON.stringify([offer.schemaVersion,offer.policyId,offer.editBinding,offer.fields.map(field=>({...field,initial:undefined})),offer.sections,offer.clusters,offer.rows]);
            if(!doc||form.scope!==actorScope(doc.context)||!candidate||schema(candidate)!==schema(form.offer))discardForm();
            else {if(JSON.stringify(candidate)!==JSON.stringify(form.offer)){const ownResult=form.port.matchesResult?.(candidate)===true,renewed=form.port.renew(doc.context,candidate.id);if(formEditIdentity(candidate)!==formEditIdentity(form.offer)||!renewed){if(!ownResult)form.conflict=true;}else form.offer=candidate;}}

        }
        invalidate();
        const latest=session.snapshot();
        if(latest.document!==doc||latest.presentationOwnership!==newOwnership||newOwnership!==undefined&&!isPresentationOwnership(newOwnership,session))return;
        const ownedFrame=ownedLineage&&frameOwnership===newOwnership;
        const exactBlockedEnvironment=previousConnected||!!frame&&!!environment&&JSON.stringify(frame.environment)===JSON.stringify(environment);
        if(doc&&previous&&(ownedFrame||legacyLineage)&&exactBlockedEnvironment&&next.connected&&surface&&frame&&sameContext(frame.context,previous.context)&&environment&&!frame.modalId&&doc.recycle){
            const proof=admitRecycle(frame,doc,motionContinuity,publicPaintResources(doc));
            if(proof)pendingRecycle={proof,targets:Object.freeze(doc.hand.map(card=>card.id)),environment,recovery:!previousConnected};
        }
        if(doc&&pendingRecycle&&!recycleCurrent(doc))pendingRecycle=null;
        snapshot = next;
        if(pendingDisclosureRefresh){const pending=pendingDisclosureRefresh;if(!doc||actorScope(doc.context)!==pending.scope){pendingDisclosureRefresh=null;}else if(doc.disclosures?.some(offer=>offer.id===pending.directive.catalogId&&offer.revision===pending.directive.revision)){pendingDisclosureRefresh=null;discardForm();openDisclosure(pending.directive.catalogId);}}
        const oldAssistance=previous?.assistance,newAssistance=doc?.assistance;
        if(!newAssistance||!next.connected||oldAssistance&&!sameAssistanceGameScope(oldAssistance.projection.scope,newAssistance.projection.scope)){adviceOpen=false;reactionsOpen=false;inspection=undefined;pendingRefusal=null;lastAdviceId=undefined;}
        if(next.connected&&newAssistance?.projection.advice&&newAssistance.projection.advice.id!==lastAdviceId){lastAdviceId=newAssistance.projection.advice.id;adviceOpen=true;reactionsOpen=false;inspection=undefined;}
        if(inspection&&!newAssistance?.projection.inspections.some(item=>item.cardId===inspection!.cardId&&item.reason===inspection!.reason)){inspection=undefined;pendingRefusal=null;}
        // Form/disclosure callbacks above may synchronously publish a newer
        // document without changing the live view token. Never restore its
        // predecessor's feedback baseline from the outer subscription.
        if(snapshot!==next||session.snapshot().document!==doc)return;
        receivingFeedback=true;try{feedbackController?.receive(surface&&(isPresentationOwnership(next.presentationOwnership,session)||next.presentationOwnership===undefined&&next.connected)?doc?.feedback??null:null);}finally{receivingFeedback=false;}
        attempts = 0;
        if(!doc||!previous||doc.context.session!==previous.context.session||doc.context.audience!==previous.context.audience||!doc.shell){shellPage=undefined;shellSubject=undefined;shellConfirmation=false;commandConfirmation=null;leaveConfirmationFingerprint=null;shellHistory=[];confirmationOpener=null;}
        else if(shellPage&&!doc.shell.pages.some(page=>page.id===shellPage)){shellPage=undefined;shellSubject=undefined;shellConfirmation=false;commandConfirmation=null;leaveConfirmationFingerprint=null;shellHistory=[];}
        else {
            shellHistory=shellHistory.filter(entry=>!entry.page||doc.shell!.pages.some(page=>page.id===entry.page));
            if(commandConfirmation){
                const current=roomShellActions(doc.shell).find(action=>action.id===commandConfirmation!.action.id&&commandFingerprint(doc,action)===commandConfirmation!.fingerprint);
                if(current)commandConfirmation={...commandConfirmation,action:current};
                else {commandConfirmation=null;shellConfirmation=false;focusId=confirmationOpener;confirmationOpener=null;}
            }else if(shellConfirmation&&(!doc.shell.leaveConfirmation||leaveConfirmationFingerprint!==leaveFingerprint(doc))){shellConfirmation=false;leaveConfirmationFingerprint=null;focusId=confirmationOpener;confirmationOpener=null;}
            if(shellPage==='manage'&&!doc.shell.management?.some(group=>sameRoomSubject(group.subject,shellSubject))){
                shellSubject=undefined;shellPage=doc.shell.pages.some(page=>page.id==='people')?'people':undefined;commandConfirmation=null;shellConfirmation=false;
            }
            shellHistory=shellHistory.filter(entry=>entry.page!=='manage'||doc.shell!.management?.some(group=>sameRoomSubject(group.subject,entry.subject)));
            while(shellHistory.length&&shellHistory.at(-1)?.page===shellPage&&(shellPage!=='manage'||sameRoomSubject(shellHistory.at(-1)?.subject,shellSubject)))shellHistory.pop();
        }
        if (!doc || !previous || !sameScope(previous.context, doc.context)||!previousConnected&&next.connected&&!!previous.outcome&&doc.outcome?.id===previous.outcome.id) {
            metrics.clear();
            scoreboardExpanded=false;informationOpen=false;informationOpener=null;scoreboardOpen=false;scoreboardReturnToInformation=false;scoreboardOpener=null;
            decisionDraft=clearDecisionDraft(decisionDraft);cardActionPicker=null;
            // Pending command readiness can be false without revoking the accepted view.
            // Retain public origin facts only through the exact live session lineage.
            const keepNeutralOrigin=!!doc&&!!previous&&ownedFrame&&!!frame&&sameContext(frame.context,previous.context)&&neutralDealOrigin(frame,doc);
            if(!keepNeutralOrigin){essentialMask=null;concealed=null;concealNeedsBegin.clear();frame = null;frameOwnership=undefined;surface?.clear(modalLease());}
            if(!activeForm&&!disclosureView())focusId = null;
            lastFrameId = null;
        }
        if(doc!==previous){
            const sameDraftIdentity=!!previous&&!!doc&&sameScope(previous.context,doc.context)&&previous.participant.id===doc.participant.id&&(previous.participant.role??'player')===(doc.participant.role??'player')&&!!previous.participant.appearance?.vacant===!!doc.participant.appearance?.vacant&&JSON.stringify((previous.opponents??[]).map(person=>[person.id,!!person.appearance?.vacant]))===JSON.stringify((doc.opponents??[]).map(person=>[person.id,!!person.appearance?.vacant]));
            const sameDraftScope=sameDraftIdentity&&(ownedLineage||legacyLineage)&&next.connected;
            // Command recovery can block admission while this exact session
            // still owns the accepted view. Only inert count-card IDs may
            // cross that publication; all executable draft policies stay strict.
            const continuousCountScope=sameDraftIdentity&&(ownedLineage||legacyLineage&&next.connected);
            decisionDraft=doc?reconcileDecisionDraft(tableDecisionInput(doc),decisionDraft,previous?tableDecisionInput(previous):undefined,sameDraftScope,continuousCountScope):clearDecisionDraft(decisionDraft);
        }
        if(doc&&previous&&doc.interaction?.cardActivation!==previous.interaction?.cardActivation){const group=cardDecision(doc.decision);if(group)decisionDraft=resetDecisionGroup(tableDecisionInput(doc),decisionDraft,group.id)??decisionDraft;}
        if(doc&&rebasePicker&&cardActionPicker===pickerBefore&&session.snapshot().document===doc&&pickerBefore!.cards===JSON.stringify(cardIds(doc)))cardActionPicker={...pickerBefore!,document:doc,revision:decisionDraft.revision};
        schedule();
    });
    if(snapshot.document)decisionDraft=reconcileDecisionDraft(tableDecisionInput(snapshot.document),decisionDraft);
    return {
        attach(target: SurfacePort) {
            if (disposed)
                throw new Error('Table disposed');
            if (surface || writers.has(target.identity))
                throw new Error('Surface already has a writer');
            // Font resources may change while detached (no active host listener),
            // and a new adapter can reuse a generation string. Reprepare on attach.
            metrics.clear();
            writers.set(target.identity, owner);
            surface = target;
            mount++;
            generation++;
            attempts = 0;
            const mounted = mount;
            try {
                environment = Object.freeze({ ...target.environment() });
                releaseListen = target.listen({completionFence(frameId,event,active){
                    if(disposed||surface!==target||mount!==mounted||typeof active!=='boolean'||!completion||completion.view.event!==event)return false;
                    const candidate=publishingFrame?.id===frameId?publishingFrame:frame?.id===frameId?frame:null,doc=snapshot.document;
                    if(!candidate||candidate.publicCompletion!==completion.view||!doc||!environment||!completionAuthorityCurrent()||session.snapshot().document!==doc||!currentPublicCompletion(completion.view,doc,publicPaintResources(doc),environment,performance.now()))return false;
                    if(active){if(!completionFrameInputProof(candidate,doc))return false;completion.fenced=true;gesture=null;cancelled=true;return true;}
                    // Release is atomic with the explicit phase-end receipt.
                    return false;
                },completionReady(frameId,event,proof){
                    if(disposed||surface!==target||mount!==mounted||!completion||completion.view.event!==event||!completion.fenced)return false;
                    const candidate=publishingFrame?.id===frameId?publishingFrame:frame?.id===frameId?frame:null,doc=snapshot.document;
                    if(!candidate||candidate.publicCompletion!==completion.view||!doc||!environment||!completionAuthorityCurrent()||session.snapshot().document!==doc||!completionFrameInputProof(candidate,doc)||!currentPublicCompletion(completion.view,doc,publicPaintResources(doc),environment,performance.now()))return false;
                    if(!completionReceive.acknowledge(candidate,proof,doc))return false;
                    completion.acknowledgedFrame=frameId;return true;
                },publicCompletionEnd(frameId,event,outcome){
                    if(disposed||surface!==target||mount!==mounted||!completion||completion.view.event!==event||outcome!=='completed'&&outcome!=='unfulfilled')return false;
                    const candidate=publishingFrame?.id===frameId?publishingFrame:frame?.id===frameId?frame:null;
                    if(!candidate||candidate.publicCompletion!==completion.view||outcome==='completed'&&(!completionAuthorityCurrent()||!snapshot.document||!environment||!currentPublicCompletion(completion.view,snapshot.document,publicPaintResources(snapshot.document),environment,performance.now()))||outcome==='completed'&&(completion.acknowledgedFrame!==frameId||!completion.fenced))return false;
                    retireCompletion(outcome);invalidate();schedule();return true;
                },conceal(frameId,nodeIds,maskOwner){
                    const owned=ownConcealment(frameId,nodeIds,maskOwner);if(!owned||disposed||surface!==target||mount!==mounted)return false;
                    ({frameId,nodeIds,owner:maskOwner}=owned);
                    if(!nodeIds.length){if(!concealed||concealed.owner!==maskOwner||concealed.frameId!==frameId)return false;concealed=null;gesture=null;cancelled=true;return true;}
                    const candidate=publishingFrame?.id===frameId?publishingFrame:frame?.id===frameId?frame:null,doc=snapshot.document;
                    if(!candidate||!doc||session.snapshot().document!==doc||!sameContext(candidate.context,doc.context)||concealed&&concealed.owner!==maskOwner)return false;
                    if(nodeIds.some(id=>{const node=candidate.nodes.find(node=>node.id===id);return node?.kind!=='card'||node.zoneId!=='hand'||!node.entityId||!doc.hand.some(card=>card.id===node.entityId);}))return false;
                    concealed={frameId,owner:maskOwner,ids:new Set(nodeIds)};for(const id of nodeIds)concealNeedsBegin.add(id);gesture=null;cancelled=true;return true;
                },essential(frameId,maskOwner,active){
                    if(disposed||surface!==target||mount!==mounted||!Number.isSafeInteger(frameId)||frameId<1||typeof maskOwner!=='string'||!maskOwner||maskOwner.length>128||typeof active!=='boolean')return false;
                    if(!active){const prior=essentialMask;if(!prior||prior.owner!==maskOwner||frameId!==prior.frameId)return false;essentialMask=null;gesture=null;cancelled=true;return true;}
                    const candidate=publishingFrame?.id===frameId?publishingFrame:frame?.id===frameId?frame:null,doc=snapshot.document;
                    if(!candidate||!doc||session.snapshot().document!==doc||!sameContext(candidate.context,doc.context)||essentialMask&&(essentialMask.owner!==maskOwner||essentialMask.scope!==contextScope(candidate.context)))return false;
                    const recipe=essentialInputMask(candidate);if(candidate.outcomeReadCatalogId!==doc.outcome?.detailsCatalogId||!recipe||recipe.kind==='native-cards'&&(candidate.offerId!==doc.offer.id||nativeCardInputKind(doc,candidate)!=='native-cards'))return false;
                    essentialMask={frameId,owner:maskOwner,ids:new Set(recipe.inputIds),scope:contextScope(candidate.context)};
                    for(const id of recipe.inputIds)concealNeedsBegin.add(id);gesture=null;cancelled=true;return true;
                }, environment(value) { if (disposed || surface !== target || mount !== mounted)
                        return; if(completion)retireCompletion(); if(pendingRecycle&&JSON.stringify(pendingRecycle.environment)!==JSON.stringify(value)&&(pendingRecycle.recovery||!sameBackMotionSpace(pendingRecycle.environment,value)))pendingRecycle=null;const keepBackOrigin=!!frame&&sameBackMotionSpace(frame.environment,value); invalidate(); if(!keepBackOrigin){frame = null;frameOwnership=undefined;} target.invalidate(); environment = Object.freeze({ ...value }); attempts = 0; schedule(); }, intent(value) { if (!disposed && surface === target && mount === mounted)
                        intent(value); },settlement(report){if(!disposed&&surface===target&&mount===mounted)feedbackController?.settle(report);},feedbackPresented(frameId,eventIds){
                    if(disposed||surface!==target||mount!==mounted||frame?.id!==frameId||publishingFrame)return;
                    const allowed=new Set(frame.nodes.filter(node=>node.parent==='table'&&node.publicDisclosureEventId).map(node=>node.publicDisclosureEventId!));
                    if(eventIds.length<=1&&eventIds.every(id=>allowed.has(id)))feedbackController?.presented(frameId,eventIds);
                } });
                receivingFeedback=true;try{feedbackController?.receive((isPresentationOwnership(snapshot.presentationOwnership,session)||snapshot.presentationOwnership===undefined&&snapshot.connected)?snapshot.document?.feedback??null:null);}finally{receivingFeedback=false;}schedule();
            }
            catch (error) {
                this.detach();
                throw error;
            }
        },
        back(){
            const doc=snapshot.document;if(disposed||!surface)return false;if(activeForm){formAction('close');return true;}if(cardActionPicker){closeCardActionPicker();return true;}if(catalogue){closeCatalogue();return true;}if(informationOpen){closeShell();return true;}const viewer=disclosureView();if(viewer){const accepted=disclosure.intent({kind:'back',leaseId:viewer.leaseId});if(accepted){metrics.clear();attempts=0;surface.preserveModal?.(disclosureView()?.leaseId??null);focusId=null;invalidate();schedule();}return true;}if(!doc?.shell||session.snapshot().document!==doc)return false;
            if(closeShell())return true;const action=doc.shell.header.actions.find(action=>action.purpose==='menu'&&action.enabled);
            if(action?.intent.kind!=='open-page')return false;const opener=frame?.nodes.find(node=>node.shellActionId===action.id)?.id??null;openShell(action.intent.page,opener);return true;
        },
        detach() {
            retireCompletion();catalogue=null;cardActionPicker=null;
            pendingRecycle=null;essentialMask=null;motionContinuity++;receivingFeedback=true;try{feedbackController?.receive(null);}finally{receivingFeedback=false;} if (!surface)
            return; const old = surface; invalidate(); mount++; surface = null; frame = null;frameOwnership=undefined; publishingFrame=null;concealed=null;concealNeedsBegin.clear(); focusId = null; lastFrameId = null; environment = null; status = 'detached'; release('listen'); if (writers.get(old.identity) === owner)
            writers.delete(old.identity);closeDisclosure(); discardForm(); old.clear(); },
        dispose() { if (disposed)
            return; disposed = true; disclosure.dispose();feedbackController?.dispose();this.detach(); unsubscribe(); metrics.clear(); decisionDraft=clearDecisionDraft(decisionDraft);cardActionPicker=null; catalogue=null; snapshot = { document: null, connected: false, operations: [] }; status = 'disposed'; },
        inspect() { return Object.freeze({ status,completionOutcome, frame:frame?{...frame,nodes:frame.nodes.map(node=>({...node,...(node.editor?{editor:{...node.editor,value:''}}:{}),...(node.formField?{formField:{...node.formField,value:typeof node.formField.value==='boolean'?false:''}}:{})}))}:frame, focusId,shellPage,shellSubject,shellConfirmation,commandConfirmation:!!commandConfirmation,shellHistoryDepth:shellHistory.length, pending: status === 'measuring' || status === 'preparing', feedbackResources:feedbackController?.inspect(),resourceCount: (feedbackController?.inspect().timers??0)+(feedbackController?.inspect().active??0)+Number(!!releaseListen) + Number(!!releaseMeasure) + Number(measurementDeadline !== null), cacheSize: metrics.size, mountGeneration: mount, candidateGeneration: generation }); },
    };
}
