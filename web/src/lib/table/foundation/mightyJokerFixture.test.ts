import {expect,test} from 'vitest';
import {mightyJokerDocument} from './mightyJokerFixture';
import {validateTableDecision} from './decisions';
import {selectedCardActions,selectedCardAction} from './cardSelection';

test('real Mighty Joker QA projection preserves exact lead actions and policy-disabled choice',()=>{
    const document=mightyJokerDocument(),joker=JSON.stringify({Joker:'Red'});
    expect(validateTableDecision(document)).toEqual([]);
    expect(document.hand.map(card=>card.id)).toContain(joker);
    expect(document.hand).toHaveLength(4);
    expect(document.opponents).toHaveLength(4);
    expect(document.decision.kind).toBe('card-selection');
    if(document.decision.kind!=='card-selection')throw Error('Expected card selection');
    expect(document.decision.disambiguation).toBe('choose-action');
    const variants=document.decision.variants.filter(row=>row.cardIds.includes(joker));
    expect(variants).toHaveLength(3);
    const offered=variants.map(row=>document.offer.actions.find(action=>action.id===row.actionId)!);
    expect(offered.map(action=>action.enabled)).toEqual([true,true,false]);
    expect(offered.map(action=>action.label)).toEqual(['홍조커 · ♠','홍조커 · ♥','홍조커 · 빨강']);
    expect(offered.map(action=>action.kind==='command'&&action.action.kind==='game'?action.action.action:null)).toEqual([
        {Play:{card:{Joker:'Red'},joker_lead:{Suit:'Spade'},call_joker:false}},
        {Play:{card:{Joker:'Red'},joker_lead:{Suit:'Heart'},call_joker:false}},
        {Play:{card:{Joker:'Red'},joker_lead:{Color:'Red'},call_joker:false}},
    ]);
    expect(selectedCardActions(document.decision,document.offer,[joker]).map(option=>option.enabled)).toEqual([true,true,false]);
    expect(selectedCardAction(document.decision,document.offer,[joker],offered[2].id)).toBeNull();
});
