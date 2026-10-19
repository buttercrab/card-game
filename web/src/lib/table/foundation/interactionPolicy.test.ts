import {describe,it,expect,vi} from 'vitest';
import {createCardSession} from './session';
import {proofDocument} from './fixtures';
import type {TableDocument} from './contracts';
describe('canonical card activation policy',()=>{
 it.each(['single','repeat'] as const)('owns a frozen %s policy without admitting any action',cardActivation=>{
  const send=vi.fn(),session=createCardSession({transport:send});
  const interaction={cardActivation};session.receive({...proofDocument(),interaction});
  interaction.cardActivation=cardActivation==='single'?'repeat':'single';
  expect(session.snapshot().document?.interaction).toEqual({cardActivation});expect(Object.isFrozen(session.snapshot().document?.interaction)).toBe(true);expect(send).not.toHaveBeenCalled();session.dispose();
 });
 it.each([null,[],{}, {cardActivation:'double'}, {cardActivation:'single',extra:true}, {cardActivation:()=>{}}])('rejects malformed policy before replacing the current canonical document',interaction=>{
  const session=createCardSession({transport:()=>{}}),initial=proofDocument();session.receive(initial);const previous=session.snapshot().document;
  expect(()=>session.receive({...proofDocument({revision:2}),interaction} as unknown as TableDocument<unknown>)).toThrow();expect(session.snapshot().document).toBe(previous);session.dispose();
 });
 it('rejects policy accessors without evaluating them',()=>{
  const session=createCardSession({transport:()=>{}}),read=vi.fn(()=> 'single');
  const interaction=Object.defineProperty({},'cardActivation',{get:read,enumerable:true});
  expect(()=>session.receive({...proofDocument(),interaction} as unknown as TableDocument<unknown>)).toThrow();expect(read).not.toHaveBeenCalled();session.dispose();
 });
});
