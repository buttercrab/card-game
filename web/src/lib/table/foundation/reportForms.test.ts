import { describe, expect, it, vi } from 'vitest';
import type { FormSubmission } from './forms';
import { reportFormOffer, REPORT_POLICY, REPORT_TEXT_FIELD, sendReport } from './reportForms';
const options={roomId:'room1',actorId:'actor1',seat:2,reportMax:2000};
const metadata={ua:'browser',screen:'390x844@2',path:'/room/room1',standalone:false};
const submission=():FormSubmission=>({id:'operation1',instanceId:reportFormOffer(options).instanceId,policyId:REPORT_POLICY.id,context:{session:'s',audience:'a',generation:'g',revision:'r'},binding:reportFormOffer(options).binding,payload:{text:'Problem'}});
describe('fixed report policy and one-attempt host sink',()=>{
    it('binds instances to room+actor, trims only at normalization and compiles text only',()=>{
        const offer=reportFormOffer(options);expect(offer.instanceId).toBe(reportFormOffer(options).instanceId);
        expect(offer.instanceId).not.toBe(reportFormOffer({...options,actorId:'other'}).instanceId);
        const raw={[REPORT_TEXT_FIELD]:'  문제 😀  '};const normalized=REPORT_POLICY.normalize(offer,raw);
        expect(raw[REPORT_TEXT_FIELD]).toBe('  문제 😀  ');expect(normalized.issues).toEqual({});expect(normalized.values).toEqual({[REPORT_TEXT_FIELD]:'문제 😀'});
        expect(REPORT_POLICY.compile(offer,normalized.values)).toEqual({text:'문제 😀'});
        expect(()=>REPORT_POLICY.compile(offer,raw)).toThrow();
        expect(()=>REPORT_POLICY.compile(offer,{[REPORT_TEXT_FIELD]:'a'.repeat(2001)})).toThrow();
        expect(REPORT_POLICY.normalize(offer,{[REPORT_TEXT_FIELD]:'   '}).issues).toHaveProperty(REPORT_TEXT_FIELD);
    });
    it('uses the fixed endpoint and captured binding rather than payload routing',async()=>{
        const fetcher=vi.fn(async()=>({status:204}));expect(await sendReport(submission(),fetcher,metadata)).toBe('processed');
        expect(fetcher).toHaveBeenCalledTimes(1);const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
        expect(url).toBe('/api/reports');expect(init.method).toBe('POST');expect(JSON.parse(init.body as string)).toEqual({text:'Problem',room:'room1',seat:2,client:metadata});
    });
    it('204 means processed, known rejection stays rejected, everything else remains uncertain without retry',async()=>{
        for(const status of [200,201,202,401,403,404,500,503]) {const fetcher=vi.fn(async()=>({status}));expect(await sendReport(submission(),fetcher,metadata)).toBe('uncertain');expect(fetcher).toHaveBeenCalledTimes(1);}
        for(const status of [400,429]) expect(await sendReport(submission(),async()=>({status}),metadata)).toBe('rejected');
        const fetcher=vi.fn(async()=>{throw new DOMException('aborted','AbortError');});expect(await sendReport(submission(),fetcher,metadata)).toBe('uncertain');expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('bounds metadata and refuses noncanonical payloads before sending',async()=>{
        const fetcher=vi.fn(async()=>({status:204}));expect(await sendReport(submission(),fetcher,{...metadata,ua:'a'.repeat(2000),path:'p'.repeat(3000)})).toBe('processed');
        const init=fetcher.mock.calls[0] as unknown as [string,RequestInit];const client=JSON.parse(init[1].body as string).client;expect(client.ua.length).toBe(1024);expect(client.path.length).toBe(2048);
        fetcher.mockClear();expect(await sendReport({...submission(),payload:{text:'Problem',room:'other'}},fetcher,metadata)).toBe('rejected');expect(fetcher).not.toHaveBeenCalled();
    });
});
