import {ACHIEVEMENTS} from './achievementCatalog';
import {mightyCompletionCandidate,type MightyCompletionInput} from './completion';
import {storeCompletion,type CompletionStorage,type CompletionWrite} from './completionStore';
export interface MightyCompletionView {
 readonly id:string;readonly status:CompletionWrite['status'];readonly earnedTitles:readonly string[];readonly message?:string;
}
/** One mounted host owns notices and confirmed award presentation. Pure game
 * projection never writes storage. Failures do not retry on benign publication;
 * retry is an explicit local action for the currently observed completion. */
export function createMightyCompletionHost(storage?:CompletionStorage) {
 let disposed=false,epoch=0,current:string|null=null;
 const cache=new Map<string,MightyCompletionView>(),active=new Set<string>();
 const invalid=()=>{throw Error('Retired completion host');};
 return {
  observe(input:MightyCompletionInput,at:number,isCurrent?:()=>boolean):MightyCompletionView|null {
   if(disposed)return null;
   const candidate=mightyCompletionCandidate(input,at);
   if(candidate.status!=='eligible'){
    current=null;
    if(candidate.status==='ineligible'||!candidate.message)return null;
    const captured=epoch;
    // This is only a local refusal notice, never an invented completion key.
    // No storage or award computation is permitted without known provenance.
    try{if(isCurrent&&isCurrent()!==true)return null;}catch{return null;}
    if(disposed||epoch!==captured)return null;
    return Object.freeze({id:'mighty-completion:unsupported',status:'unsupported',earnedTitles:Object.freeze([]),message:candidate.message});
   }
   const key=candidate.hand.key,captured=epoch;current=key;
   const guard=()=>{if(disposed||epoch!==captured||current!==key)invalid();if(isCurrent&&isCurrent()!==true)invalid();if(disposed||epoch!==captured||current!==key)invalid();};
   try{guard();}catch{return null;}
   const prior=cache.get(key);if(prior)return prior;if(active.has(key))return null;
   active.add(key);
   let result:CompletionWrite;
   try {
    const target=storage??localStorage;
    const port:CompletionStorage={getItem(name){guard();const value=target.getItem(name);guard();return value;},setItem(name,value){guard();target.setItem(name,value);guard();}};
    result=storeCompletion(candidate,port);
   }catch{result={status:'failed',message:'이 기기의 기록을 읽지 못했어요.'};}
   finally{active.delete(key);}
   try{guard();}catch{return null;}
   const view:MightyCompletionView=Object.freeze({id:key,status:result.status,earnedTitles:Object.freeze(result.status==='stored'?ACHIEVEMENTS.filter(item=>result.earnedIds.includes(item.id)).map(item=>item.title):[]),...('message'in result?{message:result.message}:{})});
   cache.set(key,view);while(cache.size>8)cache.delete(cache.keys().next().value!);return view;
  },
  retry(id:string):boolean {if(disposed||id!==current||active.has(id))return false;const value=cache.get(id);if(!value||value.status==='stored'||value.status==='duplicate')return false;cache.delete(id);return true;},
  revoke(){epoch++;current=null;active.clear();cache.clear();},
  dispose(){if(disposed)return;disposed=true;epoch++;current=null;active.clear();cache.clear();},
 };
}
