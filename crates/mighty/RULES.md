# Mighty rules as implemented

House rules are fields of `Rules` (`src/rules.rs`). The nine presets were
ported from web-mighty's `mighty/src/rule/mod.rs`; the game logic was
rewritten.

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
     10 or fewer points.
   - The declarer receives the score once per opponent, minus the friend's
     share. The friend receives it once. Each opponent pays it once.
     Payoffs always sum to zero.

   `scoring.win` picks the made-contract formula: `OverTen` (above),
   `OverMin` (points − minimum bid; a made contract can score 0 or less),
   `OverBid` (points − contract) or `BidBonus` (points − contract + 2 ×
   how far the bid ranks above the minimum, which 나무위키 calls the usual
   one). `no_trump` and `alone` double `Never`, on a `Win`, or `Always`;
   `run` doubles a 20-point win; `back_run` doubles a loss `Never`, when
   the side took at most `n` (`TeamAtMost`), missed by at least `n`
   (`ShortBy`) or the defence took the contract's worth
   (`DefenceReachesBid`).

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

## Confirmed for 경기과고 (`gshs`), our default

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

## Still open

- **Scoring:** every preset still uses web-mighty's formula above. The
  usual one by 나무위키 (`BidBonus`) is an option; which preset should use
  it is the owner's call (see below).
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

"Default" below means `Rules::default()`, the `default` preset.

| Rule | 나무위키 | We do | Status |
| --- | --- | --- | --- |
| Deck and deal | 52 + 1 joker, 10 each, 3 face down | Same; 경기과고 two jokers, 4 down | Matches (gshs is a house variant) |
| 3마 | 7 to A + joker (33), no friend, joker call ♣7 (♠7) | `Rules::for_players(3)` | Added (engine and sim only) |
| 4마 | 5 to A + joker + ♣3, ♠3 (43); local min 14–15 | `for_players(4)`; minimum unchanged | Added (engine and sim only) |
| 6마, 7마 | Main: 5마 with the dealer sitting out; 대전/동대전: 8 each + 5 down, 7 each + 4 down, 7마 calls two friend cards | `for_players(6/7)` deals 8/7 each with one friend | Added in part; sitting out is a server seating rule, two friends missing |
| Misdeal hand | No point cards; local: only a 10, only one point card, joker + one point card, all ten point cards | Weighted count and threshold; `misdeal.all_points` new | Matches; all-points added (on for sshs, yonsei) |
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
| Loss | bid − points; ×2 when 야당 took 11+ (백런); local: no-trump ×2 | ×2 when the side took 10 or fewer (민사's 야당 10+); `scoring.back_run`, `no_trump: Always` | Differs by one point by default; options added |
| Shares | Declarer 2, friend 1, each opponent −1 | Same | Matches |

Regional rules (지역별 규칙) against the presets, for the owner:

- **서울과고 5마 / `sshs`:** minimum 14 (ours 13), no-trump one lower
  (ours none), all point cards is a misdeal (now on), no doubling for 노프렌드
  mentioned.
- **민사 5마 / `kmla`:** matches (one point card, joker subtracts one, no
  mighty defence, 백런 at 야당 10+).
- **신촌 5마 / `yonsei`:** says no-trump may be bid one lower (ours: no
  no-trump at all) and changing to no-trump costs 1; misdeal on a lone
  one-eyed jack (♠J, ♥J) or the mighty, where ours lists ♠10, ♥10 and ♠A;
  all point cards is a misdeal (now on).
- **동대전 5마 / `ddshs`:** the rules match 대전동신과학고 (no no-trump, card
  friend only, +1 to change, ♣3 always calls), so the preset's name 대구동신과고
  may be wrong. Its scoring is |bid − points| with no doubling
  (`OverBid`).
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
