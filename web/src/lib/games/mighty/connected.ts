import {projectMightyOutcome} from './settled';
import {createMightyConnectedDisclosureOwner} from './connectedDisclosureOwner';
import {MIGHTY_DEVICE_DELETE_FORM_POLICY,MIGHTY_DEVICE_DELETE_OPERATION,deleteMightyDeviceStats} from './deviceDeletion';
import {createMightyCompletionHost} from './completionHost';
import {createMightyAssistance} from './assistance';
import {createMightyFeedback} from './feedback';
import {createMightyRuleForm,MIGHTY_RULE_FORM_POLICY} from './ruleForms';
import {readCustomStorageRaw} from './rulesets';
import {saveMightyRuleForm,MIGHTY_SAVE_OPERATION} from './ruleFormHost';
import type { ConnectedGameAdapter } from '../../table/foundation/connected';
import { mightyDocument, prepareMightyCommand, type MightyCommand } from './foundation';
import type { Mighty } from './types';

export const mightyConnectedGame: ConnectedGameAdapter<Mighty, MightyCommand> = {
    id: 'mighty',
    createDisclosureOwner:createMightyConnectedDisclosureOwner,
    createCompletionOwner(){
        const owner=createMightyCompletionHost();
        return {observe:({room,roomScope,actorId,seat,keepsRecord,at},current)=>owner.observe({room,scope:roomScope,actorId,seat,keepsRecord},at,current),revoke:()=>owner.revoke(),dispose:()=>owner.dispose()};
    },
    assistance:createMightyAssistance,
    feedback:createMightyFeedback,
    outcome:projectMightyOutcome,
    title: '마이티',
    tableLabel: '마이티 테이블',
    formPolicies:[MIGHTY_RULE_FORM_POLICY,MIGHTY_DEVICE_DELETE_FORM_POLICY],
    readLocalFormState:()=>({customStorageRaw:readCustomStorageRaw()}),
    projectForms({room,scope,viewerId,seat,localState,localAuthorities}){
        const raw=localState&&typeof localState==='object'&&'customStorageRaw' in localState?(localState as {customStorageRaw:unknown}).customStorageRaw:undefined;
        if(raw!==null&&typeof raw!=='string')return {offers:[],settingsActions:[],diagnostics:[{id:'mighty-rule-storage',text:'이 기기의 규칙 목록을 읽지 못해 규칙 편집기를 열 수 없어요.',tone:'danger'}]};
        const result=createMightyRuleForm({room,scope,viewerId,seat,customStorageRaw:raw});
        if(result.offer&&localAuthorities?.[result.offer.id]?.save!==undefined){const authority=localAuthorities[result.offer.id].save;result.offer={...result.offer,actions:result.offer.actions?.map(action=>action.id==='save'&&action.target.kind==='host'?{...action,target:{...action.target,authority}}:action)};}
        return {offers:result.offer?[result.offer]:[],settingsActions:result.offer?[{id:'mighty:rules-open',purpose:'operation',label:'마이티 규칙 바꾸기',enabled:true,intent:{kind:'open-form',formId:result.offer.id}}]:[],...(result.diagnostic?{diagnostics:[{id:'mighty-rule-editor',text:result.diagnostic,tone:'danger' as const}]}:{})};
    },
    hostFormOperations:[{id:MIGHTY_SAVE_OPERATION,submit:(submission,continuation)=>saveMightyRuleForm(submission,undefined,continuation)},{id:MIGHTY_DEVICE_DELETE_OPERATION,submit:deleteMightyDeviceStats}],
    project(client,revision,graceReady,priorGeneration,history){
        const document=mightyDocument(client,revision,graceReady,priorGeneration,true,history);
        return document?{...document,facts:document.facts.filter(fact=>fact.id!=='result')}:null;
    },
    ruleInformation: room => [{ id: 'mighty-rules', title: '마이티 규칙', fields: [
        { id: 'players', label: '참가자', value: { kind: 'number', value: room.rules.players } },
        { id: 'hand', label: '한 사람의 패', value: { kind: 'number', value: room.rules.hand_size } },
        { id: 'deck', label: '덱', value: { kind: 'text', text: room.rules.deck === 'TwoJokers' ? '조커 2장' : '조커 1장' } },
        { id: 'minimum', label: '최소 공약', value: { kind: 'number', value: room.rules.bidding.min } },
        { id: 'discards', label: '버린 패 공개', value: { kind: 'text', text: room.rules.reveal_discards ? '판이 끝나면 공개' : '공개하지 않음' } },
    ] }],
    viewerMatches(game, seat) {
        if(seat===null)return game.view.viewer==='Spectator';
        if(typeof game.view.viewer==='object')return game.view.viewer.Seat===seat;
        // Settled replacements receive a public packet, not the outgoing
        // declarer's private discards. Live spectator packets stay distinct.
        return game.view.viewer==='Spectator'&&typeof game.view.phase==='object'&&'Done' in game.view.phase&&game.turn==='Over'&&!game.legal.length&&!game.out_of_turn.length&&!game.view.hand.length&&(game.view.rules.reveal_discards||!game.view.phase.Done.discards.length);
    },
    prepareBatch(client,commands){
        const prepared=commands.map(command=>prepareMightyCommand(client,command));
        return prepared.every(candidate=>candidate?.kind==='game')?prepared.map(candidate=>{if(candidate?.kind!=='game')throw Error('Mixed batch authority');return candidate.action;}):null;
    },
    submit(client, command, submitGame, submitRoom) {
        const candidate = prepareMightyCommand(client, command);
        return candidate ? candidate.kind === 'game' ? submitGame(candidate.action) : submitRoom(candidate.action) : false;
    },
};
