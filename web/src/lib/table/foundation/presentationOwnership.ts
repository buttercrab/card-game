/** A live accepted-view lineage. It carries no scene, command or private data. */
declare const presentationOwnershipBrand:unique symbol;
export interface PresentationOwnership {readonly [presentationOwnershipBrand]:true;}
const live=new WeakMap<object,object>();
/** Internal session issuer; never exported by the public foundation facade. */
export function issuePresentationOwnership(owner:object):PresentationOwnership{const token=Object.freeze({}) as PresentationOwnership;live.set(token,owner);return token;}
export function revokePresentationOwnership(token:PresentationOwnership|undefined):void{if(token)live.delete(token);}
export function isPresentationOwnership(value:unknown,owner?:object):value is PresentationOwnership{return !!value&&typeof value==='object'&&live.has(value)&&(owner===undefined||live.get(value)===owner);}
