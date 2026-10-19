import {expect,it} from 'vitest';
import {bubbleTypography} from '../feedbackLayout';
import {typography} from './planner';
import {textFontFamily} from './informationTypography';
import type {Environment} from './contracts';
import {measureParticipantCaption,participantCaptionRecipe} from './participantCaption';
const read=(scale:number)=>(text:string,width:number|null)=>{const natural=[...text].length*6*scale,allocation=width??natural;return {width:Math.min(natural,allocation),height:14.4*scale*Math.max(1,Math.ceil(natural/Math.max(1,allocation)))};};
it.each([1,2])('uses the preserved bid bubble and SuitText artwork at scale%s',scale=>{const source=bubbleTypography('bid',false,false,false),recipe=participantCaptionRecipe(scale),plan=measureParticipantCaption([{kind:'suit',suit:'Heart',label:'하트'},{kind:'number',value:14}],200,scale,read(scale));expect(recipe).toMatchObject({fontSize:source.fontSize*scale,lineHeight:source.fontSize*source.lineHeight*scale,fontWeight:700,minHeight:20*scale,paddingX:6,paddingY:1,border:1});expect(plan.height).toBe(20*scale);expect(plan.content.parts[0].width).toBeCloseTo(12*scale*.92,12);expect(plan.content.parts[0].height).toBe(12*scale*.92);expect(plan.width).toBeLessThan(80*scale);expect(Object.isFrozen(plan.content.parts)).toBe(true);});
it('long permanent facts get their full measured multiline footprint',()=>{const plan=measureParticipantCaption([{kind:'text',text:'이것은 여러 줄에 걸친 참가자의 공개 상태입니다'}],90,2,read(2));expect(plan.height).toBeGreaterThan(40);expect(plan.width).toBeLessThanOrEqual(90);for(const part of plan.content.parts){expect(part.x+part.width).toBeLessThanOrEqual(plan.width-plan.insetX*2);expect(plan.insetY+part.y+part.height).toBeLessThanOrEqual(plan.height);}});
it('untyped symbols remain literal text and invalid budgets refuse',()=>{const plan=measureParticipantCaption([{kind:'text',text:'♥ 14'}],90,1,read(1));expect(plan.content.parts.map(part=>part.atom.kind)).toEqual(['text']);expect(()=>measureParticipantCaption([{kind:'suit',suit:'Heart',label:'하트'}],15,1,read(1))).toThrow();expect(()=>participantCaptionRecipe(NaN)).toThrow();});

it.each([1,2])('announcement measurement and paint retain original typography and body family at scale%s',textScale=>{
 const environment={textScale,fontFamily:'Body Face',artFontFamily:'Card Face'} as Environment;
 expect(typography('announcement',environment)).toEqual({fontSize:12*textScale,lineHeight:12*1.2*textScale,fontWeight:700});
 expect(textFontFamily('announcement',environment)).toBe('Body Face');
});
