import {validateDecisionDescriptor,DECISION_DESCRIPTOR_LIMITS} from '../decisionDescriptor';
import {ownComposableDecision,normalizeDecision,decisionGroups,cardDecision,resolveDecisionCommitment,type DecisionCommitment} from '../decisionCore';
import {ownPhasePresentation,validateDecisionPresentation,validateSelectionPresentation,validateTableCollectionSelection} from './presentationCohort';
import {ownFiniteChoicePresentation} from '../decisionModel';
import {ownDocumentRoot} from './documentRoot';
import {issuePresentationOwnership,revokePresentationOwnership,isPresentationOwnership,type PresentationOwnership} from './presentationOwnership';
import {ownParticipantStatus,ownStatusPresentation} from './statusPresentation';
import {ownRecycleTransition} from './recycle';
import {createDisclosureReader} from './disclosureSession';
import {ownDisclosureData,ownDisclosureOffer,ownDisclosureFormActions,ownDisclosureRefresh,disclosureScopeCurrent,type DisclosureReadPolicy,type DisclosureContext,type DisclosureScope,type DisclosureCatalogOffer,type DisclosureSelectionReceipt,type DisclosureRefresh} from './disclosures';
import {ownOutcome} from './outcome';
import {ownDocumentAssistance} from './assistance';
import {ownFeedback} from './feedback';
import {validateFormOffer,validateFormValues,validateFormRawShape,ownFormEdit,ownFormReduction,ownCompiledAction,formEditIdentity,normalizeFormActions,formAction,copyFormData,ownFormDraft,ownNormalizedForm,ownCompiledForm,type FormPolicy,type FormSubmission,type FormStatus,type FormDraftSnapshot,type FormCommitPort,type FormOffer} from './forms';
import {validateRoomShell} from './roomShell';
import {validateInformation} from './information';
import {MAX_DEAL_TRANSFERS} from './transferPolicy';
import {validateTableDecision,tableDecisionInput} from './decisions';
import {selectedCardCommands} from './cardSelection';
import type { OperationStatus, SessionPort, SessionSnapshot, Submission, BatchSubmission, TableDocument, ViewContext, FigureAppearance } from './contracts';
export const sameContext = (a: ViewContext, b: ViewContext): boolean => a.session === b.session && a.audience === b.audience && a.generation === b.generation && a.revision === b.revision;
export const sameScope = (a: ViewContext, b: ViewContext): boolean => a.session === b.session && a.audience === b.audience && a.generation === b.generation;
const scopeKey = (context: ViewContext): string => JSON.stringify([context.session, context.audience, context.generation]);
interface FormSourceOwner {sourceId?:string;instanceId:string;signature:string;revoked:boolean;authorityRevision:number;basis:string|null;retired:boolean;draftBasis:string|null;draftRetired:boolean;retirePrivate?:()=>void;}
interface Operation<A> {
    formInstanceId?:string;
    formActionId?:string;
    draftRevision?:number;
    expectedResult?:unknown;
    formAuthority?:{owner:FormSourceOwner;revision:number;epoch:number};
    id: string;
    status: OperationStatus;
    offerId: string;
    scope: string;
    submission: Submission<A> | BatchSubmission<A> | null;
}
/** In-memory admission journal. No durable receipt or server permission guarantee. */
export function createCardSession<A>(options: {
    transport: (submission: Submission<A>) => void;
    batchTransport?: (submission:BatchSubmission<A>) => void;
    maxOperations?: number;
    formPolicies?:readonly FormPolicy<A>[];
    formTransport?:(submission:FormSubmission)=>void;
    disclosurePolicies?:readonly DisclosureReadPolicy[];
    disclosureSelectionChanged?:(selection:DisclosureSelectionReceipt|null)=>void;
    disclosureCurrent?:(context:DisclosureContext)=>boolean;
    disclosureRetainedCurrent?:(scope:DisclosureScope)=>boolean;
}) {
    const limit = options.maxOperations ?? 128;
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error('Invalid operation limit');
    let document: TableDocument<A> | null = null, connected = true, fresh = true, awaitingState = false, disposed = false, next = 0;
    let disclosureEpoch=0;
    const disclosurePolicies=Object.freeze([...(options.disclosurePolicies??[])]),disclosurePolicyIds=new Set(disclosurePolicies.map(policy=>policy.id));
    const disclosureReader=createDisclosureReader({policies:disclosurePolicies,isCurrent:options.disclosureCurrent,isRetainedCurrent:options.disclosureRetainedCurrent,onSelectionChanged:options.disclosureSelectionChanged,onChange:()=>{if(!disposed)notify();},readCurrent:()=>!disposed&&document?.disclosures&&document.disclosureContext?{offers:document.disclosures,context:document.disclosureContext,epoch:disclosureEpoch,readable:fresh&&!awaitingState}:null});
    const disclosurePort=Object.freeze({page:(catalogId:string,page:number)=>disclosureReader.page(catalogId,page),select:(catalogId:string,entryId:string)=>disclosureReader.select(catalogId,entryId),snapshot:()=>disclosureReader.snapshot(),selectionCurrent:(selectionId:string)=>disclosureReader.selectionCurrent(selectionId),close:()=>disclosureReader.revoke(),deselect:()=>disclosureReader.deselect()});
    let closeUnresolved: number | null = null;
    const formPolicies=new Map((options.formPolicies??[]).map(policy=>[policy.id,policy]));
    if(formPolicies.size!==(options.formPolicies??[]).length)throw new Error('Duplicate form policy');
    const formOperations:{id:string;instanceId:string;status:FormStatus;scope:string;submission:FormSubmission|null;actionId?:string;draftRevision?:number;message?:string;attempted?:boolean;refreshDisclosure?:DisclosureRefresh;access?:FormOffer['access'];owner?:FormSourceOwner;identity?:Readonly<{formId:string;offerInstanceId:string;policyId:string;actionId:string;operationId?:string}>}[]=[];
    const formSources=new Set<FormSourceOwner>();let formCommitting=false,formEpoch=0;
    const formScope=(context:ViewContext)=>JSON.stringify([context.session,context.audience]);
    // Retained display is insufficient for a local mutation.
    const formAccessCurrent=(offer:FormOffer<A>):boolean=>{
        const capturedDocument=document;if(disposed||!fresh||awaitingState||!capturedDocument)return false;
        if(!offer.access)return connected;
        const policy=formPolicies.get(offer.policyId);
        if(policy?.kind==='command'||policy?.kind==='actions'||policy?.access!=='disclosure-selection'||!disclosureReader.selectionCurrent(offer.access.selectionId))return false;
        const receipt=disclosureReader.snapshot().selection;
        return document===capturedDocument&&!!receipt&&capturedDocument.disclosureFormActions?.some(action=>action.selectionId===receipt.id&&action.catalogId===receipt.catalogId&&action.catalogRevision===receipt.revision&&action.entryId===receipt.entryId&&action.formId===offer.id&&action.formInstanceId===offer.instanceId)===true;
    };
    const revokeForms=()=>{formEpoch++;for(const owner of formSources){owner.revoked=true;owner.retired=true;owner.draftRetired=true;owner.signature='';owner.basis=null;owner.draftBasis=null;owner.retirePrivate?.();}formSources.clear();for(const op of formOperations){if(op.status==='queued')op.status='cancelled';op.submission=null;op.owner=undefined;op.identity=undefined;op.access=undefined;op.refreshDisclosure=undefined;op.scope='';}};
    let presentationOwnership:PresentationOwnership|undefined,presentationAuthority=0;
    const retirePresentation=()=>{presentationAuthority++;const token=presentationOwnership;presentationOwnership=undefined;revokePresentationOwnership(token);};
    const operations: Operation<A>[] = [], listeners = new Set<(snapshot: SessionSnapshot<A>) => void>();
    // Keep unresolved evidence and the current offer's execution fence. Older
    // terminal entries are a bounded UI journal, not the server's dedup ledger.
    const reclaim = (current: TableDocument<A> | null) => {
        while (operations.length >= limit) {
            const index = operations.findIndex(op => !['queued', 'uncertain'].includes(op.status) &&
                (op.status === 'rejected' || op.status === 'cancelled' || !current || op.scope !== scopeKey(current.context) || op.offerId !== current.offer.id));
            if (index < 0) break;
            operations.splice(index, 1);
        }
    };
    const snapshot = (): SessionSnapshot<A> => Object.freeze({...(document&&fresh&&!disposed&&isPresentationOwnership(presentationOwnership)?{presentationOwnership}:{}),formOperations:Object.freeze([...operations.filter(op=>document&&op.scope===scopeKey(document.context)&&op.formInstanceId).map(op=>Object.freeze({id:op.id,instanceId:op.formInstanceId!,actionId:op.formActionId,draftRevision:op.draftRevision,status:op.status==='uncertain'?'sending' as const:op.status==='unavailable'?'uncertain' as const:op.status})),...formOperations.filter(op=>document&&op.scope===formScope(document.context)).map(({id,instanceId,status,actionId,draftRevision,message,attempted,refreshDisclosure,identity})=>Object.freeze({id,instanceId,status,actionId,draftRevision,message,attempted,refreshDisclosure,formId:identity?.formId,offerInstanceId:identity?.offerInstanceId}))]), ...(operations.length>=limit?{admissionBlocked:'journal-full' as const}:awaitingState?{admissionBlocked:'awaiting-state' as const}:{}), document, connected: connected && fresh && !disposed, operations: Object.freeze(operations.filter(op => document !== null && op.scope === scopeKey(document.context)).map(({ id, status, offerId }) => Object.freeze({ id, status, offerId }))) });
    let delivering = false, pending = false, notificationRevision = 0, overflow = false;
    const deliver = () => { const revision = notificationRevision; for (const listener of [...listeners]) {
        if (revision !== notificationRevision)
            break;
        try {
            listener(snapshot());
        }
        catch { /* One consumer cannot prevent revocation reaching others. */ }
    } };
    const notify = () => {
        if (overflow)
            return;
        notificationRevision++;
        pending = true;
        if (delivering)
            return;
        delivering = true;
        try {
            let passes = 0;
            while (pending) {
                pending = false;
                deliver();
                if (++passes >= 32 && pending) {
                    // A reentrant consumer cannot keep a private view alive indefinitely.
                    overflow = true;
                    retirePresentation();
                    document = null;
                    fresh = false;
                    revokeOperations();
                    notificationRevision++;
                    pending = false;
                    deliver();
                    overflow = false;
                    break;
                }
            }
        }
        finally {
            delivering = false;
            // Nested disposal queues a final null view. Keep its recipients
            // registered until that terminal delivery has actually drained.
            if (disposed) listeners.clear();
        }
    };
    const revokePrivateOperations = () => { revokeForms(); for (const op of operations) {
        if (op.status === 'queued')
            op.status = 'cancelled';
        op.submission = null;
        op.expectedResult=undefined;op.formAuthority=undefined;
        op.offerId = '';
        op.scope = '';
    } };
    const revokeOperations=()=>{disclosureEpoch++;disclosureReader.revoke();revokePrivateOperations();};
    // This callback is constructed outside admit: it captures only the journal record,
    // whose payload is nullable and synchronously cleared by revocation.
    const enqueue = (op: Operation<A>) => queueMicrotask(() => transmit(op));
    const transmit = (op: Operation<A>) => {
        if (disposed || op.status !== 'queued' || !op.submission)
            return;
        if (!connected || !fresh || awaitingState || !document || !sameScope(op.submission.context, document.context) || op.formAuthority&&(op.formAuthority.owner.revoked||op.formAuthority.owner.authorityRevision!==op.formAuthority.revision||op.formAuthority.epoch!==formEpoch)) {
            op.status = 'cancelled';
            op.submission = null;
            notify();
            return;
        }
        op.status = 'uncertain';
        notify();
        // Notification can synchronously revoke the authenticated context. Read the
        // journal again instead of retaining a private payload across notification.
        if (disposed || !connected || !fresh || awaitingState || !op.submission || !document || !sameScope(op.submission.context, document.context) || op.formAuthority&&(op.formAuthority.owner.revoked||op.formAuthority.owner.authorityRevision!==op.formAuthority.revision||op.formAuthority.epoch!==formEpoch)) {
            if (op.status === 'uncertain') op.status = 'cancelled';
            op.submission = null;
            notify();
            return;
        }
        try {
            if('actions'in op.submission)options.batchTransport?.(op.submission);else options.transport(op.submission);
        }
        catch { /* Transmission may have happened: remain uncertain. */ }
        finally { op.submission = null; /* Recovery retains metadata, never this private payload. */ }
    };
    const recordSubmission=(doc:TableDocument<A>,context:ViewContext,offerId:string,actionId:string,execution:{readonly action:A}|{readonly actions:readonly A[]},formInstanceId?:string,formAuthority?:Operation<A>['formAuthority'],formActionId?:string,draftRevision?:number,expectedResult?:unknown):boolean=>{
        if(disposed||overflow||!connected||!fresh||awaitingState||document!==doc||!sameContext(doc.context,context)||doc.offer.id!==offerId||operations.length>=limit)return false;
        const scope=scopeKey(context);
        if(operations.some(op=>op.scope===scope&&op.offerId===offerId&&['queued','uncertain','accepted','unavailable'].includes(op.status)))return false;
        const submission=Object.freeze({id:`operation-${++next}`,context:Object.freeze({...context}),offerId,actionId,...execution,...(formInstanceId?{formInstanceId}:{})});
        const op:Operation<A>={id:submission.id,status:'queued',scope,offerId,submission,formInstanceId,formAuthority,formActionId,draftRevision,expectedResult};operations.push(op);notify();enqueue(op);return true;
    };
    const recordCommand=(doc:TableDocument<A>,context:ViewContext,offerId:string,actionId:string,action:A,formInstanceId?:string,formAuthority?:Operation<A>['formAuthority'],formActionId?:string,draftRevision?:number,expectedResult?:unknown)=>recordSubmission(doc,context,offerId,actionId,{action},formInstanceId,formAuthority,formActionId,draftRevision,expectedResult);
    const editIdentity=formEditIdentity<A>;
    const draftIdentity=(offer:FormOffer<A>)=>JSON.stringify([offer.id,offer.instanceId,offer.schemaVersion,offer.policyId,offer.editBinding,offer.binding,offer.fields.map(field=>({...field,initial:undefined})),offer.sections,offer.clusters,offer.rows,normalizeFormActions(offer).filter(action=>action.basis==='draft').map(action=>({...action,target:action.target.kind==='host'?{kind:'host',operationId:action.target.operationId??null}:{kind:'command',actionId:action.target.actionId}}))]);
    const api = {
        snapshot,
        disclosures:disclosurePort,
        subscribe(listener: (snapshot: SessionSnapshot<A>) => void) { if (disposed)
            return () => { }; listeners.add(listener); return () => { listeners.delete(listener); }; },
        receive(value: TableDocument<A>, admission?: {connected: boolean}) {
            if (disposed || overflow)
                return;
            const ingressAuthority=presentationAuthority,ingressDocument=document,ingressNotice=notificationRevision;
            value=ownDocumentRoot(value);
            // Decision consumers (shell, outcome, assistance and capacity checks)
            // only see owned inert data. Reflect before any discriminant read.
            validateDecisionDescriptor(value.decision);
            const decision=deepFreeze(ownComposableDecision(structuredClone(value.decision)));
            value=Object.freeze({...value,decision,...(decision.kind==='composition'?{offer:ownCompositionOffer(value.offer)}:{})});
            const contextDescriptor=Object.getOwnPropertyDescriptor(value,'context');
            if(!contextDescriptor||!('value'in contextDescriptor))throw Error('Invalid view context property');
            let admissionConnected:boolean|undefined;
            if(admission!==undefined){if(!admission||typeof admission!=='object'||Array.isArray(admission))throw Error('Invalid admission connectivity');const keys=Reflect.ownKeys(admission);if(keys.length!==1||keys[0]!=='connected')throw Error('Invalid admission connectivity');const descriptor=Object.getOwnPropertyDescriptor(admission,'connected');if(!descriptor||!('value'in descriptor)||!descriptor.enumerable||typeof descriptor.value!=='boolean')throw Error('Invalid admission connectivity');admissionConnected=descriptor.value;}
            // Inspect new root properties without invoking accessors before any canonical mutation.
            const catalogDescriptor=Object.getOwnPropertyDescriptor(value,'disclosures'),catalogContextDescriptor=Object.getOwnPropertyDescriptor(value,'disclosureContext');
            let disclosures:readonly DisclosureCatalogOffer[]|undefined,disclosureContext:DisclosureContext|undefined;
            if(catalogDescriptor||catalogContextDescriptor){
                if(!catalogDescriptor||!catalogContextDescriptor||!('value'in catalogDescriptor)||!('value'in catalogContextDescriptor)||!catalogDescriptor.enumerable||!catalogContextDescriptor.enumerable)throw Error('Invalid disclosure registry properties');
                const registry=ownDisclosureData({offers:catalogDescriptor.value as readonly DisclosureCatalogOffer[],context:catalogContextDescriptor.value as DisclosureContext});
                if(!Array.isArray(registry.offers)||registry.offers.length>8||new Set(registry.offers.map(offer=>offer.id)).size!==registry.offers.length)throw Error('Invalid disclosure registry');
                const context=registry.context,keys=['roomId','roomEpoch','actorId','connectionEpoch','audience'];
                if(!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).length!==5||Object.keys(context).some(key=>!keys.includes(key))||keys.some(key=>typeof context[key as keyof DisclosureContext]!=='string'||!context[key as keyof DisclosureContext].trim()||context[key as keyof DisclosureContext].length>2048))throw Error('Invalid disclosure context');
                const sceneDescriptor=Object.getOwnPropertyDescriptor(value,'context');if(!sceneDescriptor||!('value'in sceneDescriptor))throw Error('Invalid disclosure audience context');
                const scene=ownDisclosureData(sceneDescriptor.value as ViewContext);
                if(context.audience!==scene.audience)throw Error('Foreign disclosure audience');
                disclosures=Object.freeze(registry.offers.map(offer=>{const owned=ownDisclosureOffer(offer);if(!disclosurePolicyIds.has(owned.policyId)||!disclosureScopeCurrent(owned.scope,context))throw Error('Foreign disclosure catalog policy or scope');return owned;}));
                disclosureContext=context;
            }
            const recycleDescriptor=Object.getOwnPropertyDescriptor(value,'recycle');
            if(recycleDescriptor&&!('value'in recycleDescriptor))throw Error('Invalid recycle descriptor');
            const recycle=recycleDescriptor?.value===undefined?undefined:ownRecycleTransition(recycleDescriptor.value);
            const stageDescriptor=Object.getOwnPropertyDescriptor(value,'stage');
            if(stageDescriptor&&(!('value'in stageDescriptor)||stageDescriptor.value!==undefined&&stageDescriptor.value!=='waiting'&&stageDescriptor.value!=='active'))throw new Error('Invalid table stage');
            if(stageDescriptor?.value==='waiting'&&(value.hand.length>0||value.outcome!==undefined||recycle!==undefined||!!value.deals?.length||!!value.reveals?.length||value.stockReturn!==undefined||value.collections?.some(collection=>collection.cards.length>0)))throw new Error('Waiting table cannot contain active hand presentation');
            // Status payloads are separately owned; inspect every optional property
            // before spreading participant records or reading their value.
            const statusProperty=(source:object,key:string):unknown=>{const descriptor=Object.getOwnPropertyDescriptor(source,key);if(descriptor&&(!('value'in descriptor)||!descriptor.enumerable))throw Error('Invalid readonly status property');return descriptor?.value;};
            const participantSource=statusProperty(value,'participant') as TableDocument<A>['participant'];
            const opponentSource=statusProperty(value,'opponents') as TableDocument<A>['opponents'];
            const rawParticipantStatus=statusProperty(participantSource,'status'),rawStatusPresentation=statusProperty(value,'statusPresentation');
            if(opponentSource!==undefined&&(!Array.isArray(opponentSource)||opponentSource.length>8))throw Error('Invalid status participant registry');
            const rawOpponentStatuses=opponentSource===undefined?[]:Array.from({length:opponentSource.length},(_,index)=>{const descriptor=Object.getOwnPropertyDescriptor(opponentSource,String(index));if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)throw Error('Invalid status participant registry');return statusProperty(descriptor.value,'status');});
            if(value.interaction!==undefined){
                validateWire(value.interaction);
                if(!value.interaction||Array.isArray(value.interaction)||Object.keys(value.interaction).some(key=>key!=='cardActivation')||!['single','repeat'].includes(value.interaction.cardActivation))throw new Error('Invalid card activation policy');
            }
            if(value.forms!==undefined){validateWire(value.forms);if(!Array.isArray(value.forms)||value.forms.length>40||JSON.stringify(value.forms).length>262144||new Set(value.forms.map(form=>form.id)).size!==value.forms.length||new Set(value.forms.map(form=>form.instanceId)).size!==value.forms.length)throw new Error('Invalid form registry');for(const form of value.forms){validateFormOffer(form);const policy=formPolicies.get(form.policyId);if(!policy||((policy.kind===undefined||policy.kind==='host')&&policy.access==='disclosure-selection')!==!!form.access||form.access&&(policy.kind==='command'||policy.kind==='actions'||policy.access!=='disclosure-selection')||(policy.kind==='actions'?!form.actions:(form.target?.kind??'host')!==(policy.kind??'host'))||normalizeFormActions(form).some(action=>action.target.kind==='host')&&!options.formTransport)throw new Error('Unknown form policy');}}
            const formActionIds=(value.forms??[]).flatMap(form=>normalizeFormActions(form).flatMap(action=>action.target.kind==='command'?[action.target.actionId]:[]));
            if(new Set(formActionIds).size!==formActionIds.length||formActionIds.some(id=>value.offer.actions.some(action=>action.id===id)))throw new Error('Duplicate command form action identity');
            if(value.shell!==undefined){validateWire(value.shell);validateRoomShell(value.shell,value);}
            if(value.information!==undefined)validateWire(value.information);
            if(value.scoreboard!==undefined)validateWire(value.scoreboard);
            validateInformation(value);
            const participantStatus=rawParticipantStatus===undefined?undefined:ownParticipantStatus(rawParticipantStatus,value);
            const opponentStatuses=rawOpponentStatuses.map(status=>status===undefined?undefined:ownParticipantStatus(status,value));
            const statusPresentation=rawStatusPresentation===undefined?undefined:ownStatusPresentation(rawStatusPresentation,value);

            if(value.decision.kind==='composition'&&value.offer.actions.length>DECISION_DESCRIPTOR_LIMITS.actions)throw Error('Decision offer exceeds supported action bound');
            for (const action of value.offer.actions) {
                if (action.kind !== 'command')
                    throw new Error('Only immutable command payloads are supported');
                validateWire(action);if(action.cardIds!==undefined&&(!Array.isArray(action.cardIds)||action.cardIds.length>104||new Set(action.cardIds).size!==action.cardIds.length||action.cardIds.some(id=>typeof id!=='string'||!value.hand.some(card=>card.id===id))))throw Error('Foreign command hand reference');
            }
            if(value.participant.role==='observer'&&decisionGroups(decision).length)throw Error('Observer cannot receive active decision groups');
            if(value.participant.role!==undefined&&!['player','observer'].includes(value.participant.role)||value.participant.role==='observer'&&value.hand.length)throw new Error('Invalid observer hand');
            for (const zone of value.collections ?? []) if (zone.hiddenCount !== undefined &&
                (zone.purpose !== 'stock' || zone.cards.length || !Number.isSafeInteger(zone.hiddenCount) || zone.hiddenCount < 0 || zone.hiddenCount > 10000)) throw new Error('Invalid count-only stock');
            if (value.opponents && (value.opponents.length>8 || new Set(value.opponents.map(item=>item.id)).size!==value.opponents.length || value.opponents.some(item=>typeof item.id!=='string' || !item.id || item.id===value.participant.id || typeof item.name!=='string' || !item.name || item.name.length>1000 || !Number.isSafeInteger(item.handCount) || item.handCount<0 || item.handCount>10000))) throw new Error('Invalid count-only participants');
            const participants=new Set([...(value.participant.role==='observer'?[]:[value.participant.id]),...(value.opponents??[]).map(person=>person.id)]);
            if(value.hand.some(card=>card.ownerId!==undefined&&card.ownerId!==value.participant.id))throw new Error('Invalid private card owner');
            for(const zone of value.collections??[]){
                if(zone.id==='hand')throw new Error('Reserved private hand collection id');
                const availability=Object.getOwnPropertyDescriptor(zone,'availability');
                if(availability&&(!('value'in availability)||!availability.enumerable)||!availability&&'availability'in zone)throw Error('Invalid collection availability property');
                if(availability&&availability.value!==undefined&&(availability.value!=='current'&&availability.value!=='next-deal'||availability.value==='next-deal'&&(!value.outcome||zone.purpose!=='stock'||zone.kind!=='deck'||zone.cards.length||zone.hiddenCount===undefined)))throw Error('Invalid collection availability');
                const winner=Object.getOwnPropertyDescriptor(zone,'collectedBy');
                if(winner&&(!('value'in winner)||!winner.enumerable)||!winner&&'collectedBy'in zone)throw new Error('Invalid captured collection winner property');
                if(winner&&winner.value!==undefined&&(zone.purpose!=='captured'||typeof winner.value!=='string'||!winner.value.trim()||!participants.has(winner.value)))throw new Error('Invalid captured collection winner');
                if(zone.relevance!==undefined&&!['primary','auxiliary'].includes(zone.relevance))throw new Error('Invalid collection relevance');
                if(zone.cards.some(card=>card.ownerId!==undefined&&!participants.has(card.ownerId)))throw new Error('Unknown public card owner');
                if(zone.kind==='trick'&&(zone.purpose!=='play'||zone.hiddenCount!==undefined||zone.cards.some(card=>!card.ownerId)||new Set(zone.cards.map(card=>card.ownerId)).size!==zone.cards.length))throw new Error('Invalid public trick');
                if(zone.kind==='deck'&&(zone.purpose!=='stock'||zone.hiddenCount===undefined)||zone.kind!==undefined&&!['trick','deck'].includes(zone.kind))throw new Error('Invalid collection kind');
            }
            if (value.deals) {
                validateWire(value.deals);
                if (value.deals.length>1 || value.deals.some(deal=>{
                    const recipients=deal.recipients??[];
                    const local=deal.handCount??deal.cardIds.length;
                    const total=local+recipients.reduce((sum,item)=>sum+item.count,0);
                    return !deal.id || !deal.source || total<1 || total>MAX_DEAL_TRANSFERS || !Number.isSafeInteger(local)||local<0||local>MAX_DEAL_TRANSFERS||(deal.handCount!==undefined&&deal.cardIds.length>0)||new Set(deal.cardIds).size!==deal.cardIds.length || deal.cardIds.some(id=>typeof id!=='string'||!id) || recipients.length>8 || new Set(recipients.map(item=>item.participantId)).size!==recipients.length || recipients.some(item=>typeof item.participantId!=='string'||!item.participantId||!Number.isSafeInteger(item.count)||item.count<1||item.count>MAX_DEAL_TRANSFERS||!value.opponents?.some(person=>person.id===item.participantId));
                })) throw new Error('Invalid bounded deal hint');
            }
            if(recycle&&(value.stage==='waiting'||value.outcome||value.stockReturn||value.reveals?.length||value.deals?.length!==1||value.deals[0].source!==recycle.source||!value.collections?.some(zone=>zone.id===recycle.source&&zone.purpose==='stock'&&zone.hiddenCount!==undefined)||recycle.previousGeneration===value.context.generation))throw Error('Invalid recycle reference');
            if(value.stockReturn){
                const hint=value.stockReturn;
                validateWire(hint);
                if(!value.collections?.some(zone=>zone.id===hint.destination&&zone.purpose==='stock'&&zone.hiddenCount!==undefined)||
                    !(hint.source.kind==='hand'||hint.source.kind==='participant'&&value.opponents?.some(person=>hint.source.kind==='participant'&&person.id===hint.source.id)))throw new Error('Invalid hidden stock return');
            }
            if(value.reveals){
                for(const hint of value.reveals)for(const zone of value.collections??[])for(const card of zone.cards)if(card.id===hint.cardId&&card.ownerId!==undefined&&card.ownerId!==hint.participantId)throw new Error('Reveal owner mismatch');
                if((value.reveals.length&&value.deals?.length)||value.reveals.length>16||new Set(value.reveals.map(hint=>hint.cardId)).size!==value.reveals.length||value.reveals.some(hint=>!hint.participantId||!hint.cardId||!value.opponents?.some(person=>person.id===hint.participantId)||!value.collections?.some(zone=>(zone.purpose==='play'||zone.purpose==='captured')&&zone.cards.some(card=>card.id===hint.cardId))))throw new Error('Invalid public reveal hint');
            }
            const outcome=value.outcome?deepFreeze(ownOutcome(value.outcome,value)):undefined;
            const assistance=value.assistance?ownDocumentAssistance(value.assistance,value):undefined;
            const feedbackParticipants=[...(value.participant.role==='observer'?[]:[value.participant.id]),...(value.opponents??[]).filter(person=>!person.appearance?.vacant).map(person=>person.id),...(value.shell?.pages??[]).flatMap(page=>page.people?.map(person=>person.id)??[])];
            const feedbackEntities=[...value.hand.map(card=>card.id),...(value.collections??[]).flatMap(collection=>collection.cards.map(card=>card.id))];
            const feedback=value.feedback?ownFeedback(value.feedback,value.context,feedbackParticipants,feedbackEntities):undefined;
            if(feedback?.clock?.local&&(value.participant.role==='observer'||feedback.clock.participantId!==value.participant.id))throw Error('Foreign local clock');
            // Copy inert wire data into canonical immutable session ownership.
            if(value.decision.kind==='composition'&&normalizeDecision(tableDecisionInput(value)).errors.length)throw Error('Invalid decision composition');
            if('presentation'in value.decision&&value.decision.presentation!==undefined){if(value.decision.kind!=='finite-choice'||value.decision.fields.some(field=>field.catalogue))throw Error('Incompatible finite presentation');ownFiniteChoicePresentation(value.decision.presentation);}
            if(decision.kind==='composition'&&normalizeDecision({decision,offer:value.offer,handIds:value.hand.map(card=>card.id)}).errors.length)throw Error('Invalid decision composition');
            const disclosureFormActions=value.disclosureFormActions===undefined?undefined:ownDisclosureFormActions(value.disclosureFormActions,disclosures??[],value.forms??[]);
            for(const link of disclosureFormActions??[]){const form=value.forms?.find(form=>form.id===link.formId&&form.instanceId===link.formInstanceId);if(!form?.access||form.purpose!=='confirmation'||form.access.selectionId!==link.selectionId)throw Error('Foreign disclosure form action');}
            for(const form of value.forms??[])if(form.access&&!disclosureFormActions?.some(action=>action.formId===form.id&&action.formInstanceId===form.instanceId&&action.selectionId===form.access!.selectionId))throw Error('Unbound disclosure form');
            const presentation=value.presentation===undefined?undefined:ownPhasePresentation(value.presentation);
            validateSelectionPresentation(presentation,value);
            validateDecisionPresentation(presentation,value);
            validateTableCollectionSelection(presentation,value);
            const nextDocument = Object.freeze({ ...value,...(presentation?{presentation}:{}),...(statusPresentation?{statusPresentation}:{}),...(recycle?{recycle}:{}),...(disclosureFormActions?{disclosureFormActions}:{}),...(disclosures?{disclosures,disclosureContext}:{}),...(outcome?{outcome}:{}),...(assistance?{assistance}:{}),...(feedback?{feedback}:{}), ...(value.forms?{forms:Object.freeze(value.forms.map(form=>validateFormOffer<A>(form)))}:{}), ...(value.interaction?{interaction:Object.freeze({cardActivation:value.interaction.cardActivation})}:{}), ...(value.shell?{shell:deepFreeze(structuredClone(value.shell))}:{}), ...(value.information?{information:deepFreeze(structuredClone(value.information))}:{}), ...(value.scoreboard?{scoreboard:deepFreeze(structuredClone(value.scoreboard))}:{}), context: Object.freeze({ ...value.context }), participant: Object.freeze({id:value.participant.id,name:value.participant.name,...(value.participant.role!==undefined?{role:value.participant.role}:{}),...(participantStatus?{status:participantStatus}:{}), ...(value.participant.appearance?{appearance:ownAppearance(value.participant.appearance)}:{}), markers: Object.freeze([...value.participant.markers]) }), hand: deepFreeze(structuredClone(value.hand)), ...(value.opponents ? {opponents:Object.freeze(value.opponents.map(({id,name,handCount,appearance},index)=>Object.freeze({id,name,handCount,...(opponentStatuses[index]?{status:opponentStatuses[index]}:{}),...(appearance?{appearance:ownAppearance(appearance)}:{})})))} : {}), ...(value.collections ? { collections: deepFreeze(structuredClone(value.collections)) } : {}), ...(value.deals ? { deals: deepFreeze(structuredClone(value.deals)) } : {}), ...(value.stockReturn?{stockReturn:deepFreeze({destination:value.stockReturn.destination,source:value.stockReturn.source.kind==='hand'?{kind:'hand' as const}:{kind:'participant' as const,id:value.stockReturn.source.id}})}:{}), ...(value.reveals?{reveals:Object.freeze(value.reveals.map(({participantId,cardId})=>Object.freeze({participantId,cardId})))}:{}), facts: Object.freeze(value.facts.map(fact => Object.freeze({id:fact.id,label:fact.label,value:fact.value,subject:fact.subject,essential:fact.essential}))), decision: deepFreeze(decision), offer: Object.freeze({id:value.offer.id, actions: Object.freeze(value.offer.actions.map(action => Object.freeze({ ...action,...(action.kind==='command'&&action.cardIds?{cardIds:Object.freeze([...action.cardIds])}:{}), ...(action.kind === 'command' ? { action: deepFreeze(structuredClone(action.action)) } : {}) }))) }) });
            if(disposed||overflow||presentationAuthority!==ingressAuthority||document!==ingressDocument||notificationRevision!==ingressNotice)return;
            const priorDocument=ingressDocument,priorNotice=ingressNotice;
            const sameOwner=!!document&&fresh&&isPresentationOwnership(presentationOwnership)&&document.context.session===nextDocument.context.session&&document.context.audience===nextDocument.context.audience&&document.participant.id===nextDocument.participant.id&&(document.participant.role??'player')===(nextDocument.participant.role??'player');
            if(!sameOwner)retirePresentation();
            const commitAuthority=presentationAuthority;
            if (document && !sameScope(document.context, nextDocument.context)) {
                // Game authority can change while same-actor local form editing survives.
                const compatibleForms=formScope(document.context)===formScope(nextDocument.context);
                if(!compatibleForms)revokeForms();
                for(const op of operations){if(op.status==='queued')op.status='cancelled';op.submission=null;op.expectedResult=undefined;op.formAuthority=undefined;op.offerId='';op.scope='';}
            }
            for(const source of formSources){const candidate=nextDocument.forms?.find(form=>form.instanceId===source.instanceId);if(!candidate||draftIdentity(candidate)!==source.draftBasis)source.draftRetired=true;if(!candidate||editIdentity(candidate)!==source.basis){source.retired=true;source.revoked=true;}else if(JSON.stringify(candidate)!==source.signature)source.revoked=true;}
            if(disposed||overflow||presentationAuthority!==commitAuthority||document!==priorDocument||notificationRevision!==priorNotice)return;
            document = nextDocument;disclosureEpoch++;
            if(!isPresentationOwnership(presentationOwnership))presentationOwnership=issuePresentationOwnership(api);
            if (admissionConnected!==undefined) connected = admissionConnected;
            reclaim(document);
            fresh = true; awaitingState=false;
            notify();
        },
        awaitState() {
            if(disposed||overflow||awaitingState)return;
            awaitingState=true;
            for(const op of operations)if(op.status==='queued'){op.status='cancelled';op.submission=null;}
            notify();
        },
        setConnected(value: boolean) { if (disposed || overflow)
            return; if (!value){retirePresentation();fresh = false;} connected = value; notify(); },
        revoke() { if(disposed||overflow)return;
            retirePresentation();
            if(!document&&!fresh){disclosureEpoch++;if(disclosureReader.revoke())notify();return;}
            document=null;fresh=false;awaitingState=false;revokeOperations();notify();
        },
        revokeGameView(){
            if(disposed||overflow)return;
            retirePresentation();
            const notice=notificationRevision;document=null;fresh=false;awaitingState=false;const epoch=++disclosureEpoch;revokePrivateOperations();
            if(!disposed&&disclosureEpoch===epoch)disclosureReader.retainPublic();
            // A synchronous native guard may have received/revoked/disposed the
            // session. That newer canonical publication always wins.
            if(disposed)return;
            if(disclosureEpoch!==epoch){if(!document&&notificationRevision===notice)notify();return;}
            notify();
        },
        bindForm(instanceId:string,read:()=>FormDraftSnapshot|null):FormCommitPort {
            if(disposed||formSources.size>=16)throw new Error('Form source unavailable');
            let initialOffer=document?.forms?.find(form=>form.instanceId===instanceId);let capturedOffer=initialOffer;
            let sourceOffer=JSON.stringify(initialOffer),basis=initialOffer?editIdentity(initialOffer):null;
            const owner:FormSourceOwner={instanceId,signature:sourceOffer,revoked:false,authorityRevision:0,basis,retired:false,draftBasis:initialOffer?draftIdentity(initialOffer):null,draftRetired:false},origin=document?formScope(document.context):null;
            owner.retirePrivate=()=>{capturedOffer=undefined;sourceOffer='';basis=null;};initialOffer=undefined;
            let active=true;formSources.add(owner);const sourceEpoch=formEpoch,sourceInstance=`form-instance-${++next}`;owner.sourceId=sourceInstance;
            const alive=()=>active&&!disposed&&!overflow&&sourceEpoch===formEpoch&&!!document&&formScope(document.context)===origin;
            const unchanged=(source:FormDraftSnapshot|null,signature:string)=>{try{const latest=read();return latest===source&&JSON.stringify(ownFormDraft(latest))===signature;}catch{return false;}};
            return {instanceId:sourceInstance,
            matchesResult(candidate){if(formCommitting)return false;formCommitting=true;try{const policy=capturedOffer&&formPolicies.get(capturedOffer.policyId),startingDocument=document,startingRevision=owner.authorityRevision,startingOffer=capturedOffer;if(!alive()||(policy?.kind!=='actions'&&policy?.kind!=='command')||!policy.matchesResult)return false;const ownedCandidate=validateFormOffer(candidate as FormOffer<A>);const result=operations.some(op=>op.formInstanceId===sourceInstance&&op.expectedResult!==undefined&&['queued','uncertain','accepted','unavailable'].includes(op.status)&&policy.matchesResult!(ownedCandidate,op.expectedResult)===true);return result&&alive()&&document===startingDocument&&owner.authorityRevision===startingRevision&&capturedOffer===startingOffer;}catch{return false;}finally{formCommitting=false;}},
            reduce(edit){
                if(formCommitting||!alive()||!capturedOffer)return null;formCommitting=true;
                try{const startingDocument=document,startingRevision=owner.authorityRevision,offer=capturedOffer,policy=formPolicies.get(offer.policyId),source=read(),draft=ownFormDraft(source),signature=JSON.stringify(draft);validateFormRawShape(offer,draft.values);const intent=ownFormEdit(offer,edit);
                    let result;
                    if(policy?.kind==='actions')result=ownFormReduction(offer,policy.reduce(offer,draft.values,intent));
                    else {const values=intent.kind==='initialize'?draft.values:intent.kind==='reset-all'?Object.fromEntries(offer.fields.map(field=>[field.id,field.initial])):intent.kind==='reset-field'?{...draft.values,[intent.fieldId]:offer.fields.find(field=>field.id===intent.fieldId)!.initial}:{...draft.values,[intent.fieldId]:intent.value};result=ownFormReduction(offer,{values,visibility:{},enabled:{},issues:validateFormValues(offer,values),changedFields:offer.fields.filter(field=>values[field.id]!==draft.values[field.id]).map(field=>field.id)});}
                    return alive()&&document===startingDocument&&owner.authorityRevision===startingRevision&&capturedOffer===offer&&unchanged(source,signature)?result:null;
                }catch{return null;}finally{formCommitting=false;}
            },
            renew(context,formId){
                const current=document?.forms?.find(form=>form.id===formId&&form.instanceId===instanceId);
                if(!alive()||!document||!sameContext(document.context,context)||!current)return false;
                // An independent local action may renew while the captured room
                // comparison base remains conflicted. Never adopt its new model.
                if(owner.retired){
                    if(!owner.draftRetired&&capturedOffer&&draftIdentity(current)===owner.draftBasis&&capturedOffer.actions){
                        const actions=capturedOffer.actions.map(action=>{const latest=current.actions?.find(candidate=>candidate.id===action.id);return action.basis==='draft'&&action.target.kind==='host'&&latest?.target.kind==='host'?{...action,target:latest.target}:action;});
                        if(JSON.stringify(actions)!==JSON.stringify(capturedOffer.actions)){capturedOffer=validateFormOffer({...capturedOffer,actions});owner.authorityRevision++;}
                    }return false;
                }
                if(editIdentity(current)!==basis)return false;
                const signature=JSON.stringify(current);if(owner.revoked||signature!==sourceOffer){owner.authorityRevision++;sourceOffer=signature;owner.signature=signature;owner.revoked=false;}capturedOffer=current;return true;
            },dispose(){active=false;owner.revoked=true;owner.retired=true;owner.authorityRevision++;owner.signature='';owner.basis=null;owner.draftBasis=null;owner.retirePrivate?.();formSources.delete(owner);},
            commit(context,formId,actionId){
                if(formCommitting)return false;formCommitting=true;try{
                const doc=document,current=doc?.forms?.find(form=>form.id===formId&&form.instanceId===instanceId);
                if(!alive()||!doc||!fresh||awaitingState||!sameContext(doc.context,context)||!capturedOffer||!current?.enabled)return false;
                const declared=formAction(capturedOffer,actionId);if(!declared)return false;
                const draftBasis=declared.basis==='draft'&&declared.target.kind==='host';if(draftBasis&&owner.draftRetired)return false;
                const offer=draftBasis?capturedOffer:current;
                if(!formAccessCurrent(offer))return false;
                if(!draftBasis&&(owner.revoked||owner.retired||JSON.stringify(offer)!==sourceOffer))return false;
                const selected=formAction(offer,declared.id),policy=formPolicies.get(offer.policyId);if(!selected||!policy||selected.target.kind==='host'&&!options.formTransport)return false;
                const authorityRevision=owner.authorityRevision;
                let source:FormDraftSnapshot|null,ownedSource:FormDraftSnapshot;
                try{source=read();ownedSource=ownFormDraft(source);validateFormRawShape(offer,ownedSource.values);}catch{return false;}
                if(!source||ownedSource.composing)return false;const sourceSignature=JSON.stringify(ownedSource);
                let payload:unknown=null,command:{action:A;actionId:string}|null=null,expectedResult:unknown;
                try{
                    const normalized=ownNormalizedForm(offer,policy.normalize(offer,ownedSource.values));
                    if(Object.keys(normalized.issues).length||Object.keys(validateFormValues(offer,normalized.values)).length)return false;
                    if(policy.kind==='actions'){
                        const compiled=ownCompiledAction<A>(policy.compile(offer,normalized.values,selected.id));
                        if(compiled.kind!==selected.target.kind||policy.validateCompiled(offer,compiled,selected.id)!==true)return false;
                        if(compiled.kind==='command'&&selected.target.kind==='command'){command={action:compiled.action,actionId:selected.target.actionId};if(policy.expectedResult)expectedResult=copyFormData(policy.expectedResult(offer,compiled.action));}else if(compiled.kind==='host')payload=compiled.payload;
                    }else if(policy.kind==='command'){
                        if(selected.target.kind!=='command')return false;const compiled=policy.compile(offer,normalized.values);validateWire(compiled);const action=deepFreeze(structuredClone(compiled));if(JSON.stringify(action).length>65536||policy.validateCompiled(offer,action)!==true)return false;command={action,actionId:selected.target.actionId};if(policy.expectedResult)expectedResult=copyFormData(policy.expectedResult(offer,action));
                    }else payload=ownCompiledForm(policy.compile(offer,normalized.values));
                }catch{return false;}
                if(!alive()||!draftBasis&&(owner.revoked||owner.authorityRevision!==authorityRevision)||document!==doc||!unchanged(source,sourceSignature)||!formAccessCurrent(offer)||document!==doc||!doc.forms?.includes(current))return false;
                if(offer.retry==='new-offer'&&formOperations.some(op=>op.scope===origin&&op.identity?.formId===offer.id&&op.identity.offerInstanceId===offer.instanceId&&op.actionId===selected.id&&(op.attempted||['queued','sending','uncertain'].includes(op.status))))return false;
                const blocked=(status:string,revision:number|undefined)=>['queued','sending','uncertain'].includes(status)||selected.completion==='lock'&&['accepted','processed','stored','unavailable'].includes(status)||selected.completion==='continue'&&revision===ownedSource.revision&&['accepted','processed','stored','unavailable'].includes(status);
                if(operations.some(op=>op.formInstanceId===sourceInstance&&op.formActionId===selected.id&&blocked(op.status,op.draftRevision))||formOperations.some(op=>op.scope===origin&&op.instanceId===sourceInstance&&op.actionId===selected.id&&blocked(op.status,op.draftRevision)))return false;
                if(command)return recordCommand(doc,context,doc.offer.id,command.actionId,command.action,sourceInstance,{owner,revision:authorityRevision,epoch:sourceEpoch},selected.id,ownedSource.revision,expectedResult);
                if(payload===null)return false;
                while(formOperations.length>=limit){const index=formOperations.findIndex(op=>!['queued','sending','uncertain'].includes(op.status)&&!(op.attempted&&op.identity&&document?.forms?.some(current=>current.retry==='new-offer'&&current.id===op.identity!.formId&&current.instanceId===op.identity!.offerInstanceId)));if(index<0)return false;formOperations.splice(index,1);}
                const submission=deepFreeze({id:`form-operation-${++next}`,instanceId:sourceInstance,offerInstanceId:offer.instanceId,formId:offer.id,policyId:offer.policyId,context:{...context},binding:structuredClone(offer.binding),payload,...(offer.access?{access:offer.access}:{}),actionId:selected.id,...(selected.target.kind==='host'&&selected.target.operationId?{operationId:selected.target.operationId}:{})});
                const op={id:submission.id,instanceId:sourceInstance,status:'queued' as FormStatus,scope:origin!,submission:submission as FormSubmission|null,actionId:selected.id,draftRevision:ownedSource.revision,access:offer.access,attempted:false,refreshDisclosure:undefined as DisclosureRefresh|undefined,owner,identity:Object.freeze({formId:offer.id,offerInstanceId:offer.instanceId,policyId:offer.policyId,actionId:selected.id,...(submission.operationId?{operationId:submission.operationId}:{})})};formOperations.push(op);notify();
                const authorityValid=()=>{
                    const captured=document;
                    if(!alive()||draftBasis&&owner.draftRetired||!captured||!formAccessCurrent(offer)||document!==captured||!alive())return false;
                    const current=captured.forms?.find(form=>form.id===formId&&form.instanceId===instanceId&&form.enabled);
                    return !!current&&(draftBasis?JSON.stringify(formAction(current,selected.id)?.target)===JSON.stringify(selected.target):!owner.revoked&&owner.authorityRevision===authorityRevision&&JSON.stringify(current)===JSON.stringify(offer));
                };
                queueMicrotask(()=>{if(disposed||op.status!=='queued'||!op.submission)return;if(!authorityValid()){op.status='cancelled';op.submission=null;notify();return;}op.status='sending';notify();if(!op.submission||!authorityValid()){op.status='cancelled';op.submission=null;notify();return;}const sending=op.submission;op.submission=null;op.attempted=true;try{options.formTransport!(sending);}catch{op.status='uncertain';notify();}});return true;
                }finally{formCommitting=false;}
            }};
        },
        isCurrentFormSubmission(submission:Pick<FormSubmission,'id'|'instanceId'|'formId'|'offerInstanceId'|'policyId'|'actionId'|'operationId'>):boolean {
            try{const value=copyFormData(submission),op=formOperations.find(operation=>operation.id===value.id),owner=op?.owner;
                if(disposed||overflow||!document||!fresh||awaitingState||!op||!owner||!formSources.has(owner)||owner.draftRetired||owner.sourceId!==value.instanceId||op.instanceId!==value.instanceId||op.scope!==formScope(document.context)||!['sending','uncertain','stored','processed'].includes(op.status)||!op.identity)return false;
                if(op.identity.formId!==value.formId||op.identity.offerInstanceId!==value.offerInstanceId||op.identity.policyId!==value.policyId||op.identity.actionId!==value.actionId||op.identity.operationId!==value.operationId)return false;
                const current=document.forms?.find(form=>form.id===value.formId&&form.instanceId===value.offerInstanceId&&form.policyId===value.policyId),action=current&&formAction(current,value.actionId);const captured=document;return !!current?.enabled&&formAccessCurrent(current)&&document===captured&&formSources.has(owner)&&!owner.draftRetired&&!owner.retired&&action?.target.kind==='host'&&action.target.operationId===value.operationId;
            }catch{return false;}
        },
        resolveForm(id:string,status:FormStatus,message?:string,refreshDisclosure?:DisclosureRefresh){
            if(disposed||overflow||!['processed','rejected','uncertain','stored','failed','conflict','unsupported'].includes(status)||message!==undefined&&(typeof message!=='string'||message.length>500))return false;const op=formOperations.find(op=>op.id===id);
            if(!op||!['sending','uncertain'].includes(op.status))return false;
            // A stale optional read continuation must not erase a known IO
            // outcome. It grants no mutation and can be safely omitted.
            if(refreshDisclosure!==undefined&&status==='stored')try{
                const refresh=ownDisclosureRefresh(refreshDisclosure),captured=document,owner=op.owner,identity=op.identity;
                const current=captured?.forms?.find(form=>form.id===identity?.formId&&form.instanceId===identity?.offerInstanceId);
                if(op.access&&refresh.selectionId===op.access.selectionId&&owner&&identity&&current&&op.attempted&&formSources.has(owner)&&!owner.retired&&formAccessCurrent(current)&&document===captured){
                    const receipt=disclosureReader.snapshot().selection;
                    if(!owner.retired&&formSources.has(owner)&&receipt&&receipt.id===refresh.selectionId&&receipt.catalogId===refresh.catalogId&&receipt.revision!==refresh.revision)op.refreshDisclosure=refresh;
                }
            }catch{/* Stored remains stored; a new explicit read can refresh it. */}

            op.status=status;op.message=message;notify();return true;
        },
        admitDecision(expectedDocument:TableDocument<A>,request:{readonly decisionId:string;readonly groupId:string|null;readonly commitment:DecisionCommitment<A>}):boolean {
            const doc=document;
            if(disposed||overflow||!connected||!fresh||awaitingState||!doc||doc!==expectedDocument||validateTableDecision(doc).length)return false;
            if(!request||typeof request!=='object'||Array.isArray(request)||![Object.prototype,null].includes(Object.getPrototypeOf(request)))return false;
            const descriptors=Object.getOwnPropertyDescriptors(request),required=['decisionId','groupId','commitment'];
            if(Reflect.ownKeys(descriptors).length!==required.length||required.some(key=>!descriptors[key]||!('value'in descriptors[key])||!descriptors[key].enumerable))return false;
            const decisionId=descriptors.decisionId.value,groupId=descriptors.groupId.value,raw=descriptors.commitment.value;
            if(doc.participant.role==='observer'&&groupId!==null)return false;
            if(decisionId!==doc.decision.id||groupId!==null&&typeof groupId!=='string'||!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return false;
            const fields=Object.getOwnPropertyDescriptors(raw),kind=fields.kind?.value,keys=kind==='command'?['kind','actionId','action']:kind==='card-set'?['kind','cardIds']:[];
            if(!keys.length||Reflect.ownKeys(fields).length!==keys.length||keys.some(key=>!fields[key]||!('value'in fields[key])||!fields[key].enumerable))return false;
            let commit:DecisionCommitment<A>;
            if(kind==='card-set'){try{validateWire(fields.cardIds.value);const ids=fields.cardIds.value;if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||id.length>2048))return false;commit=Object.freeze({kind:'card-set',cardIds:Object.freeze([...ids])});}catch{return false;}}
            else {if(typeof fields.actionId.value!=='string')return false;commit=Object.freeze({kind:'command',actionId:fields.actionId.value,action:fields.action.value});}
            const commands=resolveDecisionCommitment(tableDecisionInput(doc),groupId,commit);
            if(!commands||document!==doc)return false;
            return commit.kind==='card-set'?!!options.batchTransport&&recordSubmission(doc,doc.context,doc.offer.id,groupId!,{actions:Object.freeze(commands.map(command=>command.action))}):recordCommand(doc,doc.context,doc.offer.id,commands[0].id,commands[0].action);
        },
        admit(context:ViewContext,offerId:string,actionId:string,action:A):boolean {
            const doc=document;if(!doc||!sameContext(doc.context,context)||doc.offer.id!==offerId)return false;
            const owner=normalizeDecision(tableDecisionInput(doc)).value?.bindings[actionId];
            return owner!==undefined&&api.admitDecision(doc,{decisionId:doc.decision.id,groupId:owner,commitment:{kind:'command',actionId,action}});
        },
        admitCardSet(context:ViewContext,offerId:string,selectedCardIds:readonly string[]):boolean {
            const doc=document,group=doc&&cardDecision(doc.decision);if(!doc||!group||!sameContext(doc.context,context)||doc.offer.id!==offerId)return false;
            return api.admitDecision(doc,{decisionId:doc.decision.id,groupId:group.id,commitment:{kind:'card-set',cardIds:selectedCardIds}});
        },
        resolve(id: string, status: 'accepted' | 'rejected' | 'unavailable') { if (disposed || overflow)
            return false; const op = operations.find(item => item.id === id); if (!op || op.status !== 'uncertain')
            return false; op.status = status; op.submission = null; reclaim(document); notify(); return true; },
        dispose() {
            if (disposed) return Object.freeze({ unresolved: closeUnresolved ?? 0 });
            const ownerScope = document ? scopeKey(document.context) : null;
            closeUnresolved = operations.filter(op => op.scope === ownerScope && op.status === 'uncertain').length;
            disposed = true;
            retirePresentation();
            disclosureReader.dispose();
            document = null;
            revokeOperations();
            // During terminal redaction notify is fenced, but disposal must
            // still be terminal. It cannot invalidate that null-view delivery.
            notify();
            return Object.freeze({ unresolved: closeUnresolved });
        },
    };
    return api satisfies SessionPort<A>;
}
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value))
        deepFreeze(child);
} return value; }
/** Accept only inert JSON-like wire values, before taking immutable ownership. */
function validateWire(value: unknown, ancestors = new Set<object>(), budget = { nodes: 0 }, depth = 0): void {
    if (++budget.nodes > 10000 || depth > 64)
        throw new Error('Action payload exceeds wire bounds');
    if (typeof value === 'string' && value.length > 100000)
        throw new Error('Action string exceeds wire bounds');
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number' && Number.isFinite(value))
        return;
    if (typeof value !== 'object' || !value)
        throw new Error('Action payload must be plain finite wire data');
    if (ancestors.has(value))
        throw new Error('Cyclic action payload');
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
        throw new Error('Non-plain action payload');
    if (Array.isArray(value)) {
        if (value.length > 10000)
            throw new Error('Array exceeds wire bounds');
        for (let index = 0; index < value.length; index++)
            if (!Object.hasOwn(value, index))
                throw new Error('Sparse wire array');
    }
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === 'length')
            continue;
        if (typeof key !== 'string' || (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))
            throw new Error('Invalid wire property');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
            throw new Error('Action accessors are not supported');
        validateWire(descriptor.value, ancestors, budget, depth + 1);
    }
    ancestors.delete(value);
}

function ownAppearance(value: FigureAppearance): FigureAppearance {
    return Object.freeze({bot:value.bot===true,offline:value.offline===true,thinking:value.thinking===true,vacant:value.vacant===true,
        team:value.team==='declarer'||value.team==='friend'||value.team==='defense'?value.team:null,
        trumpSuit:['Spade','Heart','Diamond','Club'].includes(value.trumpSuit??'')?value.trumpSuit:null});
}

/** New compositions own their whole offer before any dependent consumer reads
 * it. Payload limits remain per action; there is deliberately no aggregate
 * 10000-node offer walk. Legacy offers keep their existing ingress contract. */
function ownCompositionOffer<A>(input:TableDocument<A>['offer']):TableDocument<A>['offer']{
 const fail=():never=>{throw Error('Invalid composition offer');};
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return fail();
 const root=Object.getOwnPropertyDescriptors(input);if(Reflect.ownKeys(root).length!==2||!['id','actions'].every(key=>root[key]&&'value'in root[key]&&root[key].enumerable))return fail();
 const id=root.id.value,raw=root.actions.value;if(typeof id!=='string'||!id.trim()||id.length>2048||!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype)return fail();
 const descriptors=Object.getOwnPropertyDescriptors(raw),length=Object.getOwnPropertyDescriptor(raw,'length')?.value;
 if(!Number.isSafeInteger(length)||length<0||length>DECISION_DESCRIPTOR_LIMITS.actions||Reflect.ownKeys(descriptors).length!==length+1)return fail();
 const actions:TableDocument<A>['offer']['actions'][number][]=[];
 for(let index=0;index<length;index++){
  const entry=descriptors[String(index)];if(!entry||!('value'in entry)||!entry.enumerable)return fail();
  validateWire(entry.value);
  const action=structuredClone(entry.value);if(!action||typeof action!=='object'||Array.isArray(action)||action.kind!=='command'||!Object.hasOwn(action,'action')||typeof action.id!=='string'||!action.id.trim()||action.id.length>2048||typeof action.label!=='string'||!action.label.trim()||action.label.length>2048||typeof action.enabled!=='boolean'||!['primary','secondary','quiet','danger'].includes(action.intent)||action.reason!==undefined&&(typeof action.reason!=='string'||action.reason.length>1000))return fail();
  actions.push(deepFreeze(action));
 }
 return Object.freeze({id,actions:Object.freeze(actions)});
}
