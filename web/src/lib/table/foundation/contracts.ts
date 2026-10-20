import type {OwnDockReceiveAllocation} from './ownDockReceive';
import type {CompletionReceiveSource,CompletionReceiveReservation,CompletionReceiveNativeProof} from './completionReceive';
import type {PhasePresentation, SelectionPresentation,DecisionPresentation} from './presentationCohort';
import type {FramePaintResources} from './paintResources';
import type {PublicCompletionView,PublicCompletionGrant,CompletionGameplayRead} from './publicCompletion';
import type {NativeCardPresentation} from './nativeCardPresentation';
import type {PresentationOwnership} from './presentationOwnership';
import type {RecycleTransition,RecycleAdmission} from './recycle';
import type {OutcomeDescriptor} from './outcome';
import type {DisclosureCatalogOffer,DisclosureContext,DisclosureFormAction} from './disclosures';
import type {DisclosureReaderSnapshot} from './disclosureSession';
import type {DisclosureIntent,DisclosureView} from './disclosureView';
import type {AssistanceSnapshot,AssistanceProjection,InspectionPresentation} from './assistance';
import type {FeedbackProjection,FeedbackView,FeedbackClock,FeedbackArrival,FeedbackScope,FeedbackCueKind,MotionSettlement} from './feedback';
import type {FormOffer,FormView,FormOperationView,FormCommitPort,FormDraftSnapshot,FormValue} from './forms';
import type {RoomShell,RoomShellIntent,RoomShellPageId} from './roomShell';
import type {PreferenceField,PreferenceChange} from './roomShell';
import type {RoomOperationSubject} from './roomOperations';
import type { CardVisual, CardEmphasis, Suit } from '../../cardTypes';
import type { ActionOffer } from '../presentation';
import type { ChoiceValues, DecisionSpec } from '../decisionModel';
import type {ComposableDecision,DecisionCommitment} from '../decisionCore';
export interface Size {
    readonly width: number;
    readonly height: number;
}
export interface Rect extends Size {
    readonly x: number;
    readonly y: number;
}
export interface ViewContext {
    readonly session: string;
    readonly audience: string;
    readonly generation: string;
    readonly revision: string;
}
export interface FigureAppearance { readonly bot?: boolean; readonly offline?: boolean; readonly thinking?: boolean; readonly vacant?: boolean; readonly team?: 'declarer'|'friend'|'defense'|null; readonly trumpSuit?: Suit|null; }
export interface TableCard {
    /** Public provenance only; never an opponent private-hand identity. */
    readonly ownerId?: string;
    readonly id: string;
    readonly label: string;
    readonly visual: CardVisual;
    readonly emphasis?: CardEmphasis;
}
export interface CardCollection {
    /** Public collection meaning; the engine chooses the presentation. */
    readonly kind?: 'trick' | 'deck';
    /** Semantic public zone; never supplies geometry or exposes hidden stock. */
    /** Hidden stock discloses a count only, with no card identities/faces. */
    readonly hiddenCount?: number;
    /** Physical lifecycle fact; omission means current inventory. */
    readonly availability?:'current'|'next-deal';
    readonly purpose?: 'stock' | 'play' | 'captured';
    /** Public winner of a captured collection, distinct from card provenance. */
    readonly collectedBy?: string;
    /** Auxiliary public evidence remains accessible without dominating the active board. */
    readonly relevance?: 'primary' | 'auxiliary';
    /** Public zone identifier. `hand` is reserved for TableDocument.hand. */
    readonly id: string;
    readonly label: string;
    readonly cards: readonly TableCard[];
}
export interface OpponentView { readonly id: string; readonly name: string; readonly handCount: number; readonly appearance?: FigureAppearance; readonly status?:ParticipantStatus; }
/** An already-public card newly played from an anonymous counted hand. */
export interface RevealTransition { readonly participantId: string; readonly cardId: string; }
/** Count-reconciled return to a hidden stock; never carries hidden card IDs. */
export interface StockReturnTransition {
    readonly destination: string;
    readonly source: { readonly kind: 'hand' } | { readonly kind: 'participant'; readonly id: string };
}
export interface DealTransition {
    readonly id: string; readonly source: string; readonly cardIds: readonly string[];
    /** Count-only local receipt; mutually exclusive with nonempty cardIds. */
    readonly handCount?: number;
    /** Count-only recipients disclose no card identities. Order is logical dealing order. */
    readonly recipients?: readonly { readonly participantId: string; readonly count: number }[];
}
/** Read-only information, resolved against the same authorized participant registry. */
export type InformationTone = 'accent' | 'gold' | 'danger' | 'plain' | 'muted';
export interface InformationBadge { readonly text: string; readonly tone: InformationTone; }
export type InformationAtom =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'token'; readonly token: string; readonly label: string }
    | { readonly kind: 'number'; readonly value: number }
    | { readonly kind: 'suit'; readonly suit: Suit; readonly label: string }
    | { readonly kind: 'participant'; readonly participantId: string }
    | { readonly kind: 'card'; readonly visual: CardVisual; readonly label: string; readonly emphasis?: CardEmphasis };
export type InformationValue = InformationAtom | { readonly kind: 'inline'; readonly values: readonly InformationAtom[] };
/** Persistent public participant state, separate from expiring reactions/cues. */
export interface ParticipantStatus {readonly purpose?:'standing'|'announcement';readonly value:InformationValue;readonly tone:InformationTone;readonly muted?:boolean;readonly badges?:readonly InformationBadge[];}
/** Exact compact read-only references; complete information remains available. */
export interface StatusPresentation {readonly informationId:string;readonly fieldIds:readonly string[];readonly primary?:boolean;readonly summary?:boolean;readonly progress?:boolean;}
export interface InformationProgress {
    readonly label: string;
    readonly total: number;
    readonly target?: number;
    readonly series: readonly { readonly id: string; readonly label: string; readonly value: number; readonly tone: InformationTone; readonly from: 'start' | 'end' }[];
}
export interface InformationPanel {
    readonly id: string;
    readonly title: string;
    readonly summary?: InformationBadge;
    readonly primary?: { readonly label?: string; readonly value: InformationValue };
    readonly fields: readonly { readonly id: string; readonly label: string; readonly value: InformationValue }[];
    readonly progress?: InformationProgress;
    readonly badges?: readonly InformationBadge[];
}
export interface Scoreboard {
    readonly disclosure?: {readonly openLabel:string;readonly closeLabel:string};
    readonly id: string;
    readonly title: string;
    readonly columns: readonly { readonly id: string; readonly label: string }[];
    readonly rows: readonly { readonly participantId: string; readonly values: readonly (number | null)[]; readonly badges?: readonly InformationBadge[] }[];
}
/** Authorized bounded card-table semantics. The engine owns layout, input and publication. */
export interface TableDocument<A> {
    /** Explicit public presentation stage; omitted legacy documents remain active. */
    readonly stage?:'waiting'|'active';
    /** Public phase caption domain only; never action or draft authority. */
    readonly presentation?:PhasePresentation;
    /** Bounded read grants; providers and received public archives stay host-owned. */
    readonly disclosures?:readonly DisclosureCatalogOffer[];
    readonly disclosureFormActions?:readonly DisclosureFormAction[];
    readonly disclosureContext?:DisclosureContext;
    readonly outcome?:OutcomeDescriptor;
    readonly assistance?:AssistanceSnapshot;
    readonly feedback?:FeedbackProjection;
    readonly statusPresentation?:StatusPresentation;
    /** Host-selected local input policy; game action membership remains canonical. */
    readonly interaction?: { readonly cardActivation: 'single' | 'repeat' };
    readonly context: ViewContext;
    readonly participant: {
        /** Observers have no local player dock or private hand. Defaults to player. */
        readonly role?: 'player' | 'observer';
        readonly id: string;
        readonly name: string;
        readonly markers: readonly string[];
        readonly status?:ParticipantStatus;
        readonly appearance?: FigureAppearance;
    };
    readonly hand: readonly TableCard[];
    /** Clockwise from the local participant; never contains opponent faces/IDs. */
    readonly opponents?: readonly OpponentView[];
    /** Authorized public card groups; no layout or executable meld semantics. */
    readonly collections?: readonly CardCollection[];
    readonly shell?: RoomShell;
    readonly forms?: readonly FormOffer<A>[];
    readonly information?: readonly InformationPanel[];
    readonly scoreboard?: Scoreboard;
    readonly facts: readonly {
        readonly id: string;
        readonly label: string;
        readonly value: string;
        readonly subject: 'table' | 'participant';
        readonly essential: boolean;
    }[];
    readonly decision: ComposableDecision;
    readonly offer: ActionOffer<A>;
    /** Optional authorized deal semantics; never positions or hidden source identities. */
    readonly recycle?:RecycleTransition;
    readonly deals?: readonly DealTransition[];
    readonly stockReturn?: StockReturnTransition;
    readonly reveals?: readonly RevealTransition[];
}
export interface ControlMetrics {
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly fontWeight: number;
    readonly paddingX: number;
    readonly paddingY: number;
    readonly minHeight: number;
    readonly pulse: number;
}
export interface Environment extends Size {
    /** Font-resource generation, independent from allocation/input freshness. */
    readonly fontRevision: string;
    readonly controls: Readonly<Record<'command' | 'choice', ControlMetrics>>;
    readonly revision: string;
    readonly fontFamily: string;
    readonly artFontFamily?: string;
    readonly scrollbarWidth?: number;
    readonly scrollbarHeight?: number;
    readonly textScale: number;
}
export type TextRole = 'announcement' | 'participant-name' | 'body' | 'name' | 'small' | 'button' | 'choice' | 'art' | 'display' | 'compact-display' | 'information-number' | 'information-prose' | 'information-token' | 'select';
export interface MeasureRequest {
    readonly key: string;
    readonly text: string;
    readonly role: TextRole;
    /** null requests max-content width under the SAME font, preserved whitespace
     * and explicit-newline recipe as constrained wrapping. If that intrinsic
     * width fits an allocation, its measured height must remain valid there.
     * Surfaces must not substitute a single-line/nowrap or estimated metric. */
    readonly width: number | null;
    readonly environment: Environment;
}
export interface MeasureReply {
    readonly key: string;
    readonly size: Size;
}
export interface ChoiceView {
    readonly decisionGroupId?:string;
    readonly captionPresentation?:import('./presentationCohort').FiniteGroupPresentation;
    readonly decisionReservations?:readonly import('./presentationCohort').GroupPhasePresentation[];
    readonly groups?:readonly (ChoiceView & {readonly decisionGroupId:string;readonly groupKind:'finite-choice'|'card-selection'})[];
    readonly staged?:boolean;
    readonly finitePresentation?:import('../decisionModel').FiniteChoicePresentation;
    readonly publicCompletion?:PublicCompletionView;
    /** Runtime-issued inert HUD read, never an application payload. */
    readonly publicGameplayRead?:CompletionGameplayRead;
    readonly nativeCardPresentation?:NativeCardPresentation;
    readonly selectionPresentation?:SelectionPresentation;
    /** Public reservation vocabulary only; never live fields or commands. */
    readonly decisionPresentation?:DecisionPresentation;
    readonly catalogue?:{readonly fieldId:string;readonly leaseId:string};
    readonly cardActionPicker?:{readonly leaseId:string};
    readonly disclosure?:DisclosureView;
    readonly outcomeCommands?:ChoiceView['commands'];
    readonly assistance?:{readonly projection:AssistanceProjection;readonly adviceOpen:boolean;readonly reactionsOpen:boolean;readonly inspection?:InspectionPresentation};
    readonly feedback?:FeedbackView;
    readonly form?:FormView;
    readonly shellSubject?: RoomOperationSubject;
    readonly shellCommandConfirmation?: { readonly title: string; readonly message: string; readonly actions: readonly import('./roomShell').RoomShellAction[] };
    readonly shellCommandEnabled?: boolean;
    readonly shellPage?: RoomShellPageId;
    readonly shellConfirmation?: boolean;
    readonly shellLeaveEnabled?: boolean;
    readonly effectsAvailable?: boolean;
    readonly preferencesAvailable?: boolean;
    readonly scoreboardExpanded?: boolean;
    readonly scoreboardOpen?: boolean;
    readonly scoreboardReturnToInformation?: boolean;
    readonly informationOpen?:boolean;
    readonly recyclePresentation?:{readonly source:string;readonly totalCount:number};
    /** Internal complete submit-label envelope; draft changes do not resize controls. */
    readonly selectedLabels?: readonly string[];
    readonly cards?: { readonly actionVariants?:readonly {readonly id:string;readonly label:string;readonly enabled:boolean}[]; readonly selectedActionId?:string; readonly statusLabels?:readonly string[]; readonly batch?:boolean; readonly eligible?:readonly string[]; readonly selected: readonly string[]; readonly available: readonly string[]; readonly label: string; readonly submitLabels: readonly string[] };
    readonly values: ChoiceValues | null;
    readonly fields: readonly {
        readonly id: string;
        readonly label: string;
        readonly catalogue?:import('../decisionModel').ChoiceCatalogue;
        readonly options: readonly {
            readonly id: string;
            readonly label: string;
            readonly enabled: boolean;
            readonly visual?:CardVisual;
            readonly emphasis?:CardEmphasis;
            readonly description?:string;
            readonly caption?:readonly import('../decisionModel').DecisionCaptionAtom[];
        }[];
    }[];
    readonly commands: readonly {
        readonly caption?:readonly import('../decisionModel').DecisionCaptionAtom[];
        readonly id: string;
        readonly label: string;
        readonly intent: 'primary' | 'secondary' | 'quiet' | 'danger';
        readonly enabled: boolean;
    }[];
    readonly selected: {
        readonly caption?:readonly import('../decisionModel').DecisionCaptionAtom[];
        readonly id: string;
        readonly label: string;
        readonly intent: 'primary' | 'secondary' | 'quiet' | 'danger';
        readonly enabled: boolean;
    } | null;
}
export type NodeKind = 'editor' | 'group' | 'text' | 'figure' | 'card' | 'command' | 'choice' | 'suit' | 'progress' | 'select' | 'icon' | 'toggle' | 'range';
export interface PlannedNode {
    readonly choiceCard?:boolean;
    readonly choiceLeaseId?:string;
    readonly catalogueIntent?:{readonly kind:'open'|'close';readonly fieldId:string};
    readonly disclosureIntent?:DisclosureIntent;
    readonly disclosureCatalogId?:string;
    readonly disclosureFormActionId?:string;
    readonly modalLeaseId?:string;
    readonly assistanceIntent?:{readonly kind:'tool';readonly toolId:string;readonly optionId?:string}|{readonly kind:'dismiss-advice'|'dismiss-inspection'|'toggle-reactions'|'close-reactions'};
    /** Engine-only passive timed public artwork; never a command or transfer entity. */
    readonly publicDisclosureEventId?:string;
    readonly feedbackDismissId?:string;
    readonly inspectCardId?:string;
    readonly inspectionPreviewFor?:string;
    readonly hinted?:boolean;
    /** Visual availability is separate from enabled input (a blocked card may explain why). */
    readonly unavailable?:boolean;
    readonly figureCue?:{readonly id:string;readonly kind?:FeedbackCueKind};
    readonly clockPaint?:FeedbackClock;
    readonly clockTextScale?:number;
    readonly editor?:{readonly fieldLeaseId?:string;readonly leaseId:string;readonly fieldId:string;readonly value:string;readonly kind:'text'|'multiline'|'number';readonly maxCodeUnits:number;readonly required?:boolean};
    readonly formIntent?:'submit'|'reset'|'close';
    readonly formActionId?:string;
    readonly formNavigation?:{readonly leaseId:string;readonly sectionId?:string;readonly fieldId?:string;readonly summaryPage?:number};
    readonly formField?:{readonly leaseId:string;readonly fieldId:string;readonly value:FormValue;readonly optionId?:string;readonly operation?:'toggle'|'choose'|'increment'|'decrement'|'reset';readonly fieldLeaseId?:string};
    readonly formLeaseId?:string;
    /** Exact canonical local preference descriptor; never a game/server binding. */
    readonly preference?: PreferenceField;
    readonly id: string;
    readonly parent: string | null;
    /** Coordinates are local to the immediate parent, never another prediction. */
    readonly box: Rect;
    readonly kind: NodeKind;
    readonly label: string;
    readonly accessibleDescription?: string;
    /** Runtime-derived native-card popup semantics; never an executable intent. */
    readonly hasPopup?:'dialog';
    readonly popupExpanded?:boolean;
    readonly role?: TextRole;
    readonly textAlign?: 'start' | 'center' | 'end';
    readonly arrangement?: 'ordinary' | 'fan' | 'overlay';
    /** Engine-only exact joint active-table composition; never a general overlay grant. */
    readonly jointDecisionLayer?:true;
    readonly columnSpan?:number;
    readonly semanticRole?: 'radiogroup' | 'group' | 'dialog' | 'alertdialog' | 'status' | 'tablist' | 'tab' | 'tabpanel' | 'table' | 'row' | 'rowgroup' | 'columnheader' | 'rowheader' | 'cell';
    readonly controlsId?:string;
    /** Internal navigation identity; compatible resize preserves native scroll. */
    readonly scrollResetKey?:string;
    /** Paint-only descendants of an accessible button, positioned by the planner. */
    readonly paintChildren?: boolean;
    readonly shellIcon?: 'menu'|'invite'|'watch'|'book'|'leave'|'close'|'result'|'sliders'|'flag'|'smile'|'hint';
    readonly shellIntent?: RoomShellIntent;
    readonly shellActionId?: string;
    readonly shellSlot?: 'room-code'|'connection-status';
    readonly connectionState?: RoomShell['header']['connection'];
    readonly inert?: boolean;
    readonly decoration?: 'announcement' | 'tray' | 'panel' | 'callout' | 'dialog' | 'pill' | 'prompt' | 'result';
    readonly visual?: CardVisual | { readonly kind: 'back' };
    readonly emphasis?: CardEmphasis;
    readonly tone?: InformationTone;
    readonly deemphasized?:boolean;
    readonly identityMetaFor?:string;
    readonly participantFeedbackFor?:string;
    readonly participantStatusFor?:string;
    /** Engine-only, readonly observer reaction paint; never a scene entity. */
    readonly observerReactionLayer?:true;
    /** Empty measured header space; no input or application-provided box. */
    readonly observerReactionSlot?:true;
    readonly observerReactionSlotId?:string;
    readonly suit?: Suit;
    /** Engine-computed vector geometry within an allocated progress leaf. */
    readonly progressPaint?: { readonly segments: readonly {readonly x:number;readonly width:number;readonly tone:InformationTone}[]; readonly target?: number };
    readonly appearance?: FigureAppearance;
    readonly collectionPurpose?: CardCollection['purpose'];
    readonly collectedBy?: string;
    readonly stockCount?: number;
    /** Engine-measured neutral recollection count, never canonical stock state. */
    readonly recycleAnchor?:{readonly totalCount:number;readonly captionId:string};
    readonly recycleCaption?:string;
    readonly recipientId?: string;
    readonly recipientCount?: number;
    /** Internal counted pickup landmark, derived from this document's own hand. */
    readonly ownHandAnchor?: {readonly participantId:string;readonly count:number};
    /** Engine-only inert public-card destination, one per roster owner/zone. */
    readonly trickSlot?:true;
    readonly intent?: 'primary' | 'secondary' | 'quiet' | 'danger';
    readonly enabled?: boolean;
    readonly checked?: boolean;
    readonly decisionGroupId?:string;
    readonly fieldId?: string;
    readonly optionId?: string;
    /** Engine-owned native selection leaf; all exact options remain available. */
    readonly options?: readonly {readonly id:string;readonly label:string;readonly enabled:boolean}[];
    readonly selectedOptionId?: string;
    readonly localIntent?: 'toggle-scoreboard'|'toggle-information'|'submit-card-set';
    /** Engine card-action draft option; selecting never dispatches its native command. */
    readonly cardActionOptionId?:string;
    readonly cardActionPickerIntent?:{readonly kind:'open'|'close'|'confirm';readonly leaseId?:string};
    readonly actionId?: string;
    readonly cardId?: string;
    /** Authorized presentation identity, separate from an executable card binding. */
    readonly entityId?: string;
    readonly ownerId?: string;
    readonly zoneId?: string;
    readonly scroll?: boolean;
    /** Internal bounded vertical viewport; its one group child owns full content height. */
    readonly scrollAxis?: 'y'|'x';
    /** Internal readonly table overflow; never a live scene/input container. */
    readonly readonlyMatrixViewport?:true;
    readonly scrollbarGutter?: number;
}
export interface CandidateLayout {
    /** Internal measured reservation; never supplied by a game document. */
    readonly primaryViewport?:import('./primaryViewport').PrimaryViewport;
    /** Internal measured game decision lane; applications supply no geometry. */
    readonly decisionLaneId?:string;
    /** Closed engine result panel; suspended only by a current terminal collection. */
    readonly outcomeLaneId?:'outcome';
    readonly modalId?: string;
    readonly deals?: readonly DealTransition[];
    readonly stockReturn?: StockReturnTransition;
    readonly reveals?: readonly RevealTransition[];
    readonly width: number;
    readonly height: number;
    readonly recipe: 'stacked' | 'side-by-side';
    readonly nodes: readonly PlannedNode[];
}
export type LayoutResult = {
    readonly kind: 'ready';
    readonly layout: CandidateLayout;
} | {
    readonly kind: 'needs';
    readonly requests: readonly MeasureRequest[];
} | {
    readonly kind: 'cannot-fit';
    readonly reason: string;
} | {
    readonly kind: 'failed';
    readonly reason: string;
};
export type Planner = <A>(document: TableDocument<A>, environment: Environment, choices: ChoiceView, metrics: ReadonlyMap<string, Size>) => LayoutResult;
export interface PresentationFrame extends CandidateLayout {
    /** Parent-authored current empty-hand column, runtime-owned geometry only. */
    readonly ownDockReceiveAllocation?:OwnDockReceiveAllocation;
    readonly paintResources?:FramePaintResources;
    readonly publicCompletion?:PublicCompletionView;
    /** Current runtime-issued geometry only; never a hand DOM placeholder. */
    readonly completionReceiveReservation?:CompletionReceiveReservation;
    /** Runtime-owned native one-card masking provenance; never application layout authority. */
    readonly essentialInputKind?:'native-cards';
    /** Runtime-owned exact settled read route, never copied from planner metadata. */
    readonly outcomeReadCatalogId?:string;
    /** Internal current-view participant order and count-only recycle proof. */
    readonly rosterIds?:readonly string[];
    readonly recycleAdmission?:RecycleAdmission;
    /** Canonical settled semantics; no private historical face may become a deal source. */
    readonly settled?:boolean;
    readonly feedbackScope?:FeedbackScope;
    readonly feedbackArrivals?:readonly FeedbackArrival[];
    readonly id: number;
    readonly environment: Environment;
    readonly context: ViewContext;
    readonly offerId: string;
    readonly focusId?: string | null;
    /** Explicit engine summary navigation requests native reveal after focus. */
    readonly revealFocusId?:string;
}
export type SurfaceIntent = {readonly kind:'assistance-dismiss';readonly frameId:number}|{readonly kind:'shortcut';readonly frameId:number;readonly key:'H'|'R'} | {readonly kind:'form-field';readonly frameId:number;readonly nodeId:string;readonly value:FormValue} | {readonly kind:'edit';readonly fieldLeaseId?:string;readonly leaseId:string;readonly fieldId:string;readonly value:string;readonly composition:'start'|'update'|'end'|'input'} | {readonly kind:'form';readonly frameId:number;readonly leaseId:string;readonly action:'submit'|'reset'|'close'} | {
    readonly kind: 'preference';
    readonly frameId: number;
    readonly nodeId: string;
    readonly value: PreferenceChange['value'];
} | {
    readonly kind: 'dismiss';
    readonly frameId: number;
} | {
    readonly kind: 'choose';
    /** Native adapter attests an uncaptured assistive-technology change. */
    readonly provenance?:'direct';
    readonly frameId: number;
    readonly nodeId: string;
    readonly optionId: string;
} | {
    readonly kind: 'begin';
    readonly frameId: number;
    readonly nodeId: string;
} | {
    readonly kind: 'activate';
    /** Adapter attests no pending physical down/default action. Test ports must
     * preserve the original binding for physical input; never rebase on publish. */
    readonly provenance?: 'direct';
    readonly frameId: number;
    readonly nodeId: string;
} | {
    readonly kind: 'focus';
    readonly frameId: number;
    readonly nodeId: string | null;
} | {
    readonly kind: 'cancel';
    readonly nodeId?: string;
};
export interface SurfaceCallbacks {
    completionReady?(frameId:number,event:PublicCompletionGrant,proof?:CompletionReceiveNativeProof):boolean;
    completionFence?(frameId:number,event:PublicCompletionGrant,active:boolean):boolean;
    publicCompletionEnd?(frameId:number,event:PublicCompletionGrant,outcome:'completed'|'unfulfilled'):boolean;
    /** Internal presentation restriction only; never grants game authority. */
    conceal?(frameId:number,nodeIds:readonly string[],owner:string):boolean;
    /** Transactional local input/paint barrier, never command authority. */
    essential?(frameId:number,owner:string,active:boolean):boolean;
    settlement?(report:MotionSettlement):void;
    feedbackPresented?(frameId:number,eventIds:readonly string[]):void;
    environment(value: Environment): void;
    intent(value: SurfaceIntent): void;
}
/** Internal host adapter. Applications never receive this port via game props.
 * Physical down/default activation retains its original frame/node through
 * publication, cancellation and release. A standalone AT/native activation may
 * attest provenance:'direct' only when no physical default action owns it.
 * Neither provenance nor a test surface port bypasses canonical frame, modal,
 * offer or session admission checks. */
export interface SurfacePort {
    readonly identity: object;
    environment(): Environment;
    listen(callbacks: SurfaceCallbacks): () => void;
    measure(requests: readonly MeasureRequest[], reply: (values: readonly MeasureReply[]) => void): () => void;
    publish(frame: PresentationFrame): void;
    /** Synchronous native proof of the still-current outgoing own allocation. */
    captureCompletionReceiveSource?(frameId:number,participantId:string):CompletionReceiveSource|null;
    refuse?(nodeId:string):void;
    updateClock?(id:string,fraction:number,secondsLeft:number|null):void;
    preserveEditing?(leaseId:string|null,fieldLeases?:Readonly<Record<string,string>>):void;
    preserveModal?(leaseId:string|null):void;
    disarm(): void;
    /** Hide/inert an incompatible frame; retained leaves remain mount-scoped. */
    invalidate(): void;
    fallback(reason: string): void;
    clear(preserveLease?:string): void;
}
export interface Submission<A> {
    readonly formInstanceId?:string;
    readonly id: string;
    readonly context: ViewContext;
    readonly offerId: string;
    readonly actionId: string;
    readonly action: A;
}
/** One engine-compiled transaction; native actions are never resubmitted alone. */
export interface BatchSubmission<A> {
    readonly id:string;
    readonly context:ViewContext;
    readonly offerId:string;
    readonly actionId:string;
    readonly actions:readonly A[];
}
export type OperationStatus = 'queued' | 'uncertain' | 'accepted' | 'rejected' | 'cancelled' | 'unavailable';
export interface OperationView {
    readonly id: string;
    readonly status: OperationStatus;
    readonly offerId: string;
}
export interface SessionSnapshot<A> {
    /** Accepted-view ownership, independent of command readiness. No command/read authority. */
    readonly presentationOwnership?:PresentationOwnership;
    readonly admissionBlocked?: 'journal-full' | 'awaiting-state';
    readonly document: TableDocument<A> | null;
    readonly connected: boolean;
    readonly operations: readonly OperationView[];
    readonly formOperations?: readonly FormOperationView[];
}
export interface SessionPort<A> {
    readonly disclosures?: {
        page(catalogId:string,page:number):boolean;
        select(catalogId:string,entryId:string):boolean;
        snapshot():DisclosureReaderSnapshot;
        selectionCurrent?(selectionId:string):boolean;
        deselect?():void;
        close():void;
    };
    snapshot(): SessionSnapshot<A>;
    subscribe(listener: (snapshot: SessionSnapshot<A>) => void): () => void;
    bindForm?(instanceId:string,read:()=>FormDraftSnapshot|null):FormCommitPort;
    admitDecision(expectedDocument:TableDocument<A>,request:{readonly decisionId:string;readonly groupId:string|null;readonly commitment:DecisionCommitment<A>}):boolean;
    admit(context: ViewContext, offerId: string, actionId: string, action: A): boolean;
    admitCardSet?(context:ViewContext,offerId:string,selectedCardIds:readonly string[]):boolean;
}

/** Narrow user-activation effects supplied only by the connected host. */
export interface HostEffects {
    invoke(effect:'share-room'|'leave-room',context:ViewContext):void;
    formClosed?(context:ViewContext):void;
    changePreference?(change:PreferenceChange,context:ViewContext):void;
}
