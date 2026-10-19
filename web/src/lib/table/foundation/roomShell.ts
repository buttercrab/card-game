import type { GameTypes } from '../../room/types';
import type { ConnectedCommandClient } from './connected';
import type { InformationPanel, Scoreboard, TableDocument } from './contracts';
import { validateInformation } from './information';
import type {RoomOperationSubject} from './roomOperations';

export type RoomShellPageId = 'menu' | 'people' | 'rules' | 'scores' | 'settings' | 'manage';
export type PreferenceValue = boolean | string | number;
export interface PreferenceChange { readonly fieldId: string; readonly value: PreferenceValue; }
interface PreferenceBase { readonly id: string; readonly label: string; readonly help?: string; readonly enabled: boolean; }
export type PreferenceField =
    | (PreferenceBase & { readonly kind: 'toggle'; readonly value: boolean })
    | (PreferenceBase & { readonly kind: 'select'; readonly value: string; readonly options: readonly { readonly id: string; readonly label: string; readonly enabled: boolean; readonly help?: string }[] })
    | (PreferenceBase & { readonly kind: 'number'; readonly value: number; readonly min: number; readonly max: number; readonly step: number });
/** leave-room requests a correlated RoomAction.leave; navigation awaits its known outcome. */
export type RoomShellEffect = 'share-room' | 'leave-room';
type RoomShellNavigationIntent =
    | {readonly kind:'open-disclosure';readonly catalogId:string}
    | {readonly kind:'open-form';readonly formId:string}
    | { readonly kind: 'open-page'; readonly page: RoomShellPageId }
    | { readonly kind: 'close' }
    | { readonly kind: 'request-effect'; readonly effect: RoomShellEffect }
    | { readonly kind: 'confirm-leave' }
    | { readonly kind: 'cancel-confirmation' };
export type RoomShellCommandIntent = { readonly kind: 'command'; readonly actionId: string }
    | { readonly kind: 'inspect-subject'; readonly subject: RoomOperationSubject };
export type RoomShellIntent = RoomShellNavigationIntent | RoomShellCommandIntent;
export interface RoomShellAction {
    readonly id: string;
    readonly purpose: 'share' | 'people' | 'menu' | 'rules' | 'scores' | 'settings' | 'manage' | 'operation' | 'report' | 'leave' | 'close' | 'confirm' | 'cancel';
    readonly label: string;
    readonly enabled: boolean;
    readonly intent: RoomShellIntent;
    readonly subjects?: readonly RoomOperationSubject[];
    readonly confirmation?: { readonly title: string; readonly message: string; readonly confirmLabel: string };
}
export interface RoomShellNotice { readonly id: string; readonly text: string; readonly tone: 'plain' | 'danger'; }
export interface RoomShellPerson {
    readonly id: string;
    readonly name: string;
    readonly kind: 'human' | 'bot' | 'observer';
    readonly mine: boolean;
    readonly status: string;
    /** A reconnecting connection may observe while its same-identity seat is offline. */
    readonly observing?: true;
    readonly actions?: readonly RoomShellAction[];
}
export interface RoomShellSeat { readonly setupActionId?:string; readonly setupLabel?:string; readonly seat: number; readonly participantId?: string; readonly name: string; readonly kind: 'empty'|'human'|'bot'; readonly actions: readonly RoomShellAction[]; }
export interface RoomShellSubjectGroup { readonly subject: RoomOperationSubject; readonly title: string; readonly description?: string; readonly actions: readonly RoomShellAction[]; }
export interface RoomShellPage {
    readonly id: RoomShellPageId;
    readonly title: string;
    readonly description?: string;
    readonly actions: readonly RoomShellAction[];
    readonly information?: readonly InformationPanel[];
    readonly scoreboard?: Scoreboard;
    readonly preferences?: readonly PreferenceField[];
    readonly people?: readonly RoomShellPerson[];
    /** Public count only: never manufacture identities for unnamed observers. */
    readonly anonymousObservers?: number;
}
/** Semantic content only. Disclosure/confirmation visibility and focus belong to runtime. */
export interface RoomShell {
    readonly seats?: readonly RoomShellSeat[];
    readonly management?: readonly RoomShellSubjectGroup[];
    readonly roomCode: string;
    /** Player leave is an ordinary correlated command; observers may navigate directly. */
    readonly leaveActionId?: string;
    readonly header: {
        readonly codeLabel: string;
        readonly connection: ConnectedCommandClient<GameTypes>['status'];
        readonly connectionLabel: string;
        readonly observerCount: number;
        readonly observerLabel: string;
        readonly requestCount: number;
        readonly requestLabel: string;
        readonly actions: readonly RoomShellAction[];
    };
    readonly notices: readonly RoomShellNotice[];
    readonly pages: readonly RoomShellPage[];
    readonly effects: readonly RoomShellEffect[];
    readonly leaveConfirmation?: { readonly title: string; readonly message: string; readonly actions: readonly RoomShellAction[] };
}
const validText = (value: unknown, limit = 500): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
/** Clone/freeze accepted wire data; reject capabilities, accessors, cycles and unbounded input. */
function plainCopy<T>(value: T, ancestors = new Set<object>(), budget = { nodes: 0 }, depth = 0): T {
    if (++budget.nodes > 8192 || depth > 32) throw new Error('Room shell data budget exceeded');
    if (typeof value === 'string' && value.length > 2048) throw new Error('Room shell text budget exceeded');
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Invalid room shell number'); return value; }
    if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Room shell requires plain inert data');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('Room shell requires plain inert data');
    ancestors.add(value);
    try {
        if (Array.isArray(value)) return Object.freeze(value.map(item => plainCopy(item, ancestors, budget, depth + 1))) as T;
        const result: Record<string, unknown> = {};
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            if (!('value' in descriptor)) throw new Error('Room shell accessors are unsupported');
            if (descriptor.value !== undefined) Object.defineProperty(result, key, { value: plainCopy(descriptor.value, ancestors, budget, depth + 1), enumerable: true });
        }
        return Object.freeze(result) as T;
    } finally { ancestors.delete(value); }
}
const action = (id: string, purpose: RoomShellAction['purpose'], label: string, intent: RoomShellIntent, enabled = true): RoomShellAction => ({ id: `room-shell:${id}`, purpose, label, enabled, intent });
const navigate = (page: RoomShellPageId, purpose: RoomShellAction['purpose'], label: string, enabled = true) => action(page, purpose, label, { kind: 'open-page', page }, enabled);
export function roomShellActions(shell: RoomShell): readonly RoomShellAction[] {
    return [...shell.header.actions, ...shell.pages.flatMap(page => [...page.actions, ...(page.people ?? []).flatMap(person => person.actions ?? [])]),
        ...(shell.seats ?? []).flatMap(seat => seat.actions), ...(shell.management ?? []).flatMap(group => group.actions), ...(shell.leaveConfirmation?.actions ?? [])];
}
/** Waiting-stage setup consumes exact existing descriptors, never game payloads. */
export function waitingSeatActions(shell:RoomShell):readonly RoomShellAction[]{
 const actions=new Map(roomShellActions(shell).map(action=>[action.id,action]));
 return [...new Set((shell.seats??[]).flatMap(seat=>seat.setupActionId?[seat.setupActionId]:[]))].flatMap(id=>{const action=actions.get(id);return action?[action]:[];});
}
/** Explicit canonical shell references, never an ID-prefix convention. */
export function shellCommandActionIds(shell: RoomShell): readonly string[] {
    return [...new Set([...(shell.leaveActionId ? [shell.leaveActionId] : []), ...roomShellActions(shell).flatMap(action => action.intent.kind === 'command' ? [action.intent.actionId] : [])])];
}
export const sameRoomSubject = (a: RoomOperationSubject | undefined, b: RoomOperationSubject | undefined): boolean => !!a && !!b &&
    (a.kind === 'room' && b.kind === 'room' ? a.roomId === b.roomId : a.kind === 'person' && b.kind === 'person' ? a.participantId === b.participantId : a.kind === 'seat' && b.kind === 'seat' && a.seat === b.seat && a.participantId === b.participantId);

function preferenceValueInDomain(field: PreferenceField, value: PreferenceValue, requireEnabled: boolean): boolean {
    if (requireEnabled && !field.enabled) return false;
    if (field.kind === 'toggle') return typeof value === 'boolean';
    if (field.kind === 'select') return typeof value === 'string' && !!field.options.find(option => option.id === value && (!requireEnabled || option.enabled));
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) return false;
    const steps = (value - field.min) / field.step;
    return Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) <= 1e-7;
}
/** Shared admission check; native controls and host setters are not authority. */
export function acceptPreferenceValue(field: PreferenceField, value: PreferenceValue): boolean {
    return preferenceValueInDomain(field, value, true);
}
export function validatePreferenceFields(fields: readonly PreferenceField[]): void {
    plainCopy(fields);
    if (!Array.isArray(fields) || fields.length > 20 || new Set(fields.map(field => field.id)).size !== fields.length) throw new Error('Invalid preference fields');
    const entries: readonly PreferenceField[] = fields;
    for (const field of entries) {
        const allowed = ['id', 'label', 'help', 'enabled', 'kind', 'value', ...(field.kind === 'select' ? ['options'] : field.kind === 'number' ? ['min', 'max', 'step'] : [])];
        if (!field || Object.keys(field).some(key => !allowed.includes(key)) || !validText(field.id, 128) || !validText(field.label) || field.help !== undefined && !validText(field.help) || typeof field.enabled !== 'boolean' || !['toggle', 'select', 'number'].includes(field.kind)) throw new Error('Invalid preference field');
        if (field.kind === 'select' && (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 16 || new Set(field.options.map(option => option.id)).size !== field.options.length ||
            field.options.some(option => !option || Object.keys(option).some(key => !['id', 'label', 'enabled', 'help'].includes(key)) || !validText(option.id, 128) || !validText(option.label) || typeof option.enabled !== 'boolean' || option.help !== undefined && !validText(option.help)))) throw new Error('Invalid preference options');
        if (field.kind === 'number' && (![field.min, field.max, field.step].every(Number.isFinite) || field.max <= field.min || field.max - field.min > 1e9 || field.step <= 0 || field.step > field.max - field.min)) throw new Error('Invalid preference interval');
        if (!preferenceValueInDomain(field, field.value, false)) throw new Error('Invalid preference value');
    }
}

/** Session-ingress validation. It accepts inert content, never authority to execute an effect. */
export function validateRoomShell<A>(shell: RoomShell, document?: TableDocument<A> | null): void {
    plainCopy(shell); // Reject capabilities, accessors, cycles and excessive depth before property reads.
    const fail = () => { throw new Error('Invalid room shell document'); };
    const keys = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
    const unique = (values: readonly string[]) => new Set(values).size === values.length;
    const pages = new Set<RoomShellPageId>(['menu', 'people', 'rules', 'scores', 'settings', 'manage']);
    const effects = new Set<RoomShellEffect>(['share-room', 'leave-room']);
    if (!shell || !keys(shell, ['roomCode', 'seats', 'management', 'leaveActionId', 'header', 'notices', 'pages', 'effects', 'leaveConfirmation']) || !validText(shell.roomCode, 128) ||
        !Array.isArray(shell.pages) || shell.pages.length < 1 || shell.pages.length > 6 || !unique(shell.pages.map(page => page.id)) || shell.pages.some(page => !pages.has(page.id)) ||
        !Array.isArray(shell.effects) || shell.effects.length > 2 || !unique(shell.effects) || shell.effects.some(effect => !effects.has(effect))) fail();
    if(shell.leaveActionId!==undefined&&(!validText(shell.leaveActionId,128)||!document?.decision.commands.includes(shell.leaveActionId)||!document.offer.actions.some(action=>action.id===shell.leaveActionId&&action.kind==='command')))fail();
    const pageIds = new Set(shell.pages.map(page => page.id));
    if (shell.seats !== undefined && (!Array.isArray(shell.seats) || shell.seats.length > 32 || new Set(shell.seats.map(seat => seat.seat)).size !== shell.seats.length || shell.seats.some(seat => !seat || !keys(seat, ['seat', 'participantId', 'name', 'kind', 'actions', 'setupActionId', 'setupLabel']) || !validCount(seat.seat) || seat.seat > 31 || !validText(seat.name) || seat.setupActionId!==undefined&&!validText(seat.setupActionId,128) || seat.setupLabel!==undefined&&(seat.setupActionId===undefined||!validText(seat.setupLabel,128)) || !['empty', 'human', 'bot'].includes(seat.kind) || seat.participantId !== undefined && !validText(seat.participantId, 128)))) fail();
    const peopleIds = new Set(shell.pages.flatMap(page => (page.people ?? []).map(person => person.id)));
    const subject = (value: RoomOperationSubject): boolean => {
        if (!value || typeof value !== 'object') return false;
        if (value.kind === 'room') return keys(value, ['kind', 'roomId']) && value.roomId === shell.roomCode;
        if (value.kind === 'person') return keys(value, ['kind', 'participantId']) && peopleIds.has(value.participantId);
        if (value.kind !== 'seat' || !keys(value, ['kind', 'seat', 'participantId'])) return false;
        const seat = shell.seats?.find(seat => seat.seat === value.seat);
        return !!seat && (value.participantId === undefined || value.participantId === seat.participantId);
    };
    if (shell.management !== undefined && (!Array.isArray(shell.management) || shell.management.length > 64 || !pageIds.has('manage') || shell.management.some((group, index) => !group || !keys(group, ['subject', 'title', 'description', 'actions']) || !subject(group.subject) || !validText(group.title) || group.description !== undefined && !validText(group.description) || shell.management!.slice(0, index).some(previous => sameRoomSubject(previous.subject, group.subject))))) fail();
    const definitions = new Map<string, string>();
    const actions = (items: readonly RoomShellAction[], maximum = 16) => {
        if (!Array.isArray(items) || items.length > maximum || !unique(items.map(item => item.id))) fail();
        for (const item of items) {
            if (!item || !keys(item, ['id', 'purpose', 'label', 'enabled', 'intent', 'subjects', 'confirmation']) || !validText(item.id, 128) || !validText(item.label) || typeof item.enabled !== 'boolean' ||
                !['share', 'people', 'menu', 'rules', 'scores', 'settings', 'manage', 'operation', 'report', 'leave', 'close', 'confirm', 'cancel'].includes(item.purpose) || !item.intent) fail();
            const definition = JSON.stringify(item);
            if (definitions.has(item.id) && definitions.get(item.id) !== definition) fail();
            definitions.set(item.id, definition);
            const intent = item.intent;
            if (intent.kind !== 'command' && (item.subjects !== undefined || item.confirmation !== undefined)) fail();
            switch (intent.kind) {
                case 'open-disclosure':if(!keys(intent,['kind','catalogId'])||!validText(intent.catalogId,2048)||document?.disclosures?.filter(catalog=>catalog.id===intent.catalogId).length!==1)fail();break;
                case 'open-form':if(!keys(intent,['kind','formId'])||!document?.forms?.some(form=>form.id===intent.formId))fail();break;
                case 'open-page': if (!keys(intent, ['kind', 'page']) || !pageIds.has(intent.page)) fail(); break;
                case 'request-effect': if (!keys(intent, ['kind', 'effect']) || !shell.effects.includes(intent.effect)) fail(); break;
                case 'confirm-leave': case 'cancel-confirmation': if (!keys(intent, ['kind']) || !shell.leaveConfirmation) fail(); break;
                case 'close': if (!keys(intent, ['kind'])) fail(); break;
                case 'inspect-subject': if (!keys(intent, ['kind', 'subject']) || !subject(intent.subject) || !shell.management?.some(group => sameRoomSubject(group.subject, intent.subject))) fail(); break;
                case 'command': {
                    const binding = document?.offer.actions.find(action => action.id === intent.actionId);
                    if (!keys(intent, ['kind', 'actionId']) || !validText(intent.actionId, 128) || !document?.decision.commands.includes(intent.actionId) || binding?.kind !== 'command' || item.enabled && !binding.enabled ||
                        !Array.isArray(item.subjects) || item.subjects.length < 1 || item.subjects.length > 3 || !item.subjects.every(subject)) fail();
                    if (item.confirmation && (!keys(item.confirmation, ['title', 'message', 'confirmLabel']) || !validText(item.confirmation.title) || !validText(item.confirmation.message) || !validText(item.confirmation.confirmLabel))) fail();
                    break;
                }
                default: fail();
            }
        }
    };
    const header = shell.header;
    if (!header || !keys(header, ['codeLabel', 'connection', 'connectionLabel', 'observerCount', 'observerLabel', 'requestCount', 'requestLabel', 'actions']) ||
        !validText(header.codeLabel) || !validText(header.connectionLabel) || !validText(header.observerLabel) || !validText(header.requestLabel) ||
        !['connecting', 'open', 'closed', 'missing'].includes(header.connection) || !validCount(header.observerCount) || !validCount(header.requestCount)) fail();
    actions(header.actions, 8);
    if (!Array.isArray(shell.notices) || shell.notices.length > 16 || !unique(shell.notices.map(notice => notice.id)) || shell.notices.some(notice => !notice || !keys(notice, ['id', 'text', 'tone']) || !validText(notice.id, 128) || !validText(notice.text) || !['plain', 'danger'].includes(notice.tone))) fail();
    const information: InformationPanel[] = [];
    let scoreboard: Scoreboard | undefined;
    for (const page of shell.pages) {
        if (!page || !keys(page, ['id', 'title', 'description', 'actions', 'information', 'scoreboard', 'preferences', 'people', 'anonymousObservers']) || !validText(page.title) || page.description !== undefined && !validText(page.description)) fail();
        actions(page.actions);
        if (page.id === 'people') {
            const people = page.people;
            if (!Array.isArray(people) || people.length > 288 || !unique(people.map(person => person.id)) || !validCount(page.anonymousObservers) ||
                people.some(person => !person || !keys(person, ['id', 'name', 'kind', 'mine', 'status', 'observing', 'actions']) || !validText(person.id, 128) || !validText(person.name) || !validText(person.status) || typeof person.mine !== 'boolean' || !['human', 'bot', 'observer'].includes(person.kind) || person.observing !== undefined && (person.observing !== true || person.kind !== 'human')) ||
                people.filter(person => person.kind === 'observer' || person.observing).length + page.anonymousObservers! !== header.observerCount) fail();
            for (const person of people!) if (person.actions) actions(person.actions, 4);
        } else if (page.people !== undefined || page.anonymousObservers !== undefined) fail();
        if (page.id === 'rules') {
            if (!Array.isArray(page.information)) fail();
            information.push(...page.information!);
        } else if (page.information !== undefined) fail();
        if (page.id === 'scores') scoreboard = page.scoreboard;
        else if (page.scoreboard !== undefined) fail();
        if (page.id === 'settings') validatePreferenceFields(page.preferences ?? []);
        else if (page.preferences !== undefined) fail();
    }
    for (const seat of shell.seats ?? []) actions(seat.actions, 4);
    for (const group of shell.management ?? []) {
        actions(group.actions, 64);
        if (group.actions.some((action:RoomShellAction) => action.intent.kind === 'command' && !action.subjects?.some((value:RoomOperationSubject) => sameRoomSubject(value, group.subject)))) fail();
    }
    for(const seat of shell.seats??[])if(seat.setupActionId!==undefined){
        const referenced=roomShellActions(shell).find(action=>action.id===seat.setupActionId);
        const target:RoomOperationSubject={kind:'seat',seat:seat.seat,...(seat.participantId?{participantId:seat.participantId}:{})};
        if(!referenced)fail();
        const belongs=shell.management?.some(group=>sameRoomSubject(group.subject,target)&&group.actions.some((action:RoomShellAction)=>action.id===referenced!.id));
        if(referenced!.intent.kind==='inspect-subject'){
            if(!sameRoomSubject(referenced!.intent.subject,target))fail();
        }else if(!belongs||referenced!.intent.kind!=='command'&&referenced!.intent.kind!=='open-form'||referenced!.intent.kind==='command'&&!referenced!.subjects?.some(subject=>sameRoomSubject(subject,target)))fail();
    }
    if (information.length || scoreboard) {
        if (!document) throw new Error('Room shell information requires an authorized participant context');
        validateInformation({ ...document!, information, scoreboard });
    }
    if (shell.leaveConfirmation) {
        const confirmation = shell.leaveConfirmation;
        if (!keys(confirmation, ['title', 'message', 'actions']) || !validText(confirmation.title) || !validText(confirmation.message)) fail();
        actions(confirmation.actions, 4);
        if (!confirmation.actions.some(item => item.intent.kind === 'cancel-confirmation') ||
            !confirmation.actions.some(item => item.intent.kind === 'request-effect' && item.intent.effect === 'leave-room')) fail();
    }
    if (definitions.size > 256) fail();
}

/** The caller owns authorization/freshness. A missing room publishes no retained game information. */
export function projectRoomShell<G extends GameTypes, A>({ roomCode, client, document, ruleInformation = [], preferences = [], notice, recovery, journalFull = false }: {
    roomCode: string;
    client: Pick<ConnectedCommandClient<G>, 'status' | 'room' | 'seat' | 'viewerId'>;
    document?: TableDocument<A> | null;
    ruleInformation?: readonly InformationPanel[];
    preferences?: readonly PreferenceField[];
    notice?: RoomShellNotice;
    recovery?: { readonly pending: number; readonly recovering?: number; readonly storageError: boolean; readonly capacity: boolean };
    journalFull?: boolean;
}): RoomShell {
    if (!validText(roomCode, 128) || !['connecting', 'open', 'closed', 'missing'].includes(client.status)) throw new Error('Invalid room shell context');
    const room = client.room;
    validatePreferenceFields(preferences);
    const observers = room?.observers ?? [], requests = room?.participation ?? [];
    if (room && (room.id !== roomCode || !Array.isArray(room.seats) || room.seats.length > 32 || !validCount(room.watching) ||
        !Array.isArray(observers) || observers.length > 256 || observers.length > room.watching || !Array.isArray(requests) || requests.length > 256)) throw new Error('Invalid room shell roster');
    const people: RoomShellPerson[] = [];
    room?.seats.forEach((person, index) => {
        if (person.kind === 'empty') return;
        if (!validText(person.name)) throw new Error('Invalid room shell identity');
        const id = room.participant_ids?.[index] || `seat-${index}`;
        if (!validText(id, 128)) throw new Error('Invalid room shell participant');
        people.push({ id, name: person.name, kind: person.kind, mine: index === client.seat,
            status: person.kind === 'bot' ? `봇 · ${person.level === 'easy' ? '쉬움' : person.level === 'normal' ? '보통' : '어려움'}`
                : !person.connected ? '연결 끊김' : person.away ? '자리 비움' : room.in_hand ? '플레이 중' : room.ready?.[index] ? '준비' : room.showing ? '검토 중' : '대기' });
    });
    if (new Set(people.map(person => person.id)).size !== people.length) throw new Error('Duplicate room shell identity');
    const requestIds = new Set<string>();
    for (const request of requests) {
        if (!validText(request.id, 128) || requestIds.has(request.id) || !validCount(request.order) || request.seat !== null && (!validCount(request.seat) || request.seat >= room!.seats.length)) throw new Error('Invalid room shell participation');
        requestIds.add(request.id);
    }
    const observerIds = new Set<string>();
    for (const observer of observers) {
        if (!validText(observer.id, 128) || !validText(observer.name)) throw new Error('Invalid room shell observer');
        if (observerIds.has(observer.id)) throw new Error('Duplicate room shell observer');
        observerIds.add(observer.id);
        const request = requests.find(item => item.id === observer.id);
        const status = request?.seat !== null && request?.seat !== undefined ? '다음 판 참여 예약' : observer.requested ? `참여 대기 · ${request?.order ?? 1}번째` : '관전 중';
        const existingIndex = people.findIndex(person => person.id === observer.id);
        if (existingIndex >= 0) {
            // Server observers() excludes seated connections, rather than offline
            // occupants. Observe-before-reclaim can therefore name the same human
            // in both lists. Keep one identity and both public participation facts.
            const seatIndex = room!.seats.findIndex((_, index) => (room!.participant_ids?.[index] || `seat-${index}`) === observer.id);
            const occupant = room!.seats[seatIndex];
            if (occupant?.kind !== 'human' || occupant.connected) throw new Error('Duplicate room shell identity');
            const person = people[existingIndex];
            people[existingIndex] = { ...person, mine: person.mine || observer.id === client.viewerId, observing: true, status: `${person.status} · ${status}` };
            continue;
        }
        people.push({ id: observer.id, name: observer.name, kind: 'observer', mine: observer.id === client.viewerId,
            status });
    }
    if (new Set(people.map(person => person.id)).size !== people.length) throw new Error('Duplicate room shell identity');
    let rules: readonly InformationPanel[] = [], scoreboard: Scoreboard | undefined;
    if (room && (ruleInformation.length || document?.scoreboard)) {
        if (!document) throw new Error('Room shell information requires an authorized participant context');
        const memberIds = new Set(room.seats.map((_, index) => room.participant_ids?.[index] || `seat-${index}`));
        const tableIds = [...(document.participant.role === 'observer' ? [] : [document.participant.id]), ...(document.opponents ?? []).map(person => person.id)];
        if (tableIds.some(id => !memberIds.has(id))) throw new Error('Room shell participant context differs from room');
        rules = plainCopy(ruleInformation); scoreboard = document.scoreboard ? plainCopy(document.scoreboard) : undefined;
        validateInformation({ ...document, information: rules, scoreboard });
    }
    const observerCount = room?.watching ?? 0, requestCount = requests.length;
    const share = action('share', 'share', '초대하기', { kind: 'request-effect', effect: 'share-room' }, !!room);
    const peopleAction = navigate('people', 'people', '함께 있는 사람', !!room);
    const rulesAction = navigate('rules', 'rules', '규칙 보기', rules.length > 0);
    const scoresAction = navigate('scores', 'scores', '누적 점수', !!scoreboard);
    const close = action('close', 'close', '닫기', { kind: 'close' });
    const settingsAction = navigate('settings', 'settings', '설정');
    const needsConfirmation = !!room?.in_hand && client.seat !== null;
    const leave = action('leave', 'leave', '테이블 나가기', needsConfirmation ? { kind: 'confirm-leave' } : { kind: 'request-effect', effect: 'leave-room' });
    const notices: RoomShellNotice[] = [];
    if (client.status === 'missing') notices.push({ id: 'missing', text: `${roomCode} 테이블이 없어요`, tone: 'plain' });
    else if (client.status === 'connecting') notices.push({ id: 'connecting', text: '연결하는 중…', tone: 'plain' });
    else if (client.status === 'closed') notices.push({ id: 'reconnecting', text: '잠깐 다시 연결하는 중…', tone: 'plain' });
    if (recovery) {
        // Older callers cannot distinguish a fresh submission from uncertainty.
        const recovering = recovery.recovering === undefined ? recovery.pending : recovery.recovering;
        if (!validCount(recovery.pending) || !validCount(recovering) || recovering > recovery.pending) throw new Error('Invalid room shell recovery count');
        if (recovery.storageError) notices.push({ id: 'storage', text: '명령 복구 기록을 저장하지 못했어요. 브라우저 저장소를 확인해주세요.', tone: 'danger' });
        else if (recovery.capacity) notices.push({ id: 'capacity', text: '이 창의 복구 기록 한도에 도달했어요. 이전 계정의 요청부터 확인해주세요.', tone: 'danger' });
        else if (recovering) notices.push({ id: 'pending', text: '이전 요청의 처리 결과를 확인하고 있어요.', tone: 'plain' });
    }
    if (journalFull) notices.push({ id: 'journal-full', text: '명령 기록 한도에 도달했어요. 화면을 새로고침해 최신 서버 상태를 확인해주세요.', tone: 'danger' });
    if (notice) {
        if (!validText(notice.id, 128) || !validText(notice.text) || !['plain', 'danger'].includes(notice.tone)) throw new Error('Invalid room shell notice');
        notices.push({ ...notice, id: `host:${notice.id}` });
    }
    const shell: RoomShell = {
        roomCode, header: { codeLabel: `테이블 ${roomCode}`, connection: client.status,
            connectionLabel: client.status === 'open' ? '연결됨' : client.status === 'closed' ? '연결 끊김' : client.status === 'missing' ? '테이블 없음' : '연결 중',
            observerCount, observerLabel: `관전자 ${observerCount}명`, requestCount, requestLabel: `참여 요청 ${requestCount}건`,
            actions: [share, peopleAction, ...(preferences.length ? [settingsAction] : []), navigate('menu', 'menu', '메뉴')] },
        notices, pages: [
            { id: 'menu', title: `테이블 ${roomCode}`, actions: [share, rulesAction, ...(preferences.length ? [settingsAction] : []), peopleAction, scoresAction, leave, close] },
            { id: 'people', title: '함께 있는 사람', people, anonymousObservers: observerCount - observers.length, actions: [close] },
            { id: 'rules', title: '규칙 보기', information: rules, actions: [close] },
            { id: 'scores', title: '누적 점수', ...(scoreboard ? { scoreboard } : {}), actions: [close] },
            ...(preferences.length ? [{ id: 'settings' as const, title: '설정', description: '이 기기의 화면과 소리에만 적용돼요.', preferences, actions: [close] }] : []),
        ], effects: ['share-room', 'leave-room'],
        ...(needsConfirmation ? { leaveConfirmation: { title: '테이블을 나갈까요?', message: '지금 나가면 봇이 대신 둬요.', actions: [action('cancel-leave', 'cancel', '취소', { kind: 'cancel-confirmation' }), action('confirm-leave', 'confirm', '나가기', { kind: 'request-effect', effect: 'leave-room' })] } } : {}),
    };
    validateRoomShell(shell, document);
    return plainCopy(shell);
}
