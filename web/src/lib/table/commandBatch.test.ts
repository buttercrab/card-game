import { expect, it, vi } from 'vitest';
import { resolveCommandBatch } from './commandBatch';
import type { ActionOffer } from './presentation';

const a = { discard: 'a' }, b = { discard: 'b' };
const offer: ActionOffer<typeof a> = { id: 'current', actions: [
  { kind: 'command', id: 'a', label: 'a', intent: 'primary', enabled: true, action: a },
  { kind: 'command', id: 'b', label: 'b', intent: 'primary', enabled: true, action: b },
] };
it('prepares exact payload references only after the entire selection validates', () => {
  const result = resolveCommandBatch(offer, 'current', ['b', 'a']);
  expect(result.ok).toBe(true);
  if (result.ok) { expect(result.action[0]).toBe(b); expect(result.action[1]).toBe(a); }
  expect(resolveCommandBatch(offer, 'current', ['a', 'removed'])).toMatchObject({ ok: false });
  expect(resolveCommandBatch({ ...offer, actions: offer.actions.map(s => s.id === 'b' ? { ...s, enabled: false } : s) }, 'current', ['a', 'b'])).toMatchObject({ ok: false, code: 'disabled' });
});
it('rejects stale, empty and duplicate selections without building numeric actions', () => {
  expect(resolveCommandBatch(offer, 'old', ['a'])).toMatchObject({ ok: false, code: 'stale_offer' });
  expect(resolveCommandBatch(offer, 'current', [])).toMatchObject({ ok: false });
  expect(resolveCommandBatch(offer, 'current', ['a', 'a'])).toMatchObject({ ok: false });
  const createAction = vi.fn(() => a);
  const numeric: ActionOffer<typeof a> = { id: 'current', actions: [{ kind: 'number', id: 'amount', label: 'amount', intent: 'primary', enabled: true, min: 1, max: 5, step: 1, initial: 1, createAction }] };
  expect(resolveCommandBatch(numeric, 'current', ['amount'])).toMatchObject({ ok: false });
  expect(createAction).not.toHaveBeenCalled();
});
