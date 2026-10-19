import {expect,test} from 'vitest';
import {implicitFormSubmit} from './formActivation';
import type {PlannedNode} from './contracts';
const node=(id:string,intent:'primary'|'secondary',enabled=true):PlannedNode=>({id,parent:'dialog',kind:'command',label:id,intent,enabled,formIntent:'submit',formActionId:id,formLeaseId:'lease',box:{x:0,y:0,width:100,height:44}});
test('implicit Enter resolves declared primary independent of opaque action IDs',()=>{const primary=node('opaque-primary','primary'),secondary=node('opaque-save','secondary');expect(implicitFormSubmit([secondary,primary],'lease')).toBe(primary);expect(implicitFormSubmit([{...primary,formActionId:undefined}],'lease')?.id).toBe(primary.id);});
test('disabled, absent, ambiguous or foreign primary cannot fall through to an enabled Save',()=>{const secondary=node('save','secondary');for(const nodes of [[secondary,node('apply','primary',false)],[secondary],[node('one','primary'),node('two','primary')],[{...node('foreign','primary'),formLeaseId:'other'},secondary]])expect(implicitFormSubmit(nodes,'lease')).toBeNull();});
