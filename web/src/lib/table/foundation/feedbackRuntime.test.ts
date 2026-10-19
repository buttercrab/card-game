import {afterEach,expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {Environment,Planner,PlannedNode,PresentationFrame,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
import type {FeedbackEvent,FeedbackProjection} from './feedback';
const environment:Environment={width:500,height:700,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:44,pulse:1}}};
const event:FeedbackEvent={id:'misdeal-public',kind:'cue',cue:'misdeal',participantId:'alice',label:'공개 카드',publicCards:[{id:'public-two',label:'공개 2',visual:{kind:'standard',suit:'Spade',rank:2}}],milestone:{kind:'visible'}};
function document(revision='1',events:readonly FeedbackEvent[]=[]):TableDocument<string>{
 const context={session:'room',audience:'alice',generation:'hand1',revision},feedback:FeedbackProjection={scope:{session:'room',audience:'alice',generation:'hand1',roomEpoch:'epoch',connectionEpoch:'connection'},stateId:revision,events,mood:'bidding'};
 return{context,participant:{id:'alice',name:'Alice',markers:[]},hand:[],facts:[],decision:{id:'idle',kind:'commands',commands:[]},offer:{id:`offer:${revision}`,actions:[]},feedback};
}
function fixture(marker:'root'|'nested'|'missing'='root'){
 vi.useFakeTimers();const session=createCardSession<string>({transport:vi.fn()});session.receive(document());let callbacks!:SurfaceCallbacks;
 const planner:Planner=(_doc,_env,view)=>{
  const nodes:PlannedNode[]=[{id:'table',parent:null,kind:'group',label:'',box:{x:0,y:0,width:500,height:700}},{id:'arena',parent:'table',kind:'group',label:'',box:{x:0,y:150,width:500,height:550}}];
  for(const disclosure of view.feedback?.disclosures??[])nodes.push({id:'public-fan',parent:marker==='nested'?'arena':'table',kind:'group',label:disclosure.title,...(marker!=='missing'?{publicDisclosureEventId:disclosure.eventId}:{}),box:{x:10,y:10,width:300,height:120}});
  return{kind:'ready',layout:{width:500,height:700,recipe:'stacked',nodes}};
 };
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure:()=>()=>{},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn()};
 const emit=vi.fn(()=>()=>{}),table=createCardTable({session,planner,feedback:{emit,mood:()=>()=>{}}});table.attach(surface);
 const hasFan=()=>!!table.inspect().frame?.nodes.some(node=>node.id==='public-fan');
 const show=async()=>{session.receive(document('2',[event]));await Promise.resolve();expect(hasFan(),JSON.stringify({inspection:table.inspect(),fail:(surface.fallback as ReturnType<typeof vi.fn>).mock.calls,emits:emit.mock.calls})).toBe(true);return table.inspect().frame!.id;};
 return{session,table,surface,emit,hasFan,show,get callbacks(){return callbacks;},dispose(){table.dispose();session.dispose();}};
}
afterEach(()=>vi.useRealTimers());

test('only a genuine current published public fan acknowledgement starts its four-second runtime lifetime',async()=>{
 const f=fixture(),id=await f.show();f.callbacks.feedbackPresented!(id,['forged']);f.callbacks.feedbackPresented!(id-1,[event.id]);f.callbacks.feedbackPresented!(id,[event.id,event.id]);vi.advanceTimersByTime(10000);expect(f.hasFan()).toBe(true);expect(f.emit).toHaveBeenCalledTimes(1);
 f.callbacks.feedbackPresented!(id,[event.id]);vi.advanceTimersByTime(3999);expect(f.hasFan()).toBe(true);vi.advanceTimersByTime(1);expect(f.hasFan()).toBe(false);f.dispose();
});
test('unmarked and nested lookalike fan nodes cannot acknowledge a disclosure',async()=>{
 const f=fixture('missing'),id=await f.show();f.callbacks.feedbackPresented!(id,[event.id]);vi.advanceTimersByTime(10000);expect(f.hasFan()).toBe(true);f.dispose();
 const nested=fixture('nested');nested.session.receive(document('2',[event]));await Promise.resolve();expect(nested.table.inspect().status).toBe('failed');expect(nested.table.inspect().frame).toBeNull();nested.dispose();
});
test('an unmounted native callback cannot acknowledge the frame of a replacement mount',async()=>{
 const f=fixture();await f.show();const old=f.callbacks;f.table.detach();f.table.attach(f.surface);f.session.receive(document('3',[{...event,id:'fresh-public'}]));await Promise.resolve();const frame=f.table.inspect().frame!.id;expect(f.hasFan()).toBe(true);
 old.feedbackPresented!(frame,['fresh-public']);vi.advanceTimersByTime(10000);expect(f.hasFan()).toBe(true);f.callbacks.feedbackPresented!(frame,['fresh-public']);vi.advanceTimersByTime(4000);expect(f.hasFan()).toBe(false);f.dispose();
});
test('acknowledgements inside surface.publish cannot start lifetime before publication commits',async()=>{
 const f=fixture();(f.surface.publish as ReturnType<typeof vi.fn>).mockImplementation((next:PresentationFrame)=>{f.callbacks.feedbackPresented!(next.id,[event.id]);});const id=await f.show();vi.advanceTimersByTime(10000);expect(f.hasFan()).toBe(true);
 f.callbacks.feedbackPresented!(id,[event.id]);vi.advanceTimersByTime(4000);expect(f.hasFan()).toBe(false);f.dispose();
});
test('a reentrant failed publication cannot make its acknowledgement current',async()=>{
 const f=fixture();let blockedId=0;(f.surface.publish as ReturnType<typeof vi.fn>).mockImplementation((next:PresentationFrame)=>{if(next.nodes.some(node=>node.id==='public-fan')){blockedId=next.id;f.callbacks.feedbackPresented!(next.id,[event.id]);f.session.revoke();}});
 f.session.receive(document('2',[event]));await Promise.resolve();expect(blockedId).toBeGreaterThan(0);expect(f.table.inspect().frame).toBeNull();f.callbacks.feedbackPresented!(blockedId,[event.id]);vi.advanceTimersByTime(10000);expect(f.hasFan()).toBe(false);f.dispose();
});
test('command recovery preserves the owned feedback baseline and caller disclosure until actual presentation',async()=>{
 const f=fixture();const ownership=f.session.snapshot().presentationOwnership;
 // Coherent publications can withhold command admission while retaining the
 // exact authorized view. Neither publication is a new feedback bootstrap.
 f.session.receive(document('2'),{connected:false});
 expect(f.session.snapshot().presentationOwnership).toBe(ownership);
 f.session.receive(document('3',[event]),{connected:false});
 expect(f.hasFan()).toBe(true);
 f.session.receive({...document('4',[event]),feedback:{...document('3',[event]).feedback!,stateId:'3'}},{connected:true});
 await Promise.resolve();expect(f.hasFan()).toBe(true);expect(f.emit).toHaveBeenCalledTimes(1);
 const id=f.table.inspect().frame!.id;vi.advanceTimersByTime(4500);expect(f.hasFan()).toBe(true);
 f.callbacks.feedbackPresented!(id,[event.id]);vi.advanceTimersByTime(4000);expect(f.hasFan()).toBe(false);f.dispose();
});
test('hard connection loss retires the feedback baseline and cannot replay a recovered historical event',async()=>{
 const f=fixture();const old=f.session.snapshot().presentationOwnership;
 f.session.setConnected(false);f.session.setConnected(true);
 f.session.receive(document('2',[event]));await Promise.resolve();
 expect(f.session.snapshot().presentationOwnership).not.toBe(old);expect(f.hasFan()).toBe(false);expect(f.emit).not.toHaveBeenCalled();f.dispose();
});
test('reentrant surface invalidation keeps the newer same-owner feedback publication authoritative',async()=>{
 const f=fixture();const ownership=f.session.snapshot().presentationOwnership;let replaced=false;
 (f.surface.disarm as ReturnType<typeof vi.fn>).mockImplementation(()=>{
  if(replaced)return;replaced=true;f.session.receive(document('3',[]));
 });
 f.session.receive(document('2',[event]));await Promise.resolve();
 expect(replaced).toBe(true);expect(f.session.snapshot().presentationOwnership).toBe(ownership);
 expect(f.session.snapshot().document?.context.revision).toBe('3');expect(f.hasFan()).toBe(false);expect(f.emit).not.toHaveBeenCalled();f.dispose();
});
