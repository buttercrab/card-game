import { afterEach, expect, test, vi } from 'vitest';
import { cssViewport } from './domViewport';
afterEach(()=>vi.unstubAllGlobals());
test('uses CSS viewport dimensions while transient mobile overflow enlarges the window readings',()=>{
  vi.stubGlobal('document',{documentElement:{clientWidth:390,clientHeight:844}});
  vi.stubGlobal('innerWidth',980);vi.stubGlobal('innerHeight',2121);
  expect(cssViewport()).toEqual({width:390,height:844});
});
test('falls back to window dimensions before the document exposes a viewport',()=>{
  vi.stubGlobal('document',{documentElement:{clientWidth:0,clientHeight:0}});
  vi.stubGlobal('innerWidth',800);vi.stubGlobal('innerHeight',360);
  expect(cssViewport()).toEqual({width:800,height:360});
});
