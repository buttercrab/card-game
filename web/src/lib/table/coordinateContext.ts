import { getContext, setContext } from 'svelte';
import { BoundsRegistry } from './sceneCoordinates';
import type { Bounds } from './movement';
import { createFrameMeasurements, readRegion, type FrameMeasurements } from './frameMeasurements';

const KEY = Symbol('table-coordinate-engine');
export interface TableCoordinates {
  bounds: BoundsRegistry;
  measurements: FrameMeasurements;
  root(): HTMLElement | undefined;
  /** Compatibility boundary; production subscriptions use batched measurements. */
  region(element: HTMLElement): Bounds;
}
export function provideTableCoordinates(root: () => HTMLElement | undefined): TableCoordinates {
  const coordinates: TableCoordinates = {
    bounds: new BoundsRegistry(), root,
    measurements: createFrameMeasurements(root),
    region: element => readRegion(element, root()?.getBoundingClientRect()),
  };
  setContext(KEY, coordinates);
  return coordinates;
}
export function tableCoordinates(): TableCoordinates | undefined { return getContext(KEY); }
