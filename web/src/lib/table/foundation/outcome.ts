import {decisionGroups} from '../decisionCore';
import {ownOutcomeOverview} from './outcomeOverview';
import type {DisclosureDocument} from './disclosureTypes';
import type {TableDocument} from './contracts';
import {copyFormData} from './forms';
import {shellCommandActionIds} from './roomShell';
/** Settled meaning only. The engine places the referenced panel and commands. */
export interface OutcomeDescriptor {
 readonly id:string;
 readonly informationId:string;
 readonly continuationActionIds:readonly string[];
 readonly detailsCatalogId?:string;
 readonly compactFieldIds?:readonly string[];
 readonly overview?:DisclosureDocument;
}
/** Run after canonical information, shell and decision ownership is established.
 * This creates no action, layout recipe or separate submission capability. */
export function ownOutcome<A>(input:OutcomeDescriptor,document:Pick<TableDocument<A>,'information'|'offer'|'decision'|'shell'|'disclosures'>):OutcomeDescriptor {
 const value=copyFormData(input),fail=():never=>{throw Error('Invalid settled outcome');};
 const id=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=2048;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==(3+Number(value.detailsCatalogId!==undefined)+Number(value.overview!==undefined)+Number(value.compactFieldIds!==undefined))||!Object.keys(value).every(key=>['id','informationId','continuationActionIds','detailsCatalogId','overview','compactFieldIds'].includes(key))||!id(value.id)||!id(value.informationId)||!Array.isArray(value.continuationActionIds)||value.continuationActionIds.length>8||!value.continuationActionIds.every(id)||new Set(value.continuationActionIds).size!==value.continuationActionIds.length)return fail();
 if(value.detailsCatalogId!==undefined&&(!id(value.detailsCatalogId)||document.disclosures?.filter(offer=>offer.id===value.detailsCatalogId).length!==1))return fail();
 if(document.information?.filter(panel=>panel.id===value.informationId).length!==1)return fail();
 if(value.compactFieldIds!==undefined){
  if(!Array.isArray(value.compactFieldIds)||value.compactFieldIds.length>4||!value.compactFieldIds.every(id)||new Set(value.compactFieldIds).size!==value.compactFieldIds.length)return fail();
  const fields=document.information!.find(panel=>panel.id===value.informationId)!.fields;
  if(value.compactFieldIds.some(fieldId=>fields.filter(field=>field.id===fieldId).length!==1))return fail();
 }
 const shellCommands=new Set(document.shell?shellCommandActionIds(document.shell):[]);
 for(const actionId of value.continuationActionIds){
  const matches=document.offer.actions.filter(action=>action.id===actionId);
  if(matches.length!==1||matches[0].kind!=='command'||!document.decision.commands.includes(actionId)||shellCommands.has(actionId))return fail();
  if(decisionGroups(document.decision).some(group=>group.variants.some(variant=>variant.actionId===actionId)))return fail();
 }
 return value.overview===undefined?value:Object.freeze({...value,overview:ownOutcomeOverview(value.overview as unknown as DisclosureDocument)});
}
