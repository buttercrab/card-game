import { describe, expect, it, vi } from 'vitest';
import { createCardSession } from './session';
import type { ParticipantStatus, StatusPresentation, TableDocument } from './contracts';
type MutableDocument={-readonly [K in keyof TableDocument<string>]:TableDocument<string>[K]};
function document():MutableDocument{return {stage:'active',context:{session:'s',audience:'me',generation:'g',revision:'1'},participant:{id:'me',name:'Me',markers:[]},opponents:[{id:'peer',name:'Peer',handCount:0}],hand:[],facts:[],decision:{id:'d',kind:'commands',commands:['pass']},offer:{id:'o',actions:[{id:'pass',kind:'command',label:'Pass',intent:'secondary',enabled:true,action:'pass'}]},information:[{id:'status',title:'Status',primary:{value:{kind:'number',value:17}},summary:{text:'My turn',tone:'accent'},fields:[{id:'turn',label:'Turn',value:{kind:'participant',participantId:'me'}}],progress:{label:'Progress',total:20,series:[{id:'team',label:'Team',value:3,tone:'plain',from:'start'}]}}]};}
const localStatus=():ParticipantStatus=>({value:{kind:'inline',values:[{kind:'suit',suit:'Spade',label:'Spade'},{kind:'number',value:17}]},tone:'accent'});
const compact=():StatusPresentation=>({informationId:'status',fieldIds:['turn'],primary:true,summary:true,progress:true});
describe('canonical readonly status ownership',()=>{
 it('owns and freezes local/peer statuses and compact references independently from caller aliases',()=>{
  const source=document(),status=localStatus(),peer:ParticipantStatus={value:{kind:'text',text:'Pass'},tone:'muted',muted:true},presentation=compact();source.participant={...source.participant,status};source.opponents=[{...source.opponents![0],status:peer}];source.statusPresentation=presentation;
  const session=createCardSession<string>({transport:vi.fn()});session.receive(source);const owned=session.snapshot().document!;expect(owned.participant.status).toEqual(status);expect(owned.opponents![0].status).toEqual(peer);expect(owned.statusPresentation).toEqual(presentation);
  expect(owned.participant.status).not.toBe(status);expect(owned.opponents![0].status).not.toBe(peer);expect(owned.statusPresentation).not.toBe(presentation);expect(Object.isFrozen(owned.participant.status?.value)).toBe(true);expect(Object.isFrozen(owned.opponents![0].status)).toBe(true);expect(Object.isFrozen(owned.statusPresentation?.fieldIds)).toBe(true);
  (peer.value as {kind:'text';text:string}).text='Changed';(presentation.fieldIds as string[])[0]='foreign';if(status.value.kind==='inline')(status.value.values as unknown[]).push({kind:'text',text:'Changed'});expect(owned.opponents![0].status?.value).toEqual({kind:'text',text:'Pass'});expect(owned.statusPresentation?.fieldIds).toEqual(['turn']);expect(owned.participant.status?.value.kind==='inline'&&owned.participant.status.value.values).toHaveLength(2);
 });
 it('preserves optional legacy omission without inventing a status field',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive(document());const owned=session.snapshot().document!;expect(owned.participant.status).toBeUndefined();expect(owned.opponents![0].status).toBeUndefined();expect(owned.statusPresentation).toBeUndefined();
 });
 it('rejects invalid stages and compact references atomically',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive(document());const before=session.snapshot().document;
  const invalid:TableDocument<string>[]=[{...document(),stage:'waiting',statusPresentation:compact()},{...document(),statusPresentation:{...compact(),informationId:'missing'}},{...document(),statusPresentation:{...compact(),fieldIds:['foreign']}},{...document(),statusPresentation:{...compact(),fieldIds:['turn','turn']}},{...document(),statusPresentation:compact(),outcome:{id:'result',informationId:'status',continuationActionIds:[]}}];
  for(const source of invalid){expect(()=>session.receive(source)).toThrow();expect(session.snapshot().document).toBe(before);}expect(()=>session.receive({...document(),stage:'unknown'} as never)).toThrow(/stage/);expect(session.snapshot().document).toBe(before);
 });
 it('rejects foreign, observer-only and malformed participant values before publication',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive(document());const before=session.snapshot().document;
  const foreign:ParticipantStatus={value:{kind:'participant',participantId:'foreign'},tone:'plain'};
  for(const source of [{...document(),participant:{...document().participant,status:foreign}},{...document(),opponents:[{...document().opponents![0],status:foreign}]},{...document(),participant:{...document().participant,role:'observer' as const,status:{value:{kind:'participant' as const,participantId:'me'},tone:'plain' as const}}},{...document(),participant:{...document().participant,status:{value:{kind:'card',label:'Hidden',visual:{kind:'back'}},tone:'plain'} as never}}]){expect(()=>session.receive(source)).toThrow();expect(session.snapshot().document).toBe(before);}
 });
 it('never evaluates root, participant, peer or nested status getters',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive(document());const before=session.snapshot().document;let reads=0;const getter=()=>{reads++;return localStatus();};
  const root=document();Object.defineProperty(root,'statusPresentation',{enumerable:true,get:getter});
  const local=document();Object.defineProperty(local.participant,'status',{enumerable:true,get:getter});
  const peer=document();Object.defineProperty(peer.opponents![0],'status',{enumerable:true,get:getter});
  const nested=document(),status={tone:'plain'};Object.defineProperty(status,'value',{enumerable:true,get:getter});nested.participant={...nested.participant,status:status as ParticipantStatus};
  const slot=document();Object.defineProperty(slot.opponents!,'0',{enumerable:true,get:getter});
  for(const source of [root,local,peer,nested,slot]){expect(()=>session.receive(source)).toThrow();expect(reads).toBe(0);expect(session.snapshot().document).toBe(before);}
 });
 it('failed status ingress does not mutate connectivity, journal or the current exact command',async()=>{
  const send=vi.fn(),session=createCardSession<string>({transport:send});session.receive(document());const current=session.snapshot().document!;expect(session.admit(current.context,current.offer.id,'pass','pass')).toBe(true);
  const bad={...document(),context:{...document().context,revision:'2'},statusPresentation:{informationId:'foreign',fieldIds:[]}};expect(()=>session.receive(bad,{connected:false})).toThrow();expect(session.snapshot().document).toBe(current);expect(session.snapshot().connected).toBe(true);expect(session.snapshot().operations[0].status).toBe('queued');await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].context).toEqual(current.context);
 });
});
