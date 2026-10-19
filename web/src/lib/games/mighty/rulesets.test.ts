import { afterEach, expect, test, vi } from 'vitest';
import { MIGHTY, presetRules } from './catalog';
import { fillGaps, upgradeRules, saveCustom, saveCustomWithOutcome, readCustomStorageRaw, type CustomSet } from './rulesets';
import type { Rules } from './types';

test('rules saved before an option existed read it as the server does', () => {
  const saved = presetRules('gshs') as Partial<Rules> & Record<string, unknown>;
  delete saved.lowest_rank;
  delete saved.scoring;
  delete (saved.bidding as Partial<Rules['bidding']>).raise_on_exchange;
  const filled = fillGaps(saved as Rules, MIGHTY.rule_defaults);
  expect(filled.lowest_rank).toBe(MIGHTY.rule_defaults.lowest_rank);
  expect(filled.scoring).toEqual(MIGHTY.rule_defaults.scoring);
  expect(filled.bidding.raise_on_exchange).toBe(MIGHTY.rule_defaults.bidding.raise_on_exchange);
  // What the set says stays as it says.
  expect(filled.bidding.min).toBe(presetRules('gshs').bidding.min);
  expect(filled.joker_call.calls).toEqual(presetRules('gshs').joker_call.calls);
  expect(filled.deck).toBe('TwoJokers');
});

test('rules saved with the old misdeal flags read them as the window they meant', () => {
  const cases: [boolean, boolean, Rules['misdeal']['window']][] = [
    [false, false, 'OwnTurnUntilBid'],
    [false, true, 'AllBidding'],
    [true, false, 'BeforeFirstBid'],
    [true, true, 'BeforeFirstBid'],
  ];
  for (const [ask_first, after_bidding, window] of cases) {
    const saved = presetRules('gshs');
    const misdeal = saved.misdeal as Partial<Rules['misdeal']> & Record<string, unknown>;
    delete misdeal.window;
    Object.assign(misdeal, { ask_first, after_bidding });
    const read = fillGaps(upgradeRules(saved), MIGHTY.rule_defaults);
    expect(read.misdeal.window).toBe(window);
    expect('ask_first' in read.misdeal).toBe(false);
  }
  // Rules saved now pass as they are.
  expect(upgradeRules(presetRules('default'))).toEqual(presetRules('default'));
});


function customStore(initial:string|null=null){
 let raw=initial,serial=0;
 const getItem=vi.fn(()=>raw),setItem=vi.fn((_key:string,value:string)=>{raw=value;});
 vi.stubGlobal('localStorage',{getItem,setItem});vi.stubGlobal('crypto',{randomUUID:()=>`new-${++serial}`});
 return {getItem,setItem,get raw(){return raw;},replace(value:string|null){raw=value;}};
}
const custom=(id:string,name=id):CustomSet=>({id,name,base:'default',rules:presetRules('default')});
afterEach(()=>vi.unstubAllGlobals());
test('engine save reports storage only after the admitted catalog write succeeds',()=>{
 const storage=customStore(),input=custom('chosen','모임 규칙');
 expect(readCustomStorageRaw()).toBeNull();const result=saveCustomWithOutcome(input,{expectedRaw:null});expect(result).toEqual({status:'stored',set:input,raw:JSON.stringify([input])});expect(JSON.parse(storage.raw!)).toEqual([input]);expect(storage.setItem).toHaveBeenCalledOnce();
});
test('replacement identity, last-used ordering, unnamed deduplication and five-set cap are preserved',()=>{
 const list=Array.from({length:5},(_,index)=>custom(`id-${index}`)),storage=customStore(JSON.stringify(list));
 const replacement={...custom('ignored','id-2'),rules:{...presetRules('default'),hand_size:9}};
 const result=saveCustomWithOutcome(replacement);expect(result.status).toBe('stored');expect(JSON.parse(storage.raw!).map((set:CustomSet)=>set.id)).toEqual(['id-2','id-0','id-1','id-3','id-4']);
 const added=saveCustomWithOutcome({...custom('newest'),name:''});expect(added.status).toBe('stored');expect(JSON.parse(storage.raw!).map((set:CustomSet)=>set.id)).toEqual(['newest','id-2','id-0','id-1','id-3']);
 const again=saveCustomWithOutcome({...custom('not-used'),name:''});expect(again.status).toBe('stored');if(again.status==='stored')expect(again.set.id).toBe('newest');expect(JSON.parse(storage.raw!)).toHaveLength(5);
});
test('quota and read denial return failed without claiming a stored set',()=>{
 const original=JSON.stringify([custom('prior')]),storage=customStore(original);storage.setItem.mockImplementation(()=>{throw new DOMException('quota','QuotaExceededError');});expect(saveCustomWithOutcome(custom('new'))).toEqual({status:'failed'});expect(storage.raw).toBe(original);
 storage.getItem.mockImplementation(()=>{throw new Error('denied');});expect(saveCustomWithOutcome(custom('new'))).toEqual({status:'failed'});expect(storage.setItem).toHaveBeenCalledTimes(1);
});
test('stale and synchronously replaced catalogs refuse to overwrite another edit',()=>{
 const original=JSON.stringify([custom('prior')]),other=JSON.stringify([custom('other')]),storage=customStore(other);expect(saveCustomWithOutcome(custom('new'),{expectedRaw:original})).toEqual({status:'conflict'});expect(storage.raw).toBe(other);expect(storage.setItem).not.toHaveBeenCalled();
 storage.replace(original);let reads=0;storage.getItem.mockImplementation(()=>{if(++reads===2)storage.replace(other);return storage.raw;});expect(saveCustomWithOutcome(custom('new'))).toEqual({status:'conflict'});expect(storage.raw).toBe(other);expect(storage.setItem).not.toHaveBeenCalled();
});
test('unsupported saved data is refused intact rather than silently cleaned or truncated',()=>{
 for(const raw of ['broken','{}',JSON.stringify([{id:'bad',base:'default',rules:{}}]),JSON.stringify([custom('same'),custom('same')]),JSON.stringify(Array.from({length:6},(_,index)=>custom(String(index)))),'x'.repeat(65537)]){
  const storage=customStore(raw);expect(saveCustomWithOutcome(custom('new'))).toEqual({status:'unsupported'});expect(storage.raw).toBe(raw);expect(storage.setItem).not.toHaveBeenCalled();
 }
});
test('valid catalog envelopes with malformed nested rules are refused without any write',()=>{
 const invalids:unknown[]=[
  {...presetRules('default'),deck:'Bogus'},
  {...presetRules('default'),bidding:{...presetRules('default').bidding,min:'14'}},
  {...presetRules('default'),extra_cards:[{Normal:['Spade',99]}]},
  {...presetRules('default'),scoring:{...presetRules('default').scoring,win:{BothOver:'2'}}},
  {...presetRules('default'),friend:{...presetRules('default').friend,unexpected:true}},
 ];
 for(const rules of invalids){
  const raw=JSON.stringify([{...custom('old'),rules}]),storage=customStore(raw);
  expect(saveCustomWithOutcome(custom('new'))).toEqual({status:'unsupported'});
  expect(storage.raw).toBe(raw);expect(storage.setItem).not.toHaveBeenCalled();
 }
});
test('compatibility defaults preserve complete tagged choices without merging variants',()=>{
 const saved=presetRules('default');saved.scoring.back_run={ShortBy:255};
 expect(fillGaps(saved,MIGHTY.rule_defaults).scoring.back_run).toEqual({ShortBy:255});
 const raw=JSON.stringify([{...custom('old'),rules:saved}]),storage=customStore(raw);
 expect(saveCustomWithOutcome(custom('new')).status).toBe('stored');
 expect(JSON.parse(storage.raw!)[1].rules.scoring.back_run).toEqual({ShortBy:255});
 // Invalid extra members are preserved for strict rejection, never repaired.
 const invalid={ShortBy:1,unknown:2};expect(fillGaps(invalid,{TeamAtMost:10} as unknown as typeof invalid)).toEqual(invalid);
});
test('malformed legacy flags cannot be erased by migration before validation',()=>{
 for(const [key,value] of [['ask_first','yes'],['after_bidding',1],['ask_first',null]] as const){
  const old=custom('old'),misdeal=old.rules.misdeal as unknown as Record<string,unknown>;
  delete misdeal.window;misdeal[key]=value;
  const raw=JSON.stringify([old]),storage=customStore(raw);
  expect(saveCustomWithOutcome(custom('new'))).toEqual({status:'unsupported'});
  expect(storage.raw).toBe(raw);expect(storage.setItem).not.toHaveBeenCalled();
 }
});
test('documented omitted old fields remain compatible with truthful saving',()=>{
 const old=custom('prior');delete (old.rules as Partial<Rules>).lowest_rank;
 const storage=customStore(JSON.stringify([old]));
 expect(saveCustomWithOutcome(custom('new')).status).toBe('stored');
 expect(JSON.parse(storage.raw!)[1].rules.lowest_rank).toBe(MIGHTY.rule_defaults.lowest_rank);
});
test('the legacy return-only save API remains compatible while the engine uses truthful outcomes',()=>{
 const storage=customStore();storage.setItem.mockImplementation(()=>{throw new Error('denied');});expect(saveCustom(custom('legacy'))).toEqual(custom('legacy'));expect(storage.raw).toBeNull();
});
