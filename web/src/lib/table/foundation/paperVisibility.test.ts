import {expect,test} from 'vitest';
import {visiblePaperEndpoints} from './paperVisibility';
import {paperEndpoints,paperRect} from './paperEndpoints';
import {flightPath} from './transferMotion';
import type {Rect} from './contracts';
const clip={x:0,y:0,width:1280,height:800},reference={x:0,y:0,width:64,height:90};
function candidates(result:ReturnType<typeof visiblePaperEndpoints>){expect(result.kind).toBe('ready');if(result.kind!=='ready')throw Error(result.reason);return result.candidates;}
test('already-fitting centered preferred endpoint and size are unchanged',()=>{const box={x:500,y:300,width:72,height:66},other={x:100,y:100,width:64,height:89.6},old=paperEndpoints(box,reference,clip,[]);expect(candidates(visiblePaperEndpoints(box,reference,clip,[],[other]))).toEqual(old);});
test('sealed20 same-size edge witness is found without lowering its scale or excluding real name ink',()=>{
 const box={x:260.2109375,y:300.5390625,width:56,height:51.328125},other={x:452.23828125,y:319.29375,width:64,height:89.6},width=36.66294642857143,scale=width/64;
 // Actual lower-left name +6px ink clearance from the native capture. Its
 // centered paper corridor is blocked, while a right-edge corridor is clear.
 const guards=[{x:268.3828125,y:362.53125,width:39.65625,height:31}];
 const old=paperEndpoints(box,reference,clip,guards,scale,scale);expect(old.every(p=>!flightPath(other,p,clip,guards))).toBe(true);
 const result=candidates(visiblePaperEndpoints(box,reference,clip,guards,[other],scale,scale));expect(result.length).toBeGreaterThan(0);for(const paper of result){expect(paper.width).toBe(width);expect(paper.height).toBeCloseTo(51.328125);expect(flightPath(other,paper,clip,guards)).not.toBeNull();expect(paper.x).toBeGreaterThanOrEqual(box.x);expect(paper.x+paper.width).toBeLessThanOrEqual(box.x+box.width);}
});
test('one exact .4 winner endpoint admits all five known source rectangles together',()=>{
 const box={x:500,y:300,width:72,height:66},sources=Array.from({length:5},(_,i)=>({x:100+i*30,y:100+i*5,width:64,height:89.6})),glyph={x:495,y:295,width:10,height:5};
 expect(sources.every(source=>!!flightPath(source,{x:500,y:330.16,width:25.6,height:35.84},clip,[glyph]))).toBe(true);
 expect(paperEndpoints(box,reference,clip,[glyph],.4,.4).every(p=>sources.some(s=>!flightPath(s,p,clip,[glyph])))).toBe(true);
 const result=candidates(visiblePaperEndpoints(box,reference,clip,[glyph],sources,.4,.4));expect(result.every(p=>sources.every(s=>!!flightPath(s,p,clip,[glyph])))).toBe(true);expect(result.every(p=>p.width===25.6)).toBe(true);
});
test('analytic shadow subtraction retains a tangent-only line and point instead of dropping zero-area cells',()=>{
 const source={x:50,y:50,width:20,height:28},ref={x:0,y:0,width:20,height:28},box={x:200,y:50,width:40,height:48},horizontal={x:100,y:78,width:100,height:40};
 expect(paperEndpoints(box,ref,clip,[horizontal],1,1).every(p=>!flightPath(source,p,clip,[horizontal]))).toBe(true);
 const line=candidates(visiblePaperEndpoints(box,ref,clip,[horizontal],[source],1,1));expect(line.every(p=>p.y===50)).toBe(true);
 const vertical={x:220,y:0,width:20,height:100},point=candidates(visiblePaperEndpoints(box,ref,clip,[horizontal,vertical],[source],1,1));expect(point).toEqual([{x:200,y:50,width:20,height:28}]);
 const blocked={...horizontal,y:77};expect(visiblePaperEndpoints(box,ref,clip,[blocked,vertical],[source],1,1).kind).toBe('refused');
});
test('offclip, degenerate, unsafe source and invalid scales cannot create paper',()=>{const box={x:500,y:300,width:72,height:66},source={x:100,y:100,width:64,height:90};for(const b of [{...box,x:-1},{...box,width:0},{...box,height:NaN}])expect(visiblePaperEndpoints(b,reference,clip,[],[source]).kind).toBe('refused');expect(visiblePaperEndpoints(box,reference,clip,[],[{...source,x:-1}]).kind).toBe('refused');expect(visiblePaperEndpoints(box,reference,clip,[],[source],0,.4).kind).toBe('refused');expect(visiblePaperEndpoints(box,reference,clip,[source],[source]).kind).toBe('refused');});
test('protected glyphs are never sacrificed for a preferred larger paper',()=>{const box={x:500,y:300,width:72,height:66},source={x:100,y:100,width:64,height:90},guard={...box};expect(visiblePaperEndpoints(box,reference,clip,[guard],[source],.4,1.6).kind).toBe('refused');});
test('finite obstacle/work budgets fail closed instead of truncating shadows',()=>{const box={x:500,y:300,width:72,height:66},source={x:100,y:100,width:64,height:90},guards=Array.from({length:33},(_,i)=>({x:300+i,y:200,width:2,height:200}));const result=visiblePaperEndpoints(box,reference,clip,guards,[source]);expect(result.kind).toBe('refused');if(result.kind==='refused')expect(result.reason).toBe('obstacle-budget');});
test('seeded differential sampling: any ready candidate is exact-safe; a sampled minimum witness is never rejected without an explicit budget/numeric refusal',()=>{
 let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;},box={x:500,y:300,width:72,height:66},source={x:100,y:100,width:64,height:90},width=paperRect(reference).width*.4,height=width*7/5;
 for(let caseIndex=0;caseIndex<80;caseIndex++){const guards=Array.from({length:3},()=>({x:250+random()*290,y:170+random()*190,width:4+random()*20,height:4+random()*35})),result=visiblePaperEndpoints(box,reference,clip,guards,[source]);if(result.kind==='ready'){for(const p of result.candidates)expect(flightPath(source,p,clip,guards)).not.toBeNull();continue;}
  const witness=Array.from({length:9},(_,i)=>({x:box.x+(box.width-width)*(i%3)/2,y:box.y+(box.height-height)*Math.floor(i/3)/2,width,height})).some(p=>!!flightPath(source,p,clip,guards));if(witness)expect(result.reason).not.toBe('blocked');
 }
});

test('a nested caller supplies only its remaining work allowance; zero/invalid allowance cannot start a search',()=>{const box={x:500,y:300,width:72,height:66},source={x:100,y:100,width:64,height:90},guard={x:495,y:295,width:10,height:5};for(const allowance of [0,1,4,10]){const result=visiblePaperEndpoints(box,reference,clip,[guard],[source],.4,.4,allowance);expect(result.work).toBeLessThanOrEqual(allowance);expect(result.kind).toBe('refused');if(result.kind==='refused')expect(result.reason).toBe('work-budget');}expect(visiblePaperEndpoints(box,reference,clip,[guard],[source],.4,.4,8193).kind).toBe('refused');});
