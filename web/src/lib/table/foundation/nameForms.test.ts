import { describe, expect, it } from 'vitest';
import type { CommandScope } from '../../generated/protocol';
import type { FormOffer } from './forms';
import { namedJoinForm, renameForm, NAME_POLICY, NAME_TEXT_FIELD, type NameCommand } from './nameForms';
const scope=(seat:number|null=null):CommandScope=>({domain:'room',room_id:'room',room_epoch:'epoch',actor_id:'actor',seat,session_id:1,hand:0,version:10});
const options=()=>({roomId:'room',actorId:'actor',seat:2,name:'Current',currentScope:scope(),nameMax:24,device:'device',targetId:'bot:2'});
const normalized=(offer:FormOffer<NameCommand>,name=' New 😀 ')=>(NAME_POLICY.normalize(offer,{[NAME_TEXT_FIELD]:name}));
describe('pure typed name forms',()=>{
    it('compiles only the name into the exact captured join template',()=>{
        const offer=namedJoinForm(options()),result=normalized(offer),command=NAME_POLICY.compile(offer,result.values);
        expect(result.values).toEqual({[NAME_TEXT_FIELD]:'New 😀'});expect(result.issues).toEqual({});
        expect(command).toEqual({kind:'room',action:{type:'join',name:'New 😀',seat:2,device:'device'},expected:scope()});
        expect(NAME_POLICY.validateCompiled(offer,command)).toBe(true);expect(Object.isFrozen(command.expected)).toBe(true);expect(Object.isFrozen(command.action)).toBe(true);
        expect(offer.fields[0].initial).toBe('Current');expect(offer.target?.kind).toBe('command');
    });
    it('compiles rename with authoritative viewer name and no unrelated join fields',()=>{
        const offer=renameForm({...options(),seat:1,currentScope:scope(1),name:'Authoritative'}),result=normalized(offer,'  바뀐 이름  ');
        expect(NAME_POLICY.compile(offer,result.values)).toEqual({kind:'room',action:{type:'rename',name:'바뀐 이름'},expected:scope(1)});
        expect(offer.fields[0].initial).toBe('Authoritative');
    });
    it('keeps identity/edit binding stable across scope revisions and base version tied to actual name',()=>{
        const source=options(),first=namedJoinForm(source),next=namedJoinForm({...source,currentScope:{...scope(),version:11}});
        expect(next.instanceId).toBe(first.instanceId);expect(next.editBinding).toBe(first.editBinding);expect(next.baseVersion).toBe(first.baseVersion);
        expect(namedJoinForm({...source,name:'Changed'}).baseVersion).not.toBe(first.baseVersion);
        expect(namedJoinForm({...source,targetId:'other'}).editBinding).not.toBe(first.editBinding);
        source.currentScope.version=99;expect(first.target?.kind==='command'&&first.target.template.expected.version).toBe(10);
    });
    it('validates trimmed Unicode code-point limits without silently cutting input',()=>{
        const offer=namedJoinForm({...options(),name:'',nameMax:2});
        expect(normalized(offer,' 😀😀 ').issues).toEqual({});expect(normalized(offer,'😀😀😀').issues).toHaveProperty(NAME_TEXT_FIELD);
        expect(normalized(offer,'   ').issues).toHaveProperty(NAME_TEXT_FIELD);
        expect(()=>NAME_POLICY.compile(offer,{[NAME_TEXT_FIELD]:' untrimmed '})).toThrow();
        expect(()=>NAME_POLICY.compile(offer,{[NAME_TEXT_FIELD]:''})).toThrow();
    });
    it('rejects mutated kind/scope/seat/device/type or unknown action keys',()=>{
        const offer=namedJoinForm(options()),command=NAME_POLICY.compile(offer,normalized(offer).values);
        const altered=[{...command,kind:'adapter'},{...command,expected:{...command.expected,version:9}},{...command,expected:{...command.expected,actor_id:'other'}},{...command,action:{...command.action,seat:3}},{...command,action:{...command.action,device:'other'}},{...command,action:{...command.action,type:'rename'}},{...command,action:{...command.action,extra:true}},{...command,expected:{...command.expected,extra:true}}];
        for(const action of altered)expect(NAME_POLICY.validateCompiled(offer,action as NameCommand)).toBe(false);
    });
    it('rejects tampered templates or mismatched construction scope before compiling',()=>{
        const offer=namedJoinForm(options());if(offer.target?.kind!=='command')throw Error('missing command');
        for(const target of [{...offer.target,template:{...offer.target.template,action:{...offer.target.template.action,name:'injected'}}},{...offer.target,template:{...offer.target.template,action:{...offer.target.template.action,seat:9}}},{...offer.target,template:{...offer.target.template,expected:{...scope(),actor_id:'other'}}}]) expect(()=>NAME_POLICY.compile({...offer,target} as FormOffer<NameCommand>,{[NAME_TEXT_FIELD]:'Valid'})).toThrow();
        expect(()=>namedJoinForm({...options(),currentScope:{...scope(),domain:'game'}})).toThrow();
        expect(()=>namedJoinForm({...options(),currentScope:{...scope(),actor_id:'other'}})).toThrow();
        expect(()=>renameForm({...options(),currentScope:scope(1),seat:2})).toThrow();
    });
});
