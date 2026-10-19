import { expect, test } from 'vitest';
import {createCardTable} from '../../table/foundation/runtime';
import {typography,validateLayout} from '../../table/foundation/planner';
import type {Environment,SurfaceCallbacks,SurfacePort} from '../../table/foundation/contracts';
import { createMightyInformation } from './information';
import {createCardSession} from '../../table/foundation/session';
import { mightyDocument } from './foundation';
import { presetRules } from './catalog';
import { CATALOG } from '../../catalog';
import type { Card, RoomView, StateMsg } from './types';
const rules = presetRules('default');
const ids = ['p0', 'p1', 'p2', 'p3', 'p4'];
function room(): RoomView {
    return { id: 'information', game: 'mighty', protocol: CATALOG.protocol, settings: { preset: 'default' }, rules, customized: false,
        seats: ids.map((_, index) => ({ kind: 'human', name: `P${index}`, connected: true, away: false })), in_hand: true, showing: true,
        table: { turn_secs: 30, shuffle: false, shuffle_next: false }, clock: null, watching: 0, observers: [], ready: ids.map(() => true),
        participant_ids: [...ids], participation: [], scores: [-100, 2, 3, 4, 5], hands_played: 0, history: [], hands: [] };
}
function game(): StateMsg {
    return { version: 1, grace_ms: 0, turn: { Seat: 0 }, legal: [], out_of_turn: [], notes: { unplayable: [], contracts: [] }, view: {
        viewer: { Seat: 0 }, rules, first_bidder: 0, hand: [], hand_sizes: [10, 10, 10, 10, 10], points_taken: [[], [], [], [], []], bids: [], redealt: null,
        phase: { Play: { declarer: 1, contract: { trump: 'Heart', count: 17 }, call: { Card: { Normal: ['Spade', 14] } }, friend: null, no_friend: false, trick_no: 2,
            leader: 1, lead: null, plays: [], leading: null, called_joker: null, tricks: [], discards: null } },
    } };
}
function project(r = room(), g: StateMsg | null = game(), seat: number | null = 0, graceReady = true) {
    return createMightyInformation({ room: r, game: g, seat, participantIds: ids }, graceReady);
}
test('public contract, trump, round, called card and exact score columns are structured', () => {
    const g = game(); g.view.points_taken[1] = [{ Normal: ['Heart', 10] }];
    const result = project(room(), g), panel = result.information[0];
    expect(panel.primary).toMatchObject({ label: '공약', value: { kind: 'inline', values: [{ kind: 'suit', suit: 'Heart', label: '하트' }, { kind: 'number', value: 17 }] } });
    expect(panel.fields.find(field => field.id === 'declarer')!.value).toEqual({ kind: 'participant', participantId: 'p1' });
    expect(panel.fields.find(field => field.id === 'round')!.value).toEqual({ kind: 'text', text: '3/10' });
    expect(panel.fields.find(field => field.id === 'friend')!.value).toMatchObject({ kind: 'card', label: '마이티', visual: { kind: 'standard', suit: 'Spade', rank: 14 }, emphasis: 'special' });
    expect(panel.progress).toMatchObject({ total: 20, target: 17, series: [{ id: 'declarer', value: 1, from: 'start' }, { id: 'defense', value: 0, from: 'end' }] });
    expect(result.scoreboard.columns.map(column => column.label)).toEqual(['점수', '누적']);
    expect(result.scoreboard.rows[0].values).toEqual([0, -100]);
});
test('unknown friend never becomes a role through private held-card inference', () => {
    const g = game(), before = project(room(), g);
    g.view.hand = [{ Normal: ['Spade', 14] }];
    expect(project(room(), g)).toEqual(before);
    g.view.viewer = 'Spectator'; g.view.hand = [];
    const observer = project(room(), g, null);
    expect(observer.information[0].fields).toEqual(before.information[0].fields);
    expect(observer.teams).toEqual([null, 'declarer', null, null, null]);
    expect(observer.scoreboard.rows.flatMap(row => row.badges ?? []).map(badge => badge.text)).toEqual(['주공']);
});
test('public friend reveal and alone state produce only publicly known roles', () => {
    const g = game(); if (typeof g.view.phase !== 'object' || !('Play' in g.view.phase)) throw new Error('play');
    g.view.phase.Play.friend = 2;
    let result = project(room(), g);
    expect(result.teams).toEqual(['defense', 'declarer', 'friend', 'defense', 'defense']);
    expect(result.information[0].fields.find(field => field.id === 'friend')!.value).toEqual({ kind: 'participant', participantId: 'p2' });
    g.view.phase.Play.friend = null; g.view.phase.Play.call = 'Alone'; g.view.phase.Play.no_friend = true;
    result = project(room(), g);
    expect(result.information[0].fields.find(field => field.id === 'friend')!.value).toEqual({ kind: 'text', text: '노프렌드' });
});
test('bidding preserves best bidder/no trump, minimum, and null per-hand scores', () => {
    const g = game(); g.view.phase = { Bidding: { to_act: 0, best: null, passed: ids.map(() => false), has_bid: ids.map(() => false) } };
    let result = project(room(), g);
    expect(result.information[0].primary!.value).toEqual({ kind: 'text', text: '공약 없음' });
    expect(result.information[0].fields[0]).toEqual({ id: 'minimum', label: '최소', value: { kind: 'number', value: rules.bidding.min } });
    expect(result.scoreboard.rows.every(row => row.values[0] === null)).toBe(true);
    g.view.phase.Bidding.best = [3, { trump: null, count: 18 }];
    result = project(room(), g);
    expect(result.information[0].primary!.value).toEqual({ kind: 'inline', values: [{ kind: 'token', token: '노', label: '노기루다' }, { kind: 'number', value: 18 }] });
    expect(result.information[0].fields[0].value).toEqual({ kind: 'participant', participantId: 'p3' });
});
test('exchange retains public trump and declarer while per-hand points remain unavailable', () => {
    const g = game(); g.view.phase = { Exchange: { declarer: 2, contract: { trump: 'Club', count: 16 }, trump_changed: false, discards: [] } };
    const result = project(room(), g);
    expect(result.information[0].primary!.value).toMatchObject({ values: [{ suit: 'Club' }, { value: 16 }] });
    expect(result.information[0].progress).toBeUndefined();
    expect(result.scoreboard.rows[2]).toMatchObject({ participantId: 'p2', values: [null, 3], badges: [{ text: '주공' }] });
});
test('vacant totals/points are unavailable and rows retain local-seat order', () => {
    const r = room(); r.seats[3] = { kind: 'empty' };
    const result = project(r, game(), 2);
    expect(result.scoreboard.rows.map(row => row.participantId)).toEqual(['p2', 'p3', 'p4', 'p0', 'p1']);
    expect(result.scoreboard.rows[1]).toMatchObject({ participantId: 'p3', values: [null, null] });
    const doc = mightyDocument({ room: r, game: game(), seat: 0, viewerId: 'p0', viewerName: 'P0' }, 1)!;
    expect(doc.opponents!.find(person => person.id === 'p3')!.appearance!.vacant).toBe(true);
    expect(doc.facts.some(fact => fact.id.startsWith('score:') || fact.id === 'contract')).toBe(false);
});
test('done membership mismatch cannot attach old points, teams or role references to a new participant', () => {
    const r = room(), g = game(); const phase = g.view.phase; if (typeof phase !== 'object' || !('Play' in phase)) throw new Error('play');
    g.view.phase = { Done: { ...phase.Play, team_points: 1, payoffs: [0, 0, 0, 0, 0], value: {} as never, discards: [] } };
    g.view.points_taken[1] = [{ Normal: ['Heart', 10] }];
    r.current_hand = { number: 1, names: ['P0', 'Old declarer', 'P2', 'P3', 'P4'], participant_ids: ['p0', 'old-p1', 'p2', 'p3', 'p4'], payoffs: [0, 0, 0, 0, 0], rules: {}, view: {} };
    const result = project(r, g);
    expect(result.scoreboard.rows[1]).toEqual({ participantId: 'p1', values: [null, 2] });
    expect(result.teams[1]).toBeNull();
    expect(result.information[0].fields.find(field => field.id === 'declarer')!.value).toEqual({ kind: 'text', text: 'Old declarer' });
    const doc = mightyDocument({ room: r, game: g, seat: 0, viewerId: 'p0', viewerName: 'P0' }, 1)!;
    expect(doc.opponents![0].appearance!.team).toBeNull();
    expect(doc.facts.find(fact => fact.id === 'result')).toMatchObject({ label: '이번 판', value: 'P0 +0 · Old declarer +0 · P2 +0 · P3 +0 · P4 +0' });
    expect(result.information[0].summary).toEqual({ text: '판 종료', tone: 'muted' });
    // Even a retained turn packet cannot make the replacement's name the actor.
    g.turn = { Seat: 1 };
    expect(project(r, g).information[0].summary).toEqual({ text: '판 종료', tone: 'muted' });
    // Missing historical labels get a neutral label, never the new occupant.
    r.current_hand.names[1] = '';
    const missingName = mightyDocument({ room: r, game: g, seat: 0, viewerId: 'p0', viewerName: 'P0' }, 2)!;
    expect(missingName.facts.find(fact => fact.id === 'result')!.value).toContain('이전 참가자 +0');
    expect(missingName.facts.find(fact => fact.id === 'result')!.value).not.toContain('P1 +0');
});
test('waiting, dealing and grace status remain explicit without manufacturing scores', () => {
    const r = room(); r.showing = false; r.in_hand = false;
    const waiting = project(r, null).information[0];
    expect(waiting.summary!.text).toBe('첫 판을 기다려요');
    expect(waiting.fields).toContainEqual({ id: 'turn-limit', label: '턴', value: { kind: 'text', text: '30초' } });
    const g = game(); g.view.phase = 'Dealing'; g.turn = 'Chance';
    expect(project(room(), g).information[0].summary!.text).toBe('패를 나누는 중');
    g.turn = { Seat: 0 };
    expect(project(room(), g, 0, false).information[0].summary!.text).toBe('딜미스 확인 대기');
});
test('progress tags use the shared public hand derivation', () => {
    const g = game(); if (typeof g.view.phase !== 'object' || !('Play' in g.view.phase)) throw new Error('play');
    g.view.phase.Play.call = 'Alone'; g.view.phase.Play.no_friend = true;
    g.view.points_taken[1] = Array.from({ length: 17 }, (): Card => ({ Normal: ['Heart', 10] }));
    expect(project(room(), g).information[0].badges).toContainEqual({ text: '공약 확정', tone: 'accent' });
});

test('every phase projection passes the canonical session wire boundary for players and observers',()=>{
 const r=room(),g=game(),play=g.view.phase;
 if(typeof play!=='object'||!('Play' in play))throw new Error('play');
 const phases:StateMsg['view']['phase'][]=['Dealing',{Bidding:{to_act:0,best:null,passed:ids.map(()=>false),has_bid:ids.map(()=>false)}},{Exchange:{declarer:2,contract:{trump:'Club',count:16},trump_changed:false,discards:[]}},play,{Done:{...play.Play,team_points:1,payoffs:[0,0,0,0,0],value:{} as never,discards:[]}}];
 for(const seat of [0,null])for(const phase of [null,...phases]){
  const session=createCardSession({transport:()=>{}}),state=phase?{...g,view:{...g.view,phase,viewer:seat===null?'Spectator' as const:{Seat:seat}}}:null;
  const doc=mightyDocument({room:{...r,showing:phase!==null},game:state,seat,viewerId:'p0',viewerName:'P0'},1)!;
  expect(()=>session.receive(doc)).not.toThrow();expect(session.snapshot().document?.information?.[0].title).toBe('상황판');session.dispose();
 }
});

test('real projected public friend-card status preserves the existing information opener and full facts',()=>{
 const r=room(),g=game();g.view.hand=[{Normal:['Spade',2]}];g.view.hand_sizes=ids.map(()=>1);
 const doc=mightyDocument({room:r,game:g,seat:0,viewerId:'p0',viewerName:'P0'},1)!;
 const friend=doc.information!.find(panel=>panel.id==='mighty-status')!.fields.find(field=>field.id==='friend')!;
 expect(friend.value).toMatchObject({kind:'card',visual:{kind:'standard',suit:'Spade',rank:14}});
 expect(doc.presentation?.decision).toBeUndefined();
 const environment:Environment={width:390,height:844,textScale:1,revision:'friend',fontRevision:'friend',fontFamily:'sans',scrollbarWidth:15,scrollbarHeight:15,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:44,pulse:1.08}}};
 const session=createCardSession({transport:()=>{}});session.receive(doc);const table=createCardTable({session});let callbacks!:SurfaceCallbacks;const failures:string[]=[];
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(value){callbacks=value;return()=>{};},measure(requests,reply){reply(requests.map(request=>{const natural=[...request.text].length*8,width=request.width??natural;return {key:request.key,size:{width:Math.min(width,natural),height:typography(request.role,environment).lineHeight*Math.max(1,Math.ceil(natural/Math.max(1,width)))}};}));return()=>{};},publish:()=>{},disarm:()=>{},invalidate:()=>{},clear:()=>{},fallback:value=>{failures.push(value);}};
 try{table.attach(surface);expect(table.inspect().status,JSON.stringify(failures)).toBe('ready');const frame=table.inspect().frame!;expect(validateLayout(frame)).toEqual([]);const opener=frame.nodes.find(node=>node.kind==='command'&&node.localIntent==='toggle-information'&&node.enabled)!;expect(opener).toBeDefined();expect(frame.nodes.some(node=>node.kind==='card'&&!node.entityId&&node.visual?.kind==='standard'&&node.visual.rank===14)).toBe(true);callbacks.intent({kind:'activate',frameId:frame.id,nodeId:opener.id});expect(table.inspect().status,JSON.stringify(failures)).toBe('ready');const dialog=table.inspect().frame!;expect(dialog.modalId).toBe('table-information-dialog');expect(validateLayout(dialog)).toEqual([]);expect(dialog.nodes.some(node=>node.id==='table-information-close'&&node.localIntent==='toggle-information')).toBe(true);expect(dialog.nodes.filter(node=>node.parent==='table-information-close').map(node=>[node.id,node.kind,node.shellIcon])).toEqual([[JSON.stringify(['table-information-close','icon']),'icon','close']]);expect(dialog.nodes.some(node=>node.kind==='card'&&!node.entityId&&node.visual?.kind==='standard'&&node.visual.rank===14)).toBe(true);
 }finally{table.dispose();session.dispose();}
});
