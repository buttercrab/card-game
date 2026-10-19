import { describe, expect, it, vi } from 'vitest';
import { createCardSession } from './session';
import { planTable, validateLayout } from './planner';
import type { CandidateLayout, CardCollection, ChoiceView, Environment, MeasureRequest, Size, TableDocument } from './contracts';
const control={fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1};
const environment:Environment={width:390,height:844,fontFamily:'sans-serif',textScale:1,fontRevision:'1',revision:'1',controls:{command:control,choice:control}};
const view:ChoiceView={values:{},fields:[],commands:[],selected:null};
function document(relevance?:CardCollection['relevance'],hiddenCount=53):TableDocument<string>{return {context:{session:'s',audience:'me',generation:'g',revision:'1'},participant:{id:'observer',name:'Observer',role:'observer',markers:[]},hand:[],facts:[],collections:[{id:'stock',label:'Deck',purpose:'stock',kind:'deck',cards:[],hiddenCount,...(relevance?{relevance}:{})}],decision:{id:'decision',kind:'commands',commands:[]},offer:{id:'offer',actions:[]}};}
function metric(request:MeasureRequest):Size{const natural=Array.from(request.text).length*10*request.environment.textScale,line=(request.role==='small'?20:request.role==='name'?26:24)*request.environment.textScale;return {width:request.width===null?natural:Math.min(request.width,natural),height:Math.max(1,request.width===null?1:Math.ceil(natural/Math.max(1,request.width)))*line};}
function solve(source:TableDocument<string>):CandidateLayout{const metrics=new Map<string,Size>();for(let pass=0;pass<6;pass++){const result=planTable(source,environment,view,metrics);if(result.kind==='ready'){expect(validateLayout(result.layout)).toEqual([]);return result.layout;}if(result.kind!=='needs')throw Error(JSON.stringify(result));for(const request of result.requests)metrics.set(request.key,metric(request));}throw Error('Relevance measurements did not converge');}
describe('semantic collection relevance',()=>{
 it('keeps default and primary stock at64×90 while auxiliary stock uses24×34 with the same real count',()=>{
  for(const relevance of [undefined,'primary','auxiliary'] as const){const source=document(relevance),layout=solve(source),stocks=layout.nodes.filter(node=>node.zoneId==='stock'&&node.stockCount!==undefined);expect(stocks).toHaveLength(1);const stock=stocks[0];expect(stock.stockCount).toBe(53);expect(stock.visual).toEqual({kind:'back'});expect(stock.entityId).toBeUndefined();expect(stock.cardId).toBeUndefined();expect(stock.actionId).toBeUndefined();expect(stock.enabled).not.toBe(true);expect(stock.box).toMatchObject(relevance==='auxiliary'?{width:24,height:34}:{width:64,height:90});expect(source.collections![0].hiddenCount).toBe(53);}
 });
 it('does not paint a nonexistent back when auxiliary stock count is zero',()=>{
  const layout=solve(document('auxiliary',0)),stock=layout.nodes.find(node=>node.zoneId==='stock'&&node.stockCount===0)!;expect(stock).toBeDefined();expect(stock.kind).toBe('group');expect(stock.visual).toBeUndefined();expect(stock.box).toMatchObject({width:24,height:34});
 });
 it('owns supported relevance and rejects an unsupported string without replacing the canonical document',()=>{
  const session=createCardSession<string>({transport:vi.fn()});for(const relevance of [undefined,'primary','auxiliary'] as const){session.receive(document(relevance));expect(session.snapshot().document?.collections?.[0].relevance).toBe(relevance);expect(Object.isFrozen(session.snapshot().document?.collections?.[0])).toBe(true);}
  const before=session.snapshot().document,invalid={...document(),collections:[{...document().collections![0],relevance:'dominant'}]};expect(()=>session.receive(invalid as TableDocument<string>)).toThrow(/relevance/);expect(session.snapshot().document).toBe(before);expect(session.snapshot().connected).toBe(true);session.dispose();
 });
});
