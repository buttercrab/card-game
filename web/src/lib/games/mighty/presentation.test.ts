import { describe, expect, test } from 'vitest';
import { resolveAction, type PresentationContext } from '../../table/presentation';
import { presetRules } from './catalog';
import { cardKey } from './cards';
import { cardActionSpecs, playableCards, projectMighty, selectPlayActions } from './presentation';
import type { Card, StateMsg } from './types';

const ace: Card = { Normal: ['Spade', 14] };
const joker: Card = { Joker: 'Red' };
const other: Card = { Normal: ['Club', 7] };
const context: PresentationContext = {
  viewer: 0, active: true, players: [{ id: 'alice', seat: 0, label: '앨리스' }, { id: 'bob', seat: 1, label: '밥' }],
};
function state(): StateMsg {
  return {
    view: {
      viewer: { Seat: 0 }, rules: presetRules('gshs'), first_bidder: 0,
      hand: [ace, joker, other], hand_sizes: [3, 9, 10, 10, 10], points_taken: [[], [], [], [], []], bids: [], redealt: null,
      phase: { Play: { declarer: 0, contract: { trump: null, count: 14 }, call: 'Alone', friend: null, no_friend: true,
        trick_no: 0, leader: 1, lead: { Suit: 'Club' }, plays: [{ seat: 1, card: { Normal: ['Club', 3] }, powered: true }],
        leading: 1, called_joker: null, tricks: [], discards: null } },
    },
    legal: [
      { Play: { card: ace, joker_lead: null, call_joker: false } },
      { Play: { card: joker, joker_lead: { Suit: 'Heart' }, call_joker: false } },
      { Play: { card: joker, joker_lead: { Color: 'Red' }, call_joker: false } },
    ],
    turn: { Seat: 0 }, out_of_turn: [], grace_ms: 0, version: 7,
    notes: { unplayable: [{ card: other, why: { MustFollow: { Suit: 'Club' } } }], contracts: [] },
  };
}

describe('Mighty authorized presentation', () => {
  test('infrastructure availability disables exact actions without rewriting rule legality',()=>{
    const supplied=state();Object.assign(supplied,{policy_actions:{legal:[supplied.legal[0]],out_of_turn:[]}});
    const projection=projectMighty(supplied,context);
    expect(supplied.legal).toHaveLength(3);expect(projection.offer.actions.map(action=>action.enabled)).toEqual([true,false,false]);
    expect(projection.cards.find(card=>card.id===cardKey(joker))).toMatchObject({enabled:false,reason:expect.stringContaining('저장 한도')});
    expect(projection.cards.find(card=>card.id===cardKey(ace))).toMatchObject({enabled:true});
  });
  test('projects only visible hand/trick cards and supplied player identities', () => {
    const supplied = state();
    const projection = projectMighty(supplied, context);
    expect(projection.cards).toHaveLength(4);
    expect(projection.cards.filter(card => card.zoneId === 'own-hand').map(card => card.id)).toEqual([ace, joker, other].map(cardKey));
    expect(projection.cards.filter(card => card.zoneId === 'current-trick').map(card => card.label)).toEqual(['♣3']);
    expect(projection.players.map(player => [player.id, player.name])).toEqual([['alice', '앨리스'], ['bob', '밥']]);
    expect(projection.status).toBe('내 차례');
    expect(projection.cards.find(card => card.id === cardKey(other))).toMatchObject({ enabled: false, reason: '♣를 따라 내야 해요' });
  });

  test('server-supplied legal cards win over any locally inferred suit or card-power rule', () => {
    const supplied = state();
    // The adapter must preserve this exact offer, even when it looks unusual.
    supplied.legal = [{ Play: { card: other, joker_lead: null, call_joker: true } }];
    const projection = projectMighty(supplied, context);
    expect(playableCards(supplied.legal, supplied.view.hand)).toEqual([other]);
    expect(projection.cards.filter(card => card.enabled).map(card => card.id)).toEqual([cardKey(other)]);
    expect(cardActionSpecs(projection, cardKey(other))[0].action).toBe(supplied.legal[0]);
  });

  test('exchange enables only cards with exact offered discard actions and respects the active gate', () => {
    const supplied = state();
    supplied.view.phase = { Exchange: { declarer: 0, contract: { trump: null, count: 14 }, trump_changed: false, discards: [] } };
    supplied.legal = [{ Discard: joker }];
    const projection = projectMighty(supplied, context);
    expect(projection.cards.filter(card => card.enabled).map(card => card.id)).toEqual([cardKey(joker)]);
    expect(cardActionSpecs(projection, cardKey(joker))).toEqual([]);
    expect(projection.offer.actions[0]).toMatchObject({ kind: 'command', enabled: true, action: { Discard: joker } });
    expect(projectMighty(supplied, { ...context, active: false }).cards.every(card => !card.enabled)).toBe(true);
  });

  test('preserves supplied bot metadata and refuses to project a private hand for another viewer', () => {
    const supplied = state();
    const players = [{ id: 'bot', seat: 1, label: '봇', kind: 'bot' as const }];
    expect(projectMighty(supplied, { ...context, players }).players[0].kind).toBe('bot');
    for (const viewer of [null, 1]) {
      const projection = projectMighty(supplied, { ...context, viewer, active: true });
      expect(projection.cards.filter(card => card.zoneId === 'own-hand')).toEqual([]);
      expect(projection.offer.actions).toEqual([]);
    }
    supplied.view.viewer = 'Spectator';
    expect(projectMighty(supplied, context).cards.filter(card => card.zoneId === 'own-hand')).toEqual([]);
  });

  test('joker variants remain separate typed commands with exact original payloads', () => {
    const supplied = state();
    const projection = projectMighty(supplied, context);
    const variants = cardActionSpecs(projection, cardKey(joker));
    expect(variants).toHaveLength(2);
    expect(new Set(variants.map(spec => spec.id)).size).toBe(2);
    expect(variants.map(spec => spec.label)).toEqual(['홍조커 · ♥', '홍조커 · 빨강']);
    expect(selectPlayActions(supplied.legal, { Joker: 'Red' })).toEqual(supplied.legal.slice(1));
    expect(selectPlayActions(supplied.legal)).toEqual(supplied.legal);
    variants.forEach((variant, index) => {
      expect(variant.action).toBe(supplied.legal[index + 1]);
      const result = resolveAction(projection.offer, projection.offer.id, variant.id);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.action).toBe(supplied.legal[index + 1]);
    });
  });

  test('an authorized observer view cannot expose opponents hands or commands', () => {
    const supplied = state();
    supplied.view.viewer = 'Spectator';
    supplied.view.hand = [];
    supplied.legal = [];
    const projection = projectMighty(supplied, { ...context, viewer: null, active: false });
    expect(projection.cards.map(card => card.zoneId)).toEqual(['current-trick']);
    expect(projection.offer.actions).toEqual([]);
    expect(projection.status).toBe('앨리스님 차례');
  });

  test('active-turn guards disable offered plays while independent off-turn Misdeal stays available', () => {
    const supplied = state();
    supplied.out_of_turn = ['Misdeal'];
    const projection = projectMighty(supplied, { ...context, active: false });
    expect(cardActionSpecs(projection, cardKey(ace))[0].enabled).toBe(false);
    expect(projection.cards.every(card => !card.enabled)).toBe(true);
    expect(projection.offer.actions.find(spec => spec.label === '딜미스')).toMatchObject({ kind: 'command', action: 'Misdeal', enabled: true });
    expect(projectMighty(supplied, { ...context, viewer: null, active: false }).offer.actions.every(spec => !spec.enabled)).toBe(true);
  });

  test('a new state offer or changed gate rejects an action submitted from the previous offer', () => {
    const supplied = state();
    const old = projectMighty(supplied, context);
    supplied.version++;
    const current = projectMighty(supplied, context);
    expect(resolveAction(current.offer, old.offer.id, old.offer.actions[0].id)).toMatchObject({ ok: false, code: 'stale_offer' });
    const disabled = projectMighty(supplied, { ...context, active: false });
    expect(disabled.offer.id).not.toBe(current.offer.id);
    expect(resolveAction(disabled.offer, disabled.offer.id, current.offer.actions[0].id)).toMatchObject({ ok: false, code: 'disabled' });
  });
});
