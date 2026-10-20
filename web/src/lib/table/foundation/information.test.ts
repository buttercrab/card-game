import {describe,it,expect} from 'vitest';
import {createCardSession} from './session';
import {validateInformation} from './information';
import {informationDocument} from './informationFixture';
import {planTable,validateLayout} from './planner';
import type {TableDocument,Environment,Size,ChoiceView} from './contracts';
const fixture=():TableDocument<string>=>({
 context:{session:'s',audience:'p',generation:'1',revision:'1'},participant:{id:'p',name:'재용',markers:[]},
 opponents:[{id:'q',name:'모과',handCount:10}],hand:[],facts:[],decision:{id:'wait',kind:'commands',commands:[]},offer:{id:'o',actions:[]},
 information:[{id:'status',title:'상황판',summary:{text:'내 차례',tone:'accent'},primary:{label:'공약',value:{kind:'inline',values:[{kind:'suit',suit:'Spade',label:'스페이드'},{kind:'number',value:17}]}},fields:[{id:'friend',label:'프렌드',value:{kind:'card',label:'마이티',visual:{kind:'standard',suit:'Spade',rank:14}}}],progress:{label:'점수 카드',total:20,target:17,series:[{id:'a',label:'여당',value:4,tone:'gold',from:'start'},{id:'b',label:'야당',value:2,tone:'plain',from:'end'}]}}],
 scoreboard:{id:'scores',title:'점수판',columns:[{id:'hand',label:'점수'},{id:'total',label:'누적'}],rows:[{participantId:'p',values:[null,-20]},{participantId:'q',values:[4,20],badges:[{text:'주공',tone:'gold'}]}]}
});
const controls={command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}};
const choices:ChoiceView={values:null,fields:[],commands:[],selected:null,scoreboardExpanded:true};
function solve(doc:TableDocument<string>,width:number,textScale=1,height=844,view:ChoiceView=choices){
 const env:Environment={width,height,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale,controls};
 const metrics=new Map<string,Size>();
 for(let pass=0;pass<8;pass++){
  const result=planTable(doc,env,view,metrics);
  if(result.kind==='ready')return result.layout;
  if(result.kind!=='needs')throw new Error(JSON.stringify(result));
  for(const request of result.requests){const natural=[...request.text].length*10*textScale,w=request.width??natural;metrics.set(request.key,{width:Math.min(w,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,w)))*24*textScale});}
 }
 throw new Error('No measured layout');
}
describe('bounded structured information',()=>{
 it('accepts public Ace artwork and signed/null scores',()=>expect(()=>validateInformation(fixture())).not.toThrow());
 it('owns immutable copies independent of application mutation',()=>{
  const source=fixture(),session=createCardSession<string>({transport:()=>{}});session.receive(source);
  const owned=session.snapshot().document!;expect(owned.information).not.toBe(source.information);expect(Object.isFrozen(owned.information![0].fields)).toBe(true);
  (source.scoreboard!.rows[0].values as (number|null)[])[1]=999;expect(owned.scoreboard!.rows[0].values[1]).toBe(-20);session.dispose();
 });
 it('rejects unknown people and mismatched score columns atomically',()=>{
  const session=createCardSession<string>({transport:()=>{}});session.receive(fixture());const before=session.snapshot().document;
  for(const row of [{participantId:'observer',values:[1,2]},{participantId:'p',values:[1]},{participantId:'p',values:[NaN,0]}]){const source=fixture(),doc={...source,scoreboard:{...source.scoreboard!,rows:[row]}};expect(()=>session.receive(doc)).toThrow();expect(session.snapshot().document).toBe(before);}session.dispose();
 });
 it('rejects unbounded, duplicate and nonconserved data',()=>{
  const panel=fixture().information![0];
  for(const information of [Array(5).fill(panel),[{...panel,fields:Array(13).fill(panel.fields[0])}],[{...panel,progress:{...panel.progress!,total:0}}],[{...panel,progress:{...panel.progress!,series:[{...panel.progress!.series[0],value:21}]}}]])expect(()=>validateInformation({...fixture(),information})).toThrow();
 });
 it('rejects informational entity identities rather than registering a moving card',()=>{
  const doc=fixture(),session=createCardSession<string>({transport:()=>{}});
  const atom={kind:'card',label:'Ace',visual:{kind:'standard',suit:'Spade',rank:14},entityId:'private-card'};
  expect(()=>session.receive({...doc,information:[{id:'bad',title:'Bad',fields:[{id:'card',label:'Card',value:atom as never}]}]})).toThrow();session.dispose();
 });
 it.each([320,390,768,1440])('contains panels and consistent score columns at width %s',width=>{
  const root=solve(fixture(),width);expect(validateLayout(root)).toEqual([]);const direct=root.nodes.some(node=>node.kind==='progress');if(!direct){expect(root.nodes.some(node=>node.localIntent==='toggle-information'&&node.enabled)).toBe(true);expect(root.nodes.some(node=>node.id==='table-sidebar')).toBe(false);}
  const layout=direct?root:solve(fixture(),width,1,844,{...choices,informationOpen:true});if(!direct)expect(layout.modalId).toBe('table-information-dialog');expect(validateLayout(layout)).toEqual([]);
  expect(layout.nodes.some(node=>node.kind==='progress')).toBe(true);
  expect(layout.nodes.filter(node=>node.kind==='card').every(node=>!node.entityId&&!node.cardId&&!node.actionId)).toBe(true);
  const scores=solve(fixture(),width,1,844,{...choices,informationOpen:true,scoreboardOpen:true});expect(scores.nodes.some(node=>node.label.includes('누적 -20'))).toBe(true);
 });
 it('keeps fractional progress geometrically exact',()=>{const source=fixture(),panel=source.information![0],doc={...source,information:[{...panel,progress:{...panel.progress!,total:10,target:8,series:[{...panel.progress!.series[0],value:0.5,from:'end' as const}]}}]};const progress=solve(doc,390,1,844,{...choices,informationOpen:true}).nodes.find(node=>node.kind==='progress')!;expect(progress.progressPaint!.segments).toContainEqual({x:95,width:5,tone:'gold'});});
 it('switches four large-text score columns to labeled values',()=>{const source=fixture(),doc={...source,scoreboard:{...source.scoreboard!,columns:Array.from({length:4},(_,index)=>({id:String(index),label:`第${index}列`})),rows:[{participantId:'p',values:[-9999,1,20,null]}]}};const layout=solve(doc,320,3,844,{...choices,informationOpen:true,scoreboardOpen:true});expect(validateLayout(layout)).toEqual([]);expect(layout.nodes.some(node=>node.label==='第0列: -9999')||layout.nodes.some(node=>node.id==='table-scoreboard-refusal')).toBe(true);});
 it('contains structured information without opponents at doubled text size',()=>{const source=fixture(),doc={...source,opponents:[],scoreboard:{...source.scoreboard!,rows:[source.scoreboard!.rows[0]]}};const layout=solve(doc,320,2);expect(validateLayout(layout)).toEqual([]);expect(layout.nodes.some(node=>node.kind==='progress')).toBe(true);});
});

it('keeps compact contract and round labels on their measured line',()=>{
 const layout=solve(informationDocument() as unknown as TableDocument<string>,390,1,844,{...choices,informationOpen:true});
 const number=layout.nodes.find(node=>node.kind==='text'&&node.label==='17')!,suit=layout.nodes.find(node=>node.kind==='suit')!;
 expect(number.parent).toBe(suit.parent);expect(number.box.y).toBe(suit.box.y);
 expect(layout.nodes.find(node=>node.kind==='text'&&node.label==='라운드')!.box.height).toBe(24);
});
it('keeps compact captured history inside the visible desktop table viewport',()=>{
 const base=informationDocument(),doc={...base,decision:{id:'wait',kind:'commands' as const,commands:[]},offer:{id:'o',actions:[]},collections:[{id:'stock',label:'키티',purpose:'stock' as const,hiddenCount:3,cards:[]},{id:'trick',label:'현재 트릭',kind:'trick' as const,purpose:'play' as const,cards:[]},{id:'captured',label:'직전 트릭',purpose:'captured' as const,cards:base.hand.slice(0,5).map(card=>({...card,id:`captured-${card.id}`}))}]};
 const layout=solve(doc as unknown as TableDocument<string>,1440,1,1100);
 const global=(id:string):{y:number;height:number}=>{const node=layout.nodes.find(node=>node.id===id)!;return {y:node.box.y+(node.parent?global(node.parent).y:0),height:node.box.height};};
 const viewport=layout.nodes.find(node=>node.scrollAxis==='y'),bottom=viewport?global(viewport.id).y+viewport.box.height:global('dock').y;
 const cards=layout.nodes.filter(node=>node.zoneId==='captured');expect(cards).toHaveLength(5);expect(validateLayout(layout)).toEqual([]);
 for(const card of cards){expect(card.box.width).toBe(32);expect(global(card.id).y+card.box.height).toBeLessThanOrEqual(bottom);}
});
