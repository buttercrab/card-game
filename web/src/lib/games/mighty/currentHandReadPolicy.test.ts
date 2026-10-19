import {expect,test} from 'vitest';
import type {RecordedHand,View} from './types';
import {completionFixture} from './testSupport/completionFixture';
import {createMightyCurrentHandReadPolicy,mightyCurrentHandCatalogOffer,type MightyCurrentHandReadCapture} from './currentHandReadPolicy';
import {ownDisclosureOffer,ownDisclosurePage,ownDisclosureDocument} from '../../table/foundation/disclosures';
function capture():MightyCurrentHandReadCapture{const f=completionFixture();return{scope:{roomId:'room',roomEpoch:'epoch',actorId:'bob',connectionEpoch:'connection',visibility:'public'},revision:'current:1',entryId:'current:2:3',source:{identity:{roomId:'room',roomEpoch:'epoch',sessionId:2,handNumber:3},record:f.room!.current_hand!}};}
test('singleton policy requires one admitted exact current row and strict public replay content',()=>{
 const latest=capture(),policy=createMightyCurrentHandReadPolicy(()=>latest),offer=ownDisclosureOffer(mightyCurrentHandCatalogOffer(latest));expect(()=>policy.select(offer,latest.entryId)).toThrow();const page=ownDisclosurePage(policy.page(offer,0),offer,0);expect(page.entries).toEqual([{id:latest.entryId,title:'이번 판 다시 보기'}]);expect(()=>policy.select(offer,'old-hand')).toThrow();
 const doc=ownDisclosureDocument(policy.select(offer,latest.entryId));expect(doc.roster[1].name).toBe('Old Bob');expect(doc.title).toBe('이번 판 다시 보기');expect(JSON.stringify(doc)).toContain('공개');expect(doc.cards).toHaveLength(1);expect(()=>policy.page(offer,1)).toThrow();
});
test('retired capture, replaced revision or source scope cannot read prior singleton',()=>{
 const first=capture();let latest:MightyCurrentHandReadCapture|null=first;const policy=createMightyCurrentHandReadPolicy(()=>latest),offer=mightyCurrentHandCatalogOffer(first);policy.page(offer,0);
 for(const change of ['missing','revision','actor','connection']as const){latest=change==='missing'?null:change==='revision'?{...first,revision:'next'}:{...first,scope:{...first.scope,[change==='actor'?'actorId':'connectionEpoch']:'other'}};expect(()=>policy.select(offer,first.entryId)).toThrow();}
});
test('a privileged seat record is never converted into public current replay',()=>{
 const latest=capture(),record=latest.source.record as RecordedHand,view=record.view as View;view.viewer={Seat:1};view.hand=[{Normal:['Spade',2]}];if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error('Expected Done');view.phase.Done.discards=[{Normal:['Heart',2]}];
 const policy=createMightyCurrentHandReadPolicy(()=>latest),offer=mightyCurrentHandCatalogOffer(latest);policy.page(offer,0);const doc=ownDisclosureDocument(policy.select(offer,latest.entryId));expect(doc.roster).toEqual([]);expect(doc.cards).toEqual([]);expect(JSON.stringify(doc)).toContain('기록을 열 수 없어요');expect(JSON.stringify(doc)).not.toContain('Normal');
});
