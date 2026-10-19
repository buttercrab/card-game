<script lang="ts">
  import ConnectedRoom from '../../table/foundation/ConnectedRoom.svelte';
  import {pokerConnectedGame} from './connected';
</script>
<ConnectedRoom adapter={pokerConnectedGame}/>
