import { cssViewport } from './domViewport';
import type { Size } from './layout';
import type { Bounds } from './movement';
import { MeasurementScheduler, type MeasurementTransaction } from './measurementScheduler';
import { flushSync } from 'svelte';

export interface RegionMetrics { viewport: Size; region: Bounds }
export interface ReadContext { viewport: Size; frame?: DOMRect; fontsRevision: number }
export interface FrameMeasurements {
  observeRegion(element: HTMLElement, publish: (metrics: RegionMetrics) => void): () => void;
  observeSize(element: HTMLElement, publish: (size: Size) => void, read?: (context: ReadContext) => Size): () => void;
  /** Initial reveal waits for fonts and a completed layout transaction. */
  observeReady(publish: (ready: boolean) => void): () => void;
  /** Scroll affordances are DOM reads too; measure them before renderer writes. */
  observeOverflow(element: HTMLElement, publish: (overflow: boolean) => void): () => void;
  invalidate(): void;
  dispose(): void;
}
const equalSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;
const equalMetrics = (a: RegionMetrics, b: RegionMetrics) => equalSize(a.viewport, b.viewport) && equalSize(a.region, b.region) && a.region.x === b.region.x && a.region.y === b.region.y;

/** Measure reserved regions, never card/player boxes as position authority. */
export function readRegion(element: HTMLElement, frame?: DOMRect): Bounds {
  const box = element.getBoundingClientRect();
  const translation = getComputedStyle(element).translate.split(' ').map(value => parseFloat(value) || 0);
  return { x: box.x - (frame?.x ?? box.x) - translation[0], y: box.y - (frame?.y ?? box.y) - (translation[1] ?? 0), width: element.clientWidth, height: element.clientHeight };
}

export function createFrameMeasurements(root: () => HTMLElement | undefined, options: { onTransaction?: (transaction: MeasurementTransaction) => void } = {}): FrameMeasurements {
  let observer: ResizeObserver | undefined;
  let observedRoot: HTMLElement | undefined;
  let disposed = false;
  let listening = false;
  let fontsRevision = 0;
  let limitReported = false;
  let initialReady = false;
  const readiness = new Set<(ready: boolean) => void>();
  // Audits opt in before mounting. Normal play retains no timing entries and
  // does not pay for per-transaction timers or diagnostics callbacks.
  const timingAudit = typeof performance !== 'undefined' && performance.getEntriesByName('table-layout-audit-enabled').length > 0;
  const elements = new Map<HTMLElement, number>();
  const scheduler = new MeasurementScheduler<ReadContext>({
    request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
    flush: () => { flushSync(); },
    maxRounds: 16,
    onSettled: () => {
      if (initialReady || document.fonts?.status === 'loading') return;
      initialReady = true;
      for (const publish of [...readiness]) if (!disposed && readiness.has(publish)) publish(true);
      if (!disposed) flushSync();
    },
    onTransaction: options.onTransaction ?? (timingAudit ? transaction => {
      const end = performance.now();
      performance.measure('table-layout-transaction', { start: end - transaction.duration, end, detail: transaction });
      performance.clearMeasures('table-layout-transaction');
    } : undefined),
    onLimit: rounds => {
      if (!limitReported) console.warn(`Table layout did not settle within ${rounds} measurement rounds; continuing next frame.`);
      limitReported = true;
    },
    context: () => {
      const element = root();
      if (element !== observedRoot) {
        if (observedRoot && !elements.has(observedRoot)) observer?.unobserve(observedRoot);
        observedRoot = element;
        if (element) observer?.observe(element);
      }
      return { viewport: cssViewport(), frame: element?.getBoundingClientRect(), fontsRevision };
    },
  });
  const invalidate = () => scheduler.invalidate();
  const fontsChanged = () => { fontsRevision++; invalidate(); };
  function watch(element: HTMLElement): () => void {
    if (!listening) {
      observer = new ResizeObserver(invalidate);
      addEventListener('resize', invalidate);
      // Font replacement may change intrinsic heights without a viewport resize.
      document.fonts?.addEventListener('loadingdone', fontsChanged);
      listening = true;
    }
    elements.set(element, (elements.get(element) ?? 0) + 1);
    observer?.observe(element);
    return () => {
      const count = elements.get(element);
      if (count === undefined) return;
      if (count > 1) elements.set(element, count - 1);
      else { elements.delete(element); if (element !== observedRoot) observer?.unobserve(element); }
    };
  }
  return {
    observeOverflow(element, publish) {
      if (disposed) return () => {};
      const unwatch = watch(element);
      const unregister = scheduler.observe(() => element.scrollLeft + element.clientWidth < element.scrollWidth - 2, publish, Object.is);
      return () => { unregister(); unwatch(); };
    },
    observeReady(publish) {
      if (disposed) return () => {};
      readiness.add(publish);
      publish(initialReady);
      scheduler.invalidate();
      return () => { readiness.delete(publish); };
    },
    observeRegion(element, publish) {
      if (disposed) return () => {};
      const unwatch = watch(element);
      const unregister = scheduler.observe(context => ({ viewport: context.viewport, region: readRegion(element, context.frame) }), publish, equalMetrics);
      return () => { unregister(); unwatch(); };
    },
    observeSize(element, publish, read) {
      if (disposed) return () => {};
      const unwatch = watch(element);
      const unregister = scheduler.observe(read ?? (() => ({ width: element.offsetWidth, height: element.offsetHeight })), publish, equalSize);
      return () => { unregister(); unwatch(); };
    },
    invalidate,
    dispose() {
      disposed = true;
      scheduler.dispose(); observer?.disconnect(); elements.clear(); readiness.clear();
      if (listening) { removeEventListener('resize', invalidate); document.fonts?.removeEventListener('loadingdone', fontsChanged); }
    },
  };
}
