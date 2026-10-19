import type {TableDocument} from './contracts';
/** Main-table selection is an upper bound, independent of canonical public
 * resources. Preserve engine collection order and never mutate the document. */
export function visibleCollectionDocument<A>(document:TableDocument<A>):TableDocument<A>{
 const ids=document.presentation?.tableCollectionIds;if(ids===undefined)return document;
 const selected=new Set(ids);
 return {...document,collections:(document.collections??[]).filter(collection=>selected.has(collection.id))};
}
