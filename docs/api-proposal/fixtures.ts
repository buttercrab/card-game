import type { Decision, Offer, StructuredCandidate, Opportunity, Pool, Award, ViewerCard, PileSummary, Evaluation } from './contracts.ts';
export const mightyOffer: Offer<string> = { id:'mighty:7', actions:[
  ...['s14','s15','h15'].map(id => ({kind:'command' as const,id,enabled:true,intent:'primary' as const,action:id})),
  {kind:'command', id:'joker-spade',enabled:true,intent:'quiet',action:'play-joker-as-spade'},
  {kind:'command', id:'pass',enabled:true,intent:'secondary',action:'pass'},
] };
export const mighty: Extract<Decision,{kind:'finite-choice'}> = {
  id:'bid',kind:'finite-choice',reconciliation:'preserve-compatible',submit:{unavailable:'disabled'},commands:['pass'],
  fields:[{id:'suit',options:[{id:'spade',enabled:true},{id:'heart',enabled:true}]},{id:'count',options:[{id:'14',enabled:true},{id:'15',enabled:true}]}],
  variants:[{tuple:{suit:'spade',count:'14'},actionId:'s14'},{tuple:{suit:'spade',count:'15'},actionId:'s15'},{tuple:{suit:'heart',count:'15'},actionId:'h15'}],
  initialValues:{suit:'spade',count:'14'},
};
export const joker: Decision = { id:'joker', kind:'commands',commands:['joker-spade'] };
const ref = (handle:string) => ({scope:'viewer:alice:epoch9',handle});
/** Exact candidate preserves order, target and wildcard meaning together, not independent lists. */
export const hoola: StructuredCandidate = {cards:[ref('six-heart'),ref('joker')],target:{kind:'group-end',group:'bob-run',end:'end'},wildcardRoles:[{card:ref('joker'),represents:'eight-heart'}]};
export const oneCard: StructuredCandidate = {cards:[ref('seven-club')],target:{kind:'zone',zone:'discard'},wildcardRoles:[],choice:{suit:'heart'}};
export const opportunities: readonly Opportunity[] = [
  {id:'normal-play',offerId:'play:4'},
  {id:'catch-one-card',offerId:'catch:2',windowId:'catch-window:2'},
];
export const poker: Extract<Decision,{kind:'number'}> = {id:'raise',kind:'number',commands:['short-all-in'],numberAction:'raise-to',initial:125};
export const pokerOffer: Offer<number> = {id:'bet:19',actions:[
  {kind:'number',id:'raise-to',enabled:true,intent:'primary',domain:{kind:'stepped',min:125,max:525,step:25,origin:100},createAction:value=>value},
  {kind:'command',id:'short-all-in',enabled:true,intent:'secondary',action:90},
]};
export const pools: readonly Pool[] = [{id:'main',amount:300,eligibleSeats:['a','b','c']},{id:'side',amount:100,eligibleSeats:['b','c']}];
export const awards: readonly Award[] = [{poolId:'main',seat:'a',amount:300},{poolId:'side',seat:'b',amount:50},{poolId:'side',seat:'c',amount:50}];

// Compile-negative fixtures: these lines must fail typing; removing the guard is an error.
// @ts-expect-error commands cannot own numeric form configuration
const badCommand: Decision = {id:'bad',kind:'commands',commands:[],numberAction:'raise'};
// @ts-expect-error anonymous cards cannot leak tracking references
const badBack: ViewerCard = {kind:'anonymous-back',ref:ref('secret')};
// @ts-expect-error unknown-count piles cannot accidentally disclose count
const badPile: PileSummary = {kind:'unknown-count',count:20};
// @ts-expect-error pending evaluations cannot carry executable tokens
const badPending: Evaluation = {kind:'pending',context:{projectionScope:'s',privacyScopeGeneration:'g',presentation:'p',environment:'e',attempt:'1',opportunityId:'o',offerId:'f',draftId:'d'},candidateToken:'token'};
// @ts-expect-error structured candidates are intentionally outside V1 executable decisions
const prematureV1: Decision = {id:'meld',kind:'cards-and-target',commands:[],selection:hoola};
void [badCommand,badBack,badPile,badPending,prematureV1];

/** Same label, distinct legal action identity; variant dimension prevents tuple ambiguity. */
export const identicalLabelsOffer: Offer<string> = {id:'trump:2',actions:[
  {kind:'command',id:'change-trump',label:'Heart 17',intent:'primary',enabled:true,action:'ChangeTrump'},
  {kind:'command',id:'raise',label:'Heart 17',intent:'secondary',enabled:true,action:'Raise'},
]};
export const identicalLabels: Extract<Decision,{kind:'finite-choice'}> = {id:'trump',kind:'finite-choice',reconciliation:'preserve-compatible',submit:{unavailable:'disabled'},commands:[],
 fields:[{id:'variant',options:[{id:'change',label:'Heart 17',enabled:true},{id:'raise',label:'Heart 17',enabled:true}]}],
 variants:[{tuple:{variant:'change'},actionId:'change-trump'},{tuple:{variant:'raise'},actionId:'raise'}],initialValues:{variant:'change'}};
