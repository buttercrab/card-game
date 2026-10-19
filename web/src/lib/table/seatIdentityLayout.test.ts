import {describe,it,expect} from 'vitest';
import {calculateSeatIdentity} from './seatIdentityLayout';
describe('individual seat geometry',()=>{
 it.each([[320,568],[390,844],[768,1024]])('keeps readable local identity above feedback at %ix%i',(width,height)=>{
  const seat=calculateSeatIdentity({viewport:{width,height},region:{width:width-32,height:174},width:width-48,local:true,nameWidth:100});
  expect(seat.figure.width).toBeGreaterThanOrEqual(48);expect(seat.nameSize).toBeGreaterThanOrEqual(16);
  expect(seat.meta.y+seat.meta.height).toBeLessThanOrEqual(seat.name.y);
  expect(seat.identity.y+seat.identity.height).toBeLessThanOrEqual(seat.feedbackBox.y);
  expect(seat.height).toBeLessThanOrEqual(90);
 });
 it('waiting name caps grow without feeding back the old pill width',()=>{
  const input={viewport:{width:390,height:844},region:{width:358,height:174},width:170,local:true,waiting:true,hasMeta:false};
  const short=calculateSeatIdentity({...input,nameWidth:32});
  const long=calculateSeatIdentity({...input,nameWidth:1000});
  expect(short.identity.width).toBe(64);expect(short.name.width).toBe(48);
  expect(long.nameTextMax).toBe(short.nameTextMax);expect(long.name.width).toBe(162);
  expect(long.height).toBe(short.height);
 });
 it('fits a landscape identity and its feedback in the reserved dock',()=>{
  const seat=calculateSeatIdentity({viewport:{width:568,height:320},region:{width:536,height:84},width:92,local:true});
  expect(seat.height).toBe(84);expect(seat.name.y+seat.name.height).toBe(seat.identity.height);
  expect(seat.feedbackBox.y+seat.feedbackBox.height+2).toBe(seat.height);
 });
 it('anchors reaction to the identity rather than moving it when feedback changes',()=>{
  const input={viewport:{width:390,height:844},region:{width:350,height:452},width:100,nameWidth:80};
  const seat=calculateSeatIdentity(input);const empty=calculateSeatIdentity({...input,empty:true});
  expect(seat.figure).toEqual(empty.figure);
  expect(seat.feedbackBox.y+seat.feedback.reaction!.y).toBe(-6);
 });
 it('truncates long names without moving the seat footprint',()=>{
  const input={viewport:{width:768,height:1024},region:{width:700,height:620},width:120};
  const seat=calculateSeatIdentity({...input,nameWidth:1000,statusCount:2,thinking:true});
  expect(seat.name.width).toBeLessThanOrEqual(106);expect(seat.identity.width).toBe(112);
  expect(seat.showThinking).toBe(true);expect(seat.status.width).toBe(17);
 });
});
