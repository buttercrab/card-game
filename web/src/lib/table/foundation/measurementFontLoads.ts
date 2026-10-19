import {textFontFamily} from './informationTypography';
import type {MeasureRequest} from './contracts';
import {typography} from './planner';

/** FontFaceSet.load uses sample codepoints only to select unicode-range faces;
 * it does not shape or measure this string. Keep every requested codepoint and
 * the existing explicit space, without rescanning thousands of repeated labels.
 * Real probe text remains unchanged. No font readiness is cached across calls.
 * https://www.w3.org/TR/css-font-loading/#font-face-set-load
 */
export function measurementFontLoads(requests:readonly MeasureRequest[]):readonly {font:string;text:string}[]{
    const fonts=new Map<string,Set<string>>();
    for(const request of requests){
        const recipe=typography(request.role,request.environment);
        const family=textFontFamily(request.role,request.environment);
        const font=`${recipe.fontWeight} ${recipe.fontSize}px ${family}`;
        let points=fonts.get(font);
        if(!points){points=new Set([' ']);fonts.set(font,points);}
        for(const point of request.text)points.add(point);
    }
    // A separator also prevents separately requested lone high/low surrogates
    // from becoming a different astral codepoint when the sample is joined.
    return [...fonts].map(([font,points])=>({font,text:[...points].join(' ')}));
}
