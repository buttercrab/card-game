<script lang="ts">
  // A short guide for someone who has never played Mighty, ending in a
  // practice table against easy bots.
  import Card from './Card.svelte';
  import type { Card as CardT } from './types';

  let { onpractice, onclose }: { onpractice: () => void; onclose: () => void } = $props();

  const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): CardT => ({ Normal: [suit, rank] });

  const STEPS: { title: string; body: string; cards: { card: CardT; seal?: 'mighty' | 'joker' | 'call' }[] }[] = [
    {
      title: '마이티는',
      body: '다섯 명이 열 장씩 들고 하는 카드 게임이에요. 10, J, Q, K, A가 점수 카드로 모두 20장, 이걸 누가 많이 가져오느냐의 싸움이에요.',
      cards: [10, 11, 12, 13, 14].map((r) => ({ card: n('Heart', r) })),
    },
    {
      title: '공약',
      body: '먼저 “몇 장 가져올게”를 불러요. ♠ 14는 스페이드를 기루다(으뜸 무늬)로, 점수 카드 14장 이상을 약속하는 거예요. 가장 높게 부른 사람이 주공이 돼요.',
      cards: [{ card: n('Spade', 13) }, { card: n('Spade', 10) }, { card: n('Spade', 7) }],
    },
    {
      title: '프렌드',
      body: '주공은 카드 한 장으로 프렌드를 불러요. 그 카드를 가진 사람이 몰래 주공 편이 되고, 그 카드가 나오면 밝혀져요. 주공과 프렌드가 여당, 나머지 셋이 야당이에요.',
      cards: [{ card: { Joker: 'Black' }, seal: 'joker' }],
    },
    {
      title: '라운드',
      body: '선이 한 장 내면 모두 같은 무늬를 따라 내요. 그 무늬가 없으면 아무 카드나 낼 수 있어요. 가장 센 카드를 낸 사람이 다섯 장을 가져가고 다음 선이 돼요. 열 라운드를 해요.',
      cards: [{ card: n('Club', 9) }, { card: n('Club', 13) }, { card: n('Club', 4) }],
    },
    {
      title: '센 카드',
      body: '마이티(♠A, 기루다가 ♠이면 ♦A)가 가장 세고, 다음이 조커, 그다음이 기루다예요. 기루다가 아니면 처음 낸 무늬만 이길 수 있어요. 경기과고 규칙은 조커가 두 장이에요.',
      cards: [{ card: n('Spade', 14), seal: 'mighty' }, { card: { Joker: 'Red' }, seal: 'joker' }, { card: n('Heart', 14) }],
    },
    {
      title: '조커 콜',
      body: '♣3으로 라운드를 시작하면서 조커 콜을 하면, 조커를 가진 사람은 조커를 내야 하고 그 조커는 힘이 없어요. 조커를 잡는 방법이에요.',
      cards: [{ card: n('Club', 3), seal: 'call' }, { card: { Joker: 'Black' }, seal: 'joker' }],
    },
    {
      title: '점수',
      body: '여당이 공약 이상을 가져오면 이기고, 넘긴 만큼 점수를 받아요. 못 채우면 모자란 만큼 잃어요. 이제 봇이랑 한 판 해 볼까요? 연습 판에서는 차례마다 도움말이 나오고 전구 버튼으로 봇의 생각도 볼 수 있어요.',
      cards: [],
    },
  ];

  let step = $state(0);
  const s = $derived(STEPS[step]);
  const last = $derived(step === STEPS.length - 1);

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog class="sheet tutorial" bind:this={dialog} onclose={onclose} aria-labelledby="tutorial-title">
  <div class="sheet-body">
    <p class="count muted">{step + 1} / {STEPS.length}</p>
    {#key step}
      <div class="step fade-up">
        <h2 id="tutorial-title">{s.title}</h2>
        {#if s.cards.length}
          <div class="cards" aria-hidden="true">
            {#each s.cards as c, i (i)}<Card card={c.card} size="hand" seal={c.seal ?? null} />{/each}
          </div>
        {/if}
        <p>{s.body}</p>
      </div>
    {/key}
    <div class="dots" aria-hidden="true">
      {#each STEPS as _, i (i)}<span class:on={i === step}></span>{/each}
    </div>
  </div>
  <!-- Every button keeps its place from step to step: 이전 is only hidden
       on the first. -->
  <div class="sheet-foot">
    <button class="ghost" onclick={() => dialog.close()}>닫기</button>
    <button class="prev" class:hidden={step === 0} onclick={() => step--} aria-hidden={step === 0} tabindex={step === 0 ? -1 : 0}>이전</button>
    {#if last}
      <button class="primary" onclick={() => (dialog.close(), onpractice())}>봇이랑 연습하기</button>
    {:else}
      <button class="primary" onclick={() => step++}>다음</button>
    {/if}
  </div>
</dialog>

<style>
  .tutorial {
    overflow-x: hidden;
  }
  .count {
    margin: 0;
    font-size: 13px;
  }
  .step {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 12px;
    min-height: 260px;
    align-content: start;
  }
  h2 {
    margin: 4px 0 0;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
  }
  /* Up to five cards share the dialog's width; none overflows it. They
     start at the text's left edge. */
  .cards {
    display: flex;
    justify-content: flex-start;
    gap: 6px;
    padding: 6px 0;
    container-type: inline-size;
  }
  .cards :global(.card) {
    --w: min(64px, calc((100cqw - 24px) / 5)) !important;
  }
  p {
    margin: 0;
    line-height: 1.65;
  }
  .dots {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin: 16px 0 0;
  }
  .dots span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink) 22%, transparent);
    transition: width var(--dur-move) var(--ease-standard);
  }
  .dots span.on {
    width: 20px;
    border-radius: 4px;
    background: var(--ink);
  }
  .hidden {
    visibility: hidden;
  }
  .sheet-foot .primary {
    min-width: 140px;
  }
</style>
