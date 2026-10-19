import { calculateFrameLayout } from './frameLayout';
import { calculateSeatIdentity } from './seatIdentityLayout';
import { describe, expect, test } from 'vitest';
import { calculateTableLayout, calculateOwnDock, cardRowAnchor, type SeatCount } from './layout';

describe('table geometry', () => {
  test('preserves five-seat desktop proportions and mirrored card bands', () => {
    const layout = calculateTableLayout({viewport:{width:1440,height:900},region:{width:1000,height:500},seatCount:5,watching:false});
    expect(layout.ring).toEqual({x:162.5,y:0,width:675,height:500});
    expect(layout.seatWidth).toBe(160);
    expect(layout.centerY).toBe(288);
    expect(layout.seats[1]).toEqual({x:675,y:238,originX:1,originY:0});
    expect(layout.seats[4]).toEqual({x:0,y:238,originX:0,originY:0});
    expect(layout.cards[1].x + layout.cards[4].x).toBe(675);
    expect(layout.cards[2].x + layout.cards[3].x).toBe(675);
    expect(layout.cards[2].y).toBe(layout.cards[3].y);
  });
  test.each([3,5,6] as SeatCount[])('supports %i seats with stable independent anchors', seatCount => {
    const input = {viewport:{width:390,height:844},region:{width:358,height:380},seatCount,watching:true};
    const before = calculateTableLayout(input);
    expect(before.seats).toHaveLength(seatCount);
    expect(before.cards).toHaveLength(seatCount);
    for (const seat of before.seats) {
      expect(Number.isFinite(seat.x)).toBe(true);
      expect(Number.isFinite(seat.y)).toBe(true);
    }
    // Phase/turn information is deliberately outside this input contract.
    expect(calculateTableLayout({...input})).toEqual(before);
    expect(new Set(before.seats.map(seat => `${seat.x}:${seat.y}`)).size).toBe(seatCount);
  });
  test('short regions establish one opponent row before gameplay', () => {
    const layout = calculateTableLayout({viewport:{width:390,height:844},region:{width:358,height:250},seatCount:5,watching:false});
    expect(layout.mode).toBe('compact');
    expect(layout.ring.width).toBe(358);
    expect(layout.seats.slice(1).map(seat => seat.x)).toEqual([313.25,223.75,134.25,44.75]);
    expect(layout.seats.slice(1).every(seat => seat.y === 0)).toBe(true);
  });
  test('five-seat side positions do not depend on transient rendered identity height', () => {
    const layout = calculateTableLayout({viewport:{width:1440,height:900},region:{width:1000,height:500},seatCount:5,watching:false});
    for (const relative of [1,4]) {
      const position = layout.seats[relative];
      const renderedTop = (renderedHeight: number) => position.y - position.originY * renderedHeight;
      expect(renderedTop(88)).toBe(renderedTop(108));
      expect(renderedTop(108)).toBe(layout.centerY - layout.seatHeight / 2);
    }
  });
  test.each([3,6] as SeatCount[])('compact %i-seat watcher footprints stay separated', seatCount => {
    const layout = calculateTableLayout({viewport:{width:390,height:844},region:{width:358,height:180},seatCount,watching:true});
    const rectangles = layout.seats.map(position => ({
      left:position.x - position.originX * layout.seatWidth,
      top:position.y - position.originY * layout.seatHeight,
    }));
    for (let i=0; i<rectangles.length; i++) {
      const a = rectangles[i];
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.left + layout.seatWidth).toBeLessThanOrEqual(layout.ring.width);
      expect(a.top + layout.seatHeight).toBeLessThanOrEqual(layout.ring.height);
      for (const b of rectangles.slice(i+1)) {
        expect(a.left + layout.seatWidth <= b.left || b.left + layout.seatWidth <= a.left || a.top + layout.seatHeight <= b.top || b.top + layout.seatHeight <= a.top).toBe(true);
      }
    }
  });
  test('landscape card row retains spacing and played order', () => {
    expect(cardRowAnchor(500, 0, 3).x).toBe(448);
    expect(cardRowAnchor(500, 1, 3).x).toBe(484);
    expect(cardRowAnchor(500, 2, 3).x).toBe(520);
  });
  test.each([3,6] as SeatCount[])('%i-seat cards fit their arena without touching identities or other cards', seatCount => {
    for (const [viewport,region] of [
      [{width:1440,height:900},{width:900,height:500}],
      [{width:768,height:1024},{width:736,height:600}],
      [{width:390,height:844},{width:358,height:380}],
      [{width:320,height:568},{width:288,height:180}],
    ]) {
      const layout = calculateTableLayout({viewport,region,seatCount,watching:true});
      const rect = (position: {x:number;y:number;originX:number;originY:number}, width:number, height:number) => ({left:position.x-position.originX*width,top:position.y-position.originY*height,width,height});
      const seats = layout.seats.map(position => rect(position,layout.seatWidth,layout.seatHeight));
      const cards = layout.cards.map(position => rect(position,layout.cardWidth,layout.cardHeight));
      const overlaps = (a:typeof cards[number],b:typeof cards[number]) => a.left < b.left+b.width && a.left+a.width > b.left && a.top < b.top+b.height && a.top+a.height > b.top;
      expect(layout.cardWidth).toBeGreaterThan(0);
      for (let i=0;i<cards.length;i++) {
        const card = cards[i];
        expect(card.left).toBeGreaterThanOrEqual(0);
        expect(card.top).toBeGreaterThanOrEqual(0);
        expect(card.left+card.width).toBeLessThanOrEqual(layout.ring.width);
        expect(card.top+card.height).toBeLessThanOrEqual(layout.ring.height);
        expect(seats.some(seat => overlaps(card,seat))).toBe(false);
        expect(cards.slice(i+1).some(other => overlaps(card,other))).toBe(false);
      }
    }
  });
});

describe('own identity dock', () => {
  test('desktop only shifts own dock for the explicit centered state', () => {
    const input = {viewport:{width:1440,height:900},region:{width:1000,height:180}};
    expect(calculateOwnDock({...input,centered:true})).toEqual({x:500,y:90,originX:.5,originY:.5,width:170});
    expect(calculateOwnDock({...input,centered:false})).toEqual({x:95,y:93,originX:.5,originY:.5,width:170});
  });
  test.each([568,800])('normal waiting identity stays clear of real empty-seat action boxes at %ipx landscape',width=>{
    const viewport={width,height:320},screen=calculateFrameLayout({viewport,region:{width:width-32,height:208}});
    const arena=calculateTableLayout({viewport,region:screen.regions.felt,seatCount:5,watching:false});
    const own=calculateOwnDock({viewport,region:screen.regions.tray,centered:true});
    const identity=calculateSeatIdentity({viewport,region:screen.regions.tray,width:own.width,local:true,waiting:true,hasMeta:false,nameWidth:16});
    const ownLeft=own.x-own.width/2+identity.identity.x, ownTop=screen.regions.tray.y+own.y-identity.height/2+identity.identity.y;
    const ownBox={x:ownLeft,y:ownTop,width:identity.identity.width,height:identity.identity.height};
    expect(identity.figure.width).toBe(64);
    for(const anchor of arena.seats.slice(1)){
      const empty=calculateSeatIdentity({viewport,region:screen.regions.felt,width:arena.seatWidth,compact:true,empty:true,nameWidth:40,actionsHeight:56});
      const box={x:anchor.x-arena.seatWidth*anchor.originX+empty.actions.x,y:screen.regions.felt.y+anchor.y+empty.actions.y,width:empty.actions.width,height:56};
      expect(ownBox.x<box.x+box.width&&ownBox.x+ownBox.width>box.x&&ownBox.y<box.y+box.height&&ownBox.y+ownBox.height>box.y).toBe(false);
    }
    expect(own.x).toBe(screen.regions.strip.x+screen.regions.strip.width/2);
  });
  test('waiting identity centers in the dock while play retains its reserved row', () => {
    const input = {viewport:{width:390,height:844},region:{width:358,height:180}};
    expect(calculateOwnDock({...input,centered:true})).toEqual({x:179,y:90,originX:.5,originY:.5,width:170});
    expect(calculateOwnDock({...input,centered:false})).toEqual({x:179,y:4,originX:.5,originY:0,width:342});
    const landscape={viewport:{width:568,height:320},region:{width:536,height:84}};
    expect(calculateOwnDock({...landscape,centered:true}).x).toBe(416);
    expect(calculateOwnDock({...landscape,centered:false}).x).toBe(50);
    expect(calculateOwnDock({...landscape,centered:false})).toMatchObject({y:2,originY:0});
  });
});
