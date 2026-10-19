import type {DisclosureContext,DisclosureScope} from './disclosures';
/** Fixed connected-host observations, read directly at invocation time. Never
 * supplied by a game projection or inferred from the first catalog offer. */
export interface NativeDisclosureState {
 readonly open:boolean;readonly readable:boolean;readonly sourceCurrent:boolean;
 readonly roomId:string|null;readonly roomEpoch:string|null;readonly actorId:string|null;readonly connectionEpoch:string;
 readonly seat:number|null;
 readonly published:{readonly actorId:string|null;readonly seat:number|null;readonly audience:string}|null;
}
function sameNative(scope:Pick<DisclosureScope,'roomId'|'roomEpoch'|'actorId'|'connectionEpoch'>,native:NativeDisclosureState):boolean {
 return native.open&&scope.roomId===native.roomId&&scope.roomEpoch===native.roomEpoch&&scope.actorId===native.actorId&&scope.connectionEpoch===native.connectionEpoch;
}
/** Retain public owned snapshots across benign room/session/seat updates. A
 * private snapshot additionally needs the still-current opaque audience/seat. */
export function nativeDisclosureRetainedCurrent(scope:DisclosureScope,native:NativeDisclosureState):boolean {
 if(!sameNative(scope,native))return false;
 return scope.visibility==='public'||scope.visibility==='audience'&&!!native.published&&scope.audience===native.published.audience&&native.published.actorId===native.actorId&&native.published.seat===native.seat;
}
/** New reads require the exact current native publication source, independently
 * of Game command admission. Public checkpoint readiness can authorize this. */
export function nativeDisclosureReadCurrent(context:DisclosureContext,native:NativeDisclosureState):boolean {
 return sameNative(context,native)&&native.readable&&native.sourceCurrent&&!!native.published&&native.published.actorId===native.actorId&&native.published.seat===native.seat&&native.published.audience===context.audience;
}
