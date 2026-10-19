<script lang="ts">
  import { FIXED } from '../tokens';
  // The room's neutral identity figure: no game role or private state.
  let { bot = false, offline = false }: { bot?: boolean; offline?: boolean } = $props();
</script>
<svg viewBox="0 0 120 110" aria-hidden="true"><path d="M20 110 Q22 76 60 72 Q98 76 100 110 Z" fill="var(--ink-muted)"/><circle cx="60" cy="48" r="20" fill={FIXED.skin} stroke={FIXED['figure-eye']} stroke-width="3"/>{#if bot}<path d="M39 41 Q40 25 60 25 Q78 25 88 38 Q94 46 97 56 Q86 47 80 41 Z" fill="var(--ink)"/><path d="M40 41 Q60 35 80 41" stroke="var(--ink-muted)" stroke-width="4" fill="none"/><circle cx="97" cy="57" r="4.5" fill="var(--ink-muted)"/>{/if}{#if offline}<path d="M49 49 H57 M63 49 H71" stroke={FIXED['figure-eye']} stroke-width="3" stroke-linecap="round"/>{:else}<circle cx="53" cy="49" r="3" fill={FIXED['figure-eye']}/><circle cx="67" cy="49" r="3" fill={FIXED['figure-eye']}/>{/if}</svg>
<style>svg { display:block;width:100%;height:auto;overflow:visible; }</style>
