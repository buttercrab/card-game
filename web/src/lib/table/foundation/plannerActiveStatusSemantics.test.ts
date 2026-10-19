import {expect,test} from 'vitest';
import {planTable,validateLayout} from './planner';
import {shellDocument} from './shellFixture';
import type {CandidateLayout,ChoiceView,Environment,TableDocument} from './contracts';
const choices:ChoiceView={values:null,fields:[],commands:[],selected:null};
const environment=(width=1280,height=900,textScale=1):Environment=>({width,height,textScale,revision:'1',fontRevision:'1',fontFamily:'sans-serif',controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}});
function document(shell=true):TableDocument<string>{return {context:{session:'s',audience:'p0',generation:'g',revision:'1'},participant:{id:'p0',name:'나',markers:[]},opponents:[{id:'p1',name:'공개 주공',handCount:10},{id:'p2',name:'공개 프렌드',handCount:10}],hand:[],facts:[],...(shell?{shell:shellDocument().shell}:{}),information:[{id:'public-status',title:'상황',primary:{label:'공약',value:{kind:'inline',values:[{kind:'suit',suit:'Heart',label:'♥'},{kind:'number',value:17}]}},fields:[{id:'declarer',label:'주공',value:{kind:'participant',participantId:'p1'}},{id:'friend',label:'프렌드',value:{kind:'participant',participantId:'p2'}},{id:'round',label:'라운드',value:{kind:'text',text:'3/10'}}],summary:{text:'공개 주공 차례',tone:'plain'},progress:{label:'점수 카드',total:20,target:17,series:[{id:'team',label:'여당',value:4,from:'start',tone:'gold'},{id:'defense',label:'야당',value:3,from:'end',tone:'plain'}]}}],statusPresentation:{informationId:'public-status',fieldIds:['declarer','friend','round'],primary:true,summary:true,progress:true},decision:{kind:'commands',id:'waiting',commands:[]},offer:{id:'none',actions:[]}};}
function solve(doc:TableDocument<string>,env=environment()):CandidateLayout{const metrics=new Map();for(let turn=0;turn<20;turn++){const result=planTable(doc,env,choices,metrics);if(result.kind==='ready')return result.layout;if(result.kind!=='needs')throw Error(result.reason);for(const request of result.requests){const natural=request.text.length*8*env.textScale,width=request.width??natural;metrics.set(request.key,{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*20*env.textScale});}}throw Error('measurement did not settle');}
test.each([true,false])('shared active status preserves referenced contract/roles/round/turn and every progress series with shell %s',shell=>{
 const layout=solve(document(shell));expect(validateLayout(layout)).toEqual([]);
 const labels=layout.nodes.map(node=>node.label);for(const label of ['공약','♥','17','주공','공개 주공','프렌드','공개 프렌드','라운드','3/10','공개 주공 차례'])expect(labels).toContain(label);
 const progress=layout.nodes.filter(node=>node.id==='active-status-progress');expect(progress).toHaveLength(1);expect(progress[0]).toMatchObject({kind:'text',label:'여당 4/17 · 야당 3',accessibleDescription:'점수 카드 · 여당 4/17 · 야당 3 · 전체 20 · 목표 17'});
 const status=new Set(['table-active-status']);for(const node of layout.nodes)if(node.parent&&status.has(node.parent))status.add(node.id);expect(layout.nodes.filter(node=>status.has(node.id)&&node.kind==='text'&&node.label==='3/10')).toHaveLength(1);
});
test('progress rendering follows only the requested current panel and handles no target without inventing a threshold',()=>{
 const source=document(),panel=source.information![0];
 expect(solve({...source,statusPresentation:{...source.statusPresentation!,progress:false}}).nodes.some(node=>node.id==='active-status-progress')).toBe(false);
 const layout=solve({...source,information:[{...panel,progress:{label:'수집',total:10,series:[{id:'one',label:'첫째',value:0,from:'start',tone:'plain'},{id:'two',label:'둘째',value:10,from:'end',tone:'plain'}]}}]});
 expect(layout.nodes.find(node=>node.id==='active-status-progress')?.label).toBe('첫째 0 · 둘째 10');
});
