import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FeedbackDock from './FeedbackDock.svelte';

describe('independent reaction and game feedback', () => {
  it('keeps a game cue and bid visible during a reaction', () => {
    const { body } = render(FeedbackDock, { props: {
      reaction: { text: '👏', id: 1 }, cue: { text: '마이티', id: 2 }, bid: '15',
    } });
    expect(body).toContain('👏');
    expect(body).toContain('마이티');
    expect(body).toContain('data-kind="bid"');
    expect(body).toContain('data-kind="event"');
    expect(body).toContain('aria-live="polite"');
    expect(body).toContain('data-engine-layout="feedback"');
  });

  it('keeps score credit visible during a reaction without duplicating it under a cue', () => {
    const props = { reaction: { text: '나이스', id: 1 }, credit: { n: 2, id: 2 } };
    expect(render(FeedbackDock, { props }).body).toContain('+2점');
    const withCue = render(FeedbackDock, { props: { ...props, cue: { text: '조커', id: 3 } } }).body;
    expect(withCue).toContain('나이스');
    expect(withCue).toContain('조커');
    expect(withCue).not.toContain('+2점');
  });
});
