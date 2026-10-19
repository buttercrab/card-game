import {expect,test} from 'vitest';
import type {Environment,MeasureRequest,TextRole} from './contracts';
import {measurementFontLoads} from './measurementFontLoads';

const environment:Environment={width:390,height:844,revision:'r1',fontRevision:'f1',fontFamily:'Body Font',artFontFamily:'Art Font',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const request=(text:string,role:TextRole='body',env=environment):MeasureRequest=>({key:JSON.stringify([text,role]),text,role,width:null,environment:env});
test('deduplicates codepoints while preserving every Unicode-range match and real probe text',()=>{
    const texts=['공약 ♠ 255','공약 ♠ 155','😀👩‍💻 e\u0301\ufe0f\t\n  ','\ud800'],requests=texts.map(text=>request(text));
    const [load]=measurementFontLoads(requests);
    expect(load.font).toBe('400 16px Body Font');
    expect(new Set(load.text)).toEqual(new Set(` ${texts.join(' ')}`));
    expect([...load.text].filter(point=>point!==' ')).toHaveLength([...new Set(load.text)].filter(point=>point!==' ').length);
    expect(requests.map(value=>value.text)).toEqual(texts);
});
test('keeps font family, size, weight, role and environment boundaries exact',()=>{
    const loads=measurementFontLoads([request('body'),request('small','small'),request('button','button'),request('choice','choice'),request('art','art'),request('display','display'),request('large','body',{...environment,textScale:2}),request('fallback','art',{...environment,artFontFamily:undefined})]);
    expect(loads.map(value=>value.font)).toEqual(['400 16px Body Font','400 14px Body Font','600 15px Body Font','800 22px Art Font','800 44px Art Font','400 32px Body Font','800 22px Body Font']);
    expect(new Set(loads.find(value=>value.font==='600 15px Body Font')!.text)).toEqual(new Set(' button choice'));
});
test('recomputes each invocation including added subsets and retains empty-text space semantics',()=>{
    expect(measurementFontLoads([])).toEqual([]);
    expect(measurementFontLoads([request('')])).toEqual([{font:'400 16px Body Font',text:' '}]);
    expect(new Set(measurementFontLoads([request('A')])[0].text)).toEqual(new Set(' A'));
    expect(new Set(measurementFontLoads([request('한')])[0].text)).toEqual(new Set(' 한'));
});
test('the supported cold batch samples repeated labels once per distinct codepoint',()=>{
    const requests=Array.from({length:512},(_,index)=>request(`공약 스페이드 ${index%255+1}`,'button'));
    const [load]=measurementFontLoads(requests);
    expect(new Set(load.text)).toEqual(new Set(` ${requests.map(value=>value.text).join(' ')}`));
    expect(load.text.length).toBeLessThan(60);expect(requests).toHaveLength(512);
});
test('does not combine separate lone surrogates into a new Unicode-range match',()=>{
    for(const texts of [['\ud800','\udc00'],['x\ud800x\udc00']]){
        const [load]=measurementFontLoads(texts.map(text=>request(text)));
        expect(new Set(load.text)).toEqual(new Set(` ${texts.join(' ')}`));
        expect(load.text).not.toContain('\u{10000}');
    }
});
