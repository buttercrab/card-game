import {expect,test} from 'vitest';
import {paperEndpoints,paperRect,paperTransform,PAPER_ASPECT} from './paperEndpoints';
import {flightPath} from './transferMotion';
const clip={x:0,y:0,width:1000,height:1000},reference={x:0,y:0,width:64,height:90},figure={x:100,y:100,width:72,height:66};
test('fits paper uniformly inside a figure while retaining lower overlapping metadata protection',()=>{const guards=[{x:90,y:145,width:100,height:30}],all=paperEndpoints(figure,reference,clip,guards);expect(all.length).toBeGreaterThan(0);for(const r of all){expect(r.width/r.height).toBeCloseTo(PAPER_ASPECT);expect(r.y+r.height).toBeLessThanOrEqual(145);expect(r.width).toBeGreaterThanOrEqual(paperRect(reference).width*.4);expect(r.x).toBeGreaterThanOrEqual(figure.x);expect(r.x+r.width).toBeLessThanOrEqual(172);}expect(paperTransform(all[0],paperRect(reference))).not.toMatch(/scale\([^)]*,/);});
test('fails closed for insufficient free space, excess obstacles, invalid input, and clipped landmarks',()=>{expect(paperEndpoints(figure,reference,clip,[{x:90,y:120,width:100,height:100}])).toEqual([]);expect(paperEndpoints(figure,reference,clip,Array.from({length:33},()=>({...figure})))).toEqual([]);expect(paperEndpoints({...figure,width:NaN},reference,clip,[])).toEqual([]);expect(paperEndpoints({...figure,x:-1},reference,clip,[])).toEqual([]);});
test('fixed .4 winner paper and deterministic alternatives preserve every straight-path obstacle',()=>{const obstacle={x:125,y:95,width:20,height:85},all=paperEndpoints(figure,reference,clip,[obstacle],.4,.4);expect(all).toEqual(paperEndpoints(figure,reference,clip,[obstacle],.4,.4));for(const r of all){expect(r.width).toBeCloseTo(paperRect(reference).width*.4);expect(flightPath(r,r,clip,[obstacle])).not.toBeNull();}});
test('rejects free-region overflow without truncating a still-bounded obstacle set',()=>{
 const grid=(count:number)=>Array.from({length:count},(_,i)=>[
  {x:(i+1)*80,y:0,width:4,height:1000},
  {x:0,y:(i+1)*80,width:1000,height:4},
 ]).flat();
 const admitted=paperEndpoints(clip,reference,clip,grid(10));
 expect(admitted).toHaveLength(121);
 for(const rect of admitted)expect(flightPath(rect,rect,clip,grid(10))).not.toBeNull();
 const overflow=grid(11);
 expect(overflow).toHaveLength(22);
 expect(overflow.length).toBeLessThanOrEqual(32);
 expect(paperEndpoints(clip,reference,clip,overflow)).toEqual([]);
});
