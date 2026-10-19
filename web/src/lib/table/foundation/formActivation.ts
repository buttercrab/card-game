import type {PlannedNode} from './contracts';
/** Implicit single-line submission has one declared primary target. An enabled
 * secondary action must never replace a disabled primary action. */
export function implicitFormSubmit(nodes:readonly PlannedNode[],leaseId:string):PlannedNode|null {
 const targets=nodes.filter(node=>node.kind==='command'&&node.formIntent==='submit'&&node.formLeaseId===leaseId&&node.intent==='primary');
 return targets.length===1&&targets[0].enabled===true?targets[0]:null;
}
