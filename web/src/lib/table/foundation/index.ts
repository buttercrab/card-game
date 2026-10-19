import type {AssistanceOperation} from './assistance';
import type {FeedbackSink} from './feedback';
import { createCardTable as createRuntime } from './runtime';
import type { SessionPort,HostEffects } from './contracts';
/** Public roots use engine policy; planner injection is internal test infrastructure. */
export const createCardTable = <A>(options: {
    session: SessionPort<A>;
    effects?: HostEffects;
    assistance?:{invoke(operation:AssistanceOperation):boolean};
    feedback?:FeedbackSink;
}) => createRuntime({ session: options.session,effects:options.effects,assistance:options.assistance,feedback:options.feedback });
export { createCardSession } from './session';
export type { BatchSubmission, Submission, SessionPort, ParticipantStatus, StatusPresentation, InformationTone, InformationBadge, InformationAtom, InformationValue, InformationProgress, InformationPanel, Scoreboard, TableDocument, TableCard, FigureAppearance, RevealTransition, DealTransition, CardCollection, OpponentView, Environment, SurfacePort, SurfaceIntent, PresentationFrame } from './contracts';

export type { CardSelectionDecision } from './cardSelection';

export type {RoomShell,RoomShellIntent,RoomShellPageId,PreferenceField,PreferenceValue,PreferenceChange} from './roomShell';
export type {HostEffects} from './contracts';
export type {FormOffer,FormField,FormTarget,FormValue,FormValues,FormEdit,FormReduction,FormAction,FormActionView,FormSection,FormCluster,FormRow,CompositeFormPolicy,FormCompiledAction,FormView,FormPolicy,HostFormPolicy,CommandFormPolicy,NormalizedForm,FormSubmission,FormOperationView,FormCommitPort,FormDraftSnapshot,FormStatus} from './forms';

export type {OutcomeDescriptor} from './outcome';

export type {DisclosureCatalogOffer,DisclosureCatalogPage,DisclosureEntryMetadata,DisclosureContext,DisclosureScope,DisclosureReadPolicy,SyncDisclosureReadPolicy,DisclosureSelectionReceipt,DisclosureFormAction,DisclosureRefresh} from './disclosures';
export type {DisclosureDocument,DisclosureSection,DisclosureCard,DisclosurePerson,DisclosureRound,DisclosurePlay,DisclosureCardRef,DisclosureCardGroup} from './disclosureTypes';

export type {DisclosurePendingRead} from './disclosureSession';

export type {RecycleTransition} from './recycle';

export type {PresentationOwnership} from './presentationOwnership';

export type {ChoiceCatalogue,ChoiceOption,ChoiceField,DecisionSpec} from '../decisionModel';

export type {PhasePresentation,CardSelectionPresentation,SelectionPresentation,PhaseChoiceAtom,PhaseChoiceOption,FiniteChoicePhasePresentation,DecisionPresentation} from './presentationCohort';

export type {FramePaintResources,FramePaintCollection,FramePaintCard} from './paintResources';
export type {PublicCompletionView,PublicCompletionGrant} from './publicCompletion';

export type {DecisionComposition,DecisionGroup,DecisionCommitment} from '../decisionCore';
export type {DecisionCaptionAtom,ChoiceContext} from '../decisionModel';
