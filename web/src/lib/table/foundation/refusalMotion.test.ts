import {describe,expect,it} from 'vitest';
import {refusalMotionRecipe} from './domMotion';
describe('bounded refusal paint recipe',()=>{
 it('returns to rest within150ms and the existing3px footprint clearance',()=>{const recipe=refusalMotionRecipe('full')!;const offsets=recipe.frames.map(frame=>Number(String(frame.transform).match(/translateX\((-?\d+)px\)/)![1]));expect(offsets[0]).toBe(0);expect(offsets.at(-1)).toBe(0);expect(offsets.some(value=>value<0)).toBe(true);expect(offsets.some(value=>value>0)).toBe(true);expect(offsets.every(value=>Math.abs(value)<=3)).toBe(true);expect(recipe.timing.duration).toBe(150);});
 it('honors reduced/off motion and bounded speed without inventing native side effects',()=>{expect(refusalMotionRecipe('off')).toBeNull();expect(refusalMotionRecipe('reduced')).toBeNull();expect(refusalMotionRecipe('full',0)).toBeNull();expect(refusalMotionRecipe('full',NaN)).toBeNull();expect(refusalMotionRecipe('full',0.5)?.timing.duration).toBe(75);expect(refusalMotionRecipe('full',5)?.timing.duration).toBe(150);});
});
