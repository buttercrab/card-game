//! House rules. Every regional variant is a [`Rules`] value; [`Preset`]
//! holds the ones ported from web-mighty.

use crate::card::{ACE, Card, DeckKind, Suit};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Rules {
    pub players: usize,
    pub hand_size: usize,
    pub deck: DeckKind,
    pub misdeal: Misdeal,
    pub bidding: Bidding,
    pub friend: FriendRules,
    pub policy: CardPolicies,
    pub joker_call: JokerCall,
}

/// A player may ask for a redeal when their hand is weak.
/// Each card is worth `point_value` if it is a point card, `joker_value` if it
/// is a joker, or its entry in `card_values` if listed. A hand totalling at
/// most `threshold` qualifies.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Misdeal {
    pub point_value: i8,
    pub joker_value: i8,
    pub card_values: Vec<(Card, i8)>,
    pub threshold: i8,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Bidding {
    /// Lowest bid, counted as for a trump contract.
    pub min: u8,
    pub max: u8,
    pub allow_no_trump: bool,
    /// A no-trump bid of `n` ranks as a trump bid of `n + no_trump_bonus`;
    /// at equal rank no-trump wins.
    pub no_trump_bonus: u8,
    /// Whether the first bidder may pass before anyone has bid.
    pub first_bidder_may_pass: bool,
    /// Extra points the declarer must promise to change trump after taking the kitty.
    pub change_trump_cost: u8,
}

/// How the declarer may choose a friend. Each flag enables one way.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FriendRules {
    /// Whoever holds a named card.
    pub by_card: bool,
    /// A named seat.
    pub by_seat: bool,
    /// Whoever wins the first trick.
    pub first_trick: bool,
    /// Whoever wins the last trick.
    pub last_trick: bool,
    /// The declarer may name a card they hold themselves, playing alone in secret.
    pub fake: bool,
    /// The declarer may openly play alone, doubling the stakes.
    pub alone: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CardPolicy {
    Valid,
    /// May be played, but has no special power.
    NoEffect,
    /// May not be played unless nothing else is legal.
    Invalid,
    /// May not be led unless nothing else is legal.
    NoLead,
}

/// Policy on the first trick and on the last trick. Tricks between are always valid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TrickPolicy {
    pub first: CardPolicy,
    pub last: CardPolicy,
}

impl TrickPolicy {
    pub const VALID: TrickPolicy = TrickPolicy::new(CardPolicy::Valid, CardPolicy::Valid);

    pub const fn new(first: CardPolicy, last: CardPolicy) -> TrickPolicy {
        TrickPolicy { first, last }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CardPolicies {
    pub mighty: TrickPolicy,
    pub trump: TrickPolicy,
    pub joker: TrickPolicy,
    /// Whether leading a joker-call card can call the joker. `NoEffect`,
    /// `Invalid` and `NoLead` all mean no call that trick.
    pub joker_call: TrickPolicy,
    /// Per-card policies that take precedence over the categories above.
    pub overrides: Vec<(Card, TrickPolicy)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct JokerCall {
    /// One pair per joker, in [`DeckKind::jokers`] order: the card that calls
    /// it, and the card used instead when the first card's suit is trump.
    pub calls: Vec<(Card, Card)>,
    /// A called joker's holder may play the mighty instead.
    pub mighty_defense: bool,
    /// A called joker keeps its power.
    pub called_joker_has_power: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Contract {
    /// `None` is no-trump.
    pub trump: Option<Suit>,
    pub count: u8,
}

impl Default for Rules {
    fn default() -> Rules {
        Rules {
            players: 5,
            hand_size: 10,
            deck: DeckKind::OneJoker,
            misdeal: Misdeal {
                point_value: 1,
                joker_value: 0,
                card_values: Vec::new(),
                threshold: 0,
            },
            bidding: Bidding {
                min: 13,
                max: 20,
                allow_no_trump: true,
                no_trump_bonus: 0,
                first_bidder_may_pass: true,
                change_trump_cost: 2,
            },
            friend: FriendRules {
                by_card: true,
                by_seat: true,
                first_trick: true,
                last_trick: true,
                fake: true,
                alone: true,
            },
            policy: CardPolicies {
                mighty: TrickPolicy::VALID,
                trump: TrickPolicy::new(CardPolicy::Invalid, CardPolicy::Valid),
                joker: TrickPolicy::new(CardPolicy::NoEffect, CardPolicy::NoEffect),
                joker_call: TrickPolicy::VALID,
                overrides: Vec::new(),
            },
            joker_call: JokerCall {
                calls: vec![(Card::new(Suit::Club, 3), Card::new(Suit::Spade, 3))],
                mighty_defense: true,
                called_joker_has_power: false,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid rules: {0}")]
pub struct InvalidRules(pub &'static str);

impl Rules {
    pub fn kitty_size(&self) -> usize {
        self.deck.cards().len().saturating_sub(self.players * self.hand_size)
    }

    pub fn validate(&self) -> Result<(), InvalidRules> {
        let deck = self.deck.cards().len();
        if !(2..=8).contains(&self.players) || self.hand_size == 0 {
            return Err(InvalidRules("player count or hand size out of range"));
        }
        if self.players * self.hand_size > deck {
            return Err(InvalidRules("not enough cards to deal"));
        }
        if self.bidding.min == 0 || self.bidding.min > self.bidding.max {
            return Err(InvalidRules("bidding range is empty"));
        }
        if self.bidding.no_trump_bonus >= self.bidding.min {
            return Err(InvalidRules("no-trump bonus must be below the minimum bid"));
        }
        if self.joker_call.calls.len() != self.deck.jokers().len() {
            return Err(InvalidRules("need one joker-call pair per joker"));
        }
        let f = &self.friend;
        if !(f.by_card || f.by_seat || f.first_trick || f.last_trick || f.alone) {
            return Err(InvalidRules("no way to choose a friend"));
        }
        Ok(())
    }

    pub fn mighty(&self, trump: Option<Suit>) -> Card {
        match trump {
            Some(Suit::Spade) => Card::new(Suit::Diamond, ACE),
            _ => Card::new(Suit::Spade, ACE),
        }
    }

    /// Whether `hand` lets its holder ask for a redeal.
    pub fn is_misdeal(&self, hand: &[Card]) -> bool {
        let m = &self.misdeal;
        let total: i32 = hand
            .iter()
            .map(|card| {
                let value = if let Some((_, v)) = m.card_values.iter().find(|(c, _)| c == card) {
                    *v
                } else if card.is_joker() {
                    m.joker_value
                } else if card.is_point() {
                    m.point_value
                } else {
                    0
                };
                i32::from(value)
            })
            .sum();
        total <= i32::from(m.threshold)
    }

    /// Bids are compared by this key; higher wins.
    pub fn bid_rank(&self, contract: Contract) -> (u8, bool) {
        let no_trump = contract.trump.is_none();
        let bonus = if no_trump { self.bidding.no_trump_bonus } else { 0 };
        (contract.count + bonus, no_trump)
    }

    /// The card that calls `joker` under `trump`, if the deck has that joker.
    pub fn joker_call_card(&self, joker: Card, trump: Option<Suit>) -> Option<Card> {
        let index = self.deck.jokers().iter().position(|&j| j == joker)?;
        let (call, fallback) = *self.joker_call.calls.get(index)?;
        Some(if call.suit() == trump && trump.is_some() {
            fallback
        } else {
            call
        })
    }

    /// The policy that governs `card` on trick number `trick` (0-based).
    pub fn policy(&self, card: Card, trump: Option<Suit>, trick: usize) -> CardPolicy {
        let p = &self.policy;
        let category = if let Some((_, policy)) = p.overrides.iter().find(|(c, _)| *c == card) {
            *policy
        } else if card == self.mighty(trump) {
            p.mighty
        } else if card.is_joker() {
            p.joker
        } else if card.suit().is_some() && card.suit() == trump {
            p.trump
        } else {
            TrickPolicy::VALID
        };
        self.on_trick(category, trick)
    }

    pub fn on_trick(&self, policy: TrickPolicy, trick: usize) -> CardPolicy {
        if trick == 0 {
            policy.first
        } else if trick + 1 == self.hand_size {
            policy.last
        } else {
            CardPolicy::Valid
        }
    }
}

/// House rules collected in web-mighty, named after the groups that play them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    /// 기본 5마
    Default,
    /// 대구동신과학고등학교
    Ddshs,
    /// 대구과학고등학교
    Dshs,
    /// 민족사관고등학교
    Kmla,
    /// 광주과학고등학교
    Gsa,
    /// 경기과학고등학교 (two jokers)
    Gshs,
    /// 성균관대학교
    Skku,
    /// 서울과학고등학교
    Sshs,
    /// 연세대학교
    Yonsei,
}

impl Preset {
    pub const ALL: [Preset; 9] = [
        Preset::Default,
        Preset::Ddshs,
        Preset::Dshs,
        Preset::Kmla,
        Preset::Gsa,
        Preset::Gshs,
        Preset::Skku,
        Preset::Sshs,
        Preset::Yonsei,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Preset::Default => "default",
            Preset::Ddshs => "ddshs",
            Preset::Dshs => "dshs",
            Preset::Kmla => "kmla",
            Preset::Gsa => "gsa",
            Preset::Gshs => "gshs",
            Preset::Skku => "skku",
            Preset::Sshs => "sshs",
            Preset::Yonsei => "yonsei",
        }
    }

    pub fn rules(self) -> Rules {
        use CardPolicy::*;
        let mut r = Rules::default();
        match self {
            Preset::Default => {}
            Preset::Ddshs => {
                r.bidding.allow_no_trump = false;
                r.bidding.change_trump_cost = 1;
                r.friend = FriendRules {
                    by_card: true,
                    by_seat: false,
                    first_trick: false,
                    last_trick: false,
                    fake: true,
                    alone: true,
                };
                let club3 = Card::new(Suit::Club, 3);
                r.joker_call.calls = vec![(club3, club3)];
            }
            Preset::Dshs => {
                r.bidding.min = 12;
                r.bidding.max = 23;
                r.bidding.first_bidder_may_pass = false;
                r.policy.mighty = TrickPolicy::new(NoEffect, Valid);
            }
            Preset::Kmla => {
                r.misdeal.joker_value = -1;
                r.misdeal.threshold = 1;
                r.joker_call.mighty_defense = false;
            }
            Preset::Gsa => {
                r.bidding.min = 12;
                r.policy.mighty = TrickPolicy::new(NoEffect, Valid);
                r.policy.joker = TrickPolicy::VALID;
            }
            Preset::Gshs => {
                r.deck = DeckKind::TwoJokers;
                r.misdeal = Misdeal {
                    point_value: 2,
                    joker_value: -1,
                    card_values: vec![(Card::new(Suit::Spade, ACE), -2)],
                    threshold: 1,
                };
                r.bidding.min = 14;
                r.joker_call
                    .calls
                    .push((Card::new(Suit::Heart, 3), Card::new(Suit::Diamond, 3)));
            }
            Preset::Skku => {
                r.bidding.min = 12;
                r.bidding.change_trump_cost = 0;
                r.policy.joker = TrickPolicy::VALID;
                r.policy.trump = TrickPolicy::VALID;
                r.joker_call.called_joker_has_power = true;
            }
            Preset::Sshs => {
                r.misdeal = Misdeal {
                    point_value: 2,
                    joker_value: -1,
                    card_values: [Suit::Spade, Suit::Diamond, Suit::Heart, Suit::Club]
                        .map(|s| (Card::new(s, 10), 1))
                        .into_iter()
                        .chain([(Card::new(Suit::Spade, ACE), 1)])
                        .collect(),
                    threshold: 1,
                };
                r.friend.by_seat = false;
                r.policy.joker_call = TrickPolicy::new(NoEffect, Valid);
            }
            Preset::Yonsei => {
                r.misdeal = Misdeal {
                    point_value: 2,
                    joker_value: 0,
                    card_values: vec![
                        (Card::new(Suit::Spade, 10), 1),
                        (Card::new(Suit::Heart, 10), 1),
                        (Card::new(Suit::Spade, ACE), 1),
                    ],
                    threshold: 1,
                };
                r.bidding.allow_no_trump = false;
                r.bidding.first_bidder_may_pass = false;
                r.bidding.min = 14;
                r.bidding.max = 23;
                r.policy.joker_call = TrickPolicy::new(NoEffect, Valid);
            }
        }
        r
    }
}

impl fmt::Display for Preset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Preset {
    type Err = String;

    fn from_str(s: &str) -> Result<Preset, String> {
        Preset::ALL
            .into_iter()
            .find(|p| p.name() == s)
            .ok_or_else(|| format!("unknown preset `{s}`"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_is_valid() {
        for preset in Preset::ALL {
            preset.rules().validate().unwrap_or_else(|e| panic!("{preset}: {e}"));
        }
    }

    #[test]
    fn kitty_sizes() {
        assert_eq!(Preset::Default.rules().kitty_size(), 3);
        assert_eq!(Preset::Gshs.rules().kitty_size(), 4);
    }

    #[test]
    fn mighty_moves_when_spades_are_trump() {
        let r = Rules::default();
        assert_eq!(r.mighty(Some(Suit::Spade)), Card::new(Suit::Diamond, ACE));
        assert_eq!(r.mighty(None), Card::new(Suit::Spade, ACE));
    }

    #[test]
    fn joker_call_card_avoids_trump() {
        let r = Preset::Gshs.rules();
        let [black, red] = [r.deck.jokers()[0], r.deck.jokers()[1]];
        assert_eq!(
            r.joker_call_card(black, Some(Suit::Heart)),
            Some(Card::new(Suit::Club, 3))
        );
        assert_eq!(
            r.joker_call_card(black, Some(Suit::Club)),
            Some(Card::new(Suit::Spade, 3))
        );
        assert_eq!(
            r.joker_call_card(red, Some(Suit::Heart)),
            Some(Card::new(Suit::Diamond, 3))
        );
    }

    #[test]
    fn misdeal_counts_card_values() {
        let r = Preset::Gshs.rules();
        // ♠A (-2) + ♥K (2) = 0, at or below the threshold of 1.
        let hand = [
            Card::new(Suit::Spade, ACE),
            Card::new(Suit::Heart, 13),
            Card::new(Suit::Club, 4),
        ];
        assert!(r.is_misdeal(&hand));
        assert!(!r.is_misdeal(&[Card::new(Suit::Heart, 13)]));
    }
}
