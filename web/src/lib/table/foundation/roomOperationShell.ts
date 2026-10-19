import type {CurrentRoomViewOf as RoomViewOf} from '../../room/currentRoom';
import type { GameTypes } from '../../room/types';
import type { RoomOperation, RoomOperationSubject } from './roomOperations';
import type { RoomShell, RoomShellAction, RoomShellSubjectGroup } from './roomShell';

/** Public identity key only; it never determines command authority. */
const subjectKey = (subject: RoomOperationSubject) => JSON.stringify(subject);
function inspectorId(subject: RoomOperationSubject): string {
    const value = subjectKey(subject);
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < value.length; index++)
        hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 0x100000001b3n);
    return `room-shell:inspect:${hash.toString(16).padStart(16, '0')}`;
}
const sameSubject = (a: RoomOperationSubject, b: RoomOperationSubject) => subjectKey(a) === subjectKey(b);

/** Organize exact commands by public targets; runtime owns the selected target. */
export function withRoomOperations<G extends GameTypes>(shell: RoomShell, room: RoomViewOf<G>, operations: readonly RoomOperation<G['settings']>[], additional: readonly { readonly subject: RoomOperationSubject; readonly actions: readonly RoomShellAction[] }[] = []): RoomShell {
    if (!operations.length && !additional.length) return shell;
    const groups: RoomShellSubjectGroup[] = [];
    const subjects: RoomOperationSubject[] = [{ kind: 'room', roomId: room.id },
        ...room.seats.map((_, seat): RoomOperationSubject => ({ kind: 'seat', seat,
            ...(room.participant_ids?.[seat] ? { participantId: room.participant_ids[seat] } : {}) }))];
    // Observers may simultaneously own an offline seat; both target descriptions
    // remain explicit and the people row selects the seat identity in that case.
    subjects.splice(1 + room.seats.length, 0, ...(room.observers ?? []).map(observer => ({ kind: 'person' as const, participantId: observer.id })));
    if(additional.some(group=>!subjects.some(subject=>sameSubject(subject,group.subject))))throw new Error('Unknown room management subject');
    const command = (operation: RoomOperation<G['settings']>): RoomShellAction => ({
        id: operation.id, purpose: 'operation', label: operation.label, enabled: true,
        intent: { kind: 'command', actionId: operation.id }, subjects: operation.subjects,
        ...(operation.confirmation ? { confirmation: operation.confirmation } : {}),
    });
    for (const subject of subjects) {
        const available = operations.filter(operation => operation.subjects.some(candidate => sameSubject(candidate, subject)));
        const extra=additional.filter(group=>sameSubject(group.subject,subject)).flatMap(group=>group.actions);
        if (!available.length && !extra.length || groups.some(group => sameSubject(group.subject, subject))) continue;
        const occupant = subject.kind === 'seat' ? room.seats[subject.seat] : undefined;
        const title = subject.kind === 'room' ? '테이블 관리' : subject.kind === 'seat'
            ? `${subject.seat + 1}번 자리 · ${occupant && occupant.kind !== 'empty' ? occupant.name : '빈자리'}`
            : room.observers?.find(person => person.id === subject.participantId)?.name ?? '관전자';
        groups.push({ subject, title, actions: [...available.map(command),...extra] });
    }
    const inspectorSubjects = new Map<string, string>();
    for (const group of groups) {
        const id = inspectorId(group.subject), identity = subjectKey(group.subject);
        if (inspectorSubjects.has(id) && inspectorSubjects.get(id) !== identity) throw new Error('Room inspector ID collision');
        inspectorSubjects.set(id, identity);
    }
    const inspect = (subject: RoomOperationSubject): readonly RoomShellAction[] => groups.some(group => sameSubject(group.subject, subject))
        ? [{ id: inspectorId(subject), purpose: 'manage', label: '관리', enabled: true, intent: { kind: 'inspect-subject', subject } }] : [];
    const seats = room.seats.map((occupant, seat) => {
        const subject = subjects[seat + 1] as Extract<RoomOperationSubject, { kind: 'seat' }>;
        const actions=inspect(subject),group=groups.find(group=>sameSubject(group.subject,subject));
        const bot=occupant.kind==='empty'?operations.find(operation=>operation.purpose==='add-bot'&&operation.subjects.some(candidate=>sameSubject(candidate,subject))):undefined;
        const join=occupant.kind==='empty'?additional.filter(group=>sameSubject(group.subject,subject)).flatMap(group=>group.actions).find(action=>action.intent.kind==='open-form'):undefined;
        const preferred=bot?group?.actions.find(action=>action.id===bot.id):join??actions[0];
        return { seat, ...(subject.participantId ? { participantId: subject.participantId } : {}),
            name: occupant.kind === 'empty' ? `${seat + 1}번 빈자리` : occupant.name, kind: occupant.kind, actions,...(preferred?{setupActionId:preferred.id,setupLabel:bot?'봇 추가':preferred.label}:{}) };
    });
    const roomActions = inspect(subjects[0]);
    return { ...shell, seats, management: groups, pages: [...shell.pages.map(page => page.id === 'people' ? {
        ...page, actions: [...roomActions, ...page.actions], people: page.people?.map(person => {
            const seat = seats.find(candidate => candidate.participantId === person.id || candidate.participantId === undefined && person.id === `seat-${candidate.seat}`);
            const subject: RoomOperationSubject = seat ? { kind: 'seat', seat: seat.seat, ...(seat.participantId ? { participantId: seat.participantId } : {}) }
                : { kind: 'person', participantId: person.id };
            return { ...person, actions: inspect(subject) };
        }),
    } : page), { id: 'manage', title: '자리와 참여 관리', actions: [{ id: 'room-shell:manage-close', purpose: 'close', label: '닫기', enabled: true, intent: { kind: 'close' } }] }] };
}
