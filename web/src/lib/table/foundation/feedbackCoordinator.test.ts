import {afterEach,expect,test,vi} from 'vitest';
import {createFeedbackCoordinator,ownFeedback,type FeedbackEvent,type FeedbackProjection,type FeedbackSink} from './feedback';
const context={session:'table',audience:'alice',generation:'hand-1',revision:'1'};
const event=(id:string,arrival=false):FeedbackEvent=>({id,kind:'cue',participantId:'alice',label:'마이티',cue:'mighty',milestone:arrival?{kind:'arrival',entityIds:['card-ace']}:{kind:'visible'}});
const projection=(stateId='1',events:readonly FeedbackEvent[]=[]):FeedbackProjection=>({scope:{session:context.session,audience:context.audience,generation:context.generation,roomEpoch:'room-epoch',connectionEpoch:'connection-1'},stateId,events,mood:'play'});
function fixture(){const releases:ReturnType<typeof vi.fn>[]=[],moodReleases:ReturnType<typeof vi.fn>[]=[];const emit=vi.fn<FeedbackSink['emit']>(()=>{const release=vi.fn();releases.push(release);return release;}),mood=vi.fn<FeedbackSink['mood']>(()=>{const release=vi.fn();moodReleases.push(release);return release;}),changed=vi.fn(),clock=vi.fn();const coordinator=createFeedbackCoordinator({sink:{emit,mood},onChange:changed,onClock:clock,now:()=>Date.now()});return{coordinator,emit,mood,releases,moodReleases,changed,clock};}
afterEach(()=>vi.useRealTimers());
test('bootstrap is silent, transitions wait for publication, repeated frame/state IDs do not replay',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection('initial',[event('historical')]));f.coordinator.prepareFrame(1,['card-ace']);f.coordinator.published(1);expect(f.emit).not.toHaveBeenCalled();
 f.coordinator.receive(projection('next',[event('fresh')]));expect(f.emit).not.toHaveBeenCalled();f.coordinator.prepareFrame(2,['card-ace']);expect(f.emit).not.toHaveBeenCalled();f.coordinator.published(2);expect(f.emit).toHaveBeenCalledTimes(1);
 f.coordinator.receive(projection('presentation-only',[event('fresh')]));f.coordinator.prepareFrame(3,['card-ace']);f.coordinator.published(3);expect(f.emit).toHaveBeenCalledTimes(1);expect(f.mood).toHaveBeenCalledTimes(1);f.coordinator.dispose();
});
test('arrival feedback requires exact bound frame, event and complete entity set',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('2',[event('arrival',true)]));expect(f.coordinator.prepareFrame(2,['card-ace'])).toEqual([{eventId:'arrival',entityIds:['card-ace']}]);f.coordinator.published(2);
 for(const report of [{frameId:99,eventId:'arrival',entityIds:['card-ace'],outcome:'arrived' as const},{frameId:2,eventId:'other',entityIds:['card-ace'],outcome:'arrived' as const},{frameId:2,eventId:'arrival',entityIds:[],outcome:'arrived' as const}])f.coordinator.settle(report);
 expect(f.emit).not.toHaveBeenCalled();f.coordinator.settle({frameId:2,eventId:'arrival',entityIds:['card-ace'],outcome:'arrived'});expect(f.emit).toHaveBeenCalledTimes(1);
 f.coordinator.settle({frameId:2,eventId:'arrival',entityIds:['card-ace'],outcome:'snapped'});expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.dispose();
});
test('synchronous settlements cannot emit before successful publication and revocation retires pending work',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('2',[event('sync',true)]));f.coordinator.prepareFrame(2,['card-ace']);
 f.coordinator.settle({frameId:2,eventId:'sync',entityIds:['card-ace'],outcome:'snapped'});expect(f.emit).not.toHaveBeenCalled();f.coordinator.published(2);expect(f.emit).toHaveBeenCalledTimes(1);
 f.coordinator.receive(projection('3',[event('revoked',true)]));f.coordinator.prepareFrame(3,['card-ace']);f.coordinator.published(3);f.coordinator.settle({frameId:3,eventId:'revoked',entityIds:['card-ace'],outcome:'revoked'});expect(f.emit).toHaveBeenCalledTimes(1);expect(f.coordinator.inspect().pending).toBe(0);f.coordinator.dispose();
});
test('audience/connection replacement cancels optional effects and stale queued settlements stay silent',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('2',[event('visible')]));f.coordinator.prepareFrame(2,['card-ace']);f.coordinator.published(2);expect(f.emit).toHaveBeenCalledTimes(1);
 const next={...projection('3',[event('historical-in-new-scope')]),scope:{...projection().scope,audience:'bob',connectionEpoch:'connection-2'}};f.coordinator.receive(next);expect(f.releases[0]).toHaveBeenCalledTimes(1);expect(f.moodReleases[0]).toHaveBeenCalledTimes(1);
 f.coordinator.prepareFrame(3,['card-ace']);f.coordinator.published(3);f.coordinator.settle({frameId:2,eventId:'visible',entityIds:['card-ace'],outcome:'arrived'});expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.receive(null);expect(f.coordinator.view()).toMatchObject({cues:[]});expect(f.coordinator.inspect()).toMatchObject({pending:0,active:0,timers:0,ledger:0});f.coordinator.dispose();
});
test('monotonic countdown owns one timer, reports final seconds once and cleans up after disposal',()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const f=fixture();f.coordinator.receive({...projection(),clock:{id:'turn-1',participantId:'alice',deadline:6000,total:6000,local:true}});f.coordinator.prepareFrame(1,[]);f.coordinator.published(1);vi.advanceTimersByTime(0);expect(f.clock).toHaveBeenLastCalledWith('turn-1',1,null);
 vi.advanceTimersByTime(1000);expect(f.clock).toHaveBeenLastCalledWith('turn-1',5/6,5);expect(f.emit.mock.calls.filter(([value])=>value.id==='turn-1:5')).toHaveLength(1);
 f.coordinator.receive({...projection('paint-only'),clock:{id:'turn-1',participantId:'alice',deadline:6000,total:6000,local:true}});f.coordinator.prepareFrame(2,[]);f.coordinator.published(2);vi.advanceTimersByTime(0);expect(f.emit.mock.calls.filter(([value])=>value.id==='turn-1:5')).toHaveLength(1);expect(f.coordinator.inspect().timers).toBe(1);
 f.coordinator.dispose();const count=f.emit.mock.calls.length;vi.advanceTimersByTime(10000);expect(f.emit).toHaveBeenCalledTimes(count);expect(f.coordinator.inspect().timers).toBe(0);expect(f.moodReleases[0]).toHaveBeenCalledTimes(1);
});
test('unavailable or missing arrival entities never emit an invented arrival',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('2',[event('absent',true)]));expect(f.coordinator.prepareFrame(2,[])).toEqual([]);f.coordinator.published(2);f.coordinator.settle({frameId:2,eventId:'absent',entityIds:['card-ace'],outcome:'arrived'});expect(f.emit).not.toHaveBeenCalled();expect(f.coordinator.inspect().pending).toBe(0);f.coordinator.dispose();
});
test('committed feedback ownership rejects foreign identities, forged entities and accessors',()=>{
 const original=projection('1',[event('owned',true)]),owned=ownFeedback(original,context,['alice'],['card-ace']);expect(Object.isFrozen(owned.events[0].milestone)).toBe(true);
 for(const next of [{...original,scope:{...original.scope,audience:'stranger'}},{...original,events:[{...event('foreign'),participantId:'stranger'}]},{...original,events:[{...event('unknown',true),milestone:{kind:'arrival' as const,entityIds:['unknown']}}]}])expect(()=>ownFeedback(next,context,['alice'],['card-ace'])).toThrow();
 let reads=0;const getter=Object.defineProperty({...original},'stateId',{get(){reads++;return 'forged';}});expect(()=>ownFeedback(getter,context,['alice'],['card-ace'])).toThrow();expect(reads).toBe(0);
});
test('same connection new hand cancels old effects and admits fresh live hand events',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('2',[event('old-hand')]));f.coordinator.prepareFrame(2,['card-ace']);f.coordinator.published(2);
 const next={...projection('new-hand',[{...event('fresh-hand'),kind:'shuffle' as const}]),scope:{...projection().scope,generation:'hand-2'}};f.coordinator.receive(next);expect(f.releases[0]).toHaveBeenCalledTimes(1);f.coordinator.prepareFrame(3,['card-ace']);f.coordinator.published(3);
 expect(f.emit).toHaveBeenCalledTimes(2);expect(f.emit.mock.calls[1][0].id).toBe('fresh-hand');f.coordinator.dispose();
});
test('optional effect failures do not throw or leave timers alive after disable',()=>{
 vi.useFakeTimers();const coordinator=createFeedbackCoordinator({sink:{emit(){throw Error('audio unavailable');},mood(){throw Error('music unavailable');}},onChange:()=>{},now:()=>Date.now()});
 expect(()=>{coordinator.receive(projection());coordinator.receive(projection('2',[event('silent')]));coordinator.prepareFrame(2,['card-ace']);coordinator.published(2);}).not.toThrow();
 coordinator.receive(null);expect(coordinator.inspect().timers).toBe(0);vi.advanceTimersByTime(5000);expect(coordinator.inspect().active).toBe(0);coordinator.dispose();
});
test('remote countdown paints remaining time without producing local tick effects or authority changes',()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const f=fixture();f.coordinator.receive({...projection(),clock:{id:'remote',participantId:'alice',deadline:3000,total:3000,local:false}});f.coordinator.prepareFrame(1,[]);f.coordinator.published(1);const publications=f.changed.mock.calls.length;
 vi.advanceTimersByTime(2000);expect(f.clock).toHaveBeenLastCalledWith('remote',1/3,1);expect(f.emit).not.toHaveBeenCalled();expect(f.changed).toHaveBeenCalledTimes(publications);f.coordinator.dispose();
});
test('reentrant emission disposal or revocation releases newly returned cancellation exactly once',()=>{
 vi.useFakeTimers();for(const revoke of ['dispose','clear'] as const){let coordinator:ReturnType<typeof createFeedbackCoordinator>;const stop=vi.fn();const emit=vi.fn(()=>{if(revoke==='dispose')coordinator.dispose();else coordinator.receive(null);return stop;});
 coordinator=createFeedbackCoordinator({sink:{emit,mood:()=>()=>{}},onChange:()=>{},now:()=>Date.now()});coordinator.receive(projection());coordinator.receive(projection('next',[event('reentrant')]));coordinator.prepareFrame(1,['card-ace']);coordinator.published(1);
 expect(emit).toHaveBeenCalledTimes(1);expect(stop).toHaveBeenCalledTimes(1);expect(coordinator.inspect()).toMatchObject({active:0,pending:0,timers:0});coordinator.dispose();expect(stop).toHaveBeenCalledTimes(1);
 }
});
test('reentrant cancellation cannot let an older receive overwrite a newer audience',()=>{
 vi.useFakeTimers();let coordinator:ReturnType<typeof createFeedbackCoordinator>;const inner={...projection('inner'),scope:{...projection().scope,audience:'inner'},mood:'bidding' as const,clock:{id:'inner-clock',participantId:'alice',deadline:10000,total:10000,local:false}},mood=vi.fn<FeedbackSink['mood']>(()=>()=>{});
 const stop=vi.fn(()=>coordinator.receive(inner));coordinator=createFeedbackCoordinator({sink:{emit:()=>stop,mood},onChange:()=>{},now:()=>Date.now()});coordinator.receive(projection());coordinator.receive(projection('visible',[event('active')]));coordinator.prepareFrame(1,['card-ace']);coordinator.published(1);
 coordinator.receive({...projection('outer'),scope:{...projection().scope,audience:'outer'},mood:'result'});
 expect(stop).toHaveBeenCalledTimes(1);expect(coordinator.view().clock?.id).toBe('inner-clock');expect(mood).toHaveBeenLastCalledWith('bidding');coordinator.dispose();
});
test('only the latest prepared frame may publish and release buffered motion settlements',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('2',[event('arrival',true)]));f.coordinator.prepareFrame(1,['card-ace']);f.coordinator.prepareFrame(2,['card-ace']);
 f.coordinator.published(1);f.coordinator.settle({frameId:1,eventId:'arrival',entityIds:['card-ace'],outcome:'arrived'});f.coordinator.settle({frameId:2,eventId:'arrival',entityIds:['card-ace'],outcome:'arrived'});expect(f.emit).not.toHaveBeenCalled();
 f.coordinator.published(2);expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.dispose();expect(f.coordinator.prepareFrame(3,['card-ace'])).toEqual([]);
});
test('active optional effects have a hard cap and evicted effects release their resources',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('2',Array.from({length:64},(_,index)=>event(`event-${index}`))));f.coordinator.prepareFrame(1,[]);f.coordinator.published(1);expect(f.coordinator.inspect().active).toBe(64);
 f.coordinator.receive(projection('3',Array.from({length:6},(_,index)=>event(`later-${index}`))));f.coordinator.prepareFrame(2,[]);f.coordinator.published(2);expect(f.coordinator.inspect().active).toBe(64);for(const release of f.releases.slice(0,6))expect(release).toHaveBeenCalledTimes(1);f.coordinator.dispose();for(const release of f.releases)expect(release).toHaveBeenCalledTimes(1);
});
test('opaque semantic event IDs cannot collide with internally namespaced countdown effects',()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const f=fixture(),clock={id:'turn-1',participantId:'alice',deadline:6000,total:6000,local:true};f.coordinator.receive({...projection(),clock});f.coordinator.prepareFrame(1,[]);f.coordinator.published(1);
 f.coordinator.receive({...projection('2',[event('turn-1:5')]),clock});f.coordinator.prepareFrame(2,[]);f.coordinator.published(2);vi.advanceTimersByTime(1000);
 expect(f.emit.mock.calls.filter(([value])=>value.id==='turn-1:5')).toHaveLength(2);expect(f.emit.mock.calls.filter(([value])=>value.kind==='clock')).toHaveLength(1);expect(f.coordinator.inspect().active).toBe(2);f.coordinator.dispose();
});
test('throwing cancellation cannot stop sibling cleanup or leave a disposed timer',()=>{
 vi.useFakeTimers();const second=vi.fn();let emits=0;const coordinator=createFeedbackCoordinator({sink:{emit:()=>++emits===1?()=>{throw Error('bad cleanup');}:second,mood:()=>()=>{throw Error('bad mood cleanup');}},onChange:()=>{},now:()=>Date.now()});coordinator.receive(projection());coordinator.receive(projection('2',[event('a'),event('b')]));coordinator.prepareFrame(1,[]);coordinator.published(1);expect(()=>coordinator.dispose()).not.toThrow();expect(second).toHaveBeenCalledTimes(1);expect(coordinator.inspect()).toMatchObject({active:0,pending:0,timers:0});
});
test('reentrant clock paint revocation prevents a subsequent tick effect and timer rearm',()=>{
 vi.useFakeTimers();vi.setSystemTime(0);let revoke=false,coordinator:ReturnType<typeof createFeedbackCoordinator>;const emit=vi.fn<FeedbackSink['emit']>(()=>()=>{});coordinator=createFeedbackCoordinator({sink:{emit,mood:()=>()=>{}},onChange:()=>{},onClock(){if(revoke)coordinator.receive(null);},now:()=>Date.now()});coordinator.receive({...projection(),clock:{id:'turn',participantId:'alice',deadline:5000,total:5000,local:true}});coordinator.prepareFrame(1,[]);coordinator.published(1);vi.advanceTimersByTime(0);revoke=true;vi.advanceTimersByTime(1000);expect(emit).not.toHaveBeenCalled();expect(coordinator.inspect()).toMatchObject({active:0,timers:0});coordinator.dispose();
});
test('a superseding projection drops visible and arrival events that never reached publication',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('a',[event('uncommitted-visible'),event('uncommitted-arrival',true)]));f.coordinator.prepareFrame(1,['card-ace']);
 f.coordinator.receive(projection('b',[]));expect(f.coordinator.inspect().pending).toBe(0);expect(f.coordinator.prepareFrame(2,['card-ace'])).toEqual([]);f.coordinator.published(2);f.coordinator.settle({frameId:2,eventId:'uncommitted-arrival',entityIds:['card-ace'],outcome:'arrived'});expect(f.emit).not.toHaveBeenCalled();f.coordinator.dispose();
});
test('only an already committed arrival continues after its event leaves the newest projection',()=>{
 vi.useFakeTimers();const f=fixture();f.coordinator.receive(projection());f.coordinator.receive(projection('a',[event('committed-arrival',true)]));f.coordinator.prepareFrame(1,['card-ace']);f.coordinator.published(1);
 f.coordinator.receive(projection('b',[]));expect(f.coordinator.inspect().pending).toBe(1);f.coordinator.prepareFrame(2,['card-ace']);f.coordinator.settle({frameId:1,eventId:'committed-arrival',entityIds:['card-ace'],outcome:'arrived'});f.coordinator.settle({frameId:2,eventId:'committed-arrival',entityIds:['card-ace'],outcome:'arrived'});expect(f.emit).not.toHaveBeenCalled();
 f.coordinator.published(2);expect(f.emit).toHaveBeenCalledTimes(1);expect(f.emit.mock.calls[0][0].id).toBe('committed-arrival');f.coordinator.dispose();
});
test('expiring two effects drains both cancellations when the first synchronously disposes the coordinator',()=>{
 vi.useFakeTimers();vi.setSystemTime(0);let coordinator:ReturnType<typeof createFeedbackCoordinator>,emits=0;const first=vi.fn(()=>coordinator.dispose()),second=vi.fn();coordinator=createFeedbackCoordinator({sink:{emit:()=>++emits===1?first:second,mood:()=>()=>{}},onChange:()=>{},now:()=>Date.now()});coordinator.receive(projection());coordinator.receive(projection('2',[event('first'),event('second')]));coordinator.prepareFrame(1,[]);coordinator.published(1);vi.advanceTimersByTime(1500);
 expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(1);expect(coordinator.inspect()).toMatchObject({active:0,pending:0,timers:0});
});
test('new private clock state has no paint or tick authority until its own source frame publishes',()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const f=fixture();f.coordinator.receive({...projection(),clock:{id:'old',participantId:'alice',deadline:10000,total:10000,local:false}});f.coordinator.prepareFrame(1,[]);f.coordinator.published(1);vi.advanceTimersByTime(0);const paints=f.clock.mock.calls.length;
 f.coordinator.receive({...projection('unpublished-clock'),clock:{id:'new',participantId:'alice',deadline:3000,total:3000,local:true}});vi.advanceTimersByTime(1000);expect(f.clock).toHaveBeenCalledTimes(paints);expect(f.emit).not.toHaveBeenCalled();f.coordinator.prepareFrame(2,[]);vi.advanceTimersByTime(500);expect(f.clock).toHaveBeenCalledTimes(paints);
 f.coordinator.published(2);vi.advanceTimersByTime(0);expect(f.clock).toHaveBeenLastCalledWith('new',.5,2);f.coordinator.dispose();
});
