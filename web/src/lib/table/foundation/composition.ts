import type { Size } from './contracts';

/** Internal box kernel. Children already own their measured, exact footprints. */
export interface Composition {
    readonly height: number;
    readonly placements: readonly { readonly x: number; readonly y: number }[];
}
export interface CompositionKernel {
    readonly name: string;
    column(width: number, children: readonly Size[], gap: number, padding: number): Composition;
    rows(width: number, children: readonly Size[], gap: number, align: 'start' | 'center'): Composition;
}
export function validateCompositionInput(width: number, children: readonly Size[], gap: number, padding = 0): void {
    if (![width, gap, padding].every(value => Number.isFinite(value) && value >= 0) || padding * 2 > width)
        throw new Error('Invalid composition allocation');
    for (const child of children) {
        if (![child.width, child.height].every(value => Number.isFinite(value) && value >= 0))
            throw new Error('Invalid measured child footprint');
        if (child.width > width - padding * 2)
            throw new Error(`Measured child exceeds exact composition width: ${child.width} > ${width-padding*2}`);
    }
}
export const numericComposition: CompositionKernel = {
    name: 'numeric',
    column(width, children, gap, padding) {
        validateCompositionInput(width, children, gap, padding);
        let y = padding;
        const placements = children.map(child => {
            const point = { x: padding, y };
            y += child.height + gap;
            return point;
        });
        return { height: children.length ? y - gap + padding : padding * 2, placements };
    },
    rows(width, children, gap, align) {
        validateCompositionInput(width, children, gap);
        if (align !== 'start' && align !== 'center') throw new Error('Invalid row alignment');
        let x = 0, y = 0, rowHeight = 0, rowStart = 0;
        const placements: { x: number; y: number }[] = [];
        const center = (end: number) => {
            if (align !== 'center' || end === rowStart) return;
            const last = end - 1;
            const offset = (width - placements[last].x - children[last].width) / 2;
            for (let index = rowStart; index < end; index++) placements[index].x += offset;
        };
        children.forEach((child, index) => {
            if (index > rowStart && x + child.width > width) {
                center(index);
                rowStart = index;
                x = 0;
                y += rowHeight + gap;
                rowHeight = 0;
            }
            placements.push({ x, y });
            x += child.width + gap;
            rowHeight = Math.max(rowHeight, child.height);
        });
        center(children.length);
        return { height: y + rowHeight, placements };
    },
};
