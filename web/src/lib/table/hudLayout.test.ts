import { expect, test } from 'vitest';
import { layoutHudColumns, layoutHudFlow, layoutHudResult, layoutHudStack, statusHudPolicy, resultHudPolicy, SCOREBOARD_COLUMNS, SCOREBOARD_FIGURE } from './hudLayout';

test('status wraps complete logical items and centers each independently measured line', () => {
  const result = layoutHudFlow([{ id: 'contract', width: 80, height: 22 }, { id: 'friend', width: 60, height: 18 }, { id: 'round', width: 60, height: 18 }], 160, { height: 44 });
  expect(result.height).toBe(42);
  expect(result.nodes.map(node => node.bounds)).toEqual([
    { x: 3, y: 1, width: 80, height: 22 }, { x: 97, y: 3, width: 60, height: 18 }, { x: 50, y: 25, width: 60, height: 18 },
  ]);
});
test('a full-width progress item owns a separate row, including following content', () => {
  const result = layoutHudFlow([{ id: 'contract', width: 80, height: 20 }, { id: 'progress', width: 100, height: 18, full: true }, { id: 'notice', width: 30, height: 16 }], 160);
  expect(result.nodes.map(node => [node.id, node.bounds.x, node.bounds.y, node.bounds.width])).toEqual([
    ['contract', 40, 0, 80], ['progress', 0, 22, 160], ['notice', 65, 42, 30],
  ]);
});
test('scoreboard columns preserve fixed counters and give remaining space to identity', () => {
  expect(layoutHudColumns([{ id: 'figure', width: 26 }, { id: 'identity', width: 'fill' }, { id: 'hand', width: 40 }, { id: 'total', width: 40 }], 236)).toEqual([
    { id: 'figure', x: 0, width: 26 }, { id: 'identity', x: 34, width: 106 }, { id: 'hand', x: 148, width: 40 }, { id: 'total', x: 196, width: 40 },
  ]);
});
test('empty HUDs and small available widths keep finite geometry', () => {
  expect(layoutHudFlow([], 0)).toEqual({ nodes: [], height: 0 });
  expect(layoutHudColumns([{ id: 'identity', width: 'fill' }], -10)[0].width).toBe(0);
  expect(layoutHudFlow([{ id: 'long-name', width: 250, height: 36 }], 80).nodes[0].bounds.width).toBe(80);
});
test('sidebar panels stack measured heights without losing their identity', () => {
  expect(layoutHudStack([{ id: 'status', width: 100, height: 120 }, { id: 'scores', width: 100, height: 180 }], 260)).toEqual({ height: 308, nodes: [
    { id: 'status', bounds: { x: 0, y: 0, width: 260, height: 120 } }, { id: 'scores', bounds: { x: 0, y: 128, width: 260, height: 180 } },
  ] });
});
test('result layout aligns the personal result across title and description rows', () => {
  const result = layoutHudResult(280, { title: {width:180,height:22}, description: {width:180,height:15}, value: {width:72,height:17}, award: {width:200,height:16} });
  expect(result.leftWidth).toBe(200);
  expect(result.height).toBe(57);
  expect(result.nodes.find(node => node.id === 'value')?.bounds).toEqual({x:208,y:11,width:72,height:17});
  expect(result.nodes.find(node => node.id === 'award')?.bounds.y).toBe(41);
});
test('short landscape does not force the progress meter into a new row', () => {
  expect(statusHudPolicy(390,844)).toEqual({progressFull:true,gapX:14});
  expect(statusHudPolicy(568,320)).toEqual({progressFull:false,gapX:8});
});
test('short landscape retains result-summary spacing and secondary-action offset', () => {
  expect(resultHudPolicy(568,320)).toEqual({summaryGap:6,secondaryOffset:6});
  expect(resultHudPolicy(390,844)).toEqual({summaryGap:8,secondaryOffset:0});
});

test('scoreboard counters retain their anchors while the figure reserves halo space',()=>{
  const columns=layoutHudColumns(SCOREBOARD_COLUMNS,236);
  expect(columns.find(column=>column.id==='hand')).toEqual({id:'hand',x:148,width:40});
  expect(columns.find(column=>column.id==='total')).toEqual({id:'total',x:196,width:40});
  const figure=columns.find(column=>column.id==='figure')!;
  expect(SCOREBOARD_FIGURE.offsetX+SCOREBOARD_FIGURE.artWidth/2-14).toBeGreaterThanOrEqual(0);
  expect(SCOREBOARD_FIGURE.offsetX+SCOREBOARD_FIGURE.artWidth/2+14).toBeLessThanOrEqual(figure.width);
});
