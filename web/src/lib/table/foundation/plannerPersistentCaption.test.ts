import {expect, test} from 'vitest';
import type {ChoiceView, Environment, Size} from './contracts';
import {planTable, typography, validateLayout} from './planner';
import {createCardSession} from './session';
import {persistentCaptionDocument} from './shellFixture';

const choices: ChoiceView = {selected: null, values: {}, fields: [], commands: []};
const controls = {
    command: {fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 16, paddingY: 10, minHeight: 44, pulse: 1},
    choice: {fontSize: 15, lineHeight: 18, fontWeight: 600, paddingX: 14, paddingY: 8, minHeight: 40, pulse: 1.08},
};
function solve(width: number, height: number, textScale: number, scrollbarWidth: number, view: ChoiceView = choices, captionText = '프렌드') {
    const source = persistentCaptionDocument();
    const status = {...source.participant.status, value: {kind: 'text' as const, text: captionText}};
    const document = {...source, participant: {...source.participant, status}, opponents: source.opponents.map(person => ({...person, status}))};
    const environment: Environment = {width, height, textScale, scrollbarWidth, scrollbarHeight: 0,
        revision: 'persistent-caption', fontRevision: 'caption', fontFamily: 'sans-serif', controls};
    const values = new Map<string, Size>();
    for (let pass = 0; pass < 20; pass++) {
        const result = planTable(document, environment, view, values);
        if (result.kind === 'ready') return result.layout;
        if (result.kind !== 'needs') throw Error(JSON.stringify(result));
        for (const request of result.requests) {
            const natural = [...request.text].length * 9 * textScale;
            const allocation = request.width ?? natural;
            values.set(request.key, {width: Math.min(natural, allocation),
                height: Math.max(1, Math.ceil(natural / Math.max(1, allocation))) * typography(request.role, environment).lineHeight});
        }
    }
    throw Error('Caption measurements did not converge');
}

for (const [width, height] of [[390, 844], [768, 1024], [1440, 900], [844, 390]]) {
    for (const textScale of [1, 2]) for (const scrollbarWidth of [0, 15]) {
        test(`fitting captions do not lose width to phantom scrollbars at ${width}x${height} text${textScale} gutter${scrollbarWidth}`, () => {
            const layout = solve(width, height, textScale, scrollbarWidth);
            expect(validateLayout(layout)).toEqual([]);
            const captions = layout.nodes.filter(node => node.id.startsWith('["participant-status-caption",'));
            expect(captions.length).toBe(5);
            for (const caption of captions) {
                const content = layout.nodes.find(node => node.id === caption.parent)!;
                const signals = layout.nodes.find(node => node.id === content.parent)!;
                // Three glyphs plus the established 7px inset on each side.
                if (signals.box.width >= 27 * textScale + 14) {
                    expect(signals.scroll).not.toBe(true);
                    expect(content.box.width).toBe(signals.box.width);
                    expect(content.box.y + caption.box.y + caption.box.height).toBeLessThanOrEqual(signals.box.height);
                }
                expect(signals.box.height).toBe(Math.max(28, typography('small', {textScale} as Environment).lineHeight + 8));
                for (const pill of layout.nodes.filter(node => node.parent === caption.id)) {
                    expect(pill.box.y + pill.box.height).toBeLessThanOrEqual(caption.box.height);
                }
            }
        });
    }
}

// Transient feedback must not reclaim the measured persistent area or move
// identity/hand anchors when it appears and disappears.
test.each([1, 2])('transient feedback preserves persistent caption and hand allocation at text%s', textScale => {
    const initial = solve(390, 844, textScale, 15);
    const document = persistentCaptionDocument();
    const cue: ChoiceView = {...choices, feedback: {cues: [{id: 'reaction', participantId: document.participant.id, label: '좋아요 · 내 카드 선택을 기다리고 있어요', cue: 'answer'}]}};
    const during = solve(390, 844, textScale, 15, cue);
    const after = solve(390, 844, textScale, 15);
    for (const id of ['identity', 'hand', 'dock', JSON.stringify(['participant-signals', document.participant.id])]) {
        expect(during.nodes.find(node => node.id === id)!.box).toEqual(initial.nodes.find(node => node.id === id)!.box);
        expect(after.nodes.find(node => node.id === id)!.box).toEqual(initial.nodes.find(node => node.id === id)!.box);
    }
    expect(validateLayout(during)).toEqual([]);
});

test('caption preview retains valid shell and decision authorities', () => {
    const document = persistentCaptionDocument();
    const session = createCardSession({transport: () => {}});
    try {
        session.receive(document);
        expect(session.snapshot().document?.offer.id).toBe(document.offer.id);
    } finally { session.dispose(); }
});

test('a one-line public caption does not become a clipped two-line caption because of a phantom gutter', () => {
    const label = '프렌드 · 공개 역할 안내';
    const layout = solve(1440, 900, 1, 15, choices, label);
    const document = persistentCaptionDocument();
    for (const person of document.opponents) {
        const signals = layout.nodes.find(node => node.id === JSON.stringify(['participant-signals', person.id]))!;
        const caption = layout.nodes.find(node => node.id === JSON.stringify(['participant-status-caption', person.id]))!;
        const natural = [...label].length * 9 + 14;
        expect(signals.box.width).toBeGreaterThanOrEqual(natural);
        expect(signals.box.width - 15).toBeLessThan(natural);
        expect(signals.scroll).not.toBe(true);
        expect(caption.box.height).toBe(20);
        expect(caption.box.height).toBeLessThanOrEqual(signals.box.height);
    }
});
