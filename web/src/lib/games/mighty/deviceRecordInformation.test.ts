import {expect,test} from 'vitest';
import {validateInformation} from '../../table/foundation/information';
import type {TableDocument} from '../../table/foundation/contracts';
import {mightyDeviceRecordInformation} from './deviceRecordInformation';
import {storeCompletion,readDeviceRecords,completionKey,type CompletionStorage} from './completionStore';
import {ACHIEVEMENTS} from './achievementCatalog';
import type {HandRecord} from './stats';
const storage=():CompletionStorage=>{const values=new Map<string,string>();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}};};
const record=(n:number):HandRecord=>({key:completionKey({roomId:'private-id',roomEpoch:'epoch',sessionId:2,handNumber:n,actorId:'private-actor'}),at:n,role:n%2?'declarer':'defense',won:n%2===1,payoff:n%2?3:-3,contract:{trump:n===3?null:'Heart',count:17},teamPoints:18});
test('device summaries preserve role totals, best no-trump tie and bounded recent order without leaking identity',()=>{
 const s=storage();for(let n=1;n<=15;n++)storeCompletion({hand:record(n),alone:false,tookWithMighty:false},s);
 const panels=mightyDeviceRecordInformation(readDeviceRecords(s)).flatMap(section=>section.information),summary=panels[0];expect(summary).toMatchObject({primary:{value:{kind:'number',value:15}},summary:{text:'승률 53%'}});expect(summary.fields.find(f=>f.id==='total')!.value).toEqual({kind:'text',text:'+3'});expect(summary.fields.find(f=>f.id==='best')!.value).toMatchObject({kind:'inline',values:[{kind:'text',text:'노기루다'},{kind:'number',value:17}]});
 expect(panels.find(p=>p.id==='device-roles')!.fields.find(field=>field.id==='declarer:hands')!.value).toEqual({kind:'number',value:8});expect(panels.find(p=>p.id==='device-recent')!.fields).toHaveLength(12);expect(panels.find(p=>p.id==='device-recent')!.fields[0].label).toContain('주공 · 승리');
 expect(JSON.stringify(panels)).not.toContain('private-id');expect(JSON.stringify(panels)).not.toContain('private-actor');expect(JSON.stringify(panels)).not.toContain('mighty-completion');
});
test('empty device record and all locked/unlocked achievement states remain explicit',()=>{
 const s=storage(),empty=mightyDeviceRecordInformation(readDeviceRecords(s)).flatMap(section=>section.information);expect(empty[0].fields.some(f=>f.id==='empty')).toBe(true);const awards=empty.find(p=>p.id==='device-achievements')!;expect(awards.fields).toHaveLength(ACHIEVEMENTS.length);expect(awards.fields.every(f=>f.value.kind==='text'&&f.value.text.startsWith('잠김'))).toBe(true);
 storeCompletion({hand:record(1),alone:true,tookWithMighty:true},s);const next=mightyDeviceRecordInformation(readDeviceRecords(s)).flatMap(section=>section.information).find(p=>p.id==='device-achievements')!;expect(next.fields.find(f=>f.id==='first-win')!.value).toMatchObject({kind:'text',text:expect.stringContaining('달성')});
});
test('storage failure is an error state and never masquerades as an empty record',()=>{
 const panels=mightyDeviceRecordInformation({status:'unsupported',message:'원본 보존'}).flatMap(section=>section.information);expect(panels).toHaveLength(1);expect(panels[0]).toMatchObject({summary:{tone:'danger'},fields:[{id:'error',value:{kind:'text',text:'원본 보존'}}]});expect(panels[0].primary).toBeUndefined();
});

test('each disclosure section respects the unchanged four-panel and twelve-field bounds',()=>{
 const sections=mightyDeviceRecordInformation(readDeviceRecords(storage()));expect(sections.map(section=>section.id)).toEqual(['overview','recent','achievements']);
 for(const section of sections){const doc:TableDocument<string>={context:{session:'s',audience:'a',generation:'g',revision:'1'},participant:{id:'me',name:'나',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'d',commands:[]},offer:{id:'o',actions:[]},information:section.information};expect(()=>validateInformation(doc)).not.toThrow();}
});

test('roles share one clearly labelled nine-field panel preserving count, rate and score',()=>{const source=storage();storeCompletion({hand:record(1),alone:false,tookWithMighty:false},source);const overview=mightyDeviceRecordInformation(readDeviceRecords(source))[0];expect(overview.information).toHaveLength(2);const roles=overview.information[1];expect(roles.title).toBe('역할별 기록');expect(roles.fields).toHaveLength(9);expect(roles.fields.map(field=>field.label)).toEqual(['주공 · 판','주공 · 승률','주공 · 점수','프렌드 · 판','프렌드 · 승률','프렌드 · 점수','야당 · 판','야당 · 승률','야당 · 점수']);expect(roles.fields.slice(0,3).map(field=>field.value)).toEqual([{kind:'number',value:1},{kind:'text',text:'100%'},{kind:'text',text:'+3'}]);expect(overview.information[0].primary?.label).toBe('플레이한 판');});
