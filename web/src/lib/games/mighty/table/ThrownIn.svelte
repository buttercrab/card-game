<script lang="ts">
  // A hand thrown in as 딜미스, face up where the trick goes, between the
  // seats, as at a real table: two rows of five, hung from just under the
  // top seats so it clears the bid controls.
  import Card from '../Card.svelte';
  import Icon from '../../../Icon.svelte';
  import type { Card as CardT } from '../types';

  let {
    who,
    hand,
    twoJokers,
    onclose,
  }: { who: string; hand: CardT[]; twoJokers: boolean; onclose: () => void } = $props();

  const rows = $derived([hand.slice(0, Math.ceil(hand.length / 2)), hand.slice(Math.ceil(hand.length / 2))]);
</script>

<div class="thrown-in fade-up" role="status" aria-label="딜미스로 보여 준 패">
  <div class="head">
    <p class="title"><span class="who">{who}</span> 딜미스</p>
    <button class="btn icon close" aria-label="닫기" onclick={onclose}><Icon name="close" size="16px" /></button>
  </div>
  <div class="cards">
    {#each rows as row, r (r)}
      <div class="row">
        {#each row as c, i (i)}<span class="in-fan"><Card card={c} size="fluid" {twoJokers} overlapped={i < row.length - 1} /></span>{/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .thrown-in {
    /* Cards a little smaller than the trick's, overlapping by 42%. */
    --card-size: clamp(40px, calc(var(--card-w) * 0.85), 56px);
    position: absolute;
    left: 50%;
    top: calc(var(--seat-h) + 2px);
    z-index: 3;
    display: grid;
    gap: 4px;
    padding: 6px;
    border-radius: var(--r-panel);
    background: var(--panel);
    box-shadow: var(--lip);
    transform: translateX(-50%);
  }
  :global(:root[data-motion='reduced']) .thrown-in {
    animation-name: fade;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .title {
    margin: 0 0 0 4px;
    font-size: var(--text-label);
    font-weight: 700;
    white-space: nowrap;
  }
  .who {
    display: inline-block;
    max-width: 5em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  /* Drawn small in the head's corner; still a 44px target. */
  .close {
    min-width: 28px;
    min-height: 28px;
    margin: -4px -2px -4px 0;
  }
  .close::before {
    content: '';
    position: absolute;
    inset: -8px;
  }
  .cards {
    display: grid;
    justify-items: center;
    gap: 4px;
  }
  .row {
    display: flex;
  }
  .in-fan + .in-fan {
    margin-left: calc(var(--card-size) * -0.42);
  }
</style>
