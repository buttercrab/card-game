// Device-local summaries. The atomic completion owner also stores awards and
// the bounded completion ledger, so readers never observe a partial commit.
import type {Contract} from './types';
import {readDeviceRecords,deleteDeviceStats} from './completionStore';
export type Role='declarer'|'friend'|'defense';
export interface HandRecord {
 key:string;at:number;role:Role;won:boolean;payoff:number;contract:Contract;teamPoints:number;
}
export function loadStats():HandRecord[] {
 const result=readDeviceRecords();return result.status==='ready'?result.records.hands.map(hand=>({...hand,contract:{...hand.contract}})):[];
}
/** Caller must confirm first; failure leaves the displayed and stored data intact. */
export function clearStats(){return deleteDeviceStats();}
