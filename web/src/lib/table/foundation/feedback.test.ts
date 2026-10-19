import {afterEach,expect,test,vi} from 'vitest';
import {createFeedbackCoordinator,type FeedbackEvent,type FeedbackProjection} from './feedback';
const event:FeedbackEvent={id:'public-misdeal',kind:'cue',participantId:'alice',cue:'misdeal',label:'공개 카드',publicCards:[{id:'public-ace',label:'공개 에이스',visual:{kind:'standard',suit:'Spade',rank:14}}],milestone:{kind:'visible'}};
const projection=(stateId:string,events:readonly FeedbackEvent[]=[]):FeedbackProjection=>({stateId,scope:{session:'table',audience:'alice',generation:'hand:1',roomEpoch:'epoch',connectionEpoch:'connection'},events,mood:'bidding'});
function fixture(){
 vi.useFakeTimers();vi.setSystemTime(0);const emit=vi.fn(()=>vi.fn()),coordinator=createFeedbackCoordinator({sink:{emit,mood:()=>()=>{}},onChange:vi.fn(),now:()=>Date.now()});
 coordinator.receive(projection('bootstrap'));coordinator.prepareFrame(1,[]);coordinator.published(1);coordinator.receive(projection('live',[event]));coordinator.prepareFrame(2,[]);coordinator.published(2);
 const publish=(id:number)=>{coordinator.prepareFrame(id,[]);coordinator.published(id);};
 return{coordinator,emit,publish};
}
afterEach(()=>vi.useRealTimers());
test('public fan measurement delay consumes no lifetime and no ongoing polling timer',()=>{
 const f=fixture();expect(f.emit).toHaveBeenCalledTimes(1);expect(f.coordinator.view().disclosures).toHaveLength(1);vi.advanceTimersByTime(20000);expect(f.coordinator.view().disclosures).toHaveLength(1);expect(f.coordinator.inspect().timers).toBe(0);
 f.publish(3);f.coordinator.presented(3,[event.id]);vi.advanceTimersByTime(3999);expect(f.coordinator.view().disclosures).toHaveLength(1);vi.advanceTimersByTime(1);expect(f.coordinator.view().disclosures).toHaveLength(0);expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.dispose();
});
test('unknown, stale, unprepared and not-yet-published acknowledgements cannot start expiry',()=>{
 const f=fixture();f.coordinator.presented(99,[event.id]);f.coordinator.presented(2,['unknown']);f.coordinator.prepareFrame(3,[]);f.coordinator.presented(2,[event.id]);f.coordinator.presented(3,[event.id]);vi.advanceTimersByTime(10000);expect(f.coordinator.view().disclosures).toHaveLength(1);
 f.coordinator.published(3);f.coordinator.presented(3,[event.id]);vi.advanceTimersByTime(4000);expect(f.coordinator.view().disclosures).toHaveLength(0);f.coordinator.dispose();
});
test('duplicate acknowledgements and resize publications never extend an acknowledged fan',()=>{
 const f=fixture();f.publish(3);f.coordinator.presented(3,[event.id,event.id]);vi.advanceTimersByTime(2000);f.coordinator.presented(3,[event.id]);f.publish(4);f.coordinator.presented(4,[event.id]);vi.advanceTimersByTime(2000);expect(f.coordinator.view().disclosures).toHaveLength(0);
 f.publish(5);f.coordinator.presented(5,[event.id]);vi.advanceTimersByTime(4000);expect(f.coordinator.view().disclosures).toHaveLength(0);expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.dispose();
});
test('dismissal and actor or generation revocation discard unacknowledged fan state permanently',()=>{
 for(const kind of ['dismiss','revoke','actor','generation'] as const){
  const f=fixture();
  if(kind==='dismiss')f.coordinator.dismiss(event.id);
  else if(kind==='revoke')f.coordinator.receive(null);
  else{const next=projection('replacement');f.coordinator.receive({...next,scope:{...next.scope,...(kind==='actor'?{audience:'bob'}:{generation:'hand:2'})}});}
  f.coordinator.presented(2,[event.id]);vi.advanceTimersByTime(10000);expect(f.coordinator.view().disclosures).toHaveLength(0);expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.dispose();
 }
});
test('superseded publications cannot acknowledge and repeated source state cannot replay expired cards',()=>{
 const f=fixture();f.coordinator.receive(projection('new-source',[event]));f.coordinator.presented(2,[event.id]);vi.advanceTimersByTime(5000);expect(f.coordinator.view().disclosures).toHaveLength(1);
 f.publish(4);f.coordinator.presented(4,[event.id]);vi.advanceTimersByTime(4000);expect(f.coordinator.view().disclosures).toHaveLength(0);f.coordinator.receive(projection('repeated-source',[event]));f.publish(5);f.coordinator.presented(5,[event.id]);expect(f.coordinator.view().disclosures).toHaveLength(0);expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.dispose();
});


test('an unpresented fan removed by a newer same-generation source cannot appear or acknowledge later',()=>{
 const f=fixture();expect(f.coordinator.view().disclosures).toHaveLength(1);const release=f.emit.mock.results[0].value;
 f.coordinator.receive(projection('source-without-event'));expect(release).toHaveBeenCalledTimes(1);expect(f.coordinator.view().disclosures).toHaveLength(0);f.publish(3);f.coordinator.presented(3,[event.id]);vi.advanceTimersByTime(10000);expect(f.coordinator.view().disclosures).toHaveLength(0);
 f.coordinator.receive(projection('old-event-returned',[event]));f.publish(4);f.coordinator.presented(4,[event.id]);expect(f.coordinator.view().disclosures).toHaveLength(0);expect(f.emit).toHaveBeenCalledTimes(1);f.coordinator.dispose();
});
test('an acknowledged fan may finish its existing lifetime after the source removes it',()=>{
 const f=fixture();f.publish(3);f.coordinator.presented(3,[event.id]);vi.advanceTimersByTime(1000);f.coordinator.receive(projection('source-without-event'));f.publish(4);expect(f.coordinator.view().disclosures).toHaveLength(1);f.coordinator.presented(4,[event.id]);vi.advanceTimersByTime(3000);expect(f.coordinator.view().disclosures).toHaveLength(0);f.coordinator.dispose();
});
test('supersession drains every retired release even when the first release reenters',()=>{
 const f=fixture(),second={...event,id:'another-public-fan'};f.coordinator.receive(projection('both',[event,second]));f.publish(3);expect(f.emit).toHaveBeenCalledTimes(2);
 const firstRelease=f.emit.mock.results[0].value,secondRelease=f.emit.mock.results[1].value;firstRelease.mockImplementation(()=>{f.coordinator.receive(projection('reentrant-source'));});
 f.coordinator.receive(projection('without-either'));expect(firstRelease).toHaveBeenCalledTimes(1);expect(secondRelease).toHaveBeenCalledTimes(1);expect(f.coordinator.view().disclosures).toHaveLength(0);f.coordinator.dispose();
});


test('same authoritative state metadata does not retire a fan waiting behind motion',()=>{
 const f=fixture();f.coordinator.receive(projection('live'));f.publish(3);vi.advanceTimersByTime(5000);expect(f.coordinator.view().disclosures).toHaveLength(1);expect(f.emit).toHaveBeenCalledTimes(1);
 f.coordinator.presented(3,[event.id]);vi.advanceTimersByTime(3999);expect(f.coordinator.view().disclosures).toHaveLength(1);vi.advanceTimersByTime(1);expect(f.coordinator.view().disclosures).toHaveLength(0);f.coordinator.dispose();
});
