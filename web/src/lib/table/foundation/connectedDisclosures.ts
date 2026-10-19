import type {FormOffer,FormSubmission} from './forms';
import type {DisclosureSelectionReceipt,DisclosureFormAction,DisclosureRefresh} from './disclosures';
import type {CommandScope} from '../../generated/protocol';
import type {GameTypes} from '../../room/types';
import type {ConnectedProjectionClient} from './connected';
import type {ViewContext} from './contracts';
import type {DisclosureCatalogOffer,DisclosureReadPolicy} from './disclosures';
/** Already received public history, supplied only to the host read owner.
 * Never copied into current projection, canonical documents or signatures. */
export interface ConnectedPublicHistory {
 readonly current:{readonly sessionId:number;readonly records?:unknown;readonly summary?:unknown};
 readonly archives?:unknown;
}
export interface ConnectedDisclosureContext<G extends GameTypes> {
 readonly client:Pick<ConnectedProjectionClient<G>,'room'|'seat'|'viewerId'|'viewerName'>;
 readonly roomScope:CommandScope;readonly context:ViewContext;
 /** Changes on every public history content replacement, even at the same count. */
 readonly sourceRevision:string;
 readonly connectionEpoch:string;
 readonly publicHistory:ConnectedPublicHistory;
}
export interface ConnectedDisclosureProjection {
 readonly forms?:readonly FormOffer<never>[];
 readonly formActions?:readonly DisclosureFormAction[];
 readonly offers:readonly DisclosureCatalogOffer[];
 /** Only catalog references. The engine constructs local shell navigation. */
 readonly menuItems:readonly {readonly id:string;readonly label:string;readonly catalogId:string}[];
 readonly outcomeDetailsCatalogId?:string;
 /** Replace the shared Rules navigation with this exact read-only catalog. */
 readonly rulesCatalogId?:string;
}
export interface ConnectedDisclosureOwner<G extends GameTypes> {
 readonly policies:readonly DisclosureReadPolicy[];
 selectionChanged?(selection:DisclosureSelectionReceipt|null):void;
 /** Private fixed-sink authority only; never serialized or copied into views. */
 resolveFormAuthority?(selectionId:string,token:string):unknown|null;
 /** Called only after a still-owned local operation is confirmed stored. */
 operationCommitted?(submission:FormSubmission):DisclosureRefresh|null;
 project(context:ConnectedDisclosureContext<G>):ConnectedDisclosureProjection;
 revoke():void;dispose():void;
}
