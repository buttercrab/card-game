import {dockIdentityRow} from './dockPolicy';
import {calculateReadableHandLayout} from '../handLayout';
import { describe, expect, it } from 'vitest';
import type { CandidateLayout, ChoiceView, Environment, LayoutResult, MeasureRequest, PlannedNode, Size, TableDocument } from './contracts';
import {shellDocument} from './shellFixture';
import type {PreferenceField} from './roomShell';
import { createCandidateMeasureKey, measureKey, planTable, typography, validateLayout } from './planner';

const environment: Environment = { width: 390, height: 844, revision: 'font-v1', fontRevision: 'font-v1', controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}},fontFamily: 'Wanted Sans', textScale: 1 };
const document: TableDocument<string> = {
  context: { session: 'session', audience: 'me', generation: 'g1', revision: 'r1' },
  participant: { id: 'me', name: '재용', markers: ['주공', '1점'] },
  hand: Array.from({ length: 10 }, (_, index) => ({ id: String(index), label: `Spade ${index + 1}`, visual: { kind: 'standard' as const, suit: 'Spade' as const, rank: index + 1 } })),
  facts: [{ id: 'trump', label: '기루다', value: '스페이드', subject: 'table', essential: true }],
  decision: { id: 'bid', kind: 'commands', commands: ['pass'] },
  offer: { id: 'offer', actions: [{ id: 'pass', label: '패스', kind: 'command', intent: 'secondary', enabled: true, action: 'pass' }] },
};
const choices: ChoiceView = {
  values: { suit: 'spade' },
  fields: [{ id: 'suit', label: '기루다 선택', options: [{ id: 'spade', label: '스페이드', enabled: true }, { id: 'heart', label: '하트', enabled: false }] }],
  commands: [{ id: 'pass', label: '패스', intent: 'secondary', enabled: true }],
  selected: { id: 'bid-spade-17', label: '공약 스페이드 17', intent: 'primary', enabled: true },
};
/** Independent numeric oracle: fixed glyph width and explicit wrapping, not planner helper calculations. */
function metric(request: MeasureRequest): Size {
  const glyphWidth = 10 * request.environment.textScale;
  const naturalWidth = Array.from(request.text).length * glyphWidth;
  const lineHeight = request.role === 'small' ? 20 : request.role === 'name' ? 26 : request.role === 'button' ? 22 : 24;
  return { width: request.width === null ? naturalWidth : Math.min(request.width, naturalWidth), height: Math.max(1, request.width === null ? 1 : Math.ceil(naturalWidth / request.width)) * lineHeight * request.environment.textScale };
}
function solve(doc = document, env = environment, view = choices): CandidateLayout {
  const metrics = new Map<string, Size>();
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = planTable(doc, env, view, metrics);
    if (result.kind === 'ready') return result.layout;
    if (result.kind !== 'needs') throw new Error(JSON.stringify(result));
    for (const request of result.requests) metrics.set(request.key, metric(request));
  }
  throw new Error('Planner did not converge after intrinsic and exact measurements');
}
const node = (layout: CandidateLayout, id: string) => layout.nodes.find(value => value.id === id)!;
function globalBox(layout: CandidateLayout, id: string) {
  let current = node(layout, id);
  let x = current.box.x, y = current.box.y;
  while (current.parent) { current = node(layout, current.parent); x += current.box.x; y += current.box.y; }
  return { ...node(layout, id).box, x, y };
}
function malformed(nodes: readonly PlannedNode[], width = 300, height = 64): CandidateLayout {
  return { width, height, recipe: 'stacked', nodes };
}
const root: PlannedNode = { id: 'root', parent: null, kind: 'group', label: '', box: { x: 0, y: 0, width: 300, height: 64 } };

describe('candidate metric namespaces',()=>{
  it('preserves public metric keys byte for byte across recipes and escaped text',()=>{
    for(const env of [environment,{...environment,fontRevision:'font-2',fontFamily:'Font "Two"',artFontFamily:'Art\\Face',textScale:2},{...environment,controls:{...environment.controls,command:{...environment.controls.command,paddingX:25,pulse:1.12}}}]){
      const candidate=createCandidateMeasureKey(env);
      for(const text of ['', '재용\n  hello\t', '"\\\ud800😀', 'a '.repeat(300)])
        for(const role of ['participant-name','body','name','small','button','choice','select','display','compact-display','art'] as const)
          for(const width of [null,0,44,125.25,512])expect(candidate(text,role,width)).toBe(measureKey(text,role,width,env));
    }
  });
  it('captures once per candidate and observes a changed environment on the next candidate',()=>{
    const original=structuredClone(environment),changed=structuredClone(environment);
    const first=createCandidateMeasureKey(changed);
    (changed as {textScale:number}).textScale=2;
    (changed.controls.command as {fontSize:number}).fontSize=23;
    expect(first('Name','name',null)).toBe(measureKey('Name','name',null,original));
    expect(createCandidateMeasureKey(changed)('Name','name',null)).toBe(measureKey('Name','name',null,changed));
    expect(first('Name','name',null)).not.toBe(createCandidateMeasureKey(changed)('Name','name',null));
  });
});

describe('foundation width-bound composition', () => {
  it('returns deduplicated missing intrinsic reads without publishing placeholders', () => {
    const result = planTable(document, environment, choices, new Map());
    expect(result.kind).toBe('needs');
    if (result.kind !== 'needs') throw new Error('Expected reads');
    expect(result.requests.length).toBeGreaterThan(0);
    expect(new Set(result.requests.map(request => request.key)).size).toBe(result.requests.length);
    expect(result.requests.every(request => request.width === null)).toBe(true);
    expect('layout' in result).toBe(false);
    const partial = new Map([[result.requests[0].key, metric(result.requests[0])]]);
    expect(planTable(document, environment, choices, partial).kind).toBe('needs');
  });
  it('requests overflowing text at its precise leaf width while reusing fitting intrinsic reads', () => {
    const target={...document,participant:{...document.participant,name:'A long localized player name with multiple words '.repeat(8)}};
    const first = planTable(target, environment, choices, new Map());
    if (first.kind !== 'needs') throw new Error('Expected intrinsic reads');
    const metrics = new Map(first.requests.map(request => [request.key, metric(request)]));
    const second = planTable(target, environment, choices, metrics);
    expect(second.kind).toBe('needs');
    if (second.kind !== 'needs') throw new Error('Expected constrained reads');
    expect(second.requests.every(request => request.width !== null && request.width > 0)).toBe(true);
    expect(second.requests.some(request=>request.text===target.participant.name&&request.width!<metrics.get(measureKey(request.text,request.role,null,environment))!.width)).toBe(true);
    second.requests.forEach(request => metrics.set(request.key, metric(request)));
    expect(planTable(target, environment, choices, metrics).kind).toBe('ready');
  });
  it('does not request redundant width-keyed reads when every real intrinsic text metric fits',()=>{
    const first=planTable(document,environment,choices,new Map());if(first.kind!=='needs')throw Error('Expected intrinsic reads');
    const result=planTable(document,environment,choices,new Map(first.requests.map(request=>[request.key,metric(request)])));
    expect(result.kind).toBe('ready');if(result.kind==='ready')expect(validateLayout(result.layout)).toEqual([]);
  });
  it.each([[320, 568], [390, 844], [568, 320], [768, 1024], [1024, 768], [1440, 900]])('has contained ordinary geometry at %sx%s', (width, height) => {
    const layout = solve(document, { ...environment, width, height });
    expect(validateLayout(layout)).toEqual([]);
    expect(layout.width).toBe(width);
    expect(layout.height).toBeGreaterThanOrEqual(height);
    const figure = globalBox(layout, 'identity-figure');
    const dock = globalBox(layout, 'dock');
    expect(figure.y - dock.y).toBeGreaterThanOrEqual(14);
    expect(figure.y + figure.height).toBeLessThan(dock.y + dock.height);
  });
  it('measures complete long identity text and markers rather than clipping to a row baseline', () => {
    const doc = { ...document, participant: { id: 'me', name: '아주 긴 이름입니다 A long localized participant name', markers: ['주공', '프렌드', '상태가 아주 길어요', '계속되는 상태'] } };
    const layout = solve(doc, { ...environment, width: 320, height: 568, textScale: 2 });
    const name = node(layout, 'identity-name');
    expect(name.box.height).toBeGreaterThan(100);
    expect(node(layout, 'identity').box.height).toBeGreaterThan(name.box.height + 72);
    expect(validateLayout(layout)).toEqual([]);
    expect(node(layout, 'table').scroll).toBe(true);
  });
  it('uses side-by-side only when both children fit, and falls back deterministically to stacked', () => {
    const narrow = solve(document, { ...environment, width: 320 });
    const wide = solve(document, { ...environment, width: 1024 });
    expect(narrow.recipe).toBe('stacked');
    expect(wide.recipe).toBe('side-by-side');
    expect(solve(document, { ...environment, width: 320 })).toEqual(narrow);
  });
  it('preserves minimum card exposure through an explicit horizontal viewport for large hands', () => {
    const doc = { ...document, hand: Array.from({ length: 80 }, (_, index) => ({ ...document.hand[0], id: `large-${index}` })) };
    const layout = solve(doc, { ...environment, width: 320 });
    expect(node(layout, 'hand').scroll).toBe(true);
    expect(node(layout, 'hand-fan').box.width).toBeGreaterThan(node(layout, 'hand').box.width);
    const cards = layout.nodes.filter(value => value.kind === 'card'&&value.entityId);
    expect(cards).toHaveLength(80);
    const canonical=calculateReadableHandLayout({regionWidth:node(layout,'hand').box.width,viewportWidth:320,viewportHeight:environment.height,count:80,selectionLift:0,padding:0,scrollbarHeight:environment.scrollbarHeight??0});expect(canonical.kind).toBe('horizontal-scroll');expect(cards.map(card=>card.box.x)).toEqual(canonical.cards.map(card=>card.x));
    expect(validateLayout(layout)).toEqual([]);
  });
  it('retains exact command IDs, disabled options, selected values and readable target allocations', () => {
    const layout = solve(document, { ...environment, width: 320, textScale: 2 });
    const options = layout.nodes.filter(value => value.kind === 'choice');
    expect(options.find(value => value.optionId === 'heart')?.enabled).toBe(false);
    expect(options.find(value => value.optionId === 'spade')?.checked).toBe(true);
    expect(layout.nodes.find(value => value.actionId === 'bid-spade-17')?.label).toBe('공약 스페이드 17');
    expect(layout.nodes.filter(value => value.kind === 'choice' || value.kind === 'command').every(value => value.box.width >= 44 && value.box.height >= 44)).toBe(true);
    expect(validateLayout(layout)).toEqual([]);
  });
  it('publishes explicit semantics and decoration independent of renderer ID conventions', () => {
    for (const width of [320, 1024]) {
      const layout = solve(document, { ...environment, width });
      const radio = layout.nodes.filter(value => value.semanticRole === 'radiogroup');
      expect(radio).toHaveLength(1);
      expect(radio[0].label).toBe('기루다 선택');
      expect(radio[0].kind).toBe('group');
      expect(layout.nodes.filter(value => value.decoration === 'tray')).toEqual([node(layout, 'dock')]);
      const seen = new Set<string>();
      for (const value of layout.nodes) {
        if (value.parent) expect(seen.has(value.parent)).toBe(true);
        seen.add(value.id);
      }
    }
  });
  it('returns explicit non-fit before trying to disguise insufficient width', () => {
    expect(planTable(document, { ...environment, width: 100 }, choices, new Map()).kind).toBe('cannot-fit');
    expect(planTable(document, { ...environment, width: 135 }, choices, new Map()).kind).toBe('cannot-fit');
    expect(validateLayout(solve(document, { ...environment, width: 136 }))).toEqual([]);
  });
  it('rejects nonfinite environments and malformed metrics with terminal failures', () => {
    expect(planTable(document, { ...environment, width: Infinity }, choices, new Map()).kind).toBe('failed');
    const first = planTable(document, environment, choices, new Map());
    if (first.kind !== 'needs') throw new Error('Expected reads');
    const invalid = new Map(first.requests.map(request => [request.key, { width: 10, height: Number.NaN }]));
    expect(planTable(document, environment, choices, invalid).kind).toBe('failed');
  });
  it('scopes metrics to content, role, exact width, typography, font and revision', () => {
    const base = measureKey('Hello', 'name', 100, environment);
    expect(new Set([base, measureKey('Different', 'name', 100, environment), measureKey('Hello', 'body', 100, environment), measureKey('Hello', 'name', null, environment), measureKey('Hello', 'name', 101, environment), measureKey('Hello', 'name', 100, { ...environment, textScale: 2 }), measureKey('Hello', 'name', 100, { ...environment, fontFamily: 'Other font' }), measureKey('Hello', 'name', 100, { ...environment, fontRevision: 'next' })]).size).toBe(8);
    expect(measureKey('Hello', 'name', 100, { ...environment, revision: 'allocation-next' })).toBe(base);
    expect(typography('name', { ...environment, textScale: 2 })).toEqual({ fontSize: 36, lineHeight: 52, fontWeight: 700 });
  });
  it('keeps the original hand allocation throughout depletion, including its silent empty row', () => {
    // Original Hand.svelte at 6bfc032 keeps one row even when empty so the
    // table never moves. A visible empty-state label is migration drift.
    const view = { fields: [], commands: [], values: null, selected: null };
    for (const env of [environment, { ...environment, width: 1280, height: 800, scrollbarHeight: 15 }]) {
      const occupied = solve(document, env, view);
      for (const count of [0, 1, 4, 5, 10]) {
        const layout = solve({ ...document, hand: document.hand.slice(0, count) }, env, view);
        expect(layout.recipe).toBe(occupied.recipe);
        expect(node(layout, 'hand').box).toEqual(node(occupied, 'hand').box);
        expect(node(layout, 'dock').box).toEqual(node(occupied, 'dock').box);
        expect(node(layout, 'hand').box.height).toBeGreaterThan(0);
        expect(node(layout, 'hand').semanticRole).toBe('group');
        if (!count) {
          expect(node(layout, 'hand').label).toBe('내 카드');
          expect(layout.nodes.filter(value => value.parent === 'hand')).toEqual([]);
          expect(layout.nodes.some(value => value.id === 'hand-empty' || value.id === 'hand-fan')).toBe(false);
          expect(layout.nodes.some(value => value.label === '카드 없음')).toBe(false);
        }
        expect(validateLayout(layout)).toEqual([]);
      }
    }
  });
});

describe('independent composition invariants', () => {
  it('rejects the reported 64px reservation around an 89px identity', () => {
    const layout = malformed([root, { id: 'figure', parent: 'root', kind: 'figure', label: 'me', box: { x: 10, y: 0, width: 72, height: 89 } }]);
    expect(validateLayout(layout)).toContain('Child escapes allocation: figure');
  });
  it('rejects 180px and 160px ordinary siblings in a 300px row', () => {
    const layout = malformed([root, { id: 'a', parent: 'root', kind: 'text', label: 'a', box: { x: 0, y: 0, width: 180, height: 30 } }, { id: 'b', parent: 'root', kind: 'text', label: 'b', box: { x: 140, y: 0, width: 160, height: 30 } }]);
    expect(validateLayout(layout)).toContain('Ordinary siblings overlap: a, b');
  });
  it('does not treat fan or scroll as arbitrary overflow/overlap permission', () => {
    const fan = malformed([{ ...root, arrangement: 'fan' }, { id: 'label', parent: 'root', kind: 'text', label: 'Bad child', box: { x: 0, y: 0, width: 10, height: 20 } }]);
    expect(validateLayout(fan)).toContain('Fan overlap permits only cards: root');
    const scroll = malformed([{ ...root, scroll: true }, { id: 'label', parent: 'root', kind: 'text', label: 'Bad child', box: { x: 0, y: 0, width: 400, height: 20 } }]);
    expect(validateLayout(scroll)).toContain('Child escapes allocation: label');
    expect(validateLayout(scroll)).toContain('Invalid scroll content: root');
  });
  it('rejects semantic group roles and decorations on leaves, and unordered trees', () => {
    const bad: PlannedNode = { id: 'bad', parent: 'root', kind: 'text', label: 'Bad', semanticRole: 'radiogroup', decoration: 'tray', box: { x: 0, y: 0, width: 30, height: 20 } };
    expect(validateLayout(malformed([root, bad]))).toContain('Semantic group role on non-group: bad');
    expect(validateLayout(malformed([root, bad]))).toContain('Group decoration on non-group: bad');
    expect(validateLayout(malformed([bad, root]))).toContain('Parent must precede child: bad');
  });
  it('rejects undersized hit targets even when ordinary painted boxes fit', () => {
    expect(validateLayout(malformed([root, { id: 'button', parent: 'root', kind: 'command', label: 'small', box: { x: 0, y: 0, width: 32, height: 32 } }]))).toContain('Undersized target: button');
  });
  it('rejects duplicate, disconnected, cyclic and nonfinite layouts', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const errors = validateLayout(malformed([root, root, { id: 'orphan', parent: 'missing', kind: 'text', label: '', box: { ...box, x: NaN } }, { id: 'cycle', parent: 'cycle', kind: 'group', label: '', box }]));
    expect(errors).toContain('Duplicate node: root');
    expect(errors).toContain('Invalid box: orphan');
    expect(errors).toContain('Missing group parent: orphan');
    expect(errors).toContain('Parent cycle: cycle');
  });
});

describe('whole-table measured composition',()=>{
  const table={...document,opponents:Array.from({length:4},(_,index)=>({id:`peer-${index}`,name:`참가자 ${index}`,handCount:10})),collections:[{id:'play',label:'현재 트릭',purpose:'play' as const,cards:document.hand.slice(0,3).map(card=>({...card,id:`public-${card.id}`}))}]};
  it('admits the sidebar with readable arena while decision-only strip remains above the hand',()=>{
    for(const width of [320,390,768,1024,1440]){
      const layout=solve(table,{...environment,width});expect(validateLayout(layout)).toEqual([]);
      const arena=globalBox(layout,'arena'),dock=globalBox(layout,'dock'),strip=globalBox(layout,'table-decision-strip');
      expect(layout.decisionLaneId).toBe('decisions');expect(strip.y).toBeGreaterThanOrEqual(arena.y+arena.height+8);expect(dock.y).toBeGreaterThanOrEqual(strip.y+strip.height+8);
      if(width>=1024){const facts=globalBox(layout,'facts'),rail=globalBox(layout,'table-sidebar');expect(facts.x).toBeGreaterThanOrEqual(arena.x+arena.width+12);expect(dock.x+dock.width+12).toBeLessThanOrEqual(rail.x);}
      else {expect(layout.nodes.some(node=>node.id==='facts')).toBe(false);expect(layout.nodes.some(node=>node.localIntent==='toggle-information')).toBe(true);expect(globalBox(layout,'table-footer').y).toBeGreaterThanOrEqual(dock.y+dock.height+8);}
      expect(globalBox(layout,'identity-figure').width).toBe(72);
    }
  });
  it('uses a shorter horizontal local identity without shrinking its figure on narrow tables',()=>{
    const layout=solve(table,{...environment,width:390});
    const figure=globalBox(layout,'identity-figure'),name=globalBox(layout,'identity-name');
    expect(name.x).toBeGreaterThanOrEqual(figure.x+figure.width+12);
    const identity=globalBox(layout,'identity'),labels=globalBox(layout,'identity-labels');
    expect(labels.x).toBeGreaterThanOrEqual(figure.x+figure.width+12);
    expect(identity.y+identity.height).toBeGreaterThanOrEqual(Math.max(figure.y+figure.height,labels.y+labels.height)+6);
    expect(node(layout,'identity').box.height).toBeGreaterThanOrEqual(figure.height);
  });
  it('lets long localized names and enlarged text grow instead of clipping or overlapping',()=>{
    const long={...table,participant:{...table.participant,name:'긴 참가자 이름이 여러 줄로 계속되어도 겹치지 않아야 합니다'},opponents:table.opponents.map(person=>({...person,name:'상대방의 아주 긴 이름입니다'}))};
    const layout=solve(long,{...environment,width:320,textScale:2});
    expect(validateLayout(layout)).toEqual([]);expect(node(layout,'identity-name').box.height).toBeGreaterThan(72);expect(node(layout,'table').scroll||layout.nodes.some(value=>value.scrollAxis==='y')).toBe(true);
  });
});

it('vertical viewport permission is limited to one full-width group and cannot hide arbitrary overflow',()=>{
  const viewport={...root,scroll:true,scrollAxis:'y' as const};
  const content:PlannedNode={id:'content',parent:'root',kind:'group',label:'',box:{x:0,y:0,width:300,height:300}};
  expect(validateLayout(malformed([viewport,content]))).toEqual([]);
  expect(validateLayout(malformed([viewport,{...content,kind:'text'}]))).toContain('Invalid vertical viewport: root');
  expect(validateLayout(malformed([viewport,{...content,box:{...content.box,width:301}}]))).toContain('Invalid vertical viewport: root');
  expect(validateLayout(malformed([viewport]))).toContain('Invalid vertical viewport: root');
  expect(validateLayout(malformed([root,content]))).toContain('Child escapes allocation: content');
});

it('reserves classic native scrollbar gutters before measuring table content and hand height',()=>{
    const table={...document,opponents:Array.from({length:4},(_,index)=>({id:`p${index}`,name:`P${index}`,handCount:10}))};
    const layout=solve(table,{...environment,width:320,height:700,scrollbarWidth:24,scrollbarHeight:24});
    const viewport=node(layout,'table-footer'),content=node(layout,'active-tools-content');
    expect(viewport.scrollbarGutter).toBe(24);expect(content.box.width).toBe(viewport.box.width-24);
    expect(node(layout,'hand').box.height).toBe(node(layout,'hand-fan').box.height+24);
    expect(validateLayout(layout)).toEqual([]);
});

it('declines a bounded arena when native scrollbars consume its minimum readable width',()=>{
    const table={...document,opponents:Array.from({length:4},(_,index)=>({id:`p${index}`,name:`P${index}`,handCount:10}))};
    const env={...environment,width:248,height:700,scrollbarWidth:24,scrollbarHeight:24};
    const values=new Map<string,Size>();let result:LayoutResult=planTable(table,env,choices,values);
    for(let i=0;i<8&&result.kind==='needs';i++){result.requests.forEach(request=>values.set(request.key,metric(request)));result=planTable(table,env,choices,values);}
    expect(result.kind).toBe('cannot-fit');
});

it('dense command decisions keep an isolated measured strip above the hand and outside information rail',()=>{
    const commands=Array.from({length:12},(_,index)=>({id:`command-${index}`,label:`선택지 ${index}`,enabled:true,intent:'secondary' as const}));
    const doc={...document,opponents:Array.from({length:4},(_,index)=>({id:`peer-${index}`,name:`P${index}`,handCount:10})),hand:Array.from({length:13},(_,index)=>({...document.hand[0],id:`hand-${index}`})),collections:[{id:'stock',label:'키티',purpose:'stock' as const,cards:[],hiddenCount:0}]};
    const layout=solve(doc,{...environment,width:1440,height:900,scrollbarWidth:24},{values:null,fields:[],commands,selected:null});
    expect(validateLayout(layout)).toEqual([]);
    const arena=globalBox(layout,'arena'),panel=globalBox(layout,'decisions'),dock=globalBox(layout,'dock');
    const strip=globalBox(layout,'table-decision-strip'),rail=globalBox(layout,'table-sidebar');expect(panel.x).toBe(arena.x);expect(strip.y).toBeGreaterThanOrEqual(arena.y+arena.height+8);expect(dock.y).toBeGreaterThanOrEqual(strip.y+strip.height+8);expect(dock.x+dock.width+12).toBeLessThanOrEqual(rail.x);expect(layout.decisionLaneId).toBe('decisions');
    expect(layout.nodes.filter(value=>value.actionId).every(value=>value.box.width>=44&&value.box.height>=44)).toBe(true);
});

it('places four opponents clockwise around the center rather than in stacked lists',()=>{
 const people=Array.from({length:4},(_,index)=>({id:`p${index}`,name:`P${index}`,handCount:10}));
 const doc={...document,opponents:people,collections:[{id:'stock',label:'Kitty',purpose:'stock' as const,cards:[],hiddenCount:3}]};
 const layout=solve(doc,{...environment,width:1440,height:900});
 const box=(index:number)=>globalBox(layout,JSON.stringify(['opponent',`p${index}`]));
 const left=box(3),right=box(0),topLeft=box(2),topRight=box(1),center=globalBox(layout,'collections');
 expect(topLeft.x).toBeLessThan(topRight.x);expect(topLeft.y+topLeft.height).toBeLessThan(left.y);
 expect(left.x+left.width).toBeLessThanOrEqual(center.x-12);expect(right.x).toBeGreaterThanOrEqual(center.x+center.width+12);
 expect(globalBox(layout,'table-decision-strip').y).toBeGreaterThanOrEqual(globalBox(layout,'arena').y+globalBox(layout,'arena').height+8);expect(globalBox(layout,'decisions').x).toBe(globalBox(layout,'arena').x);
 expect(validateLayout(layout)).toEqual([]);
 for(const width of [248,263])expect(planTable(doc,{...environment,width},choices,new Map()).kind).toBe('cannot-fit');
 expect(validateLayout(solve(doc,{...environment,width:264}))).toEqual([]);
});

it('observer composition has no extra local player portrait or hand tray',()=>{
 const doc={...document,participant:{...document.participant,role:'observer' as const},hand:[],opponents:Array.from({length:5},(_,i)=>({id:`p${i}`,name:`P${i}`,handCount:10}))};
 const layout=solve(doc,{...environment,width:1440,height:900});expect(layout.nodes.filter(node=>node.kind==='figure')).toHaveLength(5);expect(layout.nodes.find(node=>node.id==='dock')!.box.height).toBe(0);expect(validateLayout(layout)).toEqual([]);
});

it('public trick cards follow their participant seats and reserve a stable empty center',()=>{
 const people=Array.from({length:4},(_,index)=>({id:`p${index}`,name:`P${index}`,handCount:9}));
 const cards=document.hand.slice(0,5).map((card,index)=>({...card,id:`played-${index}`,ownerId:index===4?document.participant.id:people[index].id}));
 const trick={id:'trick',label:'현재 트릭',purpose:'play' as const,kind:'trick' as const,cards};
 const doc={...document,opponents:people,collections:[trick]};
 const layout=solve(doc,{...environment,width:1440,height:900});
 const boxes=cards.map(card=>globalBox(layout,JSON.stringify(['collection','trick','card',card.id])));
 expect(boxes[0].x).toBeGreaterThan(boxes[1].x);expect(boxes[1].x).toBeGreaterThan(boxes[2].x);expect(boxes[2].x).toBeGreaterThan(boxes[3].x);
 expect(boxes[1].y).toBe(boxes[2].y);expect(boxes[0].y).toBeGreaterThan(boxes[1].y);expect(boxes[4].y).toBeGreaterThan(boxes[0].y);
 expect(validateLayout(layout)).toEqual([]);
 const empty=solve({...doc,collections:[{...trick,cards:[]}]},{...environment,width:1440,height:900});
 const id=JSON.stringify(['collection','trick','trick']);expect(globalBox(empty,id)).toEqual(globalBox(layout,id));
 expect(empty.nodes.some(node=>node.kind==='text'&&node.label==='현재 트릭')).toBe(false);
});

it('narrow trick footprints reserve classic scrollbar space before cards arrive',()=>{
 const doc={...document,opponents:Array.from({length:4},(_,i)=>({id:`p${i}`,name:`P${i}`,handCount:9})),collections:[{id:'trick',label:'현재 트릭',purpose:'play' as const,kind:'trick' as const,cards:[] as import('./contracts').TableCard[]}]};
 const env={...environment,width:320,height:2000,scrollbarHeight:24};
 const id=JSON.stringify(['collection','trick']);const empty=globalBox(solve(doc,env),id);
 for(const count of [1,2,5]){
  const cards=document.hand.slice(0,count).map((card,i)=>({...card,ownerId:i===4?document.participant.id:`p${i}`}));
  expect(globalBox(solve({...doc,collections:[{...doc.collections[0],cards}]},env),id)).toEqual(empty);
 }
});


describe('measured local preference presentation',()=>{
  const preferences:readonly PreferenceField[]=[
    {id:'toggle',kind:'toggle',label:'효과음 켜기 · 긴 설명과 함께 표시되는 설정',help:'이 기기에만 저장되는 환경 설정이에요.',enabled:true,value:true},
    {id:'select',kind:'select',label:'애니메이션 속도',help:'원하는 속도를 선택하세요.',enabled:true,value:'slow',options:[{id:'slow',label:'아주 긴 애니메이션 속도 선택지 설명입니다',enabled:true,help:'선택한 항목의 자세한 설명입니다.'},{id:'locked',label:'잠긴 항목',enabled:false}]},
    {id:'number',kind:'number',label:'배경 음악 음량',help:'키보드 방향키로 조절할 수 있어요.',enabled:false,value:0.5,min:0,max:1,step:0.1},
  ];
  const base=shellDocument().shell!;
  const doc={...document,shell:{...base,pages:[...base.pages,{id:'settings' as const,title:'설정',description:'이 기기의 화면과 소리에만 적용돼요.',actions:[],preferences}]}};
  const view={...choices,shellPage:'settings' as const,preferencesAvailable:true};
  it.each([[320,568,1],[390,844,1],[320,568,2],[390,844,2],[568,320,2],[1440,900,1]])('keeps settings targets and labels in contained scroll geometry at %sx%s scale %s',(width,height,textScale)=>{
    const layout=solve(doc,{...environment,width,height,textScale},view);
    expect(validateLayout(layout)).toEqual([]);
    expect(layout.modalId).toBe('room-dialog');
    const controls=layout.nodes.filter(node=>node.preference);
    expect(controls.map(node=>node.kind)).toEqual(['toggle','select','range']);
    for(const control of controls){expect(control.box.width).toBeGreaterThanOrEqual(44);expect(control.box.height).toBeGreaterThanOrEqual(44);expect(control.fieldId).toBeUndefined();expect(control.actionId).toBeUndefined();}
    expect(layout.nodes.some(node=>node.label===doc.shell.pages.at(-1)!.description)).toBe(true);
    expect(layout.nodes.some(node=>node.label===preferences[0].help)).toBe(true);
    expect(controls[2].enabled).toBe(false);
    const modal=node(layout,'room-dialog');expect(modal.box.height).toBeLessThanOrEqual(height-32);
    if(textScale===2)expect(layout.nodes.some(node=>node.scroll&&node.id.includes('room-dialog'))).toBe(true);
  });
  it('disables local preferences without the scoped host effect',()=>{
    expect(solve(doc,environment,{...view,preferencesAvailable:false}).nodes.filter(node=>node.preference).every(node=>!node.enabled)).toBe(true);
  });
  it('rejects preference controls with game authority or missing descriptors',()=>{
    const layout=solve(doc,environment,view),control=layout.nodes.find(node=>node.preference?.id==='select')!;
    expect(validateLayout({...layout,nodes:layout.nodes.map(node=>node===control?{...node,fieldId:'server-choice'}:node)})).toContain(`Mixed preference authority: ${control.id}`);
    const toggle=layout.nodes.find(node=>node.kind==='toggle')!;
    expect(validateLayout({...layout,nodes:layout.nodes.map(node=>node===toggle?{...node,preference:undefined}:node)})).toContain(`Missing preference binding: ${toggle.id}`);
  });
});

it('reuses owned intrinsic snapshots within one candidate and rereads them in every later candidate',()=>{
 const first=planTable(document,environment,choices,new Map());if(first.kind!=='needs')throw Error('Expected reads');
 const values=new Map(first.requests.map(request=>[request.key,metric(request)])),reads=new Map<string,number>(),get=values.get.bind(values);
 values.get=key=>{reads.set(key,(reads.get(key)??0)+1);return get(key);};
 const name=measureKey(document.participant.name,'participant-name',null,environment);
 expect(planTable(document,environment,choices,values).kind).toBe('ready');expect(reads.get(name)).toBe(1);
 reads.clear();expect(planTable(document,environment,choices,values).kind).toBe('ready');expect(reads.get(name)).toBe(1);
 // A previous candidate cannot retain this source alias across publication.
 const original=get(name)!;(original as {width:number}).width=Infinity;
 expect(planTable(document,environment,choices,values).kind).toBe('failed');
});
it('candidate reuse preserves font namespace and exact overflow width refusal',()=>{
 const long={...document,participant:{...document.participant,name:'아주 긴 참가자 이름으로 줄바꿈 측정을 강제해요 '.repeat(6)}},first=planTable(long,environment,choices,new Map());if(first.kind!=='needs')throw Error('Expected reads');
 const values=new Map(first.requests.map(request=>[request.key,metric(request)])),overflow=planTable(long,environment,choices,values);if(overflow.kind!=='needs')throw Error('Expected exact wrapping');
 expect(overflow.requests.every(request=>request.width!==null)).toBe(true);
 for(const request of overflow.requests)values.set(request.key,metric(request));
 expect(planTable(long,environment,choices,values).kind).toBe('ready');
 const request=overflow.requests[0];values.set(request.key,{width:request.width!+1,height:24});expect(planTable(long,environment,choices,values).kind).toBe('failed');
 const next=planTable(long,{...environment,fontRevision:'replacement-font'},choices,values);expect(next.kind).toBe('needs');if(next.kind==='needs')expect(next.requests.every(request=>request.environment.fontRevision==='replacement-font'&&!values.has(request.key))).toBe(true);
});
it('a changing intrinsic accessor cannot poison the candidate owned scalar snapshot',()=>{
 const first=planTable(document,environment,choices,new Map());if(first.kind!=='needs')throw Error('Expected reads');const values=new Map(first.requests.map(request=>[request.key,metric(request)]));
 const key=measureKey(document.participant.name,'participant-name',null,environment);let reads=0;values.set(key,{get width(){return ++reads<=3?20:Infinity;},height:24});
 expect(planTable(document,environment,choices,values).kind).toBe('ready');expect(reads).toBe(3);
 // Subsequent source changes cannot mutate this candidate's already-owned
 // scalar snapshot, but the next candidate must validate that source anew.
 expect(planTable(document,environment,choices,values).kind).toBe('failed');expect(reads).toBeGreaterThan(3);
 const changing=new Map(values);let beforeCopy=0;changing.set(key,{get width(){return ++beforeCopy<=2?20:Infinity;},height:24});expect(planTable(document,environment,choices,changing).kind).toBe('failed');
});

it('publishes inert complete-roster trick slots at the existing regular seat-relative card positions',()=>{
 const peers=Array.from({length:4},(_,i)=>({id:`peer-${i}`,name:`Peer ${i}`,handCount:5})),owners=['me',...peers.map(peer=>peer.id)],cards=owners.map((ownerId,i)=>({id:`play-${i}`,ownerId,label:`Play ${i}`,visual:{kind:'standard' as const,suit:'Spade' as const,rank:i+2}}));
 const doc={...document,opponents:peers,hand:[],collections:[{id:'trick',kind:'trick' as const,purpose:'play' as const,label:'Current trick',cards}]},layout=solve(doc,{...environment,width:1440,height:1200}, {selected:null,values:{},fields:[],commands:[]}),index=new Map(layout.nodes.map(node=>[node.id,node]));
 const bounds=(node:PlannedNode)=>{let x=node.box.x,y=node.box.y,parent=node.parent;while(parent){const ancestor=index.get(parent)!;x+=ancestor.box.x;y+=ancestor.box.y;parent=ancestor.parent;}return {x,y,width:node.box.width,height:node.box.height};};
 const slots=layout.nodes.filter(node=>node.trickSlot);expect(slots).toHaveLength(5);expect(validateLayout(layout)).toEqual([]);
 for(const slot of slots){const card=layout.nodes.find(node=>node.entityId&&node.ownerId===slot.ownerId&&node.zoneId==='trick')!;expect(bounds(slot)).toEqual(bounds(card));expect(slot.kind).toBe('group');expect(slot.inert).toBe(true);expect(slot.label).toBe('');expect(slot.visual).toBeUndefined();expect(slot.entityId).toBeUndefined();}
 const target=slots[0];for(const patch of [{visual:{kind:'back' as const}},{enabled:true},{ownerId:'foreign'},{entityId:'private'},{label:'Painted'},{collectedBy:'me'}])expect(validateLayout({...layout,nodes:layout.nodes.map(node=>node.id===target.id?{...node,...patch}:node)})).toContain(`Invalid inert trick slot: ${target.id}`);
});
it('keeps captured winner authority off cards, native controls and unknown participants',()=>{
 const doc={...document,hand:[],collections:[{id:'captured',purpose:'captured' as const,label:'Previous',collectedBy:'me',cards:[{id:'face',ownerId:'me',label:'Public',visual:{kind:'standard' as const,suit:'Spade' as const,rank:2}}]}]},layout=solve(doc),root=layout.nodes.find(node=>node.collectedBy)!;
 expect(root.kind).toBe('group');expect(root.collectionPurpose).toBe('captured');expect(root.zoneId).toBe('captured');expect(validateLayout(layout)).toEqual([]);
 for(const patch of [{collectedBy:'foreign'},{collectionPurpose:'play' as const},{kind:'card' as const},{actionId:'play'},{enabled:true}])expect(validateLayout({...layout,nodes:layout.nodes.map(node=>node.id===root.id?{...node,...patch}:node)})).toContain(`Invalid captured collection winner: ${root.id}`);
});


it('ordinary adjacent identity admission preserves intrinsic name/meta widths and the native passive hand minimum',()=>{
 for(const width of [390,415,416]){
  const env={...environment,width},first=planTable(document,env,choices,new Map());if(first.kind!=='needs')throw Error('Initial intrinsic measurements');const metrics=new Map(first.requests.map(request=>[request.key,metric(request)])),result=planTable(document,env,choices,metrics);
  expect(result.kind).toBe('ready');if(result.kind!=='ready')throw Error(JSON.stringify(result));const layout=result.layout;expect(validateLayout(layout)).toEqual([]);expect(dockIdentityRow(env)).toBeGreaterThan(0);expect(layout.recipe).toBe('stacked');
  const name=node(layout,'identity-name'),badge=node(layout,'identity-name-badge'),figure=node(layout,'identity-figure'),hand=node(layout,'hand');expect(name.label).toBe('재용');expect(name.role).toBe('participant-name');expect(name.box).toMatchObject({width:20,height:24});expect(badge.box.width).toBe(36);expect(figure.box).toMatchObject({width:56,height:56*110/120});const canonical=calculateReadableHandLayout({regionWidth:hand.box.width,viewportWidth:env.width,viewportHeight:env.height,count:document.hand.length,selectionLift:0,padding:0,scrollbarHeight:env.scrollbarHeight??0});expect(canonical.rows).toHaveLength(1);expect(canonical.scroll).toBe(false);expect(hand.box.height).toBe(canonical.height);
  for(const [index,label] of document.participant.markers.entries()){const marker=node(layout,JSON.stringify(['marker',String(index)]));expect(marker.label).toBe(label);expect(marker.box).toMatchObject({width:20,height:20});const bounds=globalBox(layout,marker.id),identity=globalBox(layout,'identity');expect(bounds.x).toBeGreaterThanOrEqual(identity.x);expect(bounds.x+bounds.width).toBeLessThanOrEqual(identity.x+identity.width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(identity.y+identity.height);}
 }
});
