import {tableFormOffer,tableSettingsSummary} from './tableForms';
import type {ConnectedDisclosureProjection} from './connectedDisclosures';
import {copyFormData,validateFormOffer,normalizeFormActions} from './forms';
import {ownDisclosureOffer,ownDisclosureFormActions,type DisclosureContext} from './disclosures';
import {validateRoomShell} from './roomShell';
import {ownOutcome} from './outcome';
import type {ConnectedFormProjection} from './connected';
import {namedJoinForm,renameForm} from './nameForms';
import type {FormOffer} from './forms';
import type {RoomOperationSubject} from './roomOperations';
import type {RoomShellAction} from './roomShell';
import {reportFormOffer} from './reportForms';
import type { CommandScope, CommandWindow } from '../../generated/protocol';
import type { BotLevel, GameTypes, RoomActionOf } from '../../room/types';
import type { ConnectedCommandClient } from './connected';
import type { InformationPanel, TableDocument } from './contracts';
import { projectRoomOperations } from './roomOperations';
import { withRoomOperations } from './roomOperationShell';
import { projectRoomShell, type RoomShell, type RoomShellNotice, type PreferenceField } from './roomShell';

/** Room authority is captured with the offered command, never rebound at send. */
export type HostCommand<A, Settings> = { readonly kind: 'adapter'; readonly candidate: A } |
    { readonly kind: 'room'; readonly action: RoomActionOf<Settings>; readonly expected: CommandScope };
export const HOST_LEAVE_ACTION = 'host:leave';
/** Host read owners provide catalog references only. The engine constructs and
 * validates navigation; no policy callbacks or raw history enter this document. */
export function withConnectedDisclosures<A>(document:TableDocument<A>,input:ConnectedDisclosureProjection,context:DisclosureContext):TableDocument<A>{
    const projection=copyFormData(input),fail=():never=>{throw Error('Invalid connected disclosure references');};
    if(!projection||typeof projection!=='object'||Array.isArray(projection)||Object.keys(projection).some(key=>!['offers','menuItems','outcomeDetailsCatalogId','rulesCatalogId','forms','formActions'].includes(key))||!Array.isArray(projection.offers)||projection.offers.length>8||!Array.isArray(projection.menuItems)||projection.menuItems.length>8||projection.forms!==undefined&&(!Array.isArray(projection.forms)||projection.forms.length>8)||projection.formActions!==undefined&&!Array.isArray(projection.formActions))return fail();
    const offers=projection.offers.map(ownDisclosureOffer),known=new Set(offers.map(offer=>offer.id));
    const extraForms=(projection.forms??[]).map(form=>validateFormOffer<never>(form)),forms:readonly FormOffer<A>[]=[...(document.forms??[]),...extraForms];
    if(forms.length>40||new Set(forms.map(form=>form.id)).size!==forms.length||new Set(forms.map(form=>form.instanceId)).size!==forms.length||extraForms.some(form=>form.access?.kind!=='disclosure-selection'||normalizeFormActions(form).some(action=>action.target.kind!=='host')))return fail();
    const formActions=ownDisclosureFormActions(projection.formActions??[],offers,forms);
    if(formActions.some(action=>!forms.some(form=>form.id===action.formId&&form.instanceId===action.formInstanceId&&form.access?.kind==='disclosure-selection'&&form.access.selectionId===action.selectionId)))return fail();
    if(extraForms.some(form=>!formActions.some(action=>action.formId===form.id&&action.formInstanceId===form.instanceId&&action.selectionId===form.access?.selectionId)))return fail();
    if(known.size!==offers.length)return fail();
    const actions:RoomShellAction[]=projection.menuItems.map(item=>{
        if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==3||Object.keys(item).some(key=>!['id','label','catalogId'].includes(key))||typeof item.id!=='string'||!item.id.trim()||item.id.length>96||typeof item.label!=='string'||!item.label.trim()||item.label.length>500||!known.has(item.catalogId))return fail();
        return {id:`room-disclosure:${item.id}`,purpose:'operation',label:item.label,enabled:true,intent:{kind:'open-disclosure',catalogId:item.catalogId}};
    });
    if(new Set(actions.map(action=>action.id)).size!==actions.length||actions.length&&!document.shell?.pages.some(page=>page.id==='menu'))return fail();
    if(projection.outcomeDetailsCatalogId!==undefined&&(!document.outcome||!known.has(projection.outcomeDetailsCatalogId)))return fail();
    if(projection.rulesCatalogId!==undefined&&(!known.has(projection.rulesCatalogId)||!document.shell?.pages.some(page=>page.actions.some(action=>action.purpose==='rules'))))return fail();
    const rulesAction=(action:RoomShellAction):RoomShellAction=>projection.rulesCatalogId!==undefined&&action.purpose==='rules'?{...action,enabled:true,intent:{kind:'open-disclosure',catalogId:projection.rulesCatalogId}}:action;
    const result:TableDocument<A>={...document,disclosureContext:copyFormData(context),disclosures:offers,...(extraForms.length?{forms}:{}),...(formActions.length?{disclosureFormActions:formActions}:{}),...(document.shell?{shell:{...document.shell,header:{...document.shell.header,actions:document.shell.header.actions.map(rulesAction)},pages:document.shell.pages.map(page=>({...page,actions:[...page.actions.map(rulesAction),...(page.id==='menu'?actions:[])]}))}}:{}),...(projection.outcomeDetailsCatalogId!==undefined?{outcome:{...document.outcome!,detailsCatalogId:projection.outcomeDetailsCatalogId}}:{})};
    if(result.shell)validateRoomShell(result.shell,result);
    if(result.outcome)ownOutcome(result.outcome,result);
    return result;
}
export interface ConnectedShellMetadata<G extends GameTypes,A=never> {
    readonly roomCode: string;
    readonly client: ConnectedCommandClient<G>;
    readonly roomWindow?: CommandWindow | null;
    readonly botLevels?: readonly { readonly id: BotLevel; readonly label: string }[];
    readonly ruleInformation?: readonly InformationPanel[];
    readonly preferences?: readonly PreferenceField[];
    readonly notice?: RoomShellNotice;
    readonly recovery?: { readonly pending: number; readonly recovering?: number; readonly storageError: boolean; readonly capacity: boolean };
    readonly journalFull?: boolean;
    readonly reportMax?:number;
    readonly nameMax?:number;
    readonly gameForms?:ConnectedFormProjection<G,A>;
}
function suppressPlayerLeave(shell: RoomShell, seated: boolean): RoomShell {
    if (!seated) return shell;
    return { ...shell, pages: shell.pages.map(page => ({ ...page, actions: page.actions.map(action => action.purpose === 'leave' ? { ...action, enabled: false } : action) })),
        ...(shell.leaveConfirmation ? { leaveConfirmation: { ...shell.leaveConfirmation, actions: shell.leaveConfirmation.actions.map(action => action.purpose === 'confirm' ? { ...action, enabled: false } : action) } } : {}) };
}
/** Shared host semantics are appended without rewriting game decision IDs/tuples. */
export function connectedDocument<G extends GameTypes, A>(document: TableDocument<A>, metadata: ConnectedShellMetadata<G,A>): TableDocument<HostCommand<A, G['settings']>> {
    const client = metadata.client, scope = metadata.roomWindow?.scope;
    const currentRoomScope = client.status === 'open' && !!client.room && client.room.id === metadata.roomCode && !!client.viewerId && !!scope && scope.actor_id === client.viewerId && scope.room_id === metadata.roomCode && scope.seat === client.seat && scope.domain === 'room';
    const canLeave = currentRoomScope && client.seat !== null;
    const operations = currentRoomScope ? projectRoomOperations({ ...client, botLevels: metadata.botLevels ?? [] }) : [];
    const reserved = new Set([HOST_LEAVE_ACTION, ...operations.map(operation => operation.id)]);
    if (reserved.size !== operations.length + 1 || document.offer.actions.some(action => reserved.has(action.id))) throw new Error('Reserved connected action ID');
    const actions = document.offer.actions.map(action => {
        if (action.kind !== 'command') throw new Error('Connected roots require exact command offers');
        return { ...action, action: { kind: 'adapter' as const, candidate: action.action } };
    });
    const leave = canLeave ? [{ kind: 'command' as const, id: HOST_LEAVE_ACTION, label: '테이블 나가기', intent: 'danger' as const, enabled: true,
        action: { kind: 'room' as const, action: { type: 'leave' as const }, expected: { ...scope! } } }] : [];
    const operationActions = operations.map(operation => ({ kind: 'command' as const, id: operation.id, label: operation.label, intent: 'secondary' as const, enabled: true,
        action: { kind: 'room' as const, action: operation.action, expected: { ...scope! } } }));
    const nameForms:FormOffer<HostCommand<A,G['settings']>>[]=[];
    const joins:{subject:RoomOperationSubject;actions:RoomShellAction[]}[]=[];
    if(currentRoomScope&&metadata.nameMax){
        nameForms.push(renameForm({roomId:metadata.roomCode,actorId:client.viewerId!,seat:client.seat,name:client.viewerName??'',currentScope:scope!,nameMax:metadata.nameMax}));
        if(client.seat===null&&!client.room!.in_hand&&!client.room!.seats.some((occupant,index)=>occupant.kind==='human'&&client.room!.participant_ids?.[index]===client.viewerId)){
            client.room!.seats.forEach((occupant,seat)=>{
                if(occupant.kind==='human'||client.room!.participation?.some(request=>request.seat===seat))return;
                const targetId=client.room!.participant_ids?.[seat];
                const form=namedJoinForm({roomId:metadata.roomCode,actorId:client.viewerId!,seat,targetId,name:client.viewerName??'',currentScope:scope!,nameMax:metadata.nameMax!});
                nameForms.push(form);
                joins.push({subject:{kind:'seat',seat,...(targetId?{participantId:targetId}:{})},actions:[{id:`room-shell:join-name:${seat}`,purpose:'operation',label:'이 자리에 앉기',enabled:true,intent:{kind:'open-form',formId:form.id}}]});
            });
        }
    }
    const shell = withRoomOperations(projectRoomShell({ ...metadata, document }), client.room!, operations,joins);
    const hostActions = [...leave, ...operationActions];
    const report=currentRoomScope&&metadata.reportMax?reportFormOffer({roomId:metadata.roomCode,actorId:client.viewerId!,seat:client.seat,reportMax:metadata.reportMax}):null;
    const rename=nameForms[0];
    const tableForm=currentRoomScope?tableFormOffer({room:client.room!,scope:scope!,viewerId:client.viewerId,seat:client.seat}):null;
    const gameForms=currentRoomScope?metadata.gameForms:undefined;
    const settingsActions:RoomShellAction[]=[...(tableForm?[{id:'room-shell:table-settings',purpose:'operation' as const,label:'테이블 설정',enabled:true,intent:{kind:'open-form' as const,formId:tableForm.id}}]:[]),...(gameForms?.settingsActions??[])];
    const renameAction:RoomShellAction|null=rename?{id:'room-shell:rename-name',purpose:'operation',label:'이름 바꾸기',enabled:true,intent:{kind:'open-form',formId:rename.id}}:null;
    const extraSettings=[...(renameAction?[renameAction]:[]),...settingsActions];
    const hasSettings=shell.pages.some(page=>page.id==='settings');
    const needSettings=hasSettings||extraSettings.length>0;
    const description=client.room?tableSettingsSummary(client.room.table):undefined;
    const readyShell:RoomShell={...shell,notices:[...shell.notices,...(gameForms?.diagnostics??[])],pages:[...shell.pages.map(page=>{
        if(page.id==='menu')return {...page,actions:[...page.actions,...(report?[{id:'room-shell:report',purpose:'report' as const,label:'문제 신고',enabled:true,intent:{kind:'open-form' as const,formId:report.id}}]:[]),...(!hasSettings&&needSettings?[{id:'room-shell:settings',purpose:'settings' as const,label:'설정',enabled:true,intent:{kind:'open-page' as const,page:'settings' as const}}]:[])]};
        if(page.id==='settings')return {...page,description:[page.description,description].filter(Boolean).join(' · '),actions:[...extraSettings,...page.actions]};
        return page;
    }),...(!hasSettings&&needSettings?[{id:'settings' as const,title:'설정',...(description?{description}:{}),preferences:[],actions:[...extraSettings,{id:'room-shell:close',purpose:'close' as const,label:'닫기',enabled:true,intent:{kind:'close' as const}}]}]:[])]};
    const inheritedForms:FormOffer<HostCommand<A,G['settings']>>[]=(document.forms??[]).map(form=>{
        const {target,actions:formActions,...content}=form;
        return {...content,...(formActions?{actions:formActions.map(action=>({...action,target:action.target.kind==='command'?{kind:'command' as const,actionId:action.target.actionId,template:{kind:'adapter' as const,candidate:action.target.template}}:action.target}))}:{}),...(target?.kind==='command'?{target:{kind:'command' as const,actionId:target.actionId,template:{kind:'adapter' as const,candidate:target.template}}}:target?{target}:{})};
    });
    const forms:FormOffer<HostCommand<A,G['settings']>>[]=[...inheritedForms,...nameForms,...(tableForm?[tableForm]:[]),...(gameForms?.offers??[]),...(report?[report]:[])];
    if(new Set(forms.map(form=>form.id)).size!==forms.length||new Set(forms.map(form=>form.instanceId)).size!==forms.length)throw new Error('Reserved connected form ID');
    return { ...document,forms, decision: { ...document.decision, commands: [...document.decision.commands, ...hostActions.map(action => action.id)] },
        offer: { ...document.offer, id: JSON.stringify([document.offer.id, currentRoomScope ? scope : null]), actions: [...actions, ...hostActions] }, shell: canLeave ? { ...readyShell, leaveActionId: HOST_LEAVE_ACTION } : suppressPlayerLeave(readyShell, client.seat !== null) };
}
/** Public reconnect/initial shell. No prior authorized game document is retained. */
export function publicConnectedDocument<G extends GameTypes,A=never>(metadata: ConnectedShellMetadata<G,A>, revision: number): TableDocument<HostCommand<never, G['settings']>> {
    const document: TableDocument<HostCommand<never, G['settings']>> = {
        context: { session: `room-shell:${metadata.roomCode}`, audience: `public:${metadata.client.viewerId ?? 'anonymous'}`, generation: 'public', revision: String(revision) },
        participant: { role: 'observer', id: 'public-shell', name: '관전자', markers: [] }, hand: [], opponents: [], collections: [], facts: [],
        decision: { kind: 'commands', id: 'public-room-shell', commands: [] }, offer: { id: `public-room-shell:${metadata.roomCode}`, actions: [] },
    };
    return { ...document, shell: suppressPlayerLeave(projectRoomShell({ ...metadata, ruleInformation: [], document: null }), metadata.client.seat !== null) };
}
