<script lang="ts">
  import Rulebook from './Rulebook.svelte';
  import type { Rules } from './types';

  let { preset, rules = null, onclose }: { preset: string; rules?: Rules | null; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog class="sheet rulebook" bind:this={dialog} onclose={onclose} aria-label="규칙">
  <div class="sheet-body">
    <Rulebook {preset} {rules} />
  </div>
  <form method="dialog" class="sheet-foot">
    <button>닫기</button>
  </form>
</dialog>

<style>
  .rulebook {
    width: min(100% - 32px, 560px);
    max-height: min(100dvh - 32px, 860px);
  }
</style>
