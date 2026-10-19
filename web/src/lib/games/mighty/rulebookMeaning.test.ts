import {expect,test} from 'vitest';
import {MIGHTY} from './catalog';
import {deckCards} from './cards';
import {RULE_FIELDS,getPath,setField,problems} from './ruleFields';
import {createMightyRulebook,mightyRulebookKey,scoringLines,winFormula,misdealText,roundLimits,fromNoTrumpCost,toNoTrumpCost} from './rulebookMeaning';
import {ownDisclosureDocument} from '../../table/foundation/disclosures';
import type {Examples,Rules} from './types';
const rules=():Rules=>structuredClone(MIGHTY.rule_defaults);
const words=(value:unknown)=>JSON.stringify(value);
const make=(r:Rules=rules(),examples?:Parameters<typeof createMightyRulebook>[0]['examples'])=>createMightyRulebook({entryId:'rulebook:current',rules:r,...(examples?{examples}:{})});
function example(r:Rules):Examples{
 const count=Math.min(r.bidding.min+1,20),alone=!(r.friend.by_card||r.friend.by_seat||r.friend.first_trick||r.friend.last_trick),contract={trump:'Spade' as const,count};
 const one=(points:number,unit:number)=>({value:{contract,team_points:points,made:points>=count,value:unit,steps:[]},payoffs:Array.from({length:r.players},(_,index)=>index===0?unit*(r.players-(alone?1:3)):!alone&&index===1?unit:-unit)});
 return {contract,alone,made:one(Math.min(count+2,20),7),failed:one(Math.max(count-2,0),-3)};
}
test('all shipped tables retain full bounded read-only meaning and artwork',()=>{
 for(const preset of MIGHTY.presets){const doc=make(preset.rules);expect(doc.sections.map(s=>s.id)).toEqual(['deal','misdeal','bidding','exchange','power','play','score','examples']);expect(words(doc)).toContain(`${preset.rules.players}명에게 ${preset.rules.hand_size}장씩`);expect(()=>ownDisclosureDocument(doc)).not.toThrow();expect(Object.isFrozen(doc.sections)).toBe(true);expect(words(doc)).not.toMatch(/ownerId|entityId|callback|command|style/);}
 const r=rules(),doc=make(r);r.bidding.min=17;expect(words(doc)).not.toContain('17부터');expect(doc.cards.length).toBeGreaterThan(5);
});
test('max255 custom rules and all54 overrides fit without omission or truncation',()=>{
 const r=rules();r.deck='TwoJokers';r.players=8;r.hand_size=6;r.lowest_rank=10;r.extra_cards=deckCards({...r,lowest_rank:2,extra_cards:[]}).filter(card=>'Normal'in card&&card.Normal[1]<10);
 r.joker_call.calls=[[{Normal:['Club',3]},{Normal:['Spade',3]}],[{Normal:['Diamond',3]},{Normal:['Heart',3]}]];
 r.bidding.min=255;r.bidding.max=255;r.bidding.no_trump_bonus=254;r.bidding.change_trump_cost=255;r.bidding.change_to_no_trump_cost=255;
 r.misdeal.point_value=127;r.misdeal.joker_value=127;r.misdeal.threshold=-128;r.misdeal.card_values=deckCards(r).map((card,index)=>[card,index%2?127:-128]);r.misdeal.all_points=true;r.misdeal.declarer=true;r.misdeal.caller_deals=true;
 r.friend={by_card:true,by_seat:true,first_trick:true,last_trick:true,alone:true,fake:true};
 const doc=make(r);expect(doc.sections).toHaveLength(8);expect(doc.cards).toHaveLength(54);expect(words(doc)).toContain('509 올려요');expect(fromNoTrumpCost(r)).toBe(509);expect(toNoTrumpCost(r)).toBe(255);
 const section=doc.sections.find(s=>s.id==='misdeal')!;if(section.kind!=='content')throw Error();expect(section.cardGroups![0].cardIds).toHaveLength(54);expect(section.information!.flatMap(p=>p.fields).filter(f=>f.label.startsWith('카드별 값'))).toHaveLength(14);expect(new TextEncoder().encode(words(doc)).length).toBeLessThan(128*1024);
});
test('formula, scoring, friend, pass, call and all round-policy enum branches remain meaningful',()=>{
 const r=rules();
 const wins:Rules['scoring']['win'][]=['OverTen','OverMin','OverBid','BidBonus',{BothOver:255}];for(const win of wins){r.scoring.win=win;expect(words(make(r))).toContain(winFormula(r)[0]);}
 for(const lose of ['Shortfall',{PaysBack:0}] as Rules['scoring']['lose'][]){r.scoring.lose=lose;expect(words(make(r))).toContain(scoringLines(r)[1]??scoringLines(r)[0]);}
 for(const back of ['Never','DefenceReachesBid',{TeamAtMost:255},{ShortBy:255}] as Rules['scoring']['back_run'][]){r.scoring.back_run=back;expect(()=>make(r)).not.toThrow();if(typeof back==='object')expect(words(make(r))).toContain('255');}
 for(const mode of ['Never','Win','Always'] as const){r.scoring.no_trump=mode;r.scoring.alone=mode;r.scoring.full_contract=mode;expect(()=>make(r)).not.toThrow();}
 for(const window of ['OwnTurnUntilBid','AllBidding','BeforeFirstBid'] as const){r.misdeal.window=window;expect(words(make(r))).toContain(misdealText({...r,misdeal:{...r.misdeal,card_values:[]}})[0]);}
 for(const value of ['Valid','NoEffect','NoLead','Invalid'] as const){for(const name of ['mighty','joker','trump','joker_call'] as const)r.policy[name]={first:value,last:value};for(const limit of roundLimits(r))expect(words(make(r))).toContain(limit.text);}
 r.bidding.allow_no_trump=false;r.bidding.pass_is_final=false;r.bidding.last_chance_min=null;r.friend.fake=false;r.friend.by_card=false;r.friend.by_seat=false;r.friend.first_trick=false;r.friend.last_trick=false;r.friend.alone=true;r.reveal_discards=false;
 const doc=make(r);expect(words(doc)).toContain('노기루다는 없어요');expect(words(doc)).toContain('더 높은 공약이 나오면');expect(words(doc)).toContain('끝나도 보여 주지');expect(words(doc)).toContain('혼자 해요');expect(RULE_FIELDS).toHaveLength(43);
});
test('worked server examples retain every payout; stale or malformed responses never become evidence',()=>{
 const r=rules(),value=example(r),key=mightyRulebookKey(r),doc=make(r,{status:'ready',rulesKey:key,value});expect(words(doc)).toContain('한 몫 +7점');expect(words(doc)).toContain('모자랐을 때');expect(words(doc)).toContain('2번 프렌드');
 const changed=rules();changed.bidding.min++;expect(words(make(changed,{status:'ready',rulesKey:key,value}))).toContain('아직 읽지 못했어요');value.made.payoffs[0]++;expect(words(make(r,{status:'ready',rulesKey:key,value}))).not.toContain('한 몫 +7점');expect(words(make(r,{status:'loading'}))).toContain('불러오고 있어요');
});
test('server count20 under custommin255 is explicitly illustrative, never a legal bid claim',()=>{
 const r=rules();r.bidding.min=255;r.bidding.max=255;r.bidding.no_trump_bonus=254;const doc=make(r,{status:'ready',rulesKey:mightyRulebookKey(r),value:example(r)});expect(words(doc)).toContain('♠ 20');expect(words(doc)).toContain('실제 합법 공약 범위와 다를 수 있어요');
});
test('unknown/accessor rules refuse without executing getters; keys are independent of field order',()=>{
 const r=rules();let calls=0;Object.defineProperty(r.bidding,'min',{get(){calls++;return 14;},enumerable:true});expect(()=>make(r)).toThrow();expect(calls).toBe(0);
 const unknown=rules() as Rules&{privateHand?:unknown};unknown.privateHand=[{Joker:'Red'}];expect(()=>make(unknown)).toThrow();const r2=rules();expect(mightyRulebookKey(Object.fromEntries(Object.entries(r2).reverse()))).toBe(mightyRulebookKey(r2));
});

test('every one of the43 declared rule fields has admitted nondefault read-only coverage',()=>{
 const covered=new Set<string>();let admitted=0;
 for(const field of RULE_FIELDS){
  const base=rules();base.deck='TwoJokers';if(base.joker_call.calls.length===1)base.joker_call.calls.push([{Normal:['Heart',3]},{Normal:['Diamond',3]}]);
  const current=getPath(base,field.path),control=field.control;let values:unknown[]=[];
  switch(control.kind){
   case 'toggle':values=[!current];break;
   case 'segment':values=control.options.map(option=>option.value);break;
   case 'stepper':values=[control.min,control.max,Math.min(control.max,current+1)];break;
   case 'maybe':values=[null,control.start,control.max];break;
   case 'rounds':values=control.options.flatMap(option=>[{first:option.value,last:current.last},{first:current.first,last:option.value}]);break;
   case 'flags':values=control.options.map(option=>({...current,[option.key]:!current[option.key]}));break;
   case 'cardValues':values=[[],[[{Normal:['Spade',14]},-3]]];break;
  }
  for(const value of values){if(words(value)===words(current))continue;const candidate=structuredClone(base);setField(candidate,field,value);if(problems(candidate).length)continue;expect(()=>make(candidate),field.path).not.toThrow();covered.add(field.path);admitted++;}
 }
 expect([...covered].sort()).toEqual(RULE_FIELDS.map(field=>field.path).sort());expect(admitted).toBeGreaterThan(70);
});
test('unreadable/stale example data cannot remove rule explanations or execute response accessors',()=>{
 const r=rules(),response={status:'ready' as const,rulesKey:mightyRulebookKey(r),value:example(r)};let calls=0;
 Object.defineProperty(response,'value',{enumerable:true,get(){calls++;throw Error('not inert');}});
 expect(words(make(r,response))).toContain('아직 읽지 못했어요');expect(calls).toBe(0);
 const input={entryId:'book',rules:r};Object.defineProperty(input,'privateCache',{get(){calls++;throw Error('private');}});
 const doc=createMightyRulebook(input);expect(doc.sections).toHaveLength(8);expect(calls).toBe(0);
 const bad=example(r);bad.made.value.value=Number.MAX_SAFE_INTEGER;expect(words(make(r,{status:'ready',rulesKey:mightyRulebookKey(r),value:bad}))).toContain('아직 읽지 못했어요');
});

test('card override fractions match shared standalone wording and joker call cards never invent a suit',()=>{
 const r=rules();r.misdeal.point_value=2;r.misdeal.joker_value=0;r.misdeal.card_values=[[{Normal:['Spade',14]},3],[{Normal:['Club',2]},-1]];
 let doc=make(r);expect(words(doc)).toContain('♠A +1½');expect(words(doc)).toContain('♣2 -½');
 r.joker_call.calls[0]=[{Joker:'Black'},{Normal:['Club',3]}];doc=make(r);expect(words(doc)).not.toContain('기루다가 흑');const play=doc.sections.find(section=>section.id==='play')!;if(play.kind!=='content')throw Error();expect(play.cardGroups![0].cardIds).toHaveLength(1);
});

test('bid height differs from printed no-trump count; unsupported missing-point/bonus rules refuse',()=>{
 const r=rules();r.bidding.min=14;r.bidding.max=20;r.bidding.no_trump_bonus=1;expect(words(make(r))).toContain('기루다 숫자는 14부터 20까지');expect(words(make(r))).toContain('노기루다 숫자는 13부터 20까지');
 const missing=rules();missing.lowest_rank=14;missing.players=2;missing.hand_size=1;expect(()=>make(missing)).toThrow();const invalid=rules();invalid.bidding.min=2;invalid.bidding.no_trump_bonus=255;expect(()=>make(invalid)).toThrow();
});
