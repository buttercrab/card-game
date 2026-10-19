import {describe,expect,test} from 'vitest';
import {leadTagLayout,thrownInLayout} from './overlayLayout';
describe('numeric playing overlays',()=>{
 test('joker lead badge follows the actual card and native suits',()=>{
  const badge=leadTagLayout({width:40,height:56},{width:25,height:12},true);
  expect(badge).toMatchObject({x:2,y:46,width:36,height:20,contentX:5.5,contentY:4});
  const short=leadTagLayout({width:32,height:44.8},{width:25,height:12},true,true);
  expect(short.width).toBe(32);
  expect(short.y).toBeCloseTo(10.8);
 });
 test('misdeal retains all ten cards in two overlapping chronological rows',()=>{
  const panel=thrownInLayout({width:390,height:844},{width:358,height:492},10);
  expect(panel.cards).toHaveLength(10);
  expect(panel.cards.filter(card=>card.row===0)).toHaveLength(5);
  expect(panel.cards[1].x-panel.cards[0].x).toBeCloseTo(panel.cardWidth*.58);
  expect(panel.cards[5].y-panel.cards[0].y).toBeCloseTo(panel.cardHeight+4);
  expect(panel.cards[4].overlapped).toBe(false);
  expect(panel.x+panel.width/2).toBe(179);
 });
 test('misdeal panel stays bounded on a narrow ring and preserves close target',()=>{
  const panel=thrownInLayout({width:320,height:568},{width:160,height:240},10);
  expect(panel.width).toBeLessThanOrEqual(160);
  expect(panel.closeSize).toBe(44);
  for(const card of panel.cards){expect(card.x).toBeGreaterThanOrEqual(0);expect(card.x+card.width).toBeLessThanOrEqual(panel.width);}
 });
});
