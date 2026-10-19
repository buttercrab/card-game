import {expect,test} from 'vitest';
import {NATIVE_TEXT_CONTROL,nativeTextControlHeight,nativeTextControlStyle} from './nativeTextControl';
test('native border-box allocation reserves every line plus the exact painted padding and border',()=>{
 for(const scale of [1,1.25,1.5,2,3])for(const lines of [1,4]){
  const line=24*scale,height=nativeTextControlHeight(line,lines);
  expect(height-2*NATIVE_TEXT_CONTROL.borderWidth-2*NATIVE_TEXT_CONTROL.paddingY).toBeGreaterThanOrEqual(line*lines);
 }
 expect(nativeTextControlStyle).toEqual({padding:'10px 12px',border:'1px solid var(--line)'});
 expect(Object.isFrozen(NATIVE_TEXT_CONTROL)).toBe(true);expect(Object.isFrozen(nativeTextControlStyle)).toBe(true);
});
test('invalid native metrics cannot produce a control allocation',()=>{for(const value of [NaN,Infinity,0,-1])expect(()=>nativeTextControlHeight(value)).toThrow();for(const lines of [0,5,1.5,NaN])expect(()=>nativeTextControlHeight(24,lines)).toThrow();});
