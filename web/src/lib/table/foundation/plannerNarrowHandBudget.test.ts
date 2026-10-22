import {expect, test, vi} from 'vitest';
import type {CandidateLayout, ChoiceView, Environment, MeasureRequest, Size, TableDocument} from './contracts';
import {createCardTable} from './runtime';
import {createCardSession} from './session';
import {persistentCaptionDocument} from './shellFixture';
import {planTable, typography, validateLayout} from './planner';

const controls = {
    command: {fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 16, paddingY: 10, minHeight: 44, pulse: 1},
    choice: {fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 14, paddingY: 8, minHeight: 40, pulse: 1.08},
};
function measured(request:MeasureRequest,environment:Environment,koreanMetrics:boolean):Size {
    // Wider CJK metadata catches wrapping hidden by the simple 9px
    // fixture measurer, including the observed 135–144px caption-wrap
    // boundary. These are synthetic glyph estimates, not browser font proof.
    const fontSize=typography(request.role,environment).fontSize;
    const natural = koreanMetrics ? Math.round([...request.text].reduce((sum,char)=>sum+(/[가-힣]/.test(char)?fontSize*.86:/[0-9]/.test(char)?fontSize*.55:/[♠♣♦♥]/.test(char)?fontSize*.45:char===' '?fontSize*.25:fontSize*.6),0)*64)/64 : [...request.text].length * 9 * environment.textScale;
    const allocation = request.width ?? natural;
    return {width: Math.min(natural, allocation),
        height: Math.max(1, Math.ceil(natural / Math.max(1, allocation))) * typography(request.role, environment).lineHeight};
}
function harness<A>(source: TableDocument<A>, width = 461, height = 677, gutter = 15, koreanMetrics = false, textScale = 1) {
    const environment: Environment = {width, height, textScale, scrollbarWidth: gutter, scrollbarHeight: gutter,
        revision: 'narrow-hand-budget', fontRevision: 'narrow-hand-budget', fontFamily: 'sans-serif', controls};
    const session = createCardSession<A>({transport: () => {}}), fallback = vi.fn();
    session.receive(source);
    const table = createCardTable({session});
    table.attach({identity: {}, environment: () => environment, listen: () => () => {},
        measure(batch, reply) {
            reply(batch.map(request => {
                return {key:request.key,size:measured(request, environment, koreanMetrics)};
            }));
            return () => {};
        }, publish() {}, disarm() {}, invalidate() {}, clear() {}, fallback});
    return {session, environment,
        frame() {expect(table.inspect().status, JSON.stringify(fallback.mock.calls)).toBe('ready'); return table.inspect().frame!;},
        close() {table.dispose(); session.dispose();}};
}
function global(layout: CandidateLayout, id: string) {
    let node = layout.nodes.find(node => node.id === id)!;
    const bounds = {...node.box};
    while (node.parent) {
        node = layout.nodes.find(parent => parent.id === node.parent)!;
        bounds.x += node.box.x; bounds.y += node.box.y;
    }
    return bounds;
}
function completeHand(layout: CandidateLayout, environment: Environment) {
    expect(validateLayout(layout)).toEqual([]);
    expect(layout.height).toBe(environment.height);
    expect(layout.nodes.find(node => node.id === 'table')?.scroll).not.toBe(true);
    const hand = layout.nodes.find(node => node.id === 'hand')!, bounds = global(layout, hand.id);
    expect(hand.scroll).not.toBe(true);
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(environment.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(environment.height);
    const cards = layout.nodes.filter(node => node.zoneId === 'hand' && node.entityId);
    expect(cards).toHaveLength(10);
    for (const card of cards) {
        const box = global(layout, card.id);
        expect(card.box.width).toBeGreaterThanOrEqual(56);
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.y).toBeGreaterThanOrEqual(bounds.y);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
        expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
    }
    // Real session-derived decisions, never the empty-choice geometry shortcut.
    const commands = layout.nodes.filter(node => node.kind === 'command').map(node => node.label);
    expect(commands).toEqual(expect.arrayContaining(['공약 ♠ 스페이드 14', '패스']));
}
function completePublicFan(layout: CandidateLayout, count = 3) {
    const cards = layout.nodes.filter(node => node.zoneId === 'trick' && node.entityId);
    expect(cards).toHaveLength(count);
    for (const card of cards) {
        expect(card.box.width).toBe(64); expect(card.box.height).toBe(90);
        const bounds = global(layout, card.id);
        let parent = card.parent;
        while (parent) {
            const owner = layout.nodes.find(node => node.id === parent)!;
            const box = global(layout, owner.id);
            expect(bounds.x, card.id).toBeGreaterThanOrEqual(box.x - 1e-6);
            expect(bounds.x + bounds.width, card.id).toBeLessThanOrEqual(box.x + box.width + 1e-6);
            expect(bounds.y, card.id).toBeGreaterThanOrEqual(box.y - 1e-6);
            expect(bounds.y + bounds.height, card.id).toBeLessThanOrEqual(box.y + box.height + 1e-6);
            expect(owner.scroll, owner.id).not.toBe(true);
            parent = owner.parent;
        }
    }
}
// Actual500px browser surface:461 with root gutter,476 once that gutter goes away.
// Both axes use native15px scrollbars; overlay-only tests miss this regression.
for (const width of [461, 476]) for (const gutter of [0, 15]) for (const badges of [false, true]) {
    test(`complete narrow hand ${width}×677 gutter${gutter} badges${badges}`, () => {
        const h = harness(persistentCaptionDocument({badges}), width, 677, gutter);
        try {
            const frame = h.frame(); completeHand(frame, h.environment); completePublicFan(frame);
            expect(frame.nodes.some(node => node.id === 'room-notices')).toBe(false);
            expect(global(frame, 'hand').width).toBe(256);
        } finally {h.close();}
    });
}
test.each([[390, 844], [500, 757], [1158, 677]])('complete hand survives adjacent viewport%s×%s', (width, height) => {
    const h = harness(persistentCaptionDocument({badges: true}), width, height);
    try {completeHand(h.frame(), h.environment);} finally {h.close();}
});
test.each([461, 476])('important notice appears and disappears without moving the hand at%s', width => {
    const h = harness(persistentCaptionDocument({badges: true}), width);
    try {
        const before = global(h.frame(), 'hand');
        for (const [index, notice] of [true, false].entries()) {
            h.session.receive(persistentCaptionDocument({revision: index + 2, badges: true, notice}));
            const frame = h.frame(); completeHand(frame, h.environment); completePublicFan(frame);
            expect(global(frame, 'hand')).toEqual(before);
            const band = frame.nodes.find(node => node.id === 'room-notices');
            if (notice) {
                expect(band?.scroll).not.toBe(true); expect(band?.box.height).toBe(20);
                expect(frame.nodes.some(node => node.label === '잠깐 다시 연결하는 중…')).toBe(true);
            } else expect(band).toBeUndefined();
        }
    } finally {h.close();}
});
test('long important notice retains bounded native scrolling rather than losing its text', () => {
    const source = persistentCaptionDocument({notice: true}), text = '다시 연결하는 동안 중요한 안내를 확인하세요. '.repeat(10);
    const h = harness({...source, shell: {...source.shell!, notices: [{id: 'long-notice', text, tone: 'plain'}]}});
    try {
        const frame = h.frame(), band = frame.nodes.find(node => node.id === 'room-notices')!;
        expect(validateLayout(frame)).toEqual([]);
        expect(band.scroll).toBe(true); expect(band.scrollAxis).toBe('y');
        expect(band.box.height).toBeGreaterThanOrEqual(44); expect(band.scrollbarGutter).toBe(15);
        expect(frame.nodes.some(node => node.label === text)).toBe(true);
    } finally {h.close();}
});

function publicPlayCount(count: number, revision = 1) {
    const source = persistentCaptionDocument({revision});
    return {...source, collections: source.collections!.map(zone => zone.id !== 'trick' ? zone : {
        ...zone, cards: Array.from({length: count}, (_, index) => ({...zone.cards[index % zone.cards.length], id: `public-play-${index}`})),
    })};
}
test.each([390, 476])('generic public play exposes full cards across membership transitions at%s', width => {
    const h = harness(publicPlayCount(0), width, width === 390 ? 844 : 677);
    try {
        for (const [index, count] of [0, 1, 3, 5, 0].entries()) {
            h.session.receive(publicPlayCount(count, index + 2));
            const frame = h.frame(); completeHand(frame, h.environment); completePublicFan(frame, count);
        }
    } finally {h.close();}
});

test.each([461,476])('Korean metadata retains the full hand and visible decisions at%s',width=>{
    const h=harness(persistentCaptionDocument(),width,677,15,true);
    try {
        const before=h.frame();completeHand(before,h.environment);completePublicFan(before);
        const viewport=before.nodes.find(node=>node.id==='decisions')!,content=before.nodes.find(node=>node.id==='decision-content')!;
        expect(content.box.height).toBeLessThanOrEqual(viewport.box.height);
        for(const card of before.nodes.filter(node=>node.zoneId==='hand'&&node.entityId))expect(card.box.width).toBe(60);
        const hand=global(before,'hand');
        for(const [index,notice] of [true,false].entries()){
            h.session.receive(persistentCaptionDocument({revision:index+2,notice}));
            const frame=h.frame();completeHand(frame,h.environment);completePublicFan(frame);
            expect(global(frame,'hand')).toEqual(hand);
        }
    }finally{h.close();}
});

// Root overflow at doubled text remains an open defect. Do not improve the
// public fan by introducing another clipped persistent participant caption.
test.each([461,476])('doubled-text public fan preserves readable peer badges at%s',width=>{
    const h=harness(persistentCaptionDocument({badges:true}),width,677,15,true,2);
    try {
        const frame=h.frame();
        const signals=frame.nodes.filter(node=>node.participantFeedbackFor);
        expect(signals).toHaveLength(5);
        for(const signal of signals){
            expect(signal.scroll,JSON.stringify({id:signal.id,box:signal.box,children:frame.nodes.filter(node=>node.parent===signal.id||node.participantStatusFor===signal.participantFeedbackFor)})).not.toBe(true);
            const content=frame.nodes.find(node=>node.parent===signal.id)!;
            expect(content.box.y+content.box.height).toBeLessThanOrEqual(signal.box.height);
        }
        for(const card of frame.nodes.filter(node=>node.zoneId==='trick'&&node.entityId)){
            const bounds=global(frame,card.id);
            let parent=card.parent;
            while(parent){
                const owner=frame.nodes.find(node=>node.id===parent)!,box=global(frame,parent);
                expect(bounds.x).toBeGreaterThanOrEqual(box.x-1e-6);
                expect(bounds.x+bounds.width).toBeLessThanOrEqual(box.x+box.width+1e-6);
                expect(owner.scroll&&owner.scrollAxis==='x').not.toBe(true);
                parent=owner.parent;
            }
        }
    }finally{h.close();}
});

test('generic fan admission ignores transient feedback when protecting persistent captions',()=>{
    const badges=persistentCaptionDocument({badges:true});
    const source={...publicPlayCount(5),participant:badges.participant,opponents:badges.opponents};
    const h=harness(source,461,677,15,true,2),environment=h.environment;h.close();
    const base:ChoiceView={values:{suit:'spade'},fields:[{id:'suit',label:'기루다',options:[{id:'spade',label:'♠',enabled:true}]}],selected:{id:'bid',label:'공약',intent:'primary',enabled:true},commands:[{id:'pass',label:'패스',intent:'secondary',enabled:true}]};
    const solve=(choices:ChoiceView)=>{
        const values=new Map<string,Size>();
        for(let attempt=0;attempt<8;attempt++){
            const result=planTable(source,environment,choices,values);
            if(result.kind==='ready')return result.layout;
            if(result.kind!=='needs')throw Error(JSON.stringify(result));
            for(const request of result.requests)values.set(request.key,measured(request,environment,true));
        }
        throw Error('Feedback geometry did not converge');
    };
    const before=solve(base),signature=(layout:CandidateLayout)=>layout.nodes.filter(node=>node.kind==='card').map(node=>[node.id,global(layout,node.id)]);
    for(const feedback of [{cues:source.opponents!.map(person=>({id:`long-cue-${person.id}`,participantId:person.id,label:'긴 반응 '.repeat(20)}))},{cues:[]}])expect(signature(solve({...base,feedback}))).toEqual(signature(before));
});
