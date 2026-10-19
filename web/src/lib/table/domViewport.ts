import type { Size } from './layout';

/** Match CSS media queries, even when temporary mobile overflow enlarges innerWidth. */
export function cssViewport(): Size {
  return {width:document.documentElement.clientWidth || innerWidth,
    height:document.documentElement.clientHeight || innerHeight};
}
