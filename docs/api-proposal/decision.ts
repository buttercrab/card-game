import type { CandidateContext, Decision, Evaluation, NumberDomain, Offer, Tuple } from './contracts.ts';
const safe = Number.isSafeInteger;
/** Integer arithmetic via BigInt avoids overflow in (value - origin). */
export function inDomain(domain: NumberDomain, value: number): boolean {
  if (!safe(value)) return false;
  if (domain.kind === 'discrete') return domain.values.includes(value);
  return safe(domain.min) && safe(domain.max) && safe(domain.step) && domain.step > 0 && safe(domain.origin)
    && value >= domain.min && value <= domain.max
    && (BigInt(value) - BigInt(domain.origin)) % BigInt(domain.step) === 0n;
}
export function validateDecision<A>(decision: Decision, offer: Offer<A>): readonly string[] {
  const errors: string[] = [];
  const ids = offer.actions.map(a => a.id);
  if (new Set(ids).size !== ids.length) errors.push('duplicate action id');
  if (new Set(decision.commands).size !== decision.commands.length) errors.push('duplicate command binding');
  const action = (id: string) => offer.actions.find(a => a.id === id);
  for (const id of decision.commands) if (action(id)?.kind !== 'command') errors.push('invalid command binding');
  if (decision.kind === 'commands') return errors;
  if (decision.kind === 'number') {
    const spec = action(decision.numberAction);
    if (spec?.kind !== 'number') return [...errors, 'invalid numeric binding'];
    const d = spec.domain;
    if (d.kind === 'discrete') {
      if (!d.values.length || d.values.some(v => !safe(v)) || new Set(d.values).size !== d.values.length) errors.push('invalid discrete domain');
    } else if (![d.min, d.max, d.step, d.origin].every(safe) || d.step <= 0 || d.min > d.max) errors.push('invalid stepped domain');
    if (!inDomain(d, decision.initial)) errors.push('invalid numeric initial');
    return errors;
  }
  const fields = decision.fields;
  if (!fields.length || new Set(fields.map(f => f.id)).size !== fields.length) errors.push('invalid field ids');
  for (const f of fields) if (!f.options.length || new Set(f.options.map(o => o.id)).size !== f.options.length) errors.push('invalid option ids');
  const complete = (tuple: Tuple) => Object.keys(tuple).length === fields.length && fields.every(f => f.options.some(o => o.id === tuple[f.id]));
  const keys = new Set<string>();
  for (const row of decision.variants) {
    if (!complete(row.tuple)) errors.push('incomplete variants tuple');
    const spec = action(row.actionId);
    if (spec?.kind !== 'command' || decision.commands.includes(row.actionId)) errors.push('invalid choice action');
    const key = JSON.stringify(fields.map(f => row.tuple[f.id]));
    if (keys.has(key)) errors.push('ambiguous variants tuple');
    keys.add(key);
  }
  if (!complete(decision.initialValues) || !decision.variants.some(r => fields.every(f => r.tuple[f.id] === decision.initialValues[f.id]))) errors.push('invalid initial tuple');
  return errors;
}
type Finite = Extract<Decision, { kind: 'finite-choice' }>;
function enabledRow<A>(decision: Finite, offer: Offer<A>, row: Finite['variants'][number]): boolean {
  return decision.fields.every(f => f.options.some(o => o.id === row.tuple[f.id] && o.enabled))
    && offer.actions.some(a => a.id === row.actionId && a.kind === 'command' && a.enabled);
}
/** Pin edited field. Grow a feasible assignment in field order: preserve each old value if feasible;
 * otherwise pin its first supported option immediately. Later values cannot override that prefix. */
export function reconcile<A>(decision: Finite, offer: Offer<A>, current: Tuple, change: { field: string; option: string }): Tuple | null {
  if (validateDecision(decision, offer).length) return null;
  const changed = decision.fields.find(f => f.id === change.field);
  if (!changed?.options.some(o => o.id === change.option && o.enabled)) return null;
  let rows = decision.variants.filter(r => enabledRow(decision, offer, r) && r.tuple[change.field] === change.option);
  return repair(decision, rows, current, change.field);
}
function repair(decision: Finite, candidates: Finite['variants'], current: Tuple, pinned?: string): Tuple | null {
  let rows = [...candidates];
  for (const f of decision.fields) {
    if (f.id === pinned) continue;
    const preserved = rows.filter(r => r.tuple[f.id] === current[f.id]);
    if (preserved.length) rows = preserved;
    else {
      const fallback = f.options.find(o => o.enabled && rows.some(r => r.tuple[f.id] === o.id));
      if (!fallback) return null;
      rows = rows.filter(r => r.tuple[f.id] === fallback.id);
    }
  }
  return rows[0] ? { ...rows[0].tuple } : null;
}
/** Pure replacement/default selection only; no controller lifetime or DOM behavior. */
export function initializeChoices<A>(decision: Finite, offer: Offer<A>, previous?: Tuple): Tuple | null {
  if (validateDecision(decision, offer).length) return null;
  const current = decision.reconciliation === 'preserve-compatible' && previous ? previous : decision.initialValues;
  return repair(decision, decision.variants.filter(r => enabledRow(decision, offer, r)), current);
}
/** Validation never calls createAction; payload materialization happens only on submit. */
export function submitNumber<A>(decision: Extract<Decision, {kind: 'number'}>, currentOffer: Offer<A>, expectedOffer: string, value: number): { ok: true; action: A } | { ok: false } {
  if (currentOffer.id !== expectedOffer || validateDecision(decision, currentOffer).length) return {ok:false};
  const action = currentOffer.actions.find(a => a.id === decision.numberAction);
  if (action?.kind !== 'number' || !action.enabled || !inDomain(action.domain, value)) return {ok:false};
  return {ok:true, action:action.createAction(value)};
}

/** Reject stale/reversed async replies and privacy generations before exposing readiness. */
export function currentEvaluation(evaluation: Evaluation, current: CandidateContext): Evaluation | null {
  const keys: readonly (keyof CandidateContext)[] = ['projectionScope','privacyScopeGeneration','presentation','environment','draftId','attempt','opportunityId','offerId','windowId'];
  return keys.every(key => evaluation.context[key] === current[key]) ? evaluation : null;
}
