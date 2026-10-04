<script lang="ts">
  // A sheet of every card face, size and state in both themes, for design review.
  import { BACK_NAMES, type CardBack } from './achievements';
  import Card from './Card.svelte';
  import BackArt from './CardBack.svelte';
  import LeadTag from './LeadTag.svelte';
  import { sealOf, SUITS } from './cards';
  import { settings } from './settings.svelte';
  import type { Card as CardT, Rules, Suit } from './types';

  // Only the parts of the 경기과고 rules that decide the seals.
  const rules = {
    deck: 'TwoJokers',
    joker_call: {
      calls: [
        [{ Normal: ['Club', 3] }, { Normal: ['Spade', 3] }],
        [{ Normal: ['Heart', 3] }, { Normal: ['Diamond', 3] }],
      ],
    },
  } as unknown as Rules;

  let trumpChoice: Suit | '' = $state('');
  const trump = $derived(trumpChoice || null);

  const deck: CardT[] = [
    ...SUITS.flatMap((suit) => [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((rank): CardT => ({ Normal: [suit, rank] }))),
    { Joker: 'Black' },
    { Joker: 'Red' },
  ];
  const hand: CardT[] = [
    { Joker: 'Red' },
    { Normal: ['Spade', 14] },
    { Normal: ['Spade', 10] },
    { Normal: ['Spade', 3] },
    { Normal: ['Diamond', 13] },
    { Normal: ['Diamond', 9] },
    { Normal: ['Heart', 12] },
    { Normal: ['Heart', 3] },
    { Normal: ['Club', 11] },
    { Normal: ['Club', 7] },
  ];
  let raised = $state(1);
</script>

<main>
  <header>
    <h1>카드 미리보기</h1>
    <label><input type="checkbox" bind:checked={settings.fourColor} /> 4색 덱</label>
    <label>
      기루다
      <select bind:value={trumpChoice}>
        <option value="">노기루다</option>
        <option value="Spade">♠</option>
        <option value="Diamond">♦</option>
        <option value="Heart">♥</option>
        <option value="Club">♣</option>
      </select>
    </label>
  </header>

  <div class="themes">
    {#each ['light', 'dark'] as theme (theme)}
      <section class="sheet" data-theme={theme}>
        <h2>{theme === 'light' ? '라이트' : '다크'}</h2>

        <h3>손패 (겹침, 탭하면 올라옴)</h3>
        <div class="fan">
          {#each hand as card, i (i)}
            <Card {card} seal={sealOf(card, rules, trump)} raised={raised === i} onclick={() => (raised = i)} />
          {/each}
        </div>

        <h3>큰 카드</h3>
        <div class="row wrap">
          {#each deck.filter((c) => 'Joker' in c || [14, 13, 12, 11, 10, 7, 3].includes(c.Normal[1])).slice(0, 9) as card, i (i)}
            <Card {card} width={140} seal={sealOf(card, rules, trump)} />
          {/each}
          <Card width={140} />
        </div>

        <h3>전체 덱</h3>
        <div class="row wrap">
          {#each deck as card, i (i)}
            <Card {card} size="hand" seal={sealOf(card, rules, trump)} />
          {/each}
        </div>

        <h3>라운드 · 미니</h3>
        <div class="row wrap">
          {#each deck.slice(0, 13) as card, i (i)}
            <Card {card} size="trick" seal={sealOf(card, rules, trump)} />
          {/each}
        </div>
        <div class="row wrap">
          {#each deck.slice(13, 26) as card, i (i)}
            <Card {card} size="mini" seal={sealOf(card, rules, trump)} />
          {/each}
        </div>

        <h3>상태</h3>
        <div class="row states">
          <figure><Card card={deck[0]} raised /><figcaption>선택</figcaption></figure>
          <figure><Card card={deck[14]} unplayable /><figcaption>낼 수 없음</figcaption></figure>
          <figure><Card card={deck[27]} won /><figcaption>라운드 승리</figcaption></figure>
          <figure><Card card={deck[40]} kitty /><figcaption>키티</figcaption></figure>
          <figure><Card card={deck[52]} powerless seal="joker" /><figcaption>효력 없음</figcaption></figure>
          <figure><Card /><figcaption>뒷면</figcaption></figure>
          <figure><span class="tagged"><Card card={{ Joker: 'Red' }} seal="joker" /><LeadTag lead={{ Suit: 'Diamond' }} /></span><figcaption>조커 선 ♦</figcaption></figure>
          <figure><span class="tagged"><Card card={{ Joker: 'Red' }} seal="joker" /><LeadTag lead={{ Color: 'Red' }} /></span><figcaption>조커 선 빨강</figcaption></figure>
          <figure><span class="tagged"><Card card={{ Joker: 'Black' }} seal="joker" /><LeadTag lead={{ Suit: 'Club' }} /></span><figcaption>조커 선 ♣</figcaption></figure>
        </div>

        <h3>뒷면</h3>
        <div class="row states">
          {#each Object.keys(BACK_NAMES) as id (id)}
            <figure><span class="back-sample"><BackArt id={id as CardBack} /></span><figcaption>{BACK_NAMES[id as CardBack]}</figcaption></figure>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</main>

<style>
  main {
    padding: 16px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
  }
  .themes {
    display: grid;
    gap: 16px;
  }
  @media (min-width: 1200px) {
    .themes {
      grid-template-columns: 1fr 1fr;
    }
  }
  .sheet {
    min-width: 0;
    padding: 16px;
    border-radius: 16px;
    background: var(--table);
    color: var(--ink);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 17px;
  }
  h3 {
    margin: 20px 0 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .row {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 14px 2px 6px;
  }
  .wrap {
    flex-wrap: wrap;
    overflow: visible;
  }
  .fan {
    display: flex;
    padding: 16px 2px 6px;
  }
  .fan > :global(.card:not(:first-child)) {
    margin-left: -33px;
  }
  @media (min-width: 1024px) {
    .fan > :global(.card:not(:first-child)) {
      margin-left: -40px;
    }
  }
  .states figure {
    margin: 0;
    display: grid;
    justify-items: center;
    gap: 6px;
  }
  .tagged {
    position: relative;
    margin-bottom: 8px;
  }
  .back-sample {
    position: relative;
    display: block;
    width: 88px;
    height: 123px;
    overflow: hidden;
    border-radius: 8px;
  }
  figcaption {
    font-size: 12px;
    color: var(--ink-muted);
  }
</style>
