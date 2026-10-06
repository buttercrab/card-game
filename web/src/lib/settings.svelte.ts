// Per-player preferences, kept in this browser only.

import { prefersReducedMotion } from 'svelte/motion';
import type { CardBack, TableTone } from './achievements';

export type Speed = 'normal' | 'fast' | 'off';

interface Settings {
  /** ♦ blue and ♣ green instead of red and black. */
  fourColor: boolean;
  /** Play a card with one tap instead of raise-then-play. */
  singleTap: boolean;
  sound: boolean;
  /** Quiet background jazz. */
  music: boolean;
  /** 0 to 1. */
  musicVolume: number;
  /** A short vibration when your turn starts (Android only). */
  haptics: boolean;
  /** 0 to 1. */
  volume: number;
  speed: Speed;
  /** A button that shows what the bot would do on your turn. */
  hints: boolean;
  /** A line of advice on your turn, for people learning the game. */
  tips: boolean;
  /** Looks earned through 업적. */
  cardBack: CardBack;
  tableTone: TableTone;
}

const KEY = 'mighty.settings';
const DEFAULTS: Settings = { fourColor: true, singleTap: false, sound: true, music: false, musicVolume: 0.5, haptics: true, volume: 0.7, speed: 'normal', hints: true, tips: false, cardBack: 'charcoal', tableTone: 'hanji' };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
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
