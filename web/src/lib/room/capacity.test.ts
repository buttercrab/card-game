import {describe,it,expect} from 'vitest';
import {capacityAllows,capacityAllowsRoomAction} from './capacity';
describe('native resource eligibility',()=>{
 it('keeps legacy behavior and denies present malformed fields without accessors',()=>{
  expect(capacityAllows({},'can_start')).toBe(true);expect(capacityAllows({capacity:undefined},'can_play')).toBe(true);
  let reads=0;const getter={get capacity(){reads++;return {};}};
  expect(capacityAllows(getter,'can_start')).toBe(false);expect(reads).toBe(0);
  for(const capacity of [null,{},[],{can_start:true,can_archive:true,can_play:true,reason:null,extra:true}])expect(capacityAllows({capacity},'can_start')).toBe(false);
 });
 it('applies exact lifecycle eligibility and never gates recovery or EndSession on archive space',()=>{
  const source={capacity:{can_start:false,can_archive:false,can_play:true,reason:{code:'capacity',resource:'session',limit:4194304}}};
  for(const type of ['start','reset_scores','rematch'])expect(capacityAllowsRoomAction(source,{type})).toBe(false);
  for(const type of ['end_session','query_operation','cancel_operation','leave','ready'])expect(capacityAllowsRoomAction(source,{type})).toBe(true);
  expect(capacityAllows(source,'can_play')).toBe(true);
  source.capacity.can_start=true;expect(capacityAllowsRoomAction(source,{type:'start'})).toBe(true);
 });
 it('recognizes native score headroom refusal without disabling an already reserved active hand',()=>{
  const source={capacity:{can_start:false,can_archive:true,can_play:true,reason:{code:'capacity',resource:'score',limit:Number.MAX_SAFE_INTEGER}}};
  expect(capacityAllowsRoomAction(source,{type:'start'})).toBe(false);expect(capacityAllowsRoomAction(source,{type:'reset_scores'})).toBe(true);expect(capacityAllows(source,'can_play')).toBe(true);
 });
});
