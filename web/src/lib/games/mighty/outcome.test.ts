import {expect,test} from 'vitest';
import {validateInformation} from '../../table/foundation/information';
import type {TableDocument} from '../../table/foundation/contracts';
import {createMightyOutcome} from './outcome';
import type {CommandScope,RecordedHand} from '../../generated/protocol';
import type {RoomView} from './types';
import {presetRules} from './catalog';
const scope=():CommandScope=>({domain:'room',room_id:'result',room_epoch:'a'.repeat(32),session_id:3,hand:7,version:20,actor_id:'actor',seat:0});
function room():RoomView {
 const done={declarer:0,friend:2,contract:{trump:'Heart',count:17},call:'FirstTrick',team_points:18,payoffs:[6,-3,3,-3,-3]};
 const saved:RecordedHand={number:4,participant_ids:['actor','p1','p2','p3','p4'],names:['옛 주공','옛 야당1','옛 프렌드','옛 야당2','옛 야당3'],payoffs:[...done.payoffs],rules:presetRules('default'),view:{viewer:'Spectator',phase:{Done:done}}};
 return {id:'result',game:'mighty',session_id:3,in_hand:false,showing:true,hands_played:4,current_hand:saved,seats:saved.names.map(name=>({kind:'human',name,connected:true,away:false})),participant_ids:[...saved.participant_ids]} as RoomView;
}
const project=(value=room(),authority=scope(),earnedTitles:readonly string[]=[])=>createMightyOutcome({room:value,scope:authority,continuationActionIds:['next'],earnedTitles});
test('current public result restores winner, original role, contract and personal payoff semantics',()=>{
 const value=room(),before=structuredClone(value),result=project(value,scope(),['첫 승리'])!;expect(result.information.title).toBe('여당 승리');expect(result.information.primary).toEqual({label:'이번 판',value:{kind:'text',text:'+6점'}});expect(result.information.summary).toEqual({text:'주공',tone:'accent'});
 expect(result.information.fields.find(field=>field.id==='contract')!.value).toMatchObject({kind:'inline',values:[{kind:'suit',suit:'Heart',label:'하트'},{kind:'number',value:17}]});expect(result.information.badges).toEqual([{text:'첫 승리',tone:'accent'}]);expect(value).toEqual(before);
});
test('run and defending victory preserve the authoritative team points',()=>{
 const value=room(),done=(value.current_hand!.view as any).phase.Done;done.team_points=20;expect(project(value)!.information.title).toBe('런');done.team_points=16;expect(project(value)!.information.title).toBe('야당 승리');
});
test('result identity survives benign versions, seat changes and current renaming',()=>{
 const value=room(),first=project(value)!;value.seats[0]={kind:'human',name:'새 이름',connected:true,away:false};value.participant_ids=['other','p1','p2','p3','p4'];
 const next=project(value,{...scope(),version:21,seat:null})!;expect(next.outcome.id).toBe(first.outcome.id);expect(next.information.fields.find(field=>field.id==='declarer')!.value).toEqual({kind:'text',text:'옛 주공'});expect(next.information.primary).toEqual(first.information.primary);
 expect(project(value,{...scope(),room_epoch:'b'.repeat(32)})!.outcome.id).not.toBe(first.outcome.id);
});
test('replacement and uninvolved observer never inherit original personal payoff or awards',()=>{
 for(const seat of [0,null]){const value=room();value.participant_ids=['replacement','p1','p2','p3','p4'];const result=project(value,{...scope(),actor_id:'replacement',seat},['첫 승리'])!;expect(result.information.primary).toBeUndefined();expect(result.information.summary).toBeUndefined();expect(result.information.badges).toBeUndefined();expect(result.information.fields.find(field=>field.id==='participation')!.value).toEqual({kind:'text',text:'이번 판에 참여하지 않았어요'});}
});
test('only the current settled record and matching native room/session may supply an outcome',()=>{
 for(const mutate of [(r:RoomView)=>r.in_hand=true,(r:RoomView)=>r.showing=false,(r:RoomView)=>r.current_hand=null,(r:RoomView)=>r.hands_played++]){const value=room();mutate(value);expect(project(value)).toBeNull();}
 expect(project(room(),{...scope(),room_id:'other'})).toBeNull();expect(project(room(),{...scope(),session_id:4})).toBeNull();expect(project(room(),{...scope(),domain:'game'})).toBeNull();
});
test('malformed public result fields and diverging payoff records are refused',()=>{
 for(const mutate of [(r:RoomView)=>r.current_hand!.participant_ids[1]='actor',(r:RoomView)=>r.current_hand!.payoffs[0]=7,(r:RoomView)=>(r.current_hand!.view as any).phase.Done.team_points=21,(r:RoomView)=>(r.current_hand!.view as any).phase.Done.friend=99,(r:RoomView)=>r.current_hand!.view={phase:'Play'}]){const value=room();mutate(value);expect(project(value)).toBeNull();}
});
test('private or unrelated card payload never enters result descriptor or information',()=>{
 const value=room(),view=value.current_hand!.view as any;view.hand=[{private:'PRIVATE_HAND'}];view.phase.Done.discards=[{private:'PRIVATE_DISCARD'}];view.phase.Done.tricks=[{private:'PRIVATE_TRICK'}];const result=project(value)!;expect(result).not.toBeNull();expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(result.information.fields.every(field=>field.value.kind!=='card')).toBe(true);
});

test('all twelve confirmed awards remain reachable within canonical panel bounds',()=>{
 const titles=Array.from({length:12},(_,i)=>`업적 ${i}`),result=project(room(),scope(),titles)!;
 const doc:TableDocument<string>={context:{session:'s',audience:'a',generation:'g',revision:'1'},participant:{id:'actor',name:'나',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'d',commands:[]},offer:{id:'o',actions:[]},information:[result.information]};
 expect(()=>validateInformation(doc)).not.toThrow();expect(result.information.badges).toHaveLength(8);for(const title of titles)expect(JSON.stringify(result.information)).toContain(title);
});

test('bounded pending, waiting and vacant preparation meaning stays separate from payoff',()=>{
 const value=room();value.ready=[true,false,false,false,false];expect(project(value)!.information.fields.find(field=>field.id==='preparation')!.value).toMatchObject({kind:'text',text:expect.stringContaining('준비 기다리는 중')});value.participation=[{id:'guest',name:'Guest',order:1,seat:1,target_id:'p1',offered_by:null}];expect(project(value)!.information.fields.find(field=>field.id==='preparation')!.value).toEqual({kind:'text',text:'참여할 자리를 확인하는 중'});value.seats[4]={kind:'empty'};expect(project(value)!.information.fields.find(field=>field.id==='vacancy')!.value).toMatchObject({text:'빈 자리를 채우면 이어갈 수 있어요'});
});
test('long waiting names remain complete within per-atom information bounds',()=>{
 const value=room();value.ready=[true,false,false,false,false];for(const seat of value.seats)if(seat.kind==='human')seat.name='긴'.repeat(128);const result=project(value)!;const waiting=result.information.fields.find(field=>field.id==='preparation')!.value;expect(waiting.kind).toBe('inline');if(waiting.kind==='inline')expect(waiting.values).toHaveLength(4);const doc:TableDocument<string>={context:{session:'s',audience:'a',generation:'g',revision:'1'},participant:{id:'actor',name:'나',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'d',commands:[]},offer:{id:'o',actions:[]},information:[result.information]};expect(()=>validateInformation(doc)).not.toThrow();
});

test('eight long-name humans and twelve awards fit canonical fields and four-atom values',()=>{
 for(const vacant of [false,true]){const value=room(),saved=value.current_hand!,done=(saved.view as {phase:{Done:{payoffs:number[]}}}).phase.Done;
 while(saved.names.length<8){const index=saved.names.length;saved.names.push('옛 사람 '+index);saved.participant_ids.push('p'+index);saved.payoffs.push(-3);}done.payoffs=[...saved.payoffs];value.participant_ids=[...saved.participant_ids];value.seats=Array.from({length:8},()=>({kind:'human' as const,name:'긴'.repeat(128),connected:true,away:false}));value.ready=[true,false,false,false,false,false,false,false];if(vacant)value.seats[7]={kind:'empty'};
 const result=project(value,scope(),Array.from({length:12},(_,index)=>'업적 '+index))!;const doc:TableDocument<string>={context:{session:'s',audience:'a',generation:'g',revision:'1'},participant:{id:'actor',name:'나',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'d',commands:[]},offer:{id:'o',actions:[]},information:[result.information]};expect(()=>validateInformation(doc)).not.toThrow();expect(result.information.fields.length).toBeLessThanOrEqual(12);const waiting=result.information.fields.filter(field=>field.id.startsWith('preparation'));expect(waiting).toHaveLength(2);const names=waiting.flatMap(field=>field.value.kind==='inline'?field.value.values:[]);expect(names).toHaveLength(vacant?6:7);for(const field of waiting)if(field.value.kind==='inline')expect(field.value.values.length).toBeLessThanOrEqual(4);for(let index=0;index<12;index++)expect(JSON.stringify(result.information)).toContain('업적 '+index);
 }
});

test('result selection ignores huge unrelated replay payloads and never visits their accessors',()=>{
 const value=room(),saved=value.current_hand!,view=saved.view as {phase:{Done:Record<string,unknown>}};let reads=0;
 Object.assign(saved,{irrelevant:'x'.repeat(200000)});Object.defineProperty(saved,'rules',{get(){reads++;throw Error('not needed');},enumerable:true});Object.defineProperty(view,'tricks',{get(){reads++;throw Error('not needed');},enumerable:true});Object.defineProperty(view.phase.Done,'tricks',{get(){reads++;throw Error('not needed');},enumerable:true});Object.defineProperty(view.phase.Done,'discards',{get(){reads++;throw Error('not needed');},enumerable:true});
 const result=project(value);expect(result).not.toBeNull();expect(reads).toBe(0);expect(JSON.stringify(result)).not.toContain('irrelevant');
});
test('selected required record accessors refuse without invocation',()=>{
 const value=room();let reads=0;Object.defineProperty(value.current_hand!,'names',{get(){reads++;return [];},enumerable:true});expect(project(value)).toBeNull();expect(reads).toBe(0);
});
test('maximum bounded public headers project without cloning a full replay',()=>{
 const value=room(),saved=value.current_hand!,done=(saved.view as {phase:{Done:{payoffs:number[]}}}).phase.Done;
 saved.names=Array.from({length:8},()=> '이'.repeat(128));saved.participant_ids=Array.from({length:8},(_,index)=>String(index).padEnd(2048,'p'));saved.payoffs=Array.from({length:8},(_,index)=>index%2?Number.MAX_SAFE_INTEGER:-Number.MAX_SAFE_INTEGER);done.payoffs=[...saved.payoffs];
 const result=project(value,{...scope(),actor_id:saved.participant_ids[0]})!;expect(result).not.toBeNull();expect(result.information.primary).toBeDefined();const doc:TableDocument<string>={context:{session:'s',audience:'a',generation:'g',revision:'1'},participant:{id:'actor',name:'나',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'d',commands:[]},offer:{id:'o',actions:[]},information:[result.information]};expect(()=>validateInformation(doc)).not.toThrow();
});

test('missing and malformed selected friend-call fields refuse summary projection',()=>{
 const value=room(),done=(value.current_hand!.view as {phase:{Done:Record<string,unknown>}}).phase.Done;done.call={Unknown:true};expect(project(value)).toBeNull();delete done.call;expect(project(value)).toBeNull();
});
test('compact result never emits the full completed-hand overview by default',()=>{const value=room(),done=(value.current_hand!.view as {phase:{Done:Record<string,unknown>}}).phase.Done;done.tricks=Array.from({length:10},()=>({winner:0,lead:{Suit:'Heart'},plays:Array.from({length:5},(_,seat)=>({seat,card:{Normal:['Heart',seat+2]},powered:true}))}));const result=project(value)!;expect(result).not.toBeNull();expect(Object.hasOwn(result.outcome,'overview')).toBe(false);expect(result.outcome.compactFieldIds).toEqual(['contract','points']);});
