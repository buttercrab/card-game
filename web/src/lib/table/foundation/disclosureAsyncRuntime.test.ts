import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {Environment,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
import type {DisclosureDocument} from './disclosureTypes';
import type {DisclosureReadPolicy} from './disclosures';
const environment:Environment={width:500,height:700,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const context={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'socket',audience:'alice:0'};
const catalog={id:'history',policyId:'history:v1',revision:'1',title:'지난 판',total:2,pageSize:12 as const,scope:{roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'socket',visibility:'public' as const}};
const document:TableDocument<string>={context:{session:'room',audience:'alice:0',generation:'hand1',revision:'1'},participant:{id:'alice',name:'Alice',markers:[]},hand:[],facts:[],decision:{id:'waiting',kind:'commands',commands:[]},offer:{id:'none',actions:[]},disclosures:[catalog],disclosureContext:context,shell:{roomCode:'room',header:{codeLabel:'room',connection:'open',connectionLabel:'연결됨',observerCount:0,observerLabel:'관전자 0명',requestCount:0,requestLabel:'참여 0건',actions:[{id:'history-open',purpose:'scores',label:'지난 판',enabled:true,intent:{kind:'open-disclosure',catalogId:'history'}}]},pages:[{id:'menu',title:'메뉴',actions:[]}],notices:[],effects:[]}};
const detail=(entryId:string):DisclosureDocument=>({entryId,title:'완료한 판',roster:[],cards:[],sections:[{id:'summary',kind:'content',title:'요약'}]});
function fixture(select:DisclosureReadPolicy['select'],outcome=false,total=2){
 const send=vi.fn(),session=createCardSession<string>({transport:send,disclosurePolicies:[{id:'history:v1',page:()=>({catalogId:'history',revision:'1',page:0,total,pageSize:12,entries:[{id:'a',title:'첫 판'},{id:'b',title:'둘째 판'}].slice(0,total)}),select}]});session.receive(outcome?{...document,disclosures:[{...catalog,total}],information:[{id:'result',title:'이번 판 결과',fields:[{id:'winner',label:'결과',value:{kind:'text',text:'승리'}}]}],outcome:{id:'hand1-result',informationId:'result',continuationActionIds:[],detailsCatalogId:'history'}}:document);
 let callbacks!:SurfaceCallbacks;
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure(requests,reply){reply(requests.map(request=>({key:request.key,size:{width:Math.min(request.width??400,Math.max(20,request.text.length*9)),height:28}})));return()=>{};},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn(),preserveModal:vi.fn()};
 const table=createCardTable({session});table.attach(surface);
 const click=(label:string)=>{const frame=table.inspect().frame!;expect(frame).not.toBeNull();const node=frame.nodes.find(node=>node.kind==='command'&&node.label===label);expect(node,`${label}: ${frame.nodes.map(node=>node.label).join(',')}`).toBeDefined();callbacks.intent({kind:'activate',nodeId:node!.id,frameId:frame.id,provenance:'direct'});expect(surface.fallback).not.toHaveBeenCalled();};
 const labels=()=>table.inspect().frame?.nodes.map(node=>node.label)??[];
 return{session,table,surface,send,click,labels,get callbacks(){return callbacks;},dismiss(){callbacks.intent({kind:'dismiss',frameId:table.inspect().frame!.id});},dispose(){table.dispose();session.dispose();}};
}
const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
test('real runtime and shared measured dialog repaint async loading and completion, then close without a game command',async()=>{
 let resolve!:(value:DisclosureDocument)=>void;const f=fixture(()=>new Promise(done=>{resolve=done;}));f.click('지난 판');f.click('첫 판');expect(f.labels()).toContain('기록을 불러오는 중이에요');expect(f.labels()).not.toContain('첫 판');expect(f.labels()).toContain('기록 목록');expect(f.labels()).toContain('닫기');resolve(detail('a'));await settle();expect(f.labels()).toContain('완료한 판');expect(f.labels()).not.toContain('기록을 불러오는 중이에요');f.click('닫기');expect(f.session.disclosures.snapshot()).toEqual({});expect(f.send).not.toHaveBeenCalled();f.dispose();
});
test('real runtime repaints a throwing sync provider failure through the coalesced session observer',async()=>{
 const f=fixture(()=>{throw Error('private cause');});f.click('지난 판');f.click('첫 판');await settle();expect(f.labels()).toContain('기록을 읽지 못했어요. 다시 열어주세요.');expect(f.labels()).not.toContain('첫 판');f.click('기록 목록');expect(f.labels()).toContain('첫 판');expect(f.send).not.toHaveBeenCalled();f.dispose();
});

test.each(['close','dismiss','back'] as const)('canonical result details restores 더보기 on %s',mode=>{
 const f=fixture((_offer,entryId)=>detail(entryId),true);
 const opener=f.table.inspect().frame!.nodes.find(node=>node.disclosureCatalogId==='history')!;expect(opener.label).toBe('더보기');
 f.click('더보기');f.click('첫 판');
 if(mode==='close')f.click('닫기');
 else if(mode==='dismiss')f.dismiss();
 else {f.table.back();f.table.back();}
 expect(f.table.inspect().frame?.modalId).toBeUndefined();expect(f.table.inspect().frame?.focusId).toBe(opener.id);expect(f.send).not.toHaveBeenCalled();f.dispose();
});

test.each([false,true])('async result close survives native focus loss but rejects retired scope (%s)',retire=>{
 const f=fixture((_offer,entryId)=>detail(entryId),true);f.click('더보기');f.click('첫 판');
 const prior=f.table.inspect().frame!.id,measure=f.surface.measure;
 let pending:(()=>void)|undefined;
 f.surface.measure=(requests,reply)=>{pending=()=>{pending=undefined;measure(requests,reply);};return()=>{};};
 f.click('닫기');expect(f.table.inspect().status).toBe('measuring');
 f.callbacks.intent({kind:'focus',frameId:prior,nodeId:null});
 if(retire){const source=f.session.snapshot().document!;f.session.receive({...source,context:{...source.context,generation:'hand2',revision:'2'}});}
 for(let i=0;pending&&i<10;i++)pending();
 expect(f.table.inspect().status).toBe('ready');expect(f.table.inspect().frame?.focusId).toBe(retire?null:'outcome-details');f.dispose();
});

test('auto-selected single completed record retains the result opener',()=>{
 const f=fixture((_offer,entryId)=>detail(entryId),true,1);f.click('더보기');expect(f.labels()).toContain('완료한 판');f.click('닫기');expect(f.table.inspect().frame?.focusId).toBe('outcome-details');f.dispose();
});

test.each(['same-record','new-catalog-revision','new-outcome','new-scope','focus-moved-away'] as const)('retained outcome opener restoration waits for current binding (%s)',mode=>{
 const f=fixture((_offer,entryId)=>detail(entryId),true,1),source=f.session.snapshot().document!;
 f.click('더보기');
 const {detailsCatalogId,...retainedOutcome}=source.outcome!;
 f.session.receive({...source,context:{...source.context,revision:'2'},outcome:retainedOutcome});
 expect(f.labels()).toContain('테이블 정보');f.click('닫기');expect(f.table.inspect().frame?.focusId).toBeNull();
 if(mode==='focus-moved-away')f.callbacks.intent({kind:'focus',frameId:f.table.inspect().frame!.id,nodeId:null});
 f.session.receive({...source,context:{...source.context,revision:'3',...(mode==='new-scope'?{generation:'hand2'}:{})},...(mode==='new-outcome'?{outcome:{...source.outcome!,id:'another-result'}}:{}),...(mode==='new-catalog-revision'?{disclosures:source.disclosures!.map(offer=>({...offer,revision:'r2'}))}:{})});
 expect(f.table.inspect().frame?.focusId).toBe(mode==='same-record'?'outcome-details':null);f.dispose();
});
