import {expect,test,vi} from 'vitest';
import {guardDisclosurePublication} from './disclosurePublication';
test('reentrant actor and connection replacement never publish the old private document',()=>{
 for(const change of ['actor','connection'] as const){
  let actor='original',connection=1;const old={privateHand:['secret'],audience:actor};const receive=vi.fn(),revoke=vi.fn(),unavailable=vi.fn(()=>old);
  const document=guardDisclosurePublication({current:()=>actor==='original'&&connection===1,project(){if(change==='actor')actor='replacement';else connection++;return old;},unavailable,revoke});
  if(document)receive(document);
  expect(document).toBeNull();expect(receive).not.toHaveBeenCalled();expect(revoke).toHaveBeenCalledOnce();expect(unavailable).not.toHaveBeenCalled();
 }
});
test('owner exceptions after revocation abort, while an optional reader failure under current authority degrades',()=>{
 let live=true;const revoke=vi.fn(),fallback={readers:[]};
 expect(guardDisclosurePublication({current:()=>live,project(){live=false;throw Error('reader');},unavailable:()=>fallback,revoke})).toBeNull();expect(revoke).toHaveBeenCalledOnce();
 live=true;expect(guardDisclosurePublication({current:()=>live,project(){throw Error('reader');},unavailable:()=>fallback,revoke})).toBe(fallback);expect(revoke).toHaveBeenCalledOnce();
 expect(guardDisclosurePublication({current:()=>live,project(){throw Error('reader');},unavailable(){live=false;return fallback;},revoke})).toBeNull();expect(revoke).toHaveBeenCalledTimes(2);
});
