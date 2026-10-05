# Mighty rules as implemented

House rules are fields of `Rules` (`src/rules.rs`). 기본 (`default`) is the
owner's written ruleset, below. The eight school presets were ported from
web-mighty's `mighty/src/rule/mod.rs` as changes to `Rules::default()`,
which therefore keeps web-mighty's base values, and all score a failed
contract as below ([실패 배상](#실패-배상-the-schools-loss));
`tests/presets.json` pins
every preset, so a change to one is always deliberate. The game logic was
rewritten.

## 기본

`Preset::Default` follows the owner's text exactly; nothing in it is
filled in from other rulesets. Each rule and how it is expressed
(scenario tests in `tests/basic.rs`, scoring in `src/state.rs`):

| Rule | Expressed as |
| --- | --- |
| 53 cards, one joker; 20 point cards | `OneJoker` deck |
| Mighty ♠A (♦A when ♠ is trump), joker call ♣3 (♠3 when ♣ is trump); 노기루다: ♠A and ♣3 | As everywhere |
| Counterclockwise play | Seat numbers rise in playing order; the table draws them counterclockwise |
| Deal 1-2-3-4 from the dealer's right, 3 face down | One shuffled deal; the order of handing out does not change what anyone gets |
| Misdeal: everyone answers at once, nearest the dealer (dealer first) wins | `misdeal.ask_first`: from the dealer round, answers in turn and hidden; the first "misdeal" ends the round. The same caller wins as if all answered at once, and a later answer only ever matters when everyone before said no |
| Misdeal value ≤ ½: J, Q, K, A 1, 10 ½, ♠A 0, joker −1 | Doubled: `point_value` 2, tens 1, ♠A 0, `joker_value` −2, `threshold` 1 |
| Misdeal caller shows the hand and deals next | `Redeal::Misdeal` shows it; `misdeal.caller_deals` |
| Dealer bids first; difficulty = count, +1 for 노기루다; count ≤ 20 | `first_bidder` is the dealer; `no_trump_bonus` 1, `no_trump_wins_ties` off, `max` 20 |
| First bid difficulty ≥ 14, then strictly higher; a pass is final | `min` 14, `pass_is_final` |
| 풀노 (difficulty 21) cannot be topped | The bidding ends at once |
| Five passes: the dealer may bid ≥ 13 once; a second pass redeals with the same dealer, not a misdeal | `bidding.last_chance_min` 13; `Redeal::AllPassed`, `first_bidder` kept |
| Several bidders go on among themselves | Passes are final, so only they get turns |
| Contract after the kitty: keep trump and raise or stay; change trump for difficulty +2 or more; ≤ 20 | `ChangeTrump` (the least change: suit→suit +2, suit→노기루다 +1, 노기루다→suit +3) and, with `bidding.raise_on_exchange`, `Raise` to anything higher |
| Discard any three cards; they count for the declarer; never shown | Any card may be discarded; `scoring.discards_to_declarer`; `reveal_discards` off (only the declarer sees them) |
| Friend: none, card (own or discarded card: false no-friend), named player, first trick (declarer winning it: false no-friend) | `friend.alone`, `by_card` with `fake`, `by_seat`, `first_trick`; no `last_trick` |
| Reveal: named at once, card when played, first trick at its end | As the engine always does |
| Follow suit; mighty and joker any time; never obliged to play the joker | As everywhere |
| Led suit is the mighty's, the mighty is your only card of it: play it, or the joker if you have one | The mighty counts as its suit; jokers are always free |
| Trick 1: declarer may not lead the joker, nor trump unless 10 trumps or 9 + joker (9 + mighty: lead the mighty); joker call has no effect; a joker is weak | `joker_lead.not_first_trick`; `policy.trump.first` `NoLead` with `policy.release_with_mighty` off; `policy.joker_call` `NoEffect` on the first trick; `policy.joker` `NoEffect` |
| Tricks 2–9: a joker lead names one suit; joker call (leader says if on) makes every holder play the joker weak, or the mighty instead | Joker leads name a suit (one joker, no colour leads); `mighty_defense`; called joker powerless |
| Trick 10: joker call no effect; joker lead names a suit; joker weak | `policy.joker_call` and `policy.joker` `NoEffect` on the last trick |
| Order: mighty, strong joker, trump, led suit, weak joker, the rest | As everywhere; a weak joker wins only when it led and nothing followed, as `trick::winner` falls back to the leader |
| P ≥ C wins; run P = 20; back-run P ≤ 10 | `run`, `back_run: TeamAtMost(10)` |
| B = max(1, (P − 13) + (C − 13)) on a win, P − C on a loss | `scoring.win: BothOver(13)`, `scoring.lose: Shortfall` |
| M doubles for 노기루다, no friend (not false), run, back-run, C = 20 | `no_trump` and `alone` `Always`, `run`, `back_run`, `full_contract: Always`. "Whichever side wins" is read as applying to all five, since M is one number for the hand |
| Defenders −BM, friend +BM, declarer the rest | As everywhere: 2BM with a friend, 4BM without |
| Next dealer: the friend, else the declarer; after a misdeal its caller; after five passes twice the same | `next_dealer: FriendOrDeclarer` (the server passes the last hand's summary), `caller_deals`, `first_bidder` kept |
| Point cards face down for the declarer and a revealed friend | Display only; the engine gives every seat's points to everyone, as the text says |

Not expressible or left to others:

- The session's first dealer is random in the text; the server starts at
  seat 0 (it already shuffles nobody's seat, so this only names who
  deals first).
- The face-down point piles are for the table UI.
- The web table shows the misdeal round as 딜미스 / 딜미스 아님, the
  dealer's extra turn, `Raise` beside the trump change, and says when the
  discards stay hidden; the rule editor has every option above except the
  player-count ones (`lowest_rank`, `extra_cards`), since the table seats
  five and a five-player deck needs all 53 cards.

## A hand, step by step

1. **Deal.** 10 cards to each of 5 players. The rest form the kitty: 3 cards
   with one joker, 4 with two jokers. The deck runs from `lowest_rank` (2)
   to A, plus any `extra_cards`; `Rules::for_players` adapts five-player
   rules to 3마 (7 to A, no friend, ♣7 calls the joker), 4마 (5 to A plus
   the joker-call threes), 6마 (8 cards each) and 7마 (7 each). The server
   and table still seat five; other counts run in the engine and simulator.
2. **Bidding.** Starting at `first_bidder` and going around, each player bids
   a trump suit (or no-trump) and a point count, or passes. A pass is final,
   unless `pass_is_final` is off: then a bid lets everyone answer again,
   including those who passed, and the bidding ends when everyone else
   has passed in a row.
   - A bid must outrank the best bid so far. A no-trump bid of `n` ranks as
     `n + no_trump_bonus`, also against the minimum bid. With
     `no_trump_wins_ties`, no-trump wins a tie; otherwise a bid must rank
     strictly higher. Which applies is a local rule.
   - A player whose hand qualifies under `misdeal` may ask for a redeal
     before they have bid, or on any turn of theirs with
     `misdeal.after_bidding`. `misdeal.all_points` also lets a hand of
     nothing but point cards qualify.
   - When one bidder is left, they become the declarer. A bid nobody can
     top (풀노, or the top bid wherever no-trump cannot beat it) makes its
     bidder declarer at once, so nobody can throw the deal in after it.
     If everyone passes, the cards are redealt.
3. **Exchange.** The declarer takes the kitty. With `misdeal.declarer`, a
   declarer whose cards, kitty included, qualify may still throw the deal
   in before discarding. Before discarding, they may change trump once:
   what the contract is worth rises by `change_trump_cost`, or, to
   no-trump, its number rises by `change_to_no_trump_cost` when set. They
   then discard as many cards as the kitty held and call a friend: by card,
   by seat, first-trick winner, last-trick winner, or alone.
4. **Play.** The declarer leads the first trick and the winner of each trick
   leads the next.
   - You must follow the led suit if you can. The mighty and jokers may
     always be played. Jokers never oblige you to follow, but the mighty is
     still a card of its suit: when that suit is led and the mighty is the
     only one you hold, you must play it.
   - Leading a joker names the suit to follow. With two jokers, the suit
     must match the joker's colour. With `joker_lead.by_color` it may name
     its colour instead, and a card of either suit of that colour follows.
   - Leading a joker killer (조커콜: ♣3, or ♠3 when clubs are trump) with
     a call makes the joker's holder play the joker, which then has no
     power unless `called_joker_has_power`. With `mighty_defense`, they may
     play the mighty instead. With two jokers, each joker has its own
     killer; 경기과고 adds ♥3 (♦3 when hearts are trump).
   - Card policies limit what can be played on the first and last trick.
     `Invalid` means not at all and `NoLead` means not as a lead (both unless
     nothing else is legal). `NoEffect` cards can be played but lose their
     power. An `Invalid` card may still follow suit: when a joker names the
     trump suit on the first trick, holding trump means following with it.
     By default jokers have no power on the first and last trick (confirmed
     for 경기과고).
   - A held-back card may also be played when the only other choices are
     jokers and the mighty: holding only trump, jokers and the mighty on
     the first trick lets trump be played too.
5. **Trick winner.** The highest of these wins:
   1. the mighty
   2. the joker (with two jokers: the joker of the trump colour, or of the
      lead colour at no-trump)
   3. the highest trump
   4. with two jokers, the other joker
   5. the highest card of the led suit

   A powerless mighty or trump counts as a plain card of its suit. A
   powerless joker cannot win. With `joker_lead.powerless_passes`, a joker
   led without power counts as played last: the first real card after it
   sets the suit for step 5. After a colour lead that card's suit is used
   too.
6. **Scoring.** The declarer's side counts the point cards (10 to A) it won,
   plus any in the discards (unless `scoring.discards_to_declarer` is off;
   then they count for the defence). By default (`Scoring::default`):
   - If the side reaches the contract, it scores `points − 10`, at least 1.
     This is doubled for no-trump, doubled again for playing alone, and
     doubled again for taking all 20 points.
   - If it falls short, it loses the shortfall, doubled when the side took
     10 or fewer points. The school presets lose more: see
     [실패 배상](#실패-배상-the-schools-loss).
   - The declarer receives the score once per opponent, minus the friend's
     share. The friend receives it once. Each opponent pays it once.
     Payoffs always sum to zero.

   `scoring.win` picks the made-contract formula: `OverTen` (above),
   `OverMin` (points − minimum bid; a made contract can score 0 or less),
   `OverBid` (points − contract) or `BidBonus` (points − contract + 2 ×
   how far the bid ranks above the minimum, which 나무위키 calls the usual
   one). `scoring.lose` picks the failed-contract cost before doubling:
   `Shortfall` (contract − points) or `PaysBack(n)` ((contract − n) +
   the shortfall; `n` may not exceed the lowest contract, so a failure
   never pays). `no_trump` and `alone` double `Never`, on a `Win`, or `Always`;
   `run` doubles a 20-point win; `back_run` doubles a loss `Never`, when
   the side took at most `n` (`TeamAtMost`), missed by at least `n`
   (`ShortBy`) or the defence took the contract's worth
   (`DefenceReachesBid`).

## 실패 배상, the schools' loss

Owner, 2026-10-05: every school preset (all but 기본) scores a failed
contract as **what it would have won made exactly, plus the shortfall**
(`scoring.lose: PaysBack(10)`); a made contract still scores `points −
10`, at least 1. The doublings then apply as before: 백런 doubles the
whole loss.

| Preset | Made | Failed | Doubled |
| --- | --- | --- | --- |
| 기본 | max(1, (P − 13) + (C − 13)) | C − P | 노기루다, 노프렌드, 런, 백런 (P ≤ 10), C = 20; win or lose |
| 대전동신과고, 대구과고, 민사고, 광주과고, 경기과고, 성균관대, 서울과고, 연세대 | max(1, P − 10) | (C − 10) + (C − P) | 노기루다, 노프렌드, 런 on a win; 백런 (P ≤ 10) on a loss |

Why: under the shortfall alone a failed contract barely costs, so a bid
is nearly a free shot and the bots overbid. At 16, a made contract pays
about 6 and a failure by 2 cost 2, so bidding paid from a make rate of
about 25%. Paying back puts the break-even make rate near 60%, 57% and
56% at bids of 14, 16 and 18: a bid has to be more likely made than not.

경기과고, one opponent's payment (the declarer gets it three times less
the friend's share with a friend, four times alone):

| Contract, points taken | Before | Now |
| --- | --- | --- |
| 14, 14 | 4 | 4 |
| 14, 16 | 6 | 6 |
| 14, 13 | −1 | −5 |
| 16, 13 | −3 | −9 |
| 14, 10 (백런) | −8 | −16 |
| 노기루다 15, 13 | −2 | −7 |

## Not ported from web-mighty

- **Unordered bidding** and **equal bids**: bids always go in turn and must
  rise. web-mighty's 경기과고 preset turned both flags off.
- **`Visibility`, `Dealer`, `Timing`**: who sees what after a hand, who deals
  next, and turn timers belong to the session and server layers, not to one
  hand.
- **`pattern_order`**: it only breaks ties between identical cards, which a
  single deck never has.
- **`first_offset`**: every preset set it to 0.
- **The SKKU friend-reveal timing**: web-mighty left it unimplemented.

## Confirmed for 경기과고 (`gshs`), the table's default

- Bidding goes in turn and every bid must be higher than the last.
- 노기루다 counts one more than it says: 노기루다 14 is worth ♠ 15, so a suit
  must say 16 to overrule it, and 노기루다 13 meets the minimum of 14. An
  equal bid never overrules (assumed; the user said it varies by group).
- The minimum bid is 14.
- Each joker killer kills only the joker of its own colour: ♣3 the black
  joker, ♥3 the red one.
- Point cards in the declarer's discards count for the declarer's side.
- Mighty defense: when the joker is killed, its holder may play the mighty
  instead.
- The mighty and both jokers may be played at any time, even while
  holding the led suit, whatever the joker's colour.
- The mighty counts as its own suit: if that suit is led and the mighty is
  your only card of it, you must play the mighty.
- Jokers have no power on the first and last trick.
- Trump may not lead the first trick; the other four may play it there.
- Misdeal: a hand worth one point card or less (point cards 1, joker −½,
  ♠A −1) may be thrown in (owner, 2026-10-05; it was ½ or less).
- Trick order: the mighty, the joker of trump's colour, trump, the other
  joker, then everything else. With ♠ trump, 홍조커 beats a ♣ lead but
  loses to a ♠ lead, which is trump.
- A joker killer calls the joker only when it is led, and the called
  joker has no power.
- A led joker names a suit of its colour, or its colour; whoever holds a
  card of what it named must play one.
- A joker led without power counts as played last: the next card sets the
  suit that wins.
- Trump may not lead the first trick unless the leader holds nothing else
  (only trump and a joker counts as nothing else); everyone after the
  leader may play trump on it.
- A failed contract pays back what it would have won made exactly, plus
  the shortfall ([실패 배상](#실패-배상-the-schools-loss); owner,
  2026-10-05).

## Still open

- **Scoring:** 기본 scores as its text says; every school preset scores
  a made contract by web-mighty's formula above and a failed one by
  [실패 배상](#실패-배상-the-schools-loss). 나무위키's usual one
  (`BidBonus`) is an option.
- **Bids above 20:** 대구과고 and 연세대 allow bids up to 23, which can never
  be made. 나무위키's 신촌 5마 says that is the point: a bid to sink
  whoever is leading.

## Compared with 나무위키

Checked against 나무위키's [마이티](https://namu.wiki/w/마이티) (sections
4.2 선거과정, 4.3 딜 미스, 4.4 프렌드, 4.5 라운드 진행, 4.6 세부 진행, 4.7
점수 계산, 5 타 인원수 플레이방법; revision of 2026-09-20),
[마이티/지역별 규칙](https://namu.wiki/w/마이티/지역별%20규칙) (2026-09-14)
and [마이티/전술 및 전략](https://namu.wiki/w/마이티/전술%20및%20전략)
(3.5–3.8 프렌드, 4.3 조콜). The former sub-pages 세부 규칙 and 인원별 규칙
were merged into the main article in August 2026. Struck-through lines
(rules a group no longer plays) were left out.

"Default" below means `Rules::default()`, web-mighty's base that the school
presets build on; 기본 is described in its own section above.

| Rule | 나무위키 | We do | Status |
| --- | --- | --- | --- |
| Deck and deal | 52 + 1 joker, 10 each, 3 face down | Same; 경기과고 two jokers, 4 down | Matches (gshs is a house variant) |
| 3마 | 7 to A + joker (33), no friend, joker call ♣7 (♠7) | `Rules::for_players(3)` | Added (engine and sim only) |
| 4마 | 5 to A + joker + ♣3, ♠3 (43); local min 14–15 | `for_players(4)`; minimum unchanged | Added (engine and sim only) |
| 6마, 7마 | Main: 5마 with the dealer sitting out; 대전/동대전: 8 each + 5 down, 7 each + 4 down, 7마 calls two friend cards | `for_players(6/7)` deals 8/7 each with one friend | Added in part; sitting out is a server seating rule, two friends missing |
| Misdeal hand | No point cards; local: only a 10, only one point card, joker + one point card, all ten point cards | Weighted count and threshold; `misdeal.all_points` new | Matches; all-points added (off everywhere; 나무위키 has it for 서울과고 and 신촌) |
| When to call misdeal | On your turn to bid, even after bidding (4.3 and its footnote) | Before you have bid; `misdeal.after_bidding` | Differs by default; option added |
| Declarer's misdeal | Declarer holding 13 cards with no point card may call it | `misdeal.declarer` | Added, off everywhere |
| Misdeal penalty | Caller −5 into a pot the next winning 여당 shares 3:2; all-pass −1 or 0 | Nothing: payoffs are per hand | Missing (needs session scoring) |
| First bid | Dealer must open (local: may pass) | `first_bidder_may_pass` on by default; off for dshs, yonsei | Differs by default (judgement call) |
| Raising | Higher than the last, any jump; same count no-trump beats a suit | Same; gshs counts no-trump one more and ties never win | Matches |
| 풀노 | Ends the bidding at once; calling it is how to stop a misdeal | Bidding went on and others could still misdeal | **Fixed**: an unbeatable bid ends the bidding |
| Passing | Bidding ends after four passes in a row; the footnote's example has players bid again after passing | A pass is final; `bidding.pass_is_final` | Differs by default; option added |
| Minimum bid | 13 | 13; presets 12–14 | Matches |
| Kitty | Declarer takes 3, buries 3; buried points are 여당's (신촌's struck rule gave them to 야당) | Same; `scoring.discards_to_declarer` | Matches; option added |
| Changing trump | +2, to no-trump +1, once; 19 with trump can only become 풀노 | +`change_trump_cost` in worth, so to no-trump +2 by default (+1 in gshs, whose no-trump counts one more); `change_to_no_trump_cost` | Differs by default; option added |
| Friend | Card, 초구, 막구 (local), 너 프렌드, 노프 | All five | Matches |
| Fake friend | Own or buried card: plays as 노프 without its doubling | `friend.fake`; the declarer collects from all four, no alone doubling | Matches |
| 초구 friend | Declarer winning the first trick means no friend | Same | Matches |
| Following | Follow the led suit; mighty and joker any time | Same; the mighty still belongs to its suit | Matches |
| Trick order | Mighty > joker > trump > led suit > others > powerless joker | Same | Matches |
| Mighty | ♠A; ♦A when spades are trump | Same | Matches |
| Trump on the first trick | Declarer may not lead it unless all ten are trump; others may (초간) | `policy.trump.first = NoLead`: lead it only holding nothing but trump, jokers and the mighty | House variant (confirmed for gshs), slightly looser |
| Joker, first and last trick | No power | `policy.joker` NoEffect by default | Matches |
| Joker lead | Names the suit to follow | Same; gshs may name a colour | Matches |
| Joker call | ♣3 (♠3 when clubs are trump), optional; joker must come out powerless | Same | Matches |
| Joker call on the first trick | Only on tricks 2–9 | Allowed on the first trick by default; off for sshs, yonsei | Differs by default (judgement call) |
| Mighty defence | Holder of joker and mighty may play the mighty | `mighty_defense` on by default | Matches |
| Uncalled joker, joker gone | Keeps its power; a call after the joker is out does nothing | Same | Matches |
| Win score | points − 10, − 13, − bid, or (usual) − bid + (bid − 13) × 2 | `points − 10` by default; `scoring.win` | Default is one listed; the usual one added |
| Win doubling | No-trump ×2, run ×2 | Same | Matches |
| Playing alone | Declarer collects from all four (×4); 신촌, 수원, 부산대 also double | Also doubles by default; `scoring.alone` | House variant as default (judgement call) |
| Loss | bid − points; ×2 when 야당 took 11+ (백런); local: no-trump ×2 | ×2 when the side took 10 or fewer (민사's 야당 10+); `scoring.back_run`, `no_trump: Always`; the school presets also pay back bid − 10 (`scoring.lose`) | Differs by one point by default; options added; schools differ by the owner's choice |
| Shares | Declarer 2, friend 1, each opponent −1 | Same | Matches |

Regional rules (지역별 규칙) against the presets, for the owner:

- **서울과고 5마 / `sshs`:** minimum 14 (ours 13), no-trump one lower
  (ours none), all point cards is a misdeal (`misdeal.all_points`, left off so the preset is unchanged), no doubling for 노프렌드
  mentioned.
- **민사 5마 / `kmla`:** matches (one point card, joker subtracts one, no
  mighty defence, 백런 at 야당 10+).
- **신촌 5마 / `yonsei`:** says no-trump may be bid one lower (ours: no
  no-trump at all) and changing to no-trump costs 1; misdeal on a lone
  one-eyed jack (♠J, ♥J) or the mighty, where ours lists ♠10, ♥10 and ♠A;
  all point cards is a misdeal (`misdeal.all_points`, left off so the preset is unchanged).
- **동대전 5마 / `ddshs`:** the play matches the 대전동신과고 preset (no
  no-trump, card friend only, +1 to change, ♣3 always calls); the owner
  confirmed the preset's name is 대전동신과고 (it was once misnamed
  대구동신과고). The scoring differs: 나무위키 scores |bid − points| with no
  doubling, while the preset scores like every school preset, `points −
  10` (at least 1) when made and [실패 배상](#실패-배상-the-schools-loss)
  when failed, with the default doublings.
- **수원 5마 / `skku`:** matches (minimum 12, free trump change, jokers
  valid on the first and last trick, trump may lead the first trick, a
  called joker keeps its power, 노프렌드 doubles).
- **광주 5마 / `gsa`:** no-trump one lower (ours none); changing to a
  higher suit (♠>♦>♥>♣) is free; the joker is a 21st point card. Not
  done.
- **대구 5마 / `dshs`:** matches.
- **경기 5마 / `gshs`:** confirmed by the owner, as above. 나무위키 differs
  in places: minimum 13, the joker counting 0 (ours −½) in the misdeal
  count, and equal bids settled by 가위바위보.

Not implemented, from the regional page: 백석's ♣2 joker call that always
calls; 관악's mighty that names a suit when led and its counting from the
defence; the joker as a point card (광주); 경기 변형's first joker wins;
인천's no trump lead until void; 이우's free trump; 동대전 7마's two friend
cards; 수원's friend revealing on scoring; 서울과고's seat friend only among
bidders.
