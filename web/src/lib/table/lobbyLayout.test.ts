import { describe,expect,test } from 'vitest';
import { lobbyLayout } from './lobbyLayout';
describe('between-hand numeric controls',()=>{
 test('centers controls in the arena without CSS container units',()=>{
  const geometry=lobbyLayout({width:390,height:844},{width:358,height:492},5,120,92);
  expect(geometry.width).toBe(166);
  expect(geometry.x+geometry.width/2).toBe(179);
  expect(geometry.y+60).toBe(287);
  expect(geometry.goWidth).toBe(136);
  expect(geometry.noteY).toBe(128);
 });
 test('short landscape anchors controls in the decision lane',()=>{
  const geometry=lobbyLayout({width:568,height:320},{width:288,height:112},5,44,66,true);
  expect(geometry.direction).toBe('row');
  expect(geometry.x+geometry.width/2).toBe(416);
  expect(geometry.y).toBe(34);
  expect(geometry.goHeight).toBe(44);
 });
 test('incomplete and observer layouts retain the arena center',()=>{
  const geometry=lobbyLayout({width:568,height:320},{width:288,height:112},5,40,66,false);
  expect(geometry.direction).toBe('column');
  expect(geometry.x+geometry.width/2).toBe(144);
 });
});
