<script lang="ts">
 import EngineFlow from './EngineFlow.svelte';
 import type {ComponentProps} from 'svelte';
 let props:ComponentProps<typeof EngineFlow>=$props();
</script>
<EngineFlow {...props}/>
