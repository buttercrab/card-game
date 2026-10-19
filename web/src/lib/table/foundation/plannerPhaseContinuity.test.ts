import {calculateReadableHandLayout} from '../handLayout';
import {expect,test} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {mightyJokerDocument} from './mightyJokerFixture';
import type {Environment,PlannedNode,PresentationFrame,SurfaceCallbacks} from './contracts';
import {validateLayout,typography} from './planner';
function fixture(textScale:number,height=844){
 const source=mightyJokerDocument(),session=createCardSession({transport:()=>{}}),env:Environment={width:390,height,textScale,fontRevision:'1',revision:'1',fontFamily:'sans-serif',scrollbarWidth:15,scrollbarHeight:15,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
 let callbacks!:SurfaceCallbacks;const table=createCardTable({session});table.attach({identity:{},environment:()=>env,listen(next){callbacks=next;return()=>{};},measure(requests,reply){reply(requests.map(request=>{const natural=Array.from(request.text).length*9*textScale,width=request.width??natural;return {key:request.key,size:{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(request.role,env).lineHeight}};}));return()=>{};},publish:()=>{},disarm:()=>{},invalidate:()=>{},clear:()=>{},fallback(reason){throw Error(reason);}});
 return {source,session,table,focus(id:string){callbacks.intent({kind:'focus',frameId:table.inspect().frame!.id,nodeId:id});},resize(height:number){callbacks.environment({...env,height,revision:String(height)});},dispose(){table.dispose();session.dispose();}};
}
function ancestry(frame:PresentationFrame,node:PlannedNode){const result=[];let current:PlannedNode|undefined=node;while(current){result.push({id:current.id,parent:current.parent,box:current.box,scroll:current.scroll,axis:current.scrollAxis});current=current.parent?frame.nodes.find(node=>node.id===current!.parent):undefined;}return result;}
test.each([[1,844],[2,844],[1,700],[2,700]])('public Play cohort keeps stock, dock, identities and native footer ancestry through zero/one/five cards at scale%s height%s',(scale,height)=>{
 const f=fixture(scale,height),ids=['p1','p2','p3','p4','p0'];let baseline:PresentationFrame|undefined;
 for(const count of [0,1,5,0]){
  const source={...f.source,context:{...f.source.context,revision:String(count+1)},collections:f.source.collections!.map(zone=>zone.purpose==='play'?{...zone,cards:ids.slice(0,count).map((ownerId,index)=>({id:`public:${index}`,label:`Public ${index}`,ownerId,visual:{kind:'standard' as const,suit:'Spade' as const,rank:index+2}}))}:zone)};
  f.session.receive(source);const frame=f.table.inspect().frame!;expect(validateLayout(frame)).toEqual([]);expect(frame.nodes.some(node=>node.id==='table-footer')).toBe(true);
  const current=frame.nodes.filter(node=>node.stockCount!==undefined||node.recipientId||node.ownHandAnchor||node.zoneId==='hand'&&node.entityId||['dock','hand','arena','table-footer'].includes(node.id));
  if(baseline){for(const node of current){const before=baseline.nodes.find(before=>before.id===node.id)!;expect(before,node.id).toBeDefined();expect(ancestry(frame,node),node.id).toEqual(ancestry(baseline,before));}}else baseline=frame;
 }
 f.dispose();
});

test('compact side dock retains full native card strip with a revealable face and44px stride for every card',()=>{
 const f=fixture(1,700);f.session.receive(f.source);const frame=f.table.inspect().frame!,hand=frame.nodes.find(node=>node.id==='hand')!,fan=frame.nodes.find(node=>node.id==='hand-fan')!,cards=frame.nodes.filter(node=>node.zoneId==='hand'&&node.entityId);
 expect(frame.recipe).toBe('side-by-side');expect(hand.scroll).toBe(true);expect(hand.label).toBe('내 카드 · 가로 스크롤');expect(hand.box.width).toBeGreaterThanOrEqual(144);expect(fan.box.width).toBeGreaterThan(hand.box.width);expect(cards).toHaveLength(f.source.hand.length);
 const maximumScroll=fan.box.width-hand.box.width;
 for(let index=0;index<cards.length;index++){
  const card=cards[index];expect(card.box).toMatchObject({width:88,height:124});expect(card.enabled).toBe(true);expect(card.label).toBe(f.source.hand[index].label);
  if(index)expect(card.box.x-cards[index-1].box.x).toBe(44);
  // A valid native scroll position can reveal the complete face and feedback
  // margins for every target, including the final keyboard/End destination.
  const scroll=Math.max(0,Math.min(maximumScroll,card.box.x-6));expect(card.box.x-scroll).toBeGreaterThanOrEqual(0);expect(card.box.x+card.box.width-scroll).toBeLessThanOrEqual(hand.box.width);
  expect(card.box.y).toBeGreaterThanOrEqual(0);expect(card.box.y+card.box.height).toBeLessThanOrEqual(hand.box.height-15);
 }
 expect(frame.nodes.find(node=>node.id==='identity-name')?.label).toBe(f.source.participant.name);expect(frame.nodes.find(node=>node.id==='identity-figure')?.box).toMatchObject({width:72,height:72});expect(validateLayout(frame)).toEqual([]);f.dispose();
});

test('a focused final card retains the native reveal request through responsive hand allocation',()=>{
 const f=fixture(1);f.session.receive(f.source);const first=f.table.inspect().frame!,last=first.nodes.filter(node=>node.zoneId==='hand'&&node.entityId).at(-1)!;
 f.focus(last.id);f.resize(700);const next=f.table.inspect().frame!;
 expect(next.recipe).toBe('side-by-side');const hand=next.nodes.find(node=>node.id==='hand')!,fan=next.nodes.find(node=>node.id==='hand-fan')!,canonical=calculateReadableHandLayout({regionWidth:hand.box.width,viewportWidth:next.environment.width,viewportHeight:next.environment.height,count:f.source.hand.length,selectionLift:14,padding:6,scrollbarHeight:next.environment.scrollbarHeight??0});expect(hand.scroll).toBe(canonical.scroll);const cards=next.nodes.filter(node=>node.zoneId==='hand'&&node.entityId);expect(cards).toHaveLength(canonical.cards.length);for(const [index,card] of cards.entries()){expect(card.box.width).toBe(canonical.drawWidth);const maximumScroll=fan.box.width-hand.box.width,scroll=Math.max(0,Math.min(maximumScroll,canonical.cards[index].x-6));expect(canonical.cards[index].x-scroll).toBeGreaterThanOrEqual(0);expect(canonical.cards[index].x+card.box.width-scroll).toBeLessThanOrEqual(hand.box.width);}expect(next.focusId).toBe(last.id);expect(next.revealFocusId).toBe(last.id);expect(validateLayout(next)).toEqual([]);f.dispose();
});

test('an established fitting dock stays preferred before evaluating the scrollable side alternative',()=>{
 const f=fixture(1);f.session.receive(f.source);const frame=f.table.inspect().frame!;
 expect(frame.recipe).toBe('stacked');expect(frame.nodes.find(node=>node.id==='hand')?.scroll).toBe(false);expect(validateLayout(frame)).toEqual([]);f.dispose();
});
