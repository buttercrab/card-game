import { expect, test } from 'vitest';
import { calculateArenaOverlays, calculateTableLayout } from './layout';

test('large arena review keeps readable width and the original seat bands', () => {
  const viewport = {width:1440,height:900};
  const layout = calculateTableLayout({viewport,region:{width:900,height:600},seatCount:5,watching:false});
  const overlays = calculateArenaOverlays(viewport,layout,80);
  expect(overlays.review.width).toBe(410);
  expect(overlays.review.x).toBe(200);
  expect(overlays.review.y).toBe(Math.max(layout.centerY-150,layout.seatHeight+24));
  expect(overlays.review.y+overlays.review.height).toBe(448);
  expect(overlays.admission).toEqual({x:(layout.ring.width-280)/2,y:layout.centerY-40,width:280,height:80});
});
test('compact and short-landscape review use distinct retained margins', () => {
  const viewport = {width:390,height:844};
  const compact = calculateTableLayout({viewport,region:{width:358,height:200},seatCount:5,watching:false});
  expect(calculateArenaOverlays(viewport,compact).review).toEqual({x:10,y:84,width:338,height:112});
  const shortViewport = {width:568,height:320};
  const short = calculateTableLayout({viewport:shortViewport,region:{width:288,height:112},seatCount:5,watching:false});
  const overlays = calculateArenaOverlays(shortViewport,short,44);
  expect(overlays.review).toEqual({x:8,y:76,width:272,height:32});
  expect(overlays.admission).toEqual({x:0,y:68,width:288,height:44});
});
