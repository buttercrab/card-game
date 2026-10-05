//! How a finished hand is scored, step by step. The game pays by
//! [`value`] alone; [`breakdown`] records each step on the way, which the
//! table shows as the result's count and the rulebook as its examples.
//! Both run the same code.

use crate::rules::{BackRun, Contract, LoseScore, Rules, WinScore};
use crate::state::{FriendCall, settle};
use engine::Seat;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A hand's score worked out: what one opponent pays the declarer's side,
/// and how.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct HandValue {
    pub contract: Contract,
    /// Points the declarer's side counts, discards included.
    pub team_points: u8,
    pub made: bool,
    /// Each step in order. A made contract starts from its worth, a failed
    /// one from its shortfall; doublings follow.
    pub steps: Vec<ScoreStep>,
    /// What one opponent pays the declarer's side; negative when the side
    /// pays instead.
    pub value: i64,
}

/// One step of a hand's score. `total` is the amount so far: what the
/// declarer's side wins when made, what it owes (as a positive number)
/// when failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum ScoreStep {
    /// Points taken − 10, at least 1.
    OverTen { points: u8, total: i64 },
    /// Points taken − the minimum bid.
    OverMin { points: u8, min: u8, total: i64 },
    /// Points taken − the contract.
    OverBid { points: u8, contract: u8, total: i64 },
    /// Points taken − the contract + the bid bonus.
    BidBonus {
        points: u8,
        contract: u8,
        bonus: i64,
        total: i64,
    },
    /// (Points taken − n) + (contract − n), at least 1.
    BothOver {
        points: u8,
        contract: u8,
        n: u8,
        total: i64,
    },
    /// The contract was missed by `short`.
    Short { contract: u8, short: u8, total: i64 },
    /// A failed contract pays back (contract − n) on top of the shortfall.
    PaysBack { contract: u8, n: u8, short: u8, total: i64 },
    /// The failure counts double (백런), by `rule`.
    BackRun { rule: BackRun, total: i64 },
    /// The score doubles, for `why`.
    Doubled { why: Double, total: i64 },
}

/// Why a score doubles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Double {
    /// 노기루다.
    NoTrump,
    /// 노프렌드.
    Alone,
    /// 런: all 20 points.
    Run,
    /// A contract of 20.
    FullContract,
}

/// What one opponent pays the declarer's side (negative: receives) when
/// the side took `team_points`, telling `note` each step.
fn score(rules: &Rules, contract: Contract, alone: bool, team_points: u8, note: &mut impl FnMut(ScoreStep)) -> i64 {
    let s = &rules.scoring;
    let (count, points) = (i64::from(contract.count), i64::from(team_points));
    let min = i64::from(rules.bidding.min);
    let made = points >= count;
    let mut total = if made {
        let (step, total) = match s.win {
            WinScore::OverTen => {
                let total = (points - 10).max(1);
                (
                    ScoreStep::OverTen {
                        points: team_points,
                        total,
                    },
                    total,
                )
            }
            WinScore::OverMin => {
                let total = points - min;
                let min = rules.bidding.min;
                (
                    ScoreStep::OverMin {
                        points: team_points,
                        min,
                        total,
                    },
                    total,
                )
            }
            WinScore::OverBid => {
                let total = points - count;
                let step = ScoreStep::OverBid {
                    points: team_points,
                    contract: contract.count,
                    total,
                };
                (step, total)
            }
            // A bid under the minimum (the dealer's last chance) earns no bonus,
            // never a penalty: a made contract never costs the declarer.
            WinScore::BidBonus => {
                let bonus = 2 * (i64::from(rules.bid_value(contract)) - min).max(0);
                let total = points - count + bonus;
                let step = ScoreStep::BidBonus {
                    points: team_points,
                    contract: contract.count,
                    bonus,
                    total,
                };
                (step, total)
            }
            WinScore::BothOver(n) => {
                let total = (points - i64::from(n) + count - i64::from(n)).max(1);
                let step = ScoreStep::BothOver {
                    points: team_points,
                    contract: contract.count,
                    n,
                    total,
                };
                (step, total)
            }
        };
        note(step);
        total
    } else {
        let short = count - points;
        let short_u8 = contract.count - team_points;
        note(ScoreStep::Short {
            contract: contract.count,
            short: short_u8,
            total: short,
        });
        let mut owed = short;
        // Validated to be at most the lowest contract: never a gain.
        if let LoseScore::PaysBack(n) = s.lose {
            owed = count - i64::from(n) + short;
            note(ScoreStep::PaysBack {
                contract: contract.count,
                n,
                short: short_u8,
                total: owed,
            });
        }
        let back_run = match s.back_run {
            BackRun::Never => false,
            BackRun::TeamAtMost(n) => points <= i64::from(n),
            BackRun::ShortBy(n) => short >= i64::from(n),
            // Every point the side did not take went to the defence.
            BackRun::DefenceReachesBid => 20 - points >= count,
        };
        if back_run {
            owed *= 2;
            note(ScoreStep::BackRun {
                rule: s.back_run,
                total: owed,
            });
        }
        owed
    };
    for (applies, why) in [
        (s.no_trump.applies(made) && contract.trump.is_none(), Double::NoTrump),
        (s.alone.applies(made) && alone, Double::Alone),
        (s.run && made && points == 20, Double::Run),
        (s.full_contract.applies(made) && count == 20, Double::FullContract),
    ] {
        if applies {
            total *= 2;
            note(ScoreStep::Doubled { why, total });
        }
    }
    if made { total } else { -total }
}

/// What one opponent pays the declarer's side (negative: receives) when
/// the side took `team_points`.
pub fn value(rules: &Rules, contract: Contract, alone: bool, team_points: u8) -> i64 {
    score(rules, contract, alone, team_points, &mut |_| {})
}

/// [`value`], with every step that led to it.
pub fn breakdown(rules: &Rules, contract: Contract, alone: bool, team_points: u8) -> HandValue {
    let mut steps = Vec::new();
    let value = score(rules, contract, alone, team_points, &mut |step| steps.push(step));
    HandValue {
        contract,
        team_points,
        made: team_points >= contract.count,
        steps,
        value,
    }
}

/// A hand scored for the rulebook: its count, and what each seat gets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Example {
    pub value: HandValue,
    /// Seat 0 declared; with a friend, seat 1 is the friend.
    pub payoffs: Vec<i64>,
}

/// The rulebook's worked examples under `rules`: a contract one over the
/// minimum, in spades, made by two points and missed by two. The declarer
/// plays with a friend where the rules have a way to call one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Examples {
    pub contract: Contract,
    /// Played alone (no way to call a friend).
    pub alone: bool,
    pub made: Example,
    pub failed: Example,
}

impl Examples {
    pub fn new(rules: &Rules) -> Examples {
        let f = &rules.friend;
        let alone = !(f.by_card || f.by_seat || f.first_trick || f.last_trick);
        let count = (rules.bidding.min + 1).min(20);
        let contract = Contract {
            trump: Some(crate::card::Suit::Spade),
            count,
        };
        let (call, friend): (FriendCall, Option<Seat>) = if alone {
            (FriendCall::Alone, None)
        } else {
            (FriendCall::Seat(1), Some(1))
        };
        let example = |points: u8| Example {
            value: breakdown(rules, contract, alone, points),
            payoffs: settle(rules, 0, friend, contract, call, points),
        };
        Examples {
            contract,
            alone,
            made: example((count + 2).min(20)),
            failed: example(count.saturating_sub(2)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::Preset;
    use rand::SeedableRng;

    /// The count ends where the payment does: its last step is the value,
    /// signed by whether the contract was made.
    #[test]
    fn the_breakdown_adds_up_to_the_value() {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(3);
        let mut sets: Vec<Rules> = Preset::ALL.iter().map(|p| p.rules()).collect();
        sets.extend((0..40).map(|_| Rules::web_mighty().varied(&mut rng)));
        for rules in sets {
            for trump in [None, Some(crate::card::Suit::Club)] {
                for count in rules.lowest_contract()..=20 {
                    let contract = Contract { trump, count };
                    for alone in [false, true] {
                        for points in 0..=20 {
                            let b = breakdown(&rules, contract, alone, points);
                            assert_eq!(b.value, value(&rules, contract, alone, points));
                            let last = match *b.steps.last().unwrap() {
                                ScoreStep::OverTen { total, .. }
                                | ScoreStep::OverMin { total, .. }
                                | ScoreStep::OverBid { total, .. }
                                | ScoreStep::BidBonus { total, .. }
                                | ScoreStep::BothOver { total, .. }
                                | ScoreStep::Short { total, .. }
                                | ScoreStep::PaysBack { total, .. }
                                | ScoreStep::BackRun { total, .. }
                                | ScoreStep::Doubled { total, .. } => total,
                            };
                            assert_eq!(if b.made { last } else { -last }, b.value);
                        }
                    }
                }
            }
        }
    }

    /// The rulebook's examples: one over the minimum, made by two and
    /// missed by two, with a friend where one can be called.
    #[test]
    fn examples_follow_the_rules() {
        let e = Examples::new(&Preset::Default.rules());
        assert_eq!(e.contract.count, Preset::Default.rules().bidding.min + 1);
        assert!(!e.alone);
        assert!(e.made.value.made && !e.failed.value.made);
        assert_eq!(e.made.payoffs.iter().sum::<i64>(), 0);
        assert_eq!(e.made.payoffs[4], -e.made.value.value);
        let mut alone = Preset::Default.rules().for_players(3).unwrap();
        alone.friend.alone = true;
        assert!(Examples::new(&alone).alone);
    }
}
