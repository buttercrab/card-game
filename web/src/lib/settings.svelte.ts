// Per-player preferences, kept in this browser only.

interface Settings {
  /** ♦ blue and ♣ green instead of red and black. */
  fourColor: boolean;
}

const KEY = 'mighty.settings';
const DEFAULTS: Settings = { fourColor: true };

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
    const json = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      // Storage can be unavailable (private mode); settings then last the session.
    }
  });
});
