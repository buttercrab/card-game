<script lang="ts" generics="A">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import Button from '../ui/Button.svelte';
  import { commandSpecs, resolveCommand, type ActionOffer } from './presentation';

  let { offer, actionId, onaction, blocked = false, label, children, progress }: {
    offer: ActionOffer<A>;
    actionId: string | null;
    onaction: (action: A, offerId: string) => void;
    blocked?: boolean;
    label?: string;
    children?: Snippet;
    progress?: number;
  } = $props();
  const matches = $derived(commandSpecs(offer).filter(spec=>spec.id === actionId));
  const spec = $derived(matches.length === 1 ? matches[0] : null);
  const key = $derived(JSON.stringify([offer.id,actionId,blocked]));
  const uid = $props.id();
  const reasonId = `${uid}-reason`;
  let generation = $state(0);
  let element = $state<HTMLButtonElement>();
  type Target = {offerId:string;actionId:string|null;key:string;generation:number};
  const targets = new WeakMap<HTMLButtonElement,Target>();
  let active = true;
  onDestroy(() => { active = false; gesture = null; });
  let lastKey: string | null = null;
  let gesture: Target | null = null;
  $effect.pre(() => {
    if (lastKey !== key) { lastKey = key; untrack(() => generation++); gesture = null; }
  });
  $effect(() => {
    const node = element;
    if (node && !targets.has(node)) targets.set(node,untrack(() => ({offerId:offer.id,actionId,key,generation})));
  });
  function capture(node: HTMLButtonElement) { if (active) gesture = targets.get(node) ?? null; }
  function submit(node: HTMLButtonElement) {
    const target = targets.get(node);
    if (!target) return;
    const {offerId:expectedOfferId,actionId:expectedActionId,key:expectedKey,generation:expectedGeneration} = target;
    const press = gesture;
    gesture = null;
    if (!active || blocked || !expectedActionId || expectedKey !== key || expectedGeneration !== generation ||
      press && (press.offerId !== expectedOfferId || press.actionId !== expectedActionId || press.key !== expectedKey || press.generation !== expectedGeneration)) return;
    const resolved = resolveCommand(offer,expectedOfferId,expectedActionId);
    if (resolved.ok) onaction(resolved.action,expectedOfferId);
  }
  const percent = $derived(progress !== undefined && Number.isFinite(progress) ? Math.max(0,Math.min(1,progress)) * 100 : null);
</script>

{#key key}
  <Button bind:element class="command-button" variant={spec?.intent === 'quiet' ? 'ghost' : spec?.intent ?? 'secondary'}
    disabled={!spec?.enabled || blocked} aria-label={label ?? spec?.label}
    title={spec?.reason} aria-describedby={spec?.reason ? reasonId : undefined} onpointerdown={(event) => capture(event.currentTarget)} onpointercancel={() => (gesture = null)}
    onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') capture(event.currentTarget); }}
    onclick={(event) => submit(event.currentTarget)}>
    {#if children}{@render children()}{:else}{label ?? spec?.label ?? '선택 불가'}{/if}
    {#if spec?.reason}<span class="sr-only" id={reasonId}>{spec.reason}</span>{/if}
    {#if percent !== null}<span class="command-progress" style:--progress={`${percent}%`} aria-hidden="true"></span>{/if}
  </Button>
{/key}

<style>
  :global(button.command-button) { position:relative; }
  .command-progress { position:absolute; inset:auto 0 0; height:var(--space-1); width:var(--progress); background:currentColor; opacity:.25; border-radius:inherit; pointer-events:none; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
</style>
