import { describe, expect, test } from 'vitest';
import { calculateHandLayout } from './handLayout';

const phone = (regionWidth: number, count = 14, viewportHeight = 667) => calculateHandLayout({
  regionWidth, count, viewportWidth: 375, viewportHeight,
});

describe('readable exchange fan', () => {
  test('shrinks a fourteen-card hand to one readable row before splitting', () => {
    const layout = phone(300);
    expect(layout.cardWidth).toBe(60);
    expect(layout.drawWidth).toBe(59);
    expect(layout.rows).toEqual([{ start: 0, end: 14, step: 241 / 13 }]);
    expect(layout.rowHeight).toBe(84);
    expect(layout.rows[0].step).toBeGreaterThanOrEqual(layout.drawWidth * .31);
  });

  test('the 56px readability floor separates one-row and two-row exchange hands', () => {
    const fitting = phone(282);
    expect(fitting.drawWidth).toBe(56);
    expect(fitting.rows).toHaveLength(1);
    const tooNarrow = phone(281);
    expect(tooNarrow.drawWidth).toBe(60);
    expect(tooNarrow.rows.map(({ start, end }) => [start, end])).toEqual([[0, 7], [7, 14]]);
    expect(tooNarrow.rowHeight).toBe(fitting.rowHeight);
  });

  test('short portrait uses fractional corner width and keeps fourteen cards in one row', () => {
    const layout = phone(300, 14, 568);
    expect(layout.cardWidth).toBe(56);
    expect(layout.drawWidth).toBe(56);
    expect(layout.rows).toHaveLength(1);
    expect(layout.rows[0].step).toBe(244 / 13);
  });

  test('odd hands split without duplicating or omitting an index', () => {
    const layout = phone(200, 13);
    expect(layout.rows.map(({ start, end }) => [start, end])).toEqual([[0, 7], [7, 13]]);
    expect(layout.rows.map(row => row.step)).toEqual([140 / 6, 140 / 5]);
  });
});

describe('viewport card sizes and region overlap', () => {
  test('a landscape phone retains compact cards and never uses portrait shrinking', () => {
    const layout = calculateHandLayout({ regionWidth: 280, viewportWidth: 844, viewportHeight: 390, count: 14 });
    expect(layout.cardWidth).toBe(46);
    expect(layout.drawWidth).toBe(46);
    expect(layout.rows).toHaveLength(2);
    expect(layout.rowHeight).toBe(64);
  });

  test('desktop fans fit sidebar-constrained regions before splitting', () => {
    for (const [viewportHeight, cardWidth] of [[640, 88], [900, 108], [1200, 124]]) {
      const layout = calculateHandLayout({ regionWidth: 500, viewportWidth: 1440, viewportHeight, count: 14 });
      expect(layout.cardWidth).toBe(cardWidth);
      expect(layout.drawWidth).toBeLessThanOrEqual(cardWidth);
      expect(layout.drawWidth).toBeGreaterThanOrEqual(56);
      expect(layout.rows).toHaveLength(1);
      expect(layout.rows[0].step).toBeGreaterThanOrEqual(layout.drawWidth * .31);
    }
    const constrained = calculateHandLayout({regionWidth: 380, viewportWidth: 1147, viewportHeight: 1076, count: 10});
    expect(constrained.rows).toHaveLength(1);
    expect(constrained.drawWidth + 9 * constrained.rows[0].step).toBeLessThanOrEqual(380);
  });

  test('ten-card phone hands grow while each corner retains at least 26px', () => {
    const layout = phone(358, 10, 844);
    expect(layout.drawWidth).toBe(69);
    expect(layout.rows).toHaveLength(1);
    expect(layout.rows[0].step).toBeGreaterThanOrEqual(26);
  });

  test('empty and one-card hands reserve the same height and unmeasured regions stay one row', () => {
    for (const count of [0, 1, 14]) {
      const layout = phone(0, count);
      expect(layout.rows).toEqual([{ start: 0, end: count, step: 66 }]);
      expect(layout.rowHeight).toBe(84);
    }
    expect(phone(358, 1).rows).toEqual([{ start: 0, end: 1, step: 75 }]);
  });
});

describe('canonical materialization and one-row metrics',()=>{
 test('normal phone and short allocated hands fit all13 cards with the original readable fan',async()=>{const {calculateReadableHandLayout}=await import('./handLayout');for(const input of [{regionWidth:342,viewportWidth:390,viewportHeight:844},{regionWidth:380,viewportWidth:844,viewportHeight:390}]){const plan=calculateReadableHandLayout({...input,count:13,selectionLift:14,padding:6,scrollbarHeight:15});expect(plan.rows).toHaveLength(1);expect(plan.scroll).toBe(false);expect(plan.cards).toHaveLength(13);expect(plan.cards.every(card=>card.x>=0&&card.x+card.width<=input.regionWidth+1e-9&&card.y>=0&&card.y+card.height<=plan.bodyHeight)).toBe(true);expect(plan.rows[0].step).toBeGreaterThanOrEqual(plan.minimumStep);}});
 test('empty/one/full one-row reservations share the same count-independent owner',async()=>{const {calculateReadableHandLayout,calculateHandRowMetrics}=await import('./handLayout'),input={regionWidth:342,viewportWidth:390,viewportHeight:844,selectionLift:14,padding:6,scrollbarHeight:15},metrics=calculateHandRowMetrics(input);for(const count of [0,1,10,13]){const plan=calculateReadableHandLayout({...input,count});expect(plan.height).toBe(metrics.oneRowHeight);expect(plan.cardWidth).toBe(metrics.cardWidth);expect(plan.rowHeight).toBe(metrics.rowHeight);}expect(calculateReadableHandLayout({...input,count:0}).cards).toEqual([]);});
 test('two readable rows remain real rows, while105 cards use declared readable scrolling',async()=>{const {calculateReadableHandLayout}=await import('./handLayout'),base={viewportWidth:375,viewportHeight:667,selectionLift:14,padding:6,scrollbarHeight:15},two=calculateReadableHandLayout({...base,regionWidth:200,count:13});expect(two.rows).toHaveLength(2);expect(two.scroll).toBe(false);expect(two.cards.map(card=>card.index)).toEqual(Array.from({length:13},(_,i)=>i));expect(two.rows[1].y).toBeGreaterThanOrEqual(two.rows[0].y+two.rows[0].height);const many=calculateReadableHandLayout({...base,regionWidth:342,count:105});expect(many.kind).toBe('horizontal-scroll');expect(many.rows).toHaveLength(1);expect(many.rows[0].step).toBeGreaterThanOrEqual(many.minimumStep);expect(many.contentWidth).toBeGreaterThan(342);expect(many.height).toBe(many.metrics.oneRowHeight);});
});
