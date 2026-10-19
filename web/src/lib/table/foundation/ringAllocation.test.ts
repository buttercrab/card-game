import {expect,test} from 'vitest';
import {allocateRing} from './ringAllocation';
import {numericComposition} from './composition';
test('an already admitted ring preserves its exact wing and center',()=>{expect(allocateRing({width:600,gap:12,preferredWing:144,minimumWing:60,minimumCenter:88})).toEqual({wing:144,centerWidth:288});});
test('a full natural label width may wrap while artwork and the actual center remain intact',()=>{expect(allocateRing({width:288,gap:12,preferredWing:144,minimumWing:60,minimumCenter:88})).toEqual({wing:88,centerWidth:88});expect(allocateRing({width:273,gap:12,preferredWing:144,minimumWing:60,minimumCenter:88})).toEqual({wing:80.5,centerWidth:88});});
test('unfittable artwork or a legible glyph minimum rejects the recipe before construction',()=>{expect(allocateRing({width:273,gap:12,preferredWing:144,minimumWing:82,minimumCenter:88})).toBeNull();expect(allocateRing({width:160,gap:12,preferredWing:144,minimumWing:60,minimumCenter:88})).toBeNull();});
test('invalid caller dimensions remain errors rather than a clamped candidate',()=>{for(const value of [-1,NaN,Infinity])expect(()=>allocateRing({width:value,gap:12,preferredWing:144,minimumWing:60,minimumCenter:88})).toThrow();expect(()=>numericComposition.column(-24,[],12,0)).toThrow('Invalid composition allocation');});
