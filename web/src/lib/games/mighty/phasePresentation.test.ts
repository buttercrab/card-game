import {expect,test} from 'vitest';
import {mightyBiddingPresentation,mightyPlayPresentation} from './phasePresentation';
import {presetRules} from './catalog';
import {deckCards,cardLabel} from './cards';
import {ownPhasePresentation} from '../../table/foundation/presentationCohort';
test('public deck vocabulary includes every single-card caption and rule-bound variants',()=>{
 for(const preset of ['default','two-jokers'] as const){
  // Start with supported rules; alter only public deck membership for the two-joker domain.
  const rules=presetRules('default');if(preset==='two-jokers')rules.deck='TwoJokers';
  const presentation=ownPhasePresentation(mightyPlayPresentation(rules));
  expect(presentation.selection!.submitLabels.length).toBeLessThanOrEqual(104);
  for(const card of deckCards(rules))expect(presentation.selection!.submitLabels).toContain(`내기 ${cardLabel(card)}`);
  expect(presentation.selection!.submitLabels).toContain('내기 흑조커 · 검정');
  if(preset==='two-jokers')expect(presentation.selection!.submitLabels).toContain('내기 홍조커 · ♠');
 }
});

import {mightyDocument} from './foundation';
import {createCardSession} from '../../table/foundation/session';
import type {RoomView,StateMsg,Mighty} from './types';
import type {ConnectedProjectionClient} from '../../table/foundation/connected';
test('real Bidding producer publishes the same public reservation before any own turn and across private legal offers',()=>{
 const rules=presetRules('default'),room:RoomView={id:'phase',game:'mighty',protocol:'test',settings:{preset:'default'},rules,customized:false,seats:Array.from({length:5},(_,i)=>({kind:'human',name:`P${i}`,connected:true,away:false})),in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),participant_ids:['p0','p1','p2','p3','p4'],participation:[],scores:Array(5).fill(0),hands_played:0,history:[],hands:[]};
 const state:StateMsg={version:1,grace_ms:0,turn:{Seat:1},legal:[],out_of_turn:[],notes:{unplayable:[],contracts:[]},view:{viewer:{Seat:0},rules,first_bidder:0,hand:[{Normal:['Club',2]}],hand_sizes:Array(5).fill(10),points_taken:Array.from({length:5},()=>[]),bids:[],redealt:null,phase:{Bidding:{to_act:1,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}}}};
 const client:ConnectedProjectionClient<Mighty>={room,game:state,seat:0,viewerId:'p0',viewerName:'P0'},passive=mightyDocument(client,1)!;
 const active=mightyDocument({...client,game:{...state,version:2,turn:{Seat:0},legal:[{Bid:{trump:'Spade',count:14}},{Bid:{trump:'Heart',count:16}},'Pass']}},2)!,changed=mightyDocument({...client,game:{...state,version:3,turn:{Seat:0},legal:[{Bid:{trump:'Heart',count:19}}],view:{...state.view,hand:[{Joker:'Black'}]}}},3)!;
 expect(passive.decision.kind).toBe('commands');expect(passive.offer.actions).toEqual([]);expect(passive.presentation).toEqual(active.presentation);expect(changed.presentation).toEqual(passive.presentation);expect(active.presentation).toEqual({...mightyBiddingPresentation(rules),tableCollectionIds:[]});
 expect(active.decision.kind).toBe('finite-choice');if(active.decision.kind!=='finite-choice')throw Error('Active bid');expect(active.decision.fields[0].options.map(option=>option.label)).toEqual(['스페이드','하트']);expect(active.decision.fields[1].options.map(option=>option.label)).toEqual(['14','16']);expect(active.decision.variants).toHaveLength(2);
 const session=createCardSession({transport:()=>{}});session.receive(passive);session.receive(active);session.receive(changed);expect(session.snapshot().document?.presentation?.decision).toBeDefined();expect(JSON.stringify(passive.presentation)).not.toContain('Normal');expect(JSON.stringify(passive.presentation)).not.toContain('Joker');session.dispose();
});

test('public Bidding vocabulary includes no-trump bonus and last-chance minima without creating actions',()=>{
 const rules=presetRules('default');rules.bidding.min=14;rules.bidding.max=20;rules.bidding.no_trump_bonus=1;rules.bidding.last_chance_min=13;rules.bidding.allow_no_trump=true;
 const domain=ownPhasePresentation(mightyBiddingPresentation(rules)).decision!;expect(domain.fields[1].options.map(option=>option.key)).toEqual(['12','13','14','15','16','17','18','19','20']);expect(domain.auxiliaryLabels).toEqual(['딜미스','패스']);
 rules.bidding.allow_no_trump=false;const without=ownPhasePresentation(mightyBiddingPresentation(rules)).decision!;expect(without.fields[0].options).toHaveLength(4);expect(without.fields[1].options[0].key).toBe('13');
});

import {mightyExchangePresentation} from './phasePresentation';
test.each([false,true])('Exchange capacities derive only from public rules and cover every collapsed-family caption at raise%s',raises=>{const rules=presetRules('default');rules.bidding.max=255;rules.bidding.raise_on_exchange=raises;for(const noTrump of [false,true]){rules.bidding.allow_no_trump=noTrump;const expectedTrumps=4+Number(noTrump),publicValue=ownPhasePresentation(mightyExchangePresentation(rules,3,true,'p0')),group=publicValue.groups!.find(group=>group.kind==='finite-choice')!;if(group.kind!=='finite-choice')throw Error();expect(group.fields.map(field=>field.visibleOptionCapacity)).toEqual(raises?[expectedTrumps,expectedTrumps*256]:[expectedTrumps]);expect(JSON.stringify(publicValue)).not.toMatch(/actionId|payload|enabled|cardIds/);}});
