import type {PhasePresentation,FiniteChoicePhasePresentation} from '../../table/foundation';
import type {Rules} from './types';
import {actionLabel,cardLabel,cardKey,deckCards,leadLabel,SUITS,kittyCount} from './cards';

/** Every possible Play caption comes from the public deck and rules, never a hand. */
export function mightyPlayPresentation(rules:Rules):PhasePresentation {
    const calls=new Set(rules.joker_call.calls.flatMap(pair=>pair.map(cardKey)));
    const groups=deckCards(rules).map(card=>{
        const caption=cardLabel(card);
        return [caption,...('Joker'in card?[
            ...SUITS.map(suit=>`${caption} · ${leadLabel({Suit:suit})}`),
            ...(['Red','Black'] as const).map(color=>`${caption} · ${leadLabel({Color:color})}`),
        ]:[]),...(calls.has(cardKey(card))?[`${caption} · 조커콜`]:[])];
    });
    return {id:'mighty-play',schemaVersion:1,selection:{kind:'card-selection',mode:'one',submit:{prefix:'내기'},statusLabels:['카드 선택 · 0장','카드 선택 · 1장'],submitLabels:[...new Set(groups.flat())].map(caption=>`내기 ${caption}`),actionVariantLabelGroups:groups.filter(group=>group.length>1)}};
}

/** One public rules vocabulary drives both inert reservations and live fields. */
export function mightyBiddingPresentation(rules:Rules):PhasePresentation & {readonly decision:FiniteChoicePhasePresentation}{
 const {min,max,allow_no_trump,no_trump_bonus,last_chance_min}=rules.bidding;
 if(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max>255||min>max||!Number.isInteger(no_trump_bonus)||no_trump_bonus<0||no_trump_bonus>255||last_chance_min!==null&&(!Number.isInteger(last_chance_min)||last_chance_min<0||last_chance_min>255))throw Error('Invalid public bidding range');
 // Mirrors the public numeric range of state.rs bids_from/lowest_contract;
 // legal offer membership remains exclusively in native variants.
 const lowest=Math.max(1,Math.min(min,last_chance_min??min)-(allow_no_trump?no_trump_bonus:0));
 const names={Spade:'스페이드',Diamond:'다이아몬드',Heart:'하트',Club:'클로버'} as const;
 return {id:'mighty-bidding',schemaVersion:1,decision:{kind:'finite-choice',presentation:{kind:'choice-strips'},fields:[
  {id:'trump',label:'기루다',options:[...SUITS.map(suit=>({key:suit,atom:{kind:'suit' as const,suit,label:names[suit]}})),...(allow_no_trump?[{key:'no-trump',atom:{kind:'text' as const,text:'노기루다'}}]:[])]},
  {id:'count',label:'공약 수',options:Array.from({length:max-lowest+1},(_,index)=>({key:String(lowest+index),atom:{kind:'number' as const,value:lowest+index}}))}
 ],auxiliaryLabels:[actionLabel('Misdeal',()=>''),actionLabel('Pass',()=>'')],submit:{prefix:'공약',fieldIds:['trump','count']}}};
}

/** Audience-independent potential captions. Counts/trumps are public vocabulary,
 * not legal tuples; no offer/notes/hand/draft is consulted or expanded. */
export function mightyExchangePresentation(rules:Rules,remaining=kittyCount(rules),contractChanges=true,participantId?:string):PhasePresentation{
 const suits:import('../../table/decisionModel').DecisionCaptionAtom[]=[...SUITS.map(suit=>({kind:'suit' as const,suit,label:({Spade:'스페이드',Heart:'하트',Diamond:'다이아몬드',Club:'클로버'} as const)[suit]})),{kind:'text',text:'노기루다'}],numbers=Array.from({length:rules.bidding.max+1},(_,value)=>({kind:'number' as const,value})),ending=['으로 바꾸기','로 바꾸기','으로 올리기','로 올리기'].map(text=>({kind:'text' as const,join:'previous' as const,text}));
 const contract={parts:[suits,numbers]},confirm={parts:[suits,numbers,ending]},raise={parts:[numbers,ending]};
 // state.rs raises iterates public trump_options ×1..=max; legal_exchange adds
 // at most one change per trump. A collapsed one-family field can display all
 // trump raises simultaneously, so the bound covers that shape as well.
 const count=remaining,trumpCapacity=SUITS.length+(rules.bidding.allow_no_trump?1:0),contractCapacity=rules.bidding.raise_on_exchange?trumpCapacity*(rules.bidding.max+1):trumpCapacity;
 return {id:'mighty-exchange',schemaVersion:1,tableCollectionIds:[],groups:[...(contractChanges?[{...(participantId?{participantIds:[participantId]}:{}),id:'exchange-contract',kind:'finite-choice',presentation:{kind:'choice-strips'},fields:[...(rules.bidding.raise_on_exchange?[{id:'trump',visibleOptionCapacity:trumpCapacity,captionDomains:[contract]}]:[]),{id:'contract',visibleOptionCapacity:contractCapacity,captionDomains:[contract]}],submitDomains:[confirm,raise]} as const]:[]),{...(participantId?{participantIds:[participantId]}:{}),id:'mighty-discard',kind:'card-selection',mode:'count',count,submit:{prefix:'버리기'},statusLabels:Array.from({length:count+1},(_,n)=>`버릴 카드를 고르세요 · ${n}/${count}`),submitLabels:['버리기']}]};
}
