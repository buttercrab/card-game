<script lang="ts">
  /** Paint only: allocation and input belong to the containing control. */
  let {checked=false}:{checked?:boolean}=$props();
</script>
<svg class="switch-track" class:checked width="42" height="26" viewBox="0 0 42 26" aria-hidden="true">
  <rect class="track" x="0.75" y="0.75" width="40.5" height="24.5" rx="12.25"/>
  <circle class="knob" cx="13" cy="13" r="9"/>
</svg>
<style>
  .switch-track{display:block;flex:none;overflow:visible;pointer-events:none}
  .track{fill:var(--off);stroke:var(--ink-muted);stroke-width:1.5;transition:fill var(--dur-quick) var(--ease-standard)}
  .knob{fill:var(--ink-muted);transition:transform var(--dur-quick) var(--ease-standard)}
  .checked .track{fill:var(--ink);stroke:var(--ink)}
  .checked .knob{fill:var(--table);transform:translateX(16px)}
</style>
