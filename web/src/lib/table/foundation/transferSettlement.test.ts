import {describe,expect,it,vi} from 'vitest';
import {createDomTransfers,createSettlementReporter} from './domTransfers';
import type {PresentationFrame} from './contracts';
import type {MotionSettlement} from './feedback';
const frame=(id=1,generation='hand-1'):PresentationFrame=>({id,context:{session:'room',audience:'me',generation,revision:String(id)},offerId:'offer',environment:{width:390,height:844,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}},width:390,height:844,recipe:'stacked',nodes:[]});
describe('motion settlement event identity',()=>{
 it('consumes an event once across natural completion, resize and snap attempts',()=>{const report=vi.fn(),settle=createSettlementReporter(report),event={eventId:'play-1',entityIds:['card']};settle(frame(),event,'arrived');settle(frame(2),event,'revoked');settle(frame(3),event,'snapped');expect(report).toHaveBeenCalledExactlyOnceWith({frameId:1,eventId:'play-1',entityIds:['card'],outcome:'arrived'});});
 it('consumes revoked events without replay while allowing another event for the same card',()=>{const reports:MotionSettlement[]=[],settle=createSettlementReporter(value=>reports.push(value));settle(frame(),{eventId:'play-1',entityIds:['card']},'revoked');settle(frame(2),{eventId:'play-1',entityIds:['card']},'snapped');settle(frame(3),{eventId:'collect-1',entityIds:['card']},'arrived');expect(reports.map(value=>[value.eventId,value.outcome])).toEqual([['play-1','revoked'],['collect-1','arrived']]);});
 it('permits a new scoped event without rebasing a previous callback to its new frame',()=>{const report=vi.fn(),settle=createSettlementReporter(report),event={eventId:'play-1',entityIds:['card']};settle(frame(),event,'revoked');settle(frame(7,'hand-2'),event,'snapped');settle(frame(1),event,'arrived');expect(report.mock.calls.map(([value])=>value.frameId)).toEqual([1,7]);});
 it('never lets a feedback sink exception interrupt motion cleanup',()=>{const report=vi.fn(()=>{throw Error('optional effect');}),settle=createSettlementReporter(report),event={eventId:'play-1',entityIds:['card']};expect(()=>settle(frame(),event,'revoked')).not.toThrow();settle(frame(2),event,'snapped');expect(report).toHaveBeenCalledTimes(1);});
 it('never settles during preparation and snaps no-flight arrivals only on visible-publication callback',()=>{
  const report=vi.fn(),transfers=createDomTransfers({dataset:{}} as HTMLElement,report),next={...frame(),feedbackArrivals:[{eventId:'play-1',entityIds:['card']}],nodes:[{id:'card-node',parent:null,kind:'card' as const,label:'public card',entityId:'card',box:{x:0,y:0,width:64,height:90}}]},elements=new Map([['card-node',{} as HTMLElement]]);
  expect(transfers.prepare(null,next,elements)).toEqual([]);expect(report).not.toHaveBeenCalled();
  transfers.settleVisible(next,elements);expect(report).toHaveBeenCalledExactlyOnceWith({frameId:1,eventId:'play-1',entityIds:['card'],outcome:'snapped'});
  transfers.clear();transfers.settleVisible({...next,id:2},elements);expect(report).toHaveBeenCalledTimes(1);
 });
 it('consumes an unrepresented arrival as revoked rather than replaying it after later geometry',()=>{
  const report=vi.fn(),transfers=createDomTransfers({dataset:{}} as HTMLElement,report),next={...frame(),feedbackArrivals:[{eventId:'play-1',entityIds:['card']}]};
  transfers.settleVisible(next,new Map());expect(report).toHaveBeenCalledExactlyOnceWith({frameId:1,eventId:'play-1',entityIds:['card'],outcome:'revoked'});
 });

 it('uses exact room/connection epochs when a later scope legitimately reuses an event ID',()=>{const report=vi.fn(),settle=createSettlementReporter(report),event={eventId:'event',entityIds:['card']},base={session:'room',audience:'me',generation:'hand-1',roomEpoch:'room-epoch',connectionEpoch:'connection-1'};settle({...frame(),feedbackScope:base},event,'snapped');settle({...frame(2),feedbackScope:{...base,connectionEpoch:'connection-2'}},event,'snapped');expect(report).toHaveBeenCalledTimes(2);});

 it('withholds only staged-chain events while settling unrelated visible paint through the same reporter',()=>{
  const report=vi.fn(),transfers=createDomTransfers({dataset:{}} as HTMLElement,report),next={...frame(),feedbackArrivals:[{eventId:'chain',entityIds:['chain-card']},{eventId:'unrelated',entityIds:['other-card']}],nodes:['chain-card','other-card'].map(id=>({id,parent:null,kind:'card' as const,label:'Public card',entityId:id,box:{x:0,y:0,width:32,height:45}}))},elements=new Map(next.nodes.map(node=>[node.id,{} as HTMLElement]));
  transfers.settleVisible(next,elements,new Set(['chain-card']));expect(report.mock.calls.map(([value])=>value.eventId)).toEqual(['unrelated']);transfers.settleEntities(next,['chain-card'],'arrived');expect(report.mock.calls.map(([value])=>[value.eventId,value.outcome])).toEqual([['unrelated','snapped'],['chain','arrived']]);transfers.settleVisible(next,elements);expect(report).toHaveBeenCalledTimes(2);
 });

});
