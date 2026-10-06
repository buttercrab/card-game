<script lang="ts" module>
  import type { ComponentProps } from 'svelte';
  import type Seat from '../Seat.svelte';

  /** What a seat round the felt shows (Seat's own props, but its place). */
  export type SeatView = Omit<ComponentProps<typeof Seat>, 'place' | 'picked' | 'attach'>;

  /** The one line under the trick. */
  export interface TrickNote {
    /** 'won': who took the round; 'lead': who leads it; 'alert': a joker call. */
    kind: 'won' | 'lead' | 'alert' | 'plain';
    /** A name that gives way first when the line is long. */
    who?: string;
    text: string;
  }
</script>

<script lang="ts">
  // The felt: the four other seats in fixed bands (two on top, one each
  // side), the trick in the middle with each card between its player and
  // the centre, and the line under it. Between hands its middle holds what
  // comes next (Lobby) and every seat is one tap from its choices.
  //
  // It sizes everything from its own width and height (container units):
  // nothing scrolls and nothing collides, and nothing above or below it
  // ever moves it.
  import type { Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import Card from '../Card.svelte';
  import type { Seal } from '../cards';
  import LeadTag from '../LeadTag.svelte';
  import SeatComponent, { PLACES } from '../Seat.svelte';
  import SuitText from '../SuitText.svelte';
  import type { Card as CardT, Lead, Played } from '../types';
  import type { Ring } from './seats';

  let {
    ring,
    seats,
    watching,
    onTable,
    trickKey,
    trickNo,
    lead,
    winner,
    leading,
    note,
    seal,
    twoJokers,
    attachSeat,
    attachSpot,
    attachCard,
    between,
    controlsOut = false,
    swapFrom,
    seatTap,
    seatActs,
    felt = $bindable(),
    ringEl = $bindable(),
    children,
  }: {
    ring: Ring;
    /** Each seat's view, by seat number. */
    seats: SeatView[];
    /** Nobody sits at the bottom: the felt's foot holds a seat too. */
    watching: boolean;
    /** The cards on the trick, in play order. */
    onTable: Played[];
    /** Changes with each round, so its cards are drawn afresh. */
    trickKey: string;
    trickNo: number;
    /** What a led joker named, shown on it. */
    lead: Lead | null;
    winner: number | null;
    leading: number | null;
    note: TrickNote | null;
    seal: (card: CardT) => Seal | null;
    twoJokers: boolean;
    attachSeat: (seat: number) => Attachment<HTMLElement>;
    /** Registers a seat's place, which slides when seats move. */
    attachSpot: (seat: number) => Attachment<HTMLElement>;
    attachCard: (seat: number) => Attachment<HTMLElement>;
    /** Between hands: each seat is a button, and the middle holds `children`. */
    between: boolean;
    /** Bids or the exchange rise over the felt's foot. */
    controlsOut?: boolean;
    swapFrom: number | null;
    /** A seat's button between hands. */
    seatTap: Snippet<[number]>;
    /** What an empty seat offers, under it, between hands. */
    seatActs: Snippet<[number]>;
    felt?: HTMLElement;
    /** The ring the seats and the trick sit in. */
    ringEl?: HTMLElement;
    /** The middle of the table: the next hand, or the hand thrown in. */
    children?: Snippet;
  } = $props();

  const n = $derived(ring.n);
  const around = $derived(ring.around(!watching));
</script>

<div class="felt" bind:this={felt}>
  <!-- The seats and the trick sit in a ring no wider than the felt is tall,
       so on a wide screen the seats stay near their cards. -->
  <div class="ring" class:watching class:lift-sides={controlsOut} bind:this={ringEl}>
    {#each around as r (r)}
      {@const s = ring.seatAt(r)}
      {@const d = ring.direction(r)}
      {@const place = n === 5 ? PLACES[r] : 'free'}
      <div class="spot {place}" data-seat={s} style:--x={d.x} style:--y={d.y} {@attach attachSpot(s)}>
        <div class="seat-box">
          <SeatComponent {...seats[s]} {place} picked={swapFrom === s} attach={attachSeat(s)} />
          {#if between}{@render seatTap(s)}{/if}
        </div>
        {#if between && swapFrom === null && seats[s]?.empty}{@render seatActs(s)}{/if}
      </div>
    {/each}

    <div class="trick" aria-label={winner !== null ? '끝난 라운드' : '이번 라운드'}>
      {#each onTable as p, i (`${trickKey}-${p.seat}`)}
        {@const [x, y] = ring.slot(ring.relative(p.seat))}
        <div class="slot" data-slot={p.seat} style:--x={x} style:--y={y}>
          <Card
            card={p.card}
            size="fluid"
            seal={seal(p.card)}
            {twoJokers}
            powerless={!p.powered}
            won={p.seat === winner}
            leading={p.seat === leading}
            dimmed={winner !== null && p.seat !== winner}
            tilt={((p.seat * 7 + trickNo * 3) % 5) - 2}
            attach={attachCard(p.seat)}
          />
          {#if i === 0 && 'Joker' in p.card && lead}<LeadTag {lead} />{/if}
        </div>
      {/each}
    </div>

    <!-- One line right under the trick; a long name gives way first. -->
    {#if note}
      <p class="note {note.kind}">{#if note.who}<span class="who-name">{note.who}</span>{/if}<SuitText text={note.text} /></p>
    {/if}

    {@render children?.()}
  </div>
</div>

<style>
  .felt {
    position: relative;
    min-height: 0;
    container-type: size;
  }
  /* At most 1.35 times as wide as it is tall: on a wide screen the side
     seats come in towards the trick instead of hugging the window edges. */
  .ring {
    --seat-w: clamp(92px, 10cqw, 148px);
    --seat-h: 78px;
    /* A trick card is never much bigger than a card in your hand. */
    --trick-max: 92px;
    position: absolute;
    inset: 0;
    max-width: calc(100cqh * 1.35);
    margin-inline: auto;
    container-type: size;
    /* The trick's centre: the middle of the room under the top seats, not
       of the whole felt, whose foot has no seat (you sit on the tray). */
    --cy: calc(50cqh + var(--seat-h) / 2 - 12px);
  }
  /* Tablets: seats and cards grow with the table, the side seats come in. */
  @media (min-width: 600px) and (max-width: 1023px) {
    .ring {
      --seat-w: clamp(92px, 16cqw, 160px);
      --seat-h: 116px;
      --trick-max: 100px;
      inset-inline: 3cqw;
    }
  }
  /* Desktop: larger seats; a trick card 1.2 times the hand's (Hand.svelte:
     12% of the window's height). */
  @media (min-width: 1024px) and (min-height: 640px) {
    .ring {
      --seat-w: clamp(160px, 32cqh, 192px);
      --seat-h: 100px;
      --trick-max: calc(1.2 * clamp(88px, 12vh, 124px));
    }
  }
  /* Card size from the room left between the seats: wide enough that the
     side cards (1.15 across) clear the side seats, short enough that the
     top cards (0.9 up) clear the top seats and the bottom card leaves room
     for the note. */
  .ring {
    --card-w: clamp(
      40px,
      min(
        (100cqw - 2 * var(--seat-w) - 16px) / 3.55,
        (50cqh - var(--seat-h) / 2 - 23px) / 2.04,
        /* Under the bottom card: a lead tag's 20px, the note's 20px and the
           turn pill's 46px, so the note never has to sit on a card. */
        (50cqh - var(--seat-h) / 2 - 82px) / 2.18
      ),
      var(--trick-max)
    );
    --card-h: calc(var(--card-w) * 1.4);
    --tx: calc(var(--card-w) * 1.1);
    /* The side cards sit only 0.95 of this below the top ones, so it must
       outgrow the card height or big cards would overlap. */
    --ty: calc(var(--card-h) * 1.06 + 8px);
    /* Fluid cards on the trick and in the middle take this width. */
    --card-size: var(--card-w);
  }
  .spot {
    position: absolute;
    left: calc(50% + var(--x) * 38%);
    top: calc(50% + var(--y) * 40%);
    transform: translate(-50%, -50%);
  }
  .spot.right {
    left: auto;
    right: 0;
    top: var(--cy);
    transform: translateY(-50%);
  }
  /* The top seats sit just clear of the trick's top cards: at the felt's
     top on a phone, nearer the middle on a tall tablet. */
  .spot.top-right,
  .spot.top-left {
    top: max(0px, var(--cy) - 0.9 * var(--ty) - var(--card-h) / 2 - var(--seat-h) - 20px);
    transform: translateX(-50%);
  }
  .spot.top-right {
    left: 75%;
  }
  .spot.top-left {
    left: 25%;
  }
  .spot.left {
    left: 0;
    top: var(--cy);
    transform: translateY(-50%);
  }
  /* A short felt (an iPhone SE), while bids or the exchange rise over its
     foot: the side seats step up, just under the top ones, so the
     controls leave their names clear. */
  @container (max-height: 260px) {
    .lift-sides .spot.right,
    .lift-sides .spot.left {
      top: max(calc(var(--seat-h) + 4px + var(--seat-h) / 2), calc(var(--cy) - 30px));
    }
  }
  .seat-box {
    position: relative;
  }
  .trick {
    position: absolute;
    left: 50%;
    top: var(--cy);
  }
  .slot {
    position: absolute;
    transform: translate(calc(-50% + var(--x) * var(--tx)), calc(-50% + var(--y) * var(--ty)));
  }
  .note {
    position: absolute;
    left: 50%;
    top: var(--cy);
    transform: translate(-50%, -50%);
    margin: 0;
    font-size: 14px;
    color: var(--ink-muted);
    white-space: nowrap;
    pointer-events: none;
  }
  /* Right under the bottom card's place, on one line: clear of a joker's
     lead tag (it hangs 14px under its card), but never down into the turn
     pill on the tray's rim. */
  .note:not(.lead) {
    top: min(calc(var(--cy) + var(--ty) + var(--card-h) / 2 + 20px), calc(100% - 30px));
    transform: translateX(-50%);
    max-width: calc(100cqw - 16px);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* A long name gives way, never the words after it. */
  .who-name {
    display: inline-block;
    max-width: 7em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  .won {
    color: var(--ink);
    font-weight: 700;
  }
  .alert {
    color: var(--accent);
    font-weight: 700;
  }

  /* Watching, nobody sits on the tray: the bottom seat sits at the felt's
     foot, and the trick makes room for it. */
  .ring.watching {
    --cy: 50cqh;
    --card-w: clamp(
      36px,
      min((100cqw - 2 * var(--seat-w) - 16px) / 3.55, (50cqh - var(--seat-h) - 40px) / 2.2),
      var(--trick-max)
    );
  }
  .watching .spot.bottom {
    top: auto;
    bottom: 0;
    transform: translateX(-50%);
  }
  .watching .note:not(.lead) {
    top: auto;
    bottom: calc(var(--seat-h) + 6px);
  }

  /* Phones on their side: seats fill the felt's corners and the note moves
     into the strip. */
  @media (orientation: landscape) and (max-height: 520px) {
    .ring {
      --cy: 50cqh;
      --card-w: clamp(36px, min((100cqw - 2 * var(--seat-w) - 16px) / 3.55, (50cqh - 6px) / 2.1), 72px);
      max-width: none;
    }
    .note:not(.lead) {
      display: none;
    }
    .spot.right,
    .spot.top-right,
    .spot.top-left,
    .spot.left {
      transform: none;
    }
    .spot.top-left {
      left: 0;
      top: 0;
    }
    .spot.left {
      left: 0;
      top: auto;
      bottom: 0;
    }
    .spot.top-right {
      left: auto;
      right: 0;
      top: 0;
    }
    .spot.right {
      right: 0;
      top: auto;
      bottom: 0;
    }
  }
</style>
