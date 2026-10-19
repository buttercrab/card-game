import { describe, expect, it } from 'vitest';
import { calculateDockLayout, calculateDockRegions, calculateLocalIdentityLayout } from './dockLayout';
import { calculateFrameLayout } from './frameLayout';
import { calculateSeatIdentity } from './seatIdentityLayout';
import { calculateDockCoordinates } from './sceneCoordinates';

describe('numeric dock hand reservation', () => {
  it.each([[320,568],[390,844],[768,1024],[898,700],[900,900]])('contains the complete playing identity before the hand at %ix%i',(width,height)=>{
    const viewport={width,height};
    const frame=calculateFrameLayout({viewport,region:{width:width-32,height:height-80}});
    const region=frame.regions.tray;
    const seat=calculateSeatIdentity({viewport,region,width:region.width-16,local:true});
    const dock=calculateDockCoordinates({viewport,region,centered:false,player:{id:'local',height:seat.height}});
    const layout=calculateDockLayout({viewport,region,handHeight:98,identityHeight:seat.height});
    expect(dock.node.bounds.y).toBe(region.y+4);
    expect(dock.node.bounds.y+seat.height).toBeLessThanOrEqual(region.y+layout.handArea.y);
    expect(frame.dockHeight).toBeGreaterThanOrEqual(width>=600?221:184);
  });
  it.each([
    { viewport:{width:390,height:844}, region:{width:358,height:210}, handHeight:98, profile:'portrait', area:{x:8,y:68,width:342,height:138}, handY:88 },
    { viewport:{width:360,height:740}, region:{width:328,height:210}, handHeight:98, profile:'portrait', area:{x:3,y:68,width:322,height:138}, handY:88 },
    { viewport:{width:390,height:620}, region:{width:358,height:168}, handHeight:92, profile:'short-portrait', area:{x:3,y:64,width:352,height:100}, handY:68 },
    { viewport:{width:599,height:620}, region:{width:567,height:168}, handHeight:92, profile:'short-portrait', area:{x:3,y:64,width:561,height:100}, handY:68 },
    { viewport:{width:600,height:620}, region:{width:568,height:168}, handHeight:98, profile:'portrait', area:{x:8,y:68,width:552,height:96}, handY:67 },
    { viewport:{width:1440,height:900}, region:{width:1000,height:210}, handHeight:165, profile:'desktop', area:{x:192,y:14,width:616,height:188}, handY:25.5 },
    { viewport:{width:1024,height:640}, region:{width:700,height:210}, handHeight:122, profile:'desktop', area:{x:192,y:14,width:316,height:188}, handY:47 },
    { viewport:{width:1024,height:639}, region:{width:700,height:210}, handHeight:122, profile:'portrait', area:{x:8,y:68,width:684,height:138}, handY:76 },
    { viewport:{width:844,height:390}, region:{width:800,height:98}, handHeight:78, profile:'landscape', area:{x:100,y:0,width:600,height:94}, handY:8 },
    { viewport:{width:1100,height:520}, region:{width:1000,height:98}, handHeight:78, profile:'landscape', area:{x:100,y:0,width:800,height:94}, handY:8 },
  ])('preserves native reservations for $viewport.width × $viewport.height', ({viewport,region,handHeight,profile,area,handY})=>{
    const layout=calculateDockLayout({viewport,region,handHeight});
    expect(layout.profile).toBe(profile);expect(layout.handArea).toEqual(area);
    expect(layout.hand).toEqual({x:area.x,y:handY,width:area.width,height:handHeight});
  });
  it('centers an oversized intrinsic hand without changing its size',()=>{
    const layout=calculateDockLayout({viewport:{width:390,height:844},region:{width:358,height:168},handHeight:200});
    expect(layout.hand).toEqual({x:8,y:16,width:342,height:200});
  });
  it('keeps narrow or unmeasured reservations finite and nonnegative in size',()=>{
    const layout=calculateDockLayout({viewport:{width:1440,height:900},region:{width:100,height:0},handHeight:0});
    expect(layout.handArea).toEqual({x:192,y:14,width:0,height:0});expect(layout.hand).toEqual(layout.handArea);
  });
  it.each([NaN,Infinity,-1])('rejects invalid dimensions %s',value=>{
    const input={viewport:{width:390,height:844},region:{width:358,height:210},handHeight:98};
    expect(()=>calculateDockLayout({...input,handHeight:value})).toThrow(RangeError);
    expect(()=>calculateDockLayout({...input,region:{...input.region,width:value}})).toThrow(RangeError);
    expect(()=>calculateDockLayout({...input,viewport:{...input.viewport,height:value}})).toThrow(RangeError);
  });
});

describe('readable local identity policy',()=>{
 it.each([{viewport:{width:320,height:568},figure:56},{viewport:{width:390,height:844},figure:56},{viewport:{width:768,height:1024},figure:64}])('uses readable playing art with a natural name pill at $viewport.width',({viewport,figure})=>{
  const identity=calculateLocalIdentityLayout({viewport,width:300,nameWidth:32});
  expect(identity.mode).toBe('horizontal');expect(identity.figureSize).toBe(figure);expect(identity.nameSize).toBe(16);
  expect(identity.meta.x).toBe(figure-4);expect(identity.meta.width).toBe(72);expect(identity.name.width).toBe(48);
  expect(identity.meta.y+identity.meta.height+2).toBe(identity.name.y);
  expect(identity.name.y+identity.name.height-identity.meta.y).toBe(44);
  expect(identity.width).toBe(figure-4+72);
 });
 it.each([{viewport:{width:390,height:844},figure:64},{viewport:{width:768,height:1024},figure:64},{viewport:{width:1440,height:900},figure:72},{viewport:{width:568,height:320},figure:64}])('waiting identity is vertical and its hover footprint is narrow at $viewport.width',({viewport,figure})=>{
  const identity=calculateLocalIdentityLayout({viewport,width:170,nameWidth:32,waiting:true,hasMeta:false});
  expect(identity.mode).toBe('vertical');expect(identity.figureSize).toBe(figure);
  expect(identity.width).toBe(figure);expect(identity.name.width).toBe(48);expect(identity.meta.height).toBe(0);
  expect(identity.name.y).toBeCloseTo(figure*110/120+2);
 });
 it('playing desktop reserves metadata and renders a 72px figure',()=>{
  const identity=calculateLocalIdentityLayout({viewport:{width:1440,height:900},width:170,nameWidth:32,hasMeta:false});
  expect(identity.figureSize).toBe(72);expect(identity.name.width).toBe(48);expect(identity.meta.height).toBe(20);
 });
 it('fits landscape within the existing 84px dock',()=>{
  const identity=calculateLocalIdentityLayout({viewport:{width:568,height:320},width:92,nameWidth:32});
  expect(identity.figureSize).toBe(40);expect(identity.height+24+2+4).toBe(84);expect(identity.name.width).toBe(48);
 });
 it('name measurement cap is independent of the currently short pill',()=>{
  const input={viewport:{width:390,height:844},width:342};
  const short=calculateLocalIdentityLayout({...input,nameWidth:16});
  const long=calculateLocalIdentityLayout({...input,nameWidth:1000});
  expect(long.nameTextMax).toBe(short.nameTextMax);expect(long.nameTextMax).toBe(140);
  expect(long.name.width).toBe(156);expect(long.width).toBe(208);
 });
 it.each([NaN,Infinity,-1])('rejects invalid identity width %s',width=>{
  expect(()=>calculateLocalIdentityLayout({viewport:{width:390,height:844},width})).toThrow(RangeError);
 });
});

it.each([[390,844],[1280,720],[844,390]])('derived dock columns share the original numeric owner at %s×%s',(width,height)=>{const input={viewport:{width,height},region:{width:width-32,height:240},handHeight:124,identityHeight:180},full=calculateDockRegions(input),{identity,tools,minimumHeight,...legacy}=full;expect(legacy).toEqual(calculateDockLayout(input));expect(minimumHeight).toBeGreaterThanOrEqual(124);if(full.profile==='desktop'||full.profile==='landscape'){expect(identity.x+identity.width).toBeLessThanOrEqual(full.handArea.x);expect(full.handArea.x+full.handArea.width).toBeLessThanOrEqual(tools.x);}expect(Object.keys(calculateDockLayout(input))).toEqual(['profile','handArea','hand','countdown']);});
