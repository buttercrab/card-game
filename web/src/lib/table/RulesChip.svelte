<script lang="ts">
  // The rules this table plays, by name, on an outline pill: a tap opens
  // them. Drawn small, in a 44px target.
  let { name, onclick }: { name: string; onclick?: () => void } = $props();
</script>

<button class="rules-chip" {onclick}><span>{name}</span></button>

<style>
  .rules-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-height: 44px;
    margin-block: -6px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 600;
  }
  span {
    min-width: 0;
    padding: 4px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--r-pill);
    box-shadow: inset 0 0 0 1.5px var(--line);
    line-height: 24px;
  }
</style>
