<script lang="ts">
  import Rulebook from './Rulebook.svelte';

  let { preset, onclose }: { preset: string; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog bind:this={dialog} onclose={onclose} aria-label="규칙">
  <div class="body">
    <Rulebook {preset} />
  </div>
  <form method="dialog">
    <button class="primary">닫기</button>
  </form>
</dialog>

<style>
  dialog {
    width: min(100% - 32px, 560px);
    max-height: min(100% - 32px, 860px);
    padding: 0;
    border: none;
    border-radius: 16px;
    background: var(--bg);
    color: var(--ink);
    overflow: hidden;
  }
  dialog[open] {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
  }
  dialog::backdrop {
    background: rgb(23 25 28 / 0.4);
  }
  .body {
    overflow-y: auto;
    padding: 20px;
    scrollbar-width: thin;
  }
  form {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--line);
  }
  form .primary {
    min-width: 120px;
  }
</style>
