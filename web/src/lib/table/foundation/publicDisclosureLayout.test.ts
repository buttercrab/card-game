import {expect,test} from 'vitest';
import type {PlannedNode} from './contracts';
import {choosePublicDisclosurePlacement as place} from './publicDisclosureLayout';
function node(id:string,box:PlannedNode['box'],extra:Partial<PlannedNode>={}):PlannedNode{return{id,parent:null,kind:'group',label:id,box,...extra};}
const header=node('room-header',{x:0,y:0,width:390,height:70});
const stock=node('stock',{x:160,y:300,width:64,height:90},{kind:'card',stockCount:3,visual:{kind:'back'}});
const dock=node('dock',{x:0,y:620,width:390,height:200});
test('phone arena places public content below measured header and safely above stock without moving nodes',()=>{
 const nodes=[header,stock,dock],before=JSON.stringify(nodes),result=place(nodes,390,844,120);expect(result).toEqual({x:16,y:82,width:358,height:120});expect(JSON.stringify(nodes)).toBe(before);expect(Object.isFrozen(result)).toBe(true);expect(Object.keys(result!)).toEqual(['x','y','width','height']);
});
test('protected enabled native/header targets reject the first lane and fall below stock',()=>{
 for(const kind of ['command','select','editor','choice','toggle','range'] as const){const target=node('native',{x:20,y:88,width:150,height:70},{kind,enabled:true});expect(place([header,stock,dock,target],390,844,120)?.y).toBe(402);}
});
test('six-pixel target envelope is respected even when overlay misses its raw native box',()=>{
 const target=node('native',{x:20,y:205,width:150,height:44},{kind:'command',enabled:true});expect(place([header,stock,dock,target],390,844,120)?.y).toBe(402);
 const disabled={...target,enabled:false};expect(place([header,stock,dock,disabled],390,844,120)?.y).toBe(82);
});
test('local ancestry resolves header, stock and controls to viewport coordinates',()=>{
 const root=node('table',{x:0,y:10,width:390,height:834}),h={...header,parent:'table'},s={...stock,parent:'table'},d={...dock,parent:'table'};expect(place([root,h,s,d],390,844,120)?.y).toBe(92);
});
test('noninteractive opponent decoration may be overlaid while stock/back art remains protected',()=>{
 const decoration=node('opponent',{x:20,y:90,width:200,height:140},{kind:'figure'});expect(place([header,stock,dock,decoration],390,844,120)?.y).toBe(82);
 const back={...decoration,kind:'card' as const,stockCount:10,visual:{kind:'back' as const}};expect(place([header,stock,dock,back],390,844,120)?.y).toBe(402);
});
test('uses the lane above the dock when header and stock lanes are occupied',()=>{
 const guard=node('large-control',{x:0,y:75,width:390,height:360},{kind:'command',enabled:true});expect(place([header,stock,dock,guard],390,844,120)?.y).toBe(488);
});
test('no protected-space fit or a viewport modal returns null without changing authority',()=>{
 const guard=node('all-controls',{x:0,y:70,width:390,height:774},{kind:'select',enabled:true});expect(place([header,stock,dock,guard],390,844,120)).toBeNull();
 const modal=node('modal',{x:0,y:0,width:390,height:844},{semanticRole:'dialog'});expect(place([header,stock,dock,modal],390,844,120)).toBeNull();
});
test('malformed dimensions, missing ancestry, duplicate IDs, cycles and oversized inputs fail closed',()=>{
 for(const dimensions of [[NaN,844,120],[390,0,120],[30,844,120],[390,844,-1],[390,844,900]])expect(place([header],...dimensions as [number,number,number])).toBeNull();
 expect(place([{...header,parent:'missing'}],390,844,120)).toBeNull();expect(place([header,header],390,844,120)).toBeNull();expect(place([{...header,parent:'room-header'}],390,844,120)).toBeNull();
 expect(place([node('a',{x:0,y:0,width:10,height:10},{parent:'b'}),node('b',{x:0,y:0,width:10,height:10},{parent:'a'})],390,844,120)).toBeNull();expect(place(Array.from({length:4097},(_,i)=>node(String(i),{x:0,y:0,width:1,height:1})),390,844,120)).toBeNull();
});
test('full room heading includes the reserved notice viewport, so queued participation text never peeks behind artwork',()=>{
 const shell=node('room-shell',{x:16,y:16,width:358,height:134});
 const toolbar=node('room-header',{x:0,y:0,width:358,height:70},{parent:shell.id});
 const notices=node('room-notices',{x:0,y:74,width:358,height:60},{parent:shell.id,scroll:true,scrollAxis:'y'});
 const content=node('room-notice-content',{x:0,y:0,width:358,height:200},{parent:notices.id});
 const notice=node('notice-line',{x:0,y:0,width:358,height:80},{parent:content.id,kind:'text',label:'다음 판 참여를 기다리는 중'});
 const result=place([shell,toolbar,notices,content,notice,stock,dock],390,844,120);expect(result).toEqual({x:16,y:162,width:358,height:120});
 expect(result!.y).toBeGreaterThanOrEqual(16+134+12);expect(result!.y).toBeLessThan(16+74+200); // Tall clipped content does not falsely reserve its hidden tail.
});
test('all painted heading descendants are protected, including visible overflow outside toolbar allocation',()=>{
 const shell=node('room-shell',{x:16,y:16,width:358,height:134}),toolbar=node('room-header',{x:0,y:0,width:358,height:70},{parent:shell.id});
 const overflow=node('painted-heading-copy',{x:0,y:130,width:358,height:50},{parent:shell.id,kind:'text'});
 // Header paint ends at196; its first safe lane would collide with stock, so fall below stock.
 expect(place([shell,toolbar,overflow,stock,dock],390,844,120)?.y).toBe(402);
});
