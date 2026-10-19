<script lang="ts" generics="G extends GameTypes">
  import SeatMenu from './SeatMenu.svelte';
  import type { TableSession } from './TableSession.svelte';
  import type { GameTypes, RoomViewOf } from './types';
  let { session, room, anchor, oninvite }: {
    session: TableSession<G>;
    room: RoomViewOf<G>;
    anchor: (seat:number) => DOMRect;
    oninvite?: () => void;
  } = $props();
  const seat = $derived(session.ui.seatMenu);
</script>

{#if seat !== null && room.seats[seat]}
  <SeatMenu {seat} info={room.seats[seat]} me={session.client.seat}
    anchor={() => anchor(seat)} bind:name={session.sitName} bind:kicking={session.ui.kicking}
    onclose={() => session.ui.closeSeat()}
    onlevel={(level) => session.addBot(seat,level)}
    onswap={() => session.swap(seat)} onmovehere={() => session.moveHere(seat)}
    onclearbot={() => session.removeBot(seat)} onkick={() => session.kick(seat)}
    onrelieve={() => session.relieve(seat)} onstand={() => session.stand()}
    onsit={(name) => { session.sitName=name; session.withName(() => session.sitAt(seat)); session.ui.closeSeat(); }}
    oninvite={() => { oninvite?.(); session.ui.closeSeat(); }} />
{/if}
