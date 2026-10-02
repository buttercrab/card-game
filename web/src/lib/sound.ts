// Table sounds, synthesised with Web Audio so there are no files to load
// or license. Browsers only allow audio after a user gesture, so the
// context starts on the first tap and every cue is silent until then.

import { settings } from './settings.svelte';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function unlock() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

/** The output for one cue, or null when sound is off or not yet allowed. */
function out(at: number, level: number): { ctx: AudioContext; gain: GainNode; t: number } | null {
  if (!ctx || !settings.sound || settings.volume <= 0 || ctx.state !== 'running') return null;
  const gain = ctx.createGain();
  gain.gain.value = level * settings.volume;
  gain.connect(ctx.destination);
  return { ctx, gain, t: ctx.currentTime + at };
}

/** A short filtered noise burst: paper on felt. */
function snap(at: number, { freq = 2400, length = 0.06, level = 0.5 } = {}) {
  const o = out(at, level);
  if (!o || !noise) return;
  const src = o.ctx.createBufferSource();
  src.buffer = noise;
  const filter = o.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.9;
  const env = o.ctx.createGain();
  env.gain.setValueAtTime(0, o.t);
  env.gain.linearRampToValueAtTime(1, o.t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.001, o.t + length);
  src.connect(filter).connect(env).connect(o.gain);
  src.start(o.t, Math.random() * 0.3, length + 0.02);
}

/** A soft plucked tone. */
function note(at: number, freq: number, { length = 0.35, level = 0.18, type = 'triangle' as OscillatorType } = {}) {
  const o = out(at, level);
  if (!o) return;
  const osc = o.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const env = o.ctx.createGain();
  env.gain.setValueAtTime(0, o.t);
  env.gain.linearRampToValueAtTime(1, o.t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, o.t + length);
  osc.connect(env).connect(o.gain);
  osc.start(o.t);
  osc.stop(o.t + length + 0.05);
}

// A major pentatonic scale from A4: nothing sounds wrong together.
const SCALE = [440, 494, 554, 659, 740, 880, 988, 1109, 1319, 1480];

export const sound = {
  /** A card lands on the trick. */
  card(delay = 0) {
    snap(delay, { freq: 1800 + Math.random() * 900 });
  },
  /** A trick slides to its winner, with a rising note per point card in it. */
  sweep(points: number, delay = 0) {
    snap(delay, { freq: 900, length: 0.22, level: 0.35 });
    for (let i = 0; i < points; i++) note(delay + 0.08 + i * 0.07, SCALE[Math.min(i, SCALE.length - 1)]);
  },
  /** It is now your turn. */
  turn() {
    note(0, 659, { level: 0.12, length: 0.25 });
    note(0.11, 880, { level: 0.12, length: 0.4 });
  },
  /** A bid or a pass. */
  bid() {
    snap(0, { freq: 3200, length: 0.03, level: 0.3 });
  },
  /** The friend is revealed. */
  friend() {
    [554, 659, 880, 1109].forEach((f, i) => note(i * 0.07, f, { level: 0.16, length: 0.5 }));
  },
  /** The hand is over. */
  result(won: boolean) {
    const notes = won ? [440, 554, 659, 880] : [659, 554, 494, 440];
    notes.forEach((f, i) => note(i * 0.12, f, { level: 0.14, length: 0.6, type: 'sine' }));
  },
};
