<script lang="ts">
  import ConnectedRoom from '../../table/foundation/ConnectedRoom.svelte';
  import {mightyConnectedGame} from './connected';
</script>
<ConnectedRoom adapter={mightyConnectedGame}/>
