<script lang="ts">
  // Your tools at the table, drawn once and placed by the table's layout:
  // the hint (what a bot would do in your place, on your turn) and the
  // reactions. The hint's answer hangs from its button until the hand
  // moves on, or until dismissed.
  import Icon from '../Icon.svelte';
  import Reactions from '../Reactions.svelte';
  import SuitText from '../SuitText.svelte';
  import Button from '../ui/Button.svelte';
  import Popover from '../ui/Popover.svelte';

  let {
    hint,
    canHint,
    onhint,
    onreact,
  }: {
    /** What a bot would do now, in words, once asked. */
    hint: string | null;
    /** The hint button shows: hints are on and it is your turn. */
    canHint: boolean;
    onhint: () => void;
    onreact: (text: string) => void;
  } = $props();

  let button = $state<HTMLButtonElement>();
  /** The answer that was dismissed, so it stays closed. */
  let dismissed = $state<string | null>(null);
  $effect(() => {
    if (!hint) dismissed = null;
  });
</script>

<div class="tools">
  {#if canHint || hint}
    <Button variant="icon" raised aria-label="봇이라면 뭘 할지 보기" aria-expanded={!!hint} bind:element={button} onclick={() => (hint ? (dismissed = null) : onhint())}>
      <Icon name="hint" />
    </Button>
  {/if}
  <Reactions {onreact} />
</div>
{#if hint && button && dismissed !== hint}
  <Popover
    anchor={() => button!.getBoundingClientRect()}
    trigger={button}
    side="above"
    align="end"
    role="status"
    autofocus={() => null}
    onclose={() => (dismissed = hint)}
  >
    <p class="hint"><Icon name="hint" /> 봇이라면 <strong><SuitText text={hint} /></strong></p>
  </Popover>
{/if}

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hint {
    margin: 0 4px;
    font-size: 14px;
    white-space: nowrap;
  }
</style>
