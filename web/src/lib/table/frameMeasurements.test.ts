import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameMeasurements } from './frameMeasurements';
function setup() {
  let next=0;const frames=new Map<number,()=>void>();const observe=vi.fn();const unobserve=vi.fn();const disconnect=vi.fn();let resized:()=>void=()=>{};
  const add=vi.fn();const remove=vi.fn();const fontAdd=vi.fn();const fontRemove=vi.fn();
  vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{const id=++next;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resized=callback;}observe=observe;unobserve=unobserve;disconnect=disconnect;});
  vi.stubGlobal('addEventListener',add);vi.stubGlobal('removeEventListener',remove);
  vi.stubGlobal('document',{documentElement:{clientWidth:390,clientHeight:844},fonts:{addEventListener:fontAdd,removeEventListener:fontRemove}});
  vi.stubGlobal('getComputedStyle',()=>({translate:'0px 0px'}));
  function element(x=0,y=0,width=200,height=100){return {clientWidth:width,clientHeight:height,offsetWidth:width,offsetHeight:height,getBoundingClientRect:vi.fn(()=>({x,y,width,height}))} as unknown as HTMLElement;}
  return {element,observe,unobserve,disconnect,add,remove,fontAdd,fontRemove,resize:()=>resized(),flush(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());},frames};
}
afterEach(()=>vi.unstubAllGlobals());
describe('shared DOM measurement adapter',()=>{
  it('uses one observer and one root rectangle per settling round',()=>{
    const h=setup();const root=h.element(10,20);const first=h.element(30,50);const second=h.element(60,80);
    const scheduler=createFrameMeasurements(()=>root);const values:any[]=[];
    scheduler.observeRegion(first,value=>values.push(value));scheduler.observeRegion(second,value=>values.push(value));scheduler.observeSize(first,value=>values.push(value));
    h.resize();h.resize();h.flush();
    // Initial publication is followed by one unchanged convergence check.
    expect(root.getBoundingClientRect).toHaveBeenCalledTimes(2);expect(h.add).toHaveBeenCalledTimes(1);
    expect(values[0]).toEqual({viewport:{width:390,height:844},region:{x:20,y:30,width:200,height:100}});
    h.resize();h.flush();expect(values).toHaveLength(3);scheduler.dispose();expect(h.disconnect).toHaveBeenCalledTimes(1);
  });
  it('publishes independent intrinsic reads in the same batch and refreshes font inputs',()=>{
    const h=setup();const root=h.element();const constrained=h.element(0,0,58,44);
    const scheduler=createFrameMeasurements(()=>root);const values:any[]=[];const contexts:any[]=[];
    let natural=88;
    scheduler.observeSize(constrained,value=>values.push(value),context=>{contexts.push(context);return{width:natural,height:44};});
    scheduler.observeSize(root,()=>{},context=>{contexts.push(context);return{width:200,height:100};});
    h.flush();expect(values).toEqual([{width:88,height:44}]);expect(contexts[0]).toBe(contexts[1]);
    natural=100;h.fontAdd.mock.calls[0][1]();h.flush();
    expect(values.at(-1)).toEqual({width:100,height:44});expect(contexts.at(-1).fontsRevision).toBe(1);
    expect(constrained.offsetWidth).toBe(58);scheduler.dispose();
  });
  it('switches root observation and coordinate origin after invalidation',()=>{
    const h=setup();let root=h.element(10,20);const old=root;const child=h.element(30,50);const values:any[]=[];
    const scheduler=createFrameMeasurements(()=>root);scheduler.observeRegion(child,value=>values.push(value));h.flush();
    root=h.element(20,40);scheduler.invalidate();h.flush();expect(h.unobserve).toHaveBeenCalledWith(old);expect(h.observe).toHaveBeenCalledWith(root);
    expect(values[1].region).toMatchObject({x:10,y:10});scheduler.dispose();
  });
  it('supports standalone regions and removes listeners plus pending callbacks on disposal',()=>{
    const h=setup();const scheduler=createFrameMeasurements(()=>undefined);const publish=vi.fn();const release=scheduler.observeRegion(h.element(200,300),publish);
    release();h.flush();expect(publish).not.toHaveBeenCalled();scheduler.observeRegion(h.element(200,300),publish);h.flush();expect(publish.mock.calls[0][0].region).toMatchObject({x:0,y:0});
    h.resize();scheduler.dispose();expect(h.frames.size).toBe(0);expect(h.remove).toHaveBeenCalledTimes(1);expect(h.fontRemove).toHaveBeenCalledTimes(1);
    h.resize();h.flush();expect(publish).toHaveBeenCalledTimes(1);
  });
  it('reveals only after font loading finishes and layout has settled',()=>{
    const h=setup();const root=h.element();const values:boolean[]=[];
    const fonts=document.fonts as unknown as {status:string};fonts.status='loading';
    const adapter=createFrameMeasurements(()=>root);
    adapter.observeRegion(root,()=>{});adapter.observeReady(ready=>values.push(ready));
    h.flush();expect(values).toEqual([false]);
    fonts.status='loaded';h.fontAdd.mock.calls[0][1]();h.flush();
    expect(values).toEqual([false,true]);
    // Later font requests update geometry without hiding an already shown table.
    fonts.status='loading';h.resize();h.flush();expect(values).toEqual([false,true]);
    adapter.dispose();
  });
  it('does not reveal a removed or disposed readiness subscriber',()=>{
    const h=setup();const adapter=createFrameMeasurements(()=>h.element());
    adapter.observeSize(h.element(),()=>{});
    const removed=vi.fn(),disposed=vi.fn();const release=adapter.observeReady(removed);release();
    h.flush();expect(removed.mock.calls).toEqual([[false]]);
    adapter.observeReady(disposed);expect(disposed.mock.calls).toEqual([[true]]);
    adapter.dispose();h.resize();h.flush();expect(disposed).toHaveBeenCalledTimes(1);
  });
  it('reads scroll tails before publishing layout writes and coalesces native scroll events',()=>{
    const h=setup();const element=h.element(0,0,100,20);
    let left=0,scrollWidth=300;const order:string[]=[],values:boolean[]=[];
    Object.defineProperties(element,{
      scrollLeft:{get(){order.push('read scroll');return left;}},
      scrollWidth:{get(){return scrollWidth;}},
    });
    const adapter=createFrameMeasurements(()=>undefined);
    adapter.observeSize(element,()=>{order.push('publish layout');});
    const release=adapter.observeOverflow(element,value=>values.push(value));
    h.flush();expect(order.indexOf('read scroll')).toBeLessThan(order.indexOf('publish layout'));
    expect(values).toEqual([true]);
    left=199;adapter.invalidate();adapter.invalidate();expect(h.frames.size).toBe(1);h.flush();
    expect(values).toEqual([true,false]);
    // Content changing inside the reservation is visible without a host resize.
    scrollWidth=400;adapter.invalidate();h.flush();expect(values).toEqual([true,false,true]);
    release();left=300;adapter.invalidate();h.flush();expect(values).toEqual([true,false,true]);
    adapter.dispose();
  });
  it('settles a position-only scroll-tail change without a resize or recursive frame',()=>{
    const h=setup();const element=h.element(0,0,100,20);let tail=200;
    Object.defineProperties(element,{scrollLeft:{get:()=>0},scrollWidth:{get:()=>tail}});
    const adapter=createFrameMeasurements(()=>undefined),values:boolean[]=[];
    adapter.observeOverflow(element,value=>values.push(value));
    adapter.observeSize(element,()=>{tail=100;adapter.invalidate();});
    h.flush();expect(values).toEqual([true,false]);expect(h.frames.size).toBe(0);
    adapter.dispose();
  });
});
