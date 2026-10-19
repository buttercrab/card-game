import {expect,test} from 'vitest';
import {createStandaloneMightyRecordToolsFixture} from './testSupport/recordToolsOwner.fixture';
import {completionFixture} from './testSupport/completionFixture';
import {captureDeviceStatsDeletion,storeCompletion,completionKey,COMPLETION_STORAGE_KEY,readDeviceRecords,type CompletionStorage} from './completionStore';
import {deleteMightyDeviceStats,MIGHTY_DEVICE_DELETE_FORM_POLICY,MIGHTY_DEVICE_DELETE_OPERATION} from './deviceDeletion';
import {validateFormOffer,type FormSubmission} from '../../table/foundation/forms';
import {ownDisclosureFormActions,type DisclosureSelectionReceipt} from '../../table/foundation/disclosures';
import type {ConnectedDisclosureContext} from '../../table/foundation/connectedDisclosures';
import type {Mighty} from './types';
class Memory implements CompletionStorage{values=new Map<string,string>();writes=0;fail=false;onWrite:(()=>void)|null=null;getItem(key:string){return this.values.get(key)??null;}setItem(key:string,value:string){if(this.fail)throw Error('quota');this.writes++;this.values.set(key,value);this.onWrite?.();}}
const hand=(n:number)=>({key:completionKey({roomId:'room',roomEpoch:'epoch',sessionId:2,handNumber:n,actorId:'bob'}),at:n,role:'declarer' as const,won:true,payoff:6,contract:{trump:null,count:17},teamPoints:20});
const put=(storage:CompletionStorage,n=1)=>storeCompletion({hand:hand(n),tookWithMighty:true,alone:true},storage);
function setup(){
 const storage=new Memory();put(storage);const f=completionFixture();
 const input:ConnectedDisclosureContext<Mighty>={client:{room:f.room,seat:f.seat,viewerId:f.actorId,viewerName:'Bob'},roomScope:f.scope!,context:{session:'mighty:room:2',audience:'bob:0',generation:'2',revision:'1'},sourceRevision:'history:1',connectionEpoch:'connection',publicHistory:{current:{sessionId:2,records:[f.room!.current_hand!]},archives:[]}};
 const owner=createStandaloneMightyRecordToolsFixture(()=>readDeviceRecords(storage),()=>captureDeviceStatsDeletion(storage));let sequence=0,current=true;
 function select(){
  const offer=owner.project(input).offers[1],policy=owner.policies[1],page=policy.page(offer,0),entryId=page.entries[0].id;policy.select(offer,entryId);
  const receipt:DisclosureSelectionReceipt={id:`selection:${++sequence}`,catalogId:offer.id,revision:offer.revision,entryId,scope:offer.scope};owner.selectionChanged!(receipt);
  const projected=owner.project(input),form=validateFormOffer(projected.forms![0]);ownDisclosureFormActions(projected.formActions!,projected.offers,projected.forms!);
  const submission:FormSubmission={id:`local:${sequence}`,instanceId:`port:${sequence}`,policyId:form.policyId,context:input.context,binding:form.binding,payload:MIGHTY_DEVICE_DELETE_FORM_POLICY.compile(form,{}),actionId:'delete',operationId:MIGHTY_DEVICE_DELETE_OPERATION,offerInstanceId:form.instanceId,formId:form.id,access:form.access};
  const run=()=>deleteMightyDeviceStats(submission,{resolve:token=>owner.resolveFormAuthority!(receipt.id,token),isCurrent:()=>current});
  return {receipt,submission,projected,run};
 }
 return {storage,owner,input,select,setCurrent(value:boolean){current=value;}};
}
test('confirmed deletion consumes only the captured basis, keeps dedup/awards, and refreshes only device revision',()=>{
 const s=setup(),selected=s.select(),before=readDeviceRecords(s.storage);expect(selected.projected.forms![0]).toMatchObject({purpose:'confirmation',retry:'new-offer',fields:[]});
 expect(JSON.stringify(selected.projected)).not.toContain('mighty-completion');expect(JSON.stringify(selected.projected)).not.toContain('commit');
 expect(selected.run().status).toBe('stored');expect(selected.run().status).toBe('conflict');
 const refresh=s.owner.operationCommitted!(selected.submission)!;expect(refresh).toMatchObject({selectionId:selected.receipt.id,catalogId:selected.receipt.catalogId});expect(s.owner.operationCommitted!(selected.submission)).toBeNull();
 const next=s.owner.project(s.input);expect(next.offers[1].revision).toBe(refresh.revision);expect(next.offers[0].revision).toBe(selected.projected.offers[0].revision);expect(next.forms).toBeUndefined();
 const after=readDeviceRecords(s.storage);expect(after.status).toBe('ready');if(after.status!=='ready'||before.status!=='ready')throw Error();expect(after.records.hands).toEqual([]);expect(after.records.completed).toEqual(before.records.completed);expect(after.records.unlocked).toEqual(before.records.unlocked);expect(put(s.storage).status).toBe('duplicate');
});
test('an unseen completion conflicts without deletion or rebasing; a new page supplies a fresh confirmation',()=>{
 const s=setup(),first=s.select();put(s.storage,2);const raw=s.storage.getItem(COMPLETION_STORAGE_KEY),writes=s.storage.writes;
 expect(first.run().status).toBe('conflict');expect(s.storage.writes).toBe(writes);expect(s.storage.getItem(COMPLETION_STORAGE_KEY)).toBe(raw);expect(s.owner.operationCommitted!(first.submission)).toBeNull();
 const fresh=s.select();expect(fresh.receipt.entryId).not.toBe(first.receipt.entryId);expect(fresh.submission.offerInstanceId).not.toBe(first.submission.offerInstanceId);expect(fresh.run().status).toBe('stored');
});
test('quota-failed capture cannot retry; explicit fresh read can succeed after recovery',()=>{
 const s=setup(),first=s.select(),raw=s.storage.getItem(COMPLETION_STORAGE_KEY),writes=s.storage.writes;s.storage.fail=true;
 expect(first.run().status).toBe('failed');s.storage.fail=false;expect(first.run().status).toBe('conflict');expect(s.storage.writes).toBe(writes);expect(s.storage.getItem(COMPLETION_STORAGE_KEY)).toBe(raw);
 expect(s.select().run().status).toBe('stored');
});
test('retirement and fixed authority loss deny deletion without IO or leaked private capability',()=>{
 const s=setup(),selected=s.select(),writes=s.storage.writes;s.setCurrent(false);expect(selected.run().status).toBe('conflict');expect(s.storage.writes).toBe(writes);
 s.setCurrent(true);s.owner.revoke();expect(selected.run().status).toBe('conflict');expect(s.storage.writes).toBe(writes);expect(s.owner.resolveFormAuthority!(selected.receipt.id,String(selected.submission.binding.captureToken))).toBeNull();
});
test('native retirement during atomic write cannot acknowledge the old view or retry the consumed capture',()=>{
 const s=setup(),selected=s.select(),writes=s.storage.writes;s.storage.onWrite=()=>{s.setCurrent(false);s.owner.revoke();};
 expect(selected.run().status).toBe('uncertain');expect(s.storage.writes).toBe(writes+1);expect(s.owner.operationCommitted!(selected.submission)).toBeNull();expect(selected.run().status).toBe('conflict');expect(s.storage.writes).toBe(writes+1);
 const read=readDeviceRecords(s.storage);expect(read.status).toBe('ready');if(read.status!=='ready')throw Error();expect(read.records.hands).toEqual([]);expect(read.records.completed).toEqual([hand(1).key]);expect(read.records.unlocked['first-win']).toBe(1);
});
