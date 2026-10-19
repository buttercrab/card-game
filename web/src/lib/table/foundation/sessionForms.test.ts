import { describe, expect, it, vi } from 'vitest';
import { createCardSession } from './session';
import type { SessionSnapshot, TableDocument } from './contracts';
import type { FormDraftSnapshot, FormOffer, HostFormPolicy } from './forms';
const form = ():FormOffer<never>=>({id:'amount',instanceId:'amount:actor',schemaVersion:'1',policyId:'number:v1',baseVersion:'1',editBinding:'actor',title:'Amount',submitLabel:'Save',enabled:true,binding:{actor:'actor',seat:0},fields:[{id:'amount',label:'Amount',kind:'number',maxCodePoints:16,maxCodeUnits:16,required:true,initial:'1',min:0,max:10,step:1}]});
const doc=(revision='1'):TableDocument<string>=>({context:{session:'s',audience:'actor',generation:'g',revision},participant:{id:'actor',name:'Actor',markers:[]},hand:[],facts:[],decision:{id:'decision',kind:'commands',commands:['pass']},offer:{id:`offer:${revision}`,actions:[{id:'pass',kind:'command',label:'Pass',intent:'secondary',enabled:true,action:'pass'}]},forms:[form()]});
const draft=(amount='3',revision=1):FormDraftSnapshot=>Object.freeze({values:Object.freeze({amount}),revision,compositionEpoch:0,composing:false});
const numericPolicy = ():HostFormPolicy=>({id:'number:v1',normalize(_offer,values){return {values,issues:{}};},compile(_offer,values){return {amount:Number(values.amount)};}});
const current=(session:{snapshot():SessionSnapshot<unknown>})=>session.snapshot().document!.context;

describe('session owned form admission',()=>{
    it('atomically owns a frozen compiled payload and sends once after journaling',async()=>{
        const compiled={amount:3};const policy=numericPolicy();policy.compile=(_offer,values)=>{expect(Object.isFrozen(values)).toBe(true);return compiled;};
        const send=vi.fn();const session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:send});session.receive(doc());
        const source=draft();const port=session.bindForm(form().instanceId,()=>source);
        expect(port.commit(current(session),'amount')).toBe(true);expect(send).not.toHaveBeenCalled();expect(session.snapshot().formOperations).toEqual([{id:expect.any(String),instanceId:port.instanceId,actionId:'submit',draftRevision:1,message:undefined,status:'queued',attempted:false,refreshDisclosure:undefined,formId:'amount',offerInstanceId:'amount:actor'}]);
        compiled.amount=9;expect(port.commit(current(session),'amount')).toBe(false);await Promise.resolve();
        expect(send).toHaveBeenCalledTimes(1);const sent=send.mock.calls[0][0];expect(sent.payload).toEqual({amount:3});expect(Object.isFrozen(sent.payload)).toBe(true);expect(Object.isFrozen(sent.binding)).toBe(true);expect(sent.instanceId).toBe(port.instanceId);
        expect(session.snapshot().formOperations![0].status).toBe('sending');expect(JSON.stringify(session.snapshot().formOperations)).not.toContain('payload');
    });
    it('abandons admission when normalization reenters and changes the draft snapshot',async()=>{
        let source=draft();const policy=numericPolicy();policy.normalize=(_offer,values)=>{source=draft('4',2);return {values,issues:{}};};
        const send=vi.fn();const session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:send});session.receive(doc());const port=session.bindForm(form().instanceId,()=>source);
        expect(port.commit(current(session),'amount')).toBe(false);await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().formOperations).toEqual([]);
    });
    it('abandons admission when compilation reenters and replaces the document',async()=>{
        const send=vi.fn();const policy=numericPolicy();const session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:send});session.receive(doc());
        policy.compile=()=>{session.receive(doc('2'));return {amount:3};};const source=draft(),port=session.bindForm(form().instanceId,()=>source);const before=current(session);
        expect(port.commit(before,'amount')).toBe(false);await Promise.resolve();expect(send).not.toHaveBeenCalled();
    });
    it('rejects throwing, asynchronous, unknown-field or exotic policy output before transport',async()=>{
        const variants:HostFormPolicy[]=[
            {...numericPolicy(),normalize(){throw Error('failure');}},
            {...numericPolicy(),normalize:()=>Promise.resolve({values:{amount:'3'},issues:{}}) as never},
            {...numericPolicy(),normalize:()=>({values:{amount:'3',extra:'x'},issues:{}})},
            {...numericPolicy(),compile:()=>Promise.resolve({amount:3}) as never},
            {...numericPolicy(),compile:()=>({amount:NaN})},
            {...numericPolicy(),compile:()=>({amount:{nested:3}}) as never},
        ];
        for(const policy of variants){const send=vi.fn(),session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:send});session.receive(doc());const source=draft(),port=session.bindForm(form().instanceId,()=>source);expect(port.commit(current(session),'amount')).toBe(false);await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().formOperations).toEqual([]);}
    });
    it('blocks same-port and other-port compiler reentry before invoking policy recursively',async()=>{
        for(const otherPort of [false,true]) {
            const send=vi.fn(),policy=numericPolicy();const session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:send});session.receive(doc());
            const source=draft(),first=session.bindForm(form().instanceId,()=>source),second=session.bindForm(form().instanceId,()=>source);let calls=0;
            policy.compile=()=>{calls++;expect((otherPort?second:first).commit(current(session),'amount')).toBe(false);return {amount:3};};
            expect(first.commit(current(session),'amount')).toBe(true);await Promise.resolve();expect(calls).toBe(1);expect(send).toHaveBeenCalledTimes(1);expect(session.snapshot().formOperations).toHaveLength(1);
        }
    });
    it('rejects falsy or array policy issue containers rather than treating them as empty success',()=>{
        for(const issues of [[], '',0,false]) {
            const policy={...numericPolicy(),normalize:()=>({values:{amount:'3'},issues}) as never};const session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:()=>{}});session.receive(doc());const source=draft(),port=session.bindForm(form().instanceId,()=>source);expect(port.commit(current(session),'amount')).toBe(false);
        }
    });
    it('rejects composing or invalid numeric drafts without altering the source',()=>{
        const session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive(doc());let source=draft('-');const port=session.bindForm(form().instanceId,()=>source);
        expect(port.commit(current(session),'amount')).toBe(false);expect(source.values.amount).toBe('-');source={...draft(),composing:true};expect(port.commit(current(session),'amount')).toBe(false);
    });
    it('allows known rejection retry but fences uncertain and processed outcomes for that source instance',async()=>{
        const send=vi.fn(),session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:send});session.receive(doc());const source=draft(),port=session.bindForm(form().instanceId,()=>source);
        expect(port.commit(current(session),'amount')).toBe(true);await Promise.resolve();const first=session.snapshot().formOperations![0];expect(session.resolveForm(first.id,'uncertain')).toBe(true);expect(port.commit(current(session),'amount')).toBe(false);
        expect(session.resolveForm(first.id,'rejected')).toBe(true);expect(port.commit(current(session),'amount')).toBe(true);await Promise.resolve();const second=session.snapshot().formOperations![1];expect(session.resolveForm(second.id,'processed')).toBe(true);expect(port.commit(current(session),'amount')).toBe(false);expect(session.resolveForm(second.id,'rejected')).toBe(false);expect(send).toHaveBeenCalledTimes(2);
    });
    it('reopening creates a new source instance isolated from a late old outcome',async()=>{
        const send=vi.fn(),session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:send});session.receive(doc());const source=draft(),old=session.bindForm(form().instanceId,()=>source);expect(old.commit(current(session),'amount')).toBe(true);await Promise.resolve();const op=session.snapshot().formOperations![0];old.dispose();
        const reopened=session.bindForm(form().instanceId,()=>source);expect(reopened.instanceId).not.toBe(old.instanceId);expect(session.resolveForm(op.id,'processed')).toBe(true);expect(old.commit(current(session),'amount')).toBe(false);expect(reopened.commit(current(session),'amount')).toBe(true);await Promise.resolve();expect(send).toHaveBeenCalledTimes(2);expect(session.snapshot().formOperations!.map(op=>op.instanceId)).toEqual([old.instanceId,reopened.instanceId]);
    });
    it('retains uncertainty after a throwing sink and cancels an unsent operation on audience change',async()=>{
        const send=vi.fn(()=>{throw Error('may have sent');}),session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:send});session.receive(doc());const source=draft(),port=session.bindForm(form().instanceId,()=>source);expect(port.commit(current(session),'amount')).toBe(true);await Promise.resolve();expect(session.snapshot().formOperations![0].status).toBe('uncertain');expect(port.commit(current(session),'amount')).toBe(false);
        const next={...doc('2'),context:{...doc('2').context,audience:'other'}};session.receive(next);expect(session.snapshot().formOperations).toEqual([]);expect(port.commit(current(session),'amount')).toBe(false);
    });
    it('rejects commits while awaiting authoritative state',()=>{
        const send=vi.fn(),session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:send});session.receive(doc());const source=draft(),port=session.bindForm(form().instanceId,()=>source);session.awaitState();expect(port.commit(current(session),'amount')).toBe(false);expect(send).not.toHaveBeenCalled();
    });
    it('cancels before the sink when queued or sending notifications revoke source authority',async()=>{
        for(const stage of ['queued','sending'])for(const mutation of ['disconnect','remove','disable','dispose']) {
            const send=vi.fn(),session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:send});session.receive(doc());const source=draft(),port=session.bindForm(form().instanceId,()=>source);let armed=true;
            session.subscribe(snapshot=>{if(!armed||!snapshot.formOperations?.some(op=>op.status===stage))return;armed=false;
                if(mutation==='disconnect')session.setConnected(false);
                else if(mutation==='dispose')port.dispose();
                else session.receive({...doc('2'),forms:mutation==='remove'?[]:[{...form(),enabled:false}]});
            });
            expect(port.commit(current(session),'amount')).toBe(true);await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().formOperations![0].status).toBe('cancelled');
        }
    });
    it('rejects primitive compiler results even when their enumerable values appear valid',()=>{
        for(const compiled of ['unexpected',3]) {
            const policy={...numericPolicy(),compile:()=>compiled as never};const session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:()=>{}});session.receive(doc());const source=draft(),port=session.bindForm(form().instanceId,()=>source);expect(port.commit(current(session),'amount')).toBe(false);
        }
    });
    it('requires an exact draft snapshot with boolean composition state and nonnegative counters',()=>{
        for(const source of [{...draft(),composing:''},{...draft(),composing:undefined},{values:{amount:'3'},revision:1,compositionEpoch:0},{...draft(),revision:-1},{...draft(),compositionEpoch:-1},{...draft(),extra:'unexpected'}]) {
            const session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive(doc());const port=session.bindForm(form().instanceId,()=>source as FormDraftSnapshot);expect(port.commit(current(session),'amount')).toBe(false);
        }
    });
    it('rejects same-reference draft mutation during policy execution',()=>{
        const source={values:{amount:'3'},revision:1,compositionEpoch:0,composing:false};const policy=numericPolicy();policy.compile=()=>{source.values.amount='4';source.revision++;return {amount:3};};
        const session=createCardSession({transport:()=>{},formPolicies:[policy],formTransport:()=>{}});session.receive(doc());const port=session.bindForm(form().instanceId,()=>source);expect(port.commit(current(session),'amount')).toBe(false);
    });
    it('treats a throwing draft source at either read as failed admission',()=>{
        for(const throwOn of [1,2]) {
            let reads=0;const source=draft(),session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive(doc());const port=session.bindForm(form().instanceId,()=>{if(++reads===throwOn)throw Error('source failed');return source;});expect(port.commit(current(session),'amount')).toBe(false);expect(session.snapshot().formOperations).toEqual([]);
        }
    });
    it('never resurrects an old source port after revoke and same-actor receive',()=>{
        const session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive(doc());const source=draft(),old=session.bindForm(form().instanceId,()=>source);session.revoke();session.receive(doc('2'));expect(old.commit(current(session),'amount')).toBe(false);const fresh=session.bindForm(form().instanceId,()=>source);expect(fresh.commit(current(session),'amount')).toBe(true);
    });
    it('requires a new port when schema, base version or edit binding changes',()=>{
        for(const update of [{schemaVersion:'2'},{baseVersion:'2'},{editBinding:'other'},{binding:{actor:'other',seat:1}}]) {
            const session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive(doc());const source=draft(),old=session.bindForm(form().instanceId,()=>source);session.receive({...doc('2'),forms:[{...form(),...update}]});expect(old.commit(current(session),'amount')).toBe(false);const fresh=session.bindForm(form().instanceId,()=>source);expect(fresh.commit(current(session),'amount')).toBe(true);
        }
    });
    it('keeps a source alive when only an unrelated form is added or changed',()=>{
        for(const changeB of [false,true]) {
            const b={...form(),id:'other',instanceId:'other:actor',editBinding:'other'};
            const session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive({...doc(),forms:changeB?[form(),b]:[form()]});
            const source=draft(),a=session.bindForm(form().instanceId,()=>source);
            session.receive({...doc('2'),forms:[form(),{...b,baseVersion:'2'}]});expect(a.commit(current(session),'amount')).toBe(true);
        }
    });
    it('does not resurrect an old source when its changed offer later returns to the original schema',()=>{
        const session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive(doc());const source=draft(),old=session.bindForm(form().instanceId,()=>source);
        session.receive({...doc('2'),forms:[{...form(),baseVersion:'2'}]});session.receive(doc('3'));expect(old.commit(current(session),'amount')).toBe(false);
        const fresh=session.bindForm(form().instanceId,()=>source);expect(fresh.commit(current(session),'amount')).toBe(true);
    });
    it('rejects invalid form registries atomically without replacing the accepted document',()=>{
        const session=createCardSession({transport:()=>{},formPolicies:[numericPolicy()],formTransport:()=>{}});session.receive(doc());const before=session.snapshot().document;
        for(const forms of [[form(),form()],[{...form(),policyId:'unknown'}],[{...form(),fields:[{...form().fields[0],maxCodeUnits:0}]}]]){expect(()=>session.receive({...doc('2'),forms})).toThrow();expect(session.snapshot().document).toBe(before);}
    });
});
