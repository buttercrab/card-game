use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, Not, Sub};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
pub enum Suit {
    Spade,
    Diamond,
    Heart,
    Club,
}

impl Suit {
    pub const ALL: [Suit; 4] = [Suit::Spade, Suit::Diamond, Suit::Heart, Suit::Club];

    /// Its place in [`Suit::ALL`], 0 to 3.
    pub const fn index(self) -> usize {
        self as usize
    }

    pub fn color(self) -> Color {
        match self {
            Suit::Spade | Suit::Club => Color::Black,
            Suit::Diamond | Suit::Heart => Color::Red,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
pub enum Color {
    Black,
    Red,
}

pub const ACE: u8 = 14;

/// Card slots: the 52 suited cards, then the black and the red joker. Every
/// deck any rule set deals fits in them.
pub const SLOTS: usize = 54;

/// A playing card. Ranks run from 2 to 14 (ace).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
pub enum Card {
    Normal(Suit, u8),
    Joker(Color),
}

impl Card {
    pub const fn new(suit: Suit, rank: u8) -> Card {
        Card::Normal(suit, rank)
    }

    pub fn suit(self) -> Option<Suit> {
        match self {
            Card::Normal(suit, _) => Some(suit),
            Card::Joker(_) => None,
        }
    }

    pub fn rank(self) -> Option<u8> {
        match self {
            Card::Normal(_, rank) => Some(rank),
            Card::Joker(_) => None,
        }
    }

    pub fn is_joker(self) -> bool {
        matches!(self, Card::Joker(_))
    }

    /// 10, J, Q, K and A are worth one point each; a deck holds 20.
    pub fn is_point(self) -> bool {
        matches!(self, Card::Normal(_, rank) if rank >= 10)
    }

    /// The card's slot, below [`SLOTS`]: `suit × 13 + rank − 2` for a
    /// suited card (♠2 is 0, ♣A 51), then 52 for the black joker and 53 for
    /// the red. Slots follow the cards' order, and a suit's ranks are
    /// consecutive. The model encoding's card rows and card actions are
    /// these slots too.
    pub const fn slot(self) -> usize {
        match self {
            Card::Normal(suit, rank) => suit.index() * 13 + rank as usize - 2,
            Card::Joker(Color::Black) => 52,
            Card::Joker(Color::Red) => 53,
        }
    }

    /// The card in `slot`; see [`Card::slot`].
    pub fn from_slot(slot: usize) -> Card {
        match slot {
            52 => Card::Joker(Color::Black),
            53 => Card::Joker(Color::Red),
            _ if slot < 52 => Card::new(Suit::ALL[slot / 13], (slot % 13) as u8 + 2),
            _ => panic!("no card in slot {slot}"),
        }
    }
}

/// A set of cards, one bit per [`Card::slot`]. Searches and bots build
/// many sets a move; this is the one way the crate holds cards as bits.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CardSet(u64);

impl CardSet {
    pub const EMPTY: CardSet = CardSet(0);

    /// The set holding `card` alone.
    pub const fn of(card: Card) -> CardSet {
        CardSet(1 << card.slot())
    }

    /// The set with these bits, one per [`Card::slot`]; bits past the
    /// last slot are dropped.
    pub const fn from_bits(bits: u64) -> CardSet {
        CardSet(bits & ((1 << SLOTS) - 1))
    }

    pub const fn bits(self) -> u64 {
        self.0
    }

    pub const fn contains(self, card: Card) -> bool {
        self.0 & (1 << card.slot()) != 0
    }

    pub fn insert(&mut self, card: Card) {
        self.0 |= 1 << card.slot();
    }

    pub fn remove(&mut self, card: Card) {
        self.0 &= !(1 << card.slot());
    }

    pub const fn len(self) -> usize {
        self.0.count_ones() as usize
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// The cards of `suit` ranked strictly between `low` and `high`.
    pub fn between(suit: Suit, low: u8, high: u8) -> CardSet {
        if high <= low + 1 {
            return CardSet::EMPTY;
        }
        let from = Card::new(suit, low + 1).slot();
        let to = Card::new(suit, high).slot();
        CardSet(((1 << to) - 1) & !((1 << from) - 1))
    }

    /// The cards in the set, in card order.
    pub fn iter(self) -> impl Iterator<Item = Card> {
        let mut set = self.0;
        std::iter::from_fn(move || {
            if set == 0 {
                return None;
            }
            let slot = set.trailing_zeros() as usize;
            set &= set - 1;
            Some(Card::from_slot(slot))
        })
    }
}

impl FromIterator<Card> for CardSet {
    fn from_iter<I: IntoIterator<Item = Card>>(cards: I) -> CardSet {
        let mut set = CardSet::EMPTY;
        set.extend(cards);
        set
    }
}

impl<'a> FromIterator<&'a Card> for CardSet {
    fn from_iter<I: IntoIterator<Item = &'a Card>>(cards: I) -> CardSet {
        cards.into_iter().copied().collect()
    }
}

impl Extend<Card> for CardSet {
    fn extend<I: IntoIterator<Item = Card>>(&mut self, cards: I) {
        for card in cards {
            self.insert(card);
        }
    }
}

impl BitOr for CardSet {
    type Output = CardSet;
    fn bitor(self, other: CardSet) -> CardSet {
        CardSet(self.0 | other.0)
    }
}

impl BitOrAssign for CardSet {
    fn bitor_assign(&mut self, other: CardSet) {
        self.0 |= other.0;
    }
}

impl BitAnd for CardSet {
    type Output = CardSet;
    fn bitand(self, other: CardSet) -> CardSet {
        CardSet(self.0 & other.0)
    }
}

impl BitAndAssign for CardSet {
    fn bitand_assign(&mut self, other: CardSet) {
        self.0 &= other.0;
    }
}

/// The cards of the first set that are not in the second.
impl Sub for CardSet {
    type Output = CardSet;
    fn sub(self, other: CardSet) -> CardSet {
        CardSet(self.0 & !other.0)
    }
}

/// Every card not in the set.
impl Not for CardSet {
    type Output = CardSet;
    fn not(self) -> CardSet {
        CardSet::from_bits(!self.0)
    }
}

impl fmt::Display for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Card::Normal(suit, rank) => {
                let suit = match suit {
                    Suit::Spade => '♠',
                    Suit::Diamond => '♦',
                    Suit::Heart => '♥',
                    Suit::Club => '♣',
                };
                let rank = match rank {
                    11 => "J".to_string(),
                    12 => "Q".to_string(),
                    13 => "K".to_string(),
                    14 => "A".to_string(),
                    n => n.to_string(),
                };
                write!(f, "{suit}{rank}")
            }
            Card::Joker(Color::Black) => write!(f, "BJ"),
            Card::Joker(Color::Red) => write!(f, "RJ"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum DeckKind {
    /// 52 cards and a black joker.
    OneJoker,
    /// 52 cards and both jokers.
    TwoJokers,
}

impl DeckKind {
    /// Jokers in the order they are matched with [`crate::rules::JokerCall::calls`].
    pub fn jokers(self) -> &'static [Card] {
        match self {
            DeckKind::OneJoker => &[Card::Joker(Color::Black)],
            DeckKind::TwoJokers => &[Card::Joker(Color::Black), Card::Joker(Color::Red)],
        }
    }

    pub fn cards(self) -> Vec<Card> {
        let mut cards: Vec<Card> = Suit::ALL
            .iter()
            .flat_map(|&suit| (2..=ACE).map(move |rank| Card::new(suit, rank)))
            .collect();
        cards.extend_from_slice(self.jokers());
        cards
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decks_hold_twenty_points() {
        for kind in [DeckKind::OneJoker, DeckKind::TwoJokers] {
            let cards = kind.cards();
            assert_eq!(cards.iter().filter(|c| c.is_point()).count(), 20);
            assert_eq!(cards.len(), 52 + kind.jokers().len());
        }
    }

    /// Slots number the cards in order, and sets give back their cards in
    /// that order.
    #[test]
    fn slots_and_sets_round_trip() {
        let all = DeckKind::TwoJokers.cards();
        let mut sorted = all.clone();
        sorted.sort();
        assert_eq!(all, sorted);
        for (i, &card) in all.iter().enumerate() {
            assert_eq!((card.slot(), Card::from_slot(i)), (i, card));
            assert_eq!(CardSet::of(card).iter().collect::<Vec<_>>(), vec![card]);
        }
        let set: CardSet = all.iter().collect();
        assert_eq!(set.len(), SLOTS);
        assert_eq!(set.iter().collect::<Vec<_>>(), all);
        assert_eq!(!CardSet::EMPTY, set);
        assert_eq!(
            CardSet::between(Suit::Heart, 4, 8).iter().collect::<Vec<_>>(),
            (5..8).map(|r| Card::new(Suit::Heart, r)).collect::<Vec<_>>()
        );
        assert!(CardSet::between(Suit::Heart, 4, 5).is_empty());
        let four = Card::new(Suit::Heart, 4);
        assert_eq!((set - CardSet::of(four)).len(), SLOTS - 1);
        assert!(!(set - CardSet::of(four)).contains(four));
    }

    #[test]
    fn display() {
        assert_eq!(Card::new(Suit::Spade, ACE).to_string(), "♠A");
        assert_eq!(Card::new(Suit::Diamond, 10).to_string(), "♦10");
        assert_eq!(Card::Joker(Color::Red).to_string(), "RJ");
    }
}
