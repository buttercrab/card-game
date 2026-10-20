/** Focused headless seam checks, not browser/visual acceptance. All cases use normal (1×) text scale.
 * Run with Node plus an already installed TypeScript loader; no install needed. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planTable,validateLayout} from '../web/src/lib/table/foundation/planner';
import {createCardSession} from '../web/src/lib/table/foundation/session';
import {createCardTable} from '../web/src/lib/table/foundation/runtime';
import type {ChoiceView,Environment,Size,SurfaceCallbacks,SurfacePort,TableDocument} from '../web/src/lib/table/foundation/contracts';
const base:Environment={width:390,height:844,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const document:TableDocument<string>={context:{session:'scores',audience:'p',generation:'1',revision:'1'},participant:{id:'p',name:'재용',markers:[]},opponents:[{id:'q',name:'모과',handCount:0}],hand:[],facts:[],information:[{id:'status',title:'현재 상태',fields:[{id:'round',label:'라운드',value:{kind:'number',value:1}}]}],scoreboard:{id:'scores',title:'점수판',columns:[{id:'last',label:'점수'},{id:'total',label:'누적'}],rows:[{participantId:'p',values:[null,-20]},{participantId:'q',values:[4,20]}]},decision:{id:'play',kind:'commands',commands:['play']},offer:{id:'offer',actions:[{id:'play',kind:'command',label:'플레이',enabled:true,intent:'primary',action:'play'}]}};
const view:ChoiceView={values:null,fields:[],commands:[],selected:null};
function measured(request:{text:string;width:number|null;environment:Environment}):Size {const natural=[...request.text].length*10*request.environment.textScale,width=request.width??natural;return {width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*24*request.environment.textScale};}
function solve(env=base,choices:ChoiceView=view,doc=document){assert.equal(env.textScale,1,'This focused run is normal-scale only');const metrics=new Map<string,Size>();for(let pass=0;pass<24;pass++){const result=planTable(doc,env,choices,metrics);if(result.kind==='ready'){assert.deepEqual(validateLayout(result.layout),[]);return result.layout;}assert.equal(result.kind,'needs',JSON.stringify(result));if(result.kind==='needs')for(const request of result.requests)metrics.set(request.key,measured(request));}throw Error('Measurement did not converge');}
for(const [width,height,textScale] of [[320,568,1],[390,844,1],[768,1024,1],[1440,900,1],[390,390,1],[844,390,1]])test(`score modal fits or refuses without scroll at ${width}x${height} scale ${textScale}`,()=>{
 const layout=solve({...base,width,height,textScale},{...view,informationOpen:true,scoreboardOpen:true,scoreboardReturnToInformation:true});
 assert.equal(layout.modalId,'table-scoreboard-dialog');const owned=new Set([layout.modalId]);for(const node of layout.nodes)if(node.parent&&owned.has(node.parent))owned.add(node.id);
 const nodes=layout.nodes.filter(node=>owned.has(node.id));assert(nodes.every(node=>!node.scroll&&!node.actionId&&!node.cardId));assert(nodes.some(node=>node.id==='table-scoreboard-close'));assert(nodes.some(node=>node.id==='table-scoreboard-back'));
 const modal=nodes[0];assert(modal.box.height<=height-32);assert(nodes.some(node=>node.label.includes('누적 -20'))||nodes.some(node=>node.id==='table-scoreboard-refusal'));
});
test('information has a separate score opener rather than duplicated scores',()=>{const layout=solve(base,{...view,informationOpen:true});assert.equal(layout.modalId,'table-information-dialog');assert(layout.nodes.some(node=>node.localIntent==='toggle-scoreboard'));assert(!layout.nodes.some(node=>node.id.includes('current-information')&&node.id.includes('scoreboard')&&node.kind==='figure'));});
test('extreme scores and names refuse instead of truncating, shrinking, or scrolling',()=>{const doc={...document,participant:{...document.participant,name:'아주 긴 참가자 이름 '.repeat(10)},scoreboard:{...document.scoreboard!,rows:document.scoreboard!.rows.map(row=>({...row,values:[Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER]}))}};const layout=solve({...base,width:320,height:320,textScale:1},{...view,informationOpen:true,scoreboardOpen:true,scoreboardReturnToInformation:true},doc);assert(layout.nodes.some(node=>node.id==='table-scoreboard-refusal'));assert(!layout.nodes.some(node=>node.id.includes('current-scoreboard')));});
test('actual runtime info → score → back, close/focus, stale input and scope retirement',()=>{
 let callbacks:SurfaceCallbacks;let sends=0;const failures:unknown[]=[];
 const session=createCardSession<string>({transport:()=>{sends++;}});session.receive(document);
 const surface:SurfacePort={identity:{},environment:()=>base,listen(value){callbacks=value;return()=>{};},measure(requests,reply){reply(requests.map(request=>({key:request.key,size:measured(request)})));return()=>{};},publish(){},disarm(){},invalidate(){},fallback(value){failures.push(value);},clear(){}};
 const table=createCardTable({session});table.attach(surface);
 const frame=()=>{assert.deepEqual(failures,[]);assert(table.inspect().frame);return table.inspect().frame!;};
 const activate=(id:string,frameId=frame().id)=>callbacks.intent({kind:'activate',provenance:'direct',frameId,nodeId:id});
 const opener=frame().nodes.find(node=>node.localIntent==='toggle-information'&&node.enabled)!.id;activate(opener);assert.equal(frame().modalId,'table-information-dialog');
 const scoreOpener=frame().nodes.find(node=>node.localIntent==='toggle-scoreboard')!.id;activate(scoreOpener);assert.equal(frame().modalId,'table-scoreboard-dialog');const held=frame().id;
 session.receive({...document,context:{...document.context,revision:'2'},scoreboard:{...document.scoreboard!,rows:[{participantId:'p',values:[null,-30]},{participantId:'q',values:[4,30]}]}});assert.equal(frame().modalId,'table-scoreboard-dialog');assert(frame().nodes.some(node=>node.label.includes('누적 -30')));
 activate('table-scoreboard-close',held);assert.equal(frame().modalId,'table-scoreboard-dialog');
 const play=frame().nodes.find(node=>node.actionId==='play');if(play)activate(play.id);assert.equal(session.snapshot().operations.length,0);
 assert(table.back());assert.equal(frame().modalId,'table-information-dialog');assert.equal(table.inspect().focusId,scoreOpener);
 activate('table-scoreboard-close',held);assert.equal(frame().modalId,'table-information-dialog');
 activate(scoreOpener);activate('table-scoreboard-close');assert.equal(frame().modalId,undefined);assert.equal(table.inspect().focusId,opener);
 activate(opener);activate(scoreOpener);session.setConnected(false);callbacks.intent({kind:'dismiss',frameId:frame().id});assert.equal(frame().modalId,'table-information-dialog');
 activate(scoreOpener);session.setConnected(true);session.receive({...document,scoreboard:undefined,context:{...document.context,revision:'3'}});assert(frame().nodes.some(node=>node.id==='table-scoreboard-refusal'));assert(table.back());assert.equal(frame().modalId,'table-information-dialog');session.receive(document);activate(scoreOpener);session.receive({...document,context:{...document.context,generation:'2',revision:'2'}});assert.equal(frame().modalId,undefined);assert.equal(sends,0);
 table.dispose();session.dispose();
});

test('opening scores does not move or resize any underlying table node',()=>{const closed=solve(),opened=solve(base,{...view,informationOpen:true,scoreboardOpen:true});for(const node of closed.nodes){const other=opened.nodes.find(item=>item.id===node.id);assert(other);assert.deepEqual(other.box,node.box,node.id);}});
test('score close icon permits only its exact readonly close artwork',()=>{
 const layout=solve(base,{...view,informationOpen:true,scoreboardOpen:true}),close=layout.nodes.find(node=>node.id==='table-scoreboard-close')!,icon=layout.nodes.find(node=>node.parent===close.id)!;
 for(const patch of [{actionId:'play'},{fieldId:'choice'},{formIntent:'submit'},{localIntent:'toggle-scoreboard'},{shellIcon:'menu'},{kind:'group'}]){
  const nodes=layout.nodes.map(node=>node.id===icon.id?{...node,...patch}:node);
  assert(validateLayout({...layout,nodes:nodes as typeof layout.nodes}).length>0,JSON.stringify(patch));
 }
});
test('legacy inline expansion does not open the separate modal or alter closed-state navigation',()=>{const layout=solve(base,{...view,scoreboardExpanded:true});assert.equal(layout.modalId,undefined);assert(!layout.nodes.some(node=>node.id==='table-scoreboard-dialog'));assert(layout.nodes.some(node=>node.localIntent==='toggle-information'));});
test('refused score content can fit again after resize with complete values and unchanged type roles',()=>{
 const choices={...view,informationOpen:true,scoreboardOpen:true,scoreboardReturnToInformation:true};
 const narrow=solve({...base,width:320,height:320,textScale:1},choices);assert(narrow.nodes.some(node=>node.id==='table-scoreboard-refusal'));
 const wide=solve({...base,width:1440,height:900,textScale:1},choices);assert(!wide.nodes.some(node=>node.id==='table-scoreboard-refusal'));assert(wide.nodes.some(node=>node.label.includes('누적 -20')));assert(wide.nodes.some(node=>node.label.includes('누적 20')));
 for(const node of wide.nodes.filter(node=>node.id.includes('current-scoreboard')&&node.kind==='text'))assert(['body','name','small'].includes(node.role!));
});
