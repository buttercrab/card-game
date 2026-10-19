import type { Size } from './contracts';
import { validateCompositionInput, type Composition, type CompositionKernel } from './composition';

export interface NativeComposition extends CompositionKernel {
    inspect(): Readonly<{ liveProbes: number; solves: number }>;
}

/**
 * Internal browser-layout reference for the matched comparison only. The probe
 * never becomes a presentation surface and owns no input, listeners or drafts.
 */
export function createNativeComposition(host: HTMLElement): NativeComposition {
    let liveProbes = 0, solves = 0;
    function compose(width: number, children: readonly Size[], gap: number, padding: number, rows: boolean, align: 'start' | 'center'): Composition {
        validateCompositionInput(width, children, gap, padding);
        if (align !== 'start' && align !== 'center') throw new Error('Invalid row alignment');
        const probe = host.ownerDocument.createElement('div');
        probe.dataset.foundationKernelProbe = 'native';
        probe.inert = true;
        probe.setAttribute('aria-hidden', 'true');
        Object.assign(probe.style, {
            all: 'initial', position: 'fixed', left: '0', top: '0',
            display: 'flex', boxSizing: 'border-box', width: `${width}px`,
            minWidth: '0', minHeight: '0', height: 'auto', margin: '0', border: '0',
            padding: `${padding}px`, gap: `${gap}px`,
            flexDirection: rows ? 'row' : 'column', flexWrap: rows ? 'wrap' : 'nowrap',
            justifyContent: align === 'center' ? 'center' : 'flex-start',
            alignItems: 'flex-start', alignContent: 'flex-start',
            visibility: 'hidden', pointerEvents: 'none', transform: 'none',
            writingMode: 'horizontal-tb', direction: 'ltr',
        });
        const leaves = children.map(size => {
            const leaf = host.ownerDocument.createElement('div');
            Object.assign(leaf.style, {
                all: 'initial', display: 'block', boxSizing: 'border-box',
                width: `${size.width}px`, height: `${size.height}px`,
                minWidth: '0', minHeight: '0', margin: '0', padding: '0', border: '0',
                flexGrow: '0', flexShrink: '0', flexBasis: 'auto',
            });
            probe.append(leaf);
            return leaf;
        });
        liveProbes++;
        try {
            host.append(probe);
            if (!probe.getClientRects().length) throw new Error('Native composition requires a connected layout host');
            const allocation = probe.getBoundingClientRect();
            const placements = leaves.map(leaf => {
                const rect = leaf.getBoundingClientRect();
                return { x: rect.left - allocation.left, y: rect.top - allocation.top };
            });
            solves++;
            return { height: allocation.height, placements };
        } finally {
            probe.remove();
            liveProbes--;
        }
    }
    return {
        name: 'native',
        column: (width, children, gap, padding) => compose(width, children, gap, padding, false, 'start'),
        rows: (width, children, gap, align) => compose(width, children, gap, 0, true, align),
        inspect: () => ({ liveProbes, solves }),
    };
}
