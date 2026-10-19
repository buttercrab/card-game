import {expect,test} from 'vitest';
import {ownOutcome,type OutcomeDescriptor} from './outcome';
import type {TableDocument} from './contracts';
const outcome=():OutcomeDescriptor=>({id:'hand-1',informationId:'result',continuationActionIds:['next']});
const document=():TableDocument<string>=>({context:{session:'s',audience:'a',generation:'h',revision:'1'},participant:{id:'me',name:'나',markers:[]},hand:[],facts:[],information:[{id:'result',title:'결과',fields:[]}],decision:{kind:'commands',id:'decision',commands:['next']},offer:{id:'offer',actions:[{id:'next',kind:'command',label:'다음 판',intent:'primary',enabled:false,action:'start'}]}});
test('settled references retain canonical disabled commands and own only descriptor data',()=>{
 const input=outcome(),doc=document(),owned=ownOutcome(input,doc);expect(owned).toEqual(input);expect(owned).not.toBe(input);expect(Object.isFrozen(owned.continuationActionIds)).toBe(true);(input.continuationActionIds as string[]).push('other');expect(owned.continuationActionIds).toEqual(['next']);expect(doc.offer.actions[0].enabled).toBe(false);
});
test('missing or duplicate panels and unknown or duplicate continuation refs are refused',()=>{
 const missing={...document(),information:[]};expect(()=>ownOutcome(outcome(),missing)).toThrow();
 const base=document();const duplicate={...base,information:[...base.information!,...base.information!]};expect(()=>ownOutcome(outcome(),duplicate)).toThrow();
 for(const continuationActionIds of [['unknown'],['next','next'],Array.from({length:9},(_,i)=>`a${i}`)])expect(()=>ownOutcome({...outcome(),continuationActionIds},document())).toThrow();
 const unlisted:TableDocument<string>={...document(),decision:{kind:'commands',id:'decision',commands:[]}};expect(()=>ownOutcome(outcome(),unlisted)).toThrow();
});
test('finite/card selection variants cannot be reinterpreted as continuation commands',()=>{
 const doc:TableDocument<string>={...document(),decision:{kind:'card-selection',id:'select',mode:'one',commands:['next'],variants:[{cardIds:['card'],actionId:'next'}],submit:{prefix:'확정'}}};expect(()=>ownOutcome(outcome(),doc)).toThrow();
});
test('shell and outcome cannot both own the same command including implicit leave',()=>{
 const shell={roomCode:'room',header:{codeLabel:'room',connection:'open',connectionLabel:'연결',observerCount:0,observerLabel:'관전',requestCount:0,requestLabel:'요청',actions:[]},pages:[],effects:[],notices:[],leaveActionId:'next'} satisfies NonNullable<TableDocument<string>['shell']>;
 const doc={...document(),shell};
 expect(()=>ownOutcome(outcome(),doc)).toThrow();
 const withHeader:TableDocument<string>={...doc,shell:{...shell,leaveActionId:undefined,header:{...shell.header,actions:[{id:'shell-next',purpose:'operation',label:'다음 판',enabled:true,intent:{kind:'command',actionId:'next'}}]}}};expect(()=>ownOutcome(outcome(),withHeader)).toThrow();
});
test('unsupported extra capabilities and accessors are rejected without invocation',()=>{
 let calls=0;const input=Object.defineProperty({...outcome()},'id',{get(){calls++;return 'h';},enumerable:true});expect(()=>ownOutcome(input,document())).toThrow();expect(calls).toBe(0);
 expect(()=>ownOutcome({...outcome(),detailsDisclosureId:'unimplemented'} as OutcomeDescriptor,document())).toThrow();
});
test('details reference exactly one offered catalog and never creates a continuation command',()=>{
 const offer={id:'history',policyId:'public-history',revision:'1',title:'기록',total:1,pageSize:12 as const,scope:{roomId:'r',roomEpoch:'e',actorId:'a',connectionEpoch:'c',visibility:'public' as const}};
 const input={...outcome(),detailsCatalogId:offer.id};
 expect(()=>ownOutcome(input,document())).toThrow();
 expect(()=>ownOutcome(input,{...document(),disclosures:[offer,offer]})).toThrow();
 expect(ownOutcome(input,{...document(),disclosures:[offer]})).toEqual(input);
 expect(ownOutcome(input,{...document(),disclosures:[offer]}).continuationActionIds).toEqual(['next']);
});

test('compact result fields own only bounded exact unique references to the result panel',()=>{
 const base=document(),doc={...base,information:[{...base.information![0],fields:[{id:'contract',label:'공약',value:{kind:'text' as const,text:'노기루다 17'}},{id:'points',label:'획득',value:{kind:'number' as const,value:18}}]}]},refs=['contract','points'];
 const owned=ownOutcome({...outcome(),compactFieldIds:refs},doc);refs[0]='foreign';expect(owned.compactFieldIds).toEqual(['contract','points']);expect(Object.isFrozen(owned.compactFieldIds)).toBe(true);
 for(const compactFieldIds of [['missing'],['contract','contract'],Array(5).fill('points')])expect(()=>ownOutcome({...outcome(),compactFieldIds},doc)).toThrow();
 const duplicate={...doc,information:[{...doc.information[0],fields:[...doc.information[0].fields,doc.information[0].fields[0]]}]};expect(()=>ownOutcome({...outcome(),compactFieldIds:['contract']},duplicate)).toThrow();
 let reads=0;const accessor=Object.defineProperty({...outcome()},'compactFieldIds',{get(){reads++;return ['contract'];},enumerable:true});expect(()=>ownOutcome(accessor,doc)).toThrow();expect(reads).toBe(0);
});
