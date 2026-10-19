import {expect,test} from 'vitest';
import {isFoundationRoute} from './rootRoute';
test.each(['/r/abc123','/r/abc123/'])('real room %s boots the isolated engine by default',path=>{
 expect(isFoundationRoute(path,'')).toBe(true);
 expect(isFoundationRoute(path,'?foundation=1')).toBe(true);
 expect(isFoundationRoute(path,'?unrelated=1')).toBe(true);
 expect(isFoundationRoute(path,'?foundation=0')).toBe(false);
});
test('developer previews stay opt-in and ordinary pages keep the application root',()=>{
 for(const path of ['/preview','/preview/']){expect(isFoundationRoute(path,'')).toBe(false);expect(isFoundationRoute(path,'?foundation=1')).toBe(true);expect(isFoundationRoute(path,'?foundation=0')).toBe(false);}
 for(const path of ['/','/about','/rules/default','/r/','/r/abc/extra'])expect(isFoundationRoute(path,'?foundation=1')).toBe(false);
});
