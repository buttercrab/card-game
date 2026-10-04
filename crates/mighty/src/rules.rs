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
    /// The lowest rank dealt: 3마 plays from 7 and 4마 from 5 (see
    /// [`Rules::for_players`]). Point cards (10 to A) are always dealt.
    #[serde(default = "two")]
    pub lowest_rank: u8,
    /// Cards below `lowest_rank` dealt anyway: 4마 keeps ♣3 and ♠3 for the
    /// joker call.
    #[serde(default)]
    pub extra_cards: Vec<Card>,
    pub misdeal: Misdeal,
    pub bidding: Bidding,
    pub friend: FriendRules,
    pub policy: CardPolicies,
    pub joker_call: JokerCall,
    #[serde(default)]
    pub joker_lead: JokerLead,
    #[serde(default)]
    pub scoring: Scoring,
}

fn two() -> u8 {
    2
}

fn yes() -> bool {
    true
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
    /// A hand of nothing but point cards qualifies too (서울과고, 신촌).
    #[serde(default)]
    pub all_points: bool,
    /// A player who has already bid may still ask, on their turn to bid.
    #[serde(default)]
    pub after_bidding: bool,
    /// The declarer may ask after taking the kitty and before discarding,
    /// judged on every card they then hold.
    #[serde(default)]
    pub declarer: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Bidding {
    /// Lowest bid, counted as for a trump contract.
    pub min: u8,
    pub max: u8,
    pub allow_no_trump: bool,
    /// A no-trump bid of `n` ranks as a trump bid of `n + no_trump_bonus`.
    pub no_trump_bonus: u8,
    /// At equal rank a no-trump bid overrules a trump bid; otherwise every
    /// bid must rank strictly higher.
    pub no_trump_wins_ties: bool,
    /// Whether the first bidder may pass before anyone has bid.
    pub first_bidder_may_pass: bool,
    /// Extra points the declarer must promise to change trump after taking the kitty.
    pub change_trump_cost: u8,
    /// How much the contract's number rises to change to no-trump. `None`
    /// treats it like any change: what the bid is worth rises by
    /// `change_trump_cost`.
    #[serde(default)]
    pub change_to_no_trump_cost: Option<u8>,
    /// A pass is final. Otherwise a player who passed may bid again later,
    /// and the bidding ends once everyone else has passed in a row.
    #[serde(default = "yes")]
    pub pass_is_final: bool,
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

/// How a led joker sets the trick.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct JokerLead {
    /// The joker may name its colour instead of a suit; either suit of that
    /// colour then follows.
    pub by_color: bool,
    /// A joker led without power counts as played last, so the next card
    /// sets the suit that wins.
    pub powerless_passes: bool,
}

/// How a finished hand is scored. Groups differ more here than anywhere
/// else; the default is web-mighty's formula.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(default)]
pub struct Scoring {
    /// What a made contract is worth before doubling.
    pub win: WinScore,
    /// When a no-trump contract doubles the score.
    pub no_trump: Doubling,
    /// When playing openly alone (노프렌드) doubles the score. Without
    /// it, the declarer still collects from every opponent.
    pub alone: Doubling,
    /// Taking all 20 points (런) doubles a win.
    pub run: bool,
    /// When a failed contract doubles the loss (백런).
    pub back_run: BackRun,
    /// Point cards in the declarer's discards count for the declarer's
    /// side; otherwise they count for the defence.
    pub discards_to_declarer: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WinScore {
    /// Points taken − 10, at least 1.
    #[default]
    OverTen,
    /// Points taken − the minimum bid; can be zero or less.
    OverMin,
    /// Points taken − the contract.
    OverBid,
    /// Points taken − the contract + 2 × how far the bid ranks above the
    /// minimum: high bids pay for their risk. 나무위키 calls it the usual one.
    BidBonus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Doubling {
    Never,
    /// Only when the contract is made.
    Win,
    /// Made or not.
    Always,
}

impl Doubling {
    pub fn applies(self, made: bool) -> bool {
        match self {
            Doubling::Never => false,
            Doubling::Win => made,
            Doubling::Always => true,
        }
    }
}

/// When a failed contract counts double (백런).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BackRun {
    Never,
    /// The declarer's side took at most this many points.
    TeamAtMost(u8),
    /// The contract was missed by at least this many points.
    ShortBy(u8),
    /// The defence took at least as many points as the contract.
    DefenceReachesBid,
}

impl Default for Scoring {
    fn default() -> Scoring {
        Scoring {
            win: WinScore::OverTen,
            no_trump: Doubling::Win,
            alone: Doubling::Win,
            run: true,
            back_run: BackRun::TeamAtMost(10),
            discards_to_declarer: true,
        }
    }
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
            lowest_rank: 2,
            extra_cards: Vec::new(),
            misdeal: Misdeal {
                point_value: 1,
                joker_value: 0,
                card_values: Vec::new(),
                threshold: 0,
                all_points: false,
                after_bidding: false,
                declarer: false,
            },
            bidding: Bidding {
                min: 13,
                max: 20,
                allow_no_trump: true,
                no_trump_bonus: 0,
                no_trump_wins_ties: true,
                first_bidder_may_pass: true,
                change_trump_cost: 2,
                change_to_no_trump_cost: None,
                pass_is_final: true,
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
                trump: TrickPolicy::new(CardPolicy::NoLead, CardPolicy::Valid),
                joker: TrickPolicy::new(CardPolicy::NoEffect, CardPolicy::NoEffect),
                joker_call: TrickPolicy::VALID,
                overrides: Vec::new(),
            },
            joker_call: JokerCall {
                calls: vec![(Card::new(Suit::Club, 3), Card::new(Suit::Spade, 3))],
                mighty_defense: true,
                called_joker_has_power: false,
            },
            joker_lead: JokerLead::default(),
            scoring: Scoring::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid rules: {0}")]
pub struct InvalidRules(pub &'static str);

impl Rules {
    pub fn kitty_size(&self) -> usize {
        self.cards().len().saturating_sub(self.players * self.hand_size)
    }

    /// Every card dealt: the deck from `lowest_rank` up, the jokers, and
    /// `extra_cards`.
    pub fn cards(&self) -> Vec<Card> {
        let mut cards: Vec<Card> = self
            .deck
            .cards()
            .into_iter()
            .filter(|c| c.rank().is_none_or(|r| r >= self.lowest_rank) || self.extra_cards.contains(c))
            .collect();
        cards.sort();
        cards
    }

    /// The usual rules for `players` at the table, from these five-player
    /// rules (나무위키, 타 인원수 플레이방법): 3마 deals 7 to A to three
    /// players with no friend and calls the joker with ♣7; 4마 deals 5 to A
    /// plus the joker-call threes; 6마 and 7마 deal 8 and 7 cards each, as
    /// 대전 and 동대전 do. `None` for other counts.
    pub fn for_players(&self, players: usize) -> Option<Rules> {
        let mut r = self.clone();
        r.players = players;
        let calls: Vec<Card> = r.joker_call.calls.iter().flat_map(|&(a, b)| [a, b]).collect();
        match players {
            3 => {
                r.lowest_rank = 7;
                r.extra_cards.clear();
                r.hand_size = 10;
                r.friend = FriendRules {
                    by_card: false,
                    by_seat: false,
                    first_trick: false,
                    last_trick: false,
                    fake: false,
                    alone: true,
                };
                // Everyone plays alone, so playing alone cannot double.
                r.scoring.alone = Doubling::Never;
                // The threes are gone: the same suits' sevens call instead.
                let seven = |c: Card| c.suit().map_or(c, |s| Card::new(s, 7));
                r.joker_call.calls = r.joker_call.calls.iter().map(|&(a, b)| (seven(a), seven(b))).collect();
            }
            4 => {
                r.lowest_rank = 5;
                r.extra_cards = calls.into_iter().filter(|c| c.rank().is_some_and(|x| x < 5)).collect();
                r.extra_cards.sort();
                r.extra_cards.dedup();
                r.hand_size = 10;
            }
            5 => {}
            6 => r.hand_size = 8,
            7 => r.hand_size = 7,
            _ => return None,
        }
        Some(r)
    }

    pub fn validate(&self) -> Result<(), InvalidRules> {
        if !(2..=10).contains(&self.lowest_rank) {
            return Err(InvalidRules("the deck must keep every point card"));
        }
        let mut extra = self.extra_cards.clone();
        extra.sort();
        extra.dedup();
        let extras_ok = self
            .extra_cards
            .iter()
            .all(|c| c.rank().is_some_and(|r| r < self.lowest_rank));
        if extra.len() != self.extra_cards.len() || !extras_ok {
            return Err(InvalidRules("extra cards must be distinct cards below the lowest rank"));
        }
        let cards = self.cards();
        let deck = cards.len();
        if !(2..=8).contains(&self.players) || self.hand_size == 0 {
            return Err(InvalidRules("player count or hand size out of range"));
        }
        if self.players * self.hand_size > deck {
            return Err(InvalidRules("not enough cards to deal"));
        }
        let mut call_cards = self.joker_call.calls.iter().flat_map(|&(a, b)| [a, b]);
        if call_cards.any(|c| !cards.contains(&c)) {
            return Err(InvalidRules("joker-call cards must be in the deck"));
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
        let all_points = m.all_points && !hand.is_empty() && hand.iter().all(|c| c.is_point());
        total <= i32::from(m.threshold) || all_points
    }

    /// The contract after changing trump to `trump` once the kitty is seen.
    pub fn changed_contract(&self, contract: Contract, trump: Option<Suit>) -> Contract {
        if trump.is_none()
            && let Some(cost) = self.bidding.change_to_no_trump_cost
        {
            return Contract {
                trump,
                count: contract.count + cost,
            };
        }
        // What the bid is worth rises by the cost, whatever it says.
        let value = self.bid_value(contract) + self.bidding.change_trump_cost;
        let bonus = self.bid_value(Contract { trump, count: 0 });
        Contract {
            trump,
            count: value.saturating_sub(bonus),
        }
    }

    /// Bids are compared by this key; higher wins.
    /// What a bid is worth against the minimum: no-trump counts
    /// `no_trump_bonus` more than it says.
    pub fn bid_value(&self, contract: Contract) -> u8 {
        let bonus = if contract.trump.is_none() {
            self.bidding.no_trump_bonus
        } else {
            0
        };
        contract.count + bonus
    }

    /// Orders bids: a later bid must rank strictly higher.
    pub fn bid_rank(&self, contract: Contract) -> (u8, bool) {
        let tie_break = contract.trump.is_none() && self.bidding.no_trump_wins_ties;
        (self.bid_value(contract), tie_break)
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
                    ..r.misdeal
                };
                r.bidding.min = 14;
                r.bidding.no_trump_bonus = 1;
                r.bidding.no_trump_wins_ties = false;
                r.joker_call
                    .calls
                    .push((Card::new(Suit::Heart, 3), Card::new(Suit::Diamond, 3)));
                r.joker_lead = JokerLead {
                    by_color: true,
                    powerless_passes: true,
                };
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
                    // 나무위키 (지역별 규칙, 서울과고 5마): all point cards is a misdeal too.
                    all_points: true,
                    ..r.misdeal
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
                    // 나무위키 (지역별 규칙, 신촌 5마): all point cards is a misdeal too.
                    all_points: true,
                    ..r.misdeal
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

    #[test]
    fn other_player_counts() {
        let five = Rules::default();
        let sizes = |r: &Rules| (r.cards().len(), r.hand_size, r.kitty_size());
        let three = five.for_players(3).unwrap();
        // 7 to A and the joker: 33 cards, 10 each and 3 in the kitty.
        assert_eq!(sizes(&three), (33, 10, 3));
        assert_eq!(three.cards().iter().filter(|c| c.is_point()).count(), 20);
        let black = Card::Joker(crate::card::Color::Black);
        assert_eq!(
            three.joker_call_card(black, Some(Suit::Heart)),
            Some(Card::new(Suit::Club, 7))
        );
        assert_eq!(
            three.joker_call_card(black, Some(Suit::Club)),
            Some(Card::new(Suit::Spade, 7))
        );
        // 5 to A, the joker, ♣3 and ♠3: 43 cards.
        let four = five.for_players(4).unwrap();
        assert_eq!(sizes(&four), (43, 10, 3));
        assert!(four.cards().contains(&Card::new(Suit::Club, 3)) && four.cards().contains(&Card::new(Suit::Spade, 3)));
        assert_eq!(sizes(&five.for_players(6).unwrap()), (53, 8, 5));
        assert_eq!(sizes(&five.for_players(7).unwrap()), (53, 7, 4));
        assert_eq!(five.for_players(2), None);
        for preset in Preset::ALL {
            for players in 3..=7 {
                let r = preset.rules().for_players(players).unwrap();
                r.validate().unwrap_or_else(|e| panic!("{preset} for {players}: {e}"));
            }
        }
    }

    #[test]
    fn impossible_decks_are_rejected() {
        let r = Rules {
            lowest_rank: 11,
            ..Rules::default()
        };
        assert!(r.validate().is_err(), "the tens must stay");
        let mut r = Rules::default().for_players(4).unwrap();
        r.extra_cards.push(Card::new(Suit::Heart, 9));
        assert!(r.validate().is_err(), "a nine is already dealt");
        let mut r = Rules::default().for_players(3).unwrap();
        r.joker_call.calls = vec![(Card::new(Suit::Club, 3), Card::new(Suit::Spade, 3))];
        assert!(r.validate().is_err(), "♣3 is not in a 3마 deck");
    }

    #[test]
    fn rules_saved_before_the_new_options_still_load() {
        let mut json = serde_json::to_value(Preset::Gshs.rules()).unwrap();
        let object = json.as_object_mut().unwrap();
        for key in ["lowest_rank", "extra_cards", "scoring"] {
            object.remove(key);
        }
        for key in ["all_points", "after_bidding", "declarer"] {
            object["misdeal"].as_object_mut().unwrap().remove(key);
        }
        for key in ["change_to_no_trump_cost", "pass_is_final"] {
            object["bidding"].as_object_mut().unwrap().remove(key);
        }
        let loaded: Rules = serde_json::from_value(json).unwrap();
        assert_eq!(loaded, Preset::Gshs.rules());
    }

    #[test]
    fn changing_trump_raises_what_the_bid_is_worth() {
        let r = Preset::Gshs.rules();
        let c = |trump, count| Contract { trump, count };
        // 노기루다 counts one more: to it costs 1, from it 3 (나무위키, 서울과고 5마).
        assert_eq!(r.changed_contract(c(Some(Suit::Heart), 15), None), c(None, 16));
        assert_eq!(
            r.changed_contract(c(None, 15), Some(Suit::Heart)),
            c(Some(Suit::Heart), 18)
        );
        assert_eq!(
            r.changed_contract(c(Some(Suit::Heart), 15), Some(Suit::Club)),
            c(Some(Suit::Club), 17)
        );
    }
}
