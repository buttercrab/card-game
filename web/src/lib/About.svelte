<script lang="ts">
  // 소개: what the site is, Mighty in a paragraph, and who made what.
  import Doc from './Doc.svelte';
  import SuitText from './SuitText.svelte';
  import { CATALOG, LEVEL_LABEL } from './catalog';
  import { PRESETS } from './games/mighty/catalog';
</script>

<Doc title="소개" here="/about">
  {#snippet lead()}
    <p class="muted">링크 하나로 친구들과 마이티를 치는 곳이에요.</p>
  {/snippet}

  <section>
    <h2>이런 곳이에요</h2>
    <ul>
      <li>모임마다 다른 마이티 규칙을 그대로 골라서 쳐요. 여러 학교의 규칙이 들어 있고, 테이블에서 판과 판 사이에 바꿀 수도 있어요.</li>
      <li>테이블을 만들고 링크를 보내면, 친구가 누르자마자 같은 테이블에 앉아요. 가입은 없어요.</li>
      <li>빈 자리는 봇이 채워요. {CATALOG.bot_levels.map((l) => l.label).join(', ')} 중에 고를 수 있어요.</li>
    </ul>
  </section>

  <section>
    <h2>마이티란?</h2>
    <p>
      다섯 명이 열 장씩 들고 하는 카드 게임이에요. 가장 높은 공약을 부른 사람이 주공이 되어 카드 한 장으로 프렌드를
      부르고, 둘이 여당이 되어 야당 셋과 점수 카드 20장을 두고 겨뤄요. 마이티(<SuitText text="♠A" />)와 조커가 판을 뒤집어요.
    </p>
    <p>처음이라면 <a href="/#learn">1분 설명을 보고 봇이랑 연습해</a> 보세요. 규칙마다 자세한 규칙책도 있어요.</p>
    <ul class="books" aria-label="규칙책">
      {#each PRESETS as p (p.id)}
        <li><a class="chip" href="/rules/{p.id}">{p.title}</a></li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>만든 것들</h2>
    <ul>
      <li>
        배경 음악: <a href="https://github.com/btahir/open-lofi" target="_blank" rel="noopener">Open Lo-Fi</a>의
        ‘Candlelit at 70 BPM’과 ‘Stacks of Quiet Books’. 누구나 쓸 수 있게 CC0으로 공개된 곡이에요.
      </li>
      <li>카드 그림과 인물, 카드 뒷면, 아이콘: 이 사이트를 위해 그렸어요.</li>
      <li>효과음: 녹음 대신 브라우저에서 바로 만들어요.</li>
      <li>봇: 이 사이트의 봇이에요. {LEVEL_LABEL.hard} 봇은 보이지 않는 카드를 여러 가지로 나눠 보고 끝까지 쳐 본 다음 가장 나은 수를 골라요.</li>
      <li>글꼴: Pretendard와 Wanted Sans (SIL Open Font License).</li>
    </ul>
  </section>

  <section>
    <h2>문의</h2>
    <p>이상한 점이나 바라는 점은 <a href="/#report">문제 신고</a>로 보내 주세요. 확인하고 고칠게요.</p>
  </section>
</Doc>

<style>
  .books {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 6px;
    padding: 4px 0 0;
    list-style: none;
  }
  /* Each book is a chip that leads to its page, not underlined text. */
  .books a {
    text-decoration: none;
  }
</style>
