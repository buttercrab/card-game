import {expect,test} from 'vitest';
import {directionalTrickRecipe,REGULAR_TRICK} from './directionalTrickLayout';

test.each([{width:64,height:90,gap:12},{width:48,height:68,gap:8},{width:88,height:124,gap:12}])('directional admission and every actual slot share measured dimensions %j',({width,height,gap})=>{
 const recipe=directionalTrickRecipe({width,height},gap);expect(recipe.slots(recipe.minimumWidth-.001)).toBeNull();const slots=recipe.slots(recipe.minimumWidth)!;expect(slots).toHaveLength(5);expect(recipe.height).toBe(height*2+gap);
 for(const slot of slots){expect(slot.width).toBe(width);expect(slot.height).toBe(height);expect(slot.x).toBeGreaterThanOrEqual(0);expect(slot.y).toBeGreaterThanOrEqual(0);expect(slot.x+slot.width).toBeLessThanOrEqual(recipe.minimumWidth);expect(slot.y+slot.height).toBeLessThanOrEqual(recipe.height);}
 for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){const a=slots[i],b=slots[j],dx=Math.max(b.x-a.x-a.width,a.x-b.x-b.width),dy=Math.max(b.y-a.y-a.height,a.y-b.y-b.height);expect(Math.max(dx,dy)).toBeGreaterThanOrEqual(gap-1e-10);}
 expect(slots[3].x-slots[4].width).toBeCloseTo(gap);expect(slots[1].x-slots[2].x-slots[2].width).toBeCloseTo(gap);
});
test('existing regular artwork and footprint remain unchanged',()=>{expect(REGULAR_TRICK.card).toEqual({width:64,height:90});expect(REGULAR_TRICK.minimumWidth).toBe(324);expect(REGULAR_TRICK.height).toBe(192);expect(REGULAR_TRICK.slots(324)?.map(({x,y})=>({x,y}))).toEqual([{x:130,y:102},{x:260,y:51},{x:184,y:0},{x:76,y:0},{x:0,y:51}]);});
test('caller mutation cannot separate the admitted footprint from the placement artwork',()=>{const art={width:64,height:90},recipe=directionalTrickRecipe(art,12);art.width=1;art.height=1;expect(recipe.minimumWidth).toBe(324);expect(recipe.slots(324)?.every(box=>box.width===64&&box.height===90)).toBe(true);expect(Object.isFrozen(recipe)).toBe(true);expect(Object.isFrozen(recipe.card)).toBe(true);});
