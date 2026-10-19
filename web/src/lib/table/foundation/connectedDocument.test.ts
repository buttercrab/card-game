import { expect, test, vi } from 'vitest';
import { CATALOG } from '../../catalog';
import type { GameTypes, RoomViewOf } from '../../room/types';
import type { CommandWindow } from '../../generated/protocol';
import { createCommandTransport } from '../../room/commandTransport';
import { connectedDocument, HOST_LEAVE_ACTION, publicConnectedDocument, withConnectedDisclosures, type HostCommand } from './connectedDocument';
import {TABLE_FORM_POLICY} from './tableForms';
import { NAME_POLICY,NAME_TEXT_FIELD } from './nameForms';
import { withRoomOperations } from './roomOperationShell';
import { projectRoomOperations } from './roomOperations';
import { proofDocument } from './fixtures';
import { createCardSession } from './session';
import { validateTableDecision } from './decisions';
import type {FormOffer} from './forms';

function metadata() {
    const room: RoomViewOf<GameTypes> = { id: 'connected', game: 'generic', protocol: CATALOG.protocol, settings: {}, rules: {}, customized: false,
        seats: [{ kind: 'human', name: '재용', connected: true, away: false }], participant_ids: ['local'], ready: [true], participation: [],
        in_hand: true, showing: true, table: { turn_secs: 30, shuffle: false, shuffle_next: false }, clock: null, watching: 1,
        observers: [{ id: 'watcher', name: '보리', requested: false }], scores: [10], hands_played: 0, history: [], hands: [] };
    const roomWindow: CommandWindow = { scope: { domain: 'room', room_id: room.id, room_epoch: 'a'.repeat(32), actor_id: 'actor', seat: 0, session_id: 1, hand: 0, version: 7 }, next_sequence: 1 };
    return { roomCode: room.id, client: { status: 'open' as const, room, game: null, seat: 0, viewerId: 'actor', viewerName: '재용' }, roomWindow };
}
test('connected disclosure navigation is built from exact catalog references without adding game commands',()=>{
 const source=connectedDocument(proofDocument(),metadata());
 const context={roomId:'connected',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',audience:source.context.audience};
 const offer={id:'history',policyId:'history-reader',revision:'1',title:'판 기록',total:1,pageSize:12 as const,scope:{roomId:context.roomId,roomEpoch:context.roomEpoch,actorId:context.actorId,connectionEpoch:context.connectionEpoch,visibility:'public' as const}};
 const projection={offers:[offer],menuItems:[{id:'history',label:'판 기록',catalogId:offer.id}]};
 const result=withConnectedDisclosures(source,projection,context);
 expect(result.shell!.pages.find(page=>page.id==='menu')!.actions.at(-1)).toMatchObject({id:'room-disclosure:history',intent:{kind:'open-disclosure',catalogId:'history'}});
 expect(result.offer).toBe(source.offer);expect(result.decision).toBe(source.decision);expect(source.disclosures).toBeUndefined();
 expect(()=>withConnectedDisclosures(source,{...projection,menuItems:[{...projection.menuItems[0],catalogId:'foreign'}]},context)).toThrow();
 expect(()=>withConnectedDisclosures(source,{...projection,menuItems:[...projection.menuItems,...projection.menuItems]},context)).toThrow();
 expect(()=>withConnectedDisclosures(source,{...projection,offers:[offer,offer]},context)).toThrow();
 expect(()=>withConnectedDisclosures(source,{...projection,outcomeDetailsCatalogId:'history'},context)).toThrow();
 const rules=withConnectedDisclosures(source,{...projection,rulesCatalogId:'history'},context);
 expect(rules.shell!.pages.find(page=>page.id==='menu')!.actions.find(action=>action.purpose==='rules')).toMatchObject({enabled:true,intent:{kind:'open-disclosure',catalogId:'history'}});
 expect(rules.offer).toBe(source.offer);expect(rules.decision).toBe(source.decision);
 expect(()=>withConnectedDisclosures(source,{...projection,rulesCatalogId:'foreign'},context)).toThrow();
 let reads=0;const malicious=Object.defineProperty({...projection},'menuItems',{enumerable:true,get(){reads++;return [];}});
 expect(()=>withConnectedDisclosures(source,malicious,context)).toThrow();expect(reads).toBe(0);
});
test('disclosure host forms require exact selection links and cannot add game command authority',()=>{
 const source=connectedDocument(proofDocument(),metadata()),context={roomId:'connected',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',audience:source.context.audience};
 const offer={id:'device',policyId:'reader',revision:'1',title:'기록',total:1,pageSize:12 as const,scope:{...context,visibility:'audience' as const}};
 const form:FormOffer<never>={id:'delete',instanceId:'delete:1',schemaVersion:'delete-v1',policyId:'delete-policy',purpose:'confirmation',retry:'new-offer',access:{kind:'disclosure-selection',selectionId:'selected:1'},baseVersion:'1',editBinding:'delete:1',title:'삭제할까요?',submitLabel:'삭제',fields:[],binding:{roomId:context.roomId,actorId:context.actorId,seat:0},enabled:true,actions:[{id:'delete',label:'삭제',target:{kind:'host',operationId:'delete-records'}}]};
 const action={id:'delete-reference',label:'기록 삭제',intent:'danger' as const,selectionId:'selected:1',catalogId:'device',catalogRevision:'1',entryId:'entry:1',formId:form.id,formInstanceId:form.instanceId};
 const projection={offers:[offer],menuItems:[],forms:[form],formActions:[action]},result=withConnectedDisclosures(source,projection,context);
 expect(result.forms!.at(-1)).toEqual(form);expect(result.disclosureFormActions).toEqual([action]);expect(result.offer).toBe(source.offer);
 expect(()=>withConnectedDisclosures(source,{...projection,formActions:[]},context)).toThrow();
 expect(()=>withConnectedDisclosures(source,{...projection,formActions:[{...action,selectionId:'foreign'}]},context)).toThrow();
 expect(()=>withConnectedDisclosures(source,{...projection,forms:[form,form]},context)).toThrow();
 expect(()=>withConnectedDisclosures(source,{...projection,forms:[{...form,actions:[{id:'send',label:'送信',target:{kind:'command',actionId:'game',template:'secret' as never}}]}]},context)).toThrow();
});
test('wrapping keeps exact game IDs/decision tuples while adding an ordinary correlated leave binding', () => {
    const source = proofDocument(), details = metadata(), document = connectedDocument(source, details);
    expect(document.offer.id).toBe(JSON.stringify([source.offer.id, details.roomWindow.scope]));
    expect(document.offer.actions.slice(0, -1).map(action => action.id)).toEqual(source.offer.actions.map(action => action.id));
    if (source.decision.kind !== 'finite-choice' || document.decision.kind !== 'finite-choice') throw new Error('finite fixture');
    expect(document.decision.variants).toBe(source.decision.variants);
    expect(document.decision.commands).toEqual([...source.decision.commands, HOST_LEAVE_ACTION]);
    expect(document.offer.actions[0]).toMatchObject({ action: { kind: 'adapter', candidate: source.offer.actions[0].kind === 'command' ? source.offer.actions[0].action : undefined } });
    expect(document.offer.actions.at(-1)).toMatchObject({ id: HOST_LEAVE_ACTION, action: { kind: 'room', action: { type: 'leave' }, expected: details.roomWindow.scope } });
    expect(document.shell!.leaveActionId).toBe(HOST_LEAVE_ACTION); expect(validateTableDecision(document)).toEqual([]);
});
test('host leave is admitted through the same session action/operation path', async () => {
    const send = vi.fn(), session = createCardSession({ transport: send });
    session.receive(connectedDocument(proofDocument(), metadata()));
    const document = session.snapshot().document!, action = document.offer.actions.find(action => action.id === HOST_LEAVE_ACTION)!;
    if (action.kind !== 'command') throw new Error('command');
    expect(session.admit(document.context, document.offer.id, action.id, action.action)).toBe(true);
    await Promise.resolve(); expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ actionId: HOST_LEAVE_ACTION, action: { kind: 'room', action: { type: 'leave' } } });
    expect(session.snapshot().operations[0].status).toBe('uncertain'); session.dispose();
});
test('leave retains its offered expected scope and cannot rebase onto a newer room window', () => {
    const details = metadata(), document = connectedDocument(proofDocument(), details);
    const action = document.offer.actions.at(-1)!;
    if (action.kind !== 'command' || action.action.kind !== 'room') throw new Error('room command');
    details.roomWindow.scope.version++;
    expect(action.action.expected.version).toBe(7);
    const sent = vi.fn(() => true), transport = createCommandTransport({ room: details.roomCode, send: sent, store: { read: () => [], write: () => {} } });
    transport.update({ connected: true, connection: 1, actor: 'actor', window: null, roomWindow: details.roomWindow });
    expect(transport.submitRoom('old-operation', action.action.expected, action.action.action)).toBe(false); expect(sent).not.toHaveBeenCalled();
    expect(transport.submitRoom('new-operation', details.roomWindow.scope, action.action.action)).toBe(true); transport.dispose();
});
test('observers have no room mutation; mismatched or missing room authority disables seated leave', () => {
    const details = metadata();
    const observer = connectedDocument(proofDocument(), { ...details, client: { ...details.client, seat: null } });
    expect(observer.shell!.leaveActionId).toBeUndefined(); expect(observer.offer.actions.some(action => action.id === HOST_LEAVE_ACTION)).toBe(false);
    expect(observer.shell!.pages[0].actions.find(action => action.purpose === 'leave')!.intent).toEqual({ kind: 'request-effect', effect: 'leave-room' });
    for (const roomWindow of [null, { ...details.roomWindow, scope: { ...details.roomWindow.scope, actor_id: 'other' } }]) {
        const document = connectedDocument(proofDocument(), { ...details, roomWindow });
        expect(document.shell!.leaveActionId).toBeUndefined();
        expect(document.shell!.pages[0].actions.find(action => action.purpose === 'leave')!.enabled).toBe(false);
    }
});
test('disconnect shell contains public roster but no retained cards, information, scores or transport capability', () => {
    const details = metadata(), document = publicConnectedDocument({ ...details, client: { ...details.client, status: 'closed' } }, 2);
    expect(document.participant.role).toBe('observer'); expect(document.hand).toEqual([]); expect(document.opponents).toEqual([]); expect(document.collections).toEqual([]);
    expect(document.information).toBeUndefined(); expect(document.scoreboard).toBeUndefined(); expect(document.offer.actions).toEqual([]);
    expect(document.shell!.pages.find(page => page.id === 'people')!.people!.map(person => person.name)).toEqual(['재용', '보리']);
    expect(document.shell!.pages.find(page => page.id === 'rules')!.information).toEqual([]);
    expect(document.shell!.header.connection).toBe('closed');
    const session = createCardSession({ transport: () => {} }); session.receive(document, { connected: false }); expect(session.snapshot().connected).toBe(false); session.dispose();
});
test('game offers cannot claim the host leave namespace', () => {
    const source = proofDocument(), first = source.offer.actions[0];
    expect(() => connectedDocument({ ...source, offer: { ...source.offer, actions: [{ ...first, id: HOST_LEAVE_ACTION }] } }, metadata())).toThrow(/Reserved/);
});

function arrangingMetadata() {
    const details = metadata();
    details.client.room.in_hand = false;
    details.client.room.participant_ids = ['actor', 'bot-one', 'empty-two'];
    details.client.room.seats = [details.client.room.seats[0], { kind: 'bot', name: '보리', level: 'normal' }, { kind: 'empty' }];
    return { ...details, botLevels: [{ id: 'easy' as const, label: '쉬움' }, { id: 'normal' as const, label: '보통' }, { id: 'hard' as const, label: '어려움' }] };
}
test('room operations are exact canonical commands grouped by stable public subjects, not a flat page', async () => {
    const details = arrangingMetadata(), document = connectedDocument(proofDocument(), details);
    const shell = document.shell!, manage = shell.pages.find(page => page.id === 'manage')!;
    expect(manage.actions).toHaveLength(1);
    expect(shell.management!.find(group => group.subject.kind === 'seat' && group.subject.seat === 1)?.actions.some(action => action.label.includes('봇 빼기'))).toBe(true);
    expect(shell.seats![2]).toMatchObject({ kind: 'empty', actions: [{ intent: { kind: 'inspect-subject', subject: { kind: 'seat', seat: 2, participantId: 'empty-two' } } }] });
    expect(shell.pages.find(page => page.id === 'people')!.people![1].actions).toMatchObject([{ intent: { kind: 'inspect-subject', subject: { kind: 'seat', seat: 1, participantId: 'bot-one' } } }]);
    const operation = document.offer.actions.find(action => action.kind === 'command' && action.action.kind === 'room' && action.action.action.type === 'remove_bot')!;
    if (operation.kind !== 'command') throw new Error('command');
    expect(operation.action).toMatchObject({ kind: 'room', expected: details.roomWindow.scope });
    const send = vi.fn(), session = createCardSession({ transport: send }); session.receive(document);
    const canonical = session.snapshot().document!, exact = canonical.offer.actions.find(action => action.id === operation.id)!;
    if (exact.kind !== 'command') throw new Error('command');
    expect(session.admit(canonical.context, canonical.offer.id, exact.id, exact.action)).toBe(true);
    await Promise.resolve(); expect(send).toHaveBeenCalledTimes(1); session.dispose();
});
test('room operations require exact current room authority and retain their captured scope', () => {
    const details = arrangingMetadata();
    for (const scope of [null, { ...details.roomWindow.scope, seat: null }, { ...details.roomWindow.scope, room_id: 'elsewhere' }, { ...details.roomWindow.scope, actor_id: 'elsewhere' }, { ...details.roomWindow.scope, domain: 'game' as const }]) {
        const document = connectedDocument(proofDocument(), { ...details, roomWindow: scope ? { ...details.roomWindow, scope } : null });
        expect(document.shell!.management).toBeUndefined();
        expect(document.offer.actions.some(action => action.id.startsWith('room-operation:'))).toBe(false);
    }
    const document = connectedDocument(proofDocument(), details), operation = document.offer.actions.find(action => action.id.startsWith('room-operation:'))!;
    if (operation.kind !== 'command' || operation.action.kind !== 'room') throw new Error('room');
    details.roomWindow.scope.version++;
    expect(operation.action.expected.version).toBe(7);
    const send = vi.fn(() => true), transport = createCommandTransport({ room: details.roomCode, send, store: { read: () => [], write: () => {} } });
    transport.update({ connected: true, connection: 1, actor: 'actor', window: null, roomWindow: details.roomWindow });
    expect(transport.submitRoom('stale', operation.action.expected, operation.action.action)).toBe(false); expect(send).not.toHaveBeenCalled(); transport.dispose();
});
test('new room scope reopens a settled composite offer, unchanged scope does not', async () => {
    const details = arrangingMetadata(), session = createCardSession({ transport: () => {} });
    const first = connectedDocument(proofDocument(), details); session.receive(first);
    const operation = session.snapshot().document!.offer.actions.find(action => action.id.startsWith('room-operation:'))!;
    if (operation.kind !== 'command') throw new Error('command');
    expect(session.admit(first.context, first.offer.id, operation.id, operation.action)).toBe(true); await Promise.resolve();
    expect(session.resolve(session.snapshot().operations[0].id, 'accepted')).toBe(true);
    session.receive(connectedDocument(proofDocument(), details));
    expect(session.admit(first.context, first.offer.id, operation.id, operation.action)).toBe(false);
    details.roomWindow.scope.version++;
    const next = connectedDocument(proofDocument(), details); session.receive(next);
    const current = session.snapshot().document!.offer.actions.find(action => action.id === operation.id)!;
    if (current.kind !== 'command') throw new Error('command');
    expect(next.offer.id).not.toBe(first.offer.id);
    expect(session.admit(next.context, next.offer.id, current.id, current.action)).toBe(true); session.dispose();
});
test('replaced occupants cannot inherit a retained subject or operation identity', () => {
    const details = arrangingMetadata(), before = connectedDocument(proofDocument(), details);
    details.client.room.participant_ids![1] = 'replacement';
    const after = connectedDocument(proofDocument(), details);
    const previous = before.shell!.management!.find(group => group.subject.kind === 'seat' && group.subject.seat === 1)!;
    const current = after.shell!.management!.find(group => group.subject.kind === 'seat' && group.subject.seat === 1)!;
    expect(current.subject).not.toEqual(previous.subject);
    expect(current.actions.every(action => !previous.actions.some(old => old.id === action.id))).toBe(true);
});
test('observer participation commands use nullable-seat room authority and readable public shell has none', () => {
    const details = arrangingMetadata();
    const observer = { ...details, client: { ...details.client, seat: null, viewerId: 'watcher' }, roomWindow: { ...details.roomWindow, scope: { ...details.roomWindow.scope, actor_id: 'watcher', seat: null } } };
    const document = connectedDocument(proofDocument(), observer);
    expect(document.shell!.management!.some(group => group.subject.kind === 'person' && group.subject.participantId === 'watcher')).toBe(true);
    expect(document.offer.actions.some(action => action.kind === 'command' && action.action.kind === 'room' && action.action.action.type === 'request_seat')).toBe(true);
    expect(document.shell!.leaveActionId).toBeUndefined();
    const publicDocument = publicConnectedDocument(observer, 3);
    expect(publicDocument.offer.actions).toEqual([]); expect(publicDocument.shell!.management).toBeUndefined();
});
test('operation IDs cannot collide with adapter actions and standing is distinct from host exit', () => {
    const details = arrangingMetadata(), source = proofDocument(), document = connectedDocument(source, details);
    const stand = document.offer.actions.find(action => action.id !== HOST_LEAVE_ACTION && action.kind === 'command' && action.action.kind === 'room' && action.action.action.type === 'leave')!;
    expect(stand.id).toMatch(/^room-operation:/); expect(document.shell!.leaveActionId).toBe(HOST_LEAVE_ACTION);
    expect(() => connectedDocument({ ...source, offer: { ...source.offer, actions: [{ ...source.offer.actions[0], id: stand.id }] } }, details)).toThrow(/Reserved/);
    const readable = connectedDocument(source, { ...details, roomWindow: null });
    expect(readable.shell!.pages.find(page => page.id === 'people')!.people).toHaveLength(3);
    expect(readable.shell!.management).toBeUndefined(); expect(readable.shell!.seats).toBeUndefined();
});

test('inspector IDs follow exact public subjects across unrelated group insertion and removal', () => {
    const details = arrangingMetadata(), full = connectedDocument(proofDocument(), details);
    const operations = projectRoomOperations({ ...details.client, botLevels: details.botLevels });
    // Removing the room management group shifts every later group index.
    const reduced = withRoomOperations({ ...full.shell!, pages: full.shell!.pages.filter(page => page.id !== 'manage') }, details.client.room,
        operations.filter(operation => !operation.subjects.some(subject => subject.kind === 'room')));
    expect(full.shell!.management![0].subject.kind).toBe('room');
    expect(reduced.management![0].subject.kind).toBe('seat');
    const fullInspector = full.shell!.seats![1].actions[0];
    const reducedInspector = reduced.seats![1].actions[0];
    expect(fullInspector.id).toBe(reducedInspector.id);
    expect(fullInspector.id.length).toBeLessThanOrEqual(128);
    details.client.room.participant_ids![1] = 'new-occupant';
    const replacement = connectedDocument(proofDocument(), details);
    expect(replacement.shell!.seats![1].actions[0].id).not.toBe(fullInspector.id);
});

test('authenticated unnamed observers receive bounded named-join forms per eligible exact seat plus rename settings', () => {
    const details = arrangingMetadata(), observer = { ...details, nameMax: 24, client: { ...details.client, viewerId: 'unnamed-actor', viewerName: '', seat: null }, roomWindow: { ...details.roomWindow, scope: { ...details.roomWindow.scope, actor_id: 'unnamed-actor', seat: null } } };
    const document = connectedDocument(proofDocument(), observer);
    expect(document.forms).toHaveLength(3);
    expect(document.forms!.find(form => form.id === 'host:rename-name')!.fields[0].initial).toBe('');
    const join = document.forms!.find(form => form.id === 'host:join-name:1')!;
    expect(join.target).toMatchObject({ kind: 'command', template: { kind: 'room', expected: observer.roomWindow.scope, action: { type: 'join', seat: 1, name: '' } } });
    expect(document.offer.actions.some(action => action.id === (join.target?.kind === 'command' ? join.target.actionId : ''))).toBe(false);
    expect(document.shell!.management!.find(group => group.subject.kind === 'seat' && group.subject.seat === 1)!.actions).toContainEqual(expect.objectContaining({ intent: { kind: 'open-form', formId: join.id } }));
    expect(document.shell!.pages.find(page => page.id === 'settings')!.actions).toContainEqual(expect.objectContaining({ label: '이름 바꾸기' }));
});
test('named joins disappear for reserved, human, in-hand, owned-offline-seat or stale authority targets', () => {
    const details = arrangingMetadata();
    const observer = { ...details, nameMax: 24, client: { ...details.client, viewerId: 'watcher', viewerName: '보리', seat: null }, roomWindow: { ...details.roomWindow, scope: { ...details.roomWindow.scope, actor_id: 'watcher', seat: null } } };
    const joinIds = (document: ReturnType<typeof connectedDocument>) => document.forms?.filter(form => form.id.startsWith('host:join-name:')).map(form => form.id) ?? [];
    expect(joinIds(connectedDocument(proofDocument(), observer))).toEqual(['host:join-name:1', 'host:join-name:2']);
    details.client.room.in_hand = true; expect(joinIds(connectedDocument(proofDocument(), observer))).toEqual([]);
    details.client.room.in_hand = false;
    details.client.room.participation=[{id:'watcher',name:'보리',order:1,seat:1,target_id:'bot-one',offered_by:null}];
    expect(joinIds(connectedDocument(proofDocument(), observer))).toEqual(['host:join-name:2']);
    details.client.room.participation=[]; details.client.room.participant_ids![0] = 'watcher';
    details.client.room.seats[0] = {kind:'human',name:'보리',connected:false,away:false};
    expect(joinIds(connectedDocument(proofDocument(), observer))).toEqual([]);
    details.client.room.participant_ids![0] = 'actor';
    expect(joinIds(connectedDocument(proofDocument(), { ...observer, roomWindow: null }))).toEqual([]);
    const publicDocument = publicConnectedDocument(observer, 4); expect(publicDocument.forms).toBeUndefined();
});
test('name form instances change with exact target occupant while game offers stay intact', () => {
    const details = arrangingMetadata(), observer = { ...details, nameMax: 24, client: { ...details.client, viewerId: 'watcher', viewerName: '보리', seat: null }, roomWindow: { ...details.roomWindow, scope: { ...details.roomWindow.scope, actor_id: 'watcher', seat: null } } };
    const first = connectedDocument(proofDocument(), observer), form = first.forms!.find(form => form.id === 'host:join-name:1')!;
    details.client.room.participant_ids![1] = 'replacement';
    const next = connectedDocument(proofDocument(), observer).forms!.find(candidate => candidate.id === form.id)!;
    expect(next.instanceId).not.toBe(form.instanceId);
    const rename = first.forms!.find(form => form.id === 'host:rename-name')!;
    const {target:ignoredTarget,actions:ignoredActions,...hostOnlyForm}=rename;
    expect(() => connectedDocument({ ...proofDocument(), forms: [hostOnlyForm] }, observer)).toThrow(/Reserved connected form ID/);
});

test('named join uses canonical ordinary command admission and correlated operation evidence', async()=>{
    const details=arrangingMetadata(), observer={...details,nameMax:24,client:{...details.client,viewerId:'watcher',viewerName:'보리',seat:null},roomWindow:{...details.roomWindow,scope:{...details.roomWindow.scope,actor_id:'watcher',seat:null}}};
    const send=vi.fn(),session=createCardSession<import('./connectedDocument').HostCommand<import('./fixtures').ProofAction,unknown>>({transport:send,formPolicies:[NAME_POLICY]});
    session.receive(connectedDocument(proofDocument(),observer));
    const document=session.snapshot().document!,form=document.forms!.find(form=>form.id==='host:join-name:1')!;
    const draft={values:{[NAME_TEXT_FIELD]:'  새 이름  '},revision:1,compositionEpoch:0,composing:false};
    const port=session.bindForm(form.instanceId,()=>draft);
    expect(port.commit(document.context,form.id)).toBe(true); await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    const submission=send.mock.calls[0][0];
    expect(submission).toMatchObject({formInstanceId:expect.any(String),action:{kind:'room',action:{type:'join',seat:1,name:'새 이름'},expected:observer.roomWindow.scope}});
    expect(session.snapshot().operations).toHaveLength(1);
    expect(session.resolve(submission.id,'accepted')).toBe(true);session.dispose();
});

test('shared table forms publish through the settings page and use the ordinary exact command ledger',async()=>{
 const details=arrangingMetadata();details.client.room.table.turn_secs=40;const document=connectedDocument(proofDocument(),details);
 const form=document.forms!.find(form=>form.id==='room-table')!;expect(form).toBeDefined();
 expect(document.shell!.pages.find(page=>page.id==='settings')!.actions).toContainEqual(expect.objectContaining({label:'테이블 설정',intent:{kind:'open-form',formId:form.id}}));
 const send=vi.fn(),session=createCardSession<HostCommand<import('./fixtures').ProofAction,unknown>>({transport:send,formPolicies:[TABLE_FORM_POLICY]});session.receive(document);
 const draft={values:{'table:turn':'turn:60','table:shuffle':true},revision:1,compositionEpoch:0,composing:false};
 const port=session.bindForm(form.instanceId,()=>draft);expect(port.commit(document.context,form.id,'apply')).toBe(true);await Promise.resolve();
 expect(send.mock.calls[0][0]).toMatchObject({action:{kind:'room',expected:details.roomWindow.scope,action:{type:'set_table',turn_secs:60,shuffle:true,shuffle_next:null}}});session.dispose();
});
test('unsupported game editor adds a readable diagnostic without changing gameplay offers',()=>{
 const details=arrangingMetadata(),source=proofDocument();
 const document=connectedDocument(source,{...details,gameForms:{offers:[],settingsActions:[],diagnostics:[{id:'game-rule-editor',text:'기존 규칙을 안전하게 편집할 수 없어 편집기를 열지 않았어요.',tone:'danger'}]}});
 expect(document.offer.actions.slice(0,source.offer.actions.length).map(action=>action.id)).toEqual(source.offer.actions.map(action=>action.id));
 expect(document.shell!.notices).toContainEqual({id:'game-rule-editor',text:'기존 규칙을 안전하게 편집할 수 없어 편집기를 열지 않았어요.',tone:'danger'});
 expect(document.hand).toBe(source.hand);expect(document.context).toBe(source.context);
});

test('connected shell preserves the transport distinction between fresh pending work and recovery',async()=>{
    vi.useFakeTimers();
    const meta=metadata(),sent:unknown[]=[];
    const transport=createCommandTransport<unknown>({room:meta.roomCode,send:message=>{sent.push(message);return true;},store:{read:()=>[],write:()=>{}},nonce:()=>'recovery-test'});
    try {
        transport.update({connected:true,connection:1,actor:meta.client.viewerId,window:null,roomWindow:meta.roomWindow});
        expect(transport.submitRoom('local',meta.roomWindow.scope,{type:'ready',ready:true})).toBe(true);
        const shell=()=>connectedDocument(proofDocument(),{...meta,recovery:transport.snapshot()}).shell!;
        expect(transport.snapshot()).toMatchObject({ready:false,pending:1,recovering:0});
        expect(shell().notices).toEqual([]);
        await vi.advanceTimersByTimeAsync(1500);
        expect(shell().notices).toContainEqual({id:'pending',text:'이전 요청의 처리 결과를 확인하고 있어요.',tone:'plain'});
        expect(sent).toHaveLength(2);
    } finally {transport.dispose();vi.useRealTimers();}
});
