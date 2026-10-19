import { describe,expect,test } from 'vitest';
import { layoutDecision } from './decisionLayout';
const phone={width:390,height:844},desktop={width:1440,height:900};
const item=(id:string,width:number,height=44,extra={})=>({id,width,height,...extra});
describe('numeric decision geometry',()=>{
 test('scrolling row preserves every native choice and DOM order',()=>{
  const items=Array.from({length:8},(_,i)=>item(`${i}`,44));
  const layout=layoutDecision({mode:'row',width:288,viewport:phone,items,gap:6});
  expect(layout.contentWidth).toBe(394);
  expect(layout.nodes.map(node=>node.bounds.x)).toEqual([0,50,100,150,200,250,300,350]);
 });
 test('wrapped card picker never places a choice across its region',()=>{
  const layout=layoutDecision({mode:'flow',width:288,viewport:phone,items:Array.from({length:12},(_,i)=>item(`${i}`,44,62)),gap:10});
  expect(layout.height).toBe(206);
  expect(layout.nodes[5].bounds).toMatchObject({x:0,y:72});
  expect(layout.nodes.every(node=>node.bounds.x+node.bounds.width<=288)).toBe(true);
 });
 test('phone primary command takes the remaining width',()=>{
  const layout=layoutDecision({mode:'actions',width:288,viewport:phone,items:[item('pass',64),item('bid',90,44,{primary:true})],gap:8,align:'center'});
  expect(layout.nodes[0].bounds.width).toBe(88);
  expect(layout.nodes[1].bounds).toMatchObject({x:96,width:192});
  expect(layout.nodes.every(node=>node.bounds.x>=0&&node.bounds.x+node.bounds.width<=288)).toBe(true);
 });
 test('phone overflow does not shrink a primary below its readable minimum',()=>{
  const layout=layoutDecision({mode:'actions',width:180,viewport:phone,items:[item('pass',64),item('bid',90,44,{primary:true})],gap:8});
  expect(layout.nodes.map(node=>node.bounds.width)).toEqual([88,100]);
  expect(layout.nodes[1].bounds).toMatchObject({x:96,width:100});
  expect(layout.contentWidth).toBe(196);
  expect(layout.nodes.every(node=>node.visible)).toBe(true);
 });
 test('phone overflow preserves a long caption minimum rather than merely the policy floor',()=>{
  const layout=layoutDecision({mode:'actions',width:180,viewport:phone,items:[item('pass',64),item('bid',140,44,{primary:true})],gap:8});
  expect(layout.nodes.map(node=>node.bounds.width)).toEqual([88,140]);
  expect(layout.contentWidth).toBe(236);
  expect(layout.nodes[1].bounds.x+layout.nodes[1].bounds.width).toBe(layout.contentWidth);
 });
 test('bid blocks share a wide row only when their measured minimums fit',()=>{
  const items=[item('picks',250,44,{kind:'picks'}),item('actions',276,44,{kind:'actions'})];
  const wide=layoutDecision({mode:'bid',width:900,viewport:desktop,items});
  expect(wide.height).toBe(44);
  expect(wide.nodes[1].bounds.y).toBe(0);
  const narrow=layoutDecision({mode:'bid',width:358,viewport:phone,items});
  expect(narrow.nodes[1].bounds).toMatchObject({x:0,y:50,width:358});
 });
 test('exchange gives contract and discard separate desktop columns',()=>{
  const layout=layoutDecision({mode:'exchange',width:1000,viewport:desktop,items:[item('discard',240,100,{kind:'discard'}),item('contract',400,94,{kind:'contract-controls'}),item('confirm',200,44,{kind:'actions'})]});
  expect(layout.nodes.find(node=>node.id==='contract')?.bounds.width).toBe(748);
  expect(layout.nodes.find(node=>node.id==='discard')?.bounds.x).toBe(760);
  expect(layout.nodes.find(node=>node.id==='confirm')?.visible).toBe(false);
 });
 test('desktop discard chooses exactly one confirm action',()=>{
  const layout=layoutDecision({mode:'discard',width:240,viewport:desktop,items:[item('count',30,24,{kind:'count'}),item('description',120,16,{kind:'muted'}),item('confirm',200,44,{kind:'desktop-confirm'}),item('discard',88,44,{kind:'discard-btn'})]});
  expect(layout.nodes.find(node=>node.id==='discard')?.visible).toBe(false);
  expect(layout.nodes.find(node=>node.id==='confirm')?.bounds).toMatchObject({x:0,y:32,width:240});
 });
 test('centers each wrapped row from its allocated widths',()=>{
  const result=layoutDecision({mode:'flow',align:'center',width:200,viewport:desktop,gap:10,items:[item('a',70,20),item('b',50,20),item('c',120,20)]});
  expect(result.nodes.map(node=>node.bounds)).toEqual([{x:35,y:0,width:70,height:20},{x:115,y:0,width:50,height:20},{x:40,y:30,width:120,height:20}]);
 });
 test('strip bottom anchors remain numeric while short landscape scrolls',()=>{
  const items=[item('controls',358,110,{kind:'controls'})];
  expect(layoutDecision({mode:'strip',width:358,height:16,viewport:phone,items}).nodes[0].bounds.y).toBe(-94);
  expect(layoutDecision({mode:'strip',width:240,height:112,viewport:{width:568,height:320},items}).nodes[0].bounds.y).toBe(0);
 });
 test('scroll paint insets protect both ends and the animated vertical extent',()=>{
  const layout=layoutDecision({mode:'row',width:160,viewport:phone,inset:8,items:[item('a',80,40),item('b',80,40)],gap:6});
  expect(layout.nodes[0].bounds).toEqual({x:8,y:8,width:80,height:40});
  expect(layout.contentWidth-(layout.nodes[1].bounds.x+80)).toBe(8);
  for(const {bounds:b} of layout.nodes){
   // 1.08 selection pulse plus its 3px lip stays inside the viewport height.
   expect(b.y-b.height*.04).toBeGreaterThanOrEqual(0);
   expect(b.y+b.height*1.04+3).toBeLessThanOrEqual(layout.height);
  }
 });
 test('bid stacks use the supplied gap rather than an independent hardcoded spacing',()=>{
  const layout=layoutDecision({mode:'bid',width:358,viewport:phone,gap:8,items:[item('picks',300,56,{kind:'picks'}),item('actions',276,44,{kind:'actions'})]});
  expect(layout.nodes[1].bounds.y-(layout.nodes[0].bounds.y+layout.nodes[0].bounds.height)).toBe(8);
 });
});
