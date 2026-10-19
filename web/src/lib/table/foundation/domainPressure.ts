import type {Suit} from '../../cardTypes';
import type {CommandSpec} from '../presentation';
import type {TableCard,TableDocument} from './contracts';

/** Explicit pressure variants: no jokers, claims, timer arbitration or production multiplayer. */
export type DomainPressureKind='hulla'|'one-card';
export type DomainPressureAction=
 | {kind:'draw'} | {kind:'discard';cardId:string}
 | {kind:'meld';cardIds:readonly string[]} | {kind:'add';cardId:string;targetId:string}
 | {kind:'play';cardId:string;suit?:Suit};
export interface DomainPressureState {
 readonly kind:DomainPressureKind; readonly generation:number; readonly revision:number; readonly actor:0|1; readonly phase:'draw'|'arrange'|'play'|'done';
 readonly hands:readonly (readonly TableCard[])[]; readonly stock:readonly TableCard[]; readonly discard:readonly TableCard[];
 readonly melds:readonly {id:string;cards:readonly TableCard[]}[]; readonly effectiveSuit:Suit; readonly penalty:number; readonly winner:0|1|null; readonly outcome:'empty-hand'|'stock-exhausted'|null;
}
const card=(suit:Suit,rank:number):TableCard=>({id:`${suit}:${rank}`,label:`${suit} ${rank}`,visual:{kind:'standard',suit,rank}});
const face=(card:TableCard)=>{if(card.visual.kind!=='standard')throw new Error('Pressure variant requires standard cards');return card.visual;};
const suits:readonly Suit[]=['Spade','Heart','Diamond','Club'];
/** The authority must issue a fresh generation for every restart of this fixture. */
export function initialDomainPressure(kind:DomainPressureKind,generation=1):DomainPressureState{
 if(!Number.isSafeInteger(generation)||generation<1)throw new Error('Invalid pressure generation');
 return {kind,generation,revision:0,actor:0,phase:kind==='hulla'?'draw':'play',hands:kind==='hulla'?[[card('Club',3),card('Club',4),card('Club',5),card('Club',6),card('Heart',9)],[]]:[[card('Spade',8),card('Heart',2),card('Club',5)],[card('Heart',5),card('Diamond',2),card('Spade',9)]],
 stock:kind==='hulla'?[card('Heart',10),card('Heart',8)]:[card('Club',3),card('Heart',7),card('Diamond',5),card('Club',6),card('Diamond',9),card('Club',9)],
 discard:kind==='hulla'?[]:[card('Heart',9)],melds:kind==='hulla'?[{id:'public:clubs',cards:[card('Club',7),card('Club',8),card('Club',9)]},{id:'public:hearts',cards:[card('Heart',5),card('Heart',6),card('Heart',7)]}]:[],effectiveSuit:'Heart',penalty:0,winner:null,outcome:null};
}
export function isPressureMeld(cards:readonly TableCard[]):boolean{
 if(cards.length<3||new Set(cards.map(card=>card.id)).size!==cards.length)return false;
 const faces=cards.map(face);
 if(new Set(faces.map(card=>card.rank)).size===1)return new Set(faces.map(card=>card.suit)).size===cards.length;
 const ranks=faces.map(card=>card.rank).sort((a,b)=>a-b);
 return new Set(faces.map(card=>card.suit)).size===1&&ranks.every((rank,index)=>index===0||rank===ranks[index-1]+1);
}
const combinations=(cards:readonly TableCard[],size:number):TableCard[][]=>size===0?[[]]:cards.flatMap((card,index)=>combinations(cards.slice(index+1),size-1).map(rest=>[card,...rest]));
const actionKey=(action:DomainPressureAction)=>JSON.stringify(action.kind==='meld'?{...action,cardIds:[...action.cardIds].sort()}:action);
export function domainPressureActions(state:DomainPressureState,actor:0|1=state.actor):readonly DomainPressureAction[]{
 if(state.phase==='done'||actor!==state.actor)return [];
 const hand=state.hands[actor];
 if(state.kind==='hulla'){
  if(state.phase==='draw')return state.stock.length?[{kind:'draw'}]:[];
  return [
   ...Array.from({length:Math.max(0,hand.length-2)},(_,i)=>combinations(hand,i+3)).flat().filter(isPressureMeld).map(cards=>({kind:'meld' as const,cardIds:cards.map(card=>card.id)})),
   ...hand.flatMap(card=>state.melds.filter(meld=>isPressureMeld([...meld.cards,card])).map(meld=>({kind:'add' as const,cardId:card.id,targetId:meld.id}))),
   ...hand.map(card=>({kind:'discard' as const,cardId:card.id})),
  ];
 }
 const top=state.discard.at(-1)!;
 const plays=hand.filter(card=>state.penalty?face(card).rank===2:face(card).rank===8||face(card).suit===state.effectiveSuit||face(card).rank===face(top).rank)
  .flatMap(card=>face(card).rank===8?suits.map(suit=>({kind:'play' as const,cardId:card.id,suit})):[{kind:'play' as const,cardId:card.id}]);
 return [...plays,...(state.stock.length>=(state.penalty||1)?[{kind:'draw' as const}]:[])];
}
export function applyDomainPressure(state:DomainPressureState,expected:{readonly generation:number;readonly revision:number},actor:0|1,action:DomainPressureAction):DomainPressureState{
 if(expected.generation!==state.generation||expected.revision!==state.revision||!domainPressureActions(state,actor).some(legal=>actionKey(legal)===actionKey(action)))throw new Error('Stale or illegal pressure action');
 let next:DomainPressureState={...state,revision:state.revision+1};
 const remove=(ids:readonly string[])=>state.hands.map((hand,index)=>index===actor?hand.filter(card=>!ids.includes(card.id)):hand);
 if(action.kind==='draw'){
  const count=state.kind==='one-card'?(state.penalty||1):1;
  next={...next,stock:state.stock.slice(count),hands:state.hands.map((hand,index)=>index===actor?[...hand,...state.stock.slice(0,count)]:hand),phase:state.kind==='hulla'?'arrange':'play',penalty:0,actor:state.kind==='hulla'?actor:actor===0?1:0};
 }else if(action.kind==='meld'){
  const selected=state.hands[actor].filter(card=>action.cardIds.includes(card.id));
  next={...next,hands:remove(action.cardIds),melds:[...state.melds,{id:`meld:${state.revision}`,cards:selected}]};
 }else if(action.kind==='add'){
  const selected=state.hands[actor].find(card=>card.id===action.cardId)!;
  next={...next,hands:remove([selected.id]),melds:state.melds.map(meld=>meld.id===action.targetId?{...meld,cards:[...meld.cards,selected]}:meld)};
 }else{
  const selected=state.hands[actor].find(card=>card.id===action.cardId)!;
  next={...next,hands:remove([selected.id]),discard:[...state.discard,selected]};
  if(action.kind==='discard')next={...next,phase:'draw'}; // One local Hulla turn at a time; no simulated opponent arbitration.
  else next={...next,actor:actor===0?1:0,effectiveSuit:action.suit??face(selected).suit,penalty:face(selected).rank===2?state.penalty+2:0};
 }
 if(next.hands[actor].length===0)next={...next,phase:'done',winner:actor,outcome:'empty-hand'};
 else if(!domainPressureActions(next).length)next={...next,phase:'done',winner:null,outcome:'stock-exhausted'};
 return next;
}
export function domainPressureDocument(state:DomainPressureState,viewer:0|1=0):TableDocument<DomainPressureAction>{
 const actions:CommandSpec<DomainPressureAction>[]=domainPressureActions(state,viewer).map(action=>({id:actionKey(action),kind:'command',intent:'primary',enabled:true,label:action.kind==='draw'?state.penalty?`페널티 ${state.penalty}장 받기`:'한 장 받기':action.kind==='meld'?`묶음 놓기 ${action.cardIds.join(' / ')}`:action.kind==='add'?`${action.cardId} → ${action.targetId}`:action.kind==='discard'?`${action.cardId} 버리기`:`${action.cardId} 내기${action.suit?` · ${action.suit} 선언`:''}`,action}));
 const groups=new Map<string,CommandSpec<DomainPressureAction>[]>();
 for(const action of actions){const ids=action.action.kind==='meld'?action.action.cardIds:action.action.kind==='draw'?[]:[action.action.cardId];if(ids.length){const key=JSON.stringify([...ids].sort());groups.set(key,[...(groups.get(key)??[]),action]);}}
 const variants=[...groups].filter(([,actions])=>actions.length===1).map(([key,actions])=>({cardIds:JSON.parse(key) as string[],actionId:actions[0].id}));
 const variantIds=new Set(variants.map(variant=>variant.actionId));
 const plays=actions.filter(action=>action.action.kind==='play');
 let decision:TableDocument<DomainPressureAction>['decision']=variants.length?{kind:'card-selection',id:'pressure-cards',commands:actions.filter(action=>!variantIds.has(action.id)).map(action=>action.id),mode:'many',variants,submit:{prefix:'선택 확정'}}:{kind:'commands',id:'pressure-commands',commands:actions.map(action=>action.id)};
 if(plays.some(action=>action.action.kind==='play'&&action.action.suit)){
  const ids=[...new Set(plays.map(action=>action.action.kind==='play'?action.action.cardId:''))];
  const declarations=[...new Set(plays.map(action=>action.action.kind==='play'?action.action.suit??'unchanged':'unchanged'))];
  const rows=plays.map(action=>({tuple:{card:action.action.kind==='play'?action.action.cardId:'',suit:action.action.kind==='play'?action.action.suit??'unchanged':'unchanged'},actionId:action.id}));
  decision={kind:'finite-choice',id:'pressure-card-suit',commands:actions.filter(action=>!plays.includes(action)).map(action=>action.id),fields:[{id:'card',label:'낼 카드',options:ids.map(id=>({id,label:id,enabled:true}))},{id:'suit',label:'선언 무늬',options:declarations.map(id=>({id,label:id==='unchanged'?'원래 무늬':id,enabled:true}))}],variants:rows,initialValues:rows[0].tuple,reconciliation:'preserve-compatible',submit:{unavailable:'disabled',presentationLabel:{prefix:'내기 확정'}}};
 }
 // Ambiguous card+target/suit candidates remain exact commands. The current
 // selection API has no joint target/suit draft, so it must never guess one.
 return {context:{session:`domain-pressure:${state.kind}`,audience:`seat:${viewer}`,generation:String(state.generation),revision:String(state.revision)},participant:{id:`seat:${viewer}`,name:`플레이어 ${viewer+1}`,markers:[]},hand:state.hands[viewer],opponents:[{id:`seat:${1-viewer}`,name:`플레이어 ${2-viewer}`,handCount:state.hands[1-viewer].length}],
 collections:[{id:'stock',purpose:'stock',label:'비공개 뽑기 더미',cards:[],hiddenCount:state.stock.length},{id:'discard',purpose:'play',label:'공개 버림 더미',cards:state.discard},...state.melds.map(meld=>({...meld,label:meld.id}))],
 facts:[{id:'variant',label:'명시적 압력 변형',value:state.kind==='hulla'?'조커·가로채기 없음 · 런/세트 3장 이상 · 손이 비면 종료 · 덱 부족 시 무승부 · 로컬 차례 반복':'8은 무늬 선언 · 2는 +2 누적 · 받으면 차례 종료 · 손이 비면 종료 · 덱 부족 시 무승부',subject:'table',essential:false},{id:'status',label:'진행',value:state.outcome==='stock-exhausted'?'덱 부족 · 무승부 (압력 변형 종료)':state.winner!==null?`플레이어 ${state.winner+1} 승리`:`플레이어 ${state.actor+1} · ${state.phase}`,subject:'table',essential:true},...(state.kind==='one-card'?[{id:'effective-suit',label:'유효 무늬',value:state.effectiveSuit,subject:'table' as const,essential:true},{id:'penalty',label:'누적 페널티',value:String(state.penalty),subject:'table' as const,essential:true}]:[])],
 offer:{id:`domain:${state.kind}:${state.generation}:${state.revision}:${viewer}`,actions},decision};
}
