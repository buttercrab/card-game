import {describe,it,expect,vi} from 'vitest';
import {DEFAULT_SETTINGS,normalizeSettings} from './settingsValues';
describe('stored browser preference validation',()=>{
 it('preserves every valid existing preference and copies rather than retaining storage objects',()=>{
  const value={fourColor:false,singleTap:true,sound:false,music:true,musicVolume:0.2,haptics:false,volume:0.3,speed:'fast' as const,textScale:1.25 as const,hints:false,tips:true,cardBack:'jade' as const,tableTone:'blush' as const};
  const result=normalizeSettings(value);expect(result).toEqual(value);expect(result).not.toBe(value);value.volume=0;expect(result.volume).toBe(0.3);
 });
 it.each([null,undefined,[],true,'bad',3])('defaults invalid container %s',value=>expect(normalizeSettings(value)).toEqual(DEFAULT_SETTINGS));
 it('defaults each invalid known field while retaining unrelated valid values',()=>{
  expect(normalizeSettings({fourColor:'false',singleTap:1,sound:null,musicVolume:Infinity,volume:-1,speed:'warp',hints:false,tips:true,cardBack:'__proto__',tableTone:'constructor',unknown:'ignored'})).toEqual({...DEFAULT_SETTINGS,hints:false,tips:true});
  expect(normalizeSettings({volume:NaN,musicVolume:1.01})).toEqual(DEFAULT_SETTINGS);
 });
 it('ignores inherited fields and accessors without evaluating them',()=>{
  const read=vi.fn(()=>true),value=Object.create({singleTap:true});Object.defineProperty(value,'music',{get:read,enumerable:true});
  expect(normalizeSettings(value)).toEqual(DEFAULT_SETTINGS);expect(read).not.toHaveBeenCalled();
 });
 it('accepts all defined cosmetics but never copies prototype or extra fields',()=>{
  const result=normalizeSettings(JSON.parse('{"__proto__":{"polluted":true},"volume":0,"musicVolume":1,"speed":"off","cardBack":"gold","tableTone":"celadon"}'));
  expect(result).toEqual({...DEFAULT_SETTINGS,volume:0,musicVolume:1,speed:'off',cardBack:'gold',tableTone:'celadon'});expect(Object.getPrototypeOf(result)).toBe(Object.prototype);expect(Object.hasOwn(result,'__proto__')).toBe(false);
 });
});

it('aligns saved fractional volumes to the declared native-control step',()=>{
 expect(normalizeSettings({volume:0.35,musicVolume:0.65})).toMatchObject({volume:0.4,musicVolume:0.7});
 expect(normalizeSettings({volume:0.1+0.2})).toMatchObject({volume:0.3});
});


describe('finite device text size',()=>{
 it.each([1,1.25,1.5,2])('preserves supported scale %s through JSON storage roundtrip',textScale=>{
  const stored=JSON.stringify(normalizeSettings({...DEFAULT_SETTINGS,textScale}));expect(normalizeSettings(JSON.parse(stored)).textScale).toBe(textScale);
 });
 it.each([0,0.5,1.1,1.249999,1.75,3,NaN,Infinity,-Infinity,'1.5',true,null,{},[1.5]])('defaults an unsupported scale without clamping: %s',textScale=>{
  expect(normalizeSettings({textScale,sound:false}).textScale).toBe(1);expect(normalizeSettings({textScale,sound:false}).sound).toBe(false);
 });
 it('defaults legacy storage and ignores inherited or accessor text scales without mutation',()=>{
  const legacy={volume:0.5};expect(normalizeSettings(legacy).textScale).toBe(1);expect(Object.hasOwn(legacy,'textScale')).toBe(false);
  const inherited=Object.create({textScale:2});expect(normalizeSettings(inherited).textScale).toBe(1);
  const getter=vi.fn(()=>2),accessor={};Object.defineProperty(accessor,'textScale',{enumerable:true,get:getter});expect(normalizeSettings(accessor).textScale).toBe(1);expect(getter).not.toHaveBeenCalled();
 });
});
