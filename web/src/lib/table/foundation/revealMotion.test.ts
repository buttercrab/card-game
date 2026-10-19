import {expect,test} from 'vitest';
import {transferCandidates} from './transferMotion';
import type {FramePaintCard,FramePaintResources} from './paintResources';
import type {PlannedNode,PresentationFrame} from './contracts';
const card=(id:string,zoneId='play'):PlannedNode=>({id,entityId:id,parent:null,kind:'card',label:id,zoneId,collectionPurpose:zoneId==='captured'?'captured':'play',visual:{kind:'standard',suit:'Heart',rank:2},box:{x:0,y:0,width:64,height:90}});
const peer=(id:string,count:number):PlannedNode=>({id,recipientId:id,recipientCount:count,parent:null,kind:'group',inert:true,label:'',box:{x:0,y:0,width:48,height:48}});
const face=(entityId:string,ownerId?:string):FramePaintCard=>({entityId,...(ownerId?{ownerId}:{}),visual:{kind:'standard',suit:'Heart',rank:2}});
const resources=(play:readonly FramePaintCard[]=[],captured:readonly FramePaintCard[]=[]):PresentationFrame['paintResources']=>({status:'available',collections:[{id:'play',purpose:'play',availability:'current',cards:play},{id:'captured',purpose:'captured',availability:'current',cards:captured}]});
const frame=(revision:string,nodes:readonly PlannedNode[],paintResources=resources()):PresentationFrame=>({id:1,context:{session:'s',audience:'a',generation:'g',revision},environment:{revision:'e'} as PresentationFrame['environment'],paintResources,nodes,width:1000,height:1000,recipe:'stacked'} as PresentationFrame);
const previous=()=>frame('1',[peer('p',10),peer('q',10)]);
const next=():PresentationFrame=>({...frame('2',[peer('p',9),peer('q',10),card('new')],resources([face('new')])),reveals:[{participantId:'p',cardId:'new'}]});
test('newly public play leaves a reconciled inert seat source using only the new authorized face',()=>{
    const result=transferCandidates(previous(),next());expect(result).toHaveLength(1);expect(result[0]).toMatchObject({entityId:'new',presentation:'face',revealed:true,source:{recipientId:'p',kind:'group',inert:true},destination:{entityId:'new'}});
    expect(result[0].source.entityId).toBeUndefined();expect(result[0].source.visual).toBeUndefined();expect(transferCandidates(null,next())).toEqual([]);
});
test('public trick collection and its final anonymous play form one jointly reconciled batch',()=>{
    const old={...previous(),paintResources:resources([face('old')]),nodes:[...previous().nodes,card('old')]};
    const after={...next(),paintResources:resources([face('new')],[face('old')]),nodes:[...next().nodes,card('old','captured')]};
    const result=transferCandidates(old,after);expect(result.map(item=>item.presentation)).toEqual(['face','face']);expect(new Set(result.map(item=>item.entityId)).size).toBe(2);
});
test('reveal batches reject count drift, changed membership, duplicate hints and unknown sources',()=>{
    for(const changed of [
        {...next(),nodes:[peer('p',10),peer('q',10),card('new')]},
        {...next(),nodes:[peer('p',9),peer('q',9),card('new')]},
        {...next(),nodes:[peer('p',9),card('new')]},
        {...next(),reveals:[...next().reveals!,...next().reveals!]},
        {...next(),reveals:[{participantId:'foreign',cardId:'new'}]},
        {...next(),deals:[{id:'d',source:'stock',cardIds:['new']}]},
    ])expect(transferCandidates(previous(),changed)).toEqual([]);
});
test('reveals cannot target private, nonsemantic, back or ambiguous destinations',()=>{
    for(const changed of [
        {...next(),nodes:[peer('p',9),peer('q',10),card('new','hand')]},
        {...next(),paintResources:{status:'available',collections:[{id:'play',availability:'current',cards:[face('new')]}]} satisfies FramePaintResources,nodes:[peer('p',9),peer('q',10),{...card('new'),collectionPurpose:undefined}]},
        {...next(),nodes:[peer('p',9),peer('q',10),{...card('new'),visual:{kind:'back' as const}}]},
        {...next(),nodes:[...next().nodes,{...card('new'),id:'duplicate'}]},
    ])expect(transferCandidates(previous(),changed)).toEqual([]);
});
test('reveals reconcile every local hand card and reject unexplained additions or removals',()=>{
    const local=card('local','hand'),old={...previous(),nodes:[...previous().nodes,local]};
    expect(transferCandidates(old,next())).toEqual([]);
    expect(transferCandidates(old,{...next(),nodes:[...next().nodes,local]})).toHaveLength(1);
    expect(transferCandidates(previous(),{...next(),nodes:[...next().nodes,local]})).toEqual([]);
    expect(transferCandidates(old,{...next(),paintResources:resources([face('new')],[face('local')]),nodes:[...next().nodes,card('local','captured')]})).toHaveLength(2);
});
test('all public and mixed batches share the eight-transfer limit',()=>{
    const canonical=Array.from({length:9},(_,i)=>face(String(i))),old=frame('1',Array.from({length:9},(_,i)=>card(String(i),'play')),resources(canonical)),after=frame('2',old.nodes.map(node=>({...node,zoneId:'captured'})),resources([],canonical));
    expect(transferCandidates(old,after)).toEqual([]);
    expect(transferCandidates({...old,paintResources:resources(canonical.slice(0,8)),nodes:old.nodes.slice(0,8)},{...after,paintResources:resources([],canonical.slice(0,8)),nodes:after.nodes.slice(0,8)})).toHaveLength(8);
});

test('runtime independently rejects a reveal whose destination names another public owner',()=>{
 const destination={...card('new'),ownerId:'q'};
 expect(transferCandidates(previous(),{...next(),paintResources:resources([face('new','p')]),nodes:[peer('p',9),peer('q',10),destination]})).toEqual([]);
 expect(transferCandidates(previous(),{...next(),paintResources:resources([face('new','p')]),nodes:[peer('p',9),peer('q',10),{...destination,ownerId:'p'}]})).toHaveLength(1);
});
