<script lang="ts" generics="A">
  import { onDestroy } from 'svelte';
  import Chip from '../ui/Chip.svelte';
  import SuitText from '../SuitText.svelte';
  import type { AvailableOption, DecisionController, DecisionHandle } from './decision';

  let { controller, decision, field, option, checked, revision, tabIndex, onrefresh }: {
    controller: DecisionController<A>; decision: DecisionHandle<A>; field: string;
    option: AvailableOption; checked: boolean; revision: number; tabIndex: number; onrefresh: () => void;
  } = $props();
  let active = true;
  let press: number | null | undefined;
  onDestroy(() => { active = false; press = null; });
  function activate() {
    const expected = press === undefined ? revision : press;
    press = undefined;
    if (active && expected !== null && controller.choose(decision, field, option.id, expected)) onrefresh();
  }
  function navigate(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const button = event.currentTarget as HTMLButtonElement;
    const choices = [...button.closest('[role="radiogroup"]')!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!choices.length) return;
    event.preventDefault();
    const current = choices.indexOf(button);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
      : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    if (controller.choose(decision, field, choices[index].dataset.decisionOption!, revision)) {
      onrefresh(); choices[index].focus();
    }
  }
</script>

<Chip {checked} disabled={!option.available} tabindex={tabIndex} title={option.reason} data-decision-option={option.id}
  onpointerdown={() => { press = revision; }} onpointercancel={() => { press = null; }}
  onkeydown={(event) => { navigate(event); if (event.key === 'Enter' || event.key === ' ') press = event.repeat ? null : revision; }}
  onblur={() => { if (press !== undefined) press = null; }} onclick={activate}>
  <SuitText text={option.label} />
</Chip>
