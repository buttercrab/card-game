import { expect, test } from 'vitest';
import { resolveAction } from '../presentation';
import { createPokerPresentation, POKER_EXAMPLE } from './poker';

test('projects supplied chips/cards and hides opponent card details', () => {
  const snapshot = {...POKER_EXAMPLE,players:POKER_EXAMPLE.players.map(player => player.id === 'other' ? {...player,hole:[{id:'secret-card',rank:'A',suit:'♦'}]} : player)};
  const projection = createPokerPresentation(snapshot);
  expect(projection.players[0].counters).toEqual([{label:'칩',value:800}]);
  expect(projection.cards.filter(card=>card.zoneId==='community')).toHaveLength(3);
  expect(projection.cards.filter(card=>card.zoneId==='hole:me')).toHaveLength(2);
  expect(projection.cards.filter(card=>card.zoneId==='hole:other').every(card=>card.face==='down'&&card.rank===undefined&&card.suit===undefined)).toBe(true);
  expect(JSON.stringify(projection)).not.toContain('secret-card');
});
test('uses server-supplied call/raise options and resolves exact payloads', () => {
  const {offer} = createPokerPresentation(POKER_EXAMPLE);
  expect(resolveAction(offer,offer.id,'call')).toEqual({ok:true,action:{kind:'call',amount:50}});
  expect(resolveAction(offer,offer.id,'raise',175)).toEqual({ok:true,action:{kind:'raise',amount:175}});
  expect(resolveAction(offer,offer.id,'raise',151)).toMatchObject({ok:false,code:'invalid_step'});
  expect(resolveAction(offer,'example:flop:6','raise',175)).toMatchObject({ok:false,code:'stale_offer'});
  expect(createPokerPresentation({...POKER_EXAMPLE,legal:{fold:false,callAmount:null,raise:null}}).offer.actions).toHaveLength(1);
});
test('observers receive no actions and see no private face even when source contains it', () => {
  for (const viewerId of [null,'watcher']) {
    const projection = createPokerPresentation({...POKER_EXAMPLE,viewerId});
    expect(projection.offer.actions).toEqual([]);
    expect(projection.cards.filter(card=>card.zoneId.startsWith('hole:')).every(card=>card.face==='down'&&card.rank===undefined&&card.suit===undefined)).toBe(true);
  }
});
test('visibility changes retain opaque hole-slot identity without carrying face fields', () => {
  const visible=createPokerPresentation(POKER_EXAMPLE).cards.filter(card=>card.zoneId==='hole:me');
  const hidden=createPokerPresentation({...POKER_EXAMPLE,viewerId:null}).cards.filter(card=>card.zoneId==='hole:me');
  expect(hidden.map(card=>card.id)).toEqual(visible.map(card=>card.id));
  expect(hidden.every(card=>card.label==='비공개 카드'&&card.face==='down'&&card.rank===undefined&&card.suit===undefined)).toBe(true);
  expect(hidden.map(card=>card.id).join(',')).not.toMatch(/spade|heart|ace|king/i);
});
test('changed supplied range invalidates drafts even if producer version stays unchanged', () => {
  const first = createPokerPresentation(POKER_EXAMPLE).offer;
  const second = createPokerPresentation({...POKER_EXAMPLE,legal:{...POKER_EXAMPLE.legal,raise:{min:200,max:600,step:50,initial:200}}}).offer;
  expect(second.id).not.toBe(first.id);
  expect(resolveAction(second,first.id,'raise',250)).toMatchObject({ok:false,code:'stale_offer'});
  const disabled = createPokerPresentation({...POKER_EXAMPLE,legal:{...POKER_EXAMPLE.legal,raise:{...POKER_EXAMPLE.legal.raise!,enabled:false,reason:'다른 사람이 선택하는 중이에요.'}}}).offer;
  expect(resolveAction(disabled,disabled.id,'raise',250)).toMatchObject({ok:false,code:'disabled',reason:'다른 사람이 선택하는 중이에요.'});
});
