import {expect,test} from 'vitest';
import {createMightyHistoryDisclosure} from './historyDisclosure';
import {completionFixture} from './testSupport/completionFixture';
import {copyFormData} from '../../table/foundation/forms';
import type {MightyHistoryInput} from './history';
import {deckCards} from './cards';
import type {View} from './types';
function fixture():MightyHistoryInput {const f=completionFixture();return {identity:{roomId:'room',roomEpoch:'epoch',sessionId:2,handNumber:3},record:f.room!.current_hand!};}
test('selected public record maps to one short card library and frozen local roster, rounds and matrix',()=>{
 const source=fixture(),doc=createMightyHistoryDisclosure({entryId:'catalog-row:2',source});expect(doc.entryId).toBe('catalog-row:2');expect(doc.roster[1]).toMatchObject({id:'person:1',name:'Old Bob'});expect(doc.cards).toHaveLength(1);expect(doc.cards[0]).toMatchObject({id:'played:0:0',visual:{kind:'standard',suit:'Spade',rank:14}});
 const rounds=doc.sections.find(section=>section.kind==='rounds')!;if(rounds.kind!=='rounds')throw Error();expect(rounds.rounds[0].plays[0]).toMatchObject({personId:'person:1',cardId:'played:0:0',winner:true,leader:true});
 const matrix=doc.sections.find(section=>section.kind==='matrix')!;if(matrix.kind!=='matrix')throw Error();expect(matrix.columns).toEqual([{id:'round:0',label:'1라운드',shortLabel:'1'}]);expect(matrix.rows[0].cells).toEqual([null]);expect(matrix.rows[1].cells[0]).toMatchObject({cardId:'played:0:0'});expect(matrix.rows).toHaveLength(5);
 expect(Object.isFrozen(doc.sections)).toBe(true);expect(()=>copyFormData(doc)).not.toThrow();expect(JSON.stringify(doc)).not.toContain('participant_ids');expect(JSON.stringify(doc)).not.toContain('ownerId');
 (source.record as {names:string[]}).names[1]='Replacement';expect(doc.roster[1].name).toBe('Old Bob');
});
test('unavailable and privileged records expose explanation without private faces or inferred discards',()=>{
 const source=fixture(),view=(source.record as {view:View}).view;view.viewer={Seat:1};view.hand=[{Normal:['Club',2]}];const doc=createMightyHistoryDisclosure({entryId:'private',source});expect(doc.cards).toEqual([]);expect(doc.roster).toEqual([]);expect(JSON.stringify(doc)).not.toContain('Club');expect(doc.sections[0].kind).toBe('content');
 const unavailable=createMightyHistoryDisclosure({entryId:'summary',source:{identity:source.identity,record:{number:3}}});expect(JSON.stringify(unavailable)).toContain('요약만 남아');
});
test('scoring splits bounded panels and hidden-discard explanation remains explicit',()=>{
 const source=fixture(),view=(source.record as {view:View}).view;if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error();view.phase.Done.value.steps=Array.from({length:32},()=>({OverTen:{points:18,total:8}}));const doc=createMightyHistoryDisclosure({entryId:'row',source});
 const details=doc.sections.find(section=>section.id==='details')!;if(details.kind!=='content')throw Error();expect(details.information).toHaveLength(4);expect(details.information!.every(panel=>panel.fields.length<=12)).toBe(true);expect(JSON.stringify(doc)).toContain('이 공개 기록에는 저장하지 않았어요');expect(doc.sections.length).toBeLessThanOrEqual(8);
});
test('canonical catalog entry identity stays separate even when semantic hand lineage duplicates',()=>{
 const a=createMightyHistoryDisclosure({entryId:'row:index0',source:fixture()}),b=createMightyHistoryDisclosure({entryId:'row:index13',source:fixture()});expect(a.entryId).not.toBe(b.entryId);expect(a.cards).toEqual(b.cards);
 let reads=0;const input=Object.defineProperty({entryId:'row',source:fixture()},'source',{get(){reads++;return fixture();}});expect(createMightyHistoryDisclosure(input).cards).toEqual([]);expect(reads).toBe(0);
});

test('public exchange cards are registered once, with references reused by groups and no live entities',()=>{
 const source=fixture(),record=source.record as {rules:{reveal_discards:boolean};view:View};record.rules.reveal_discards=true;record.view.rules.reveal_discards=true;if(typeof record.view.phase!=='object'||!('Done'in record.view.phase))throw Error();record.view.phase.Done.discards=[{Normal:['Club',2]}];
 const doc=createMightyHistoryDisclosure({entryId:'public-discard',source});expect(doc.cards).toHaveLength(2);expect(doc.cards[1].id).toBe('discard:0');const exchange=doc.sections.find(section=>section.id==='exchange')!;if(exchange.kind!=='content')throw Error();expect(exchange.cardGroups![0].cardIds).toEqual(['discard:0']);expect(()=>copyFormData(doc)).not.toThrow();expect(JSON.stringify(doc)).not.toContain('entityId');
});

test('a full public hand with long original identities still fits the shared bounded data envelope',()=>{
 const source=fixture();Object.assign(source,{identity:{...source.identity,roomId:'r'.repeat(128),roomEpoch:'e'.repeat(128)}});const saved=source.record as {names:string[];participant_ids:string[];rules:View['rules'];view:View};saved.names=saved.names.map((_,index)=>`${index}${'이'.repeat(127)}`);saved.participant_ids=saved.participant_ids.map((_,index)=>`${index}${'p'.repeat(2047)}`);saved.rules.reveal_discards=true;saved.view.rules.reveal_discards=true;if(typeof saved.view.phase!=='object'||!('Done'in saved.view.phase))throw Error();const deck=deckCards(saved.rules);
 saved.view.phase.Done.tricks=Array.from({length:10},(_,round)=>({lead:{Suit:'Spade'},winner:1,plays:deck.slice(round*5,round*5+5).map((card,seat)=>({seat,card,powered:true}))}));saved.view.phase.Done.discards=deck.slice(50);
 const doc=createMightyHistoryDisclosure({entryId:'entry:'+ 'i'.repeat(2000),source});expect(doc.cards).toHaveLength(deck.length);expect(doc.cards.every(card=>card.id.length<32)).toBe(true);expect(doc.roster.every(person=>person.id.length<32)).toBe(true);expect(()=>copyFormData(doc)).not.toThrow();
});

test('matrix short labels use semantic round order while full accessible and round titles remain intact',()=>{
 const source=fixture(),saved=source.record as {rules:View['rules'];view:View};saved.rules.reveal_discards=true;saved.view.rules.reveal_discards=true;if(typeof saved.view.phase!=='object'||!('Done'in saved.view.phase))throw Error();const deck=deckCards(saved.rules);saved.view.phase.Done.tricks=Array.from({length:10},(_,round)=>({lead:{Suit:'Spade'},winner:1,plays:deck.slice(round*5,round*5+5).map((card,seat)=>({seat,card,powered:true}))}));saved.view.phase.Done.discards=deck.slice(50);const result=createMightyHistoryDisclosure({entryId:'numeric-rounds',source}),matrix=result.sections.find(section=>section.kind==='matrix')!,rounds=result.sections.find(section=>section.kind==='rounds')!;if(matrix.kind!=='matrix'||rounds.kind!=='rounds')throw Error();expect(matrix.columns.map(column=>column.shortLabel)).toEqual(Array.from({length:10},(_,i)=>String(i+1)));expect(matrix.columns.map(column=>column.label)).toEqual(Array.from({length:10},(_,i)=>`${i+1}라운드`));expect(rounds.rounds.map(round=>round.title)).toEqual(matrix.columns.map(column=>column.label));expect(Object.isFrozen(matrix.columns[0])).toBe(true);
});

test('public powered flags are game facts, not enhancement instructions for the renderer',()=>{
 const source=fixture(),view=(source.record as {view:View}).view;if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error();
 const read=()=>{const doc=createMightyHistoryDisclosure({entryId:'power-meaning',source}),section=doc.sections.find(s=>s.kind==='rounds');if(section?.kind!=='rounds')throw Error();return section.rounds[0].plays[0];};
 expect(read().annotations).toBeUndefined();expect(read()).not.toHaveProperty('powered');
 view.phase.Done.tricks[0].plays[0].powered=false;expect(read().annotations).toEqual([{text:'효력 없음',tone:'muted'}]);
 // Persisted records keep their original server schema and rule meaning.
 expect(view.phase.Done.tricks[0].plays[0].powered).toBe(false);
});
