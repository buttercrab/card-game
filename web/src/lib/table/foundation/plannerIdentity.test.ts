import { describe, expect, it } from 'vitest';
import type { CandidateLayout, ChoiceView, Environment, MeasureRequest, PlannedNode, Rect, Size } from './contracts';
import { planTable, validateLayout } from './planner';
import { shellDocument } from './shellFixture';

const base=shellDocument();
const environment=(width:number,height:number,textScale=1):Environment=>({width,height,textScale,revision:'1',fontRevision:'1',fontFamily:'Body',scrollbarWidth:15,scrollbarHeight:15,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}});
function document(count:number,longName=false){return {...base,participant:{...base.participant,name:longName?'재용 · 이름이 길어도 캐릭터 옆에서 여러 줄로 읽을 수 있어야 해요':'재용',markers:[]},hand:Array.from({length:count},(_,index)=>({id:`own:${index}`,label:`Own card ${index}`,visual:{kind:'standard' as const,suit:'Spade' as const,rank:2+index%13}}))};}
function choices(count:number,available:boolean):ChoiceView{return {values:{},fields:[],commands:available?[{id:'pass',label:'패스',intent:'secondary',enabled:true}]:[],selected:null,...(available?{cards:{selected:[],available:Array.from({length:count},(_,index)=>`own:${index}`),label:'카드를 고르세요.',submitLabels:[]}}:{})};}
/** Fixed independent glyph advance and line height expose wrapping without using planner geometry helpers. */
function metric(request:MeasureRequest):Size{const natural=Array.from(request.text).length*10*request.environment.textScale,width=request.width===null?natural:Math.min(natural,request.width),line=request.role==='small'?20:request.role==='name'?26:request.role==='button'?22:24;return {width,height:Math.max(1,request.width===null?1:Math.ceil(natural/Math.max(1,request.width)))*line*request.environment.textScale};}
function solve(doc:ReturnType<typeof document>,env:Environment,view:ChoiceView):CandidateLayout{const metrics=new Map<string,Size>();for(let pass=0;pass<8;pass++){const result=planTable(doc,env,view,metrics);if(result.kind==='ready'){expect(validateLayout(result.layout)).toEqual([]);return result.layout;}if(result.kind!=='needs')throw Error(JSON.stringify(result));for(const request of result.requests)metrics.set(request.key,metric(request));}throw Error('Identity measurement did not converge');}
function node(layout:CandidateLayout,id:string):PlannedNode{const value=layout.nodes.find(node=>node.id===id);expect(value,`missing ${id}`).toBeDefined();return value!;}
function global(layout:CandidateLayout,id:string):Rect{let current=node(layout,id),x=current.box.x,y=current.box.y;const box=current.box;while(current.parent){current=node(layout,current.parent);x+=current.box.x;y+=current.box.y;}return {...box,x,y};}
const geometry=(layout:CandidateLayout,id:string)=>global(layout,id);
function assertIdentity(layout:CandidateLayout,count:number,available:boolean){
 const figure=node(layout,'identity-figure'),name=node(layout,'identity-name'),art=global(layout,figure.id),label=global(layout,name.id),identity=global(layout,'identity'),hand=global(layout,'hand');
 const expectedFigure=layout.width>=1024?72:layout.width>=600?64:56;expect(figure.box).toMatchObject({width:expectedFigure,height:expectedFigure*110/120});expect(figure.ownerId).toBe(base.participant.id);expect(figure.actionId).toBeUndefined();expect(figure.cardId).toBeUndefined();expect(name.actionId).toBeUndefined();expect(name.cardId).toBeUndefined();
 expect(label.x).toBeGreaterThanOrEqual(art.x+art.width);const meta=global(layout,JSON.stringify(['identity-meta',base.participant.id]));expect(label.y).toBeGreaterThanOrEqual(meta.y+meta.height+2);expect(Math.min(label.y+label.height,art.y+art.height)-Math.max(label.y,art.y)).toBeGreaterThan(0);
 const badge=global(layout,'identity-name-badge');expect(label.x).toBe(badge.x+8);expect(label.y).toBe(badge.y);expect(label.x+label.width+8).toBe(badge.x+badge.width);expect(label.y+label.height).toBe(badge.y+badge.height);
 expect(hand.y).toBeGreaterThanOrEqual(identity.y+identity.height+12);expect(hand.x).toBe(identity.x);expect(hand.width).toBe(identity.width);
 const anchor=node(layout,'own-hand-count-anchor');expect(anchor.ownHandAnchor).toEqual({participantId:base.participant.id,count});expect(anchor.entityId).toBeUndefined();expect(anchor.cardId).toBeUndefined();expect(anchor.actionId).toBeUndefined();expect(anchor.kind).toBe('group');expect(anchor.inert).toBe(true);expect(anchor.visual).toBeUndefined();expect(anchor.label).toBe('');expect(global(layout,anchor.id)).toEqual(art);expect(layout.nodes.some(node=>node.id==='own-hand-count-label'||node.id==='own-hand-count')).toBe(false);
 const cards=layout.nodes.filter(node=>node.zoneId==='hand'&&node.entityId);expect(cards.map(card=>card.entityId)).toEqual(Array.from({length:count},(_,index)=>`own:${index}`));for(const card of cards){expect(card.cardId).toBe(available?card.entityId:undefined);expect(!!card.enabled).toBe(available);}
}

describe('stable adjacent seated identity and full-width portrait hand',()=>{
 it.each([390,768])('%spx keeps the same adjacent header/stacked hand policy for every hand count and choice state',width=>{
  for(const count of [0,1,3,10,13])for(const available of [false,true]){const layout=solve(document(count),environment(width,width===390?844:1024),choices(count,available));assertIdentity(layout,count,available);const dock=global(layout,'dock'),identity=global(layout,'identity');expect(identity.width).toBe(dock.width-16);}
 });
 it.each([390,768])('%spx wraps a long 2× name without intersecting figure or following cards',width=>{
  for(const count of [0,1,3,10,13])for(const available of [false,true]){const layout=solve(document(count,true),environment(width,width===390?844:1024,2),choices(count,available));assertIdentity(layout,count,available);const name=global(layout,'identity-name'),identity=global(layout,'identity'),hand=global(layout,'hand');expect(name.height).toBeGreaterThan(52);expect(name.x+name.width).toBeLessThanOrEqual(identity.x+identity.width);expect(name.y+name.height).toBeLessThanOrEqual(identity.y+identity.height);expect(hand.y).toBeGreaterThanOrEqual(name.y+name.height+12);}
 });
 it('uses legible peer names, fixed peer artwork and distinct waiting/active self sizes',()=>{
  const doc=document(3),env=environment(390,844),active=solve(doc,env,{...choices(3,true),feedback:{cues:[],clock:{id:'turn',participantId:doc.participant.id,deadline:5000,total:30000,local:true}}});
  for(const person of doc.opponents!){const cell=JSON.stringify(['opponent',person.id]),art=node(active,JSON.stringify([cell,'figure'])),label=node(active,JSON.stringify([cell,'name']));expect(art.box).toMatchObject({width:48,height:44});expect(label.role).toBe('participant-name');expect(label.box.height).toBeGreaterThanOrEqual(24);}
  expect(node(active,'identity-figure').box).toMatchObject({width:56,height:56*110/120});expect(node(active,'identity-figure').clockPaint?.participantId).toBe(doc.participant.id);
  const waiting=solve({...document(0),stage:'waiting' as const,collections:[],deals:[],reveals:[],stockReturn:undefined},env,choices(0,false));expect(node(waiting,'identity-figure').box).toMatchObject({width:64,height:64});expect(node(waiting,'identity-figure').ownerId).toBe(doc.participant.id);expect(waiting.nodes.some(node=>node.zoneId==='hand')).toBe(false);
 });
 it('allows a measured side column on a roomy desktop without changing card or count identities',()=>{
  const layout=solve(document(10),environment(1440,900),choices(10,true)),identity=global(layout,'identity'),hand=global(layout,'hand');expect(hand.x).toBeGreaterThanOrEqual(identity.x+identity.width+12);expect(hand.y).toBe(identity.y);expect(node(layout,'identity-figure').box).toMatchObject({width:72,height:66});expect(node(layout,'own-hand-count-anchor').ownHandAnchor).toEqual({participantId:base.participant.id,count:10});expect(layout.nodes.filter(node=>node.zoneId==='hand'&&node.entityId)).toHaveLength(10);
 });
 it('keeps header, count destination and real-hand geometry fixed as reserved cue content changes',()=>{
  for(const width of [390,768]){
   const doc=document(10),env=environment(width,width===390?844:1024),view=choices(10,true),idle=solve(doc,env,{...view,feedback:{cues:[]}}),cue=solve(doc,env,{...view,feedback:{cues:[{id:'cue',participantId:doc.participant.id,label:'주공',cue:'declarer'}]}});
   for(const id of ['dock','identity','identity-figure','identity-name','own-hand-count-anchor','hand',...idle.nodes.filter(node=>node.zoneId==='hand'&&node.entityId).map(node=>node.id)])expect(geometry(cue,id),id).toEqual(geometry(idle,id));
   expect(node(cue,'identity-figure').figureCue).toEqual({id:'cue',kind:'declarer'});expect(node(cue,'own-hand-count-anchor').ownHandAnchor).toEqual(node(idle,'own-hand-count-anchor').ownHandAnchor);
  }
 });
});
it.each([1,2])('desktop original vertical name follows overlapping meta and separate feedback at text%s',textScale=>{for(const longName of [false,true]){const doc=document(13,longName),env=environment(1440,900,textScale),layout=solve(doc,env,choices(13,true)),art=global(layout,'identity-figure'),name=global(layout,'identity-name'),meta=global(layout,JSON.stringify(['identity-meta',doc.participant.id])),signals=global(layout,JSON.stringify(['participant-signals',doc.participant.id]));expect(name.x+name.width/2).toBe(art.x+art.width/2);expect(meta.y).toBeLessThan(art.y+art.height);expect(name.y).toBeGreaterThanOrEqual(meta.y+meta.height+2);expect(signals.y).toBeGreaterThanOrEqual(name.y+name.height+4);expect(art).toMatchObject({width:72,height:66});expect(node(layout,'identity-name').role).toBe('participant-name');expect(name.x).toBeGreaterThanOrEqual(global(layout,'identity').x);expect(name.x+name.width).toBeLessThanOrEqual(global(layout,'identity').x+global(layout,'identity').width);expect(node(layout,'own-hand-count-anchor').ownHandAnchor?.count).toBe(13);expect(validateLayout(layout)).toEqual([]);}});

it.each([[390,844],[768,1024],[1440,900]])('thinking paint preserves measured names, count destinations and hand at %sx%s',(width,height)=>{
 const source=document(10),env=environment(width,height),view=choices(10,true),idle=solve(source,env,view),thinking={...source,participant:{...source.participant,appearance:{...source.participant.appearance,thinking:true}},opponents:source.opponents?.map(person=>({...person,appearance:{...person.appearance,thinking:true}}))},active=solve(thinking,env,view);
 const ids=['identity','identity-figure','identity-name','identity-name-badge','own-hand-count-anchor','hand',...source.opponents!.flatMap(person=>{const cell=JSON.stringify(['opponent',person.id]);return [cell,JSON.stringify([cell,'figure']),JSON.stringify([cell,'name']),JSON.stringify([cell,'hand'])];})];
 for(const id of ids)expect(global(active,id),id).toEqual(global(idle,id));
 const name=node(idle,'identity-name'),badge=node(idle,'identity-name-badge');expect(badge.box.width).toBe(name.box.width+16);expect(name.box.width).toBe(20);expect(badge.box.width).toBeLessThan(global(idle,'identity-portrait').width);expect(node(active,'identity-name-badge').decoration).toBe('pill');
});

it.each([[390,844],[768,1024],[1440,900]])('peer count digits cannot move a participant or its card destination at %sx%s',(width,height)=>{
 const source=document(10),env=environment(width,height),view=choices(10,true),initial=solve(source,env,view);
 for(const count of [9,1,0,104]){
  const changed=solve({...source,opponents:source.opponents!.map(person=>({...person,handCount:count}))},env,view);
  for(const person of source.opponents!){const cell=JSON.stringify(['opponent',person.id]);for(const id of [cell,JSON.stringify([cell,'figure']),JSON.stringify([cell,'name']),JSON.stringify([cell,'hand'])])expect(global(changed,id),`${count}:${id}`).toEqual(global(initial,id));expect(changed.nodes.find(node=>node.recipientId===person.id)?.recipientCount).toBe(count);}
  expect(global(changed,'hand')).toEqual(global(initial,'hand'));expect(validateLayout(changed)).toEqual([]);
 }
});

it('original standing badges remain separate from names/feedback while count chrome retires into exact inert figure anchors',()=>{
 const source=document(10),status={purpose:'standing' as const,value:{kind:'text' as const,text:'주공'},tone:'gold' as const,badges:[{text:'3점',tone:'plain' as const}]},doc={...source,participant:{...source.participant,status},opponents:source.opponents!.map(person=>({...person,status}))},layout=solve(doc,environment(390,844),choices(10,true));
 for(const owner of [doc.participant,...doc.opponents]){
  const meta=node(layout,JSON.stringify(['identity-meta',owner.id])),role=node(layout,JSON.stringify(['participant-status',owner.id])),points=node(layout,JSON.stringify(['participant-status-badge',owner.id,'0'])),figure=layout.nodes.find(node=>node.kind==='figure'&&node.ownerId===owner.id)!,anchor=layout.nodes.find(node=>node.recipientId===owner.id||node.ownHandAnchor?.participantId===owner.id)!;
  expect(role.id).not.toBe(points.id);expect(role.participantStatusFor).toBe(owner.id);expect(points.label).toBe('3점');expect(global(layout,meta.id).y).toBeLessThan(global(layout,figure.id).y+figure.box.height);expect(anchor.kind).toBe('group');expect(anchor.inert).toBe(true);expect(anchor.visual).toBeUndefined();expect(global(layout,anchor.id)).toEqual(global(layout,figure.id));
  let parent=role.parent;while(parent&&parent!==meta.id)parent=node(layout,parent).parent;expect(parent).toBe(meta.id);expect(layout.nodes.find(node=>node.id===JSON.stringify(['participant-signals',owner.id]))?.participantFeedbackFor).toBe(owner.id);
 }
 expect(layout.nodes.some(node=>node.id==='own-hand-count'||node.id==='own-hand-count-label'||node.id.endsWith(',"count"]'))).toBe(false);
 const meta=node(layout,JSON.stringify(['identity-meta',doc.participant.id]));for(const patch of [{enabled:true},{actionId:'pass'},{identityMetaFor:'foreign'}])expect(validateLayout({...layout,nodes:layout.nodes.map(node=>node.id===meta.id?{...node,...patch}:node)})).toContain(`Invalid participant identity meta: ${meta.id}`);
 const points=node(layout,JSON.stringify(['participant-status-badge',doc.participant.id,'0']));expect(validateLayout({...layout,nodes:layout.nodes.map(node=>node.id===points.id?{...node,actionId:'pass'}:node)})).toContain(`Authority beneath participant identity meta: ${points.id}`);
});

it('actual four-glyph Korean own name retains all64px of native text in the phone arrangement',()=>{
 const source=document(4),doc={...source,participant:{...source.participant,name:'배치확정',status:{purpose:'standing' as const,value:{kind:'text' as const,text:'야당'},tone:'plain' as const,badges:[{text:'3점',tone:'plain' as const}]}}},env=environment(390,844),view=choices(4,true),values=new Map<string,Size>();
 let layout:CandidateLayout|undefined;for(let pass=0;pass<8;pass++){const result=planTable(doc,env,view,values);if(result.kind==='ready'){layout=result.layout;break;}if(result.kind!=='needs')throw Error(JSON.stringify(result));for(const request of result.requests){const natural=Array.from(request.text).reduce((sum,char)=>sum+(/[가-힣]/.test(char)?request.role==='small'?14:16:8),0),width=request.width??natural,line=request.role==='small'?20:24;values.set(request.key,{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*line});}}
 expect(layout).toBeDefined();expect(validateLayout(layout!)).toEqual([]);expect(node(layout!,'identity-name').box).toMatchObject({width:64,height:24});expect(node(layout!,'identity-name-badge').box.width).toBe(80);expect(node(layout!,'identity-figure').box).toMatchObject({width:56,height:56*110/120});const badge=global(layout!,'identity-name-badge'),art=global(layout!,'identity-figure');expect(badge.x).toBeGreaterThanOrEqual(art.x+art.width);expect(layout!.nodes.filter(node=>node.zoneId==='hand'&&node.entityId)).toHaveLength(4);
});
