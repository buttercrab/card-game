import {expect,test} from 'vitest';
import {mightyJokerDocument} from './mightyJokerFixture';
import {validateInformation} from './information';
import {CATALOG} from '../../catalog';
import type {GameTypes,RoomViewOf} from '../../room/types';
import {projectRoomShell,validateRoomShell} from './roomShell';
import {createCardSession} from './session';
import {planTable,typography,validateLayout} from './planner';
import type {CandidateLayout,ChoiceView,Environment,TableDocument} from './contracts';
const choices:ChoiceView={selected:null,values:{},fields:[],commands:[]};
/** Canonical room identities must match the production Mighty projection. */
function withRoom<A>(source:TableDocument<A>):TableDocument<A>{
 const people=[source.participant,...source.opponents!];
 const room:RoomViewOf<GameTypes>={id:'joker-proof',game:'mighty',protocol:CATALOG.protocol,settings:{},rules:{},customized:false,seats:people.map(person=>({kind:'human',name:person.name,connected:true,away:false})),participant_ids:people.map(person=>person.id),ready:people.map(()=>true),participation:[],in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:1,observers:[{id:'watcher',name:'합성 관전자',requested:false}],scores:people.map(()=>0),hands_played:0,history:[],hands:[]};
 return {...source,shell:projectRoomShell({roomCode:room.id,client:{room,status:'open',seat:0,viewerId:source.participant.id},document:source})};
}
function solve<A>(document:TableDocument<A>,height=800,view:ChoiceView=choices):CandidateLayout {
 validateRoomShell(document.shell!,document);const session=createCardSession<A>({transport:()=>{}});try{session.receive(document);}finally{session.dispose();}
 const environment:Environment={width:1280,height,textScale:1,revision:'ownership',fontRevision:'ownership',fontFamily:'sans-serif',scrollbarWidth:15,scrollbarHeight:15,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}},metrics=new Map();
 for(let pass=0;pass<20;pass++){
  const result=planTable(document,environment,view,metrics);if(result.kind==='ready')return result.layout;if(result.kind!=='needs')throw Error(JSON.stringify(result));
  for(const request of result.requests){const natural=[...request.text].reduce((sum,char)=>sum+(/[가-힣]/.test(char)?request.role==='name'?18:16:8),0),width=request.width??natural;metrics.set(request.key,{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(request.role,environment).lineHeight});}
 }
 throw Error('Desktop ownership metrics did not settle');
}
function bounds(layout:CandidateLayout,id:string){let node=layout.nodes.find(node=>node.id===id)!;const box={...node.box};while(node.parent){node=layout.nodes.find(parent=>parent.id===node.parent)!;box.x+=node.box.x;box.y+=node.box.y;}return box;}
function under(layout:CandidateLayout,id:string,parent:string):boolean {let node=layout.nodes.find(node=>node.id===id);while(node){if(node.id===parent)return true;node=node.parent?layout.nodes.find(parent=>parent.id===node!.parent):undefined;}return false;}
test.each([800,900])('original rail panel stack preserves the eight-pixel gap at height%i',height=>{
 const source=mightyJokerDocument(),document=withRoom(source),layout=solve(document,height);
 const information=bounds(layout,JSON.stringify(['information',document.information![0].id]));
 const scores=bounds(layout,JSON.stringify(['scoreboard',document.scoreboard!.id]));
 expect(scores.y-information.y-information.height).toBe(8);
 expect(scores.x).toBe(information.x);
 expect(scores.width).toBe(information.width);
});
test('an admitted complete desktop rail owns status once and restores the centered ring/art hierarchy',()=>{
 const source=mightyJokerDocument(),document=withRoom(source),layout=solve(document);expect(validateLayout(layout)).toEqual([]);expect(layout.nodes.some(node=>node.id==='table-active-status')).toBe(false);
 const rail=bounds(layout,'table-sidebar');for(const row of document.scoreboard!.rows){const id=JSON.stringify([JSON.stringify(['scoreboard',document.scoreboard!.id]),'row',row.participantId]),box=bounds(layout,id);expect(box.y+box.height).toBeLessThanOrEqual(rail.y+rail.height);}
 for(const field of document.information![0].fields){const node=layout.nodes.find(node=>node.id===JSON.stringify([JSON.stringify(['information',document.information![0].id]),'field',field.id]))!;expect(node).toBeDefined();expect(under(layout,node.id,'table-sidebar')).toBe(true);}
 expect(layout.nodes.some(node=>node.kind==='progress')).toBe(true);
 const ring=bounds(layout,'arena'),region=bounds(layout,'regular-arena');expect(ring.width).toBeLessThan(region.width);expect(ring.x+ring.width/2).toBeCloseTo(region.x+region.width/2);expect(ring.width).toBeCloseTo(ring.height*1.35);
 const peers=new Set(document.opponents!.map(person=>person.id));for(const node of layout.nodes.filter(node=>node.kind==='figure'&&peers.has(node.ownerId??''))){expect(node.box.width).toBeGreaterThanOrEqual(56);expect(node.box.width).toBeLessThanOrEqual(80);}
 const env={width:1280,height:800,textScale:1} as Environment;expect(typography('participant-name',env).fontWeight).toBe(600);
 const stock=document.collections?.find(zone=>zone.purpose==='stock');
 expect(stock?.hiddenCount).toBeDefined();
 expect(document.presentation?.tableCollectionIds).toEqual(['trick']);
 expect(layout.nodes.some(node=>node.stockCount!==undefined||node.zoneId===stock!.id)).toBe(false);
});
test('a rail that cannot show complete detailed information keeps the full essential header owner',()=>{
 const source=mightyJokerDocument(),panel=source.information![0],document={...withRoom(source),information:[{...panel,fields:[...panel.fields,{id:'full-public-detail',label:'공개 설명',value:{kind:'text' as const,text:'모든 공개 설명을 유지합니다. '.repeat(25)}}]}]},layout=solve(document);
 expect(()=>validateInformation(document)).not.toThrow();
 expect(layout.nodes.some(node=>node.id==='regular-arena')).toBe(true);
 expect(layout.nodes.some(node=>node.id==='table-active-status')).toBe(true);expect(layout.nodes.find(node=>node.id==='active-status-progress')?.label).toContain('/17');
 expect(layout.nodes.some(node=>node.label==='모든 공개 설명을 유지합니다. '.repeat(25))).toBe(true);expect(validateLayout(layout)).toEqual([]);
 const compact=layout.nodes.filter(node=>node.id==='table-active-status');expect(compact).toHaveLength(1);
 expect(layout.nodes.find(node=>node.id==='active-status-summary')?.label).toBe(panel.summary!.text);
 for(const id of document.statusPresentation!.fieldIds){const field=panel.fields.find(field=>field.id===id)!,pair=JSON.stringify(['active-status-field',id]);expect(layout.nodes.filter(node=>node.id===pair)).toHaveLength(1);expect(layout.nodes.find(node=>node.id===JSON.stringify([pair,'label']))?.label).toBe(field.label);expect(layout.nodes.some(node=>node.id!==pair&&under(layout,node.id,pair)&&node.label.length>0&&node.box.width>0&&node.box.height>0)).toBe(true);}
 expect(layout.nodes.some(node=>node.id==='active-status-primary')).toBe(true);

 const status=bounds(layout,compact[0].id),progress=layout.nodes.find(node=>node.id==='active-status-progress')!;
 expect(under(layout,progress.id,compact[0].id)).toBe(true);expect(progress.label).toContain('/17');expect(progress.box.width).toBeGreaterThan(0);expect(progress.box.height).toBeGreaterThan(0);
 expect(status.y).toBeGreaterThanOrEqual(0);expect(status.y+status.height).toBeLessThanOrEqual(800);expect(under(layout,compact[0].id,'table-sidebar')).toBe(false);
 const ordinary=solve(withRoom(source));
 expect(bounds(layout,'dock')).toEqual(bounds(ordinary,'dock'));
 for(const node of ordinary.nodes.filter(node=>node.kind==='card'&&node.cardId))expect(bounds(layout,node.id),node.id).toEqual(bounds(ordinary,node.id));

});

test('missing or partial roster evidence cannot transfer status ownership to the rail',()=>{
 const source=mightyJokerDocument(),document=withRoom(source);
 for(const scoreboard of [undefined,{...source.scoreboard!,rows:source.scoreboard!.rows.slice(0,-1)}]){
  const layout=solve({...document,scoreboard});expect(layout.nodes.some(node=>node.id==='table-active-status')).toBe(true);expect(validateLayout(layout)).toEqual([]);
 }
});

test.each([[1,'👏'],[2,'좋은 수였어요']] as const)('recovering essential header status preserves %s observer reactions (%s) without overlap',(count,label)=>{
 const source=mightyJokerDocument(),panel=source.information![0],base=withRoom(source),document={...base,information:[{...panel,fields:[...panel.fields,{id:'full-public-detail',label:'공개 설명',value:{kind:'text' as const,text:'모든 공개 설명을 유지합니다. '.repeat(25)}}]}]};
 const view:ChoiceView={...choices,feedback:{cues:Array.from({length:count},(_,index)=>({id:`observer-cue-${index}`,participantId:index?`observer-extra-${index}`:'watcher',label}))}};
 const ordinary=solve(base,800,view),layout=solve(document,800,view),prior=ordinary.nodes.find(node=>node.observerReactionLayer),overlay=layout.nodes.find(node=>node.observerReactionLayer);
 expect(prior).toBeDefined();expect(overlay).toBeDefined();expect(validateLayout(layout)).toEqual([]);
 expect(layout.nodes.filter(node=>node.kind==='text'&&node.label===label&&under(layout,node.id,overlay!.id))).toHaveLength(count);expect(prior!.observerReactionSlotId).toBe('observer-reaction-slot');expect(overlay!.observerReactionSlotId).toBeUndefined();
 const reaction=bounds(layout,overlay!.id),status=bounds(layout,'table-active-status');
 expect(Math.min(reaction.x+reaction.width,status.x+status.width)>Math.max(reaction.x,status.x)&&Math.min(reaction.y+reaction.height,status.y+status.height)>Math.max(reaction.y,status.y)).toBe(false);
 expect(reaction.y).toBeGreaterThanOrEqual(0);expect(reaction.y+reaction.height).toBeLessThanOrEqual(800);
 expect(bounds(layout,'dock')).toEqual(bounds(ordinary,'dock'));
});

test('expanded status header keeps later room notices below its measured row',()=>{
 const source=mightyJokerDocument(),panel=source.information![0],shell={...withRoom(source).shell!,notices:[{id:'notice',text:'참여 요청을 확인해 주세요.',tone:'plain' as const}]},document={...source,shell,information:[{...panel,fields:[...panel.fields,{id:'full-public-detail',label:'공개 설명',value:{kind:'text' as const,text:'모든 공개 설명을 유지합니다. '.repeat(25)}}]}]};
 const layout=solve(document,900),header=bounds(layout,'room-header'),notice=bounds(layout,'room-notices');expect(validateLayout(layout)).toEqual([]);expect(notice.y).toBeGreaterThanOrEqual(header.y+header.height);expect(layout.nodes.some(node=>node.label===shell.notices[0].text)).toBe(true);
});
