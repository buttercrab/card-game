import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { settings } = vi.hoisted(() => ({
  settings: { sound: false, volume: 0.7, music: false, musicVolume: 0.5 },
}));
vi.mock('./settings.svelte', () => ({ settings }));

let gestures: EventTarget;
let context: { state: string; sampleRate: number; resume: ReturnType<typeof vi.fn>; createBuffer: ReturnType<typeof vi.fn> };
let construct: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  Object.assign(settings, { sound: false, volume: 0.7, music: false, musicVolume: 0.5 });
  gestures = new EventTarget();
  context = {
    state: 'suspended',
    sampleRate: 16,
    resume: vi.fn(() => { context.state = 'running'; return Promise.resolve(); }),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
  };
  construct = vi.fn(function () { return context; });
  vi.stubGlobal('window', gestures);
  vi.stubGlobal('AudioContext', construct);
});

afterEach(() => { vi.unstubAllGlobals(); });

function gesture(type = 'pointerdown') {
  gestures.dispatchEvent(new Event(type));
}

describe('audio initialization follows audible preferences', () => {
  it('does no Web Audio work for muted gestures, then initializes once after sound is enabled', async () => {
    const { withAudio } = await import('./sound');
    const unlocked = vi.fn();
    withAudio(unlocked);
    gesture(); gesture('keydown');
    expect(construct).not.toHaveBeenCalled();
    expect(context.createBuffer).not.toHaveBeenCalled();
    expect(unlocked).not.toHaveBeenCalled();

    settings.sound = true;
    gesture(); gesture('keydown');
    expect(construct).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(unlocked).toHaveBeenCalledTimes(2);
    expect(unlocked).toHaveBeenLastCalledWith(context);
  });

  it('treats both enabled channels at zero volume as muted', async () => {
    Object.assign(settings, { sound: true, volume: 0, music: true, musicVolume: 0 });
    await import('./sound');
    gesture(); gesture('keydown');
    expect(construct).not.toHaveBeenCalled();
    expect(context.createBuffer).not.toHaveBeenCalled();

    settings.volume = 0.2;
    gesture();
    expect(construct).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce();
  });

  it('unlocks music without generating cue noise and adds that buffer when sound is later enabled', async () => {
    settings.music = true;
    const { withAudio } = await import('./sound');
    const unlocked = vi.fn();
    withAudio(unlocked);
    gesture();
    expect(construct).toHaveBeenCalledOnce();
    expect(context.createBuffer).not.toHaveBeenCalled();
    expect(unlocked).toHaveBeenCalledWith(context);

    settings.sound = true;
    gesture(); gesture();
    expect(construct).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce();
  });

  it('preserves existing-context callbacks and resume behavior after muting', async () => {
    settings.sound = true;
    const { withAudio } = await import('./sound');
    gesture();
    settings.sound = false;
    context.state = 'suspended';
    const unlocked = vi.fn();
    withAudio(unlocked);
    expect(unlocked).toHaveBeenCalledWith(context);
    gesture();
    expect(construct).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(unlocked).toHaveBeenCalledTimes(2);
  });

  it('retries construction on a later audible gesture if the browser rejects startup', async () => {
    settings.sound = true;
    construct.mockImplementationOnce(() => { throw new Error('Audio unavailable'); });
    await import('./sound');
    gesture();
    expect(context.createBuffer).not.toHaveBeenCalled();
    gesture();
    expect(construct).toHaveBeenCalledTimes(2);
    expect(context.createBuffer).toHaveBeenCalledOnce();
  });
});
