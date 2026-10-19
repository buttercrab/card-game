import {expect,test} from 'vitest';
import {MIGHTY,PRESETS,presetRules} from './catalog';
import {deckCards,deckSize} from './cards';
import {problems} from './ruleFields';
import {RULE_TEXT} from './refusals';
import type {Rules,Card} from './types';
const base=():Rules=>structuredClone(MIGHTY.rule_defaults);
const has=(rules:Rules,message:string)=>problems(rules).some(problem=>problem.message===message);
test('all generated server presets remain valid under the complete client checks',()=>{
 for(const preset of PRESETS)expect(problems(presetRules(preset.id)),preset.id).toEqual([]);
});
test('fake friend needs card friendship even when another friend method remains enabled',()=>{
 const rules=base();rules.friend.by_card=false;expect(has(rules,RULE_TEXT.fake_without_card)).toBe(true);rules.friend.fake=false;expect(has(rules,RULE_TEXT.fake_without_card)).toBe(false);
});
test('misdeal boundary cases match the Rust meaningless_rules_are_refused fixtures',()=>{
 const rules=presetRules('default');rules.misdeal.threshold=19;expect(has(rules,RULE_TEXT.always_misdeal)).toBe(false);rules.misdeal.threshold=20;expect(has(rules,RULE_TEXT.always_misdeal)).toBe(true);
 const all=base();all.misdeal.all_points=true;all.misdeal.threshold=8;expect(has(all,RULE_TEXT.always_misdeal)).toBe(false);all.misdeal.threshold=9;expect(has(all,RULE_TEXT.always_misdeal)).toBe(true);
});
test('actual deck membership excludes absent jokers and ignores invented or duplicate extra cards',()=>{
 const rules=base();rules.deck='OneJoker';rules.joker_call.calls=[[{Joker:'Red'},{Normal:['Spade',3]}]];expect(has(rules,RULE_TEXT.joker_call_not_in_deck)).toBe(true);
 rules.extra_cards=[{Normal:['Spade',0]}];expect(deckSize(rules)).toBe(53);expect(deckCards(rules).some(card=>'Normal' in card&&card.Normal[1]===0)).toBe(false);
 rules.lowest_rank=3;rules.extra_cards=[{Normal:['Spade',2]},{Normal:['Spade',2]}];expect(deckSize(rules)).toBe(50);expect(has(rules,RULE_TEXT.bad_extra_cards)).toBe(true);
});
test('the first duplicate override retains server semantics without normalizing the model',()=>{
 const rules=base(),card:Card={Normal:['Spade',14]};rules.misdeal.point_value=0;rules.misdeal.joker_value=0;rules.misdeal.all_points=false;rules.misdeal.threshold=1;rules.misdeal.card_values=[[card,1],[card,127]];
 expect(has(rules,RULE_TEXT.always_misdeal)).toBe(true);expect(rules.misdeal.card_values).toHaveLength(2);rules.misdeal.card_values.reverse();expect(has(rules,RULE_TEXT.always_misdeal)).toBe(false);
});
test.each([{all:true,point:2,joker:-1,extra:4},{all:false,point:-1,joker:3,extra:-2},{all:true,point:0,joker:0,extra:-3}])('bounded maximum-hand check agrees with exhaustive three-card hands: %o',value=>{
 const rules=base();rules.lowest_rank=10;rules.hand_size=3;rules.players=2;rules.extra_cards=[{Normal:['Spade',2]}];rules.misdeal.all_points=value.all;rules.misdeal.point_value=value.point;rules.misdeal.joker_value=value.joker;rules.misdeal.card_values=[[{Normal:['Spade',2]},value.extra],[{Normal:['Heart',10]},-3]];
 const cards=deckCards(rules),point=(card:Card)=>'Normal' in card&&card.Normal[1]>=10;
 const score=(card:Card)=>rules.misdeal.card_values.find(([candidate])=>JSON.stringify(candidate)===JSON.stringify(card))?.[1]??('Joker' in card?value.joker:point(card)?value.point:0);
 let best=-Infinity;
 for(let a=0;a<cards.length;a++)for(let b=a+1;b<cards.length;b++)for(let c=b+1;c<cards.length;c++){
  const hand=[cards[a],cards[b],cards[c]];if(value.all&&hand.every(point))continue;best=Math.max(best,hand.reduce((sum,card)=>sum+score(card),0));
 }
 rules.misdeal.threshold=best-1;expect(has(rules,RULE_TEXT.always_misdeal)).toBe(false);rules.misdeal.threshold=best;expect(has(rules,RULE_TEXT.always_misdeal)).toBe(true);
});
