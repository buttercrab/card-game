import { expect, test, vi } from 'vitest';
import { CATALOG } from '../../catalog';
import type { GameTypes, RoomViewOf } from '../../room/types';
import type { InformationPanel, Scoreboard } from './contracts';
import { proofDocument } from './fixtures';
import { projectRoomShell, validateRoomShell } from './roomShell';

function room(): RoomViewOf<GameTypes> {
    return { id: 'shell', game: 'another-card-game', protocol: CATALOG.protocol, settings: {}, rules: {}, customized: false,
        seats: [{ kind: 'human', name: '재용', connected: true, away: false }, { kind: 'bot', name: '호두', level: 'normal' }, { kind: 'empty' }],
        participant_ids: ['local', 'bot', 'vacant'], ready: [true, true, false], in_hand: true, showing: true,
        table: { turn_secs: 30, shuffle: false, shuffle_next: false }, clock: null, watching: 4,
        observers: [{ id: 'watcher', name: '보리', requested: true }, { id: 'visitor', name: '단추', requested: false }],
        participation: [{ id: 'watcher', name: '보리', order: 2, seat: null, target_id: null, offered_by: null }],
        scores: [-100, 100, 0], hands_played: 1, history: [], hands: [] };
}
function client(r: RoomViewOf<GameTypes> | null = room()) { return { status: 'open' as const, room: r, seat: 0, viewerId: 'local' }; }
const rules: InformationPanel[] = [{ id: 'rules', title: '이 테이블의 규칙', fields: [{ id: 'cards', label: '패', value: { kind: 'number', value: 10 } }] }];
test('header and menu declare local navigation and explicit effects, never callbacks', () => {
    const shell = projectRoomShell({ roomCode: 'shell', client: client() });
    expect(shell.header).toMatchObject({ observerCount: 4, observerLabel: '관전자 4명', requestCount: 1, requestLabel: '참여 요청 1건', connectionLabel: '연결됨' });
    expect(shell.header.actions.map(item => item.intent)).toEqual([{ kind: 'request-effect', effect: 'share-room' }, { kind: 'open-page', page: 'people' }, { kind: 'open-page', page: 'menu' }]);
    expect(shell.effects).toEqual(['share-room', 'leave-room']);
    const inspect = (value: unknown) => {
        expect(typeof value).not.toBe('function');
        if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
            expect(['x', 'y', 'width', 'height', 'onclick', 'client', 'transport']).not.toContain(key); inspect(entry);
        }
    };
    inspect(shell); expect(JSON.parse(JSON.stringify(shell))).toEqual(shell);
});
test('people preserve only public identities/statuses and count unnamed observers', () => {
    const shell = projectRoomShell({ roomCode: 'shell', client: client() });
    const page = shell.pages.find(item => item.id === 'people')!;
    expect(page.anonymousObservers).toBe(2);
    expect(page.people).toEqual([
        { id: 'local', name: '재용', kind: 'human', mine: true, status: '플레이 중' },
        { id: 'bot', name: '호두', kind: 'bot', mine: false, status: '봇 · 보통' },
        { id: 'watcher', name: '보리', kind: 'observer', mine: false, status: '참여 대기 · 2번째' },
        { id: 'visitor', name: '단추', kind: 'observer', mine: false, status: '관전 중' },
    ]);
    expect(page.people!.some(person => person.id === 'vacant')).toBe(false);
});
test('observer reservation and human offline/ready states are projected without seat mutations', () => {
    const r = room(); r.in_hand = false; r.participation![0].seat = 1;
    const first = r.seats[0]; if (first.kind !== 'human') throw new Error('human'); first.connected = false;
    let shell = projectRoomShell({ roomCode: 'shell', client: { ...client(r), seat: null, viewerId: 'watcher' } });
    expect(shell.pages[1].people![0].status).toBe('연결 끊김');
    expect(shell.pages[1].people![2]).toMatchObject({ mine: true, status: '다음 판 참여 예약' });
    first.connected = true;
    shell = projectRoomShell({ roomCode: 'shell', client: client(r) });
    expect(shell.pages[1].people![0].status).toBe('준비');
});
test('observe-before-reclaim coalesces an offline human identity without losing its known observer count', () => {
    const r = room(); const occupant = r.seats[0]; if (occupant.kind !== 'human') throw new Error('human'); occupant.connected = false;
    r.observers = [{ id: 'local', name: '재용', requested: false }, { id: 'watcher', name: '보리', requested: true }];
    const shell = projectRoomShell({ roomCode: 'shell', client: { ...client(r), seat: null } });
    const people = shell.pages[1].people!;
    expect(people.filter(person => person.id === 'local')).toEqual([{ id: 'local', name: '재용', kind: 'human', mine: true, status: '연결 끊김 · 관전 중', observing: true }]);
    expect(people.filter(person => person.kind === 'observer')).toHaveLength(1);
    expect(shell.header.observerCount).toBe(4); expect(shell.pages[1].anonymousObservers).toBe(2);
    expect(() => validateRoomShell(shell)).not.toThrow();
    expect(r.seats[0]).toMatchObject({ kind: 'human', connected: false });
    expect(shell.pages[1].actions.map(action => action.purpose)).toEqual(['close']);
});
test('reclaim replaces the observing annotation without duplicating the canonical person', () => {
    const r = room(); const occupant = r.seats[0]; if (occupant.kind !== 'human') throw new Error('human'); occupant.connected = false;
    r.observers = [{ id: 'local', name: '재용', requested: false }]; r.watching = 1;
    const observing = projectRoomShell({ roomCode: 'shell', client: { ...client(r), seat: null } });
    expect(observing.pages[1].people![0].observing).toBe(true);
    occupant.connected = true; r.observers = []; r.watching = 0;
    const reclaimed = projectRoomShell({ roomCode: 'shell', client: client(r) });
    expect(reclaimed.pages[1].people!.filter(person => person.id === 'local')).toHaveLength(1);
    expect(reclaimed.pages[1].people![0]).toMatchObject({ kind: 'human', mine: true, status: '플레이 중' });
    expect(reclaimed.pages[1].people![0].observing).toBeUndefined();
});
test('duplicate seat/observer identities and bot collisions remain invalid instead of being deduplicated', () => {
    const r = room(); const occupant = r.seats[0]; if (occupant.kind !== 'human') throw new Error('human'); occupant.connected = false;
    r.observers = [{ id: 'local', name: '재용', requested: false }, { id: 'local', name: '재용', requested: false }];
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(r) })).toThrow(/Duplicate room shell observer/);
    r.observers = [{ id: 'bot', name: '호두', requested: false }];
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(r) })).toThrow(/Duplicate room shell identity/);
    r.observers = []; r.participant_ids![1] = 'local';
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(r) })).toThrow(/Duplicate room shell identity/);
});
test('mid-hand player leave declares confirmation; watchers and between-hand players leave directly', () => {
    const r = room();
    const player = projectRoomShell({ roomCode: 'shell', client: client(r) });
    expect(player.pages[0].actions.find(item => item.purpose === 'leave')!.intent).toEqual({ kind: 'confirm-leave' });
    expect(player.leaveConfirmation!.actions.map(item => item.intent)).toEqual([{ kind: 'cancel-confirmation' }, { kind: 'request-effect', effect: 'leave-room' }]);
    for (const c of [{ ...client(r), seat: null }, client({ ...r, in_hand: false })]) {
        const shell = projectRoomShell({ roomCode: 'shell', client: c });
        expect(shell.leaveConfirmation).toBeUndefined();
        expect(shell.pages[0].actions.find(item => item.purpose === 'leave')!.intent).toEqual({ kind: 'request-effect', effect: 'leave-room' });
    }
});
test('rules and cumulative scores reuse canonical information and detach input mutation', () => {
    const document = proofDocument();
    const scoreboard: Scoreboard = { id: 'scores', title: '누적 점수', columns: [{ id: 'total', label: '누적' }], rows: [{ participantId: 'local', values: [-100] }] };
    const shell = projectRoomShell({ roomCode: 'shell', client: client(), document: { ...document, scoreboard }, ruleInformation: rules });
    expect(shell.pages[2].information).toEqual(rules); expect(shell.pages[3].scoreboard).toEqual(scoreboard);
    expect(shell.pages[0].actions.filter(item => item.purpose === 'rules' || item.purpose === 'scores').every(item => item.enabled)).toBe(true);
    expect(shell.pages[3].scoreboard).not.toBe(scoreboard); expect(Object.isFrozen(shell.pages[3].scoreboard!.rows[0].values)).toBe(true);
    expect(Object.isFrozen(shell.header.actions)).toBe(true);
});
test('missing room cannot reuse retained private/game facts and keeps exit reachable', () => {
    const document = proofDocument();
    const shell = projectRoomShell({ roomCode: 'shell', client: { ...client(null), status: 'missing' }, document, ruleInformation: rules });
    expect(shell.notices).toContainEqual({ id: 'missing', text: 'shell 테이블이 없어요', tone: 'plain' });
    expect(shell.pages[2].information).toEqual([]); expect(shell.pages[3].scoreboard).toBeUndefined();
    expect(shell.pages[0].actions.find(item => item.purpose === 'leave')!.enabled).toBe(true);
    expect(shell.header.actions.find(item => item.purpose === 'share')!.enabled).toBe(false);
});
test('fresh local pending work has no recovery banner, but genuine uncertainty and transport errors remain visible', () => {
    const fresh = { pending: 1, recovering: 0, storageError: false, capacity: false };
    const notices = (recovery: typeof fresh) => projectRoomShell({ roomCode: 'shell', client: client(), recovery }).notices.map(item => item.id);
    expect(notices(fresh)).toEqual([]);
    expect(notices({ ...fresh, recovering: 1 })).toEqual(['pending']);
    expect(notices({ ...fresh, storageError: true })).toEqual(['storage']);
    expect(notices({ ...fresh, capacity: true })).toEqual(['capacity']);
    expect(notices({ ...fresh, recovering: 1, storageError: true, capacity: true })).toEqual(['storage']);
    for (const recovering of [-1, 2, 0.5, NaN]) {
        expect(() => notices({ ...fresh, recovering })).toThrow(/recovery count/);
    }
});
test('recovering and error notices remain data with bounded public text', () => {
    const shell = projectRoomShell({ roomCode: 'shell', client: { ...client(), status: 'closed' }, recovery: { pending: 1, storageError: false, capacity: false }, notice: { id: 'toast', text: '안내', tone: 'plain' } });
    expect(shell.notices.map(item => item.id)).toEqual(['reconnecting', 'pending', 'host:toast']);
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(), notice: { id: 'toast', text: 'x'.repeat(501), tone: 'plain' } })).toThrow(/notice/);
});
test('unknown participant references, duplicate identities and inconsistent counts fail explicitly', () => {
    const document = proofDocument();
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(), document, ruleInformation: [{ ...rules[0], fields: [{ id: 'who', label: '사람', value: { kind: 'participant', participantId: 'foreign' } }] }] })).toThrow(/information/);
    const r = room(); r.observers![0].id = 'local';
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(r) })).toThrow(/Duplicate/);
    r.observers![0].id = 'watcher'; r.watching = 0;
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(r) })).toThrow(/roster/);
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(), ruleInformation: rules })).toThrow(/authorized participant context/);
});
test('rule descriptors cannot carry capabilities or accessors into the engine', () => {
    const document = proofDocument();
    const bad = { ...rules[0], execute: () => {} };
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(), document, ruleInformation: [bad] })).toThrow(/plain inert/);
    const getter = vi.fn(() => 'title'), accessor = { ...rules[0] };
    Object.defineProperty(accessor, 'title', { get: getter, enumerable: true });
    expect(() => projectRoomShell({ roomCode: 'shell', client: client(), document, ruleInformation: [accessor] })).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
});
test('session boundary validates page and effect links independently of the projector', () => {
    const shell = projectRoomShell({ roomCode: 'shell', client: client() });
    expect(() => validateRoomShell(shell)).not.toThrow();
    expect(() => validateRoomShell({ ...shell, pages: shell.pages.filter(page => page.id !== 'people') })).toThrow(/Invalid room shell/);
    expect(() => validateRoomShell({ ...shell, effects: ['share-room'] })).toThrow(/Invalid room shell/);
    expect(() => validateRoomShell({ ...shell, leaveConfirmation: undefined })).toThrow(/Invalid room shell/);
    expect(() => validateRoomShell({ ...shell, pages: [...shell.pages, shell.pages[0]] })).toThrow(/Invalid room shell/);
    expect(() => validateRoomShell({ ...shell, header: { ...shell.header, actions: [shell.header.actions[0], shell.header.actions[0]] } })).toThrow(/Invalid room shell/);
});
test('session boundary rejects hidden capabilities, geometry, count drift and excessive content', () => {
    const shell = projectRoomShell({ roomCode: 'shell', client: client() });
    expect(() => validateRoomShell({ ...shell, execute: () => {} } as typeof shell)).toThrow(/plain inert/);
    expect(() => validateRoomShell({ ...shell, width: 320 } as typeof shell)).toThrow(/Invalid room shell/);
    expect(() => validateRoomShell({ ...shell, header: { ...shell.header, observerCount: 3 } })).toThrow(/Invalid room shell/);
    expect(() => validateRoomShell({ ...shell, notices: [{ id: 'large', text: 'x'.repeat(2049), tone: 'plain' }] })).toThrow(/text budget/);
});
test('session boundary requires canonical context for rules/scores and rejects foreign references', () => {
    const document = proofDocument();
    const shell = projectRoomShell({ roomCode: 'shell', client: client(), document, ruleInformation: rules });
    expect(() => validateRoomShell(shell)).toThrow(/authorized participant context/);
    expect(() => validateRoomShell(shell, document)).not.toThrow();
    const pages = shell.pages.map(page => page.id !== 'rules' ? page : { ...page, information: [{ ...rules[0], fields: [{ id: 'foreign', label: '사람', value: { kind: 'participant' as const, participantId: 'unknown' } }] }] });
    expect(() => validateRoomShell({ ...shell, pages }, document)).toThrow(/information/);
});
test('the global action budget includes leave confirmation actions after every other action source', () => {
    const base = projectRoomShell({ roomCode: 'shell', client: client() });
    const close = (id: string) => ({ id, purpose: 'close' as const, label: '닫기', enabled: true, intent: { kind: 'close' as const } });
    const shell = { ...base,
        header: { ...base.header, actions: Array.from({ length: 8 }, (_, index) => close(`header-${index}`)) },
        pages: base.pages.map(page => ({ ...page, actions: Array.from({ length: 16 }, (_, index) => close(`${page.id}-${index}`)) })),
        seats: Array.from({ length: 30 }, (_, seat) => ({ seat, name: `${seat}번 자리`, kind: 'empty' as const, actions: Array.from({ length: 4 }, (_, index) => close(`seat-${seat}-${index}`)) })),
        management: [{ subject: { kind: 'room' as const, roomId: 'shell' }, title: '테이블', actions: Array.from({ length: 64 }, (_, index) => close(`manage-${index}`)) }],
    };
    shell.pages.push({ id: 'manage', title: '관리', actions: [] });
    // 8 header + 64 page +120 seat +64 management =256, before two leave actions.
    expect(() => validateRoomShell(shell)).toThrow(/Invalid room shell/);
    const { leaveConfirmation: _, ...withoutConfirmation } = shell;
    expect(() => validateRoomShell(withoutConfirmation)).not.toThrow();
});

test('disclosure navigation names one offered read catalog and carries no command payload',()=>{
 const base=projectRoomShell({roomCode:'shell',client:client()}),catalog={id:'public-history',policyId:'history:v1',revision:'1',title:'지난 판',total:0,pageSize:12 as const,scope:{roomId:'shell',roomEpoch:'epoch',actorId:'local',connectionEpoch:'connection',visibility:'public' as const}},document={...proofDocument(),disclosures:[catalog]};
 const item={id:'room-shell:history',purpose:'scores' as const,label:'지난 판',enabled:true,intent:{kind:'open-disclosure' as const,catalogId:catalog.id}};
 const shell={...base,pages:base.pages.map(page=>page.id==='menu'?{...page,actions:[...page.actions,item]}:page)};
 expect(()=>validateRoomShell(shell,document)).not.toThrow();
 for(const intent of [{kind:'open-disclosure',catalogId:'unknown'},{...item.intent,actionId:'hidden-command'},{...item.intent,payload:{}}]){
  const invalid={...shell,pages:shell.pages.map(page=>page.id==='menu'?{...page,actions:page.actions.map(action=>action.id===item.id?{...item,intent}:action)}:page)};
  expect(()=>validateRoomShell(invalid as typeof shell,document)).toThrow(/Invalid room shell/);
 }
});
