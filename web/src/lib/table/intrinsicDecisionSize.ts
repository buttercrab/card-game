import type { Size } from './layout';
import type { ReadContext } from './frameMeasurements';

/** Allocated widths are outputs. Only unconstrained native leaves or declared
 * engine dimensions may supply natural widths to a subsequent layout solve. */
export class IntrinsicDecisionSizes {
  private cache = new WeakMap<HTMLElement, { key: string; width: number }>();
  private authoredDisplays = new WeakMap<HTMLElement, string>();
  private authoredWidths = new WeakMap<HTMLElement, string>();
  private elements: HTMLElement[] = [];
  private batch: ReadContext | undefined;
  track(elements: HTMLElement[]): void {
    this.elements = elements;
    for (const element of elements) if (!this.authoredWidths.has(element)) { this.authoredWidths.set(element, element.style.width); this.authoredDisplays.set(element, element.style.display); }
    this.batch = undefined;
  }
  invalidate(element: HTMLElement): void { this.cache.delete(element); this.batch = undefined; }
  read(element: HTMLElement, context: ReadContext): Size {
    if (this.batch !== context) { this.prepare(context); this.batch = context; }
    return { width: this.cache.get(element)?.width ?? element.offsetWidth, height: element.offsetHeight };
  }
  private prepare(context: ReadContext): void {
    const probes: { element: HTMLElement; probe: HTMLElement; key: string }[] = [];
    for (const element of this.elements) {
      if (!element.parentElement) continue;
      const declared = element.getAttribute('data-decision-natural-width');
      if (declared !== null && Number.isFinite(Number(declared))) {
        this.cache.set(element, { key: 'engine', width: Number(declared) }); continue;
      }
      const style = getComputedStyle(element);
      // Card/form widths are explicit engine/authored inputs, never allocated outputs.
      const authored = this.authoredWidths.get(element) ?? '';
      const explicit = element.classList.contains('card') ? Number.parseFloat(style.getPropertyValue('--w'))
        : /^\d+(?:\.\d+)?px$/.test(authored) ? Number.parseFloat(authored) : NaN;
      if (Number.isFinite(explicit)) { this.cache.set(element, { key: 'explicit', width: explicit }); continue; }
      const key = [context.viewport.width, context.viewport.height, context.fontsRevision,
        element.innerHTML, element.className, style.font, style.letterSpacing,
        style.wordSpacing, style.padding, style.borderWidth, style.minWidth, style.boxSizing].join('|');
      if (this.cache.get(element)?.key === key) continue;
      const probe = element.cloneNode(true) as HTMLElement;
      probe.dataset.engineIntrinsicProbe = '';
      probe.setAttribute('aria-hidden', 'true'); probe.inert = true;
      probe.removeAttribute('id');
      for (const descendant of probe.querySelectorAll('[id]')) descendant.removeAttribute('id');
      Object.assign(probe.style, { position: 'absolute', left: '0px', top: '0px',
        display: this.authoredDisplays.get(element) ?? '', width: 'max-content', maxWidth: 'none', height: 'auto', maxHeight: 'none',
        visibility: 'hidden', pointerEvents: 'none', transform: 'none', translate: 'none', rotate: 'none' });
      probes.push({ element, probe, key });
    }
    // Batch probe writes, then reads, then cleanup. The original controls and
    // their focus/handlers never change, and nothing reaches a visible paint.
    for (const { element, probe } of probes) element.parentElement!.append(probe);
    try {
      for (const { element, probe, key } of probes) {
        const style = getComputedStyle(probe);
        const usedWidth = Number.parseFloat(style.width);
        const edges = style.boxSizing === 'border-box' ? 0 : [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce((sum, edge) => sum + (Number.parseFloat(edge) || 0), 0);
        // offsetWidth rounds down 87.4375px to 87px: that lost fraction
        // can wrap a label. Ignore ancestor transforms and round UP instead.
        this.cache.set(element, { key, width: Math.ceil(Number.isFinite(usedWidth) ? usedWidth + edges : probe.offsetWidth) });
      }
    } finally { for (const { probe } of probes) probe.remove(); }
  }
}

export function isIntrinsicProbeMutation(record: MutationRecord): boolean {
  if (record.type !== 'childList') return false;
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return nodes.length > 0 && nodes.every(node => node instanceof HTMLElement && node.hasAttribute('data-engine-intrinsic-probe'));
}
