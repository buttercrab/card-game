import {expect,test} from 'vitest';
import {largeChoiceDocument} from './largeChoiceFixture';
import {planTable,typography,validateLayout} from './planner';
import type {ChoiceView,Environment,MeasureRequest,Size} from './contracts';
const base:Environment={width:320,height:568,revision:'ring',fontRevision:'font',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
function solve(textScale:number,scrollbarWidth:number,wideGlyph=false){
 const original=largeChoiceDocument({longName:true}),document=wideGlyph?{...original,opponents:original.opponents!.map((person,index)=>({...person,name:`W · ${index}`}))}:original;
 const env={...base,textScale,scrollbarWidth},choices:ChoiceView={values:{amount:'1'},fields:document.decision.kind==='finite-choice'?document.decision.fields:[],commands:[{id:'pass',label:'패스',intent:'secondary',enabled:true}],selected:{id:'amount:1',label:'확정 금액 1',intent:'primary',enabled:true}},metrics=new Map<string,Size>();
 const measure=(request:MeasureRequest)=>{const natural=[...request.text].reduce((sum,char)=>sum+(wideGlyph&&char==='W'?100:10),0)*textScale;return{width:request.width===null?natural:Math.min(natural,request.width),height:Math.max(1,request.width===null?1:Math.ceil(natural/Math.max(1,request.width)))*typography(request.role,env).lineHeight};};
 for(let pass=0;pass<18;pass++){const result=planTable(document,env,choices,metrics);if(result.kind==='ready')return{document,layout:result.layout};if(result.kind!=='needs')throw Error(JSON.stringify(result));for(const request of result.requests)metrics.set(request.key,measure(request));}throw Error('Ring candidate did not converge');
}
for(const scale of [1,1.5,2,3])test.each([0,15])(`valid native choices retain complete peer art and labels at320 scale${scale} gutter%s`,gutter=>{
 const {document,layout}=solve(scale,gutter);expect(validateLayout(layout)).toEqual([]);for(const peer of document.opponents!){const figure=layout.nodes.find(node=>node.kind==='figure'&&node.ownerId===peer.id)!;expect(figure.box.width).toBe(48);expect(figure.box.height).toBe(44);expect(layout.nodes.some(node=>node.kind==='text'&&node.label===peer.name)).toBe(true);}
 const select=layout.nodes.find(node=>node.kind==='select')!;expect(select.options).toHaveLength(197);expect(select.box.width).toBeGreaterThanOrEqual(44);expect(select.box.height).toBeGreaterThanOrEqual(44);expect(layout.nodes.some(node=>node.label.startsWith('1 · 여러 언어'))).toBe(true);expect(layout.nodes.filter(node=>node.kind==='command'&&node.enabled).every(node=>node.box.width>=44&&node.box.height>=44)).toBe(true);
});
test('a controlled wide name glyph metric chooses the existing peer fallback before constructing an invalid ring',()=>{
 const {document,layout}=solve(1,15,true);expect(validateLayout(layout)).toEqual([]);expect(layout.nodes.some(node=>node.id==='opponents-left')).toBe(false);expect(layout.nodes.some(node=>node.id==='opponents-right')).toBe(false);for(const peer of document.opponents!)expect(layout.nodes.some(node=>node.kind==='text'&&node.label===peer.name)).toBe(true);expect(layout.height).toBeGreaterThan(base.height);
});
