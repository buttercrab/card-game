import {expect,test} from 'vitest';
import {chooseObserverReactionPlacement as place} from './observerReactionLayout';
import type {PlannedNode,Rect} from './contracts';
const node=(id:string,box:Rect,extra:Partial<PlannedNode>={}):PlannedNode=>({id,parent:'table',kind:'group',label:id,box,...extra});
const root=node('table',{x:0,y:0,width:390,height:300},{parent:null});
const header=node('room-header',{x:0,y:0,width:390,height:70});
const left=node('left-name',{x:16,y:90,width:170,height:40},{kind:'text',label:'보리',textAlign:'center'});
const right=node('right-name',{x:204,y:90,width:170,height:40},{kind:'text',label:'호두',textAlign:'center'});
const floor=node('public-fan',{x:0,y:160,width:390,height:140},{kind:'card',publicDisclosureEventId:'public-event'});
const observer=[root,header,left,right,floor];
const metrics=new Map([['left-name',{width:28,height:20}],['right-name',{width:28,height:20}]]);
const overlaps=(a:Rect,b:Rect)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);

test('uses actual current one-line glyph advances to recover a safe central observer gap',()=>{
 expect(place(observer,390,300,{width:112,height:70})).toBeNull();const before=JSON.stringify(observer),result=place(observer,390,300,{width:112,height:70},metrics);
 expect(result).toEqual({x:139,y:82,width:112,height:70});expect(Object.isFrozen(result)).toBe(true);expect(JSON.stringify(observer)).toBe(before);expect(overlaps(result!,{x:87,y:90,width:28,height:20})).toBe(false);expect(overlaps(result!,{x:275,y:90,width:28,height:20})).toBe(false);
});
test('maps text alignment to glyph paint and conservatively retains multiline or oversized text envelopes',()=>{
 const changed=observer.map(node=>node.id==='left-name'?{...node,textAlign:'end' as const}:node.id==='right-name'?{...node,textAlign:'start' as const}:node);const result=place(changed,390,300,{width:112,height:70},metrics);expect(result?.x).toBe(16);
 expect(place(observer.map(node=>node.id==='left-name'?{...node,label:'보\n리'}:node),390,300,{width:112,height:70},metrics)).toBeNull();
 for(const invalid of [{width:171,height:20},{width:28,height:41},{width:NaN,height:20},{width:0,height:20}])expect(place(observer,390,300,{width:112,height:70},new Map([['left-name',invalid],['right-name',invalid]]))).toBeNull();
});
test('clips scroll content and native target paint to the reserved ancestor viewport',()=>{
 const nodes=[{...root,box:{...root.box,height:400}},header,node('not-a-header-viewport',{x:0,y:82,width:390,height:60},{scroll:true,scrollAxis:'y'}),node('scroll-copy',{x:0,y:0,width:390,height:300},{parent:'not-a-header-viewport',kind:'text',label:'Long current status'}),node('floor',{x:0,y:230,width:390,height:170},{kind:'card'})];
 const result=place(nodes,390,400,{width:112,height:60});expect(result?.y).toBe(150);expect(result!.y+result!.height).toBeLessThanOrEqual(230);
 const hiddenControl=node('offscreen-native',{x:0,y:200,width:390,height:44},{parent:'not-a-header-viewport',kind:'command',enabled:true});expect(place([...nodes,hiddenControl],390,400,{width:112,height:60})).toEqual(result);
});
test('protects every native target including disabled targets and their six-pixel focus envelope',()=>{
 for(const kind of ['command','choice','select','toggle','range','editor'] as const){
  const target=node('target',{x:133,y:82,width:124,height:76},{kind,enabled:false}),result=place([root,header,target,floor],390,300,{width:112,height:70});
  expect(result).toBeNull(); // Raw117px side gap becomes111px after the6px focus envelope.
  const onePixelMore={...target,box:{...target.box,x:134}},safe=place([root,header,onePixelMore,floor],390,300,{width:112,height:70});expect(safe?.x).toBe(16);expect(overlaps(safe!,{x:128,y:76,width:136,height:88})).toBe(false);
 }
});
test('all cards, public fans, stock markers, readable names and status labels remain blockers',()=>{
 for(const extra of [{kind:'card' as const,zoneId:'hand',entityId:'own'},{kind:'card' as const,publicDisclosureEventId:'event'},{kind:'card' as const,stockCount:3,visual:{kind:'back' as const}},{kind:'group' as const,ownHandAnchor:{participantId:'alice',count:0}},{kind:'text' as const,label:'Current player'},{semanticRole:'status' as const,label:'Current status'}]){
  const occupied=node('occupied',{x:0,y:70,width:390,height:230},extra);expect(place([root,header,occupied],390,300,{width:112,height:70})).toBeNull();
 }
 const figure=node('passive-portrait',{x:0,y:70,width:390,height:230},{kind:'figure'});expect(place([root,header,figure],390,300,{width:112,height:70})).toBeNull();
});
test('never shrinks header or clipped room notice protection through intrinsic whitespace',()=>{
 const shell=node('room-shell',{x:0,y:0,width:390,height:160}),copy=node('header-copy',{x:0,y:0,width:390,height:30},{parent:'room-shell',kind:'text',label:'Room'}),notice=node('room-notices',{x:0,y:80,width:390,height:80},{parent:'room-shell',scroll:true,scrollAxis:'y'}),long=node('notice-copy',{x:0,y:0,width:390,height:500},{parent:'room-notices',kind:'text',label:'Pending participation'});
 const result=place([{...root,box:{...root.box,height:500}},shell,copy,notice,long],390,500,{width:112,height:70},new Map([['header-copy',{width:20,height:20}],['notice-copy',{width:10,height:20}]]));expect(result?.y).toBe(172);
});
test('fails closed on malformed, disconnected, cyclic, foreign, modal and excessive layouts',()=>{
 for(const dimensions of [[NaN,300],[390,0],[30,300]])expect(place(observer,dimensions[0],dimensions[1],{width:112,height:70})).toBeNull();
 for(const overlay of [{width:0,height:70},{width:112,height:Infinity},{width:400,height:70},{width:112,height:500}])expect(place(observer,390,300,overlay)).toBeNull();
 for(const nodes of [[...observer,left],[...observer,node('foreign',{x:0,y:0,width:1,height:1},{parent:'absent'})],[...observer,node('another-root',{x:0,y:0,width:1,height:1},{parent:null})],[...observer,node('a',{x:0,y:0,width:1,height:1},{parent:'b'}),node('b',{x:0,y:0,width:1,height:1},{parent:'a'})],observer.map(node=>node.id==='left-name'?{...node,box:{...node.box,x:NaN}}:node),[...observer,node('modal',{x:0,y:0,width:1,height:1},{semanticRole:'dialog'})]])expect(place(nodes,390,300,{width:112,height:70})).toBeNull();
 expect(place([...observer,node('unknown',{x:0,y:0,width:1,height:1},{kind:'unknown' as never})],390,300,{width:112,height:70})).toBeNull();expect(place(Array(4097).fill(root),390,300,{width:112,height:70})).toBeNull();
});
test('bounded deep ancestry uses iterative traversal and does not mutate or invoke a measuring callback',()=>{
 const nodes=[root];while(nodes.length<4096)nodes.push(node(`deep:${nodes.length}`,{x:0,y:0,width:0,height:0},{parent:nodes.at(-1)!.id}));expect(place(nodes,390,300,{width:112,height:70})).toEqual({x:139,y:16,width:112,height:70});
});

test("empty native scroll viewport space may propose a gap while its actual children remain protected",()=>{const scroll=node("scroll",{x:0,y:70,width:390,height:230},{scroll:true});expect(place([root,header,scroll],390,300,{width:112,height:70})).not.toBeNull();expect(place([root,header,scroll,node("paint",{x:0,y:0,width:390,height:230},{parent:"scroll",kind:"figure"})],390,300,{width:112,height:70})).toBeNull();});
