# Mighty rules as implemented

House rules are fields of `Rules` (`src/rules.rs`). The nine presets were
ported from web-mighty's `mighty/src/rule/mod.rs`; the game logic was
rewritten.

## A hand, step by step

1. **Deal.** 10 cards to each of 5 players. The rest form the kitty: 3 cards
   with one joker, 4 with two jokers.
2. **Bidding.** Starting at `first_bidder` and going around, each player bids
   a trump suit (or no-trump) and a point count, or passes. A pass is final.
   - A bid must outrank the best bid so far. A no-trump bid of `n` ranks as
     `n + no_trump_bonus`, and no-trump wins a tie.
   - A player whose hand qualifies under `misdeal` may ask for a redeal
     before they have bid.
   - When one bidder is left, they become the declarer. If everyone
     passes, the cards are redealt.
3. **Exchange.** The declarer takes the kitty. Before discarding, they may
   change trump once, adding `change_trump_cost` to the contract. They then
   discard as many cards as the kitty held and call a friend: by card, by
   seat, first-trick winner, last-trick winner, or alone.
4. **Play.** The declarer leads the first trick and the winner of each trick
   leads the next.
   - You must follow the led suit if you can. The mighty and jokers may
     always be played and never oblige you to follow.
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
   - A held-back card may also be played when the only other choice is a
     joker: holding only trump and a joker on the first trick forces trump.
5. **Trick winner.** The highest of these wins:
   1. the mighty
   2. the joker (with two jokers: the joker of the trump colour, or of the
      lead colour at no-trump)
   3. the highest trump
   4. with two jokers, the other joker, but only when the lead is not trump
      colour
   5. the highest card of the led suit

   A powerless mighty or trump counts as a plain card of its suit. A
   powerless joker cannot win. With `joker_lead.powerless_passes`, a joker
   led without power counts as played last: the first real card after it
   sets the suit for step 5. After a colour lead that card's suit is used
   too.
6. **Scoring.** The declarer's side counts the point cards (10 to A) it won,
   plus any in the discards.
   - If the side reaches the contract, it scores `points − 10`. This is
     doubled for no-trump, doubled again for playing alone, and doubled
     again for taking all 20 points.
   - If it falls short, it loses the shortfall, doubled when the side took
     10 or fewer points.
   - The declarer receives the score once per opponent, minus the friend's
     share. The friend receives it once. Each opponent pays it once.
     Payoffs always sum to zero.

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
- The minimum bid is 14.
- Each joker killer kills only the joker of its own colour: ♣3 the black
  joker, ♥3 the red one.
- Point cards in the declarer's discards count for the declarer's side.
- Mighty defense: when the joker is killed, its holder may play the mighty
  instead.
- The mighty and both jokers may be played at any time, even while
  holding the led suit, whatever the joker's colour.
- Jokers have no power on the first and last trick.
- A joker killer calls the joker only when it is led, and the called
  joker has no power.
- A led joker names a suit of its colour, or its colour; whoever holds a
  card of what it named must play one.
- A joker led without power counts as played last: the next card sets the
  suit that wins.
- Trump is held back on the first trick unless forced; holding only trump
  and a joker counts as forced.

## Still open

- **Scoring:** web-mighty's formula above, kept for now. Many groups
  instead use the bid above the minimum plus the points over the bid.
- **Bids above 20:** 대구과고 and 연세대 allow bids up to 23, which can never
  be made under this scoring.
