import type { FeedbackEvent, FeedbackSink } from './feedback';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({settings:{sound:true,volume:0.7,music:false,musicVolume:0.5,haptics:true,speed:'off'},mood:vi.fn()}));
vi.mock('../../settings.svelte',()=>({settings:state.settings}));
vi.mock('../../music.svelte',()=>({setMood:state.mood}));
const parameter=()=>({value:0,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn(),cancelScheduledValues:vi.fn()});
interface FakeNode {kind:string;connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;onended:(()=>void)|null;gain:ReturnType<typeof parameter>;frequency:ReturnType<typeof parameter>;Q:ReturnType<typeof parameter>;pan:ReturnType<typeof parameter>;buffer:unknown;type:string;}
let nodes:FakeNode[],sources:FakeNode[],gestures:EventTarget,vibrate:ReturnType<typeof vi.fn>;
function node(kind:string):FakeNode {
 const result:FakeNode={kind,connect:vi.fn(target=>target),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null,gain:parameter(),frequency:parameter(),Q:parameter(),pan:parameter(),buffer:null,type:''};nodes.push(result);if(kind==='oscillator'||kind==='buffer')sources.push(result);return result;
}
beforeEach(()=>{
 vi.resetModules();nodes=[];sources=[];gestures=new EventTarget();vibrate=vi.fn(()=>true);state.mood.mockReset();Object.assign(state.settings,{sound:true,volume:0.7,music:false,musicVolume:0.5,haptics:true,speed:'off'});
 vi.stubGlobal('window',gestures);vi.stubGlobal('navigator',{vibrate});vi.stubGlobal('AudioContext',vi.fn(function(){return {state:'running',currentTime:10,sampleRate:16,destination:{},resume:vi.fn(async()=>{}),createBuffer:(_channels:number,length:number)=>({getChannelData:()=>new Float32Array(length)}),createGain:()=>node('gain'),createBiquadFilter:()=>node('filter'),createStereoPanner:()=>node('panner'),createBufferSource:()=>node('buffer'),createOscillator:()=>node('oscillator')};}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const unlock=()=>gestures.dispatchEvent(new Event('pointerdown'));
function adapted(raw:FeedbackSink){return {mood:raw.mood,emit:(event:Omit<FeedbackEvent,'id'|'milestone'>)=>raw.emit({...event,id:'test-effect',milestone:{kind:'visible'}})};}
async function sink(){const module=await import('./feedbackSink');unlock();return adapted(module.createBrowserFeedbackSink());}

describe('cancellable browser feedback effects',()=>{
 it('cancels every delayed shuffle source and all nodes exactly once',async()=>{
  const feedback=await sink(),cancel=feedback.emit({kind:'shuffle'});expect(sources).toHaveLength(14);expect(sources.some(source=>Number(source.start.mock.calls[0][0])>10)).toBe(true);expect(nodes.every(node=>node.disconnect.mock.calls.length===0)).toBe(true);
  cancel();cancel();for(const source of sources){expect(source.stop).toHaveBeenLastCalledWith();expect(source.stop).toHaveBeenCalledTimes(1);}for(const node of nodes)expect(node.disconnect).toHaveBeenCalledTimes(1);
 });
 it('cancels oscillators, modulation sources and gain/filter graphs without cancelling another emission',async()=>{
  const feedback=await sink(),first=feedback.emit({kind:'sweep'}),split=nodes.length,firstSources=[...sources];const second=feedback.emit({kind:'result',positive:true}),secondNodes=nodes.slice(split),secondSources=sources.slice(firstSources.length);
  expect(firstSources.some(source=>source.kind==='oscillator')).toBe(true);expect(secondSources.some(source=>Number(source.start.mock.calls[0][0])>10)).toBe(true);first();expect(nodes.slice(0,split).every(node=>node.disconnect.mock.calls.length===1)).toBe(true);expect(secondNodes.every(node=>node.disconnect.mock.calls.length===0)).toBe(true);second();expect(secondNodes.every(node=>node.disconnect.mock.calls.length===1)).toBe(true);
 });
 it('releases naturally ended sources and graphs and does not stop them again later',async()=>{
  const feedback=await sink(),cancel=feedback.emit({kind:'friend'});const scheduledStops=sources.map(source=>source.stop.mock.calls.length);for(const source of [...sources])source.onended?.();expect(nodes.every(node=>node.disconnect.mock.calls.length===1)).toBe(true);cancel();expect(sources.map(source=>source.stop.mock.calls.length)).toEqual(scheduledStops);
 });
 it('preserves legacy sound methods and keeps their graph outside a scoped cancellation',async()=>{
  const feedback=await sink(),{sound}=await import('../../sound');sound.card();const legacy=[...nodes];const cancel=feedback.emit({kind:'card'});cancel();expect(legacy.every(node=>node.disconnect.mock.calls.length===0)).toBe(true);expect(nodes.slice(legacy.length).every(node=>node.disconnect.mock.calls.length===1)).toBe(true);
 });
 it('respects sound and volume preferences without replay when preferences change',async()=>{
  const feedback=await sink();state.settings.sound=false;feedback.emit({kind:'score',amount:3});expect(sources).toHaveLength(0);state.settings.sound=true;state.settings.volume=0;feedback.emit({kind:'card'});expect(sources).toHaveLength(0);state.settings.volume=0.5;expect(sources).toHaveLength(0);feedback.emit({kind:'card'});expect(sources.length).toBeGreaterThan(0);expect(nodes.filter(node=>node.kind==='gain').some(node=>node.gain.value>0)).toBe(true);
 });
 it('keeps card feedback enabled with motion off and clamps unbounded score counts',async()=>{
  const feedback=await sink();expect(state.settings.speed).toBe('off');feedback.emit({kind:'card'});expect(sources.length).toBeGreaterThan(0);const previous=sources.length;feedback.emit({kind:'score',amount:1e9});expect(sources.length-previous).toBe(104);
 });
 it('vibrates only for an enabled turn and stale cancellation cannot stop a newer turn',async()=>{
  const feedback=await sink();feedback.emit({kind:'bid'});expect(vibrate).not.toHaveBeenCalled();state.settings.haptics=false;feedback.emit({kind:'turn'});expect(vibrate).not.toHaveBeenCalled();state.settings.haptics=true;const first=feedback.emit({kind:'turn'}),second=feedback.emit({kind:'turn'});expect(vibrate.mock.calls).toEqual([[18],[18]]);first();expect(vibrate.mock.calls).toEqual([[18],[18]]);second();second();expect(vibrate.mock.calls).toEqual([[18],[18],[0]]);
 });
 it('plays reactions/errors and scopes the optional refusal vibration to its emission',async()=>{
  vi.spyOn(Math,'random').mockReturnValue(0.5);const feedback=await sink();const reaction=feedback.emit({kind:'reaction'});expect(sources).toHaveLength(2);expect(vibrate).not.toHaveBeenCalled();reaction();expect(nodes.every(node=>node.disconnect.mock.calls.length===1)).toBe(true);
  const errors=sources.length;feedback.emit({kind:'error'});expect(sources.length-errors).toBe(1);expect(sources.at(-1)!.type).toBe('square');expect(vibrate).not.toHaveBeenCalled();
  const refusal=feedback.emit({kind:'refusal'});expect(vibrate.mock.calls).toEqual([[30]]);refusal();refusal();expect(vibrate.mock.calls).toEqual([[30],[0]]);state.settings.haptics=false;feedback.emit({kind:'refusal'});expect(vibrate.mock.calls).toEqual([[30],[0]]);
 });
 it('restores lobby only when the current mood owner is disposed',async()=>{
  const feedback=await sink(),old=feedback.mood('bidding'),current=feedback.mood('play');old();expect(state.mood.mock.calls).toEqual([['bidding'],['play']]);current();current();expect(state.mood.mock.calls).toEqual([['bidding'],['play'],['lobby']]);
 });
 it('uses the wooden clock tick rather than the tag motif for final seconds',async()=>{
  vi.spyOn(Math,'random').mockReturnValue(0.5);const feedback=await sink();feedback.emit({kind:'clock',amount:1});expect(sources).toHaveLength(1);expect(sources[0].kind).toBe('buffer');expect(nodes.find(node=>node.kind==='filter')!.frequency.setValueAtTime).toHaveBeenCalledWith(2200,10);
 });
 it('does not synthesize deferred cues before browser gesture authorization',async()=>{
  const {createBrowserFeedbackSink}=await import('./feedbackSink');const feedback=adapted(createBrowserFeedbackSink());feedback.emit({kind:'run'});expect(sources).toHaveLength(0);unlock();expect(sources).toHaveLength(0);feedback.emit({kind:'run'});expect(sources).toHaveLength(6);
 });
});
