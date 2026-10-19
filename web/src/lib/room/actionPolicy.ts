import {ownEphemeralData} from './ephemeral';

export interface ActionPolicy<A>{readonly valid:boolean;readonly limited:boolean;readonly legal:readonly A[];readonly out_of_turn:readonly A[];}
interface Source<A>{readonly legal:readonly A[];readonly out_of_turn:readonly A[];readonly policy_actions?:unknown;}
const empty=Object.freeze([]);
/** Compare owned wire values structurally; object property order is not action
 * identity, while card/tuple array ordering remains meaningful. */
function key(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(key).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(name=>`${JSON.stringify(name)}:${key((value as Record<string,unknown>)[name])}`).join(',')}}`;
 throw Error('Non-wire action');
}
/** Shared infrastructure availability for every client root. The native rule
 * lists stay intact. An omitted legacy policy preserves old behavior; a present
 * invalid policy never falls back to unfiltered rules. No caller cache is kept. */
export function readActionPolicy<A>(source:Source<A>):ActionPolicy<A>{
 const denied:ActionPolicy<A>={valid:false,limited:true,legal:empty,out_of_turn:empty};
 try{
  const descriptor=Object.getOwnPropertyDescriptor(source,'policy_actions');
  if(descriptor&&!('value'in descriptor))return denied;
  const legal=Object.getOwnPropertyDescriptor(source,'legal'),offTurn=Object.getOwnPropertyDescriptor(source,'out_of_turn');
  if(!legal||!('value'in legal)||!offTurn||!('value'in offTurn)||!Array.isArray(legal.value)||!Array.isArray(offTurn.value))return denied;
  if(!descriptor||descriptor.value===undefined)return {valid:true,limited:false,legal:legal.value,out_of_turn:offTurn.value};
  const picked=ownEphemeralData({legal:legal.value as readonly A[],out_of_turn:offTurn.value as readonly A[],policy:descriptor.value});
  const policy=picked.policy;
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).length!==2||Object.keys(policy).some(name=>!['legal','out_of_turn'].includes(name)))return denied;
  const result:Record<'legal'|'out_of_turn',readonly A[]>={legal:empty,out_of_turn:empty};
  for(const name of ['legal','out_of_turn'] as const){
   const rules=picked[name],available=(policy as Record<string,unknown>)[name];
   if(!Array.isArray(rules)||!Array.isArray(available)||available.length>rules.length)return denied;
   const permitted=new Map(rules.map(value=>[key(value),value])),selected=available.map(key);
   if(new Set(selected).size!==selected.length||selected.some(value=>!permitted.has(value)))return denied;
   // Keep owned original rule payloads, not another producer's representation.
   result[name]=Object.freeze(selected.map(value=>permitted.get(value)!)) as readonly A[];
  }
  return {valid:true,limited:result.legal.length!==picked.legal.length||result.out_of_turn.length!==picked.out_of_turn.length,...result};
 }catch{return denied;}
}
/** Final candidate fence; it never chooses a replacement or changes rules. */
export function policyAllowsAction<A>(source:Source<A>,action:A,onTurn:boolean):boolean{
 try{
  const policy=readActionPolicy(source);if(!policy.valid)return false;
  const candidate=key(ownEphemeralData(action));
  return (onTurn?[...policy.legal,...policy.out_of_turn]:policy.out_of_turn).some(value=>key(value)===candidate);
 }catch{return false;}
}
