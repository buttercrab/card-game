import {expect,test} from 'vitest';
import {allocateTableStack,type TableStackRequirements} from './activeTableAllocation';
const base:TableStackRequirements={height:700,arena:{minimum:240,preferred:600},decision:{minimum:100,preferred:140},dock:180,status:40,tools:44,preferredGap:8};
test('complete measured cohorts survive pressure before preferred dimensions',()=>{
 for(const height of [604,620,650,700]){
  const result=allocateTableStack({...base,height});
  expect(result.kind).toBe('fit');expect(result.arena).toBeGreaterThanOrEqual(240);expect(result.decision).toBeGreaterThanOrEqual(100);
  expect(result.contentHeight).toBeLessThanOrEqual(height);expect(result.contentHeight).toBeCloseTo(result.arena+result.decision+180+40+44+result.gap*4);
 }
});
test('an impossible table reports a real deficit without clipping any essential cohort',()=>{
 const result=allocateTableStack({...base,height:400});
 expect(result).toEqual({kind:'overflow',gap:0,arena:240,decision:100,contentHeight:604,deficit:204});
});
test('absent optional regions consume neither height nor gaps',()=>{
 expect(allocateTableStack({height:300,arena:{minimum:100,preferred:200},dock:100,preferredGap:8})).toEqual({kind:'fit',gap:8,arena:192,decision:0,contentHeight:300,deficit:0});
});
test('invalid measurements cannot enter the committed composition',()=>{
 for(const patch of [{height:NaN},{dock:-1},{arena:{minimum:200,preferred:100}}])expect(()=>allocateTableStack({...base,...patch})).toThrow('Invalid measured table requirements');
});

test('zero-minimum expansion cannot silently add unbudgeted region gaps',()=>{
 expect(()=>allocateTableStack({height:300,arena:{minimum:0,preferred:100},decision:{minimum:0,preferred:50},dock:100,status:50,preferredGap:8})).toThrow('Invalid measured table requirements');
});
test('zero regions and exhausted preferences do not create height or negative gaps',()=>{
 expect(allocateTableStack({height:500,arena:{minimum:0,preferred:0},dock:0,preferredGap:8})).toEqual({kind:'fit',gap:0,arena:0,decision:0,contentHeight:0,deficit:0});
 expect(allocateTableStack({height:500,arena:{minimum:100,preferred:150},dock:100,preferredGap:8})).toEqual({kind:'fit',gap:8,arena:150,decision:0,contentHeight:258,deficit:0});
});

test('measured alternatives retain bounded tool ancestry and impossible candidates report complete minima',async()=>{
 const {chooseTableStack}=await import('./activeTableAllocation');
 const ring={candidate:'ring',requirements:{...base,height:650,arena:{minimum:300,preferred:500}}},adjacent={candidate:'adjacent',requirements:{...base,height:650,arena:{minimum:220,preferred:300}}};
 expect(chooseTableStack([ring,adjacent])).toMatchObject({candidate:'adjacent',allocation:{kind:'fit'}});
 const bounded=chooseTableStack([ring]);
 expect(bounded).toMatchObject({candidate:'ring',allocation:{kind:'overflow',arena:300,deficit:14}});
 const impossible=chooseTableStack([{...ring,requirements:{...ring.requirements,height:200}},{...adjacent,requirements:{...adjacent.requirements,height:200}}]);
 expect(impossible).toMatchObject({candidate:'adjacent',allocation:{kind:'overflow',arena:220,decision:100,deficit:384}});
});

test('native envelope separation is a measured minimum in both fitting and overflowing root flow',()=>{
 const requirements={height:200,arena:{minimum:100,preferred:100},decision:{minimum:50,preferred:50},dock:80,tools:44,preferredGap:8,minimumGap:8};
 expect(allocateTableStack(requirements)).toEqual({kind:'overflow',gap:8,arena:100,decision:50,contentHeight:298,deficit:98});
 expect(allocateTableStack({...requirements,height:298})).toEqual({kind:'fit',gap:8,arena:100,decision:50,contentHeight:298,deficit:0});
 expect(()=>allocateTableStack({...requirements,minimumGap:9})).toThrow('Invalid measured table requirements');
});
