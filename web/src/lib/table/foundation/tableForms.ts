import type {CurrentRoomViewOf as RoomViewOf} from '../../room/currentRoom';
import { CATALOG } from '../../catalog';
import type { CommandScope, RoomAction } from '../../generated/protocol';
import type { GameTypes } from '../../room/types';
import { copyFormData, ownNormalizedForm, validateFormOffer, validateFormValues, type CompositeFormPolicy, type FormOffer, type FormValues } from './forms';
export type TableFormCommand = { readonly kind:'room'; readonly expected:CommandScope; readonly action:Extract<RoomAction,{type:'set_table'}> };
export const TABLE_FORM_POLICY_ID='room:table:v1';
export const TABLE_TURN_FIELD='table:turn';
export const TABLE_SHUFFLE_FIELD='table:shuffle';
export function tableSettingsSummary(table:RoomViewOf<GameTypes>['table']):string {
    return `턴 시간 ${table.turn_secs===0?'끔':`${table.turn_secs}초`} · 매 판 자리 섞기 ${table.shuffle?'켜짐':'꺼짐'}`;
}
export function tableFormOffer<G extends GameTypes>({room,scope,viewerId,seat}:{room:RoomViewOf<G>;scope:CommandScope;viewerId:string|null;seat:number|null}):FormOffer<TableFormCommand>|null {
    if(Object.keys(scope).length!==8||!['room','game'].includes(scope.domain)||typeof scope.room_epoch!=='string'||!scope.room_epoch||![scope.session_id,scope.hand,scope.version].every(value=>Number.isSafeInteger(value)&&value>=0))return null;
    if(!viewerId||seat===null||room.in_hand||scope.domain!=='room'||scope.room_id!==room.id||scope.actor_id!==viewerId||scope.seat!==seat||!CATALOG.turn_limits.includes(room.table.turn_secs as never))return null;
    return validateFormOffer({id:'room-table',instanceId:JSON.stringify([room.id,viewerId,seat,'table']),schemaVersion:'1',policyId:TABLE_FORM_POLICY_ID,
        baseVersion:JSON.stringify([room.table.turn_secs,room.table.shuffle]),editBinding:JSON.stringify([room.id,viewerId,seat]),title:'테이블 설정',submitLabel:'적용하기',enabled:true,
        help:'다음 판을 시작하기 전에 함께 쓰는 시간과 자리를 정해요.',binding:{roomId:room.id,actorId:viewerId,seat},model:{turn_secs:room.table.turn_secs,shuffle:room.table.shuffle},
        fields:[{id:TABLE_TURN_FIELD,label:'턴 시간',kind:'select',required:true,initial:`turn:${room.table.turn_secs}`,options:CATALOG.turn_limits.map(value=>({id:`turn:${value}`,label:value===0?'끔':`${value}초`,enabled:true}))},
            {id:TABLE_SHUFFLE_FIELD,label:'매 판 자리 섞기',kind:'toggle',required:true,initial:room.table.shuffle}],
        actions:[{id:'apply',label:'적용하기',intent:'primary',target:{kind:'command',actionId:'room-table:apply',template:{kind:'room',expected:{...scope},action:{type:'set_table',turn_secs:room.table.turn_secs,shuffle:room.table.shuffle,shuffle_next:null}}}}],
    });
}
function canonical(input:FormOffer<TableFormCommand>):FormOffer<TableFormCommand> {
    const offer=validateFormOffer(input),target=offer.actions?.[0]?.target;
    if(offer.id!=='room-table'||offer.policyId!==TABLE_FORM_POLICY_ID||offer.actions?.length!==1||target?.kind!=='command'||target.template.kind!=='room'||target.template.action.type!=='set_table')throw new Error('Invalid table settings form');
    const scope=target.template.expected,binding=offer.binding,model=offer.model as {turn_secs?:unknown;shuffle?:unknown}|undefined;
    if(scope.domain!=='room'||binding.actorId!==scope.actor_id||binding.roomId!==scope.room_id||binding.seat!==scope.seat||scope.seat===null||!model||typeof model.turn_secs!=='number'||typeof model.shuffle!=='boolean')throw new Error('Invalid table settings binding');
    const expected=tableFormOffer({room:{id:scope.room_id,in_hand:false,table:{turn_secs:model.turn_secs,shuffle:model.shuffle,shuffle_next:false}} as RoomViewOf<GameTypes>,scope,viewerId:scope.actor_id,seat:scope.seat});
    if(!expected||JSON.stringify(offer)!==JSON.stringify(expected))throw new Error('Invalid table settings schema');
    return offer;
}
function normalized(offer:FormOffer<TableFormCommand>,values:FormValues){return ownNormalizedForm(offer,{values:copyFormData(values),issues:validateFormValues(offer,values)});}
export const TABLE_FORM_POLICY:CompositeFormPolicy<TableFormCommand>={
    id:TABLE_FORM_POLICY_ID,kind:'actions',
    reduce(input,previous,edit){
        const offer=canonical(input);let values:FormValues;
        if(edit.kind==='initialize')values=previous;
        else if(edit.kind==='reset-all')values=Object.fromEntries(offer.fields.map(field=>[field.id,field.initial]));
        else if(edit.kind==='reset-field'){const field=offer.fields.find(field=>field.id===edit.fieldId);if(!field)throw new Error('Unknown table field');values={...previous,[field.id]:field.initial};}
        else {if(!offer.fields.some(field=>field.id===edit.fieldId))throw new Error('Unknown table field');values={...previous,[edit.fieldId]:edit.value};}
        const result=normalized(offer,values);
        return {...result,visibility:Object.fromEntries(offer.fields.map(field=>[field.id,true])),enabled:Object.fromEntries(offer.fields.map(field=>[field.id,true])),changedFields:offer.fields.filter(field=>values[field.id]!==field.initial).map(field=>field.id)};
    },
    normalize(input,values){return normalized(canonical(input),values);},
    compile(input,values,actionId){
        const offer=canonical(input),result=normalized(offer,values),target=offer.actions![0].target;
        if(actionId!=='apply'||Object.keys(result.issues).length||target.kind!=='command')throw new Error('Invalid table settings draft');
        const option=CATALOG.turn_limits.find(value=>`turn:${value}`===values[TABLE_TURN_FIELD]);
        if(option===undefined||typeof values[TABLE_SHUFFLE_FIELD]!=='boolean')throw new Error('Invalid table settings values');
        return {kind:'command',action:{...target.template,action:{type:'set_table',turn_secs:option,shuffle:values[TABLE_SHUFFLE_FIELD],shuffle_next:null}}};
    },
    validateCompiled(offer,candidate,actionId){try{if(candidate.kind!=='command')return false;const action=candidate.action;if(action.kind!=='room'||action.action.type!=='set_table'||action.action.turn_secs===null||typeof action.action.shuffle!=='boolean')return false;return JSON.stringify(TABLE_FORM_POLICY.compile(offer,{[TABLE_TURN_FIELD]:`turn:${action.action.turn_secs}`,[TABLE_SHUFFLE_FIELD]:action.action.shuffle},actionId))===JSON.stringify(candidate);}catch{return false;}},
    expectedResult(_offer,action){return {turn_secs:action.action.turn_secs,shuffle:action.action.shuffle};},
    matchesResult(offer,expected){try{const model=canonical(offer).model as {turn_secs:number;shuffle:boolean},value=copyFormData(expected) as {turn_secs?:unknown;shuffle?:unknown};return value&&value.turn_secs===model.turn_secs&&value.shuffle===model.shuffle;}catch{return false;}},
};
