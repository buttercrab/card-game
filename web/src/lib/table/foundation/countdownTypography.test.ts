import {expect,test} from 'vitest';
import {countdownTypography} from './countdownTypography';
test('countdown growth preserves the original font and scales bottom clearance rather than clipping the figure',()=>{
 expect(countdownTypography(1)).toEqual({fontSize:20,x:105,y:113});
 for(const scale of [.75,1.25,1.5,2,3]){const value=countdownTypography(scale);expect(value.fontSize).toBe(20*scale);expect(120-value.y).toBeGreaterThanOrEqual(7*scale-1e-10);expect(Object.isFrozen(value)).toBe(true);}
});
test('countdown typography refuses unsupported scales rather than shrinking semantic text',()=>{for(const scale of [NaN,Infinity,0,.74,3.01])expect(()=>countdownTypography(scale)).toThrow();});
