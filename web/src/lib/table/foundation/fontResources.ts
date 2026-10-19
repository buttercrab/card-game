/** Font load notifications are hints, not proof that measured glyphs changed. */
export interface FontMetricResource {
    readonly status: string;
    readonly family: string;
    readonly style?: string;
    readonly weight?: string;
    readonly stretch?: string;
    readonly unicodeRange?: string;
    readonly featureSettings?: string;
    readonly variationSettings?: string;
    readonly ascentOverride?: string;
    readonly descentOverride?: string;
    readonly lineGapOverride?: string;
    readonly sizeAdjust?: string;
}
const descriptors = ['family', 'style', 'weight', 'stretch', 'unicodeRange', 'featureSettings',
    'variationSettings', 'ascentOverride', 'descentOverride', 'lineGapOverride', 'sizeAdjust'] as const;
/** Adapter-scoped identity; attachment still remeasures after unobserved changes. */
export function createFontResources() {
    const identities = new WeakMap<FontMetricResource, number>();
    let nextIdentity = 0, generation = 0, previous: string | undefined;
    return {
        revision(resources: Iterable<FontMetricResource>): string {
            const active = [];
            for (const face of resources) {
                if (face.status !== 'loaded') continue;
                let identity = identities.get(face);
                if (identity === undefined) { identity = ++nextIdentity; identities.set(face, identity); }
                active.push([identity, ...descriptors.map(property => face[property] ?? '')]);
            }
            const signature = JSON.stringify(active);
            if (signature !== previous) { previous = signature; generation++; }
            return String(generation);
        },
    };
}
