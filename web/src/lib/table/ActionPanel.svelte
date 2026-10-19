<script lang="ts" generics="A">
  import DecisionRegion from './DecisionRegion.svelte';
  import EngineFlow from './EngineFlow.svelte';
  import { onDestroy, untrack } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Chip from '../ui/Chip.svelte';
  import SuitText from '../SuitText.svelte';
  import CommandButton from './CommandButton.svelte';
  import { resolveAction, validateAction, type ActionOffer, type ActionSpec } from './presentation';

  let { offer, onaction, label = '선택 가능한 행동', selection = false }: {
    offer: ActionOffer<A>;
    onaction: (action: A) => void;
    label?: string;
    selection?: boolean;
  } = $props();
  const prefix = $props.id();
  let draftOffer = $state('');
  let drafts = $state<Record<string, string>>({});
  let notice = $state('');
  let generation = $state(0);
  let active = true;
  onDestroy(() => { active = false; });
  let lastOfferId: string | null = null;
  $effect.pre(() => {
    if (lastOfferId !== offer.id) { lastOfferId = offer.id; untrack(() => generation++); }
  });
  $effect(() => {
    if (draftOffer === offer.id) return;
    draftOffer = offer.id;
    drafts = Object.fromEntries(offer.actions.filter(a => a.kind === 'number').map(a => [a.id, String(a.initial)]));
    notice = '';
  });

  function draft(action: Extract<ActionSpec<A>, { kind: 'number' }>): string {
    return draftOffer === offer.id ? drafts[action.id] ?? String(action.initial) : String(action.initial);
  }
  function value(action: Extract<ActionSpec<A>, { kind: 'number' }>): number {
    const text = draft(action).trim();
    // Missing numeric input is invalid, never an implicit initial amount.
    return text === '' ? NaN : Number(text);
  }
  function submit(expectedOfferId: string, expectedGeneration: number, actionId: string, amount?: number) {
    if (!active || expectedGeneration !== generation) return;
    const resolved = resolveAction(offer, expectedOfferId, actionId, amount);
    if (!resolved.ok) { notice = resolved.reason; return; }
    notice = '';
    onaction(resolved.action);
  }
  const variant = (intent: ActionSpec<A>['intent']) => intent === 'quiet' ? 'ghost' : intent;
</script>

<section class="action-panel" aria-label={label}><DecisionRegion mode="stack" gap={8}>
  {#key offer.id}
    <DecisionRegion class="offers" mode="flow" gap={8}>
      {#each offer.actions as action (action.id)}
        {@const expectedOfferId = untrack(() => offer.id)}
        {@const expectedGeneration = untrack(() => generation)}
        {@const fieldId = `${prefix}-${action.id}`}
        {#if action.kind === 'command'}
          <DecisionRegion class="command" mode="stack" gap={4}>
            {#if selection}<Chip disabled={!action.enabled} aria-describedby={action.reason ? `${fieldId}-reason` : undefined} onclick={() => submit(expectedOfferId, expectedGeneration, action.id)}><SuitText text={action.label} /></Chip>
            {:else}<CommandButton {offer} actionId={action.id} {onaction}><SuitText text={action.label} /></CommandButton>{/if}
            {#if action.reason}<small id={`${fieldId}-reason`}>{action.reason}</small>{/if}
          </DecisionRegion>
        {:else}
          {@const validation = validateAction(offer, expectedOfferId, action.id, value(action))}
          <form class="numeric" style:width="240px" data-action={action.id} novalidate onsubmit={(event) => { event.preventDefault(); submit(expectedOfferId, expectedGeneration, action.id, value(action)); }}><DecisionRegion mode="stack" gap={4}>
            <label for={fieldId}>{action.inputLabel ?? `${action.label} 값`}</label>
            <EngineFlow fill items={[{id:'input',width:'fill',minWidth:80},{id:'submit'}]} gap={8}>{#snippet children(part)}{#if part==='input'}
              <input id={fieldId} type="number" inputmode={Number.isInteger(action.step) ? 'numeric' : 'decimal'} min={action.min} max={action.max} step={action.step} value={draft(action)} disabled={!action.enabled} aria-describedby={`${fieldId}-hint`} aria-invalid={action.enabled && !validation.ok ? 'true' : undefined} oninput={(event) => { if (active && offer.id === expectedOfferId && generation === expectedGeneration) { drafts[action.id] = event.currentTarget.value; notice = ''; } }} />
              {:else}<Button type="submit" variant={variant(action.intent)} disabled={!validation.ok}>{action.label}</Button>
            {/if}{/snippet}</EngineFlow>
            <small id={`${fieldId}-hint`}>{action.reason ?? `${action.min}–${action.max} · ${action.step} 단위`}{#if action.enabled && !validation.ok}<span> · {validation.reason}</span>{/if}</small>
          </DecisionRegion></form>
        {/if}
      {/each}
    </DecisionRegion>
  {/key}
  {#if notice}<p role="status">{notice}</p>{/if}
</DecisionRegion></section>

<style>
  .action-panel { min-width:0; }
  .numeric { margin:0; }
  input { min-width:0; width:100%; }
  small { display:block; color:var(--ink-muted); }
  p { margin:0; }
</style>
