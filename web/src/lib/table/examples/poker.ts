import type { ActionSpec, CardSpec, GamePresentation } from '../presentation';

/** A presentation fixture, not poker rules or a playable server game. */
export type PokerAction = { kind: 'fold' } | { kind: 'call'; amount: number } | { kind: 'raise'; amount: number };
export interface PokerCard { id: string; rank: string; suit: string }
export interface PokerSnapshot {
  id: string;
  offerId: string;
  viewerId: string | null;
  players: readonly { id: string; seat: number; name: string; chips: number; hole: readonly PokerCard[] | null }[];
  community: readonly PokerCard[];
  pot: number;
  /** These options are supplied by an authoritative producer, not inferred. */
  legal: { fold: boolean; callAmount: number | null; raise: { min: number; max: number; step: number; initial: number; enabled?: boolean; reason?: string } | null };
}

export function createPokerPresentation(snapshot: PokerSnapshot): GamePresentation<PokerAction> {
  const cards: CardSpec[] = snapshot.community.map(card => ({...card,zoneId:'community',label:`${card.suit} ${card.rank}`,face:'up'}));
  for (const player of snapshot.players) {
    if (player.id === snapshot.viewerId && player.hole) {
      cards.push(...player.hole.map((card,index) => ({...card,id:`hole:${player.id}:${index}`,zoneId:`hole:${player.id}`,label:`${card.suit} ${card.rank}`,face:'up' as const})));
    } else {
      // Hidden cards expose only stable slot identity, never rank or suit.
      cards.push(...[0,1].map(index => ({id:`hole:${player.id}:${index}`,zoneId:`hole:${player.id}`,label:'비공개 카드',face:'down' as const})));
    }
  }
  const participant = snapshot.players.some(player => player.id === snapshot.viewerId);
  const actions: ActionSpec<PokerAction>[] = participant ? [{id:'fold',label:'폴드',kind:'command',intent:'quiet',enabled:snapshot.legal.fold,reason:snapshot.legal.fold ? undefined : '현재 폴드를 선택할 수 없어요.',action:{kind:'fold'}}] : [];
  const callAmount = snapshot.legal.callAmount;
  if (participant && callAmount !== null) actions.push({id:'call',label:`콜 ${callAmount}`,kind:'command',intent:'secondary',enabled:true,action:{kind:'call',amount:callAmount}});
  const raise = snapshot.legal.raise;
  if (participant && raise) actions.push({id:'raise',label:'레이즈',inputLabel:'레이즈 금액',kind:'number',intent:'primary',...raise,enabled:raise.enabled ?? true,createAction:amount => ({kind:'raise',amount})});
  // Example projection only: include supplied parameters and viewer identity so
  // even a producer reusing its version cannot accidentally reuse a stale draft.
  const offerId = JSON.stringify([snapshot.offerId,snapshot.viewerId,snapshot.legal.fold,callAmount,
    raise ? [raise.min,raise.max,raise.step,raise.initial,raise.enabled ?? true,raise.reason ?? null] : null]);
  return {
    id:snapshot.id,
    zones:[{id:'community',kind:'table',label:'공통 카드'}, ...snapshot.players.map(player => ({id:`hole:${player.id}`,kind:'hand' as const,label:`${player.name} 카드`,ownerId:player.id}))],
    cards,
    players:snapshot.players.map(player => ({id:player.id,seat:player.seat,name:player.name,kind:'human',counters:[{label:'칩',value:player.chips}]})),
    offer:{id:offerId,actions},
    status:`팟 ${snapshot.pot} · 제시된 베팅 선택지`,
  };
}

export const POKER_EXAMPLE: PokerSnapshot = {
  id:'poker-presentation-example',offerId:'example:flop:7',viewerId:'me',pot:150,
  players:[
    {id:'me',seat:0,name:'나',chips:800,hole:[{id:'my-spade-ace',rank:'A',suit:'♠'},{id:'my-heart-king',rank:'K',suit:'♥'}]},
    {id:'other',seat:1,name:'수연',chips:1100,hole:null},
  ],
  community:[{id:'club-queen',rank:'Q',suit:'♣'},{id:'diamond-jack',rank:'J',suit:'♦'},{id:'spade-seven',rank:'7',suit:'♠'}],
  legal:{fold:true,callAmount:50,raise:{min:100,max:800,step:25,initial:100}},
};
