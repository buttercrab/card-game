// Background music: a few CC0 jazz tracks from Open Lo-Fi
// (github.com/btahir/open-lofi), shuffled and crossfaded. Off by default and
// fetched only once someone turns it on.

import { settings } from './settings.svelte';
import { withAudio } from './sound';

const TRACKS = ['/music/candlelit-at-70-bpm.mp3', '/music/stacks-of-quiet-books.mp3'];
const FADE = 4;

/**
 * The music follows the hand without changing its notes (they are
 * recordings): muffled while people bid, open in play, and dipped under the
 * result.
 */
export type Mood = 'lobby' | 'bidding' | 'play' | 'result';
const MOODS: Record<Mood, { cutoff: number; level: number }> = {
  lobby: { cutoff: 18000, level: 1 },
  bidding: { cutoff: 1400, level: 0.85 },
  play: { cutoff: 9000, level: 1 },
  result: { cutoff: 2200, level: 0.55 },
};
let mood: Mood = 'lobby';

/** Glides the music toward `next` over about a second. */
export function setMood(next: Mood) {
  if (next === mood) return;
  mood = next;
  if (!ctx || !bus) return;
  const t = ctx.currentTime;
  bus.filter.frequency.setTargetAtTime(MOODS[next].cutoff, t, 0.35);
  bus.gain.gain.setTargetAtTime(MOODS[next].level, t, 0.35);
}

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
}

let decks: [Deck, Deck] | null = null;
/** Shared by both decks: a low-pass filter and a level that follow the hand. */
let bus: { filter: BiquadFilterNode; gain: GainNode } | null = null;
let current = 0;
let order: string[] = [];
let ctx: AudioContext | null = null;

function nextTrack(): string {
  if (!order.length) order = [...TRACKS].sort(() => Math.random() - 0.5);
  return order.pop()!;
}

function deck(ctx: AudioContext): Deck {
  const el = new Audio();
  el.preload = 'auto';
  // Routed through Web Audio because iOS ignores element.volume.
  const gain = ctx.createGain();
  gain.gain.value = 0;
  if (!bus) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = MOODS[mood].cutoff;
    const level = ctx.createGain();
    level.gain.value = MOODS[mood].level;
    filter.connect(level).connect(ctx.destination);
    bus = { filter, gain: level };
  }
  ctx.createMediaElementSource(el).connect(gain).connect(bus.filter);
  el.addEventListener('timeupdate', () => {
    if (decks?.[current].el === el && el.duration - el.currentTime < FADE) play();
  });
  return { el, gain };
}

function level() {
  return settings.music && !document.hidden ? settings.musicVolume * 0.6 : 0;
}

/** Fades the next track in over the one playing. */
function play() {
  if (!ctx || !decks) return;
  const from = decks[current];
  current = 1 - current;
  const to = decks[current];
  const t = ctx.currentTime;
  from.gain.gain.setTargetAtTime(0, t, FADE / 4);
  setTimeout(() => from.el.pause(), FADE * 1000);
  to.el.src = nextTrack();
  to.gain.gain.cancelScheduledValues(t);
  to.gain.gain.setValueAtTime(0, t);
  to.gain.gain.linearRampToValueAtTime(level(), t + FADE);
  void to.el.play().catch(() => {});
}

function update() {
  if (!ctx) return;
  const on = level() > 0;
  if (on && !decks) {
    decks = [deck(ctx), deck(ctx)];
    play();
    return;
  }
  if (!decks) return;
  const d = decks[current];
  d.gain.gain.setTargetAtTime(level(), ctx.currentTime, 0.3);
  if (on && d.el.paused) void d.el.play().catch(() => {});
  if (!on) setTimeout(() => level() === 0 && d.el.pause(), 1200);
}

if (typeof window !== 'undefined') {
  withAudio((c) => {
    ctx = c;
    update();
  });
  document.addEventListener('visibilitychange', update);
  $effect.root(() => {
    $effect(() => {
      void settings.music;
      void settings.musicVolume;
      update();
    });
  });
}
