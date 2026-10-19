import {expect,test} from 'vitest';
import type {PlannedNode} from './contracts';
import {createJointPointerPaint,jointPointerNodeIds} from './jointPointerPaint';
import {validateJointDecisionLayers} from './jointDecisionValidation';

const box={x:0,y:0,width:400,height:300};
function fixture():PlannedNode[]{return [
    {id:'active-table-content',parent:null,kind:'group',label:'',arrangement:'ordinary',box,jointDecisionLayer:true},
    {id:'arena',parent:'active-table-content',kind:'group',label:'',box:{...box,height:200}},
    {id:'dock',parent:'active-table-content',kind:'group',label:'',box:{x:0,y:220,width:400,height:80}},
    {id:'table-decision-strip',parent:'active-table-content',kind:'group',label:'',box:{x:100,y:100,width:200,height:56}},
    {id:'submit',parent:'table-decision-strip',kind:'command',label:'Play',enabled:true,actionId:'play',box:{x:0,y:0,width:100,height:44},paintChildren:true},
    {id:'caption',parent:'submit',kind:'text',label:'Play',box:{x:5,y:5,width:30,height:24}},
    {id:'icon',parent:'submit',kind:'icon',label:'',shellIcon:'hint',box:{x:40,y:5,width:24,height:24}},
    {id:'later-empty',parent:'arena',kind:'group',label:'',box:{x:100,y:100,width:200,height:56}},
    {id:'fan',parent:'dock',kind:'group',label:'Hand',scroll:true,scrollAxis:'x',box:{x:0,y:0,width:200,height:80}},
    {id:'own-card',parent:'fan',kind:'card',label:'Own card',cardId:'c',enabled:true,box:{x:0,y:0,width:44,height:62}},
];}
function element(tagName:string){return {tagName,style:{pointerEvents:''},disabled:false,inert:false,dataset:{foundationFrame:'21',foundationAction:'play'},attributes:new Map([['aria-label','Play']])};}

test('joint passive text/SVG and later transparent groups pass hits to the existing native control',()=>{
    const nodes=fixture(),ids=jointPointerNodeIds(nodes),paint=createJointPointerPaint();
    expect(validateJointDecisionLayers(nodes).errors).toEqual([]);expect(ids.size).toBe(nodes.length);
    const button=element('BUTTON'),text=element('SPAN'),svg=element('svg'),empty=element('DIV');
    const before={disabled:button.disabled,inert:button.inert,dataset:{...button.dataset},attributes:new Map(button.attributes)};
    for(const [native,id] of [[button,'submit'],[text,'caption'],[svg,'icon'],[empty,'later-empty']] as const)paint(native,nodes.find(node=>node.id===id)!,ids.has(id));
    expect(button.style.pointerEvents).toBe('auto');
    for(const native of [text,svg,empty])expect(native.style.pointerEvents).toBe('none');
    // Reverse paint-order policy, not a substitute for browser elementFromPoint.
    expect([empty,svg,text,button].find(native=>native.style.pointerEvents!=='none')).toBe(button);
    expect({disabled:button.disabled,inert:button.inert,dataset:button.dataset,attributes:button.attributes}).toEqual(before);
});

test('existing native inputs and declared hand/decision scroll viewports remain hit targets without creating authority',()=>{
    const paint=createJointPointerPaint();
    for(const tag of ['BUTTON','SELECT','INPUT','TEXTAREA']){const native=element(tag);native.disabled=true;native.inert=true;paint(native,{},true);expect(native.style.pointerEvents).toBe('auto');expect(native.disabled).toBe(true);expect(native.inert).toBe(true);}
    for(const scroll of [{id:'fan',scroll:true,scrollAxis:'x'},{id:'decisions',scroll:true,scrollAxis:'y'}] as const){const native=element('DIV');paint(native,scroll,true);expect(native.style.pointerEvents).toBe('auto');}
    const passive=element('DIV');paint(passive,{},true);expect(passive.style.pointerEvents).toBe('none');
});

test('every previously owned pointer style resets on reuse outside the joint layer; observer paint retains priority',()=>{
    const paint=createJointPointerPaint();
    for(const native of [element('BUTTON'),element('SPAN'),element('DIV')]){paint(native,{scroll:native.tagName==='DIV'},true);paint(native,{},false);expect(native.style.pointerEvents).toBe('');}
    const observer=element('DIV');paint(observer,{observerReactionLayer:true},true);expect(observer.style.pointerEvents).toBe('none');paint(observer,{observerReactionLayer:true},false);expect(observer.style.pointerEvents).toBe('none');
    paint(observer,{},false);expect(observer.style.pointerEvents).toBe('');
    const unmarked=element('DIV');unmarked.style.pointerEvents='native-owner';paint(unmarked,{},false);expect(unmarked.style.pointerEvents).toBe('native-owner');
});

test('forged scalar markers and overlapping full scroll planes do not receive joint pointer paint',()=>{
    const forged=fixture().map(node=>node.id==='active-table-content'?{...node,label:'forged'}:node);
    expect(validateJointDecisionLayers(forged).errors.length).toBeGreaterThan(0);expect(jointPointerNodeIds(forged).size).toBe(0);
    const obstructed=fixture().map(node=>node.id==='later-empty'?{...node,scroll:true,scrollAxis:'x' as const}:node);
    expect(validateJointDecisionLayers(obstructed).errors).toContain('Joint decision paint overlap: arena, table-decision-strip');
    expect(jointPointerNodeIds(obstructed).size).toBe(0);
});

test('a forged marker alongside a valid joint layer refuses the whole native pointer scope and resets prior paint',()=>{
    const valid=fixture(),mixed:PlannedNode[]=[...valid,{id:'forged',parent:null,kind:'group',label:'',arrangement:'ordinary',box,jointDecisionLayer:true}];
    expect(jointPointerNodeIds(valid).has('submit')).toBe(true);
    expect(validateJointDecisionLayers(mixed).errors.length).toBeGreaterThan(0);
    const refused=jointPointerNodeIds(mixed);expect(refused.size).toBe(0);
    const paint=createJointPointerPaint(),button=element('BUTTON'),passive=element('DIV');
    for(const native of [button,passive]){paint(native,{},true);paint(native,{},refused.has('submit'));expect(native.style.pointerEvents).toBe('');}
});
