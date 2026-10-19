import type { DecisionSpec } from '../../table/decisionModel';
import type { ActionOffer, CommandSpec } from '../../table/presentation';
import {mightyBiddingPresentation} from './phasePresentation';
import {phaseChoiceAtomLabel,phaseChoiceOptionAtom} from '../../table/foundation/presentationCohort';
import { SUITS, trumpLabel } from './cards';
import type { Action,Rules } from './types';

type BidSpec = CommandSpec<Action> & { readonly action: Extract<Action, { Bid: unknown }> };

/** Game semantics only. The engine owns selection, repair, layout and dispatch. */
export function biddingDecision(offer: ActionOffer<Action>,rules?:Rules): DecisionSpec {
  const bids = offer.actions.filter((spec): spec is BidSpec => spec.kind === 'command' && typeof spec.action === 'object' && 'Bid' in spec.action);
  const commands = offer.actions.filter(spec => spec.kind === 'command' && (spec.action === 'Misdeal' || spec.action === 'Pass')).map(spec => spec.id);
  const id = 'mighty-bidding';
  if (!bids.length) return { kind: 'commands', id, commands };
  const publicDomain=rules?mightyBiddingPresentation(rules).decision:undefined;
  const optionLabel=(fieldId:string,key:string,fallback:string)=>{if(!publicDomain)return fallback;const atom=phaseChoiceOptionAtom(publicDomain,fieldId,key);if(!atom)throw Error('Uncovered public Mighty bid option');return phaseChoiceAtomLabel(atom);};
  const trumps = [...SUITS, null].filter(trump => bids.some(spec => spec.action.Bid.trump === trump));
  const counts = [...new Set(bids.map(spec => spec.action.Bid.count))].sort((a, b) => a - b);
  const suitId = (trump: typeof trumps[number]) => trump ?? 'no-trump';
  const variants = bids.map(spec => ({ tuple: { trump: suitId(spec.action.Bid.trump), count: String(spec.action.Bid.count) }, actionId: spec.id }));
  const initial = variants.find(row => row.tuple.trump === suitId(trumps[0]))!;
  if(publicDomain)commands.sort((a,b)=>publicDomain.auxiliaryLabels.indexOf(offer.actions.find(action=>action.id===a)!.label)-publicDomain.auxiliaryLabels.indexOf(offer.actions.find(action=>action.id===b)!.label));
  return {
    kind: 'finite-choice', id, commands, presentation:{kind:'choice-strips'},
    fields: [
      { id: 'trump', label: publicDomain?.fields[0].label??'기루다', options: trumps.map(trump => ({ id: suitId(trump), label:optionLabel('trump',suitId(trump),trumpLabel(trump)), enabled: true })) },
      { id: 'count', label: publicDomain?.fields[1].label??'공약 수', options: counts.map(count => ({ id: String(count), label:optionLabel('count',String(count),String(count)), enabled: true })) },
    ],
    variants, initialValues: initial.tuple, reconciliation: 'preserve-compatible',
    submit: { unavailable: 'disabled', presentationLabel: { prefix: publicDomain?.submit.prefix??'공약' } },
  };
}
