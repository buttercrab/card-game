<script lang="ts" generics="A">
  import { onDestroy } from 'svelte';
  import Button from '../ui/Button.svelte';
  import SuitText from '../SuitText.svelte';
  import type { CommandSpec } from './presentation';
  import type { DecisionController, DecisionHandle, DecisionToken } from './decision';

  let { controller, decision, command, revision, refresh, blocked, label, progress, onrefresh }: {
    controller: DecisionController<A>; decision: DecisionHandle<A>; command: CommandSpec<A>;
    revision: number; refresh: number; blocked: boolean; label?: string; progress?: number; onrefresh: () => void;
  } = $props();
  let active = true;
  let press: DecisionToken | null | undefined;
  const token = $derived.by(() => {
    void revision; void refresh;
    return blocked ? null : controller.capture(decision, command.id);
  });
  onDestroy(() => { active = false; press = null; });
  function activate() {
    const captured = press === undefined ? token : press;
    press = undefined;
    if (active && captured && captured === token && controller.dispatch(captured)) onrefresh();
  }
  const percent = $derived(progress === undefined ? null : Math.max(0, Math.min(1, progress)) * 100);
  const reasonId = $props.id();
</script>

<Button class="command-button" variant={command.intent === 'quiet' ? 'ghost' : command.intent}
  disabled={blocked || !command.enabled} title={command.reason} aria-describedby={command.reason ? reasonId : undefined}
  onpointerdown={() => { press = token; }} onpointercancel={() => { press = null; }}
  onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') press = event.repeat ? null : token; }}
  onblur={() => { if (press !== undefined) press = null; }} onclick={activate}>
  <SuitText text={label ?? command.label} />
  {#if command.reason}<span class="sr-only" id={reasonId}>{command.reason}</span>{/if}
  {#if percent !== null}<span class="command-progress" style:width={`${percent}%`} aria-hidden="true"></span>{/if}
</Button>

<style>
  :global(button.command-button) { position:relative; }
  .command-progress { position:absolute; inset:auto 0 0; height:var(--space-1); background:currentColor; opacity:.25; border-radius:inherit; pointer-events:none; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
</style>
