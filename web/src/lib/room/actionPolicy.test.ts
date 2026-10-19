import {expect,test} from 'vitest';
import {readActionPolicy,policyAllowsAction} from './actionPolicy';
test('legacy absence preserves rule availability while an explicit empty policy disables it',()=>{
 const source={legal:['Pass','Bid'],out_of_turn:['Misdeal']};
 expect(readActionPolicy(source)).toMatchObject({valid:true,limited:false,legal:source.legal,out_of_turn:source.out_of_turn});
 expect(readActionPolicy({...source,policy_actions:{legal:['Bid'],out_of_turn:[]}})).toMatchObject({valid:true,limited:true,legal:['Bid'],out_of_turn:[]});
 expect(readActionPolicy({...source,policy_actions:{legal:[],out_of_turn:[]}})).toMatchObject({valid:true,limited:true,legal:[],out_of_turn:[]});
 expect(source).toEqual({legal:['Pass','Bid'],out_of_turn:['Misdeal']});
});
test('policy cannot invent actions, duplicate them, or promote on-turn actions to off-turn',()=>{
 const source={legal:['Bid'],out_of_turn:['Misdeal']};
 for(const policy_actions of [null,[],{legal:['Reveal'],out_of_turn:[]},{legal:['Bid','Bid'],out_of_turn:[]},{legal:[],out_of_turn:['Bid']},{legal:[],out_of_turn:[],bypass:true}]){
  expect(readActionPolicy({...source,policy_actions})).toMatchObject({valid:false,legal:[],out_of_turn:[]});
 }
});
test('structural wire identity ignores object key order and owns admitted values without stale memoization',()=>{
 const action={Play:{card:['Spade',14],lead:null}},candidate={Play:{lead:null,card:['Spade',14]}};
 const source={legal:[action],out_of_turn:[],policy_actions:{legal:[candidate],out_of_turn:[]}};
 const first=readActionPolicy(source);expect(first.valid).toBe(true);expect(Object.isFrozen(first.legal[0])).toBe(true);
 candidate.Play.card[1]=13;expect(readActionPolicy(source).valid).toBe(false);expect(first.legal[0]).toEqual({Play:{lead:null,card:['Spade',14]}});
});
test('policy accessors are rejected without invoking them',()=>{
 let calls=0;const source=Object.defineProperty({legal:['Bid'],out_of_turn:[]},'policy_actions',{enumerable:true,get(){calls++;return undefined;}});
 expect(readActionPolicy(source).valid).toBe(false);expect(calls).toBe(0);
 const policy={legal:['Bid'],out_of_turn:[]};Object.defineProperty(policy.legal,'0',{enumerable:true,get(){calls++;return 'Bid';}});
 expect(readActionPolicy({legal:['Bid'],out_of_turn:[],policy_actions:policy}).valid).toBe(false);expect(calls).toBe(0);
});
test('final policy admission respects turn plane and never replaces a refused restart',()=>{
 const source={legal:['Pass','Bid'],out_of_turn:['Misdeal'],policy_actions:{legal:['Bid'],out_of_turn:[]}};
 expect(policyAllowsAction(source,'Bid',true)).toBe(true);expect(policyAllowsAction(source,'Bid',false)).toBe(false);
 expect(policyAllowsAction(source,'Pass',true)).toBe(false);expect(policyAllowsAction(source,'Misdeal',false)).toBe(false);
 expect(source.legal).toEqual(['Pass','Bid']);
});
