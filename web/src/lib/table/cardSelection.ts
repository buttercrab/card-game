import type { ActionOffer, CommandSpec } from './presentation';
import {MAX_COMMAND_BATCH} from '../generated/protocol';

/** Finite, exact card sets offered by a game. Draft selection never synthesizes an action. */
interface CardSelectionBase {
    readonly kind: 'card-selection';
    readonly id: string;
    readonly commands: readonly string[];
    readonly variants: readonly {
        readonly cardIds: readonly string[];
        readonly actionId: string;
    }[];
    readonly submit: { readonly prefix: string; readonly prompt?:string };
}
/** Exact variants describe dependent sets. Count selection describes independent
 * offered single-card commands, committed together through one batch admission. */
export type CardSelectionDecision = CardSelectionBase & (
    | {readonly mode:'one'|'many';readonly count?:never;readonly disambiguation?:'choose-action'}
    | {readonly mode:'count';readonly count:number;readonly disambiguation?:never}
);

const validId = (id: string): boolean => typeof id === 'string' && id.trim().length > 0;
const uniqueIds = (ids: readonly string[]): boolean => ids.every(validId) && new Set(ids).size === ids.length;
const setKey = (ids: readonly string[]): string => JSON.stringify([...ids].sort());
const commandIndex = <A>(offer: ActionOffer<A>): ReadonlyMap<string, CommandSpec<A>> => {
    const commands = new Map<string, CommandSpec<A>>();
    const seen = new Set<string>();
    for (const action of offer.actions) {
        // Invalid duplicate offers are rejected below; retain first-binding semantics for diagnostics.
        if (seen.has(action.id)) continue;
        seen.add(action.id);
        if (action.kind === 'command') commands.set(action.id, action);
    }
    return commands;
};

/** Semantic validation of typed descriptors, not an untrusted JSON decoder. */
export function validateCardSelection<A>(spec: CardSelectionDecision, offer: ActionOffer<A>, handIds: readonly string[]): readonly string[] {
    const errors: string[] = [];
    if (spec.kind !== 'card-selection' || !validId(spec.id) || !validId(offer.id)) errors.push('missing decision or offer id');
    if (!['one','many','count'].includes(spec.mode)) errors.push('invalid selection mode');
    if(spec.disambiguation!==undefined&&((spec.mode as string)==='count'||spec.disambiguation!=='choose-action'))errors.push('invalid card action disambiguation');
    if (spec.mode==='count'&&(!Number.isSafeInteger(spec.count)||spec.count<1||spec.count>MAX_COMMAND_BATCH||spec.count>handIds.length)) errors.push('invalid selection count');
    if (!uniqueIds(handIds)) errors.push('invalid hand card ids');
    if (!uniqueIds(offer.actions.map(action => action.id))) errors.push('invalid action ids');
    if (!uniqueIds(spec.commands)) errors.push('invalid command ids');
    if (!spec.submit.prefix.trim()) errors.push('missing submit prefix');
    if (spec.submit.prompt!==undefined&&!spec.submit.prompt.trim()) errors.push('missing selection prompt');
    const commands = commandIndex(offer);
    const checkBinding = (id: string) => {
        const action = commands.get(id);
        if (!validId(id) || !action) errors.push(`invalid command binding: ${id}`);
        else if (!action.label.trim()) errors.push(`missing action label: ${id}`);
    };
    for (const id of spec.commands) checkBinding(id);
    const sets = new Set<string>();
    const bindings = new Set(spec.commands);
    const hand = new Set(handIds);
    for (const variant of spec.variants) {
        if (!variant.cardIds.length || !uniqueIds(variant.cardIds)) errors.push('invalid variant card ids');
        if (variant.cardIds.some(id => !hand.has(id))) errors.push('unknown variant card');
        if (spec.mode === 'one' && variant.cardIds.length !== 1) errors.push('one-card variant must contain one card');
        if (spec.mode === 'count' && variant.cardIds.length !== 1) errors.push('count variant must contain one card');
        const key = setKey(variant.cardIds);
        if (sets.has(key)&&spec.disambiguation!=='choose-action') errors.push('ambiguous variant card set');
        sets.add(key);
        checkBinding(variant.actionId);
        if (bindings.has(variant.actionId)) errors.push(`overlapping action binding: ${variant.actionId}`);
        bindings.add(variant.actionId);
    }
    return Object.freeze(errors);
}

const declaredIds = (spec: CardSelectionDecision): readonly string[] => [...new Set(spec.variants.flatMap(variant => [...variant.cardIds]))];
function validDraft<A>(spec: CardSelectionDecision, offer: ActionOffer<A>, selected: readonly string[]): boolean {
    const ids = declaredIds(spec);
    return !validateCardSelection(spec, offer, ids).length && uniqueIds(selected)
        && selected.every(id => ids.includes(id)) && (spec.mode !== 'one' || selected.length <= 1)
        && (spec.mode!=='count'||selected.length<=spec.count);
}
function enabledVariants<A>(spec: CardSelectionDecision, offer: ActionOffer<A>) {
    const commands = commandIndex(offer);
    return spec.variants.filter(variant => commands.get(variant.actionId)?.enabled === true);
}

/** Deselecting is always possible for a valid draft; adding must retain an enabled exact completion. */
export function toggleCards<A>(spec: CardSelectionDecision, offer: ActionOffer<A>, selected: readonly string[], cardId: string): readonly string[] | null {
    if (!validDraft(spec, offer, selected) || !validId(cardId)) return null;
    if (selected.includes(cardId)) return Object.freeze(selected.filter(id => id !== cardId));
    if (spec.mode==='count') return selected.length<spec.count&&enabledVariants(spec,offer).some(row=>row.cardIds[0]===cardId)
        ? Object.freeze([...selected,cardId]) : null;
    const next = spec.mode === 'one' ? [cardId] : [...selected, cardId];
    return enabledVariants(spec, offer).some(variant => next.every(id => variant.cardIds.includes(id)))
        ? Object.freeze(next) : null;
}

/** All exact offered actions, including unavailable options; never drafts or payload copies. */
export function selectedCardActions<A>(spec:CardSelectionDecision,offer:ActionOffer<A>,selected:readonly string[]):readonly CommandSpec<A>[] {
    if(spec.mode==='count'||!validDraft(spec,offer,selected)||!selected.length)return Object.freeze([]);
    const key=setKey(selected),commands=commandIndex(offer);
    return Object.freeze(spec.variants.filter(row=>setKey(row.cardIds)===key).map(row=>commands.get(row.actionId)!));
}
/** Ambiguous card sets require an explicit enabled native action choice. */
export function selectedCardAction<A>(spec: CardSelectionDecision, offer: ActionOffer<A>, selected: readonly string[],chosenActionId?:string|null): CommandSpec<A> | null {
    const actions=selectedCardActions(spec,offer,selected);
    const chosen=chosenActionId===undefined||chosenActionId===null?(actions.length===1?actions[0]:null):actions.find(action=>action.id===chosenActionId);
    return chosen?.enabled?chosen:null;
}

/** Compile only original enabled offer bindings, in canonical offer order. */
export function selectedCardCommands<A>(spec:CardSelectionDecision,offer:ActionOffer<A>,selected:readonly string[]):readonly CommandSpec<A>[]|null {
    if(spec.mode!=='count'||!validDraft(spec,offer,selected)||selected.length!==spec.count)return null;
    const commands=commandIndex(offer),rows=enabledVariants(spec,offer).filter(row=>selected.includes(row.cardIds[0]));
    const ids=new Set(rows.map(row=>row.actionId));
    return rows.length===spec.count?Object.freeze(offer.actions.filter((action):action is CommandSpec<A>=>action.kind==='command'&&ids.has(action.id))):null;
}

/** Cards that may be toggled now, including every selected card for deselection. */
export function availableCardIds<A>(spec: CardSelectionDecision, offer: ActionOffer<A>, selected: readonly string[]): readonly string[] {
    if (!validDraft(spec, offer, selected)) return Object.freeze([]);
    const rows = enabledVariants(spec, offer);
    if(spec.mode==='count')return Object.freeze(declaredIds(spec).filter(id=>selected.includes(id)||selected.length<spec.count&&rows.some(row=>row.cardIds[0]===id)));
    return Object.freeze(declaredIds(spec).filter(id => selected.includes(id) || rows.some(variant =>
        variant.cardIds.includes(id) && (spec.mode === 'one' || selected.every(card => variant.cardIds.includes(card))))));
}

/** Rule eligibility does not change when a draft reaches its selection limit. */
export function eligibleCardIds<A>(spec:CardSelectionDecision,offer:ActionOffer<A>):readonly string[]{
    return Object.freeze([...new Set(enabledVariants(spec,offer).flatMap(row=>row.cardIds))]);
}

/** Draft lifetime follows semantic authority, never projection object identity.
 * Presentation labels, artwork and shell preferences do not authorize actions. */
export function cardSelectionAuthority<A>(document:{readonly context:{readonly session:string;readonly audience:string;readonly generation:string};readonly offer:ActionOffer<A>;readonly decision:CardSelectionDecision|{readonly kind:string};readonly hand:readonly {readonly id:string}[]}):string|null {
    if(document.decision.kind!=='card-selection')return null;const spec=document.decision as CardSelectionDecision;
    const actions=commandIndex(document.offer);
    const value=[document.context.session,document.context.audience,document.context.generation,document.offer.id,spec.id,spec.mode,spec.count??null,spec.disambiguation??null,
        document.hand.map(card=>card.id).sort(),spec.variants.map(row=>[row.actionId,[...row.cardIds].sort(),actions.get(row.actionId)?.enabled,actions.get(row.actionId)?.action]).sort((a,b)=>String(a[0])<String(b[0])?-1:1)];
    return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
}
