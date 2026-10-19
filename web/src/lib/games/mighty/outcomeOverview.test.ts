import {expect,test} from 'vitest';
import {createMightyOutcomeOverview} from './outcomeOverview';
import {completionFixture} from './testSupport/completionFixture';
import {deckCards} from './cards';
import type {View} from './types';
function fixture(){const f=completionFixture();return{room:f.room!,scope:f.scope!};}
test('current public result uses original frozen roster names and explicit blank matrix cells',()=>{
 const input=fixture(),result=createMightyOutcomeOverview(input)!;expect(result).not.toBeNull();expect(result.sections).toHaveLength(1);const matrix=result.sections[0];if(matrix.kind!=='matrix')throw Error();expect(result.roster[0].name).toBe('Old Alice');expect(result.roster[1].name).toBe('Old Bob');expect(matrix.rows).toHaveLength(5);expect(matrix.columns).toHaveLength(1);expect(matrix.rows[0].cells).toEqual([null]);expect(matrix.rows[1].cells[0]).toMatchObject({cardId:'played:0:0'});expect(result.cards).toHaveLength(1);expect(JSON.stringify(result)).not.toMatch(/entityId|ownerId|actions|participant_ids/);expect(Object.isFrozen(result.cards)).toBe(true);
 input.room.current_hand!.names[0]='Replacement';expect(result.roster[0].name).toBe('Old Alice');
});
test('full 5×10 matrix contains fifty readonly played mini-art refs and excludes public exchange cards',()=>{
 const input=fixture(),saved=input.room.current_hand!,view=saved.view as View,rules=saved.rules as View['rules'];rules.reveal_discards=true;view.rules.reveal_discards=true;const deck=deckCards(rules);if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error();view.phase.Done.tricks=Array.from({length:10},(_,round)=>({lead:{Suit:'Spade'},winner:1,plays:deck.slice(round*5,round*5+5).map((card,seat)=>({seat,card,powered:true}))}));view.phase.Done.discards=deck.slice(50);
 const result=createMightyOutcomeOverview(input)!;expect(result).not.toBeNull();const matrix=result.sections[0];if(matrix.kind!=='matrix')throw Error();expect(matrix.columns).toHaveLength(10);expect(matrix.columns.map(column=>column.shortLabel)).toEqual(Array.from({length:10},(_,i)=>String(i+1)));expect(matrix.columns.map(column=>column.label)).toEqual(Array.from({length:10},(_,i)=>`${i+1}라운드`));expect(matrix.rows.map(row=>row.cells.length)).toEqual([10,10,10,10,10]);expect(matrix.rows.flatMap(row=>row.cells).filter(Boolean)).toHaveLength(50);expect(result.cards).toHaveLength(50);expect(result.cards.every(card=>card.id.length<32)).toBe(true);
});
test('foreign/stale scope, active games, missing origin and private cached views refuse overview',()=>{
 for(const mode of ['room','session','actor','version','active','number','origin','private']){const input=fixture();switch(mode){case'room':input.scope.room_id='other';break;case'session':input.scope.session_id++;break;case'actor':input.scope.actor_id='intruder';break;case'version':input.room.room_version=input.scope.version+1;break;case'active':input.room.in_hand=true;break;case'number':input.room.current_hand!.number++;break;case'origin':delete input.room.current_hand!.session_id;break;case'private':(input.room.current_hand!.view as View).viewer={Seat:1};break;}expect(createMightyOutcomeOverview(input),mode).toBeNull();}
});
test('current source accessors refuse without invocation, while unrelated archives/private-cache getters are never visited',()=>{
 for(const key of ['current_hand','id','game','session_id']){const input=fixture();let calls=0;Object.defineProperty(input.room,key,{get(){calls++;throw Error('getter');},enumerable:true});expect(createMightyOutcomeOverview(input)).toBeNull();expect(calls).toBe(0);}
 const input=fixture();let calls=0;for(const key of ['records','archives','game_cache'])Object.defineProperty(input.room,key,{get(){calls++;throw Error('archive');},enumerable:true});expect(createMightyOutcomeOverview(input)).not.toBeNull();expect(calls).toBe(0);
});
test('retained current result preserves producer-stamped old score period instead of relabeling its origin',()=>{const input=fixture();input.room.session_id=3;input.scope.session_id=3;const result=createMightyOutcomeOverview(input)!;expect(result).not.toBeNull();expect(JSON.parse(result.entryId)).toEqual(['mighty-outcome','room','epoch',2,3]);});
test('observer scope is public-read eligible but nested private getter fields are never evaluated',()=>{
 const input=fixture();input.scope.seat=null;input.scope.actor_id='watcher';expect(createMightyOutcomeOverview(input)).not.toBeNull();let calls=0;const view=input.room.current_hand!.view as View;Object.defineProperty(view,'hand',{get(){calls++;return [{Normal:['Club',2]}];},enumerable:true});expect(createMightyOutcomeOverview(input)).toBeNull();expect(calls).toBe(0);
});
test('native safe u64 publication versions retain their overview beyond the u32 range',()=>{for(const version of [2**32,Number.MAX_SAFE_INTEGER]){const input=fixture();input.room.room_version=version;input.scope.version=version;expect(createMightyOutcomeOverview(input)).not.toBeNull();}const input=fixture();input.room.room_version=Number.MAX_SAFE_INTEGER+1;input.scope.version=Number.MAX_SAFE_INTEGER+1;expect(createMightyOutcomeOverview(input)).toBeNull();});
