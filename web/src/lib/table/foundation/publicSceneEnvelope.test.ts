import {expect,test} from 'vitest';
import {publicSceneEnvelope,PublicSceneUnavailable} from './publicSceneEnvelope';

test('one parent owns felt, instruction and dock without a phase or offer input',()=>{
 const input={viewport:{width:1280,height:800},region:{width:1248,height:700},mainWidth:936,dockHeight:182,instructionHeight:37};
 const first=publicSceneEnvelope(input);
 expect(first.arena.y+first.arena.height).toBeLessThanOrEqual(first.instruction.y);
 expect(first.instruction.y+first.instruction.height).toBe(first.dock.y);
 expect(first.dock.y+first.dock.height).toBe(input.region.height);
 expect(first.arena.width).toBeCloseTo(first.arena.height*1.35);
 expect(publicSceneEnvelope({...input,minimumArenaHeight:first.arena.height})).toEqual(first);
 expect(()=>publicSceneEnvelope({...input,minimumArenaHeight:first.arena.height+.01})).toThrow(PublicSceneUnavailable);
 expect(()=>publicSceneEnvelope({...input,minimumArenaHeight:first.arena.height+180})).toThrow(PublicSceneUnavailable);
});
test('responsive recomposition is deterministic and refuses invalid measured inputs',()=>{
 const input={viewport:{width:1440,height:900},region:{width:1408,height:800},mainWidth:1050,dockHeight:190,instructionHeight:37};
 expect(publicSceneEnvelope(input)).toEqual(publicSceneEnvelope({...input,viewport:{...input.viewport},region:{...input.region}}));
 for(const value of [NaN,Infinity,-1])expect(()=>publicSceneEnvelope({...input,dockHeight:value})).toThrow();
});

test('every viewport and region dimension is finite and positive before issuing a scene',()=>{
 const input={viewport:{width:1280,height:800},region:{width:1248,height:700},mainWidth:936,dockHeight:182,instructionHeight:37};
 for(const value of [-1,0,NaN,Infinity,-Infinity])for(const key of ['width','height'] as const){expect(()=>publicSceneEnvelope({...input,viewport:{...input.viewport,[key]:value}}),`viewport.${key}=${value}`).toThrow();expect(()=>publicSceneEnvelope({...input,region:{...input.region,[key]:value}}),`region.${key}=${value}`).toThrow();}
 for(const value of [-1,0,NaN,Infinity,-Infinity])expect(()=>publicSceneEnvelope({...input,mainWidth:value})).toThrow();
 expect(()=>publicSceneEnvelope({...input,mainWidth:input.region.width+1})).toThrow();
 expect(()=>publicSceneEnvelope({...input,dockHeight:Number.MAX_VALUE,instructionHeight:Number.MAX_VALUE})).toThrow();
 expect(()=>publicSceneEnvelope({...input,region:{...input.region,height:Number.MAX_VALUE/2},dockHeight:Number.MAX_VALUE/4,minimumArenaHeight:Number.MAX_VALUE})).toThrow();
});


test('a positive region cannot issue an overcommitted dock or a zero-felt scene',()=>{
 const input={viewport:{width:1280,height:800},region:{width:1248,height:100},mainWidth:936,dockHeight:150,instructionHeight:0};
 expect(()=>publicSceneEnvelope(input)).toThrow(PublicSceneUnavailable);expect(()=>publicSceneEnvelope({...input,minimumArenaHeight:300})).toThrow(PublicSceneUnavailable);
 const fitted=publicSceneEnvelope({...input,region:{...input.region,height:700}});
 expect(()=>publicSceneEnvelope({...input,region:{...input.region,height:fitted.frame.dockHeight}})).toThrow(PublicSceneUnavailable);
});
