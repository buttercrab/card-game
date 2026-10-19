<script lang="ts">
  import { onDestroy } from 'svelte';
  import DecisionPanel from '../../table/DecisionPanel.svelte';
  import { DecisionController } from '../../table/decision';
  import type { ActionOffer } from '../../table/presentation';
  import { biddingDecision } from './bidding';
  import type { Action } from './types';

  let { offer, lastChance = null, wait = 0, onact }: {
    offer: ActionOffer<Action>;
    lastChance?: number | null;
    /** Server deal grace; the engine manages its local presentation timer. */
    wait?: number;
    onact: (action: Action, offerId: string) => void;
  } = $props();
  const interactions = new DecisionController<Action>((action, offerId) => onact(action, offerId));
  const spec = $derived(biddingDecision(offer));
  // The current protocol supplies an offer revision, not a durable authority epoch.
  const decision = $derived(interactions.bind(spec, offer, offer.id));
  const caption = $derived(lastChance === null ? undefined : `모두 패스했어요 · 딜러가 한 번 더 (${lastChance}부터)`);
  onDestroy(() => interactions.dispose());
</script>

<DecisionPanel {decision} controller={interactions} {caption} submitDelayMs={wait}
  waitingLabel="딜미스할 사람이 있는지 잠깐 기다려요" />
