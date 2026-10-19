import type {ConnectedPublicHistory} from './connectedDisclosures';
export interface PublicHistorySource {
 /** The native connection replaces this on every Session packet. Nested Room
  * array proxies are not publication identities and may change on presence. */
 readonly nativeSource:object;
 readonly roomId:string;readonly roomEpoch:string;readonly sessionId:number;readonly handsPlayed:number;
 readonly records?:unknown;readonly archives?:unknown;readonly history?:unknown;readonly hands?:unknown;
}
/** Reference-only host boundary. No whole archive clone, serialization, count
 * traversal or hand-count-only freshness shortcut. Keep only the latest source. */
export function createPublicHistoryCapture(){
 let sequence=0,previous:PublicHistorySource|null=null,capture:{readonly revision:string;readonly history:ConnectedPublicHistory}|null=null;
 return {
  capture(source:PublicHistorySource){
   const next:PublicHistorySource={nativeSource:source.nativeSource,roomId:source.roomId,roomEpoch:source.roomEpoch,sessionId:source.sessionId,handsPlayed:source.handsPlayed,records:source.records,archives:source.archives,history:source.history,hands:source.hands};
   if(!previous||previous.nativeSource!==next.nativeSource||previous.roomId!==next.roomId||previous.roomEpoch!==next.roomEpoch||previous.sessionId!==next.sessionId||previous.handsPlayed!==next.handsPlayed){
    previous=next;sequence++;
    capture=Object.freeze({revision:`public-history:${sequence}`,history:Object.freeze({current:Object.freeze({sessionId:next.sessionId,...(next.records!==undefined?{records:next.records}:{}),summary:Object.freeze({hands_played:next.handsPlayed,...(next.history!==undefined?{history:next.history}:{}),...(next.hands!==undefined?{hands:next.hands}:{})})}),...(next.archives!==undefined?{archives:next.archives}:{})})});
   }
   return capture!;
  },
  clear(){previous=null;capture=null;},
 };
}
