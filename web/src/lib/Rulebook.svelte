<script lang="ts">
  // The rules of one preset in plain Korean, written from the server's
  // actual rule values so the book can never disagree with the game.
  import Card from './Card.svelte';
  import { cardLabel, jokers } from './cards';
  import { PRESET_NAME } from './presets';
  import type { Card as CardT, CardPolicy, Rules, TrickPolicy } from './types';

  /** `rules` overrides the preset's, for a table whose players changed them. */
  let { preset, rules: given = null }: { preset: string; rules?: Rules | null } = $props();

  let rules = $state<Rules | null>(null);
  let failed = $state(false);

  $effect(() => {
    rules = given;
    failed = false;
    if (given) return;
    fetch(`/api/presets/${preset}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((r: Rules) => (rules = r))
      .catch(() => (failed = true));
  });

  const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): CardT => ({ Normal: [suit, rank] });

  const kitty = (r: Rules) => 52 + jokers(r).length - r.players * r.hand_size;

  const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

  /** What a card policy means on one round, or null when nothing changes. */
  function policyText(p: CardPolicy): string | null {
    switch (p) {
      case 'NoEffect':
        return '낼 수는 있지만 힘이 없어요';
      case 'Invalid':
        return '낼 수 없어요 (따라 내야 하거나 그것밖에 없을 때만 예외)';
      case 'NoLead':
        return '먼저 낼 수 없어요';
      default:
        return null;
    }
  }

  /** The first- and last-round limits, one line per card that has any. */
  function roundLimits(r: Rules): { who: string; round: string; text: string }[] {
    if (!r.policy) return [];
    const rows: [string, TrickPolicy][] = [
      ['마이티', r.policy.mighty],
      ['조커', r.policy.joker],
      ['기루다', r.policy.trump],
      ['조커 콜', r.policy.joker_call],
    ];
    const out: { who: string; round: string; text: string }[] = [];
    const say = (who: string, p: CardPolicy) =>
      who === '조커 콜' ? (p === 'Valid' ? null : '할 수 없어요') : policyText(p);
    for (const [who, p] of rows) {
      const [first, last] = [say(who, p.first), say(who, p.last)];
      if (first && first === last) out.push({ who, round: '첫 라운드와 마지막 라운드', text: first });
      else {
        if (first) out.push({ who, round: '첫 라운드', text: first });
        if (last) out.push({ who, round: '마지막 라운드', text: last });
      }
    }
    return out;
  }

  function friendWays(r: Rules): string[] {
    const f = r.friend;
    if (!f) return [];
    return [
      f.by_card && '카드로 부르기: 그 카드를 가진 사람이 프렌드예요. 카드가 나올 때 밝혀져요.',
      f.by_seat && '자리로 부르기: 그 자리에 앉은 사람이 프렌드예요.',
      f.first_trick && '첫 라운드: 첫 라운드를 이긴 사람이 프렌드예요.',
      f.last_trick && '마지막 라운드: 마지막 라운드를 이긴 사람이 프렌드예요.',
      f.alone && '노프렌드: 혼자 해요. 이기면 점수가 두 배예요.',
      f.fake && '자기가 가진 카드를 불러서 몰래 혼자 할 수도 있어요.',
    ].filter((x): x is string => typeof x === 'string');
  }

  function misdealText(r: Rules): string | null {
    const m = r.misdeal;
    if (!m) return null;
    const parts = [`점수 카드 ${signed(m.point_value)}`];
    if (m.joker_value !== 0) parts.push(`조커 ${signed(m.joker_value)}`);
    for (const [card, v] of m.card_values) parts.push(`${cardLabel(card)} ${signed(v)}`);
    return `받은 패가 약하면 공약하기 전에 다시 나눠 달라고 할 수 있어요 (딜미스). ${parts.join(', ')}점으로 세어 ${m.threshold}점 이하일 때예요.`;
  }
</script>

<article class="book">
  <header>
    <h1>{PRESET_NAME[preset] ?? preset} 규칙{#if given}<span class="changed">바꾼 규칙</span>{/if}</h1>
    {#if rules}
      <ul class="facts">
        <li>{rules.players}명</li>
        <li>{rules.hand_size}장씩</li>
        <li>조커 {jokers(rules).length}장</li>
        <li>공약 {rules.bidding.min}–{rules.bidding.max}</li>
      </ul>
    {/if}
  </header>

  {#if failed}
    <p class="muted">규칙을 불러오지 못했어요.</p>
  {:else if !rules}
    <p class="muted">불러오는 중…</p>
  {:else}
    {@const r = rules}
    {@const twoJokers = jokers(r).length === 2}
    <section>
      <h2>목표</h2>
      <p>
        공약을 가장 높게 부른 사람이 <strong>여당</strong>이 되어 프렌드 한 명과 한 편이 되고, 나머지는
        <strong>야당</strong>이 돼요. 여당은 부른 점수 이상을 가져와야 해요. 점수 카드는 10, J, Q, K, A로 한 장에
        1점, 모두 20점이에요.
      </p>
      <div class="cards" aria-hidden="true">
        {#each [10, 11, 12, 13, 14] as rank (rank)}
          <Card card={n('Heart', rank)} size="mini" />
        {/each}
      </div>
    </section>

    <section>
      <h2>카드 나누기</h2>
      <p>
        52장에 조커 {jokers(r).length}장을 더해 한 사람에 {r.hand_size}장씩 나누고, 남은 {kitty(r)}장은 바닥에 엎어
        둬요.
      </p>
      {#if misdealText(r)}<p>{misdealText(r)}</p>{/if}
    </section>

    <section>
      <h2>공약</h2>
      <ul>
        <li>차례대로 기루다(으뜸 무늬)와 가져올 점수를 부르거나 패스해요. 한 번 패스하면 그 판에는 다시 못 불러요.</li>
        <li>점수는 {r.bidding.min}부터 {r.bidding.max}까지 부를 수 있고, 앞사람보다 높아야 해요.</li>
        {#if r.bidding.allow_no_trump}
          <li>
            노기루다(기루다 없음)도 부를 수 있어요.
            {#if r.bidding.no_trump_bonus > 0}
              노기루다 {r.bidding.min - r.bidding.no_trump_bonus}는 기루다 {r.bidding.min}와 같은 높이예요.
            {/if}
            {#if r.bidding.no_trump_wins_ties}
              높이가 같으면 노기루다가 이겨요.
            {:else}
              노기루다도 같은 높이로는 못 덮고, 더 높아야 해요.
            {/if}
          </li>
        {:else}
          <li>노기루다는 없어요.</li>
        {/if}
        <li>
          {r.bidding.first_bidder_may_pass
            ? '첫 사람도 패스할 수 있어요.'
            : '첫 사람은 패스할 수 없고 꼭 불러야 해요.'}
          모두 패스하면 다시 나눠요.
        </li>
      </ul>
    </section>

    <section>
      <h2>바닥패와 프렌드</h2>
      <ul>
        <li>여당이 바닥패 {kitty(r)}장을 가져가고 {kitty(r)}장을 버려요. 버린 점수 카드는 여당 점수가 돼요.</li>
        <li>
          {r.bidding.change_trump_cost > 0
            ? `기루다를 바꾸려면 공약을 ${r.bidding.change_trump_cost} 올려야 해요.`
            : '공약을 올리지 않고 기루다를 바꿀 수 있어요.'}
        </li>
      </ul>
      <p>프렌드를 정하는 방법:</p>
      <ul>
        {#each friendWays(r) as way (way)}
          <li>{way}</li>
        {/each}
      </ul>
    </section>

    <section>
      <h2>카드의 힘</h2>
      <p>한 라운드는 위에 있는 카드가 이겨요.</p>
      <ol class="ladder">
        <li>
          <span class="cards" aria-hidden="true"><Card card={n('Spade', 14)} size="mini" seal="mighty" /></span>
          <span><strong>마이티</strong> ♠A. 기루다가 ♠이면 ♦A가 마이티예요.</span>
        </li>
        {#if twoJokers}
          <li>
            <span class="cards" aria-hidden="true"><Card card={{ Joker: 'Black' }} size="mini" seal="joker" /></span>
            <span><strong>기루다 색 조커</strong> 기루다가 ♠♣이면 흑조커, ♥♦이면 홍조커. 노기루다면 처음 낸 색의 조커.</span>
          </li>
        {:else}
          <li>
            <span class="cards" aria-hidden="true"><Card card={{ Joker: 'Black' }} size="mini" seal="joker" twoJokers={false} /></span>
            <span><strong>조커</strong></span>
          </li>
        {/if}
        <li>
          <span class="cards" aria-hidden="true"><Card card={n('Heart', 14)} size="mini" /></span>
          <span><strong>기루다</strong> 높은 숫자가 이겨요.</span>
        </li>
        {#if twoJokers}
          <li>
            <span class="cards" aria-hidden="true"><Card card={{ Joker: 'Red' }} size="mini" seal="joker" /></span>
            <span><strong>다른 색 조커</strong></span>
          </li>
        {/if}
        <li>
          <span class="cards" aria-hidden="true"><Card card={n('Club', 13)} size="mini" /></span>
          <span><strong>처음 낸 무늬</strong> 높은 숫자가 이겨요. 다른 무늬는 이길 수 없어요.</span>
        </li>
      </ol>
    </section>

    <section>
      <h2>카드 내기</h2>
      <ul>
        <li>여당이 첫 라운드를 시작하고, 라운드를 이긴 사람이 다음 라운드를 시작해요.</li>
        <li>처음 낸 무늬가 있으면 그 무늬를 내야 해요. 없으면 아무 카드나 낼 수 있어요.</li>
        <li>
          마이티와 조커는 언제든 낼 수 있어요. 다만 마이티도 그 무늬의 카드라서, 그 무늬가 나왔는데 가진 게 마이티뿐이면
          마이티를 내야 해요.
        </li>
        <li>
          조커로 시작하면 따라 낼 무늬를 정해요.
          {#if twoJokers}조커 색의 무늬만 정할 수 있어요.{/if}
          {#if r.joker_lead?.by_color}
            무늬 대신 색(빨강, 검정)을 정할 수도 있어요. 그러면 그 색 카드가 있는 사람은 그 색 카드를 내야 해요.
          {/if}
        </li>
        {#if r.joker_lead?.powerless_passes}
          <li>힘이 없는 조커로 시작하면, 다음 사람이 낸 카드의 무늬가 처음 낸 무늬가 돼요.</li>
        {/if}
      </ul>
    </section>

    <section>
      <h2>조커 콜</h2>
      <ul>
        {#each r.joker_call.calls as [call, fallback], i (i)}
          <li>
            {cardLabel(call)}{#if JSON.stringify(call) !== JSON.stringify(fallback)}(기루다가 {cardLabel(call).slice(0, 1)}이면 {cardLabel(
                fallback,
              )}){/if} 카드로 라운드를 시작하면서 조커 콜을 하면, {twoJokers ? cardLabel(jokers(r)[i]) : '조커'}를 가진 사람은
            그 조커를 내야 해요.
          </li>
        {/each}
        <li>
          {r.joker_call.called_joker_has_power ? '불려 나온 조커도 힘이 있어요.' : '불려 나온 조커는 힘이 없어요.'}
        </li>
        {#if r.joker_call.mighty_defense}
          <li>조커 대신 마이티를 내서 막을 수도 있어요.</li>
        {/if}
      </ul>
    </section>

    {#if roundLimits(r).length}
      <section>
        <h2>첫 라운드와 마지막 라운드</h2>
        <ul>
          {#each roundLimits(r) as row (row.who + row.round)}
            <li><strong>{row.round}</strong>에 {row.who}{row.who === '조커 콜' ? '은' : '는'} {row.text}.</li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h2>점수 계산</h2>
      <ul>
        <li>
          여당이 공약 이상을 가져오면 <strong>가져온 점수 − 10</strong>(적어도 1)을 얻어요.
          {r.bidding.allow_no_trump ? '노기루다면 두 배, ' : ''}노프렌드면 두 배, 20점을 모두 가져오면 또 두 배예요.
        </li>
        <li>공약을 못 채우면 모자란 만큼 잃어요. 10점 이하로 가져왔다면 두 배로 잃어요.</li>
        <li>
          그 점수를 야당은 한 사람마다 내고, 프렌드는 한 몫을 받고, 여당은 야당 수만큼 받아서 프렌드 몫을 뺀 만큼 가져요.
          모두 더하면 항상 0이에요.
        </li>
      </ul>
      <p class="example">
        예: 공약 {r.bidding.min}에 {r.bidding.min + 2}점을 가져오면 {r.bidding.min - 8}점. 야당 세 명이 −{r.bidding.min - 8}씩,
        프렌드 +{r.bidding.min - 8}, 여당 +{(r.bidding.min - 8) * 2}.
      </p>
    </section>
  {/if}
</article>

<style>
  .book {
    display: grid;
    gap: 20px;
    line-height: 1.6;
  }
  header {
    display: grid;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
  }
  .changed {
    margin-left: 8px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-family: var(--font);
    font-size: 13px;
    vertical-align: middle;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .facts li {
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--panel);
    font-size: 13px;
    font-weight: 700;
  }
  section {
    display: grid;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  p,
  ul,
  ol {
    margin: 0;
  }
  ul {
    padding-left: 20px;
    display: grid;
    gap: 4px;
  }
  .cards {
    display: flex;
    gap: 4px;
  }
  .ladder {
    display: grid;
    gap: 8px;
    padding: 0;
    list-style: none;
    counter-reset: step;
  }
  .ladder li {
    display: flex;
    align-items: center;
    gap: 12px;
    counter-increment: step;
  }
  .ladder li::before {
    content: counter(step);
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--panel);
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 800;
  }
  .ladder strong {
    margin-right: 4px;
  }
  .example {
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--panel);
    font-size: 14px;
  }
</style>
