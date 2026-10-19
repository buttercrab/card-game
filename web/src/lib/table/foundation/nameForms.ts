import type { CommandScope, RoomAction } from '../../generated/protocol';
import type { HostCommand } from './connectedDocument';
import { copyFormData, ownNormalizedForm, validateFormOffer, validateFormValues, type CommandFormPolicy, type FormOffer, type FormValues } from './forms';

type NameAction = Extract<RoomAction, { type: 'join' | 'rename' }>;
export type NameCommand = Extract<HostCommand<never, unknown>, { kind: 'room' }> & { readonly action: NameAction };
export const NAME_POLICY_ID = 'room-name:v1';
export const NAME_TEXT_FIELD = 'name:text';
interface NameOptions { readonly roomId: string; readonly actorId: string; readonly seat: number | null; readonly name: string; readonly currentScope: CommandScope; readonly nameMax: number; }
export interface NamedJoinOptions extends NameOptions { readonly targetId?: string; readonly device?: string | null; }
const sameFlat = (left: object, right: object): boolean => {
    const a = Object.entries(left), b = Object.entries(right);
    return a.length === b.length && a.every(([key,value]) => Object.hasOwn(right,key) && value === (right as Record<string,unknown>)[key]);
};
const validSeat = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 255;
function ownScope(input: CommandScope): CommandScope {
    const scope = copyFormData(input);
    const expected = ['domain','room_id','room_epoch','session_id','hand','version','seat','actor_id'];
    if (!scope || Object.keys(scope).length !== expected.length || Object.keys(scope).some(key => !expected.includes(key)) || scope.domain !== 'room' ||
        typeof scope.room_id !== 'string' || !scope.room_id || scope.room_id.length > 128 || typeof scope.actor_id !== 'string' || !scope.actor_id || scope.actor_id.length > 128 || typeof scope.room_epoch !== 'string' || !scope.room_epoch || scope.room_epoch.length > 128 || !validSeat(scope.seat) ||
        ![scope.session_id,scope.hand,scope.version].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid name command scope');
    return scope;
}
function makeNameForm(operation: 'join' | 'rename', input: NamedJoinOptions): FormOffer<NameCommand> {
    const options = copyFormData(input), scope = ownScope(options.currentScope);
    if (scope.room_id !== options.roomId || scope.actor_id !== options.actorId || !validSeat(options.seat) ||
        operation === 'join' && scope.seat !== null || operation === 'rename' && scope.seat !== options.seat ||
        !Number.isSafeInteger(options.nameMax) || options.nameMax < 1 || options.nameMax > 8192 || typeof options.name !== 'string' ||
        Array.from(options.name).length > options.nameMax || options.targetId !== undefined && (typeof options.targetId !== 'string' || !options.targetId || options.targetId.length > 128) ||
        options.device !== undefined && options.device !== null && (typeof options.device !== 'string' || options.device.length > 128)) throw new Error('Invalid name form scope');
    const id = operation === 'rename' ? 'host:rename-name' : `host:join-name:${options.seat ?? 'any'}`;
    const binding = { operation, roomId: options.roomId, actorId: options.actorId, viewerSeat: scope.seat, seat: options.seat, targetId: options.targetId ?? null, nameMax: options.nameMax, device: operation === 'join' ? options.device ?? null : null };
    const identity = JSON.stringify([options.roomId,options.actorId,operation,scope.seat,options.seat,options.targetId ?? null]);
    const action: NameAction = operation === 'join' ? { type:'join', name:'', seat:options.seat, device:options.device ?? null } : { type:'rename', name:'' };
    return validateFormOffer({ id, instanceId:identity, schemaVersion:'1', policyId:NAME_POLICY_ID, baseVersion:JSON.stringify(options.name), editBinding:identity,
        title:operation === 'join' ? '이름을 정하고 앉기' : '이름 바꾸기', submitLabel:operation === 'join' ? '앉기' : '바꾸기', enabled:true,
        fields:[{id:NAME_TEXT_FIELD,label:'이름',kind:'text',maxCodePoints:options.nameMax,maxCodeUnits:options.nameMax*2,required:true,initial:options.name}],binding,
        target:{kind:'command',actionId:`${id}:submit`,template:{kind:'room',action,expected:scope}},
    });
}
export function namedJoinForm(options: NamedJoinOptions): FormOffer<NameCommand> { return makeNameForm('join',options); }
export function renameForm(options: NameOptions): FormOffer<NameCommand> { return makeNameForm('rename',options); }

function canonicalNameOffer(input: FormOffer<NameCommand>): FormOffer<NameCommand> {
    const offer = validateFormOffer(input), binding = offer.binding;
    if (offer.policyId !== NAME_POLICY_ID || offer.schemaVersion !== '1' || offer.target?.kind !== 'command' || !['join','rename'].includes(String(binding.operation)) ||
        typeof binding.roomId !== 'string' || typeof binding.actorId !== 'string' || !validSeat(binding.seat) || !validSeat(binding.viewerSeat) || typeof binding.nameMax !== 'number' ||
        !(binding.targetId === null || typeof binding.targetId === 'string') || !(binding.device === null || typeof binding.device === 'string')) throw new Error('Invalid name policy offer');
    const template = offer.target.template;
    if (!template || template.kind !== 'room' || !sameFlat(template,{kind:'room',action:template.action,expected:template.expected})) throw new Error('Invalid name command template');
    const scope = ownScope(template.expected);
    if (scope.room_id !== binding.roomId || scope.actor_id !== binding.actorId || scope.seat !== binding.viewerSeat) throw new Error('Name command scope mismatch');
    const first = offer.fields[0];
    if (!first || first.kind !== 'text') throw new Error('Invalid name field');
    const expected = makeNameForm(binding.operation as 'join'|'rename', {roomId:binding.roomId,actorId:binding.actorId,seat:binding.seat,name:first.initial,currentScope:scope,nameMax:binding.nameMax,
        ...(binding.targetId !== null ? {targetId:binding.targetId} : {}), ...(binding.operation === 'join' ? {device:binding.device} : {})});
    if (expected.target?.kind !== 'command') throw new Error('Missing canonical name target');
    if (offer.id !== expected.id || offer.instanceId !== expected.instanceId || offer.editBinding !== expected.editBinding || offer.baseVersion !== expected.baseVersion ||
        offer.target.actionId !== expected.target.actionId || offer.fields.length !== 1 || !sameFlat(offer.fields[0],expected.fields[0]) || !sameFlat(binding,expected.binding) ||
        !sameFlat(template.action,expected.target.template.action)) throw new Error('Invalid name form template');
    return offer;
}
export const NAME_POLICY: CommandFormPolicy<NameCommand> = Object.freeze({
    id:NAME_POLICY_ID, kind:'command',
    normalize(input: FormOffer<NameCommand>, raw: FormValues) {
        const offer = canonicalNameOffer(input), source = copyFormData(raw);
        validateFormValues(offer,source);
        const rawName = source[NAME_TEXT_FIELD];
        if (rawName !== undefined && typeof rawName !== 'string') throw new Error('Invalid name value');
        const values = {[NAME_TEXT_FIELD]:rawName?.trim() ?? ''};
        return ownNormalizedForm(offer,{values,issues:validateFormValues(offer,values)});
    },
    compile(input: FormOffer<NameCommand>, raw: FormValues) {
        const offer = canonicalNameOffer(input), values = copyFormData(raw), name = values[NAME_TEXT_FIELD];
        if (Object.keys(validateFormValues(offer,values)).length || typeof name !== 'string' || !name || name !== name.trim()) throw new Error('Name draft is not normalized and valid');
        const template = offer.target!.kind === 'command' ? offer.target!.template : null;
        if (!template) throw new Error('Missing name command template');
        return copyFormData({...template,action:{...template.action,name}}) as NameCommand;
    },
    expectedResult(input:FormOffer<NameCommand>,action:NameCommand){const offer=canonicalNameOffer(input);return copyFormData({name:action.action.name,roomId:offer.binding.roomId,actorId:offer.binding.actorId,operation:offer.binding.operation});},
    matchesResult(input:FormOffer<NameCommand>,expected:unknown){try{const offer=canonicalNameOffer(input),result=copyFormData(expected);if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).length!==4)return false;const value=result as Record<string,unknown>;return typeof value.name==='string'&&value.name===offer.fields[0].initial&&value.roomId===offer.binding.roomId&&value.actorId===offer.binding.actorId&&value.operation===offer.binding.operation;}catch{return false;}},
    validateCompiled(input: FormOffer<NameCommand>, candidate: NameCommand) {
        try {
            const offer = canonicalNameOffer(input), action = copyFormData(candidate), template = offer.target!.kind === 'command' ? offer.target!.template : null;
            if (!template || !action || action.kind !== 'room' || !sameFlat(action,{kind:'room',action:action.action,expected:action.expected}) || !sameFlat(action.expected,template.expected) ||
                !action.action || typeof action.action.name !== 'string' || action.action.name !== action.action.name.trim() || Object.keys(validateFormValues(offer,{[NAME_TEXT_FIELD]:action.action.name})).length) return false;
            return sameFlat(action.action,{...template.action,name:action.action.name});
        } catch { return false; }
    },
});
