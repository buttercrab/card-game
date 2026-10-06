<script lang="ts">
  // Your place at the table: the hand, your role and points over it, and
  // on desktops your own seat at the tray's left. It rings plum on your
  // turn. Between hands your seat sits on the empty tray, one tap from its
  // choices.
  import type { ComponentProps, Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import Callout from '../Callout.svelte';
  import Hand from '../Hand.svelte';
  import Seat from '../Seat.svelte';
  import type { Card } from '../types';
  import Badge, { type Team } from '../../../ui/Badge.svelte';
  import Bubble from '../../../ui/Bubble.svelte';
  import type { Cue } from './animator.svelte';

  let {
    seat,
    team,
    secretFriend,
    points,
    mine,
    between,
    picked,
    reaction,
    cue,
    secsLeft,
    seatTap,
    attachSeat,
    attachSpot,
    tray = $bindable(),
    raised = $bindable(null),
    hand,
  }: {
    /** Your seat as Seat draws it. */
    seat: Omit<ComponentProps<typeof Seat>, 'place' | 'attach' | 'picked'>;
    team: Team | null;
    secretFriend: boolean;
    points: number;
    /** Your turn: the tray rings plum and the hand rises to meet you. */
    mine: boolean;
    between: boolean;
    /** Your seat is the first picked in a swap. */
    picked: boolean;
    reaction: { text: string; id: number } | null;
    cue: Cue | null;
    /** The last seconds of your turn, before a bot plays it for you. */
    secsLeft: number | null;
    /** Your seat's button, between hands. */
    seatTap: Snippet;
    attachSeat: Attachment<HTMLElement>;
    /** Registers your seat's place, which slides when seats move. */
    attachSpot: Attachment<HTMLElement>;
    tray?: HTMLElement;
    raised?: Card | null;
    /** The hand as Hand draws it. */
    hand: Omit<ComponentProps<typeof Hand>, 'raised' | 'lifted'>;
  } = $props();
</script>

<div class="tray" class:mine class:between bind:this={tray}>
  {#if reaction}
    {#key reaction.id}<Bubble text={reaction.text} />{/key}
  {/if}
  {#if cue?.text}{#key cue.id}<Callout text={cue.text} below={false} />{/key}{/if}
  <!-- Desktop: your own seat at the tray's left; between hands, in its middle. -->
  <div class="me-seat" {@attach attachSpot}>
    <Seat {...seat} {picked} place="bottom" attach={attachSeat} />
    {#if between}{@render seatTap()}{/if}
  </div>
  {#if secsLeft !== null}
    <!-- The last seconds of your turn, then a bot plays it for you. -->
    <span class="countdown" role="timer" aria-live="polite" aria-label="{secsLeft}초 남음">{#key secsLeft}<span class="pop">{secsLeft}</span>{/key}</span>
  {/if}
  <div class="me-row">
    {#if team}{#key team}<Badge {team} class="pop" />{/key}
    {:else if secretFriend}<Badge secret class="pop" title="나만 알아요: 부른 카드를 내면 모두 알게 돼요" />{/if}
    {#if points > 0}<Badge>{points}점</Badge>{/if}
  </div>
  <!-- Always drawn, even empty, so the tray keeps its height. -->
  <div class="hand-slot">
    <Hand {...hand} bind:raised lifted={mine} />
  </div>
</div>

<style>
  .tray {
    position: relative;
    padding: 18px 8px 10px;
    border-radius: var(--r-panel);
    outline: 3px solid transparent;
    outline-offset: -3px;
    transition: outline-color var(--dur-quick) var(--ease-standard);
    /* Your reaction rises at the tray's left, over your own seat, clear of
       the turn pill and the round note in the middle. */
    --bubble-x: 64px;
  }
  .mine {
    outline-color: var(--accent);
  }
  /* The narrowest phones: the hand takes all but the ring's width, so the
     exchange's fourteen cards still fit one row (Hand.svelte). */
  @media (max-width: 360px) {
    .tray {
      padding-inline: 3px;
    }
  }
  .me-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    height: 20px;
    font-size: var(--text-label);
    font-weight: 600;
  }
  .between .me-row {
    visibility: hidden;
  }
  /* Your last seconds: an ink disc on the tray's rim, by the turn ring. */
  .countdown {
    position: absolute;
    right: 12px;
    top: -18px;
    z-index: var(--z-controls);
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--ink);
    color: var(--table);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .me-seat {
    position: relative;
    display: none;
  }
  /* Between hands your seat sits on the empty tray, in the middle. */
  .between .me-seat {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    display: block;
    width: 120px;
    transform: translate(-50%, -50%);
    --seat-w: 100%;
  }
  .hand-slot {
    min-width: 0;
  }
  /* Desktop: your seat, the hand across all the room between, and a
     column kept clear at the right for your tools (Table places them). */
  @media (min-width: 1024px) and (min-height: 640px) {
    .tray {
      display: grid;
      grid-template-columns: 170px minmax(0, 1fr) var(--tools-w, 0px);
      grid-template-areas: 'me hand tools';
      align-items: center;
      column-gap: 12px;
      padding: 14px 10px 8px;
    }
    .hand-slot {
      grid-area: hand;
    }
    .me-row {
      display: none;
    }
    .me-seat,
    .between .me-seat {
      grid-area: me;
      position: relative;
      left: auto;
      top: auto;
      display: block;
      align-self: center;
      width: auto;
      transform: none;
      --seat-w: 100%;
      --seat-figure: 60px;
    }
  }
  /* Phones on their side: the tray hugs the foot. */
  @media (orientation: landscape) and (max-height: 520px) {
    .tray {
      padding: 0 4px 4px;
    }
    .me-row {
      display: none;
    }
  }
</style>
