import type {DisclosureFormAction,DisclosureSelectionReceipt,DisclosureCatalogPage} from './disclosures';
import type {DisclosurePendingRead} from './disclosureSession';
import type {DisclosureDocument} from './disclosureTypes';
/** Engine-owned local navigation. None of these bindings is a game command. */
export type DisclosureIntent=
 | {readonly kind:'close'|'back';readonly leaseId:string}
 | {readonly kind:'catalog-page';readonly leaseId:string;readonly page:number}
 | {readonly kind:'entry';readonly leaseId:string;readonly entryId:string}
 | {readonly kind:'record-step';readonly leaseId:string;readonly entryId:string;readonly direction:-1|1}
 | {readonly kind:'section';readonly leaseId:string;readonly entryId:string;readonly sectionId:string}
 | {readonly kind:'round';readonly leaseId:string;readonly entryId:string;readonly sectionId:string;readonly index:number}
 | {readonly kind:'matrix-page';readonly leaseId:string;readonly entryId:string;readonly sectionId:string;readonly start:number};
/** One opened catalog and at most one frozen selected record. The planner only
 * measures the active section, round or bounded matrix-column window. */
export interface DisclosureView {
 readonly leaseId:string;
 readonly catalogId:string;
 readonly title:string;
 readonly page?:DisclosureCatalogPage;
 readonly selected?:DisclosureDocument;
 readonly pending?:DisclosurePendingRead;
 readonly sectionId?:string;
 readonly roundIndex:number;
 readonly matrixStart:number;
 readonly error?:string;
 readonly canReturnToCatalog?:boolean;
 readonly selection?:DisclosureSelectionReceipt;
 readonly formActions?:readonly DisclosureFormAction[];
}
