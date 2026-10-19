import {expect,test} from 'vitest';
import type {ChoiceView,Environment,Size,TableDocument} from './contracts';
import {planTable,typography,validateLayout} from './planner';
const environment:Environment={width:390,height:844,revision:'batch',fontRevision:'batch',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
test('more than 512 missing metrics drain in bounded reentrant batches without losing text',()=>{
 const document:TableDocument<never>={context:{session:'batch',audience:'observer',generation:'1',revision:'1'},participant:{id:'observer',name:'관전자',role:'observer',markers:[]},hand:[],facts:Array.from({length:300},(_,index)=>({id:`fact-${index}`,label:`고유 제목 ${index}`,value:`고유 본문 ${index}`,subject:'table',essential:false})),decision:{id:'none',kind:'commands',commands:[]},offer:{id:'none',actions:[]}};
 const choices:ChoiceView={selected:null,values:{},fields:[],commands:[]},metrics=new Map<string,Size>();let batches=0,fullBatches=0;
 for(let pass=0;pass<12;pass++){
  const result=planTable(document,environment,choices,metrics);
  if(result.kind==='ready'){expect(batches).toBeGreaterThan(1);expect(fullBatches).toBeGreaterThan(0);expect(metrics.size).toBeGreaterThan(512);expect(metrics.size).toBeLessThanOrEqual(2048);expect(validateLayout(result.layout)).toEqual([]);for(let index=0;index<300;index++)expect([...metrics.keys()].some(key=>key.includes(`고유 본문 ${index}`))).toBe(true);return;}
  if(result.kind!=='needs')throw Error(JSON.stringify(result));expect(result.requests.length).toBeLessThanOrEqual(512);expect(result.requests.length).toBeGreaterThan(0);batches++;if(result.requests.length===512)fullBatches++;
  for(const request of result.requests){expect(metrics.has(request.key)).toBe(false);const natural=[...request.text].length*9*environment.textScale,width=request.width??natural;metrics.set(request.key,{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(request.role,environment).lineHeight});}
 }
 throw Error('bounded measurement batches did not converge');
});
