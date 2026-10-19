/** Contract-only proposal. No production renderer/server imports this directory. */
export type Intent = 'primary' | 'secondary' | 'quiet' | 'danger';
export interface Command<A> { kind: 'command'; id: string; label?: string; enabled: boolean; intent: Intent; action: A }
export type NumberDomain =
  | { kind: 'discrete'; values: readonly number[]; min?: never; max?: never; step?: never; origin?: never }
  | { kind: 'stepped'; min: number; max: number; step: number; origin: number; values?: never };
export interface NumberAction<A> { kind: 'number'; id: string; enabled: boolean; intent: Intent; domain: NumberDomain; createAction: (value: number) => A }
export interface Offer<A> { id: string; actions: readonly (Command<A> | NumberAction<A>)[] }
interface Base { id: string; commands: readonly string[] }
interface ChoiceField { id: string; options: readonly { id: string; label?: string; enabled: boolean }[] }
export type Tuple = Readonly<Record<string, string>>;
export type Decision = Base & (
  | { kind: 'commands'; fields?: never; variants?: never; initialValues?: never; initial?: never; reconciliation?: never; submit?: never; numberAction?: never }
  | { kind: 'finite-choice'; fields: readonly ChoiceField[]; variants: readonly { tuple: Tuple; actionId: string }[]; initialValues: Tuple; reconciliation: 'reset-to-defaults' | 'preserve-compatible'; submit: { unavailable: 'disabled' | 'hidden' }; numberAction?: never }
  | { kind: 'number'; numberAction: string; initial: number; fields?: never; variants?: never; initialValues?: never; reconciliation?: never; submit?: never }
);
/** Scope rotates on viewer/authorization changes; server internals are never refs. */
export interface CardRef { scope: string; handle: string }
export type ViewerCard =
  | { kind: 'face'; ref: CardRef; face: string }
  | { kind: 'tracked-back'; ref: CardRef; face?: never }
  | { kind: 'anonymous-back'; ref?: never; face?: never };
export type PileSummary =
  | { kind: 'known-count'; count: number }
  | { kind: 'unknown-count'; count?: never };
export interface CardGroup { id: string; zone: string; cards: readonly CardRef[] }
/** Structured selection is a prototype, deliberately outside executable V1 Decision. */
export interface StructuredCandidate {
  cards: readonly CardRef[]; // order is meaningful and preserved
  target: { kind: 'group-end'; group: string; end: 'start' | 'end' } | { kind: 'zone'; zone: string };
  wildcardRoles: readonly { card: CardRef; represents: string }[];
  choice?: { suit: string };
}
export interface CandidateContext { projectionScope: string; privacyScopeGeneration: string; presentation: string; environment: string; draftId: string; attempt: string; opportunityId: string; offerId: string; windowId?: string }
export type Evaluation =
  | { kind: 'ready'; context: CandidateContext; candidateToken: string }
  | { kind: 'pending'; context: CandidateContext; candidateToken?: never }
  | { kind: 'failed'; context: CandidateContext; reason: string; candidateToken?: never };
export interface Opportunity { id: string; offerId: string; windowId?: string }
export interface Pool { id: string; amount: number; eligibleSeats: readonly string[] }
export interface Award { poolId: string; seat: string; amount: number }
/** First migration surface. NumberDecision remains a gated contract experiment. */
export type PublicDecisionV1 = Exclude<Decision, { kind: 'number' }>;
export type NumberDecisionPrototype = Extract<Decision, { kind: 'number' }>;
