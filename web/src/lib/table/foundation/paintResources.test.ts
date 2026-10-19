import {expect,test,vi} from 'vitest';
import {publicPaintResources,PAINT_RESOURCE_LIMITS} from './paintResources';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {CandidateLayout,Environment,SurfaceCallbacks,TableDocument} from './contracts';
const doc=():TableDocument<string>=>({context:{session:'s',audience:'me',generation:'g',revision:'1'},participant:{id:'me',name:'Me',markers:[]},opponents:[{id:'peer',name:'Peer',handCount:1}],hand:[{id:'PRIVATE',label:'PRIVATE',visual:{kind:'standard',suit:'Heart',rank:14}}],facts:[],collections:[{id:'stock',label:'Not AX',purpose:'stock',hiddenCount:3,cards:[]},{id:'trick',label:'No resource labels',kind:'trick',purpose:'play',cards:[{id:'public',label:'Public',ownerId:'peer',visual:{kind:'standard',suit:'Spade',rank:2}}]}],decision:{id:'commands',kind:'commands',commands:['pass']},offer:{id:'offer',actions:[{id:'pass',label:'Pass',kind:'command',intent:'primary',enabled:true,action:'canonical'}]}});
test('extracts only immutable public art membership independently of table selection and private hand',()=>{
 const source=doc(),unselected:TableDocument<string>={...source,presentation:{id:'none',schemaVersion:1,tableCollectionIds:[]}},all=publicPaintResources(source),none=publicPaintResources(unselected);expect(none).toEqual(all);expect(all.status).toBe('available');if(all.status!=='available')throw Error('Expected resources');
 expect(all.collections[0]).toEqual({id:'stock',purpose:'stock',availability:'current',hiddenCount:3,cards:[]});expect(all.collections[1].cards[0]).toEqual({entityId:'public',ownerId:'peer',visual:{kind:'standard',suit:'Spade',rank:2}});
 expect(JSON.stringify(all)).not.toMatch(/PRIVATE|label|box|parent|action|checked|enabled|focus/);expect(Object.isFrozen(all.collections[1].cards[0].visual)).toBe(true);
 source.collections![1].cards[0].visual.kind==='standard'&&(source.collections![1].cards[0].visual.rank=14);expect(all.collections[1].cards[0].visual).toMatchObject({rank:2});
});
test('unavailable resource budgets never truncate or expand anonymous stock into physical cards',()=>{
 const source=doc();expect(publicPaintResources({...source,collections:[{id:'many',label:'Stock',purpose:'stock',hiddenCount:10000,cards:[]}]})).toEqual({status:'available',collections:[{id:'many',purpose:'stock',availability:'current',hiddenCount:10000,cards:[]}]});
 const collections=Array.from({length:PAINT_RESOURCE_LIMITS.collections+1},(_,i)=>({id:`c${i}`,label:'',cards:[]}));expect(publicPaintResources({...source,collections})).toEqual({status:'unavailable',reason:'budget'});
 const cards=Array.from({length:PAINT_RESOURCE_LIMITS.cards+1},(_,i)=>({...source.collections![1].cards[0],id:`face${i}`}));expect(publicPaintResources({...source,collections:[{id:'large',label:'',cards}]})).toEqual({status:'unavailable',reason:'budget'});
 const bytes=Array.from({length:600},(_,i)=>({...source.collections![1].cards[0],id:`${i}:`+'x'.repeat(2000)}));expect(publicPaintResources({...source,collections:[{id:'bytes',label:'',cards:bytes}]})).toEqual({status:'unavailable',reason:'budget'});
});
test('unsupported memberships and accessors fail closed without reading getters',()=>{
 const source=doc(),getter=vi.fn(()=> 'Spade'),visual={kind:'standard',rank:2};Object.defineProperty(visual,'suit',{get:getter,enumerable:true});
 const card=source.collections![1].cards[0];Object.defineProperty(card,'visual',{value:visual,enumerable:true});expect(publicPaintResources(source)).toEqual({status:'unavailable',reason:'unsupported'});expect(getter).not.toHaveBeenCalled();
 const duplicate=doc();expect(publicPaintResources({...duplicate,collections:[...duplicate.collections!,duplicate.collections![0]]})).toEqual({status:'unavailable',reason:'unsupported'});
});
test('runtime overwrites planner resource/envelope accessors and preserves control admission when extraction is unavailable',async()=>{
 const source={...doc(),collections:Array.from({length:4097},(_,i)=>({id:`zone${i}`,label:'Zone',cards:[]}))};
 const session=createCardSession<string>({transport:vi.fn()});session.receive(source);const resources=vi.fn(()=>({status:'available',collections:[{id:'PRIVATE'}]})),completion=vi.fn(()=>({event:'forged'}));let callbacks!:SurfaceCallbacks;
 const control={fontSize:15,lineHeight:18,fontWeight:600,paddingX:10,paddingY:10,minHeight:44,pulse:1},environment:Environment={width:500,height:700,textScale:1,revision:'1',fontRevision:'1',fontFamily:'sans',controls:{command:control,choice:control}};
 const layout:CandidateLayout={width:500,height:700,recipe:'stacked',nodes:[{id:'table',parent:null,kind:'group',label:'Table',box:{x:0,y:0,width:500,height:700}},{id:'pass',parent:'table',kind:'command',label:'Pass',actionId:'pass',enabled:true,box:{x:10,y:10,width:100,height:44}}]};Object.defineProperty(layout,'paintResources',{get:resources,enumerable:true});Object.defineProperty(layout,'publicCompletion',{get:completion,enumerable:true});
 const table=createCardTable({session,planner:()=>({kind:'ready',layout})});table.attach({identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure:()=>()=>{},publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback:reason=>{throw Error(reason);},clear:()=>{}});
 expect(table.inspect().frame?.paintResources).toEqual({status:'unavailable',reason:'budget'});expect(table.inspect().frame?.publicCompletion).toBeUndefined();expect(resources).not.toHaveBeenCalled();expect(completion).not.toHaveBeenCalled();expect(session.snapshot().document!.collections).toHaveLength(4097);
 callbacks.intent({kind:'activate',provenance:'direct',frameId:table.inspect().frame!.id,nodeId:'pass'});expect(session.snapshot().operations).toHaveLength(1);table.dispose();session.dispose();
});
