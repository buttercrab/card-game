use serde::{Deserialize, Serialize};
use std::fmt;
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

    #[test]
    fn display() {
        assert_eq!(Card::new(Suit::Spade, ACE).to_string(), "♠A");
        assert_eq!(Card::new(Suit::Diamond, 10).to_string(), "♦10");
        assert_eq!(Card::Joker(Color::Red).to_string(), "RJ");
    }
}
