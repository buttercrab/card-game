use crate::card::{Card, Color, DeckKind, Suit};
use engine::Seat;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a trick's other cards must follow: a suit, or, when a joker leads
/// and the rules allow it, a whole colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Lead {
    Suit(Suit),
    Color(Color),
}

impl Lead {
    pub fn color(self) -> Color {
        match self {
            Lead::Suit(suit) => suit.color(),
            Lead::Color(color) => color,
        }
    }

    /// Whether `card` follows this lead. Jokers follow nothing.
    pub fn follows(self, card: Card) -> bool {
        match (self, card.suit()) {
            (Lead::Suit(lead), Some(suit)) => suit == lead,
            (Lead::Color(lead), Some(suit)) => suit.color() == lead,
            (_, None) => false,
        }
    }
}

/// A card on the table. `powered` is false when a rule stripped its special
/// power: a powerless mighty or trump counts as a plain card of its suit,
/// and a powerless joker cannot win.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct Played {
    pub seat: Seat,
    pub card: Card,
    pub powered: bool,
}

/// A completed trick. Every card in it was played face up.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct Trick {
    pub plays: Vec<Played>,
    pub lead: Lead,
    pub winner: Seat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrickContext {
    pub trump: Option<Suit>,
    pub mighty: Card,
    pub deck: DeckKind,
    /// What others must follow: the led card's suit, or the suit or colour
    /// declared when a joker is led.
    pub lead: Lead,
    /// A joker led without power counts as played last: the next card sets
    /// the suit that wins.
    pub powerless_joker_passes: bool,
}

/// Index into `plays` of the card currently winning the trick.
pub fn winner(ctx: &TrickContext, plays: &[Played]) -> usize {
    let find = |pred: &dyn Fn(&Played) -> bool| plays.iter().position(pred);

    if let Some(i) = find(&|p| p.powered && p.card == ctx.mighty) {
        return i;
    }

    let (main_joker, sub_joker) = jokers(ctx);
    if let Some(i) = main_joker.and_then(|j| find(&|p| p.powered && p.card == j)) {
        return i;
    }
    let trumps = plays.iter().enumerate().filter(|(_, p)| p.powered && is_trump(ctx, p));
    if let Some((i, _)) = trumps.max_by_key(|(_, p)| p.card.rank()) {
        return i;
    }
    if let Some(i) = sub_joker.and_then(|j| find(&|p| p.powered && p.card == j)) {
        return i;
    }
    // Everything with power is gone; powerless trumps and mighty count as plain cards.
    let suit = winning_suit(ctx, plays);
    plays
        .iter()
        .enumerate()
        .filter(|(_, p)| suit.is_some() && p.card.suit() == suit)
        .max_by_key(|(_, p)| p.card.rank())
        .map_or(0, |(i, _)| i)
}

/// The joker that ranks just under the mighty, and the one, with two
/// jokers and a trump, that ranks between trumps and plain cards.
fn jokers(ctx: &TrickContext) -> (Option<Card>, Option<Card>) {
    match (ctx.deck, ctx.trump) {
        (DeckKind::OneJoker, _) => (Some(Card::Joker(Color::Black)), None),
        // Mighty, then the trump-colour joker, then trump, then the other
        // joker, then everything else.
        (DeckKind::TwoJokers, Some(trump)) => (
            Some(Card::Joker(trump.color())),
            Some(Card::Joker(other(trump.color()))),
        ),
        (DeckKind::TwoJokers, None) => (Some(Card::Joker(ctx.lead.color())), None),
    }
}

/// Which plain cards can win a two-card trick: those of one suit, or,
/// after a joker that sets no suit, any suited card (the second card
/// sets it).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlainSuit {
    Suit(Suit),
    Any,
}

/// [`PlainSuit`] for a two-card trick led by `first`.
pub(crate) fn plain_suit(ctx: &TrickContext, first: &Played) -> PlainSuit {
    let passed = ctx.powerless_joker_passes && first.card.is_joker() && !first.powered;
    match (ctx.lead, first.card.suit()) {
        (Lead::Suit(suit), _) if !passed => PlainSuit::Suit(suit),
        (_, Some(suit)) => PlainSuit::Suit(suit),
        (_, None) => PlainSuit::Any,
    }
}

/// [`winner`] of a two-card trick as an order: with `suit` from
/// [`plain_suit`] of the first card, the second card wins exactly when
/// its key is greater. Keys rank the mighty, the main joker, trumps by
/// rank, the other joker, plain cards of the winning suit by rank, and
/// everything else, in that order; the tests check it card by card.
pub(crate) fn power(ctx: &TrickContext, suit: PlainSuit, p: &Played) -> u16 {
    let (main_joker, sub_joker) = jokers(ctx);
    let rank = u16::from(p.card.rank().unwrap_or(0));
    let tier = |tier: u16| tier * 16;
    if p.powered && p.card == ctx.mighty {
        tier(5)
    } else if p.powered && Some(p.card) == main_joker {
        tier(4)
    } else if p.powered && is_trump(ctx, p) {
        tier(3) + rank
    } else if p.powered && Some(p.card) == sub_joker {
        tier(2)
    } else if p
        .card
        .suit()
        .is_some_and(|s| suit == PlainSuit::Any || suit == PlainSuit::Suit(s))
    {
        tier(1) + rank
    } else {
        0
    }
}

/// The suit whose highest card wins when no card with power is played.
fn winning_suit(ctx: &TrickContext, plays: &[Played]) -> Option<Suit> {
    let first_card_suit = || plays.iter().find_map(|p| p.card.suit());
    let passed = ctx.powerless_joker_passes && plays.first().is_some_and(|p| p.card.is_joker() && !p.powered);
    match ctx.lead {
        Lead::Suit(suit) if !passed => Some(suit),
        // A colour, or a joker that counts as played last: the first real
        // card sets the suit.
        _ => first_card_suit(),
    }
}

fn is_trump(ctx: &TrickContext, p: &Played) -> bool {
    p.card != ctx.mighty && p.card.suit().is_some() && p.card.suit() == ctx.trump
}

fn other(color: Color) -> Color {
    match color {
        Color::Black => Color::Red,
        Color::Red => Color::Black,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::ACE;

    fn ctx(deck: DeckKind, trump: Option<Suit>, lead: Suit) -> TrickContext {
        ctx_lead(deck, trump, Lead::Suit(lead), false)
    }

    fn ctx_lead(deck: DeckKind, trump: Option<Suit>, lead: Lead, passes: bool) -> TrickContext {
        let mighty = if trump == Some(Suit::Spade) {
            Card::new(Suit::Diamond, ACE)
        } else {
            Card::new(Suit::Spade, ACE)
        };
        TrickContext {
            trump,
            mighty,
            deck,
            lead,
            powerless_joker_passes: passes,
        }
    }

    fn plays(cards: &[(Card, bool)]) -> Vec<Played> {
        cards
            .iter()
            .enumerate()
            .map(|(seat, &(card, powered))| Played { seat, card, powered })
            .collect()
    }

    const BJ: Card = Card::Joker(Color::Black);
    const RJ: Card = Card::Joker(Color::Red);
    const SA: Card = Card::new(Suit::Spade, ACE);

    #[test]
    fn mighty_beats_joker_beats_trump_beats_lead() {
        let c = ctx(DeckKind::OneJoker, Some(Suit::Heart), Suit::Club);
        let h2 = Card::new(Suit::Heart, 2);
        let ck = Card::new(Suit::Club, 13);
        assert_eq!(winner(&c, &plays(&[(ck, true), (h2, true), (BJ, true), (SA, true)])), 3);
        assert_eq!(winner(&c, &plays(&[(ck, true), (h2, true), (BJ, true)])), 2);
        assert_eq!(winner(&c, &plays(&[(ck, true), (h2, true)])), 1);
        assert_eq!(winner(&c, &plays(&[(Card::new(Suit::Club, 5), true), (ck, true)])), 1);
    }

    #[test]
    fn off_suit_cards_never_win() {
        let c = ctx(DeckKind::OneJoker, Some(Suit::Heart), Suit::Club);
        let p = plays(&[(Card::new(Suit::Club, 2), true), (Card::new(Suit::Diamond, ACE), true)]);
        assert_eq!(winner(&c, &p), 0);
    }

    #[test]
    fn powerless_cards() {
        let c = ctx(DeckKind::OneJoker, Some(Suit::Heart), Suit::Spade);
        // A powerless joker loses to anything on suit.
        assert_eq!(winner(&c, &plays(&[(Card::new(Suit::Spade, 2), true), (BJ, false)])), 0);
        // A powerless mighty is still the ace of spades.
        let p = plays(&[(Card::new(Suit::Spade, 13), true), (SA, false)]);
        assert_eq!(winner(&c, &p), 1);
    }

    #[test]
    fn two_jokers_with_trump() {
        // Hearts trump: the red joker is the main joker.
        let c = ctx(DeckKind::TwoJokers, Some(Suit::Heart), Suit::Club);
        let h2 = Card::new(Suit::Heart, 2);
        assert_eq!(winner(&c, &plays(&[(BJ, true), (RJ, true), (h2, true)])), 1);
        // Trump beats the other joker...
        assert_eq!(winner(&c, &plays(&[(BJ, true), (h2, true)])), 1);
        // ...which beats every plain card, whatever was led.
        assert_eq!(winner(&c, &plays(&[(Card::new(Suit::Club, ACE), true), (BJ, true)])), 1);
        // ♠ trump: the black joker outranks the red one.
        let clubs = ctx(DeckKind::TwoJokers, Some(Suit::Spade), Suit::Club);
        assert_eq!(winner(&clubs, &plays(&[(RJ, true), (BJ, true)])), 1);
        // ♣ led: clubs are plain cards, so the red joker wins (table 4tgz87).
        let p = plays(&[
            (Card::new(Suit::Club, ACE), true),
            (RJ, true),
            (Card::new(Suit::Club, 4), true),
        ]);
        assert_eq!(winner(&clubs, &p), 1);
        // ♠ led: the led card is trump, which beats the red joker.
        let spades = ctx(DeckKind::TwoJokers, Some(Suit::Spade), Suit::Spade);
        assert_eq!(
            winner(&spades, &plays(&[(Card::new(Suit::Spade, 2), true), (RJ, true)])),
            0
        );
    }

    #[test]
    fn two_jokers_no_trump_follow_lead_colour() {
        let c = ctx(DeckKind::TwoJokers, None, Suit::Diamond);
        assert_eq!(
            winner(
                &c,
                &plays(&[(Card::new(Suit::Diamond, 2), true), (BJ, true), (RJ, true)])
            ),
            2
        );
        assert_eq!(
            winner(&c, &plays(&[(Card::new(Suit::Diamond, 2), true), (BJ, true)])),
            0
        );
    }

    #[test]
    fn powerless_joker_lead_passes_the_lead_on() {
        let d9 = Card::new(Suit::Diamond, 9);
        let ck = Card::new(Suit::Club, 13);
        let c2 = Card::new(Suit::Club, 2);
        // The joker named diamonds but has no power; the second card, a club, sets the suit.
        let c = ctx_lead(DeckKind::TwoJokers, Some(Suit::Spade), Lead::Suit(Suit::Diamond), true);
        let p = plays(&[(RJ, false), (c2, true), (d9, true), (ck, true)]);
        assert_eq!(winner(&c, &p), 3);
        // Without the rule the named suit stands.
        let c = ctx_lead(DeckKind::TwoJokers, Some(Suit::Spade), Lead::Suit(Suit::Diamond), false);
        assert_eq!(winner(&c, &p), 2);
    }

    /// Every pair of cards, with and without power, under every deck,
    /// trump, lead and joker-lead rule: `power` orders them as `winner`
    /// decides.
    #[test]
    fn power_orders_two_card_tricks_as_winner_does() {
        let cards: Vec<Card> = DeckKind::TwoJokers.cards();
        let trumps = [
            None,
            Some(Suit::Spade),
            Some(Suit::Diamond),
            Some(Suit::Heart),
            Some(Suit::Club),
        ];
        let leads = Suit::ALL
            .map(Lead::Suit)
            .into_iter()
            .chain([Lead::Color(Color::Black), Lead::Color(Color::Red)]);
        for deck in [DeckKind::OneJoker, DeckKind::TwoJokers] {
            for trump in trumps {
                for lead in leads.clone() {
                    for passes in [false, true] {
                        let c = ctx_lead(deck, trump, lead, passes);
                        for &a in &cards {
                            for &b in cards.iter().filter(|&&b| b != a) {
                                for (pa, pb) in [(true, true), (true, false), (false, true), (false, false)] {
                                    let p = plays(&[(a, pa), (b, pb)]);
                                    let suit = plain_suit(&c, &p[0]);
                                    assert_eq!(
                                        winner(&c, &p) == 1,
                                        power(&c, suit, &p[1]) > power(&c, suit, &p[0]),
                                        "{a} then {b}, powered {pa} {pb}, {c:?}"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn colour_lead_is_followed_by_either_suit() {
        let lead = Lead::Color(Color::Red);
        assert!(lead.follows(Card::new(Suit::Heart, 2)));
        assert!(lead.follows(Card::new(Suit::Diamond, 2)));
        assert!(!lead.follows(Card::new(Suit::Club, 2)));
        assert!(!lead.follows(RJ));
        // A powerless joker led by colour: the first heart or diamond sets the suit.
        let c = ctx_lead(DeckKind::TwoJokers, Some(Suit::Spade), lead, true);
        let p = plays(&[
            (RJ, false),
            (Card::new(Suit::Heart, 5), true),
            // ♦A would be the mighty with spades trump; use a plain diamond.
            (Card::new(Suit::Diamond, 12), true),
            (Card::new(Suit::Heart, 13), true),
        ]);
        assert_eq!(winner(&c, &p), 3);
    }
}
