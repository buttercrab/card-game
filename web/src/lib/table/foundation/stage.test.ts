import { describe, expect, it, vi } from 'vitest';
import { createCardSession } from './session';
import type { TableDocument } from './contracts';
const card={id:'card',label:'Ace',visual:{kind:'standard' as const,suit:'Spade' as const,rank:14}};
const document=():TableDocument<string>=>({context:{session:'s',audience:'a',generation:'g',revision:'1'},participant:{id:'p',name:'Player',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'commands',commands:['pass']},offer:{id:'offer',actions:[{id:'pass',kind:'command',label:'Pass',intent:'secondary',enabled:true,action:'pass'}]}});
describe('explicit public table stage admission',()=>{
 it('keeps omitted legacy documents active and accepts explicit active presentation',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive({...document(),hand:[card]});expect(session.snapshot().document?.stage).toBeUndefined();expect(session.snapshot().document?.hand).toHaveLength(1);session.receive({...document(),stage:'active',hand:[card]});expect(session.snapshot().document?.stage).toBe('active');
 });
 it('admits waiting identities, commands, empty zones and real count-only stock without hand presentation',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive({...document(),stage:'waiting',deals:[],reveals:[],collections:[{id:'stock',label:'Deck',purpose:'stock',cards:[],hiddenCount:53},{id:'trick',label:'Trick',purpose:'play',cards:[]}]});expect(session.snapshot().document?.stage).toBe('waiting');expect(session.snapshot().document?.collections?.[0].hiddenCount).toBe(53);expect(session.snapshot().document?.offer.actions).toHaveLength(1);
 });
 it('rejects every active-hand artifact atomically while preserving the previous document',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive(document());const before=session.snapshot().document;
  const artifacts:Partial<TableDocument<string>>[]=[{hand:[card]},{outcome:{} as never},{deals:[{id:'deal',source:'stock',cardIds:[],handCount:1}]},{reveals:[{participantId:'other',cardId:'card'}]},{stockReturn:{destination:'stock',source:{kind:'hand'}}},{collections:[{id:'board',label:'Board',cards:[card]}]}];
  for(const artifact of artifacts){expect(()=>session.receive({...document(),stage:'waiting',...artifact})).toThrow(/Waiting table/);expect(session.snapshot().document).toBe(before);expect(session.snapshot().connected).toBe(true);}
 });
 it('rejects unknown stages and accessors before replacing or reading an untrusted stage',()=>{
  const session=createCardSession<string>({transport:vi.fn()});session.receive(document());const before=session.snapshot().document;
  for(const stage of ['lobby','',null,false,1,{}]){expect(()=>session.receive({...document(),stage} as TableDocument<string>)).toThrow(/Invalid table stage/);expect(session.snapshot().document).toBe(before);}
  let reads=0;const source=document();Object.defineProperty(source,'stage',{enumerable:true,get(){reads++;return 'waiting';}});expect(()=>session.receive(source)).toThrow(/Invalid table stage/);expect(reads).toBe(0);expect(session.snapshot().document).toBe(before);
 });
});
