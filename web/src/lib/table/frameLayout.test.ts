import { describe, expect, test } from 'vitest';
import { calculateMeasuredFrameLayout, calculateFrameLayout, frameStyle } from './frameLayout';
const make = (width:number,height:number,state={}) => calculateFrameLayout({viewport:{width,height},region:{width:width-32,height:height-80},...state});
describe('whole playing screen geometry', () => {
  test('tall screens leave room for command paint gutters while compact screens retain a scroll cap',()=>{
    expect(make(768,1024,{controls:true}).decisionCap).toBe(160);
    expect(make(390,844,{controls:true}).decisionCap).toBe(160);
    expect(make(320,568,{controls:true}).decisionCap).toBe(128);
    const layout=make(390,844,{controls:true});
    expect(layout.regions.tray.y-layout.regions.strip.y-layout.regions.strip.height).toBe(12);
  });
  test('preserves stacked portrait tracks and desktop sidebar budgets', () => {
    const phone=make(390,844);
    expect(phone.regions.status).toEqual({x:0,y:0,width:358,height:48,visible:true});
    expect(phone.regions.event.y).toBe(52);
    expect(phone.regions.felt).toEqual({x:0,y:74,width:358,height:474,visible:true});
    expect(phone.regions.strip.y).toBe(552);
    expect(phone.regions.tray.y).toBe(572);
    const desktop=make(1440,900);
    expect(desktop.mode).toBe('sidebar');
    expect(desktop.regions.side).toEqual({x:1108,y:0,width:300,height:820,visible:true});
    expect(desktop.regions.felt.y).toBe(4);
    expect(desktop.dockHeight).toBeCloseTo(187.2);
    expect(desktop.regions.status.visible).toBe(false);
  });
  test('short landscape reserves a decision column and one full-width dock', () => {
    const layout=make(568,320);
    expect(layout.mode).toBe('short');
    expect(layout.regions.strip.width).toBe(240);
    expect(layout.regions.felt.width).toBe(288);
    expect(layout.regions.felt.height).toBe(112);
    expect(layout.regions.tray).toEqual({x:0,y:156,width:536,height:84,visible:true});
    expect(layout.decisionCap).toBeNull();
    expect(frameStyle(layout)).toContain('--decision-cap:none');
    expect(layout.stripPaddingTop).toBe(56);
    expect(make(568,320,{controls:true}).stripPaddingTop).toBe(0);
  });
  test.each([[320,568],[390,844],[568,320],[768,1024],[1024,768],[1440,900]])('phase changes retain the arena at %i × %i', (width,height) => {
    const baseline=make(width,height);
    for (const state of [{controls:true,controlsHeight:128},{completed:true,resultHeight:140},{between:true},{}]) {
      const layout=make(width,height,state);
      expect(layout.regions.felt).toEqual(baseline.regions.felt);
      expect(layout.regions.tray).toEqual(baseline.regions.tray);
      for (const bounds of Object.values(layout.regions)) {
        expect(bounds.width).toBeGreaterThanOrEqual(0);
        expect(bounds.height).toBeGreaterThanOrEqual(0);
      }
    }
  });
  test('tools follow measured controls, result and viewport policies', () => {
    const tools={width:96,height:44};
    const play=make(390,844,{tools});
    expect(play.regions.tools).toMatchObject({x:258,y:500,visible:true});
    const bidding=make(390,844,{tools,controls:true,controlsHeight:140});
    expect(bidding.regions.tools).toMatchObject({x:262,y:2,visible:true});
    expect(bidding.statusPaddingEnd).toBe(100);
    const desktop=make(1440,900,{tools,controls:true,controlsHeight:140});
    expect(desktop.regions.tools.visible).toBe(true);
    expect(desktop.toolsLayer).toBe('dock');
  });
  test('results use measured sheet height without moving player regions', () => {
    const phone=make(390,844,{completed:true,resultHeight:150});
    expect(phone.resultDock).toBe(false);
    expect(frameStyle(phone)).toContain('--frame-result-display:block');
    expect(phone.regions.result).toMatchObject({x:12,y:404,width:334,height:150});
    const desktop=make(1440,900,{completed:true,resultHeight:150});
    expect(desktop.regions.result.width).toBe(400);
    expect(desktop.regions.result.x).toBe((desktop.regions.felt.width-400)/2);
    const compact=make(320,568,{completed:true,resultHeight:110});
    expect(compact.resultDock).toBe(true);
    expect(compact.regions.result.y).toBe(compact.regions.tray.y+44);
    const landscape=make(568,320,{completed:true,resultHeight:100});
    expect(landscape.regions.result.y+100).toBe(landscape.regions.strip.y+landscape.regions.strip.height);
  });
});

test.each([[1280,800],[390,844],[844,390]])('measured frame bridge retains original defaults at %s×%s',(width,height)=>{
 const input={viewport:{width,height},region:{width:width-32,height:height-80},controls:true,controlsHeight:120,tools:{width:112,height:56}};
 expect(calculateMeasuredFrameLayout(input)).toEqual(calculateFrameLayout(input));
 const base=calculateFrameLayout(input),measured=calculateMeasuredFrameLayout(input,{mainWidth:width-80,statusHeight:24,eventHeight:0,dockHeight:base.dockHeight+40});expect(measured.regions.tray.height).toBe(base.dockHeight+40);expect(measured.regions.tray.width).toBe(width>height&&height<=520?width-32:width-80);expect(measured.regions.status.height).toBe(24);expect(measured.regions.felt.height).toBeGreaterThanOrEqual(0);
 const idle=calculateMeasuredFrameLayout({...input,controls:false}, {mainWidth:width-80,dockHeight:base.dockHeight+40});expect(idle.regions.felt).toEqual(calculateMeasuredFrameLayout(input,{mainWidth:width-80,dockHeight:base.dockHeight+40}).regions.felt);
});
test('measured frame bridge rejects invalid native extents',()=>{const input={viewport:{width:1280,height:800},region:{width:1248,height:700}};for(const measured of [{dockHeight:NaN},{statusHeight:-1},{eventHeight:Infinity},{mainWidth:1300}])expect(()=>calculateMeasuredFrameLayout(input,measured)).toThrow();});
