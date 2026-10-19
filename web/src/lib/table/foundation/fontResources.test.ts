import { expect, test } from 'vitest';
import { createFontResources, type FontMetricResource } from './fontResources';
const face = (overrides: Partial<FontMetricResource> = {}) => ({status:'loaded',family:'Table font',style:'normal',weight:'100 900',unicodeRange:'U+0-FFFF',...overrides});
test('repeated completion notifications preserve the metric generation',()=>{
    const fonts=createFontResources(),first=face(),second=face({unicodeRange:'U+10000-1FFFF'});
    const initial=fonts.revision([first,second]);
    for(let iteration=0;iteration<100;iteration++)expect(fonts.revision([first,second])).toBe(initial);
});
test('a newly available face changes metrics even with the same family and face count',()=>{
    const fonts=createFontResources(),first=face();
    const initial=fonts.revision([first]);
    expect(fonts.revision([face()])).not.toBe(initial);
});
test('loading settlement, removal and matching-order changes invalidate metrics',()=>{
    const fonts=createFontResources(),pending=face({status:'loading'}),loaded=face();
    const initial=fonts.revision([pending,loaded]);
    pending.status='loaded';const settled=fonts.revision([pending,loaded]);expect(settled).not.toBe(initial);
    const reordered=fonts.revision([loaded,pending]);expect(reordered).not.toBe(settled);
    expect(fonts.revision([loaded])).not.toBe(reordered);
});
test('changes to font matching and metric overrides invalidate an existing face',()=>{
    const fonts=createFontResources(),resource=face({ascentOverride:'normal',variationSettings:'normal'});
    let before=fonts.revision([resource]);
    for(const change of [{weight:'400'},{ascentOverride:'90%'},{variationSettings:'"wght" 650'},{unicodeRange:'U+0-FF'}]){
        Object.assign(resource,change);const after=fonts.revision([resource]);expect(after).not.toBe(before);before=after;
    }
});
