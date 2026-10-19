import type {InformationBadge,InformationPanel,InformationValue,TableCard} from './contracts';
/** Read-only historical artwork has no live owner, entity or executable card binding. */
export type DisclosureCard=Pick<TableCard,'id'|'label'|'visual'|'emphasis'>;
export interface DisclosurePerson {readonly id:string;readonly name:string;readonly badges?:readonly InformationBadge[];}
export interface DisclosureCardRef {
 readonly cardId:string;
 /** Game-supplied meaning; the presentation engine never interprets rule flags.
  * At most eight annotations, within the shared document resource budget. */
 readonly annotations?:readonly InformationBadge[];
 readonly winner?:boolean;
 readonly leader?:boolean;
 readonly lead?:InformationValue;
}
export interface DisclosurePlay extends DisclosureCardRef {readonly personId:string;}
export interface DisclosureRound {readonly id:string;readonly title:string;readonly lead?:InformationValue;readonly summary?:string;readonly plays:readonly DisclosurePlay[];}
export interface DisclosureCardGroup {readonly id:string;readonly label:string;readonly personId?:string;readonly description?:string;readonly cardIds:readonly string[];}
interface DisclosureSectionBase {readonly id:string;readonly title:string;}
export type DisclosureSection=
 | (DisclosureSectionBase&{readonly kind:'content';readonly information?:readonly InformationPanel[];readonly cardGroups?:readonly DisclosureCardGroup[]})
 | (DisclosureSectionBase&{readonly kind:'rounds';readonly rounds:readonly DisclosureRound[]})
 | (DisclosureSectionBase&{readonly kind:'matrix';readonly columns:readonly {readonly id:string;readonly label:string;readonly shortLabel?:string}[];readonly rows:readonly {readonly personId:string;readonly cells:readonly (DisclosureCardRef|null)[]}[]});
/** Canonical entryId is the catalog row identity, never guessed from semantic hand lineage.
 * Limits are enforced by the shared validator, not by game-specific rendering. */
export interface DisclosureDocument {readonly entryId:string;readonly title:string;readonly roster:readonly DisclosurePerson[];readonly cards:readonly DisclosureCard[];readonly sections:readonly DisclosureSection[];}
