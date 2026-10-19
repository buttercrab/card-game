// Per-player preferences, kept in this browser only.

import { prefersReducedMotion } from 'svelte/motion';
import {normalizeSettings,type Settings} from './settingsValues';
export type {Speed} from './settingsValues';
const KEY = 'mighty.settings';

function load(): Settings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return normalizeSettings(null);
  }
}

export const settings: Settings = $state(load());

/** How much moves: 'full'; 'reduced' (the system asks for less motion:
 * fades and highlights stay, movement goes); or 'off' (애니메이션 끄기:
 * every change shows at once). */
export type MotionLevel = 'full' | 'reduced' | 'off';

/** The one source for motion, in script and (as `data-motion` on the
 * root) in CSS: the speed setting and the system's reduced motion. */
export const motion = {
  get level(): MotionLevel {
    if (settings.speed === 'off') return 'off';
    return prefersReducedMotion.current ? 'reduced' : 'full';
  },
  /** Duration multiplier for what moves: 1, 0.5 at 빠르게, 0 when it does not. */
  get speed(): number {
    if (this.level !== 'full') return 0;
    return settings.speed === 'fast' ? 0.5 : 1;
  },
};

$effect.root(() => {
  $effect(() => {
    document.documentElement.dataset.fourColor = String(settings.fourColor);
    document.documentElement.dataset.motion = motion.level;
    document.documentElement.dataset.back = settings.cardBack;
    document.documentElement.dataset.table = settings.tableTone;
  });
  $effect(() => {
    const json = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      // Storage can be unavailable (private mode); settings then last the session.
    }
  });
});
