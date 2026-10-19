import {expect,test} from 'vitest';
import {friendDecision} from './friendDecision';
import {deckCards} from './cards';
import {presetRules} from './catalog';
import {initializeChoices,validateDecision} from '../../table/decision';
import type {ActionOffer} from '../../table/presentation';
import type {Action} from './types';
const rules=presetRules('default');
function offer():ActionOffer<Action>{const calls:Action[]=[...deckCards(rules).map(card=>({CallFriend:{Card:card}} as Action)),...[1,2,3,4].map(seat=>({CallFriend:{Seat:seat}} as Action)),{CallFriend:'FirstTrick'},{CallFriend:'Alone'}];return{id:'friend-offer',actions:calls.map((action,i)=>({id:`call-${i}`,kind:'command',label:`Native call ${i}`,enabled:true,intent:'primary',action}))};}
test('59 native friend actions become one catalogue with featured calls, exact bindings and held-card warnings',()=>{
 const source=offer(),hand=deckCards(rules).filter(card=>'Normal'in card&&card.Normal[0]==='Heart'),decision=friendDecision(source,hand,rules,{trump:'Spade',count:17},seat=>`Person ${seat}`);
 expect(validateDecision(decision,source)).toEqual([]);if(decision.kind!=='finite-choice')throw Error();
 expect(decision.commands).toEqual([]);expect(decision.variants).toHaveLength(59);const field=decision.fields[0];expect(field.options).toHaveLength(59);expect(field.catalogue?.featuredIds).toHaveLength(6);
 expect(field.catalogue?.groups?.flatMap(group=>group.optionIds).sort()).toEqual(field.options.map(o=>o.id).sort());expect(field.catalogue?.groups?.find(group=>group.id==='held')?.optionIds).toHaveLength(13);
 const selected=field.options.find(option=>option.id===decision.initialValues.friend)!;expect(selected.label).toBe('마이티');expect(selected.visual).toEqual({kind:'standard',suit:'Diamond',rank:14});
 expect(field.options.filter(option=>option.description)).toHaveLength(13);expect(source.actions).toHaveLength(59);
 for(const variant of decision.variants)expect(source.actions.find(a=>a.id===variant.actionId)).toBeDefined();
});
test('held mighty is never a featured default, and disabled native offers cannot be selected as enabled actions',()=>{
 const source=offer(),mighty={Normal:['Diamond',14]} as const,hand=deckCards(rules).filter(card=>'Normal'in card&&card.Normal[0]===mighty.Normal[0]),decision=friendDecision(source,hand,rules,{trump:'Spade',count:17},String);
 if(decision.kind!=='finite-choice')throw Error();const field=decision.fields[0],held=field.options.find(option=>option.label==='마이티')!;expect(field.catalogue!.featuredIds).not.toContain(held.id);expect(decision.initialValues.friend).not.toBe(held.id);
 const disabled={...source,actions:source.actions.map(action=>({...action,enabled:false}))};expect(initializeChoices(decision,disabled)).toBeNull();expect(validateDecision(decision,disabled)).toEqual([]);
});
