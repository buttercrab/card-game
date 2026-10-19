import type { Size } from './contracts';
import { validateCompositionInput, type Composition, type CompositionKernel } from './composition';

export interface YogaComposition extends CompositionKernel {
    inspect(): Readonly<{ liveNodes: number; liveConfigs: number; solves: number }>;
}
/** Loaded only by the isolated comparison; no DOM, measurement or runtime authority. */
export async function loadYogaComposition(): Promise<YogaComposition> {
    const { default: Yoga } = await import('yoga-layout');
    let liveNodes = 0, liveConfigs = 0, solves = 0;
    function compose(width: number, children: readonly Size[], gap: number, padding: number, rows: boolean, align: 'start' | 'center'): Composition {
        validateCompositionInput(width, children, gap, padding);
        if (align !== 'start' && align !== 'center') throw new Error('Invalid row alignment');
        const config = Yoga.Config.create();
        liveConfigs++;
        let root: ReturnType<typeof Yoga.Node.create> | undefined;
        const nodes: ReturnType<typeof Yoga.Node.create>[] = [];
        try {
            config.setPointScaleFactor(0);
            root = Yoga.Node.create(config);
            liveNodes++;
            root.setWidth(width);
            root.setFlexDirection(rows ? Yoga.FLEX_DIRECTION_ROW : Yoga.FLEX_DIRECTION_COLUMN);
            root.setFlexWrap(rows ? Yoga.WRAP_WRAP : Yoga.WRAP_NO_WRAP);
            root.setAlignItems(Yoga.ALIGN_FLEX_START);
            root.setAlignContent(Yoga.ALIGN_FLEX_START);
            root.setJustifyContent(align === 'center' ? Yoga.JUSTIFY_CENTER : Yoga.JUSTIFY_FLEX_START);
            root.setPadding(Yoga.EDGE_ALL, padding);
            root.setGap(Yoga.GUTTER_ALL, gap);
            children.forEach((size, index) => {
                const child = Yoga.Node.create(config);
                nodes.push(child);
                liveNodes++;
                child.setWidth(size.width);
                child.setHeight(size.height);
                child.setFlexGrow(0);
                child.setFlexShrink(0);
                root!.insertChild(child, index);
            });
            root.calculateLayout(width, undefined, Yoga.DIRECTION_LTR);
            solves++;
            return { height: root.getComputedHeight(), placements: nodes.map(node => ({ x: node.getComputedLeft(), y: node.getComputedTop() })) };
        } finally {
            // Free individually, including a leaf whose setup failed before attachment.
            for (const child of nodes) {
                if (child.getParent()) root!.removeChild(child);
                child.free();
                liveNodes--;
            }
            if (root) { root.free(); liveNodes--; }
            config.free();
            liveConfigs--;
        }
    }
    return {
        name: 'yoga',
        column: (width, children, gap, padding) => compose(width, children, gap, padding, false, 'start'),
        rows: (width, children, gap, align) => compose(width, children, gap, 0, true, align),
        inspect: () => ({ liveNodes, liveConfigs, solves }),
    };
}
