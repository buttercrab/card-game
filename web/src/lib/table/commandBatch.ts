import { validateAction, type ActionOffer, type ActionResolution } from './presentation';

/** Prepare exact commands together before dispatch. The server still receives
 * separate actions; this is not an atomic server transaction. */
export function resolveCommandBatch<A>(offer: ActionOffer<A>, expectedOfferId: string, ids: readonly string[]): ActionResolution<A[]> {
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    return { ok: false, code: 'unknown_action', reason: '서로 다른 행동을 선택해주세요.' };
  const actions: A[] = [];
  for (const id of ids) {
    const checked = validateAction(offer, expectedOfferId, id);
    if (!checked.ok) return checked;
    if (checked.kind !== 'command') return { ok: false, code: 'unknown_action', reason: '현재 명령을 다시 확인해주세요.' };
    actions.push(checked.spec.action);
  }
  return { ok: true, action: actions };
}
