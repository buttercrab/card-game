import type {ActionOffer,CommandSpec} from './presentation';
import {validateDecision,initializeChoices,reconcileChoices,availableOptions,immutableSpec,selectedChoiceAction,command,type DecisionSpec,type ChoiceValues,type AvailableField,type DecisionGuards} from './decisionModel';
export * from './decisionModel';
const handleBrand: unique symbol = Symbol('DecisionHandle');
const tokenBrand: unique symbol = Symbol('DecisionToken');
export interface DecisionHandle<A> { readonly [handleBrand]: true; readonly __actionType?: A }
export interface DecisionToken { readonly [tokenBrand]: true }
export interface DecisionSnapshot<A> {
  readonly spec: DecisionSpec;
  readonly offer: ActionOffer<A>;
  readonly values: ChoiceValues | null;
  readonly selected: CommandSpec<A> | null;
  readonly commands: readonly CommandSpec<A>[];
  readonly fields: readonly AvailableField[];
  readonly errors: readonly string[];
  readonly draftRevision: number;
  readonly guards: DecisionGuards;
}
interface Binding<A> {
  handle: DecisionHandle<A>; sourceSpec: DecisionSpec; sourceOffer: ActionOffer<A>; scope: string;
  spec: DecisionSpec; offer: ActionOffer<A>; values: ChoiceValues | null; errors: readonly string[];
  draftRevision: number; guards: DecisionGuards;
}
interface Capture<A> { binding: Binding<A>; revision: number; actionId: string; used: boolean }

/** Local lifecycle and exact offered-command dispatch. No receipt, retry or server-legality claim. */
export class DecisionController<A> {
  private binding: Binding<A> | null = null;
  private tokens = new WeakMap<DecisionToken, Capture<A>>();
  private disposed = false;
  private dispatching = false;
  constructor(private readonly transport: (action: A, offerId: string) => void) {}

  bind(spec: DecisionSpec, offer: ActionOffer<A>, scope: string): DecisionHandle<A> {
    if (this.disposed) throw new Error('Decision controller is disposed');
    const old = this.binding;
    if (old?.sourceSpec === spec && old.sourceOffer === offer && old.scope === scope) return old.handle;
    const nextSpec = immutableSpec(spec);
    const nextOffer: ActionOffer<A> = Object.freeze({...offer,actions:Object.freeze(offer.actions.map(action => Object.freeze({...action})))});
    const errors = validateDecision(nextSpec,nextOffer);
    const previous = old && old.scope === scope && old.spec.id === spec.id ? old.values ?? undefined : undefined;
    this.binding = {handle:Object.freeze({[handleBrand]:true as const}),sourceSpec:spec,sourceOffer:offer,scope,spec:nextSpec,offer:nextOffer,errors,
      values:nextSpec.kind === 'finite-choice' ? initializeChoices(nextSpec,nextOffer,previous) : null,
      draftRevision:0,guards:Object.freeze({commands:false,submit:false})};
    return this.binding.handle;
  }
  private current(handle: DecisionHandle<A>): Binding<A> | null {
    return !this.disposed && this.binding?.handle === handle ? this.binding : null;
  }
  snapshot(handle: DecisionHandle<A>): DecisionSnapshot<A> | null {
    const binding = this.current(handle);
    if (!binding) return null;
    const {spec,offer,values,errors,draftRevision,guards} = binding;
    const selected=spec.kind==='finite-choice'?selectedChoiceAction(spec,offer,values):null;
    return Object.freeze({spec,offer,values,errors,draftRevision,guards,selected:!errors.length?selected:null,
      commands:Object.freeze(errors.length ? [] : spec.commands.flatMap(id => {const action=command(offer,id);return action ? [action] : [];})),
      fields:spec.kind === 'finite-choice' ? availableOptions(spec,offer,values) : Object.freeze([])});
  }
  choose(handle: DecisionHandle<A>, field: string, option: string, expectedRevision?: number): boolean {
    const binding = this.current(handle);
    if (!binding || binding.spec.kind !== 'finite-choice' || this.dispatching || (expectedRevision !== undefined && expectedRevision !== binding.draftRevision)) return false;
    const values = reconcileChoices(binding.spec,binding.offer,binding.values ?? binding.spec.initialValues,field,option);
    if (!values) return false;
    if (binding.values && Object.keys(values).every(key => binding.values?.[key] === values[key])) return true;
    binding.values = values;
    binding.draftRevision++;
    return true;
  }
  /** Cancel held geometry/focus gestures while preserving the compatible local draft. */
  invalidateGestures(handle: DecisionHandle<A>): boolean {
    const binding = this.current(handle);
    if (!binding) return false;
    binding.draftRevision++;
    return true;
  }
  setGuards(handle: DecisionHandle<A>, guards: DecisionGuards): boolean {
    const binding = this.current(handle);
    if (!binding) return false;
    if (binding.guards.commands !== guards.commands || binding.guards.submit !== guards.submit) {
      binding.guards = Object.freeze({...guards});
      binding.draftRevision++;
    }
    return true;
  }
  private executable(binding: Binding<A>, actionId: string): CommandSpec<A> | null {
    const snapshot = this.snapshot(binding.handle);
    if (!snapshot || snapshot.errors.length) return null;
    if (snapshot.spec.commands.includes(actionId)) return !snapshot.guards.commands ? snapshot.commands.find(action => action.id === actionId && action.enabled) ?? null : null;
    return !snapshot.guards.submit && snapshot.selected?.id === actionId && snapshot.selected.enabled ? snapshot.selected : null;
  }
  capture(handle: DecisionHandle<A>, actionId: string): DecisionToken | null {
    const binding = this.current(handle);
    if (!binding || this.dispatching || !this.executable(binding,actionId)) return null;
    const token = Object.freeze({[tokenBrand]:true as const});
    this.tokens.set(token,{binding,revision:binding.draftRevision,actionId,used:false});
    return token;
  }
  isCurrent(token: DecisionToken): boolean {
    const captured = this.tokens.get(token);
    return !!captured && !captured.used && !this.dispatching && !this.disposed
      && this.binding === captured.binding && captured.binding.draftRevision === captured.revision
      && !!this.executable(captured.binding,captured.actionId);
  }
  dispatch(token: DecisionToken): boolean {
    const captured = this.tokens.get(token);
    if (!captured || captured.used) return false;
    captured.used = true;
    if (this.dispatching || this.disposed || this.binding !== captured.binding || captured.binding.draftRevision !== captured.revision) return false;
    const action = this.executable(captured.binding,captured.actionId);
    if (!action) return false;
    this.dispatching = true;
    try { this.transport(action.action,captured.binding.offer.id); }
    finally { this.dispatching = false; }
    return true;
  }
  dispose(): void { this.disposed=true; this.binding=null; this.tokens=new WeakMap(); }
}
