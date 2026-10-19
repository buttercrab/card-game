import { expect, test } from 'vitest';
import { DecisionController, validateDecision, availableOptions } from '../../table/decision';
import type { ActionOffer } from '../../table/presentation';
import { biddingDecision } from './bidding';
import {presetRules} from './catalog';
import {mightyBiddingPresentation} from './phasePresentation';
import {validateDecisionPresentation} from '../../table/foundation/presentationCohort';
import type {TableDocument} from '../../table/foundation/contracts';
import type { Action } from './types';

function offer(): ActionOffer<Action> {
  return { id: 'server-turn:1', actions: [
    { id: 'heart:16', label: '♥16', intent: 'primary', kind: 'command', enabled: true, action: { Bid: { trump: 'Heart', count: 16 } } },
    { id: 'heart:19', label: '♥19', intent: 'primary', kind: 'command', enabled: true, action: { Bid: { trump: 'Heart', count: 19 } } },
    { id: 'nt:20', label: '노기루다20', intent: 'primary', kind: 'command', enabled: false, action: { Bid: { trump: null, count: 20 } } },
    { id: 'pass', label: '패스', intent: 'secondary', kind: 'command', enabled: true, action: 'Pass' },
  ] };
}

test('Mighty describes only exact offered bid combinations, with labels separate from IDs', () => {
  const current = offer();
  const decision = biddingDecision(current);
  expect(validateDecision(decision, current)).toEqual([]);
  expect(decision.kind).toBe('finite-choice');
  if (decision.kind !== 'finite-choice') return;
  expect(decision.presentation).toEqual({kind:'choice-strips'});
  expect(decision.fields.map(f => [f.id, f.label])).toEqual([['trump', '기루다'], ['count', '공약 수']]);
  expect(decision.fields[1].options.map(o => o.id)).toEqual(['16', '19', '20']);
  expect(decision.variants).toEqual([
    { tuple: { trump: 'Heart', count: '16' }, actionId: 'heart:16' },
    { tuple: { trump: 'Heart', count: '19' }, actionId: 'heart:19' },
    { tuple: { trump: 'no-trump', count: '20' }, actionId: 'nt:20' },
  ]);
  expect(decision.commands).toEqual(['pass']);
});

test('engine selects and submits the exact bid payload, never an interpolated count', () => {
  const current = offer();
  const sent: Action[] = [];
  const controller = new DecisionController<Action>(action => sent.push(action));
  const handle = controller.bind(biddingDecision(current), current, 'viewer:one');
  expect(controller.choose(handle, 'count', '17')).toBe(false);
  expect(controller.choose(handle, 'count', '19')).toBe(true);
  expect(controller.choose(handle, 'trump', 'no-trump')).toBe(false);
  const selected = controller.snapshot(handle)!.selected!;
  expect(selected.id).toBe('heart:19');
  const token = controller.capture(handle, selected.id)!;
  expect(sent).toEqual([]);
  expect(controller.dispatch(token)).toBe(true);
  if (current.actions[1].kind === 'command') expect(sent[0]).toBe(current.actions[1].action);
});

test('a count edit stays pinned when the new count requires another suit', () => {
  const current = offer();
  const nt = current.actions[2];
  const enabled = { ...current, actions: current.actions.map(spec => spec === nt ? { ...spec, enabled: true } : spec) };
  const controller = new DecisionController<Action>(() => {});
  const handle = controller.bind(biddingDecision(enabled), enabled, 'one');
  expect(controller.choose(handle, 'count', '20')).toBe(false);
  expect(controller.snapshot(handle)!.values).toEqual({ trump: 'Heart', count: '16' });
  expect(controller.choose(handle, 'trump', 'no-trump')).toBe(true);
  expect(controller.snapshot(handle)!.values).toEqual({ trump: 'no-trump', count: '20' });
});

test('an empty bidding offer remains a valid commands decision', () => {
  expect(biddingDecision({ id: 'none', actions: [] })).toEqual({ kind: 'commands', id: 'mighty-bidding', commands: [] });
});

test('duplicate exact bids fail closed instead of choosing the first payload', () => {
  const current = offer();
  const duplicate = { ...current, actions: [...current.actions, { ...current.actions[0], id: 'another' }] };
  expect(validateDecision(biddingDecision(duplicate), duplicate)).toContain('ambiguous variant tuple');
});

test('public vocabulary covers exact legal low no-trump bids and preserves original auxiliary order',()=>{
 const rules=presetRules('default');rules.bidding.min=14;rules.bidding.no_trump_bonus=1;rules.bidding.last_chance_min=13;
 const current:ActionOffer<Action>={id:'public-low',actions:[{id:'low',kind:'command',label:'노기루다 12',intent:'primary',enabled:true,action:{Bid:{trump:null,count:12}}},{id:'pass',kind:'command',label:'패스',intent:'secondary',enabled:true,action:'Pass'},{id:'misdeal',kind:'command',label:'딜미스',intent:'quiet',enabled:true,action:'Misdeal'}]},decision=biddingDecision(current,rules);
 const doc:TableDocument<Action>={context:{session:'s',audience:'p',generation:'g',revision:'1'},participant:{id:'p',name:'P',markers:[]},hand:[],facts:[],decision,offer:current,presentation:mightyBiddingPresentation(rules)};
 expect(validateDecision(decision,current)).toEqual([]);expect(()=>validateDecisionPresentation(doc.presentation,doc)).not.toThrow();expect(decision.commands).toEqual(['misdeal','pass']);if(decision.kind!=='finite-choice')throw Error('Finite bid');expect(decision.fields[0].options).toEqual([{id:'no-trump',label:'노기루다',enabled:true}]);expect(decision.fields[1].options).toEqual([{id:'12',label:'12',enabled:true}]);expect(decision.variants).toEqual([{tuple:{trump:'no-trump',count:'12'},actionId:'low'}]);
});

test('original trump-first bidding exposes only that trump’s actually offered counts',()=>{const current=offer(),spec=biddingDecision(current);if(spec.kind!=='finite-choice')throw Error('finite');expect(availableOptions(spec,current,{trump:'Heart',count:'16'})[1].options.map(option=>option.id)).toEqual(['16','19']);expect(availableOptions(spec,current,{trump:'no-trump',count:'20'})[1].options.map(option=>[option.id,option.available])).toEqual([['20',false]]);expect(availableOptions(spec,current,{trump:'Heart',count:'16'})[0].options.map(option=>option.id)).toEqual(['Heart','no-trump']);});
