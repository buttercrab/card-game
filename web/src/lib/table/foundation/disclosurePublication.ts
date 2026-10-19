/** A host read owner may synchronously reenter native publication. Optional
 * reader failure can degrade to a document without readers; ownership change
 * must instead retire the old private scene and abort publication entirely. */
export function guardDisclosurePublication<T>(options:{current:()=>boolean;project:()=>T;unavailable:()=>T;revoke:()=>void}):T|null{
 const current=()=>{try{return options.current()===true;}catch{return false;}};
 const abort=()=>{options.revoke();return null;};
 if(!current())return abort();
 try{const result=options.project();return current()?result:abort();}
 catch{if(!current())return abort();const fallback=options.unavailable();return current()?fallback:abort();}
}
