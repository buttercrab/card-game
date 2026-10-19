import {cardDecision,decisionGroups} from '../decisionCore';
import type {PlannedNode,TableDocument} from './contracts';
import {decisionCommandIds,applicableGroupPresentations} from './presentationCohort';
/** Closed original instruction vocabulary; it supplies no executable binding. */
const originalCaptions=Object.freeze(['내 차례 · 낼 카드를 누르세요','내 차례 · 낼 카드를 두 번 누르세요','내 차례 · 한 번 더 누르면 내요']);
const variantCaption='내 차례 · 카드 내기 선택';
/** Internal parent allocation uses the same closed original caption recipe,
 * including on a cold settled scene. This grants no current turn claim. */
export const nativeCardCaptionDomain:readonly string[]=Object.freeze([...originalCaptions,variantCaption]);
export interface NativeCardPresentation {
 readonly kind:'native-one';
 readonly activation:'single'|'repeat';
 readonly captions:readonly string[];
 /** Passive views retain only the public measured envelope, never a stale turn claim. */
 readonly caption:string|null;
}
/** Public cohort and owned host interaction choose the recipe. Current private
 * selection can choose its caption, but cannot grow its finite measurement domain. */
export function nativeCardPresentation<A>(document:TableDocument<A>,active:boolean,selectedCardIds:readonly string[]):NativeCardPresentation|undefined {
 const group=cardDecision(document.decision),vocabulary=applicableGroupPresentations(document).find(value=>value.kind==='card-selection'&&(!group||value.id===group.id)),cohort=vocabulary?.kind==='card-selection'?vocabulary:document.presentation?.selection,activation=document.interaction?.cardActivation,spec=group??document.decision;
 // Connected host/shell commands do not change the public Play recipe.
 // Only the same canonical game-command partition used by rendering can do so.
 if(!group&&decisionGroups(document.decision).some(group=>group.kind==='finite-choice')||!cohort||cohort.mode!=='one'||!activation||document.outcome||document.participant.role==='observer'||spec.kind==='finite-choice'||spec.kind==='card-selection'&&spec.mode!=='one'||!group&&decisionCommandIds(document).length)return undefined;
 const variants=cohort.actionVariantLabelGroups?.some(group=>group.length>1)??false;
 const captions=variants?Object.freeze([...originalCaptions,variantCaption]):originalCaptions;
 let caption:string|null=null;
 if(active&&spec.kind==='card-selection'){
  const selected=selectedCardIds.length===1;
  const ambiguous=selected&&spec.variants.filter(row=>row.cardIds.length===1&&row.cardIds[0]===selectedCardIds[0]).length>1;
  caption=ambiguous&&variants?variantCaption:activation==='single'?originalCaptions[0]:selected?originalCaptions[2]:originalCaptions[1];
 }
 return Object.freeze({kind:'native-one',activation,captions,caption});
}

/** Canonical native-card semantics are descriptive only. The runtime still
 * validates the current frame, selection and offered action when activated. */
export function nativeCardSemantics<A>(document:TableDocument<A>,node:PlannedNode,presentation:NativeCardPresentation|undefined,selectedCardIds:readonly string[],pickerCardId:string|undefined):Pick<PlannedNode,'hasPopup'|'popupExpanded'|'accessibleDescription'|'checked'> {
 const clearPopup=node.hasPopup!==undefined||node.popupExpanded!==undefined?{hasPopup:undefined,popupExpanded:undefined}:{};
 if(node.kind!=='card'||node.zoneId!=='hand'&&node.cardId===undefined&&node.inspectCardId===undefined)return clearPopup;
 const conflicting:readonly (keyof PlannedNode)[]=['actionId','fieldId','optionId','cardActionOptionId','cardActionPickerIntent','catalogueIntent','localIntent','shellIntent','shellActionId','formIntent','formActionId','formField','formNavigation','formLeaseId','editor','preference','disclosureIntent','disclosureCatalogId','disclosureFormActionId','assistanceIntent'];
 const card=document.hand.find(card=>card.id===node.entityId),exact=!!card&&node.zoneId==='hand'&&(node.ownerId===undefined||node.ownerId===document.participant.id)&&(node.cardId===undefined||node.cardId===card.id)&&(node.inspectCardId===undefined||node.inspectCardId===card.id)&&!(node.cardId&&node.inspectCardId)&&!conflicting.some(key=>node[key]!==undefined);
 const group=cardDecision(document.decision);
 const checked=exact&&node.cardId!==undefined&&!!group&&selectedCardIds.includes(node.cardId);
 const canonical={hasPopup:undefined,popupExpanded:undefined,accessibleDescription:undefined,checked};
 if(!exact)return canonical;
 if(node.inspectCardId)return {...canonical,accessibleDescription:'낼 수 없는 이유 보기'};
 if(!presentation||!node.cardId||!node.enabled||!group)return canonical;
 const matches=group!.variants.filter(row=>row.cardIds.length===1&&row.cardIds[0]===node.cardId);
 if(!matches.some(row=>document.offer.actions.some(action=>action.id===row.actionId&&action.enabled)))return canonical;
 const ambiguous=matches.length>1;
 const target=ambiguous?'카드 내기 선택을 열어요':'이 카드를 내요';
 const accessibleDescription=presentation.activation==='single'?`누르면 ${target}`:checked?`한 번 더 누르면 ${target}`:`한 번 누르면 선택하고, 한 번 더 누르면 ${target}`;
 return {hasPopup:ambiguous?'dialog':undefined,popupExpanded:ambiguous?pickerCardId===node.cardId:undefined,accessibleDescription,checked};
}
