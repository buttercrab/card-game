/** Additive native eligibility is independent of legality and authorization.
 * Missing legacy status preserves compatibility; malformed present status denies
 * the resource-sensitive operation. No refused action is replaced. */
import {isNativeCapacityReason} from './delivery';
type Source={readonly capacity?:unknown};
export const CAPACITY_NOTICE='테이블의 데이터 한도로 일부 동작을 사용할 수 없어요. 기록은 그대로 보관돼요.';
export function capacityAllows(source:Source|null|undefined,operation:'can_start'|'can_archive'|'can_play'):boolean{
 if(!source)return true;
 const property=Object.getOwnPropertyDescriptor(source,'capacity');
 if(!property||'value'in property&&property.value===undefined)return true;
 if(!('value'in property)||!property.value||typeof property.value!=='object'||Array.isArray(property.value))return false;
 const status=property.value;
 const fields=['can_start','can_archive','can_play','reason'];
 if(Object.keys(status).length!==4||Object.keys(status).some(key=>!fields.includes(key)))return false;
 for(const key of fields){const value=Object.getOwnPropertyDescriptor(status,key);if(!value||!('value'in value)||key!=='reason'&&typeof value.value!=='boolean')return false;}
 const reason=Object.getOwnPropertyDescriptor(status,'reason')!.value;
 if(reason!==null&&!isNativeCapacityReason(reason))return false;
 return Object.getOwnPropertyDescriptor(status,operation)!.value===true;
}
export function capacityAllowsRoomAction(source:Source|null|undefined,action:{readonly type:string}):boolean{
 return action.type==='start'?capacityAllows(source,'can_start'):
  action.type==='reset_scores'||action.type==='rematch'?capacityAllows(source,'can_archive'):true;
}
