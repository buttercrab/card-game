// Per-player preferences, kept in this browser only.

export type Speed = 'normal' | 'fast' | 'off';

interface Settings {
  /** ♦ blue and ♣ green instead of red and black. */
  fourColor: boolean;
  /** Play a card with one tap instead of raise-then-play. */
  singleTap: boolean;
  sound: boolean;
  /** A short vibration when your turn starts (Android only). */
  haptics: boolean;
  /** 0 to 1. */
  volume: number;
  speed: Speed;
}

const KEY = 'mighty.settings';
const DEFAULTS: Settings = { fourColor: true, singleTap: false, sound: true, haptics: true, volume: 0.7, speed: 'normal' };

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
