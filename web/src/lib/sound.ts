// Table sounds, synthesised with Web Audio so there are no files to load
// or license. Browsers only allow audio after a user gesture, so the
// context starts on the first tap and every cue is silent until then.

import { settings } from './settings.svelte';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/**
 * A second of pink noise (Paul Kellet's filter), made once and reused. Pink
 * is warmer than white: paper on felt, not radio hiss. Each voice starts at
 * a random point in it, so no two sounds are the same.
 */
function pinkNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    peak = Math.max(peak, Math.abs(data[i]));
  }
  for (let i = 0; i < data.length; i++) data[i] /= peak;
  return buffer;
}

function unlock() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    noise = pinkNoise(ctx);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  onUnlock?.(ctx);
}

let onUnlock: ((ctx: AudioContext) => void) | null = null;

/** Runs `f` with the audio context once the browser allows sound, and after every later tap. */
export function withAudio(f: (ctx: AudioContext) => void) {
  onUnlock = f;
  if (ctx) f(ctx);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  // Every chip and button answers with a tap, without wiring each one.
  window.addEventListener('click', (e) => {
    const button = (e.target as Element | null)?.closest?.('button');
    if (button && !button.disabled && !button.classList.contains('card')) sound.tap();
  });
}

/**
 * Musical cues are written in A; they move to the key of the music playing
 * so the two never clash.
 */
let transpose = 1;

/** Sets the key of the musical cues, in semitones from A (0 = A, -4 = F). */
export function setKey(semitones: number) {
  transpose = Math.pow(2, semitones / 12);
}

/**
 * Pink noise has less energy up high than the white noise these levels were
 * tuned on; this brings a band around `freq` back to about the same loudness.
 */
const lift = (freq: number) => 1.6 * Math.sqrt(freq / 1000);
/** `x` nudged by up to ±`amount` (a fraction), so repeats never match. */
const jitter = (x: number, amount = 0.08) => x * (1 + (Math.random() * 2 - 1) * amount);
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const dB = (db: number) => Math.pow(10, db / 20);
/** A level nudged by up to ±2 dB. */
const vary = (level: number) => level * dB(between(-2, 2));

/** The output for one cue, or null when sound is off or not yet allowed. */
function out(at: number, level: number, pan = 0): { ctx: AudioContext; gain: GainNode; t: number } | null {
  if (!ctx || !settings.sound || settings.volume <= 0 || ctx.state !== 'running') return null;
  const gain = ctx.createGain();
  gain.gain.value = level * settings.volume;
  if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner).connect(ctx.destination);
  } else {
    gain.connect(ctx.destination);
  }
  return { ctx, gain, t: ctx.currentTime + Math.max(0, at) };
}

interface Filter {
  type: BiquadFilterType;
  freq: number;
  /** Glide the frequency here over the length of the sound. */
  to?: number;
  q?: number;
}

/** One noise voice: pink noise through `filters`, shaped by an attack and an exponential decay. */
function burst(
  at: number,
  filters: Filter[],
  { attack = 0.004, decay = 0.06, level = 0.5, pan = 0, flutter = null as { rate: number; depth: number } | null } = {},
) {
  const o = out(at, level, pan);
  if (!o || !noise) return;
  const end = o.t + attack + decay;
  const src = o.ctx.createBufferSource();
  src.buffer = noise;
  let node: AudioNode = src;
  for (const f of filters) {
    const filter = o.ctx.createBiquadFilter();
    filter.type = f.type;
    filter.frequency.setValueAtTime(f.freq, o.t);
    if (f.to) filter.frequency.exponentialRampToValueAtTime(f.to, end);
    if (f.q !== undefined) filter.Q.value = f.q;
    node = node.connect(filter);
  }
  const env = o.ctx.createGain();
  env.gain.setValueAtTime(0, o.t);
  env.gain.linearRampToValueAtTime(1, o.t + attack);
  env.gain.exponentialRampToValueAtTime(0.001, end);
  node = node.connect(env);
  if (flutter) {
    // Amplitude wobble: the gain swings between 1 − depth and 1.
    const wobble = o.ctx.createGain();
    wobble.gain.value = 1 - flutter.depth / 2;
    const lfo = o.ctx.createOscillator();
    lfo.frequency.value = flutter.rate;
    const depth = o.ctx.createGain();
    depth.gain.value = flutter.depth / 2;
    lfo.connect(depth).connect(wobble.gain);
    lfo.start(o.t);
    lfo.stop(end + 0.02);
    node = node.connect(wobble);
  }
  node.connect(o.gain);
  // Start somewhere in the one-second buffer that leaves room to finish.
  src.start(o.t, Math.random() * Math.max(0, 0.98 - attack - decay), attack + decay + 0.02);
}

/** A short band of noise: paper on felt. */
function snap(at: number, { freq = 2400, length = 0.06, level = 0.5, pan = 0 } = {}) {
  const f = jitter(freq);
  burst(at, [{ type: 'bandpass', freq: f, q: 0.9 }], { decay: length, level: vary(level) * lift(f), pan });
}

/** A soft plucked tone. */
function note(at: number, freq: number, { length = 0.35, level = 0.18, type = 'triangle' as OscillatorType } = {}) {
  const o = out(at, level);
  if (!o) return;
  const osc = o.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq * transpose;
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
  /**
   * A card lands on the trick: the bright slap of its face, the soft thud of
   * the air under it and, when `onTop` (a card already lies there), the tick
   * of its edge on the other card.
   */
  card(delay = 0, onTop = false) {
    const level = vary(0.5);
    const slap = jitter(between(3200, 4500));
    burst(
      delay,
      [
        { type: 'highpass', freq: jitter(1200) },
        { type: 'bandpass', freq: slap, q: 1.2 },
      ],
      { attack: 0.001, decay: between(0.025, 0.04), level: level * lift(slap) },
    );
    burst(delay + between(-0.01, 0.01), [{ type: 'lowpass', freq: jitter(between(500, 700)) }], {
      attack: 0.003,
      decay: between(0.07, 0.09),
      level: level * dB(-12),
    });
    if (onTop) {
      const edge = jitter(5500);
      burst(delay + between(0.008, 0.014), [{ type: 'bandpass', freq: edge, q: 3 }], {
        attack: 0.001,
        decay: 0.01,
        level: level * dB(-9) * lift(edge),
      });
    }
  },
  /** A trick slides to its winner, with a rising note per point card in it. */
  sweep(points: number, delay = 0, pan = 0) {
    // Cards dragged over felt: a falling band of noise with a fast flutter.
    burst(delay, [{ type: 'bandpass', freq: jitter(1800), to: jitter(700), q: 0.7 }], {
      attack: 0.02,
      decay: between(0.18, 0.24),
      level: vary(0.35) * lift(1100),
      pan,
      flutter: { rate: 32, depth: 0.25 },
    });
    for (let i = 0; i < points; i++) note(delay + 0.08 + i * 0.07, SCALE[Math.min(i, SCALE.length - 1)]);
  },
  /** It is now your turn. */
  turn() {
    note(0, 659, { level: 0.12, length: 0.25 });
    note(0.11, 880, { level: 0.12, length: 0.4 });
  },
  /** A bid or a pass. Each raise in a bidding war sounds a step higher. */
  bid(raise = 0) {
    snap(0, { freq: 3200, length: 0.03, level: 0.3 });
    if (raise > 0) note(0.01, SCALE[Math.min(raise - 1, SCALE.length - 1)] / 2, { level: 0.08, length: 0.22 });
  },
  /** A heavy card lands: the 마이티, a joker or a trump cutting the round. */
  heavy(delay = 0) {
    snap(delay, { freq: 700, length: 0.12, level: 0.55 });
    note(delay, 110, { level: 0.22, length: 0.25, type: 'sine' });
  },
  /** A big moment at a seat; each kind has its own short motif. */
  cue(kind: 'declarer' | 'friend' | 'mighty' | 'joker' | 'call' | 'misdeal' | 'answer') {
    const motifs: Record<typeof kind, number[]> = {
      declarer: [440, 554, 659],
      // Two notes a fifth apart: the friend, then the 주공 answers.
      friend: [659],
      answer: [988],
      mighty: [330, 659],
      joker: [494, 523],
      call: [659, 494],
      misdeal: [392, 370],
    };
    motifs[kind].forEach((f, i) => note(i * 0.07, f, { level: 0.12, length: 0.5, type: 'sine' }));
  },
  /** 런: the scale climbs to the octave. */
  run() {
    [440, 494, 554, 659, 740, 880].forEach((f, i) => note(i * 0.07, f, { level: 0.12, length: 0.6, type: 'sine' }));
  },
  /** The contract is reached: a resolving chord. */
  resolve() {
    [440, 554, 659].forEach((f) => note(0, f, { level: 0.08, length: 0.9, type: 'sine' }));
  },
  /** An achievement is earned: a bright little rising figure. */
  achieve() {
    [659, 880, 1109, 1319].forEach((f, i) => note(i * 0.06, f, { level: 0.1, length: 0.5, type: 'sine' }));
  },
  /** A quiet label appears: 공약 확정, 런 찬스, 마지막 라운드. */
  tag() {
    note(0, 988, { level: 0.06, length: 0.3, type: 'sine' });
  },
  /** One step of the result being counted. */
  tally(step: number) {
    note(0, SCALE[Math.min(step, SCALE.length - 1)], { level: 0.09, length: 0.18 });
  },
  /** The friend is revealed. */
  friend() {
    [554, 659, 880, 1109].forEach((f, i) => note(i * 0.07, f, { level: 0.16, length: 0.5 }));
  },
  /** Cards being dealt: one quick flick per card, a little apart. */
  shuffle() {
    let t = 0;
    for (let i = 0; i < 14; i++) {
      burst(t, [{ type: 'highpass', freq: jitter(2500) }], { attack: 0.001, decay: 0.011, level: vary(0.3) * lift(4000) });
      t += between(0.04, 0.055);
    }
  },
  /** A chip or button pressed. */
  tap() {
    snap(0, { freq: 4200, length: 0.02, level: 0.18 });
  },
  /** A card raised from the hand. */
  raise() {
    snap(0, { freq: 2600, length: 0.035, level: 0.2 });
    note(0, 1319, { level: 0.04, length: 0.12, type: 'sine' });
  },
  /** The contract is settled: two firm notes. */
  contract() {
    note(0, 440, { level: 0.14, length: 0.35 });
    note(0.12, 659, { level: 0.14, length: 0.5 });
  },
  /** The friend has been called: a short rising question. */
  call() {
    [659, 740, 988].forEach((f, i) => note(i * 0.06, f, { level: 0.1, length: 0.3 }));
  },
  /** Someone at the table reacted. */
  react() {
    note(0, 988, { level: 0.06, length: 0.18, type: 'sine' });
    note(0.06, 1319, { level: 0.05, length: 0.22, type: 'sine' });
  },
  /** Something was refused. */
  error() {
    note(0, 196, { level: 0.12, length: 0.18, type: 'square' });
  },
  /** The hand is over. */
  result(won: boolean) {
    const notes = won ? [440, 554, 659, 880] : [659, 554, 494, 440];
    notes.forEach((f, i) => note(i * 0.12, f, { level: 0.14, length: 0.6, type: 'sine' }));
  },
};
