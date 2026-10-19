import {expect,test} from 'vitest';
import type {CommandScope} from '../../generated/protocol';
import type {GameTypes,RoomViewOf} from '../../room/types';
import {TABLE_FORM_POLICY,TABLE_TURN_FIELD,TABLE_SHUFFLE_FIELD,tableFormOffer,tableSettingsSummary} from './tableForms';
const scope:CommandScope={domain:'room',room_id:'table',room_epoch:'a'.repeat(32),actor_id:'actor',seat:0,session_id:1,hand:0,version:7};
const room=()=>({id:'table',in_hand:false,table:{turn_secs:40,shuffle:false,shuffle_next:false}} as RoomViewOf<GameTypes>);
const offer=()=>tableFormOffer({room:room(),scope,viewerId:'actor',seat:0})!;
const values=()=>({[TABLE_TURN_FIELD]:'turn:60',[TABLE_SHUFFLE_FIELD]:true});
test('table settings have two typed fields and exact scoped command action',()=>{
 const form=offer();expect(form.fields.map(field=>field.kind)).toEqual(['select','toggle']);
 const candidate=TABLE_FORM_POLICY.compile(form,values(),'apply');expect(candidate).toEqual({kind:'command',action:{kind:'room',expected:scope,action:{type:'set_table',turn_secs:60,shuffle:true,shuffle_next:null}}});
 expect(TABLE_FORM_POLICY.validateCompiled(form,candidate,'apply')).toBe(true);
 if(candidate.kind!=='command')throw new Error('command');expect(TABLE_FORM_POLICY.validateCompiled(form,{...candidate,action:{...candidate.action,expected:{...scope,version:8}}},'apply')).toBe(false);
});
test('observer, active hand, stale actor/seat/room and unknown turn bases never offer mutations',()=>{
 for(const options of [{seat:null},{viewerId:'elsewhere'},{scope:{...scope,seat:1}},{scope:{...scope,room_id:'elsewhere'}},{room:{...room(),in_hand:true}},{room:{...room(),table:{...room().table,turn_secs:17}}}])expect(tableFormOffer({room:room(),scope,viewerId:'actor',seat:0,...options})).toBeNull();
 expect(tableSettingsSummary(room().table)).toBe('턴 시간 40초 · 매 판 자리 섞기 꺼짐');
});
test('table reducer resets fields and rejects invalid opaque options or scalar types',()=>{
 const form=offer(),start=Object.fromEntries(form.fields.map(field=>[field.id,field.initial]));
 const changed=TABLE_FORM_POLICY.reduce(form,start,{fieldId:TABLE_SHUFFLE_FIELD,value:true});expect(changed.changedFields).toEqual([TABLE_SHUFFLE_FIELD]);
 expect(TABLE_FORM_POLICY.reduce(form,changed.values,{kind:'reset-all'}).values).toEqual(start);
 for(const draft of [{...values(),[TABLE_TURN_FIELD]:'60'},{...values(),[TABLE_SHUFFLE_FIELD]:'true'}])expect(()=>TABLE_FORM_POLICY.compile(form,draft,'apply')).toThrow();
 expect(()=>TABLE_FORM_POLICY.compile(form,values(),'save')).toThrow();
});
test('table publication reconciliation compares semantic captured results and does not rebase authority',()=>{
 const first=offer(),candidate=TABLE_FORM_POLICY.compile(first,values(),'apply');if(candidate.kind!=='command')throw new Error('command');
 const expected=TABLE_FORM_POLICY.expectedResult!(first,candidate.action);
 const next=tableFormOffer({room:{...room(),table:{turn_secs:60,shuffle:true,shuffle_next:false}},scope:{...scope,version:8},viewerId:'actor',seat:0})!;
 expect(TABLE_FORM_POLICY.matchesResult!(next,expected)).toBe(true);expect(TABLE_FORM_POLICY.matchesResult!(first,expected)).toBe(false);
 expect(candidate.action.expected.version).toBe(7);
});
