import { describe, expect, it } from 'vitest';
import { validateFormAccess, formEditIdentity, ownCompiledAction, ownFormEdit, ownFormReduction, normalizeFormActions, formAction, validateFormRawShape, ownFormDraft, ownNormalizedForm, ownCompiledForm, copyFormData, validateFormOffer, validateFormValues, type FormOffer, type TextFormField } from './forms';
const offer = (): Omit<FormOffer,'fields'> & {readonly fields:readonly TextFormField[]} => ({ id:'form', instanceId:'instance', schemaVersion:'1', policyId:'test', baseVersion:'1', editBinding:'actor:1', title:'Edit', submitLabel:'Save', enabled:true, binding:{ actor:'1', seat:0 }, fields:[{ id:'name', label:'Name', kind:'text', maxCodePoints:4, maxCodeUnits:8, required:true, initial:'' }] });
describe('bounded form schema and raw drafts', () => {
    it('owns and freezes offer data without changing caller values', () => {
        const source=offer(); const owned=validateFormOffer(source);
        expect(owned).toEqual(source); expect(owned).not.toBe(source);
        expect(Object.isFrozen(owned.fields[0])).toBe(true); expect(Object.isFrozen(owned.binding)).toBe(true);
        (source.binding as Record<string,string|number|null>).actor='changed'; expect(owned.binding.actor).toBe('1');
    });
    it('rejects duplicate/unknown fields, invalid bounds and capabilities before invoking them', () => {
        const getter=()=>{throw Error('getter invoked');};
        for (const source of [ {...offer(), surprise:true}, {...offer(),fields:[offer().fields[0],offer().fields[0]]}, {...offer(),fields:[]}, {...offer(),fields:[{...offer().fields[0],maxCodePoints:0}]}, {...offer(),fields:[{...offer().fields[0],min:0}]}, {...offer(),binding:[]}, {...offer(),binding:new Date()}, {...offer(),enabled:()=>true} ]) expect(()=>validateFormOffer(source as FormOffer)).toThrow();
        const source=offer();Object.defineProperty(source,'title',{get:getter});expect(()=>validateFormOffer(source)).toThrow('Invalid bounded form data');
    });
    it('validates exact host/typed-command target descriptors',()=>{
        expect(validateFormOffer({...offer(),target:{kind:'host' as const}}).target).toEqual({kind:'host'});
        const target={kind:'command' as const,actionId:'name:submit',template:{kind:'room',action:{type:'rename',name:''}}};
        expect(validateFormOffer({...offer(),target}).target).toEqual(target);
        for(const invalid of [{kind:'host',extra:true},{kind:'command',actionId:'',template:{}},{kind:'command',actionId:'submit'},{kind:'command',actionId:'submit',template:{},extra:true},{kind:'unknown'}])expect(()=>validateFormOffer({...offer(),target:invalid} as never)).toThrow();
    });
    it('rejects reserved dictionary field IDs at offer ingress and accepts initial dictionaries for every admitted ID',()=>{
        for(const id of ['constructor','prototype','__proto__'])expect(()=>validateFormOffer({...offer(),fields:[{...offer().fields[0],id}]})).toThrow();
        for(const id of ['name','hasOwnProperty','toString','a:b','길이']){
            const accepted=validateFormOffer({...offer(),fields:[{...offer().fields[0],id}]});
            const initial=Object.fromEntries(accepted.fields.map(field=>[field.id,field.initial]));
            expect(()=>validateFormValues(accepted,initial)).not.toThrow();
        }
    });
    it('rejects exotics, sparse arrays, symbols and cycles', () => {
        const cyclic: Record<string,unknown>={};cyclic.self=cyclic;
        for(const source of [cyclic, new Map(), { [Symbol('x')]:1 }, Array(2), {constructor:'bad'}]) expect(()=>copyFormData(source)).toThrow();
    });
    it('rejects aggregate models beyond 64 KiB before creating an owned copy',()=>{
        const fields=Array.from({length:8},(_,index)=>({...offer().fields[0],id:`field:${index}`,maxCodePoints:16384,maxCodeUnits:16384,initial:'가'.repeat(10000)}));
        expect(()=>validateFormOffer({...offer(),fields})).toThrow('Invalid bounded form data');
        expect(()=>copyFormData({a:'a'.repeat(32768),b:'b'.repeat(32768)})).toThrow();
        const control={text:'\n'.repeat(32760)};expect(new TextEncoder().encode(JSON.stringify(control)).length).toBeLessThanOrEqual(65536);expect(copyFormData(control)).toEqual(control);
    });
    it('counts code points and code units independently while retaining raw composing input', () => {
        const source={name:'😀😀😀😀'};expect(validateFormValues(offer(),source)).toEqual({});expect(source.name).toBe('😀😀😀😀');
        expect(validateFormValues(offer(),{name:'😀😀😀😀😀'})).toHaveProperty('name');
        const composing={name:'  가나 다  '};expect(validateFormValues(offer(),composing)).toHaveProperty('name');expect(composing.name).toBe('  가나 다  ');
        expect(validateFormValues(offer(),{name:'   '})).toHaveProperty('name');
        expect(()=>validateFormValues(offer(),{name:'ok',other:'bad'})).toThrow();
        expect(()=>validateFormValues(offer(),{name:3} as never)).toThrow();
    });
    it('rejects numeric intermediate strings without coercion, truncation or off-step admission', () => {
        const numeric:Omit<FormOffer,'fields'> & {readonly fields:readonly TextFormField[]}={...offer(),fields:[{...offer().fields[0],id:'number',kind:'number',maxCodePoints:16,maxCodeUnits:16,min:-1,max:2,step:0.1}]};
        for(const value of ['-','1.','1e2','NaN','Infinity','0.15','2.1',' 1 ','']) expect(validateFormValues(numeric,{number:value})).toHaveProperty('number');
        for(const value of ['-1','0','0.3','2','.5']) expect(validateFormValues(numeric,{number:value})).toEqual({});
        expect(()=>validateFormOffer({...numeric,fields:[{...numeric.fields[0],step:0}]})).toThrow();
        const unbounded:Omit<FormOffer,'fields'> & {readonly fields:readonly TextFormField[]}={...offer(),fields:[{id:'amount',label:'Amount',kind:'number',required:true,initial:'',maxCodePoints:16,maxCodeUnits:16}]};
        expect(validateFormValues(unbounded,{amount:'100.125'})).toEqual({});
        expect(validateFormValues({...unbounded,fields:[{...unbounded.fields[0],step:Number.MIN_VALUE}]},{amount:'1'})).toHaveProperty('amount');
    });
});


describe('central exact form boundary validators',()=>{
    it('owns exact raw snapshots while preserving numeric intermediates and composition',()=>{
        const raw={values:{name:'-'},revision:0,compositionEpoch:2,composing:true};const owned=ownFormDraft(raw);expect(owned).toEqual(raw);expect(owned).not.toBe(raw);expect(Object.isFrozen(owned.values)).toBe(true);
        for(const source of [{...raw,extra:true},{...raw,composing:''},{...raw,revision:-1},{...raw,compositionEpoch:0.5},{...raw,values:[]},{...raw,values:{name:3}}])expect(()=>ownFormDraft(source)).toThrow();
        const accessor={...raw};Object.defineProperty(accessor,'composing',{get(){throw Error('getter invoked');}});expect(()=>ownFormDraft(accessor)).toThrow('Invalid bounded form data');
    });
    it('rejects array, string, numeric and boolean normalized issues instead of treating them as empty',()=>{
        for(const issues of [[], '',0,false,null,undefined])expect(()=>ownNormalizedForm(offer(),{values:{name:'ok'},issues})).toThrow();
        for(const source of [{values:{name:'ok'},issues:{},extra:true},{values:{other:'bad'},issues:{}},{values:{name:3},issues:{}},{values:{name:'ok'},issues:{other:'bad'}},{values:{name:'ok'},issues:{name:''}}])expect(()=>ownNormalizedForm(offer(),source)).toThrow();
        const source={values:{name:'ok'},issues:{$form:'Try again'}};expect(ownNormalizedForm(offer(),source)).toEqual(source);expect(Object.isFrozen(ownNormalizedForm(offer(),source).issues)).toBe(true);
    });
    it('owns compiled records and rejects every primitive/nonfinite/capability container',()=>{
        const source={text:'Hi',amount:3,unset:null};const owned=ownCompiledForm(source);expect(owned).toEqual(source);expect(Object.isFrozen(owned)).toBe(true);
        for(const input of ['text',3,true,[],null,{amount:NaN},{amount:Infinity},{nested:{}},{fn(){}}])expect(()=>ownCompiledForm(input)).toThrow();
    });
});


const composite = ():FormOffer=>({...offer(),fields:[
 {id:'flag',label:'Flag',kind:'toggle',required:true,initial:false,sectionId:'main',clusterId:'controls',rowId:'pair'},
 {id:'mode',label:'Mode',kind:'select',required:true,initial:'a',sectionId:'main',clusterId:'controls',rowId:'pair',options:[{id:'a',label:'A',enabled:true},{id:'b',label:'B',enabled:false,help:'Unavailable'}]},
 {id:'amount',label:'Amount',kind:'number',required:true,initial:'1',min:0,max:255,step:1,maxCodePoints:4,maxCodeUnits:4,sectionId:'main',clusterId:'controls'},
],sections:[{id:'main',title:'Main'}],clusters:[{id:'controls',sectionId:'main',label:'Controls',fieldIds:['flag','mode','amount']}],rows:[{id:'pair',clusterId:'controls',label:'Pair',fieldIds:['flag','mode'],leading:{kind:'card',label:'Ace',visual:{kind:'standard',rank:14,suit:'Spade'}}}],model:{semantic:{value:1}},actions:[
 {id:'apply',label:'Apply',target:{kind:'command',actionId:'typed-apply',template:{type:'apply'}},basis:'current'},
 {id:'save',label:'Save',target:{kind:'host',operationId:'local:save'},completion:'continue',basis:'draft'},
]});
describe('generic bounded composite forms',()=>{
 it('owns booleans and finite fields with sections, clusters, repeated row artwork and model',()=>{
  const value=validateFormOffer(composite());expect(Object.isFrozen(value.model)).toBe(true);expect(value.rows?.[0].leading?.kind).toBe('card');
  expect(validateFormValues(value,{flag:false,mode:'a',amount:'1'})).toEqual({});expect(validateFormValues(value,{flag:true,mode:'b',amount:'1'})).toHaveProperty('mode');
  expect(()=>validateFormRawShape(value,{flag:'false',mode:'a',amount:'1'})).toThrow();expect(validateFormRawShape(value,{flag:false,mode:'unknown',amount:'-'})).toEqual({flag:false,mode:'unknown',amount:'-'});
  expect(validateFormValues(value,{flag:false,mode:'a',amount:'-'})).toHaveProperty('amount');
 });
 it('rejects dangling, duplicated or inconsistent semantic references',()=>{
  const source=composite();for(const changed of [
   {...source,fields:source.fields.map(field=>({...field,sectionId:'missing'}))},
   {...source,clusters:[{...source.clusters![0],fieldIds:['flag','missing']}]},
   {...source,rows:[{...source.rows![0],fieldIds:['amount']}]},
   {...source,rows:[{...source.rows![0],leading:{kind:'card',label:'bad',visual:{kind:'standard',rank:1,suit:'Spade'}}}]},
   {...source,actions:[source.actions![0],source.actions![0]]},
  ])expect(()=>validateFormOffer(changed as FormOffer)).toThrow();
 });
 it('normalizes legacy and multiple action defaults without losing typed targets',()=>{
  expect(normalizeFormActions(offer())).toEqual([{id:'submit',label:'Save',intent:'primary',target:{kind:'host'},completion:'lock',basis:'current'}]);
  const actions=normalizeFormActions(composite());expect(actions[0]).toMatchObject({id:'apply',intent:'primary',completion:'lock',basis:'current'});expect(actions[1]).toMatchObject({id:'save',completion:'continue',target:{kind:'host',operationId:'local:save'}});expect(formAction(composite(),'missing')).toBe(null);expect(formAction(composite())?.id).toBe('apply');
 });
 it('owns complete reduction output and rejects unknown or incorrectly typed registries and summaries',()=>{
  const source=composite(),output={values:{flag:true,mode:'a',amount:'-'},visibility:{flag:true,mode:true,amount:true},enabled:{flag:true,mode:true,amount:true},issues:{amount:'Enter a number'},changedFields:['flag'],summary:[{text:'One change',fieldIds:['flag']}]};
  expect(ownFormReduction(source,output)).toEqual(output);expect(Object.isFrozen(ownFormReduction(source,output).values)).toBe(true);
  for(const changed of [{...output,values:{flag:true}}, {...output,values:{flag:'yes'}},{...output,visibility:{missing:true}},{...output,enabled:{flag:1}},{...output,changedFields:['missing']},{...output,summary:[{text:'Bad',fieldIds:['missing']}]},{...output,issues:[]},{...output,extra:true}])expect(()=>ownFormReduction(source,changed)).toThrow();
 });
 it('supports 192 fields but rejects excessive fields, options and containers without raising 64KiB',()=>{
  const fields=Array.from({length:192},(_,index)=>({id:`f${index}`,label:`F${index}`,kind:'toggle' as const,required:true,initial:false}));expect(validateFormOffer({...offer(),fields}).fields).toHaveLength(192);expect(()=>validateFormOffer({...offer(),fields:[...fields,{...fields[0],id:'extra'}]})).toThrow();
  const options=(count:number)=>Array.from({length:count},(_,index)=>({id:`o${index}`,label:String(index),enabled:true}));const select=(id:string,count:number)=>({id,label:id,kind:'select' as const,required:true,initial:'o0',options:options(count)});
  expect(()=>validateFormOffer({...offer(),fields:[select('a',129),select('b',128)]})).toThrow();expect(validateFormOffer({...offer(),fields:[select('a',128),select('b',128)]}).fields).toHaveLength(2);
  expect(()=>validateFormOffer({...offer(),model:Array(257).fill(0)})).toThrow();expect(()=>validateFormOffer({...offer(),model:{huge:'가'.repeat(22000)}})).toThrow();
 });
});


describe('composite policy admission helpers',()=>{
 it('compares exact deterministic draft bases while excluding renewable authority payloads',()=>{
  const first=composite(),next={...first,actions:first.actions!.map(action=>action.target.kind==='command'?{...action,target:{...action.target,template:{type:'apply',version:2}}}:action)};
  expect(formEditIdentity(next)).toBe(formEditIdentity(first));expect(formEditIdentity({...first,model:{semantic:{value:2}}})).not.toBe(formEditIdentity(first));
  expect(formEditIdentity({...first,binding:{seat:0,actor:'1'}})).toBe(formEditIdentity({...first,binding:{actor:'1',seat:0}}));
  expect(formEditIdentity({...first,model:null})).not.toBe(formEditIdentity((({model,...rest})=>rest)(first)));
 });
 it('owns exact compiled action wrappers and rejects ambiguous or capable results',()=>{
  expect(ownCompiledAction({kind:'command',action:{type:'apply'}})).toEqual({kind:'command',action:{type:'apply'}});expect(ownCompiledAction({kind:'host',payload:{stored:{name:'Custom'}}})).toEqual({kind:'host',payload:{stored:{name:'Custom'}}});
  for(const source of [{kind:'command'},{kind:'host'}, {kind:'command',action:{},payload:{}},{kind:'other',payload:{}},Promise.resolve({kind:'host',payload:{}})])expect(()=>ownCompiledAction(source)).toThrow();
 });
 it('owns typed explicit edit/reset operations without treating IDs as paths',()=>{
  const source=composite();expect(ownFormEdit(source,{fieldId:'flag',value:true})).toEqual({fieldId:'flag',value:true});expect(ownFormEdit(source,{fieldId:'amount',value:'-'})).toEqual({fieldId:'amount',value:'-'});expect(ownFormEdit(source,{kind:'reset-all'})).toEqual({kind:'reset-all'});
  for(const edit of [{fieldId:'missing',value:true},{fieldId:'flag',value:'true'},{kind:'reset-all',fieldId:'flag'},{kind:'reset-field',fieldId:'flag',value:true},{kind:'other',fieldId:'flag',value:true}])expect(()=>ownFormEdit(source,edit)).toThrow();
 });
});


describe('bounded host confirmation authority',()=>{
 const confirmation=():FormOffer=>({...offer(),purpose:'confirmation',fields:[],target:{kind:'host',operationId:'delete',authority:{version:1}},access:{kind:'disclosure-selection',selectionId:'selection:1'},retry:'new-offer'});
 const command={kind:'command' as const,actionId:'delete',template:{type:'delete'}};
 it('admits empty fields only for explicit confirmations and retains legacy host defaults',()=>{
  expect(validateFormOffer(confirmation()).fields).toEqual([]);
  const {target:ignored,...implicitHost}=confirmation();expect(normalizeFormActions(implicitHost)[0].target).toEqual({kind:'host'});
  const {purpose:ignoredPurpose,...implicitEditing}=confirmation();expect(()=>validateFormOffer(implicitEditing)).toThrow();
  for(const purpose of ['editing','other'])expect(()=>validateFormOffer({...confirmation(),purpose} as never)).toThrow();
  expect(validateFormOffer({...offer(),purpose:'editing',retry:'same-offer'}).fields).toHaveLength(1);
 });
 it('rejects command authority anywhere in confirmations, including shadowed targets',()=>{
  for(const source of [
   {...confirmation(),target:command},
   {...confirmation(),actions:[{id:'delete',label:'Delete',target:command}]},
   {...confirmation(),target:command,actions:[{id:'delete',label:'Delete',target:{kind:'host'}}]},
   {...confirmation(),actions:[{id:'host',label:'Host',target:{kind:'host'}},{id:'command',label:'Command',target:command}]},
  ])expect(()=>validateFormOffer(source as FormOffer)).toThrow();
  expect(normalizeFormActions({...confirmation(),actions:[{id:'delete',label:'Delete',target:{kind:'host',operationId:'delete'}}]})).toHaveLength(1);
  // Existing editing forms retain command and mixed action support.
  expect(validateFormOffer({...offer(),target:command}).target?.kind).toBe('command');
  expect(validateFormOffer(composite()).actions).toHaveLength(2);
 });
 it('restricts fresh-offer retries to explicit host confirmations',()=>{
  expect(validateFormOffer(confirmation()).retry).toBe('new-offer');
  for(const source of [
   {...offer(),retry:'new-offer'},
   {...offer(),purpose:'editing',retry:'new-offer'},
   {...confirmation(),retry:'automatic'},
   {...confirmation(),target:command},
  ])expect(()=>validateFormOffer(source as FormOffer)).toThrow();
 });
 it('owns exact bounded selection access without invoking capability properties',()=>{
  const access={kind:'disclosure-selection' as const,selectionId:'selection:1'},owned=validateFormAccess(access);
  expect(owned).toEqual(access);expect(owned).not.toBe(access);expect(Object.isFrozen(owned)).toBe(true);
  access.selectionId='changed';expect(owned.selectionId).toBe('selection:1');
  for(const invalid of [null,[],{},'selection:1',{kind:'disclosure-selection'}, {kind:'other',selectionId:'a'}, {kind:'disclosure-selection',selectionId:''}, {kind:'disclosure-selection',selectionId:'x'.repeat(129)}, {kind:'disclosure-selection',selectionId:'constructor'}, {kind:'disclosure-selection',selectionId:'a',authority:1}, {[Symbol('extra')]:true,kind:'disclosure-selection',selectionId:'a'}]){
   expect(()=>validateFormAccess(invalid)).toThrow();expect(()=>validateFormOffer({...confirmation(),access:invalid} as never)).toThrow();
  }
  let reads=0;const getter={kind:'disclosure-selection',get selectionId(){reads++;return 'a';}};
  expect(()=>validateFormAccess(getter)).toThrow();expect(()=>validateFormOffer({...confirmation(),access:getter} as never)).toThrow();expect(reads).toBe(0);
 });
 it('binds purpose, selection and retry into edit identity while allowing host authority renewal',()=>{
  const first=confirmation(),identity=formEditIdentity(first);
  expect(formEditIdentity({...first,target:{kind:'host',operationId:'delete',authority:{version:2}}})).toBe(identity);
  expect(formEditIdentity({...first,access:{kind:'disclosure-selection',selectionId:'selection:2'}})).not.toBe(identity);
  expect(formEditIdentity({...first,retry:'same-offer'})).not.toBe(identity);
  const withFields={...first,fields:offer().fields,retry:'same-offer' as const};
  expect(formEditIdentity({...withFields,purpose:'editing'})).not.toBe(formEditIdentity(withFields));
  const {access:ignoredAccess,...withoutAccess}=first;expect(formEditIdentity(withoutAccess)).not.toBe(identity);
  expect(formEditIdentity({...offer(),purpose:'editing',retry:'same-offer'})).toBe(formEditIdentity(offer()));
 });
});
