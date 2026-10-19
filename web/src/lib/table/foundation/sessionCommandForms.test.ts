import { describe, expect, it, vi } from 'vitest';
import type { CommandScope } from '../../generated/protocol';
import type { TableDocument, SessionSnapshot } from './contracts';
import type { CommandFormPolicy, FormDraftSnapshot, FormOffer } from './forms';
import { createCardSession } from './session';
import { renameForm, NAME_POLICY, NAME_TEXT_FIELD, type NameCommand } from './nameForms';

type Action = NameCommand | { readonly kind:'ping' };
const scope=(version=10):CommandScope=>({domain:'room',room_id:'room',room_epoch:'epoch',actor_id:'actor',seat:0,session_id:1,hand:0,version});
const form=(version=10)=>renameForm({roomId:'room',actorId:'actor',seat:0,name:'Old',currentScope:scope(version),nameMax:24});
const document=(version=10,forms:readonly FormOffer<Action>[]=[form(version)]):TableDocument<Action>=>({
    context:{session:'s',audience:'actor',generation:'g',revision:String(version)},participant:{id:'actor',name:'Old',markers:[]},hand:[],facts:[],forms,
    decision:{id:'commands',kind:'commands',commands:['ping']},offer:{id:`combined:${version}`,actions:[{id:'ping',kind:'command',label:'Ping',intent:'secondary',enabled:true,action:{kind:'ping'}}]},
});
const draft:FormDraftSnapshot=Object.freeze({values:Object.freeze({[NAME_TEXT_FIELD]:'New 😀'}),revision:1,compositionEpoch:0,composing:false});
const context=(session:{snapshot():SessionSnapshot<Action>})=>session.snapshot().document!.context;
const ping=(session:{snapshot():SessionSnapshot<Action>})=>session.snapshot().document!.offer.actions.find(item=>item.id==='ping')!;
const fixture=(policy:CommandFormPolicy<NameCommand>=NAME_POLICY,maxOperations=128)=>{
    const send=vi.fn(),http=vi.fn(),session=createCardSession<Action>({transport:send,formTransport:http,formPolicies:[policy],maxOperations});
    session.receive(document());const port=session.bindForm(form().instanceId,()=>draft);return {send,http,session,port};
};

describe('typed command forms use the ordinary session ledger',()=>{
    it('journals and transmits exactly one typed command without the HTTP form sink',async()=>{
        const {session,port,send,http}=fixture();expect(port.commit(context(session),form().id)).toBe(true);expect(send).not.toHaveBeenCalled();
        expect(session.snapshot().operations).toHaveLength(1);expect(session.snapshot().formOperations).toEqual([{id:expect.any(String),instanceId:port.instanceId,actionId:'submit',draftRevision:1,status:'queued'}]);
        expect(port.commit(context(session),form().id)).toBe(false);await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);expect(http).not.toHaveBeenCalled();
        const sent=send.mock.calls[0][0];expect(sent.action).toEqual({kind:'room',action:{type:'rename',name:'New 😀'},expected:scope()});expect(Object.isFrozen(sent.action.action)).toBe(true);
        expect(sent.actionId).toBe('host:rename-name:submit');expect(sent.formInstanceId).toBe(port.instanceId);expect(session.snapshot().formOperations![0].status).toBe('sending');
        expect(session.resolve(sent.id,'accepted')).toBe(true);expect(session.snapshot().formOperations![0].status).toBe('accepted');expect(session.resolveForm(sent.id,'processed')).toBe(false);
    });
    it('cancels when its port is disposed before queued transmission or during uncertainty notification',async()=>{
        for(const disposeAt of ['queued','uncertain']) {
            const {session,port,send,http}=fixture();if(disposeAt==='uncertain')session.subscribe(value=>{if(value.operations.some(op=>op.status==='uncertain'))port.dispose();});
            expect(port.commit(context(session),form().id)).toBe(true);if(disposeAt==='queued')port.dispose();await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();expect(session.snapshot().formOperations![0].status).toBe('cancelled');
        }
    });
    it('rejects accessor compiler output without executing its getter',async()=>{
        const getter=vi.fn(()=>({type:'rename',name:'New'}));
        const policy:CommandFormPolicy<NameCommand>={...NAME_POLICY,compile(){return Object.defineProperty({kind:'room',expected:scope()},'action',{enumerable:true,get:getter}) as NameCommand;}};
        const {session,port,send}=fixture(policy);expect(port.commit(context(session),form().id)).toBe(false);await Promise.resolve();expect(getter).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
    });
    it('requires validateCompiled to return literal true synchronously',async()=>{
        for(const result of [false,Promise.resolve(true),{},'true',1,null]) {
            const policy={...NAME_POLICY,validateCompiled:()=>result as never};const {session,port,send,http}=fixture(policy);expect(port.commit(context(session),form().id)).toBe(false);await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();expect(session.snapshot().operations).toEqual([]);
        }
    });
    it('renews scope authority without replacing source identity or draft and cancels old queued payload',async()=>{
        const {session,port,send}=fixture();const oldContext=context(session),instance=port.instanceId;expect(port.commit(oldContext,form().id)).toBe(true);
        session.receive(document(11));expect(port.commit(context(session),form().id)).toBe(false);expect(port.renew(context(session),form().id)).toBe(true);expect(port.instanceId).toBe(instance);expect(port.commit(oldContext,form().id)).toBe(false);
        await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().formOperations![0].status).toBe('cancelled');
        expect(port.commit(context(session),form().id)).toBe(true);await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].action.expected.version).toBe(11);expect(draft.values[NAME_TEXT_FIELD]).toBe('New 😀');
    });
    it('keeps an already dispatched command and its original receipt scope after renewal',async()=>{
        const {session,port,send}=fixture();expect(port.commit(context(session),form().id)).toBe(true);await Promise.resolve();const original=send.mock.calls[0][0];
        session.receive(document(11));expect(port.renew(context(session),form().id)).toBe(true);expect(port.commit(context(session),form().id)).toBe(false);await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);expect(original.action.expected.version).toBe(10);
        expect(session.resolve(original.id,'accepted')).toBe(true);expect(session.snapshot().formOperations![0]).toMatchObject({id:original.id,instanceId:port.instanceId,status:'accepted'});expect(port.commit(context(session),form().id)).toBe(false);
    });
    it('permits an explicitly rejected attempt to retry against renewed authority, while unavailable stays fenced',async()=>{
        for(const receipt of ['rejected','unavailable'] as const) {
            const {session,port,send}=fixture();expect(port.commit(context(session),form().id)).toBe(true);await Promise.resolve();const original=send.mock.calls[0][0];session.receive(document(11));expect(port.renew(context(session),form().id)).toBe(true);expect(session.resolve(original.id,receipt)).toBe(true);
            expect(port.commit(context(session),form().id)).toBe(receipt==='rejected');await Promise.resolve();
            if(receipt==='rejected'){expect(send).toHaveBeenCalledTimes(2);expect(send.mock.calls[1][0].action.expected.version).toBe(11);}
            else{expect(send).toHaveBeenCalledTimes(1);expect(session.snapshot().formOperations![0].status).toBe('uncertain');}
        }
    });
    it('retires sources permanently after base/schema/subject/removal changes, even if reverted',()=>{
        const first=form();const mutations:readonly FormOffer<Action>[][]=[
            [{...first,baseVersion:'different'}],[{...first,schemaVersion:'2'}],[{...first,editBinding:'other-subject'}],[{...first,binding:{...first.binding,actorId:'other'}}],[],
        ];
        for(const changed of mutations) {
            const {session,port}=fixture();session.receive(document(11,changed));session.receive(document(12,[first]));expect(port.renew(context(session),first.id)).toBe(false);expect(port.commit(context(session),first.id)).toBe(false);
        }
    });
    it('shares the combined offer execution fence with ordinary game commands',()=>{
        for(const first of ['form','game']) {
            const {session,port}=fixture(),doc=session.snapshot().document!,command=ping(session);if(command.kind!=='command')throw Error('missing ping');
            if(first==='form'){expect(port.commit(doc.context,form().id)).toBe(true);expect(session.admit(doc.context,doc.offer.id,'ping',command.action)).toBe(false);}
            else{expect(session.admit(doc.context,doc.offer.id,'ping',command.action)).toBe(true);expect(port.commit(doc.context,form().id)).toBe(false);}
            expect(session.snapshot().operations).toHaveLength(1);
        }
    });
    it('shares ordinary ledger capacity and reclaims a known rejection before admitting a new command',async()=>{
        const {session,port,send}=fixture(NAME_POLICY,1);expect(port.commit(context(session),form().id)).toBe(true);await Promise.resolve();const original=send.mock.calls[0][0];session.receive(document(11));expect(port.renew(context(session),form().id)).toBe(true);
        const doc=session.snapshot().document!,command=ping(session);if(command.kind!=='command')throw Error('missing ping');expect(session.admit(doc.context,doc.offer.id,'ping',command.action)).toBe(false);expect(session.snapshot().admissionBlocked).toBe('journal-full');
        expect(session.resolve(original.id,'rejected')).toBe(true);expect(session.admit(doc.context,doc.offer.id,'ping',command.action)).toBe(true);await Promise.resolve();expect(send).toHaveBeenCalledTimes(2);expect(send.mock.calls[1][0].action).toEqual({kind:'ping'});
    });
});
it('matches its own authoritative renamed name without treating a distinct foreign name as the same result',async()=>{const {session,port,send}=fixture();expect(port.commit(context(session),form().id)).toBe(true);await Promise.resolve();const accepted=renameForm({roomId:'room',actorId:'actor',seat:0,name:'New 😀',currentScope:scope(11),nameMax:24}),foreign=renameForm({roomId:'room',actorId:'actor',seat:0,name:'Foreign',currentScope:scope(12),nameMax:24});expect(port.matchesResult?.(accepted)).toBe(true);session.receive(document(11,[accepted]));expect(port.matchesResult?.(accepted)).toBe(true);expect(port.matchesResult?.(foreign)).toBe(false);expect(session.resolve(send.mock.calls[0][0].id,'accepted')).toBe(true);expect(port.matchesResult?.(accepted)).toBe(true);expect(port.commit(context(session),accepted.id)).toBe(false);});
