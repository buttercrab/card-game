import type { PlannedNode, PresentationFrame } from './contracts';
/** Internal bounded motion recipe. Game documents cannot supply paths or timings. */
export const SELECTION_LIFT = 14;
export const SELECTION_DURATION = 240;
export const SELECTION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
export interface SelectionTrack { readonly id: string; readonly fromY: number; }
export function selectionTracks(previous: PresentationFrame | null, next: PresentationFrame): readonly SelectionTrack[] {
    if (!previous || previous.environment.revision !== next.environment.revision || previous.offerId !== next.offerId ||
        JSON.stringify(previous.context) !== JSON.stringify(next.context)) return [];
    const old = new Map(previous.nodes.map(node => [node.id, node]));
    const current = new Map(next.nodes.map(node => [node.id, node]));
    const sameBox = (a: PlannedNode, b: PlannedNode) => a.box.x === b.box.x && a.box.y === b.box.y && a.box.width === b.box.width && a.box.height === b.box.height;
    function stableAncestors(node: PlannedNode): boolean {
        let id = node.parent;
        while (id !== null) {
            const before = old.get(id), after = current.get(id);
            if (!before || !after || before.parent !== after.parent || !sameBox(before, after)) return false;
            id = after.parent;
        }
        return true;
    }
    return next.nodes.flatMap(node => {
        const before = old.get(node.id);
        if (!before || !node.cardId || node.kind !== 'card' || before.kind !== 'card' || before.cardId !== node.cardId ||
            before.parent !== node.parent || before.checked === node.checked || before.box.x !== node.box.x ||
            before.box.width !== node.box.width || before.box.height !== node.box.height ||
            JSON.stringify(before.visual) !== JSON.stringify(node.visual) || !stableAncestors(node)) return [];
        const delta = before.box.y - node.box.y;
        // Only the planner's reserved 14px lift is admissible, without overshoot.
        if (delta !== (node.checked ? SELECTION_LIFT : -SELECTION_LIFT)) return [];
        return [{ id: node.id, fromY: delta }];
    });
}
