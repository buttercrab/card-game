<script lang="ts" generics="A">
  import { onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import DecisionRegion from './DecisionRegion.svelte';
  import DecisionChoice from './DecisionChoice.svelte';
  import DecisionCommand from './DecisionCommand.svelte';
  import type { DecisionController, DecisionHandle } from './decision';
  import { eachFrame, share } from '../frame';

  let { decision, controller, caption, submitDelayMs = 0, waitingLabel }: {
    decision: DecisionHandle<A>; controller: DecisionController<A>; caption?: string;
    /** Semantic grace period, not a geometry or animation override. */
    submitDelayMs?: number; waitingLabel?: string;
  } = $props();
  let entering = $state(true);
  let held = $state(false);
  let waited = $state(1);
  let refresh = $state(0);
  const changed = () => { refresh++; };
  function invalidate() {
    if (controller.invalidateGestures(decision)) changed();
  }
  onMount(() => {
    const timer = setTimeout(() => { entering = false; }, 400);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    const duration = Number.isFinite(submitDelayMs) ? Math.max(0, submitDelayMs) : 0;
    held = duration > 0;
    waited = duration > 0 ? 0 : 1;
    if (!duration) return;
    const until = performance.now() + duration;
    const timer = setTimeout(() => { held = false; }, duration);
    const stop = eachFrame(now => { const done = 1 - share(until, duration, now); waited = done; return done < 1; });
    return () => { clearTimeout(timer); stop(); };
  });
  // The controller is deliberately nonreactive. Read a fresh immutable view
  // after each engine intent; apply guards before exposing or capturing targets.
  const view = $derived.by(() => {
    void refresh;
    controller.setGuards(decision, { commands: entering, submit: entering || held });
    return controller.snapshot(decision);
  });
  const submit = $derived(view?.spec.kind === 'finite-choice' ? view.spec.submit : null);
  const submitLabel = $derived(view?.selected ? `${submit?.presentationLabel ? `${submit.presentationLabel.prefix} ` : ''}${view.selected.label}` : undefined);
</script>

<svelte:window onresize={invalidate} />
<svelte:document onscrollcapture={invalidate} />

<!-- This recipe, including all spacing and scroll clearance, belongs to the
     engine. Games provide semantic descriptors, never DecisionRegion props. -->
<DecisionRegion class="bid engine-decision" mode="bid" gap={8} ongeometrychange={invalidate}>
  {#if !view || view.errors.length}
    <p class="caption" role="alert">선택지를 표시할 수 없어요. 새 상태를 기다려주세요.</p>
  {:else}
    {#if held && waitingLabel}<p class="caption">{waitingLabel}</p>
    {:else if caption}<p class="caption">{caption}</p>{/if}
    {#key decision}
      {#if view.fields.length}
        <DecisionRegion class="picks" mode="row" scroll fade gap={6}>
          {#each view.fields as field (field.id)}
            <DecisionRegion class="chips" mode="row" role="radiogroup" label={field.label} gap={6}>
              {#each field.options as option (option.id)}
                <DecisionChoice {controller} {decision} field={field.id} {option} revision={view.draftRevision}
                  checked={view.values?.[field.id] === option.id}
                  tabIndex={view.values?.[field.id] === option.id || !view.values && field.options.find(o => o.available)?.id === option.id ? 0 : -1}
                  onrefresh={changed} />
              {/each}
            </DecisionRegion>
          {/each}
        </DecisionRegion>
      {/if}
      <DecisionRegion class="actions" mode="actions" gap={8} align="center">
        {#each view.commands as command (command.id)}
          <DecisionCommand {controller} {decision} {command} revision={view.draftRevision} {refresh}
            blocked={view.guards.commands} onrefresh={changed} />
        {/each}
        {#if view.selected}
          {#key view.selected.id}
            <DecisionCommand {controller} {decision} command={view.selected} revision={view.draftRevision} {refresh}
              blocked={view.guards.submit} label={submitLabel} progress={held ? waited : undefined} onrefresh={changed} />
          {/key}
        {:else if submit?.unavailable === 'disabled'}
          <Button disabled>{submit.presentationLabel?.prefix ?? '선택 불가'}</Button>
        {/if}
      </DecisionRegion>
    {/key}
  {/if}
</DecisionRegion>

<style>
  .caption { margin:0; text-align:center; font-size:var(--text-label); color:var(--ink-muted); }
</style>
