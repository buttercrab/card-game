import {cardLabel,jokers,kittyCount,rankLabel} from './cards';
import {MIGHTY} from './catalog';
import type {Card as CardT,CardPolicy,Rules,TrickPolicy} from './types';
import {copyFormData} from '../../table/foundation/forms';
import {ownDisclosureDocument} from '../../table/foundation/disclosures';
import type {DisclosureCard,DisclosureCardGroup,DisclosureDocument,DisclosureSection} from '../../table/foundation/disclosureTypes';
import type {InformationPanel,InformationValue} from '../../table/foundation/contracts';
import type {Examples} from './types';
import {validateMightyEditorRules} from './ruleValidation';

/** Shared pure wording used by both the original standalone book and the
 * engine disclosure. This module owns no fetching, geometry or lifecycle. */
export const normalCard = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): CardT => ({ Normal: [suit, rank] });

export const kitty = kittyCount;

export const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

  /** The deck in words: 52장, or 7부터 A까지 28장과 ♣3, ♠3. */
export function deckText(r: Rules): string {
    const lowest = r.lowest_rank;
    const extras = r.extra_cards.map(cardLabel);
    const base = lowest === 2 ? '52장' : `네 무늬의 ${rankLabel(lowest)}부터 A까지 ${4 * (15 - lowest)}장`;
    return extras.length ? `${base}과 ${extras.join(', ')}` : base;
  }

  /** A made contract's worth: the formula, and a note after it. */
export function winFormula(r: Rules): [string, string] {
    const min = r.bidding.min;
    const w = r.scoring.win;
    if (typeof w === 'object') {
      const n = w.BothOver;
      return [`(가져온 점수 − ${n}) + (공약 − ${n})`, '(적어도 1)'];
    }
    return {
      OverTen: ['가져온 점수 − 10', '(적어도 1)'],
      OverMin: [`가져온 점수 − ${min}`, `(최소 공약 ${min}을 넘긴 만큼이라, 공약을 지켜도 0이나 그 아래일 수 있어요)`],
      OverBid: ['가져온 점수 − 공약', ''],
      BidBonus: [`가져온 점수 − 공약 + (공약 − ${min}) × 2`, '(높게 부를수록 더 얻어요)'],
    }[w] as [string, string];
  }

  /** The rest of the scoring rules as sentences. */
export function scoringLines(r: Rules): string[] {
    const s = r.scoring;
    const noTrump = r.bidding.allow_no_trump;
    const alone = r.friend.alone;
    const winDoubles = [
      noTrump && s.no_trump !== 'Never' && '노기루다면',
      alone && s.alone !== 'Never' && '노프렌드면',
      s.run && '20점을 모두 가져오면(런)',
    ].filter((x): x is string => typeof x === 'string');
    const lines: string[] = [];
    if (winDoubles.length) lines.push(`이긴 점수는 ${winDoubles.join(', ')} 두 배씩이에요.`);
    const b = s.back_run;
    const backRun =
      b === 'Never'
        ? ''
        : b === 'DefenceReachesBid'
          ? ' 야당이 공약만큼 이상 가져갔다면(백런) 두 배로 잃어요.'
          : 'TeamAtMost' in b
            ? ` ${b.TeamAtMost}점 이하로 가져왔다면(백런) 두 배로 잃어요.`
            : ` ${b.ShortBy}점 이상 모자라면(백런) 두 배로 잃어요.`;
    const lose = s.lose;
    if (lose === 'Shortfall') lines.push(`공약을 못 채우면 모자란 만큼 잃어요.${backRun}`);
    else {
      const n = lose.PaysBack;
      // Under points − 10, (contract − 10) is what making it exactly pays.
      const why = s.win === 'OverTen' && n === 10 ? ' 딱 이겼을 때 받았을 점수를 물어 주는 셈이에요.' : '';
      lines.push(`공약을 못 채우면 (공약 − ${n})에 모자란 만큼을 더해 잃어요.${why}${backRun}`);
    }
    const lossDoubles = [
      noTrump && s.no_trump === 'Always' && '노기루다',
      alone && s.alone === 'Always' && '노프렌드',
    ].filter((x): x is string => typeof x === 'string');
    if (lossDoubles.length) lines.push(`${lossDoubles.join('와 ')}는 져도 두 배예요.`);
    const full = s.full_contract;
    if (full !== 'Never') lines.push(`공약이 20이면 ${full === 'Always' ? '이기든 지든' : '이겼을 때'} 또 두 배예요.`);
    if (r.next_dealer === 'FriendOrDeclarer')
      lines.push('다음 판은 이번 판의 프렌드가, 프렌드가 없었으면 주공이 나누고 먼저 불러요.');
    return lines;
  }

  /** How much the contract's number rises to change to 노기루다 from a suit. */
  /** 은/는 or 과/와 after a number, by how it is read: 13 (십삼) takes 은. */
export function josa(n: number, closed: string, open: string): string {
    return `${n}${[0, 1, 3, 6, 7, 8].includes(n % 10) ? closed : open}`;
  }

  /** How much the number rises from 노기루다 to a suit: the cost, plus
   * what 노기루다 counted extra. */
export function fromNoTrumpCost(r: Rules): number {
    return r.bidding.change_trump_cost + r.bidding.no_trump_bonus;
  }

export function toNoTrumpCost(r: Rules): number {
    const b = r.bidding;
    return b.change_to_no_trump_cost ?? Math.max(b.change_trump_cost - b.no_trump_bonus, 0);
  }

  /** What a card policy means on one round, or null when nothing changes. */
export function policyText(p: CardPolicy): string | null {
    switch (p) {
      case 'NoEffect':
        return '낼 수는 있지만 힘이 없어요';
      case 'Invalid':
        return '낼 수 없어요 (따라 내야 하거나 그것밖에 없을 때만 예외)';
      case 'NoLead':
        return '먼저 낼 수 없어요';
      default:
        return null;
    }
  }

  /** The first- and last-round limits, one line per card that has any. */
export function roundLimits(r: Rules): { who: string; round: string; text: string }[] {
    if (!r.policy) return [];
    const rows: [string, TrickPolicy][] = [
      ['마이티', r.policy.mighty],
      ['조커', r.policy.joker],
      ['기루다', r.policy.trump],
      ['조커콜', r.policy.joker_call],
    ];
    const out: { who: string; round: string; text: string }[] = [];
    const say = (who: string, p: CardPolicy) =>
      who === '조커콜' ? (p === 'Valid' ? null : '할 수 없어요') : policyText(p);
    for (const [who, p] of rows) {
      // Trump that may not lead the first trick gets its own line below.
      const trumpLead = who === '기루다' && p.first === 'NoLead';
      const [first, last] = [trumpLead ? null : say(who, p.first), say(who, p.last)];
      if (first && first === last) out.push({ who, round: '첫 라운드와 마지막 라운드', text: first });
      else {
        if (first) out.push({ who, round: '첫 라운드', text: first });
        if (last) out.push({ who, round: '마지막 라운드', text: last });
      }
    }
    if (r.joker_lead.not_first_trick) out.push({ who: '조커', round: '첫 라운드', text: '먼저 낼 수 없어요' });
    if (r.policy.trump.first === 'NoLead')
      out.push({
        who: '기루다',
        round: '첫 라운드',
        text:
          r.policy.release_with_mighty === false
            ? '먼저 낼 수 있는 경우가 손패가 기루다뿐이거나 기루다와 조커뿐일 때뿐이에요 (기루다와 마이티뿐이면 마이티를 내요)'
            : '먼저 낼 수 있는 경우가 손패가 기루다와 마이티, 조커뿐일 때뿐이에요',
      });
    return out;
  }

export function friendWays(r: Rules): string[] {
    const f = r.friend;
    if (!f) return [];
    return [
      f.by_card && '카드로 부르기: 그 카드를 가진 사람이 프렌드예요. 카드가 나올 때 밝혀져요.',
      f.by_seat && '자리로 부르기: 그 자리에 앉은 사람이 프렌드예요.',
      f.first_trick && '첫 라운드: 첫 라운드를 이긴 사람이 프렌드예요.',
      f.last_trick && '마지막 라운드: 마지막 라운드를 이긴 사람이 프렌드예요.',
      f.alone &&
        {
          Never: '노프렌드: 혼자 해요. 야당 모두와 혼자 주고받아요.',
          Win: '노프렌드: 혼자 해요. 이기면 점수가 두 배예요.',
          Always: '노프렌드: 혼자 해요. 이기든 지든 점수가 두 배예요.',
        }[r.scoring.alone],
      f.fake && '자기가 가진 카드를 불러서 몰래 혼자 할 수도 있어요.',
    ].filter((x): x is string => typeof x === 'string');
  }

export function misdealNumber(r: Rules, value: number): string {
  const halve = r.misdeal.point_value === 2 && r.misdeal.joker_value % 2 === 0;
  if (!halve) return String(value);
  const whole = Math.trunc(value / 2);
  return value % 2 === 0 ? String(whole) : `${value < 0 ? '-' : ''}${whole !== 0 ? Math.abs(whole) : ''}½`;
}

export function misdealText(r: Rules): string[] {
    const m = r.misdeal;
    if (!m) return [];
    // Values kept whole by doubling (a point card 2, a ten 1) read better
    // halved, as players count them: 1 and ½.
    const num = (value: number) => misdealNumber(r, value);
    const value = (v: number) => (v > 0 ? `+${num(v)}` : num(v));
    const parts = [`점수 카드 ${value(m.point_value)}`];
    if (m.joker_value !== 0) parts.push(`조커 ${value(m.joker_value)}`);
    for (const [card, v] of m.card_values) parts.push(`${cardLabel(card)} ${value(v)}`);
    const when =
      m.window === 'BeforeFirstBid'
        ? '패를 받자마자, 누가 첫 공약을 하기 전까지'
        : m.window === 'AllBidding'
          ? '패를 받자마자, 공약이 끝나기 전까지 (이미 공약했더라도)'
          : '패를 받자마자, 자기가 공약하기 전까지';
    const lines = [
      `받은 패가 약하면 ${when} 다시 나눠 달라고 할 수 있어요 (딜미스). ${parts.join(', ')}점으로 세어 ${num(m.threshold)}점 이하일 때예요.`,
    ];
    lines.push('자기 차례가 아니어도 되고, 패스한 뒤에는 못 해요. 먼저 부른 사람의 딜미스예요. 그 사람은 패를 보여 줘요.');
    if (m.window === 'BeforeFirstBid')
      lines.push(
        `첫 공약은 패를 받고 ${MIGHTY.first_bid_grace_ms / 1000}초쯤 기다렸다가 할 수 있어요. 그사이 딜미스할 사람이 있는지 봐요.`,
      );
    if (m.caller_deals) lines.push('딜미스를 한 사람이 새로 나눈 판에서 먼저 불러요.');
    if (m.all_points) lines.push('받은 카드가 모두 점수 카드여도 딜미스를 할 수 있어요.');
    if (m.declarer) lines.push('주공도 키티를 가져온 뒤 버리기 전에, 가진 카드 전부로 세어 딜미스를 할 수 있어요.');
    return lines;
  }

export type MightyRulebookExamples={readonly status:'loading'|'unavailable'}|{readonly status:'ready';readonly rulesKey:string;readonly value:unknown};
export interface MightyRulebookInput {readonly entryId:string;readonly rules:unknown;readonly examples?:MightyRulebookExamples;}
const text=(value:string)=>({kind:'text' as const,text:value});
const row=(label:string,value:string):{label:string;value:InformationValue}=>({label,value:text(value)});
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
/** Equality token only; hosts separately fence room, selection and connection. */
export function mightyRulebookKey(rules:unknown):string{return canonical(validateMightyEditorRules(rules));}
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,keys:readonly string[]):value is Record<string,any>=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
// The registered Mighty profile proves every unit/payoff is below1,000,000
// for all typed custom formulas. This also keeps payout sums/multiplication exact.
const safe=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&Math.abs(value)<=1_000_000;
function ownExamples(input:unknown,rules:Rules,key:string):Examples|null{
 try{
  const response=copyFormData(input);
  if(!exact(response,['status','rulesKey','value'])||response.status!=='ready'||response.rulesKey!==key)return null;
  const value=response.value;
  if(!exact(value,['contract','alone','made','failed'])||typeof value.alone!=='boolean'||!exact(value.contract,['trump','count'])||value.contract.trump!=='Spade'||value.contract.count!==Math.min(rules.bidding.min+1,20))return null;
  const alone=!(rules.friend.by_card||rules.friend.by_seat||rules.friend.first_trick||rules.friend.last_trick);
  if(value.alone!==alone)return null;
  for(const [name,points] of [['made',Math.min(value.contract.count+2,20)],['failed',Math.max(value.contract.count-2,0)]] as const){
   const example=value[name];
   if(!exact(example,['value','payoffs'])||!exact(example.value,['contract','team_points','made','steps','value'])||canonical(example.value.contract)!==canonical(value.contract)||example.value.team_points!==points||example.value.made!==(points>=value.contract.count)||!safe(example.value.value)||!Array.isArray(example.value.steps)||example.value.steps.length>32||!Array.isArray(example.payoffs)||example.payoffs.length!==rules.players||!example.payoffs.every(safe))return null;
   const unit=example.value.value,defenders=rules.players-(alone?1:2);
   if(example.payoffs.some((payoff:number,index:number)=>payoff!==(index===0?unit*(defenders-(alone?0:1)):!alone&&index===1?unit:-unit))||example.payoffs.reduce((sum:number,payoff:number)=>sum+payoff,0)!==0)return null;
  }
  return value as Examples;
 }catch{return null;}
}

/** Public rule meaning only. Eight sections, <=4 panels/section and12 fields/
 * panel. All54 card overrides survive in <=4-atom fields; artwork is read-only.
 * Fetching, geometry, private cards and command authority are deliberately absent. */
export function createMightyRulebook(input:MightyRulebookInput):DisclosureDocument{
 const field=(name:string)=>{const descriptor=Object.getOwnPropertyDescriptor(input,name);return descriptor&&'value'in descriptor?descriptor.value:undefined;};
 const owned={entryId:field('entryId'),rules:field('rules'),examples:field('examples') as MightyRulebookExamples|undefined};
 const r=validateMightyEditorRules(owned.rules),key=canonical(r);
 const cards:DisclosureCard[]=[],refs=new Map<string,string>(),sections:DisclosureSection[]=[];
 const add=(card:CardT):string=>{const physical=canonical(card),prior=refs.get(physical);if(prior)return prior;const id=`c:${cards.length}`;refs.set(physical,id);cards.push({id,label:cardLabel(card),visual:'Normal'in card?{kind:'standard',suit:card.Normal[0],rank:card.Normal[1]}:{kind:'joker',color:card.Joker}});return id;};
 const group=(id:string,label:string,values:readonly CardT[]):DisclosureCardGroup=>({id,label,cardIds:values.map(add)});
 const section=(id:string,title:string,rows:readonly {label:string;value:InformationValue}[],cardGroups:readonly DisclosureCardGroup[]=[])=>{
  const information:InformationPanel[]=[];
  for(let offset=0;offset<rows.length;offset+=12)information.push({id:`${id}:${offset/12}`,title:offset?`${title} · 계속`:title,fields:rows.slice(offset,offset+12).map((field,index)=>({id:`${id}:${offset+index}`,...field}))});
  sections.push({id,title,kind:'content',information,...(cardGroups.length?{cardGroups}:{})});
 };
 section('deal','목표·카드 나누기',[
  row('목표','공약을 가장 높게 부른 주공과 프렌드가 여당, 나머지는 야당이에요. 노프렌드는 주공 혼자 여당이에요. 여당은 부른 점수 이상을 가져와야 해요.'),
  row('점수 카드','10, J, Q, K, A는 한 장에1점, 모두20점이에요.'),
  row('나누기',`${deckText(r)}에 조커 ${jokers(r).length}장을 더해 ${r.players}명에게 ${r.hand_size}장씩 나누고, 남은 ${kitty(r)}장은 키티로 엎어 둬요.`),
  row('다음 판',r.next_dealer==='Rotate'?'다음 판은 다음 자리부터 차례대로 나누고 먼저 불러요.':'다음 판은 이번 판의 프렌드가, 프렌드가 없었으면 주공이 나누고 먼저 불러요.'),
 ],[group('points','점수 카드',[10,11,12,13,14].map(rank=>normalCard('Heart',rank))),...(r.extra_cards.length?[group('extra','낮은 숫자 중 덱에 남기는 카드',r.extra_cards)]:[])]);
 const misdealRows=misdealText({...r,misdeal:{...r.misdeal,card_values:[]}}).map((line,index)=>row(index?'추가 규칙':'딜미스',line));
 for(let offset=0;offset<r.misdeal.card_values.length;offset+=4)misdealRows.push({label:'카드별 값 (기본값 대신)',value:{kind:'inline',values:r.misdeal.card_values.slice(offset,offset+4).map(([card,value])=>text(`${cardLabel(card)} ${value>0?'+':''}${misdealNumber(r,value)}`))}});
 if(!r.misdeal.card_values.length)misdealRows.push(row('카드별 값','별도 카드별 값은 없어요. 점수 카드와 조커의 기본값으로 세어요.'));
 section('misdeal','딜미스',misdealRows,r.misdeal.card_values.length?[group('overrides','별도 값이 있는 카드',r.misdeal.card_values.map(([card])=>card))]:[]);
 const b=r.bidding;
 section('bidding','공약',[
  row('패스',b.pass_is_final?'차례대로 기루다(으뜸 무늬)와 가져올 점수를 부르거나 패스해요. 한 번 패스하면 그 판에는 다시 못 불러요.':'차례대로 기루다와 가져올 점수를 부르거나 패스해요. 더 높은 공약이 나오면 패스한 사람도 다시 부를 수 있어요. 한 사람을 빼고 모두 잇달아 패스하면 그 사람이 주공이에요.'),
  row('기본 공약 범위',`기루다 숫자는 ${b.min}부터 ${b.max}까지예요.${b.allow_no_trump?` 노기루다 숫자는 ${b.min-b.no_trump_bonus}부터 ${b.max}까지예요. 노기루다는 숫자에 ${b.no_trump_bonus}를 더한 높이로 비교해요.`:''} 앞사람보다 높은 공약을 불러야 해요.`),
  row('노기루다',b.allow_no_trump?`노기루다(기루다 없음)도 부를 수 있어요. ${b.no_trump_bonus?`노기루다 ${josa(b.min-b.no_trump_bonus,'은','는')} 기루다 ${josa(b.min,'과','와')} 같은 높이예요. `:''}${b.no_trump_wins_ties?'높이가 같으면 노기루다가 이겨요.':'같은 높이로는 못 덮고, 더 높아야 해요.'}`:'노기루다는 없어요.'),
  row('첫 사람',b.first_bidder_may_pass?'첫 사람도 패스할 수 있어요.':'첫 사람은 패스할 수 없고 꼭 불러야 해요.'),
  row('모두 패스',b.last_chance_min!==null?`첫 사람이 한 번 더 높이 ${b.last_chance_min}부터 부를 수 있어요.${b.allow_no_trump?' 노기루다의 높이는 숫자에 보너스를 더해 비교하므로, 숫자는 이 높이보다 작을 수 있어요.':''} 또 패스하면 같은 사람이 다시 나눠요.`:'모두 패스하면 다시 나눠요.'),
  row('끝나는 때',`아무도 더 높게 부를 수 없는 공약(${b.allow_no_trump?'풀노':b.max})이 나오면 공약은 바로 끝나요.`),
 ]);
 section('exchange','키티·프렌드',[
  row('교환',`주공이 키티 ${kitty(r)}장을 가져가고 ${kitty(r)}장을 버려요. 버린 점수 카드는 ${r.scoring.discards_to_declarer?'여당':'야당'} 점수가 돼요.`),
  row('공개',r.reveal_discards?'버린 카드는 판이 끝나면 공개해요.':'버린 카드는 끝나도 보여 주지 않아요.'),
  row('공약 올리기',b.raise_on_exchange?'버리기 전에 공약 수를 올릴 수 있어요. 기루다를 바꾸면서 더 올려도 돼요.':'기루다를 그대로 두고 공약 수만 올릴 수는 없어요.'),
  row('기루다 바꾸기',b.change_trump_cost?`공약을 ${b.change_trump_cost} 올려야 해요.`:'공약을 올리지 않고 기루다를 바꿀 수 있어요.'),
  ...(b.allow_no_trump?[row('노기루다로 바꾸기',`${toNoTrumpCost(r)} 올려요.`),row('노기루다에서 무늬로 바꾸기',`${fromNoTrumpCost(r)} 올려요.`)]:[]),
  ...friendWays(r).map(line=>row('프렌드를 정하는 방법',line)),
 ]);
 const two=jokers(r).length===2;
 section('power','카드의 힘',[
  row('순서',two?'마이티 → 기루다 색 조커 → 기루다 → 다른 색 조커 → 처음 낸 무늬 순서예요.':'마이티 → 조커 → 기루다 → 처음 낸 무늬 순서예요.'),
  row('마이티','♠A. 기루다가 ♠이면 ♦A가 마이티예요.'),
  row('조커',two?'기루다가 ♠♣이면 흑조커, ♥♦이면 홍조커가 높은 조커예요. 노기루다면 처음 낸 색의 조커예요.':'조커는 마이티 다음으로 강해요.'),
  row('무늬','기루다와 처음 낸 무늬 안에서는 높은 숫자가 이겨요. 다른 무늬는 이길 수 없어요. 첫·마지막 라운드의 제한과 조커콜은 아래 규칙을 따라요.'),
 ],[group('mighty','마이티',[normalCard('Spade',14),normalCard('Diamond',14)]),group('jokers','조커',jokers(r)),group('trump','기루다 예시',[normalCard('Heart',14)]),group('lead','처음 낸 무늬 예시',[normalCard('Club',13)])]);
 section('play','카드 내기·조커콜·라운드 제한',[
  row('시작','주공이 첫 라운드를 시작하고, 라운드를 이긴 사람이 다음 라운드를 시작해요.'),
  row('따라 내기','처음 낸 무늬가 있으면 그 무늬를 내야 해요. 없으면 아무 카드나 낼 수 있어요.'),
  row('마이티·조커','마이티와 조커는 언제든 낼 수 있어요. 마이티도 그 무늬의 카드라서 따라 낼 카드가 마이티뿐이면 내야 해요. 조커가 있으면 대신 낼 수 있지만, 조커는 낼 의무가 없어요. 라운드별 제한은 아래와 같아요.'),
  row('조커 선두',`조커로 시작하면 따라 낼 무늬를 정해요.${two?' 조커 색의 무늬만 정할 수 있어요.':''}${r.joker_lead.by_color?' 무늬 대신 색을 정할 수도 있어요. 그 색 카드가 있으면 그 색 카드를 내야 해요.':''}`),
  row('힘없는 조커',r.joker_lead.powerless_passes?'힘없는 조커로 시작하면 다음 사람이 낸 카드의 무늬를 따라요.':'힘없는 조커로 시작해도 정한 무늬·색을 따라요.'),
  ...r.joker_call.calls.map(([call,fallback],index)=>row('조커콜',`${cardLabel(call)}${'Normal'in call&&canonical(call)!==canonical(fallback)?` (기루다가 ${cardLabel(call).slice(0,1)}이면 ${cardLabel(fallback)})`:''}로 시작하면서 콜하면 ${two?cardLabel(jokers(r)[index]):'조커'}를 가진 사람은 그 조커를 내야 해요.`)),
  row('불려 나온 조커',r.joker_call.called_joker_has_power?'불려 나온 조커도 힘이 있어요.':'불려 나온 조커는 힘이 없어요.'),
  row('콜 막기',r.joker_call.mighty_defense?'조커 대신 마이티를 내서 막을 수도 있어요.':'마이티로 조커콜을 막을 수 없어요.'),
  ...roundLimits(r).map(limit=>row(`${limit.round} · ${limit.who}`,`${limit.text}.`)),
 ],r.joker_call.calls.map(([call,fallback],index)=>group(`call:${index}`,`${two?cardLabel(jokers(r)[index]):'조커'}를 부르는 카드`,!('Normal'in call)||canonical(call)===canonical(fallback)?[call]:[call,fallback])));
 const [formula,note]=winFormula(r);
 section('score','점수 계산',[
  row('성공',`여당이 공약 이상을 가져오면 ${formula}${note}만큼 얻어요.`),
  ...scoringLines(r).map(line=>row('계산 규칙',line)),
  row('주고받기','야당은 한 사람마다 한 몫을 내고, 프렌드는 한 몫을 받아요. 주공은 야당 수만큼 받은 뒤 프렌드 몫을 뺀 만큼 가져요. 노프렌드는 야당 모두와 혼자 주고받아요. 모두 더하면 항상0이에요.'),
 ]);
 const example=ownExamples(owned.examples,r,key);
 if(example){const rows=[row('예시 범위','서버가 현재 규칙으로 계산한 예시예요. 설명용 공약 수는20 이하이므로, 사용자 규칙의 실제 합법 공약 범위와 다를 수 있어요.'),row('공약',`♠ ${example.contract.count} · ${example.alone?'노프렌드':'1번 자리가 주공, 2번 자리가 프렌드'}`)];
  for(const [label,value] of [['가져왔을 때',example.made],['모자랐을 때',example.failed]] as const){rows.push(row(label,`${value.value.team_points}점 획득 · 한 몫 ${signed(value.value.value)}점`));for(let index=0;index<value.payoffs.length;index++)rows.push(row(`${label} · ${index+1}번 ${index===0?'주공':!example.alone&&index===1?'프렌드':'야당'}`,`${signed(value.payoffs[index])}점`));}
  section('examples','서버 계산 예시',rows);
 }else section('examples','서버 계산 예시',[row('안내',Object.getOwnPropertyDescriptor(owned.examples??{},'status')?.value==='loading'?'현재 규칙의 서버 계산 예시를 불러오고 있어요.':'서버 계산 예시를 아직 읽지 못했어요. 공식과 규칙 설명은 위에서 볼 수 있어요. 예시를 임의로 계산하거나 다른 규칙의 응답을 사용하지 않아요.')]);
 return ownDisclosureDocument({entryId:owned.entryId,title:'마이티 규칙',roster:[],cards,sections});
}
