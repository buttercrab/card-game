<script lang="ts">
  // The rules of one preset in plain Korean, written from the server's
  // actual rule values so the book can never disagree with the game.
  import Card from './Card.svelte';
  import { cardLabel, jokers, kittyCount, rankLabel } from './cards';
  import { PRESET_NAME } from './presets';
  import { bidValue, handValue, scoring } from './scoring';
  import type { Card as CardT, CardPolicy, Contract, Rules, TrickPolicy } from './types';

  /** `rules` overrides the preset's: a table's own, or the preset's as the
   * table pinned them. `changed`: the table's players changed them (by
   * default, whenever `rules` is given). */
  let {
    preset,
    rules: given = null,
    changed = given !== null,
  }: { preset: string; rules?: Rules | null; changed?: boolean } = $props();

  let rules = $state<Rules | null>(null);
  /** Why the rules are missing: an id no preset has, or a failed fetch. */
  let failed = $state<'unknown' | 'network' | null>(null);
  let attempt = $state(0);
  const known = $derived(preset in PRESET_NAME);
  // On its own page (/rules/…) the book offers a way home; in a sheet the
  // sheet's own footer does that.
  const standalone = typeof location !== 'undefined' && location.pathname.startsWith('/rules/');

  $effect(() => {
    void attempt;
    rules = given;
    failed = null;
    if (given) return;
    if (!known) {
      failed = 'unknown';
      return;
    }
    fetch(`/api/presets/${preset}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((r: Rules) => (rules = r))
      .catch((status) => (failed = status === 404 ? 'unknown' : 'network'));
  });

  const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): CardT => ({ Normal: [suit, rank] });

  const kitty = kittyCount;

  const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

  /** The deck in words: 52장, or 7부터 A까지 28장과 ♣3, ♠3. */
  function deckText(r: Rules): string {
    const lowest = r.lowest_rank ?? 2;
    const extras = (r.extra_cards ?? []).map(cardLabel);
    const base = lowest === 2 ? '52장' : `네 무늬의 ${rankLabel(lowest)}부터 A까지 ${4 * (15 - lowest)}장`;
    return extras.length ? `${base}과 ${extras.join(', ')}` : base;
  }

  /** A made contract's worth: the formula, and a note after it. */
  function winFormula(r: Rules): [string, string] {
    const min = r.bidding.min;
    const w = scoring(r).win;
    if (typeof w === 'object') {
      const n = w.BothOver;
      return [`(가져온 점수 − ${n}) + (공약 − ${n})`, '(적어도 1)'];
    }
    return {
      OverTen: ['가져온 점수 − 10', '(적어도 1)'],
      OverMin: [`가져온 점수 − ${min}`, `(최소 공약 ${min}을 넘긴 만큼이라, 공약을 지켜도 0이나 그 아래일 수 있어요)`],
      OverBid: ['가져온 점수 − 공약', ''],
      BidBonus: [`가져온 점수 − 공약 + (공약 − ${min}) × 2`, '(높게 부를수록 더 얻어요)'],
    }[w] as [string, string];
  }

  /** The rest of the scoring rules as sentences. */
  function scoringLines(r: Rules): string[] {
    const s = scoring(r);
    const noTrump = r.bidding.allow_no_trump;
    const alone = r.friend?.alone ?? true;
    const winDoubles = [
      noTrump && s.no_trump !== 'Never' && '노기루다면',
      alone && s.alone !== 'Never' && '노프렌드면',
      s.run && '20점을 모두 가져오면(런)',
    ].filter((x): x is string => typeof x === 'string');
    const lines: string[] = [];
    if (winDoubles.length) lines.push(`이긴 점수는 ${winDoubles.join(', ')} 두 배씩이에요.`);
    const b = s.back_run;
    const backRun =
      b === 'Never'
        ? ''
        : b === 'DefenceReachesBid'
          ? ' 야당이 공약만큼 이상 가져갔다면(백런) 두 배로 잃어요.'
          : 'TeamAtMost' in b
            ? ` ${b.TeamAtMost}점 이하로 가져왔다면(백런) 두 배로 잃어요.`
            : ` ${b.ShortBy}점 이상 모자라면(백런) 두 배로 잃어요.`;
    const lose = s.lose ?? 'Shortfall';
    if (lose === 'Shortfall') lines.push(`공약을 못 채우면 모자란 만큼 잃어요.${backRun}`);
    else {
      const n = lose.PaysBack;
      // Under points − 10, (contract − 10) is what making it exactly pays.
      const why = s.win === 'OverTen' && n === 10 ? ' 딱 이겼을 때 받았을 점수를 물어 주는 셈이에요.' : '';
      lines.push(`공약을 못 채우면 (공약 − ${n})에 모자란 만큼을 더해 잃어요.${why}${backRun}`);
    }
    const lossDoubles = [
      noTrump && s.no_trump === 'Always' && '노기루다',
      alone && s.alone === 'Always' && '노프렌드',
    ].filter((x): x is string => typeof x === 'string');
    if (lossDoubles.length) lines.push(`${lossDoubles.join('와 ')}는 져도 두 배예요.`);
    const full = s.full_contract ?? 'Never';
    if (full !== 'Never') lines.push(`공약이 20이면 ${full === 'Always' ? '이기든 지든' : '이겼을 때'} 또 두 배예요.`);
    if (r.next_dealer === 'FriendOrDeclarer')
      lines.push('다음 판은 이번 판의 프렌드가, 프렌드가 없었으면 주공이 나누고 먼저 불러요.');
    return lines;
  }

  /** How much the contract's number rises to change to 노기루다 from a suit. */
  /** 은/는 or 과/와 after a number, by how it is read: 13 (십삼) takes 은. */
  function josa(n: number, closed: string, open: string): string {
    return `${n}${[0, 1, 3, 6, 7, 8].includes(n % 10) ? closed : open}`;
  }

  /** How much the number rises from 노기루다 to a suit: the cost, plus
   * what 노기루다 counted extra. */
  function fromNoTrumpCost(r: Rules): number {
    return r.bidding.change_trump_cost + r.bidding.no_trump_bonus;
  }

  function toNoTrumpCost(r: Rules): number {
    const b = r.bidding;
    return b.change_to_no_trump_cost ?? Math.max(b.change_trump_cost - b.no_trump_bonus, 0);
  }

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
      ['조커콜', r.policy.joker_call],
    ];
    const out: { who: string; round: string; text: string }[] = [];
    const say = (who: string, p: CardPolicy) =>
      who === '조커콜' ? (p === 'Valid' ? null : '할 수 없어요') : policyText(p);
    for (const [who, p] of rows) {
      // Trump that may not lead the first trick gets its own line below.
      const trumpLead = who === '기루다' && p.first === 'NoLead';
      const [first, last] = [trumpLead ? null : say(who, p.first), say(who, p.last)];
      if (first && first === last) out.push({ who, round: '첫 라운드와 마지막 라운드', text: first });
      else {
        if (first) out.push({ who, round: '첫 라운드', text: first });
        if (last) out.push({ who, round: '마지막 라운드', text: last });
      }
    }
    if (r.joker_lead?.not_first_trick) out.push({ who: '조커', round: '첫 라운드', text: '먼저 낼 수 없어요' });
    if (r.policy.trump.first === 'NoLead')
      out.push({
        who: '기루다',
        round: '첫 라운드',
        text:
          r.policy.release_with_mighty === false
            ? '먼저 낼 수 있는 경우가 손패가 기루다뿐이거나 기루다와 조커뿐일 때뿐이에요 (기루다와 마이티뿐이면 마이티를 내요)'
            : '먼저 낼 수 있는 경우가 손패가 기루다와 마이티, 조커뿐일 때뿐이에요',
      });
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
      f.alone &&
        {
          Never: '노프렌드: 혼자 해요. 야당 모두와 혼자 주고받아요.',
          Win: '노프렌드: 혼자 해요. 이기면 점수가 두 배예요.',
          Always: '노프렌드: 혼자 해요. 이기든 지든 점수가 두 배예요.',
        }[scoring(r).alone],
      f.fake && '자기가 가진 카드를 불러서 몰래 혼자 할 수도 있어요.',
    ].filter((x): x is string => typeof x === 'string');
  }

  function misdealText(r: Rules): string[] {
    const m = r.misdeal;
    if (!m) return [];
    // Values kept whole by doubling (a point card 2, a ten 1) read better
    // halved, as players count them: 1 and ½.
    const halve = m.point_value === 2 && m.joker_value % 2 === 0;
    const num = (v: number) => {
      if (!halve) return String(v);
      const whole = Math.trunc(v / 2);
      return v % 2 === 0 ? String(whole) : `${v < 0 ? '-' : ''}${whole !== 0 ? Math.abs(whole) : ''}½`;
    };
    const value = (v: number) => (v > 0 ? `+${num(v)}` : num(v));
    const parts = [`점수 카드 ${value(m.point_value)}`];
    if (m.joker_value !== 0) parts.push(`조커 ${value(m.joker_value)}`);
    for (const [card, v] of m.card_values) parts.push(`${cardLabel(card)} ${value(v)}`);
    const when = m.ask_first
      ? '패를 받자마자, 누가 첫 공약을 하기 전까지'
      : m.after_bidding
        ? '패를 받자마자, 공약이 끝나기 전까지 (이미 공약했더라도)'
        : '패를 받자마자, 자기가 공약하기 전까지';
    const lines = [
      `받은 패가 약하면 ${when} 다시 나눠 달라고 할 수 있어요 (딜미스). ${parts.join(', ')}점으로 세어 ${num(m.threshold)}점 이하일 때예요.`,
    ];
    lines.push('자기 차례가 아니어도 되고, 패스한 뒤에는 못 해요. 먼저 부른 사람의 딜미스예요. 그 사람은 패를 보여 줘요.');
    if (m.ask_first) lines.push('첫 공약은 패를 받고 2초쯤 기다렸다가 할 수 있어요. 그사이 딜미스할 사람이 있는지 봐요.');
    if (m.caller_deals) lines.push('딜미스를 한 사람이 새로 나눈 판에서 먼저 불러요.');
    if (m.all_points) lines.push('받은 카드가 모두 점수 카드여도 딜미스를 할 수 있어요.');
    if (m.declarer) lines.push('주공도 키티를 가져온 뒤 버리기 전에, 가진 카드 전부로 세어 딜미스를 할 수 있어요.');
    return lines;
  }
</script>

<article class="book">
  <header>
    <h1>
      {#if failed === 'unknown'}규칙을 찾을 수 없어요{:else}{PRESET_NAME[preset] ?? preset} 규칙{/if}{#if changed}<span
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

  {#if failed}
    <div class="failed" role="alert">
      <p class="muted">
        {#if failed === 'unknown'}
          ‘{preset}’라는 규칙은 없어요. 주소를 다시 확인해 주세요.
        {:else}
          규칙을 불러오지 못했어요. 연결을 확인하고 다시 해 보세요.
        {/if}
      </p>
      <div class="failed-actions">
        {#if standalone}<a class="home" href="/">홈으로</a>{/if}
        {#if failed === 'network'}<button onclick={() => attempt++}>다시 시도</button>{/if}
      </div>
    </div>
  {:else if !rules}
    <p class="muted">불러오는 중…</p>
  {:else}
    {@const r = rules}
    {@const twoJokers = jokers(r).length === 2}
    {@const [formula, note] = winFormula(r)}
    {@const f = r.friend}
    {@const withFriend = !f || f.by_card || f.by_seat || f.first_trick || f.last_trick}
    {@const opponents = r.players - (withFriend ? 2 : 1)}
    {@const bid = { trump: 'Spade' as const, count: r.bidding.min + 1 }}
    {@const v = handValue(r, bid, !withFriend, bid.count + 2)}
    {@const lost = handValue(r, bid, !withFriend, bid.count - 2)}
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
        {deckText(r)}에 조커 {jokers(r).length}장을 더해 {r.players}명에게 {r.hand_size}장씩 나누고, 남은 {kitty(r)}장은
        키티로 엎어 둬요.
      </p>
      {#each misdealText(r) as line (line)}<p>{line}</p>{/each}
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
          {scoring(r).discards_to_declarer ? '여당' : '야당'} 점수가 돼요.
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
        <li>주공이 첫 라운드를 시작하고, 라운드를 이긴 사람이 다음 라운드를 시작해요.</li>
        <li>처음 낸 무늬가 있으면 그 무늬를 내야 해요. 없으면 아무 카드나 낼 수 있어요.</li>
        <li>
          마이티와 조커는 언제든 낼 수 있어요. 다만 마이티도 그 무늬의 카드라서, 그 무늬가 나왔는데 가진 게 마이티뿐이면
          마이티를 내야 해요. 조커가 있으면 조커를 내도 돼요. 조커는 낼 의무가 없어요.
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
      <h2>조커콜</h2>
      <ul>
        {#each r.joker_call.calls as [call, fallback], i (i)}
          <li>
            {cardLabel(call)}{#if JSON.stringify(call) !== JSON.stringify(fallback)}(기루다가 {cardLabel(call).slice(0, 1)}이면 {cardLabel(
                fallback,
              )}){/if} 카드로 라운드를 시작하면서 조커콜을 하면, {twoJokers ? cardLabel(jokers(r)[i]) : '조커'}를 가진 사람은
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
            <li><strong>{row.round}</strong>에 {row.who}{row.who === '조커콜' ? '은' : '는'} {row.text}.</li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h2>점수 계산</h2>
      <ul>
        <li>여당이 공약 이상을 가져오면 <strong>{formula}</strong>{note}만큼 얻어요.</li>
        {#each scoringLines(r) as line (line)}
          <li>{line}</li>
        {/each}
        <li>
          그 점수를 야당은 한 사람마다 내고, 프렌드는 한 몫을 받고, 주공은 야당 수만큼 받아서 프렌드 몫을 뺀 만큼 가져요.
          모두 더하면 항상 0이에요.
        </li>
      </ul>
      <p class="example">
        예: ♠ {bid.count} 공약에 {bid.count + 2}점을 가져오면 한 몫이 {v}점. 야당 {opponents}명이 {signed(-v)}씩,
        {#if withFriend}프렌드 {signed(v)}, 주공 {signed(v * (opponents - 1))}.{:else}주공 {signed(v * opponents)}.{/if}
        {bid.count - 2}점에 그치면 한 몫이 {signed(lost)}점이에요.
      </p>
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
    border-radius: 999px;
    color: var(--ink-muted);
    font-weight: 600;
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
    background: var(--tint);
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
    background: var(--tint);
    display: grid;
    place-items: center;
    font-size: 13px;
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
  /* 홈으로 is a link dressed as the plain button. */
  .home {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--btn);
    color: var(--on-btn);
    box-shadow: 0 3px 0 var(--btn-lip);
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
  }
  .example {
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--tint);
    font-size: 14px;
  }
</style>
