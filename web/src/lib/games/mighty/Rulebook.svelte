<script lang="ts">
  // The rules of one preset in plain Korean, written from the server's
  // actual rule values so the book can never disagree with the game.
  import Card from './Card.svelte';
  import SuitIcon from '../../SuitIcon.svelte';
  import SuitText from '../../SuitText.svelte';
  import { cardLabel, jokers } from './cards';
  import { isPreset, presetRules, presetTitle } from './catalog';
  import type { Examples, Rules } from './types';
  import {normalCard as n,kitty,signed,deckText,winFormula,scoringLines,josa,fromNoTrumpCost,toNoTrumpCost,roundLimits,friendWays,misdealText} from './rulebookMeaning';

  /** `rules` overrides the preset's: a table's own, or the preset's as the
   * table pinned them. `changed`: the table's players changed them (by
   * default, whenever `rules` is given). */
  let {
    preset,
    rules: given = null,
    changed = given !== null,
  }: { preset: string; rules?: Rules | null; changed?: boolean } = $props();

  /** The rules, or null for an id no preset has. */
  const rules = $derived(given ?? (isPreset(preset) ? presetRules(preset) : null));
  // On its own page (/rules/…) the book offers a way home; in a sheet the
  // sheet's own footer does that.
  const standalone = typeof location !== 'undefined' && location.pathname.startsWith('/rules/');

  // The worked example is scored by the server, under these rules.
  let examples = $state<Examples | null>(null);
  $effect(() => {
    const body = rules && JSON.stringify($state.snapshot(rules));
    examples = null;
    if (!body) return;
    let live = true;
    fetch('/api/games/mighty/rules/examples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then((r) => (r.ok ? r.json() : null))
      .then((e: Examples | null) => live && (examples = e))
      .catch(() => {});
    return () => {
      live = false;
    };
  });

</script>

<article class="book">
  <header>
    <h1>
      {#if !rules}규칙을 찾을 수 없어요{:else}{presetTitle(preset)} 규칙{/if}{#if changed}<span
          class="changed">바꾼 규칙</span
        >{/if}
    </h1>
    {#if rules}
      <ul class="facts">
        <li>{rules.players}명</li>
        <li>{rules.hand_size}장씩</li>
        <li>조커 {jokers(rules).length}장</li>
        <li>공약 {rules.bidding.min}–{rules.bidding.max}</li>
      </ul>
    {/if}
  </header>

  {#if !rules}
    <div class="failed" role="alert">
      <p class="muted">‘{preset}’라는 규칙은 없어요. 주소를 다시 확인해 주세요.</p>
      <div class="failed-actions">
        {#if standalone}<a class="btn" href="/">홈으로</a>{/if}
      </div>
    </div>
  {:else}
    {@const r = rules}
    {@const twoJokers = jokers(r).length === 2}
    {@const [formula, note] = winFormula(r)}
    <section>
      <h2>목표</h2>
      <p>
        공약을 가장 높게 부른 사람이 <strong>주공</strong>이 되어 프렌드 한 명과 <strong>여당</strong>을 이루고,
        나머지는 <strong>야당</strong>이 돼요. 여당은 부른 점수 이상을 가져와야 해요. 점수 카드는 10, J, Q, K, A로 한 장에
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
        <SuitText text={deckText(r)} />에 조커 {jokers(r).length}장을 더해 {r.players}명에게 {r.hand_size}장씩 나누고, 남은 {kitty(r)}장은
        키티로 엎어 둬요.
      </p>
      {#each misdealText(r) as line (line)}<p><SuitText text={line} /></p>{/each}
    </section>

    <section>
      <h2>공약</h2>
      <ul>
        {#if r.bidding.pass_is_final === false}
          <li>
            차례대로 기루다(으뜸 무늬)와 가져올 점수를 부르거나 패스해요. 패스했어도 누가 더 높게 부르면 다시 부를 수
            있어요. 한 사람을 빼고 모두 잇달아 패스하면 그 사람이 주공이에요.
          </li>
        {:else}
          <li>차례대로 기루다(으뜸 무늬)와 가져올 점수를 부르거나 패스해요. 한 번 패스하면 그 판에는 다시 못 불러요.</li>
        {/if}
        <li>점수는 {r.bidding.min}부터 {r.bidding.max}까지 부를 수 있고, 앞사람보다 높아야 해요.</li>
        {#if r.bidding.allow_no_trump}
          <li>
            노기루다(기루다 없음)도 부를 수 있어요.
            {#if r.bidding.no_trump_bonus > 0}
              노기루다 {josa(r.bidding.min - r.bidding.no_trump_bonus, '은', '는')} 기루다 {josa(r.bidding.min, '과', '와')} 같은 높이예요.
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
          {#if r.bidding.last_chance_min != null}
            모두 패스하면 첫 사람이 한 번 더, {r.bidding.last_chance_min}부터 부를 수 있어요. 또 패스하면 같은 사람이 다시
            나눠요.
          {:else}
            모두 패스하면 다시 나눠요.
          {/if}
        </li>
        <li>
          아무도 더 높게 부를 수 없는 공약({r.bidding.allow_no_trump ? '풀노' : `${r.bidding.max}`})이 나오면 공약은 바로
          끝나요.
        </li>
      </ul>
    </section>

    <section>
      <h2>키티와 프렌드</h2>
      <ul>
        <li>
          주공이 키티 {kitty(r)}장을 가져가고 {kitty(r)}장을 버려요. 버린 점수 카드는
          {r.scoring.discards_to_declarer ? '여당' : '야당'} 점수가 돼요.
          {r.reveal_discards === false ? '버린 카드는 끝나도 보여 주지 않아요.' : ''}
        </li>
        {#if r.bidding.raise_on_exchange}
          <li>버리기 전에 공약 수를 올릴 수 있어요. 기루다를 바꾸면서 더 올려도 돼요.</li>
        {/if}
        <li>
          {r.bidding.change_trump_cost > 0
            ? `기루다를 바꾸려면 공약을 ${r.bidding.change_trump_cost} 올려야 해요.`
            : '공약을 올리지 않고 기루다를 바꿀 수 있어요.'}
          {#if r.bidding.allow_no_trump && toNoTrumpCost(r) !== r.bidding.change_trump_cost}
            노기루다로 바꿀 때는 {toNoTrumpCost(r) > 0 ? `${toNoTrumpCost(r)}만 올려요` : '올리지 않아도 돼요'}.
          {/if}
          {#if r.bidding.allow_no_trump && fromNoTrumpCost(r) !== r.bidding.change_trump_cost}
            노기루다에서 무늬로 바꿀 때는 {fromNoTrumpCost(r)} 올려요.
          {/if}
        </li>
      </ul>
      <p>프렌드를 정하는 방법:</p>
      <ul>
        {#each friendWays(r) as way (way)}
          <li><SuitText text={way} /></li>
        {/each}
      </ul>
    </section>

    <section>
      <h2>카드의 힘</h2>
      <p>한 라운드는 위에 있는 카드가 이겨요.</p>
      <ol class="ladder">
        <li>
          <span class="cards" aria-hidden="true"><Card card={n('Spade', 14)} size="mini" seal="mighty" /></span>
          <span><strong>마이티</strong> <SuitText text="♠A. 기루다가 ♠이면 ♦A가 마이티예요." /></span>
        </li>
        {#if twoJokers}
          <li>
            <span class="cards" aria-hidden="true"><Card card={{ Joker: 'Black' }} size="mini" seal="joker" /></span>
            <span><strong>기루다 색 조커</strong> <SuitText text="기루다가 ♠♣이면 흑조커, ♥♦이면 홍조커. 노기루다면 처음 낸 색의 조커." /></span>
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
        <li>주공이 첫 라운드를 시작하고, 라운드를 이긴 사람이 다음 라운드를 시작해요.</li>
        <li>처음 낸 무늬가 있으면 그 무늬를 내야 해요. 없으면 아무 카드나 낼 수 있어요.</li>
        <li>
          마이티와 조커는 언제든 낼 수 있어요. 다만 마이티도 그 무늬의 카드라서, 그 무늬가 나왔는데 가진 게 마이티뿐이면
          마이티를 내야 해요. 조커가 있으면 조커를 내도 돼요. 조커는 낼 의무가 없어요.
        </li>
        <li>
          조커로 시작하면 따라 낼 무늬를 정해요.
          {#if twoJokers}조커 색의 무늬만 정할 수 있어요.{/if}
          {#if r.joker_lead.by_color}
            무늬 대신 색(빨강, 검정)을 정할 수도 있어요. 그러면 그 색 카드가 있는 사람은 그 색 카드를 내야 해요.
          {/if}
        </li>
        {#if r.joker_lead.powerless_passes}
          <li>힘이 없는 조커로 시작하면, 다음 사람이 낸 카드의 무늬가 처음 낸 무늬가 돼요.</li>
        {/if}
      </ul>
    </section>

    <section>
      <h2>조커콜</h2>
      <ul>
        {#each r.joker_call.calls as [call, fallback], i (i)}
          <li>
            <SuitText text={cardLabel(call)} />{#if 'Normal' in call && JSON.stringify(call) !== JSON.stringify(fallback)}(기루다가 <SuitText
                text={cardLabel(call).slice(0, 1)}
              />이면 <SuitText text={cardLabel(fallback)} />){/if} 카드로 라운드를 시작하면서 조커콜을 하면, {twoJokers
              ? cardLabel(jokers(r)[i])
              : '조커'}를 가진 사람은
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
            <li><strong>{row.round}</strong>에 {row.who}{row.who === '조커콜' ? '은' : '는'} <SuitText text={row.text} />.</li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h2>점수 계산</h2>
      <ul>
        <li>여당이 공약 이상을 가져오면 <strong>{formula}</strong>{note}만큼 얻어요.</li>
        {#each scoringLines(r) as line (line)}
          <li><SuitText text={line} /></li>
        {/each}
        <li>
          그 점수를 야당은 한 사람마다 내고, 프렌드는 한 몫을 받고, 주공은 야당 수만큼 받아서 프렌드 몫을 뺀 만큼 가져요.
          모두 더하면 항상 0이에요.
        </li>
      </ul>
      {#if examples}
        {@const { made, failed: lost, contract: bid } = examples}
        {@const opponents = r.players - (examples.alone ? 1 : 2)}
        <p class="example">
          예: <SuitIcon suit="Spade" inline label="스페이드" /> {bid.count} 공약에 {made.value.team_points}점을 가져오면 한 몫이 {made.value.value}점. 야당 {opponents}명이
          {signed(made.payoffs[r.players - 1])}씩,
          {#if !examples.alone}프렌드 {signed(made.payoffs[1])},{/if} 주공 {signed(made.payoffs[0])}.
          {lost.value.team_points}점에 그치면 한 몫이 {signed(lost.value.value)}점이에요.
        </p>
      {/if}
    </section>
  {/if}
</article>

<style>
  .book {
    /* A fill that reads on the page and on a sheet alike. */
    --tint: color-mix(in srgb, var(--ink) 7%, transparent);
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
    padding: 1px 8px;
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    color: var(--ink-muted);
    font-weight: 600;
    font-family: var(--font);
    font-size: var(--text-label);
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
    border-radius: var(--r-pill);
    background: var(--tint);
    font-size: var(--text-label);
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
    background: var(--tint);
    display: grid;
    place-items: center;
    font-size: var(--text-label);
    font-weight: 800;
  }
  .ladder strong {
    margin-right: 4px;
  }
  .failed {
    display: grid;
    gap: 16px;
  }
  .failed-actions {
    display: flex;
    gap: 8px;
  }
  .failed-actions:empty {
    display: none;
  }
  .example {
    padding: 10px 14px;
    border-radius: var(--r-control);
    background: var(--tint);
    font-size: 14px;
  }
</style>
