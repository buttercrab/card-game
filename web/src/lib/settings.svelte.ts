// Per-player preferences, kept in this browser only.

export type Speed = 'normal' | 'fast' | 'off';
import type { CardBack, TableTone } from './achievements';

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
const DEFAULTS: Settings = { fourColor: true, singleTap: false, sound: true, music: false, musicVolume: 0.5, haptics: true, volume: 0.7, speed: 'normal', hints: false, tips: false, cardBack: 'charcoal', tableTone: 'hanji' };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = $state(load());

$effect.root(() => {
  $effect(() => {
    document.documentElement.dataset.fourColor = String(settings.fourColor);
    document.documentElement.dataset.motion = settings.speed;
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
