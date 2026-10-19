import type {ConnectedDisclosureOwner} from '../../table/foundation/connectedDisclosures';
import {createMightyDisclosureOwner} from './disclosureOwner';
import {createMightyRulebookReadOwner} from './rulebookReadPolicy';
import type {Mighty} from './types';
/** Compose fixed host readers; game/layout/command ownership is unchanged. */
export function createMightyConnectedDisclosureOwner():ConnectedDisclosureOwner<Mighty>{
 const currentHand=createMightyDisclosureOwner(),book=createMightyRulebookReadOwner();
 return {...currentHand,policies:Object.freeze([...currentHand.policies,book.policy]),
  project(input){const result=currentHand.project(input),rules=book.project(input);return rules?{...result,offers:[...result.offers,rules],rulesCatalogId:rules.id}:result;},
  revoke(){currentHand.revoke();book.revoke();},
  dispose(){currentHand.dispose();book.dispose();},
 };
}
