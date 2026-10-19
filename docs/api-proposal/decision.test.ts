import { currentEvaluation, initializeChoices, inDomain, reconcile, submitNumber, validateDecision } from './decision.ts';
import { identicalLabels, identicalLabelsOffer, mighty, mightyOffer, poker, pokerOffer, joker, hoola, oneCard, opportunities, pools, awards } from './fixtures.ts';
import type { CandidateContext, Offer, Decision } from './contracts.ts';
let passed = 0;
function test(name:string, fn:()=>void) { fn(); passed++; console.log(`ok ${passed} - ${name}`); }
function equal(actual:unknown, expected:unknown) {if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);}
test('Mighty variants and exact joker variant are valid',()=>{equal(validateDecision(mighty,mightyOffer),[]);equal(validateDecision(joker,mightyOffer),[]);});
test('editing suit pins suit and repairs unsupported count',()=>equal(reconcile(mighty,mightyOffer,mighty.initialValues,{field:'suit',option:'heart'}),{suit:'heart',count:'15'}));
test('editing count pins count and repairs unsupported suit',()=>equal(reconcile(mighty,mightyOffer,{suit:'heart',count:'15'},{field:'count',option:'14'}),{suit:'spade',count:'14'}));
test('unsupported disabled actions are never selected',()=>{const offer={...mightyOffer,actions:mightyOffer.actions.map(a=>({...a,enabled:a.id!=='h15'}))};equal(reconcile(mighty,offer,mighty.initialValues,{field:'suit',option:'heart'}),null);});
test('disabled options are never selected',()=>{const d={...mighty,fields:mighty.fields.map(f=>({...f,options:f.options.map(o=>({...o,enabled:o.id!=='heart'}))}))};equal(reconcile(d,mightyOffer,d.initialValues,{field:'suit',option:'heart'}),null);});
test('variants insertion order does not alter declared option tie order',()=>{const current={suit:'?',count:'?'};equal(reconcile({...mighty,variants:[...mighty.variants].reverse()},mightyOffer,current,{field:'suit',option:'spade'}),{suit:'spade',count:'14'});});
test('ambiguous and incomplete tuples are descriptor errors',()=>{equal(validateDecision({...mighty,variants:[...mighty.variants,mighty.variants[0]]},mightyOffer).includes('ambiguous variants tuple'),true);equal(validateDecision({...mighty,variants:[{tuple:{suit:'spade'},actionId:'s14'}]},mightyOffer).includes('incomplete variants tuple'),true);});
test('duplicate ids rejected',()=>equal(validateDecision(mighty,{...mightyOffer,actions:[...mightyOffer.actions,mightyOffer.actions[0]]}).includes('duplicate action id'),true));
test('initial tuple must be structurally complete and bound',()=>equal(validateDecision({...mighty,initialValues:{suit:'heart',count:'14'}},mightyOffer).includes('invalid initial tuple'),true));
test('poker exceptional short all-in remains separate command',()=>{equal(validateDecision(poker,pokerOffer),[]);equal(inDomain(pokerOffer.actions[0].kind==='number'?pokerOffer.actions[0].domain:{kind:'discrete',values:[]},90),false);equal(pokerOffer.actions[1].intent,'secondary');});
test('stepped origin and exact discrete domains enforced',()=>{equal(inDomain({kind:'stepped',min:12,max:30,step:5,origin:2},12),true);equal(inDomain({kind:'stepped',min:12,max:30,step:5,origin:2},15),false);equal(inDomain({kind:'discrete',values:[2,7,19]},8),false);equal(inDomain({kind:'discrete',values:[2,7,19]},7),true);});
test('safe integers and extreme difference computed exactly',()=>{equal(inDomain({kind:'stepped',min:-Number.MAX_SAFE_INTEGER,max:Number.MAX_SAFE_INTEGER,step:3,origin:-Number.MAX_SAFE_INTEGER},Number.MAX_SAFE_INTEGER),false);equal(inDomain({kind:'discrete',values:[1]},1.1),false);equal(inDomain({kind:'discrete',values:[1]},Infinity),false);});
test('factory invoked only after successful current-offer submission',()=>{let calls=0;const offer:Offer<number>={...pokerOffer,actions:[{kind:'number',id:'raise-to',enabled:true,intent:'primary',domain:{kind:'discrete',values:[125]},createAction:v=>{calls++;return v;}} ,pokerOffer.actions[1]]};equal(validateDecision(poker,offer),[]);equal(calls,0);equal(submitNumber(poker,offer,'old',125),{ok:false});equal(submitNumber(poker,offer,offer.id,126),{ok:false});equal(calls,0);equal(submitNumber(poker,offer,offer.id,125),{ok:true,action:125});equal(calls,1);});
test('invalid descriptor never invokes factory',()=>{const bad:Extract<Decision,{kind:'number'}>={...poker,initial:126};equal(submitNumber(bad,pokerOffer,pokerOffer.id,125),{ok:false});});
test('later changed field stays pinned while earlier field repairs',()=>{
 const d:Extract<Decision,{kind:'finite-choice'}>={id:'pair',kind:'finite-choice',reconciliation:'preserve-compatible',submit:{unavailable:'disabled'},commands:[],fields:[{id:'a',options:[{id:'a1',enabled:true},{id:'a2',enabled:true}]},{id:'b',options:[{id:'b1',enabled:true},{id:'b2',enabled:true}]}],variants:[{tuple:{a:'a1',b:'b2'},actionId:'s14'},{tuple:{a:'a2',b:'b1'},actionId:'s15'}],initialValues:{a:'a1',b:'b2'}};
 equal(reconcile(d,mightyOffer,d.initialValues,{field:'b',option:'b1'}),{a:'a2',b:'b1'});
});
test('identical display labels preserve distinct option and action ids',()=>{equal(validateDecision(identicalLabels,identicalLabelsOffer),[]);equal(reconcile(identicalLabels,identicalLabelsOffer,identicalLabels.initialValues,{field:'variant',option:'raise'}),{variant:'raise'});});
test('async replies need current draft, attempt, environment and privacy generation',()=>{
 const context:CandidateContext={projectionScope:'alice',privacyScopeGeneration:'9',presentation:'8',environment:'phone',draftId:'d2',attempt:'2',opportunityId:'o',offerId:'f'};
 const ready={kind:'ready' as const,context,candidateToken:'opaque'};
 equal(currentEvaluation(ready,context),ready);
 for(const key of ['privacyScopeGeneration','presentation','environment','draftId','attempt'] as const) equal(currentEvaluation(ready,{...context,[key]:'changed'}),null);
 equal(currentEvaluation({...ready,context:{...context,attempt:'1'}},context),null);
});
test('disabled default action remains valid and other enabled tuple can be edited',()=>{
 const offer={...mightyOffer,actions:mightyOffer.actions.map(a=>({...a,enabled:a.id!=='s14'}))};
 equal(validateDecision(mighty,offer),[]);
 equal(initializeChoices(mighty,offer),{suit:'spade',count:'15'});
 equal(reconcile(mighty,offer,mighty.initialValues,{field:'suit',option:'heart'}),{suit:'heart',count:'15'});
});
test('disabled default option remains valid and replacement selects eligible alternative',()=>{
 const d={...mighty,fields:mighty.fields.map(f=>({...f,options:f.options.map(o=>({...o,enabled:o.id!=='spade'}))}))};
 equal(validateDecision(d,mightyOffer),[]);equal(initializeChoices(d,mightyOffer),{suit:'heart',count:'15'});
});
test('all-disabled descriptor remains valid with unavailable executable tuple',()=>{
 const offer={...mightyOffer,actions:mightyOffer.actions.map(a=>({...a,enabled:false}))};
 equal(validateDecision(mighty,offer),[]);equal(initializeChoices(mighty,offer),null);
 equal(reconcile(mighty,offer,mighty.initialValues,{field:'suit',option:'heart'}),null);
});
test('prefix fallback commits first supported option before preserving later values',()=>{
 const d:Extract<Decision,{kind:'finite-choice'}>={...mighty,id:'three',fields:[
 {id:'a',options:[{id:'old',enabled:true},{id:'first',enabled:true},{id:'later',enabled:true}]},
 {id:'b',options:[{id:'old-b',enabled:true},{id:'fallback-b',enabled:true}]},
 {id:'c',options:[{id:'old-c',enabled:true},{id:'new-c',enabled:true}]}],
 variants:[{tuple:{a:'old',b:'old-b',c:'old-c'},actionId:'s14'},{tuple:{a:'first',b:'fallback-b',c:'new-c'},actionId:'s15'},{tuple:{a:'later',b:'old-b',c:'new-c'},actionId:'h15'}],
 initialValues:{a:'old',b:'old-b',c:'old-c'}};
 equal(reconcile(d,mightyOffer,d.initialValues,{field:'c',option:'new-c'}),{a:'first',b:'fallback-b',c:'new-c'});
});
test('replacement reset versus preserve policies choose explicit draft seed',()=>{
 const previous={suit:'heart',count:'15'};
 equal(initializeChoices(mighty,mightyOffer,previous),previous);
 equal(initializeChoices({...mighty,reconciliation:'reset-to-defaults'},mightyOffer,previous),mighty.initialValues);
});
console.log(`${passed} contract prototype tests passed`);
