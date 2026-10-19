import {describe,expect,it} from 'vitest';
import {transferCandidates,flightPath} from './transferMotion';
import type {PlannedNode,PresentationFrame} from './contracts';
const stock=(id:string,count:number,x:number,y:number,width=64):PlannedNode=>({id,parent:null,kind:'card',zoneId:'stock',stockCount:count,label:'Neutral deck',visual:{kind:'back'},box:{x,y,width,height:width*140/100}});
const peer=(id:string,count:number):PlannedNode=>({id:`peer:${id}`,parent:null,kind:count?'card':'group',recipientId:id,recipientCount:count,label:count?id:'',...(!count?{inert:true}:{}),...(count?{visual:{kind:'back' as const}}:{}),box:{x:700,y:100,width:32,height:45}});
const card=(id:string,index:number):PlannedNode=>({id:`own:${id}`,entityId:id,parent:null,kind:'card',zoneId:'hand',label:id,visual:{kind:'standard',suit:'Spade',rank:index+2},box:{x:100+index*44,y:700,width:88,height:124}});
const frame=(generation:string,revision:string,nodes:readonly PlannedNode[]):PresentationFrame=>({id:Number(revision),context:{session:'room',audience:'me',generation,revision},environment:{revision:'same'} as PresentationFrame['environment'],offerId:revision,width:1000,height:1000,recipe:'stacked',rosterIds:['me','p1','p2','p3','p4'],nodes:[...nodes,{id:'own-count',parent:null,kind:'group',inert:true,label:'',ownHandAnchor:{participantId:'me',count:nodes.filter(node=>node.zoneId==='hand'&&node.entityId).length},box:{x:900,y:700,width:72,height:72}}]});
function fixture(){
 const peers=['p1','p2','p3','p4'],history:PlannedNode={...card('c0',0),id:'old-public-history',zoneId:'captured',collectionPurpose:'captured'};
 const previous={...frame('hand-1','1',[stock('old-stock',53,600,600,24),history,...peers.map(id=>peer(id,0))]),paintResources:{status:'available' as const,collections:[{id:'stock',purpose:'stock' as const,kind:'deck' as const,availability:'next-deal' as const,hiddenCount:53,cards:[]},{id:'captured',purpose:'captured' as const,availability:'current' as const,cards:[{entityId:'c0',visual:{kind:'standard' as const,suit:'Spade' as const,rank:2}}]}]},settled:true};
 const next={paintResources:{status:'available' as const,collections:[{id:'stock',purpose:'stock' as const,availability:'current' as const,hiddenCount:3,cards:[]}]},...frame('hand-2','2',[stock('new-stock',3,400,100),...peers.map(id=>peer(id,10)),...Array.from({length:10},(_,index)=>card(`c${index}`,index))]),deals:[{id:'next-hand',source:'stock',cardIds:[],handCount:10,recipients:peers.map(participantId=>({participantId,count:10}))}]};
 return {previous,next};
}
describe('settled-to-fresh count-proved deal origin',()=>{
 it('admits all50 backs from the new allocated neutral stock while cloning only the old neutral artifact',()=>{
  const {previous,next}=fixture(),transfers=transferCandidates(previous,next);expect(transfers).toHaveLength(50);expect(new Set(transfers.map(item=>item.entityId)).size).toBe(50);
  expect(transfers.every(item=>item.origin==='current'&&item.source.id==='new-stock'&&item.source.stockCount===3&&item.source.visual?.kind==='back'&&item.artifactSource?.id==='old-stock'&&item.artifactSource.stockCount===53&&item.artifactSource.visual?.kind==='back')).toBe(true);
  expect(transfers.filter(item=>item.destination.recipientId)).toHaveLength(40);expect(transfers.filter(item=>item.destination.zoneId==='hand')).toHaveLength(10);
  expect(transfers.every(item=>item.artifactSource?.entityId===undefined)).toBe(true);
 });
 it('keeps straight-path protection intact while an old result control no longer constrains a current-frame origin',()=>{
  const {previous,next}=fixture(),transfer=transferCandidates(previous,next)[0],clip={x:0,y:0,width:1000,height:1000},outgoingControl={x:400,y:600,width:100,height:200};
  expect(flightPath(previous.nodes[0].box,transfer.destination.box,clip,[outgoingControl])).toBeNull();
  expect(flightPath(transfer.source.box,transfer.destination.box,clip,[outgoingControl])).not.toBeNull();
  expect(flightPath(transfer.source.box,transfer.destination.box,clip,[{x:250,y:400,width:30,height:40}])).toBeNull();
 });
 it('requires settled history or an entirely empty neutral lobby, without generation-name assumptions',()=>{
  const {previous,next}=fixture();expect(transferCandidates({...previous,settled:false},next)).toEqual([]);
  const ordinary={...previous,paintResources:{status:'available' as const,collections:[{id:'stock',purpose:'stock' as const,availability:'current' as const,hiddenCount:53,cards:[]}]},settled:false,nodes:previous.nodes.filter(node=>!node.entityId)};
  const sameGeneration={...next,context:{...next.context,generation:ordinary.context.generation}};
  expect(transferCandidates(ordinary,sameGeneration)).toHaveLength(50);expect(transferCandidates(ordinary,sameGeneration).every(item=>item.origin==='current'&&item.source.id==='new-stock'&&item.artifactSource?.id==='old-stock')).toBe(true);
  expect(transferCandidates({...ordinary,paintResources:{status:'available',collections:[{id:'stock',purpose:'stock',availability:'current',hiddenCount:53,cards:[]},{id:'play',purpose:'play',availability:'current',cards:[{entityId:'face',visual:{kind:'standard',suit:'Spade',rank:2}}]}]},nodes:[...ordinary.nodes,{...card('face',0),zoneId:'play',collectionPurpose:'play'}]},sameGeneration)).toEqual([]);
  expect(transferCandidates({...ordinary,nodes:ordinary.nodes.map(node=>node.recipientId==='p1'?{...node,recipientCount:1}:node)},sameGeneration)).toEqual([]);
  expect(transferCandidates({...ordinary,deals:sameGeneration.deals},sameGeneration)).toEqual([]);
 });
 it('fails closed without a unique neutral current stock, exact conservation, participant counts or matching scope',()=>{
  const {previous,next}=fixture();
  for(const invalid of [
   {...next,settled:true},
   {...next,nodes:next.nodes.map(node=>node.id==='new-stock'?{...node,kind:'group' as const,visual:undefined}:node)},
   {...next,nodes:next.nodes.map(node=>node.id==='new-stock'?{...node,visual:{kind:'standard' as const,suit:'Heart' as const,rank:14}}:node)},
   {...next,nodes:[...next.nodes,{...next.nodes[0],id:'second-stock'}]},
   {...next,nodes:next.nodes.map(node=>node.id==='new-stock'?{...node,stockCount:4}:node)},
   {...next,nodes:next.nodes.map(node=>node.recipientId==='p1'?{...node,recipientCount:9}:node)},
   {...next,context:{...next.context,audience:'another-person'}},
   {...next,context:{...next.context,session:'another-room'}},
   {...next,environment:{...next.environment,revision:'resize'}},
  ])expect(transferCandidates(previous,invalid)).toEqual([]);
  expect(transferCandidates({...previous,nodes:[...previous.nodes,{...previous.nodes[0],id:'second-old-stock'}]},next)).toEqual([]);
  expect(transferCandidates({...previous,nodes:[...previous.nodes,card('old-private',0)]},next)).toEqual([]);
 });
});
