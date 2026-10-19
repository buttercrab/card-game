import {normalizeDecision,type DecisionInput} from '../decisionCore';
import type {TableDocument} from './contracts';
export function tableDecisionInput<A>(document:TableDocument<A>):DecisionInput<A>{return {decision:document.decision,offer:document.offer,handIds:document.hand.map(card=>card.id)};}
/** One semantic partition boundary for views and admission. */
export function validateTableDecision<A>(document:TableDocument<A>):readonly string[]{return normalizeDecision(tableDecisionInput(document)).errors;}
/** Internal IDs emitted by the one grouped control recipe. No application route. */
export const decisionGroupNamespace=(groupId:string)=>`decision-group:${groupId}`;
export const decisionGroupNodeId=(groupId:string,nodeId:string)=>JSON.stringify([decisionGroupNamespace(groupId),nodeId]);
