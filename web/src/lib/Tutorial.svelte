<script lang="ts">
  // A short guide for someone who has never played Mighty, ending in a
  // practice table against easy bots.
  import Card from './Card.svelte';
  import SuitText from './SuitText.svelte';
  import type { Card as CardT } from './types';
  import Button from './ui/Button.svelte';
  import Sheet from './ui/Sheet.svelte';

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
      title: '조커콜',
      body: '♣3으로 라운드를 시작하면서 조커콜을 하면, 조커를 가진 사람은 조커를 내야 하고 그 조커는 힘이 없어요. 조커를 잡는 방법이에요.',
      cards: [{ card: n('Club', 3), seal: 'call' }, { card: { Joker: 'Black' }, seal: 'joker' }],
    },
    {
      title: '점수',
      body: '여당이 공약 이상을 가져오면 이겨요. 연습 판의 기본 규칙에서는 이기면 (가져온 장수 − 13) + (공약 − 13)점을 받고(적어도 1점), 지면 모자란 만큼 잃어요. 노기루다, 노프렌드, 런, 백런, 공약 20은 두 배예요. 학교 규칙은 달라요: 이기면 가져온 장수 − 10, 지면 (공약 − 10) + 모자란 만큼을 잃어요. 이제 봇이랑 한 판 해 볼까요? 연습 판에서는 차례마다 도움말이 나오고 전구 버튼으로 봇의 생각도 볼 수 있어요.',
      cards: [],
    },
  ];

  let step = $state(0);
  const s = $derived(STEPS[step]);
  const last = $derived(step === STEPS.length - 1);

</script>

<Sheet class="tutorial" {onclose}>
  {#snippet head(id)}
    <p class="count muted">{step + 1} / {STEPS.length}</p>
    <h2 class="sheet-title" {id}>{s.title}</h2>
  {/snippet}
  {#key step}
    <div class="step fade-up">
      {#if s.cards.length}
        <div class="cards" aria-hidden="true">
          {#each s.cards as c, i (i)}<Card card={c.card} size="hand" seal={c.seal ?? null} />{/each}
        </div>
      {/if}
      <p><SuitText text={s.body} /></p>
    </div>
  {/key}
  <div class="dots" aria-hidden="true">
    {#each STEPS as _, i (i)}<span class:on={i === step}></span>{/each}
  </div>
  <!-- Every button keeps its place from step to step: 이전 is only hidden
       on the first. -->
  {#snippet footer(close)}
    <Button variant="ghost" onclick={close}>닫기</Button>
    <button class="btn" class:hidden={step === 0} onclick={() => step--} aria-hidden={step === 0} tabindex={step === 0 ? -1 : 0}>이전</button>
    {#if last}
      <Button variant="primary" onclick={() => (close(), onpractice())}>봇이랑 연습하기</Button>
    {:else}
      <Button variant="primary" onclick={() => step++}>다음</Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .count {
    margin: 0;
    font-size: var(--text-label);
  }
  .step {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 12px;
    min-height: 220px;
    align-content: start;
  }
  .count + .sheet-title {
    margin: 4px 0 12px;
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
    transition: background-color var(--dur-move) var(--ease-standard);
  }
  .dots span.on {
    width: 20px;
    border-radius: 4px;
    background: var(--ink);
  }
  /* 이전 keeps its place while there is nothing before. */
  .hidden {
    visibility: hidden;
  }
</style>
